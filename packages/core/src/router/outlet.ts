/**
 * @since 1.0.0
 * Router Outlet
 *
 * Renders matched route components from a RoutesManifest.
 * Uses RouteMatcher, BoundaryResolver, OutletRenderer (service interfaces),
 * and AsyncLoader for loading state. Instance-scoped state uses Ref
 * (atomic, Effect-native state management).
 */
import {
  Array as Arr,
  Cause,
  Context,
  Effect,
  FiberRef,
  Layer,
  Option,
  Ref,
  Schema,
  SubscriptionRef,
} from "effect";
import { type Element, text, signalElement, componentElement } from "../primitives/element.js";
import * as Signal from "../primitives/signal.js";
import * as Component from "../primitives/component.js";
import type { ComponentProps } from "../primitives/component.js";
import { type RoutesManifest, CurrentRoutesManifest } from "./routes.js";
import {
  resolveRoutes,
  runRouteMiddleware,
  decodeRouteParams,
  decodeRouteQuery,
  type RouteMatch,
  type RouteMatcherShape,
} from "./matching.js";
import {
  get as getRouter,
  CurrentOutletChild,
  CurrentRouteParams,
  CurrentRouteError,
} from "./service.js";
import { runPrefetch } from "./prefetch.js";
import {
  BoundaryResolver,
  AsyncLoader,
  type BoundaryResolverShape,
  type AsyncLoaderShape,
} from "./outlet-services.js";
import { CurrentRouteQuery } from "./route.js";
import { RenderLoadError } from "./render-strategy.js";
import { ScrollStrategy } from "./scroll-strategy.js";
import {
  InvalidRouteComponent,
  type RouteComponent,
  type RouteErrorInfo,
  type RouteParams,
} from "./types.js";
import * as Metrics from "../debug/metrics.js";
import { unsafeMergeLayers } from "../internal/unsafe.js";

// =============================================================================
// Schema Validation for RouteComponent
// =============================================================================

/**
 * Schema for validating RouteComponent values.
 * A RouteComponent can be:
 * - A Component (from Component.gen)
 * - An Effect<Element>
 * @internal
 */
const RouteComponentSchema = Schema.declare(
  (u: unknown): u is RouteComponent => Component.isEffectComponent(u) || Effect.isEffect(u),
  { identifier: "RouteComponent" },
);

/**
 * Type guard to check if a RouteComponent is an Effect<Element>.
 * Used to narrow the union type after checking !Component.isEffectComponent().
 * @internal
 */
const isEffectElement = (u: RouteComponent): u is Effect.Effect<Element, unknown, unknown> =>
  Effect.isEffect(u);

// =============================================================================
// Lazy Component Loading
// =============================================================================

/**
 * Check if a value is a loader function (from vite transform).
 * Loader functions are plain functions (not Component.gen results, not Effects).
 * After vite transform: `.component(() => import("./Page"))`
 * @internal
 */
const isComponentLoader = (value: unknown): value is () => Promise<{ default: unknown }> =>
  typeof value === "function" && !Component.isEffectComponent(value) && !Effect.isEffect(value);

/**
 * Resolve a route component — handles both direct references and loader functions.
 * - Direct component (Component.gen or Effect): returns as-is
 * - Loader function (from vite transform): invokes loader via Effect.async
 *
 * At build time, the vite plugin transforms `.component(X)` to
 * `.component(() => import("./X"))` for Lazy routes. This function
 * detects the loader and invokes it, or passes through direct components.
 *
 * @internal
 */
const resolveComponent = (
  component: RouteComponent | unknown,
): Effect.Effect<RouteComponent, RenderLoadError, never> => {
  if (isComponentLoader(component)) {
    // Loader function from vite transform: () => Promise<{ default: RouteComponent }>
    return Effect.async<RouteComponent, RenderLoadError>((resume) => {
      component()
        .then((m) => {
          const decoded = Schema.decodeUnknownSync(RouteComponentSchema)(m.default);
          resume(Effect.succeed(decoded));
        })
        .catch((cause) => resume(Effect.fail(new RenderLoadError({ cause }))));
    });
  }
  // Direct component (Component.gen result or Effect<Element>)
  return Schema.decodeUnknown(RouteComponentSchema)(component).pipe(
    Effect.mapError((parseError) => new RenderLoadError({ cause: parseError })),
  );
};

/**
 * Extract only string-valued entries from a decoded params object.
 * Route params are always strings (URL path segments). Non-string values
 * (e.g. from NumberFromString transforms) are silently dropped.
 * @internal
 */
const toRouteParams = (decoded: Record<string, unknown>): RouteParams => {
  const result: Record<string, string> = {};
  for (const [key, value] of Object.entries(decoded)) {
    if (typeof value === "string") {
      result[key] = value;
    }
  }
  return result;
};

// =============================================================================
// Types
// =============================================================================

/**
 * Outlet props
 * @since 1.0.0
 */
export interface OutletProps {
  /** Routes manifest from RoutesCollection.manifest */
  readonly routes?: RoutesManifest;
}

// =============================================================================
// Outlet
// =============================================================================

/**
 * Router Outlet - renders matched route from RoutesManifest.
 *
 * When used at the top level with `routes` prop, matches current path and renders component.
 * When used inside a layout (without routes), renders child content from parent outlet.
 *
 * Integrates:
 * - RouteMatcher for path matching (cached per manifest)
 * - Middleware execution (left-to-right, parent-before-child)
 * - BoundaryResolver for nearest-wins error/notFound/forbidden
 * - OutletRenderer for component/layout/error rendering
 * - AsyncLoader for loading state management (Ref-based, scoped fibers)
 * - Layout stacking (root-to-leaf via Array.reduceRight)
 *
 * @since 1.0.0
 */
export const Outlet = Component.gen(function* (Props: ComponentProps<OutletProps>) {
  const props = yield* Props;
  const { routes } = props ?? {};

  /** Build stable key from match for comparison. @internal */
  const buildMatchKey = (match: RouteMatch, queryStr: string): string =>
    JSON.stringify({
      path: match.route.path,
      params: match.params,
      query: queryStr,
    });

  // Main outlet effect
  const outletEffect = Effect.gen(function* () {
    // Instance-scoped state (persists across re-renders of this outlet)
    const cachedMatcherRef = yield* Ref.make<Option.Option<RouteMatcherShape>>(Option.none());
    const cachedManifestRef = yield* Ref.make<Option.Option<RoutesManifest>>(Option.none());
    const asyncLoaderRef = yield* Ref.make<Option.Option<AsyncLoaderShape>>(Option.none());
    // Nested outlet check: if there's child content, render it
    const childContent = yield* FiberRef.get(CurrentOutletChild);
    if (Option.isSome(childContent)) {
      yield* FiberRef.set(CurrentOutletChild, Option.none());
      return childContent.value;
    }

    // Resolve manifest: explicit prop takes priority, then FiberRef
    const manifest: RoutesManifest | undefined =
      routes ?? Option.getOrUndefined(yield* FiberRef.get(CurrentRoutesManifest));

    // No routes available - render empty
    if (manifest === undefined || manifest.routes.length === 0) {
      return text("No routes configured");
    }

    // Get or create route matcher (cached via Ref)
    const cachedMatcher = yield* Ref.get(cachedMatcherRef);
    const cachedManifest = yield* Ref.get(cachedManifestRef);
    const manifestChanged = Option.match(cachedManifest, {
      onNone: () => true,
      onSome: (m) => m !== manifest,
    });

    if (Option.isNone(cachedMatcher) || manifestChanged) {
      const resolved = yield* resolveRoutes(manifest);
      const matchFn = buildTrieMatcher(resolved);
      const shape: RouteMatcherShape = {
        match: (path) => Effect.succeed(matchFn(path)),
        routes: Effect.succeed(resolved),
      };
      yield* Ref.set(cachedMatcherRef, Option.some(shape));
      yield* Ref.set(cachedManifestRef, Option.some(manifest));
    }

    const matcherOpt = yield* Ref.get(cachedMatcherRef);
    if (Option.isNone(matcherOpt)) {
      return text("No routes configured");
    }
    const matcher = matcherOpt.value;
    const boundaries: BoundaryResolverShape = BoundaryResolver.make(manifest);

    const router = yield* getRouter;
    const componentScope = yield* FiberRef.get(Signal.CurrentComponentScope);
    const scope = componentScope ?? (yield* Effect.scope);

    // Create a unified view signal — holds the currently rendered element.
    // Updated reactively by processRoute (via AsyncLoader or direct set).
    const viewSignal = yield* Signal.make<Element>(text(""));

    /**
     * Process a route: match, middleware, boundaries, render, update view.
     * Called for both initial render AND subsequent route changes.
     * Does NOT read router.current via Signal.get (no component re-render).
     */
    const processRoute = Effect.gen(function* () {
      // Read route WITHOUT tracking — uses SubscriptionRef directly to
      // avoid registering router.current as a component dependency.
      const route = yield* SubscriptionRef.get(router.current._ref);

      // Read navigation context for scroll handling
      const navCtx = yield* Ref.get(router._navigationContext);

      // Helper: apply scroll behavior for a given strategy layer
      const applyScroll = (strategyLayer: Layer.Layer<ScrollStrategy> | undefined) =>
        Effect.gen(function* () {
          const strategy = yield* Effect.provide(
            ScrollStrategy,
            strategyLayer ?? ScrollStrategy.Auto,
          );
          yield* router._applyScroll({
            strategyKey: strategy.getKey({ pathname: route.path, key: navCtx.scrollKey }),
          });
        }).pipe(Effect.ignore);

      // Match current path
      const matchOption = yield* matcher.match(route.path);

      if (Option.isNone(matchOption)) {
        const notFoundEl = yield* Option.match(boundaries.resolveNotFoundRoot(), {
          onNone: () => Effect.succeed(text("404 - Not Found")),
          onSome: (comp) =>
            Effect.flatMap(resolveComponent(comp), (resolved) => renderComponent(resolved, {}, {})),
        });
        yield* Signal.set(viewSignal, notFoundEl);
        yield* applyScroll(undefined);
        return;
      }

      const match = matchOption.value;

      // Run middleware chain
      const middlewareResult = yield* runRouteMiddleware(match.route);

      // Handle middleware results
      if (middlewareResult._tag === "Redirect") {
        yield* router.navigate(middlewareResult.path, { replace: middlewareResult.replace });
        return;
      }

      if (middlewareResult._tag === "Forbidden") {
        const el = yield* Option.match(boundaries.resolveForbidden(match.route), {
          onNone: () => Effect.succeed(text("403 - Forbidden")),
          onSome: (comp) =>
            Effect.flatMap(resolveComponent(comp), (resolved) => renderComponent(resolved, {}, {})),
        });
        yield* Signal.set(viewSignal, el);
        yield* applyScroll(match.route.definition.scrollStrategy);
        return;
      }

      if (middlewareResult._tag === "Error") {
        const el = yield* Option.match(boundaries.resolveError(match.route), {
          onNone: () => Effect.succeed(text("Error")),
          onSome: (comp) =>
            Effect.flatMap(resolveComponent(comp), (resolved) =>
              renderError(resolved, Cause.fail(middlewareResult.cause), route.path),
            ),
        });
        yield* Signal.set(viewSignal, el);
        yield* applyScroll(match.route.definition.scrollStrategy);
        return;
      }

      // Decode params and query
      const decodedParams = yield* decodeRouteParams(match.route, match.params).pipe(
        Effect.catchAll(() => Effect.succeed<Record<string, unknown>>(match.params)),
      );

      const queryString = route.query.toString();
      const decodedQuery = yield* decodeRouteQuery(match.route, route.query).pipe(
        Effect.catchAll(() => Effect.succeed<Record<string, unknown>>({})),
      );

      // Run prefetch effects (parallel, non-blocking)
      const prefetchFns = match.route.definition.prefetch;
      if (prefetchFns.length > 0) {
        yield* runPrefetch(prefetchFns, { params: decodedParams, query: decodedQuery });
      }

      // Collect service layers from ancestor routes + matched route
      const allLayers = [
        ...match.route.ancestors.flatMap((a) => (a !== undefined ? a.definition.layers : [])),
        ...match.route.definition.layers,
      ];

      // Build the render effect
      const renderRouteBase: Effect.Effect<Element, unknown, never> = Effect.gen(function* () {
        const rawComponent = match.route.definition.component;
        if (rawComponent === undefined) {
          return text("");
        }

        // Resolve component (handles loader functions from vite transform)
        const component = yield* resolveComponent(rawComponent);

        // Render leaf component with route context
        const leafElement = yield* renderComponent(component, decodedParams, decodedQuery);

        // Collect all layouts: ancestors with layouts (root-to-leaf) + leaf layout
        // Each layout may be a loader function (from vite transform) - resolve first
        const ancestorRawLayouts = Arr.filterMap(match.route.ancestors, (a) =>
          a !== undefined && a.definition.layout !== undefined
            ? Option.some(a.definition.layout)
            : Option.none(),
        );
        const allRawLayouts =
          match.route.definition.layout !== undefined
            ? [...ancestorRawLayouts, match.route.definition.layout]
            : ancestorRawLayouts;

        // Resolve all layouts (handles loader functions)
        const allLayouts = yield* Effect.all(
          allRawLayouts.map((l) => resolveComponent(l)),
          { concurrency: "unbounded" },
        );

        // Stack layouts from innermost (leaf) to outermost (root) via reduceRight
        const leafEffect: Effect.Effect<Element, unknown, never> = Effect.succeed(leafElement);
        return yield* Arr.reduceRight(allLayouts, leafEffect, (acc, layout) =>
          Effect.flatMap(acc, (child) => renderLayout(layout, child, decodedParams, decodedQuery)),
        );
      });

      // Provide service layers from Route.provide() to the render effect
      const renderRoute: Effect.Effect<Element, unknown, never> =
        allLayers.length > 0
          ? Effect.flatMap(unsafeMergeLayers(allLayers), (merged) =>
              renderRouteBase.pipe(Effect.provide(merged)),
            )
          : renderRouteBase;

      // Resolve boundaries for error/loading wrapping
      const nearestErrorComp = boundaries.resolveError(match.route);
      const nearestLoadingComp = boundaries.resolveLoading(match.route);

      // Build the render effect with error boundary wrapping
      const renderWithError: Effect.Effect<Element, unknown, never> = Option.match(
        nearestErrorComp,
        {
          onNone: () => renderRoute,
          onSome: (errorComp) =>
            Effect.gen(function* () {
              const resolvedErrorComp = yield* resolveComponent(errorComp);
              const routeElement = yield* renderRoute;
              return componentElement(() =>
                Effect.gen(function* () {
                  if (routeElement._tag === "Component") {
                    return yield* routeElement.run().pipe(
                      Effect.sandbox,
                      Effect.catchAllCause((sandboxedCause) =>
                        Effect.gen(function* () {
                          const cause = Cause.flatten(sandboxedCause);
                          const errorEl = yield* renderError(resolvedErrorComp, cause, route.path);
                          if (errorEl._tag === "Component") {
                            return yield* errorEl.run();
                          }
                          return errorEl;
                        }),
                      ),
                    );
                  }
                  return routeElement;
                }),
              );
            }),
        },
      );

      // Handle loading state via AsyncLoader
      if (Option.isSome(nearestLoadingComp)) {
        const currentAsyncLoader = yield* Ref.get(asyncLoaderRef);
        let loader: AsyncLoaderShape;
        if (Option.isNone(currentAsyncLoader)) {
          const resolvedLoading = yield* resolveComponent(nearestLoadingComp.value);
          const loadingElement = yield* renderComponent(resolvedLoading, {}, {});
          loader = yield* AsyncLoader.make(loadingElement, scope);
          yield* Ref.set(asyncLoaderRef, Option.some(loader));

          // Propagate loader.view changes → viewSignal
          const _unsubLoader = yield* Signal.subscribe(loader.view, () =>
            Effect.gen(function* () {
              const val = yield* SubscriptionRef.get(loader.view._ref);
              yield* Signal.set(viewSignal, val);
            }),
          );
          void _unsubLoader;
        } else {
          loader = currentAsyncLoader.value;
        }
        const matchKey = buildMatchKey(match, queryString);
        yield* loader.track(matchKey, renderWithError);

        // Sync current loader.view → viewSignal (for initial render)
        const currentView = yield* SubscriptionRef.get(loader.view._ref);
        yield* Signal.set(viewSignal, currentView);
        yield* applyScroll(match.route.definition.scrollStrategy);
        return;
      }

      // No loading boundary: render directly and set viewSignal
      const element = yield* renderWithError;
      yield* Signal.set(viewSignal, element);
      yield* applyScroll(match.route.definition.scrollStrategy);
    }).pipe(Effect.catchAllCause(() => Effect.void));

    // Process the initial route
    yield* processRoute;

    // Subscribe to route changes — calls processRoute reactively.
    // Does NOT cause component re-render (subscription, not Signal.get).
    const _unsubRouter = yield* Signal.subscribe(router.current, () => processRoute);
    void _unsubRouter;

    return signalElement(viewSignal);
  });

  return componentElement(() => outletEffect);
});

// =============================================================================
// Internal: Trie Matcher Builder
// =============================================================================

import type { ResolvedRoute, RouteMatch as RM } from "./matching.js";

/**
 * Build a trie-based match function from resolved routes.
 * @internal
 */
function buildTrieMatcher(
  resolved: ReadonlyArray<ResolvedRoute>,
): (path: string) => Option.Option<RM> {
  type SegType = "static" | "param" | "wildcard" | "catchAllRequired";
  interface Seg {
    readonly type: SegType;
    readonly value: string;
  }
  interface Compiled {
    readonly resolved: ResolvedRoute;
    readonly segments: Seg[];
    readonly score: number;
  }

  const parsePattern = (pattern: string): Seg[] => {
    const parts = pattern
      .replace(/^\/|\/$/g, "")
      .split("/")
      .filter(Boolean);
    return parts.map((part): Seg => {
      if (part.startsWith(":") && part.endsWith("*"))
        return { type: "wildcard", value: part.slice(1, -1) };
      if (part.startsWith(":") && part.endsWith("+"))
        return { type: "catchAllRequired", value: part.slice(1, -1) };
      if (part.startsWith(":")) return { type: "param", value: part.slice(1) };
      return { type: "static", value: part };
    });
  };

  const scoreRoute = (segs: Seg[]): number => {
    let s = 0;
    for (const seg of segs) {
      s +=
        seg.type === "static"
          ? 3
          : seg.type === "param"
            ? 2
            : seg.type === "catchAllRequired"
              ? 1.5
              : 1;
    }
    return s + segs.length * 0.1;
  };

  interface TNode {
    readonly staticChildren: Map<string, TNode>;
    paramChild: { node: TNode; name: string } | undefined;
    wildcardChild: { node: TNode; name: string } | undefined;
    routes: Compiled[];
  }
  const mkNode = (): TNode => ({
    staticChildren: new Map(),
    paramChild: undefined,
    wildcardChild: undefined,
    routes: [],
  });

  const compiled: Compiled[] = resolved.map((r) => {
    const segments = parsePattern(r.path);
    return { resolved: r, segments, score: scoreRoute(segments) };
  });
  compiled.sort((a, b) =>
    a.segments.length !== b.segments.length
      ? b.segments.length - a.segments.length
      : b.score - a.score,
  );

  const root = mkNode();
  for (const route of compiled) {
    let cur = root;
    for (const seg of route.segments) {
      if (seg.type === "static") {
        let c = cur.staticChildren.get(seg.value);
        if (!c) {
          c = mkNode();
          cur.staticChildren.set(seg.value, c);
        }
        cur = c;
      } else if (seg.type === "param") {
        if (!cur.paramChild) cur.paramChild = { node: mkNode(), name: seg.value };
        cur = cur.paramChild.node;
      } else {
        if (!cur.wildcardChild) cur.wildcardChild = { node: mkNode(), name: seg.value };
        cur = cur.wildcardChild.node;
        break;
      }
    }
    cur.routes.push(route);
  }

  type Params = Record<string, string>;
  interface MR {
    readonly route: Compiled;
    readonly params: Params;
  }

  const walk = (node: TNode, parts: string[], idx: number, params: Params): MR[] => {
    const results: MR[] = [];
    if (idx >= parts.length) {
      for (const r of node.routes) {
        const last = r.segments[r.segments.length - 1];
        if (
          last?.type !== "wildcard" &&
          last?.type !== "catchAllRequired" &&
          r.segments.length === idx
        ) {
          results.push({ route: r, params: { ...params } });
        }
      }
      if (node.wildcardChild) {
        const np = { ...params, [node.wildcardChild.name]: "" };
        for (const r of node.wildcardChild.node.routes) {
          if (r.segments[r.segments.length - 1]?.type === "wildcard")
            results.push({ route: r, params: np });
        }
      }
      return results;
    }
    const part = parts[idx];
    if (part === undefined) return results;
    const sc = node.staticChildren.get(part);
    if (sc) results.push(...walk(sc, parts, idx + 1, params));
    if (node.paramChild)
      results.push(
        ...walk(node.paramChild.node, parts, idx + 1, { ...params, [node.paramChild.name]: part }),
      );
    if (node.wildcardChild) {
      const rest = parts.slice(idx).join("/");
      const np = { ...params, [node.wildcardChild.name]: rest };
      for (const r of node.wildcardChild.node.routes) {
        if (r.segments[r.segments.length - 1]?.type === "catchAllRequired" && rest === "") continue;
        results.push({ route: r, params: np });
      }
    }
    return results;
  };

  return (path: string): Option.Option<RM> => {
    const norm = (path.split("?")[0] ?? path).replace(/^\/|\/$/g, "");
    const parts = norm === "" ? [] : norm.split("/");
    const matches = walk(root, parts, 0, {});
    if (matches.length === 0) return Option.none();
    matches.sort((a, b) =>
      a.route.segments.length !== b.route.segments.length
        ? b.route.segments.length - a.route.segments.length
        : b.route.score - a.route.score,
    );
    const best = matches[0];
    if (!best) return Option.none();
    return Option.some({ route: best.route.resolved, params: best.params });
  };
}

// =============================================================================
// Internal: Renderer Functions
// =============================================================================

function renderComponent(
  component: RouteComponent,
  decodedParams: Record<string, unknown>,
  decodedQuery: Record<string, unknown> = {},
): Effect.Effect<Element, unknown, never> {
  const params = toRouteParams(decodedParams);
  if (Component.isEffectComponent(component)) {
    const element = component({});
    if (element._tag === "Component") {
      const originalRun = element.run;
      return Effect.succeed(
        componentElement(() => {
          return originalRun().pipe(
            Effect.locally(CurrentRouteParams, params),
            Effect.locally(CurrentRouteQuery, decodedQuery),
          );
        }),
      );
    }
    return Effect.succeed(element);
  }
  // Component is an Effect<Element> - wrap it
  if (isEffectElement(component)) {
    return Effect.succeed(
      componentElement(() => {
        return component.pipe(
          Effect.locally(CurrentRouteParams, params),
          Effect.locally(CurrentRouteQuery, decodedQuery),
        );
      }),
    );
  }
  // Should never reach here if RouteComponentSchema validation is working
  return new InvalidRouteComponent({ actual: component });
}

function renderLayout(
  layout: RouteComponent,
  child: Element,
  decodedParams: Record<string, unknown>,
  decodedQuery: Record<string, unknown> = {},
): Effect.Effect<Element, unknown, never> {
  const params = toRouteParams(decodedParams);
  if (Component.isEffectComponent(layout)) {
    const element = layout({});
    if (element._tag === "Component") {
      const originalRun = element.run;
      return Effect.succeed(
        componentElement(() =>
          Effect.gen(function* () {
            yield* FiberRef.set(CurrentOutletChild, Option.some(child));
            const layoutElement = yield* originalRun().pipe(
              Effect.locally(CurrentRouteParams, params),
              Effect.locally(CurrentRouteQuery, decodedQuery),
            );
            // If layout returns a Provide element, merge its context with parent context
            if (layoutElement._tag === "Provide") {
              const capturedContext = yield* Effect.context<never>();
              const mergedContext = Context.merge(capturedContext, layoutElement.context);
              return { ...layoutElement, context: mergedContext };
            }
            return layoutElement;
          }),
        ),
      );
    }
    return Effect.succeed(element);
  }
  // Layout is an Effect<Element> - wrap it
  if (isEffectElement(layout)) {
    return Effect.succeed(
      componentElement(() =>
        Effect.gen(function* () {
          yield* FiberRef.set(CurrentOutletChild, Option.some(child));
          const layoutElement = yield* layout.pipe(
            Effect.locally(CurrentRouteParams, params),
            Effect.locally(CurrentRouteQuery, decodedQuery),
          );
          // If layout returns a Provide element, merge its context with parent context
          if (layoutElement._tag === "Provide") {
            const capturedContext = yield* Effect.context<never>();
            const mergedContext = Context.merge(capturedContext, layoutElement.context);
            return { ...layoutElement, context: mergedContext };
          }
          return layoutElement;
        }),
      ),
    );
  }
  // Should never reach here if RouteComponentSchema validation is working
  return new InvalidRouteComponent({ actual: layout });
}

function renderError(
  errorComp: RouteComponent,
  cause: Cause.Cause<unknown>,
  path: string,
): Effect.Effect<Element, InvalidRouteComponent, never> {
  return Effect.gen(function* () {
    yield* Metrics.recordRouteError;
    const resetSignal = yield* Signal.make(0);
    const errorInfo: RouteErrorInfo = {
      cause,
      path,
      reset: Signal.update(resetSignal, (n) => n + 1),
    };
    if (Component.isEffectComponent(errorComp)) {
      const element = errorComp({});
      if (element._tag === "Component") {
        const originalRun = element.run;
        return componentElement(() =>
          originalRun().pipe(Effect.locally(CurrentRouteError, Option.some(errorInfo))),
        );
      }
      return element;
    }
    // Error component is an Effect<Element> - wrap it
    if (isEffectElement(errorComp)) {
      return componentElement(() =>
        errorComp.pipe(Effect.locally(CurrentRouteError, Option.some(errorInfo))),
      );
    }
    // Should never reach here if RouteComponentSchema validation is working
    return yield* new InvalidRouteComponent({ actual: errorComp });
  });
}
