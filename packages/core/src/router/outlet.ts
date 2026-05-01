/**
 * Outlet rendering primitives for `trygg/router`.
 *
 * @remarks
 * Owner module for route rendering. This module owns the `Outlet` component,
 * its props, and the prefetch resolver that ties route matching to lazy module
 * warming during navigation.
 *
 * @see ./outlet.docs.md - Source-owned topic guide
 * @since 1.0.0
 * @module trygg/router/outlet
 */
import {
  Array as Arr,
  Cause,
  Deferred,
  Effect,
  Layer,
  Option,
  Ref,
  Result,
  Schema,
  Scope,
  SubscriptionRef,
} from "effect";
import * as Debug from "../debug/debug.js";
import * as ContractTrace from "../contract/trace.js";
import {
  Element,
  type Element as ElementType,
  text,
  signalElement,
} from "../primitives/element.js";
import * as Signal from "../primitives/signal.js";
import * as Component from "../primitives/component.js";
import type { ComponentProps } from "../primitives/component.js";
import { type RoutesManifest, CurrentRoutesManifest } from "./routes.js";
import {
  resolveRoutes,
  resolveScrollStrategy,
  runRouteMiddleware,
  decodeRouteParams,
  decodeRouteQuery,
  type RouteMatch,
  type RouteMatcherShape,
  type ResolvedRoute,
} from "./matching.js";
import { get as getRouter, CurrentOutletChild } from "./service.js";
import { runPrefetch } from "./prefetch.js";
import { parsePath } from "./utils.js";
import {
  BoundaryResolver,
  AsyncLoader,
  renderComponent,
  renderLayout,
  renderError,
  type BoundaryResolverShape,
  type AsyncLoaderShape,
} from "./outlet-services.js";
import { RenderLoadError } from "./render-strategy.js";
import { ScrollStrategy } from "./scroll-strategy.js";
import {
  type ComponentInput,
  type ComponentLoader,
  type RouteComponent,
  type RouteParams,
} from "./types.js";
import { getFiberRef, setFiberRef } from "../internal/fiber-ref.js";
import { unsafeBuildContext, unsafeEraseR } from "../internal/unsafe.js";

const outletRuntimeIdentity = Symbol("trygg/router/Outlet.runtime");
const outletErrorBoundaryIdentity = Symbol("trygg/router/Outlet.error-boundary");
const outletLazyLeafIdentity = Symbol("trygg/router/Outlet.lazy-leaf");

// =============================================================================
// Trie-Based Matching
// =============================================================================

/** @internal */
interface PathSegment {
  readonly type: "static" | "param" | "wildcard" | "catchAllRequired";
  readonly value: string;
}

/** @internal */
interface CompiledRoute {
  readonly resolved: ResolvedRoute;
  readonly segments: ReadonlyArray<PathSegment>;
  readonly score: number;
}

/** @internal */
interface TrieNode {
  readonly staticChildren: Map<string, TrieNode>;
  paramChild: { node: TrieNode; name: string } | undefined;
  wildcardChild: { node: TrieNode; name: string } | undefined;
  routes: CompiledRoute[];
}

/** @internal */
interface TrieMatchResult {
  readonly route: CompiledRoute;
  readonly params: RouteParams;
}

/** @internal */
const parsePattern = (pattern: string): ReadonlyArray<PathSegment> => {
  const segments: Array<PathSegment> = [];
  const parts = pattern
    .replace(/^\/|\/$/g, "")
    .split("/")
    .filter(Boolean);

  for (const part of parts) {
    if (part.startsWith(":") && part.endsWith("*")) {
      segments.push({ type: "wildcard", value: part.slice(1, -1) });
    } else if (part.startsWith(":") && part.endsWith("+")) {
      segments.push({ type: "catchAllRequired", value: part.slice(1, -1) });
    } else if (part.startsWith(":")) {
      segments.push({ type: "param", value: part.slice(1) });
    } else {
      segments.push({ type: "static", value: part });
    }
  }

  return segments;
};

/** @internal */
const createTrieNode = (): TrieNode => ({
  staticChildren: new Map(),
  paramChild: undefined,
  wildcardChild: undefined,
  routes: [],
});

/** @internal */
const scoreRoute = (segments: ReadonlyArray<PathSegment>): number => {
  let score = 0;
  for (const segment of segments) {
    if (segment.type === "static") {
      score += 3;
    } else if (segment.type === "param") {
      score += 2;
    } else if (segment.type === "catchAllRequired") {
      score += 1.5;
    } else if (segment.type === "wildcard") {
      score += 1;
    }
  }
  score += segments.length * 0.1;
  return score;
};

/** @internal */
const insertIntoTrie = (root: TrieNode, route: CompiledRoute): void => {
  let current = root;

  for (const segment of route.segments) {
    if (segment.type === "static") {
      let child = current.staticChildren.get(segment.value);
      if (child === undefined) {
        child = createTrieNode();
        current.staticChildren.set(segment.value, child);
      }
      current = child;
    } else if (segment.type === "param") {
      if (current.paramChild === undefined) {
        current.paramChild = { node: createTrieNode(), name: segment.value };
      }
      current = current.paramChild.node;
    } else if (segment.type === "wildcard" || segment.type === "catchAllRequired") {
      if (current.wildcardChild === undefined) {
        current.wildcardChild = { node: createTrieNode(), name: segment.value };
      }
      current = current.wildcardChild.node;
      break;
    }
  }

  current.routes.push(route);
};

/** @internal */
const walkTrie = (
  node: TrieNode,
  pathParts: ReadonlyArray<string>,
  pathIndex: number,
  params: RouteParams,
): ReadonlyArray<TrieMatchResult> => {
  const results: Array<TrieMatchResult> = [];

  if (pathIndex >= pathParts.length) {
    for (const route of node.routes) {
      const lastSegment = route.segments[route.segments.length - 1];
      if (
        lastSegment?.type !== "wildcard" &&
        lastSegment?.type !== "catchAllRequired" &&
        route.segments.length === pathIndex
      ) {
        results.push({ route, params: { ...params } });
      }
    }
    if (node.wildcardChild !== undefined) {
      const newParams = { ...params, [node.wildcardChild.name]: "" };
      for (const route of node.wildcardChild.node.routes) {
        const lastSeg = route.segments[route.segments.length - 1];
        if (lastSeg?.type === "wildcard") {
          results.push({ route, params: { ...newParams } });
        }
      }
    }
    return results;
  }

  const currentPart = pathParts[pathIndex];
  if (currentPart === undefined) return results;

  const staticChild = node.staticChildren.get(currentPart);
  if (staticChild !== undefined) {
    results.push(...walkTrie(staticChild, pathParts, pathIndex + 1, params));
  }

  if (node.paramChild !== undefined) {
    const newParams = { ...params, [node.paramChild.name]: currentPart };
    results.push(...walkTrie(node.paramChild.node, pathParts, pathIndex + 1, newParams));
  }

  if (node.wildcardChild !== undefined) {
    const rest = pathParts.slice(pathIndex).join("/");
    const newParams = { ...params, [node.wildcardChild.name]: rest };
    for (const route of node.wildcardChild.node.routes) {
      const lastSeg = route.segments[route.segments.length - 1];
      if (lastSeg?.type !== "catchAllRequired" || rest !== "") {
        results.push({ route, params: { ...newParams } });
      }
    }
  }

  return results;
};

/** @internal */
export const buildTrieMatcher = (
  resolved: ReadonlyArray<ResolvedRoute>,
): ((path: string) => Option.Option<RouteMatch>) => {
  const compiled = resolved.map((route): CompiledRoute => {
    const segments = parsePattern(route.path);
    return { resolved: route, segments, score: scoreRoute(segments) };
  });

  const sorted = [...compiled].sort((a, b) => {
    if (a.segments.length !== b.segments.length) {
      return b.segments.length - a.segments.length;
    }
    return b.score - a.score;
  });

  const root = createTrieNode();
  for (const route of sorted) {
    insertIntoTrie(root, route);
  }

  return (path: string): Option.Option<RouteMatch> => {
    const normalizedPath = path.split("?")[0] ?? path;
    const pathParts = normalizedPath
      .replace(/^\/|\/$/g, "")
      .split("/")
      .filter(Boolean);

    const matches = walkTrie(root, pathParts, 0, {});
    if (matches.length === 0) return Option.none();

    const sortedMatches = [...matches].sort((a, b) => {
      if (a.route.segments.length !== b.route.segments.length) {
        return b.route.segments.length - a.route.segments.length;
      }
      return b.route.score - a.route.score;
    });

    const best = sortedMatches[0];
    if (best === undefined) return Option.none();

    return Option.some({ route: best.route.resolved, params: best.params });
  };
};

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

// =============================================================================
// Lazy Component Loading
// =============================================================================

/**
 * Check if a value is a loader function (from vite transform).
 * Loader functions are plain functions (not Component.gen results, not Effects).
 * After vite transform: `.component(() => import("./Page"))`
 * @internal
 */
/** @internal */
export const isComponentLoader = (value: ComponentInput): value is ComponentLoader =>
  typeof value === "function" && !Component.isEffectComponent(value) && !Effect.isEffect(value);

/**
 * Collect all ComponentInput values from a route match that may need lazy loading.
 * Includes: ancestor layouts, leaf layout, leaf component, nearest loading, nearest error.
 * @internal
 */
/** @internal */
export const collectPrefetchTargets = (match: RouteMatch): ReadonlyArray<ComponentInput> => {
  const targets: Array<ComponentInput> = [];
  const route = match.route;

  // Ancestor layouts (root-to-leaf)
  for (const ancestor of route.ancestors) {
    if (ancestor.definition.layout !== undefined) {
      targets.push(ancestor.definition.layout);
    }
  }

  // Leaf layout
  if (route.definition.layout !== undefined) {
    targets.push(route.definition.layout);
  }

  // Leaf component
  if (route.definition.component !== undefined) {
    targets.push(route.definition.component);
  }

  // Nearest loading boundary (leaf → ancestors)
  if (route.definition.loading !== undefined) {
    targets.push(route.definition.loading);
  } else {
    for (let i = route.ancestors.length - 1; i >= 0; i--) {
      const a = route.ancestors[i];
      if (a !== undefined && a.definition.loading !== undefined) {
        targets.push(a.definition.loading);
        break;
      }
    }
  }

  // Nearest error boundary (leaf → ancestors)
  if (route.definition.error !== undefined) {
    targets.push(route.definition.error);
  } else {
    for (let i = route.ancestors.length - 1; i >= 0; i--) {
      const a = route.ancestors[i];
      if (a !== undefined && a.definition.error !== undefined) {
        targets.push(a.definition.error);
        break;
      }
    }
  }

  return targets;
};

/**
 * Build a prefetch resolver that matches a path against the route trie
 * and triggers lazy module loading for all ComponentLoader values.
 * import() is natively idempotent — no application-level cache needed.
 * @internal
 */
/** @internal */
export const buildPrefetchResolver =
  (matcher: RouteMatcherShape): ((path: string) => Effect.Effect<void>) =>
  (path: string) =>
    Effect.gen(function* () {
      const parsed = yield* parsePath(path);
      const matchOption = yield* matcher.match(parsed.path);
      if (Option.isNone(matchOption)) {
        yield* Debug.log({
          event: "router.prefetch.no_match",
          path,
        });
        return;
      }

      const match = matchOption.value;

      const targets = collectPrefetchTargets(match);
      const loaders = targets.filter(isComponentLoader);

      const loadModules =
        loaders.length === 0
          ? Effect.void
          : Effect.forEach(
              loaders,
              (loader) =>
                Effect.tryPromise({
                  try: () => loader(),
                  catch: () => undefined,
                }).pipe(Effect.ignore),
              { concurrency: "unbounded" },
            ).pipe(Effect.asVoid);

      const runRoutePrefetch = Effect.gen(function* () {
        const prefetchFns = match.route.definition.prefetch;
        if (prefetchFns.length === 0) return;

        const decodedParamsResult = yield* decodeRouteParams(match.route, match.params).pipe(
          Effect.result,
        );
        if (Result.isFailure(decodedParamsResult)) return;

        const decodedQueryResult = yield* decodeRouteQuery(match.route, parsed.query).pipe(
          Effect.result,
        );
        if (Result.isFailure(decodedQueryResult)) return;

        yield* runPrefetch(prefetchFns, {
          params: decodedParamsResult.success,
          query: decodedQueryResult.success,
        });
      });

      yield* Effect.all([loadModules, runRoutePrefetch], { concurrency: "unbounded" });
      yield* Debug.log({
        event: "router.prefetch.complete",
        path,
      });
    }).pipe(
      Effect.catchCause((cause) =>
        Debug.log({
          event: "router.prefetch.error",
          path,
          phase: "resolver",
          error_message: String(Cause.squash(cause)),
        }),
      ),
    );

/**
 * Resolve a route component — handles both direct references and loader functions.
 * - Direct component (Component.gen or Effect): returns as-is
 * - Loader function (from vite transform): invokes loader via Effect.tryPromise
 *
 * At build time, the vite plugin transforms `.component(X)` to
 * `.component(() => import("./X"))` for Lazy routes. This function
 * detects the loader and invokes it, or passes through direct components.
 *
 * @internal
 */
const resolveComponent = (
  component: ComponentInput,
): Effect.Effect<RouteComponent, RenderLoadError, never> => {
  if (isComponentLoader(component)) {
    // Loader function from vite transform: () => Promise<{ default: RouteComponent }>
    return Effect.tryPromise({
      try: () => component(),
      catch: (cause) => new RenderLoadError({ cause }),
    }).pipe(
      Effect.flatMap((m) =>
        unsafeEraseR(Schema.decodeUnknownEffect(RouteComponentSchema)(m.default)).pipe(
          Effect.mapError((parseError) => new RenderLoadError({ cause: parseError })),
        ),
      ),
    );
  }
  // Direct component (Component.gen result or Effect<Element>)
  return unsafeEraseR(Schema.decodeUnknownEffect(RouteComponentSchema)(component)).pipe(
    Effect.mapError((parseError) => new RenderLoadError({ cause: parseError })),
  );
};

// =============================================================================
// Types
// =============================================================================

/**
 * Outlet props
 *
 * @remarks
 * `OutletProps` lets callers pass an explicit manifest when mounting a root
 * outlet. Nested outlets normally rely on the implicit manifest FiberRef.
 *
 * @example
 * ```tsx
 * <Router.Outlet routes={routes.manifest} />
 * ```
 *
 * @category Router Outlet
 * @public
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
 * @remarks
 * Use `Outlet` once at the app root with a manifest, then again inside layouts
 * without props to render nested child matches.
 *
 * @example
 * ```tsx
 * const App = Component.gen(function* () {
 *   return <Outlet routes={routes.manifest} />
 * })
 * ```
 *
 * @category Router Outlet
 * @public
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
    const childContent = yield* getFiberRef(CurrentOutletChild);
    if (Option.isSome(childContent)) {
      yield* setFiberRef(CurrentOutletChild, Option.none());
      return childContent.value;
    }

    // Resolve manifest: explicit prop takes priority, then FiberRef
    const manifest: RoutesManifest | undefined =
      routes ?? Option.getOrUndefined(yield* getFiberRef(CurrentRoutesManifest));

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

    // Register prefetch resolver so router.prefetch() can warm lazy modules
    const currentMatcher = yield* Ref.get(cachedMatcherRef);
    if (Option.isSome(currentMatcher)) {
      yield* router.outletCoordination.activatePrefetch(
        buildPrefetchResolver(currentMatcher.value),
      );
    }

    const componentScope = yield* Signal.CurrentComponentScope;
    const scope = componentScope ?? (yield* Effect.scope);

    // Create a unified view signal — holds the currently rendered element.
    // Updated reactively by processRoute (via AsyncLoader or direct set).
    const viewSignal = yield* Signal.make<Element>(text(""));

    // Helper: apply scroll behavior for a given strategy layer.
    // Resolves the ScrollStrategy service from the route's layer and passes
    // the full discriminated union type to the router for _tag dispatch.
    const applyScroll = (strategyLayer: Layer.Layer<ScrollStrategy> | undefined) =>
      Effect.gen(function* () {
        const strategy = yield* Effect.service(ScrollStrategy).pipe(
          Effect.provide(strategyLayer ?? ScrollStrategy.Auto),
        );
        yield* router.outletCoordination.applyScroll({ strategy });
        yield* ContractTrace.emit({
          event: "scroll.apply",
          level: "semantic",
          payload: { kind: strategy._tag },
        });
      }).pipe(
        Effect.catchCause((cause) =>
          ContractTrace.emit({
            event: "effect.error.ignored",
            level: "semantic",
            payload: {
              owner: "router.outlet",
              operation: "applyScroll",
              cause: Cause.pretty(cause),
            },
          }),
        ),
      );

    // -----------------------------------------------------------------------
    // Scroll ↔ DOM swap synchronization
    //
    // Signal.set(viewSignal, el) triggers a renderer fork (microtask) that
    // renders the new element into an off-DOM fragment, then inserts it via
    // insertBefore. A single rAF is NOT enough — complex pages take many
    // Effect microtask batches to render. We use a Deferred resolved by the
    // SignalElement's onSwap callback (fires after insertBefore) and race it
    // with a rAF fallback for cases where the signal value is unchanged
    // (signal skips → no swap → Deferred never resolves).
    // -----------------------------------------------------------------------

    /** Deferred resolved by onSwap after DOM swap completes. */
    let swapDeferred: Deferred.Deferred<void> | null = null;

    /** Called by the SignalElement renderer after insertBefore. */
    const onSwapEffect: Effect.Effect<void> = Effect.suspend(() => {
      if (swapDeferred !== null) {
        const d = swapDeferred;
        swapDeferred = null;
        return Deferred.succeed(d, void 0).pipe(Effect.asVoid);
      }
      return Effect.void;
    });

    /** rAF fallback for when signal value is unchanged (dedup, same element). */
    const afterFrame: Effect.Effect<void> = Effect.promise(
      () => new Promise((resolve) => requestAnimationFrame(() => resolve())),
    );

    /**
     * Set viewSignal and wait for the DOM swap to complete before returning.
     * Uses Deferred (resolved by onSwap) raced against a rAF fallback.
     */
    const setViewAndAwaitSwap = (element: Element) =>
      Effect.gen(function* () {
        const d = yield* Deferred.make<void>();
        swapDeferred = d;
        yield* Signal.set(viewSignal, element);
        yield* Effect.raceFirst(Deferred.await(d), afterFrame);
      });

    // Pending scroll intent for AsyncLoader path.
    // Set in processRoute, consumed by loader.view subscription after Ready state.
    // loader.track() forks a render fiber and returns immediately — scroll must
    // wait until the Ready state propagates and the DOM has been swapped.
    let pendingScroll: { readonly strategyLayer: Layer.Layer<ScrollStrategy> | undefined } | null =
      null;
    let routeEpoch = 0;

    /**
     * Process a route: match, middleware, boundaries, render, update view.
     * Called for both initial render AND subsequent route changes.
     * Does NOT read router.current via Signal.get (no component re-render).
     */
    // -------------------------------------------------------------------------
    // Sub-effects for processRoute (closures capturing outletEffect scope)
    // -------------------------------------------------------------------------

    /** Resolve component + layouts, stack root-to-leaf, provide service layers. */
    const buildRouteElement = (
      match: RouteMatch,
      decodedParams: Record<string, unknown>,
      decodedQuery: Record<string, unknown>,
      routePath: string,
      options: { readonly deferLazyLeaf: boolean },
    ): Effect.Effect<Element, unknown, never> => {
      const renderLazyLeaf = (
        loader: ComponentLoader,
        routeIdentity: { readonly path: string },
      ): Element =>
        Element.fromEffect(
          Effect.gen(function* () {
            const childSignal = yield* Signal.make<Element>(text(""));

            yield* Effect.forkScoped(
              Effect.gen(function* () {
                yield* ContractTrace.emit({
                  event: "outlet.lazyLeaf.load.start",
                  level: "semantic",
                  payload: { path: routeIdentity.path },
                });
                const component = yield* resolveComponent(loader);
                const leafElement = yield* renderComponent(
                  component,
                  decodedParams,
                  decodedQuery,
                  routeIdentity,
                );
                yield* ContractTrace.emit({
                  event: "outlet.lazyLeaf.load.ready",
                  level: "semantic",
                  payload: { path: routeIdentity.path },
                });
                yield* Signal.set(childSignal, leafElement);
              }).pipe(
                Effect.catchCause((cause) =>
                  Effect.gen(function* () {
                    yield* ContractTrace.emit({
                      event: "outlet.lazyLeaf.load.error",
                      level: "semantic",
                      payload: { path: routeIdentity.path, cause: Cause.pretty(cause) },
                    });
                    yield* Signal.set(
                      childSignal,
                      Element.fail(Cause.squash(cause), {
                        identity: outletLazyLeafIdentity,
                        inputs: { routeIdentity, phase: "error" },
                      }),
                    );
                  }),
                ),
              ),
            );

            return signalElement(childSignal);
          }),
          {
            identity: outletLazyLeafIdentity,
            inputs: { loader, params: decodedParams, query: decodedQuery, routeIdentity },
          },
        );

      const renderBase: Effect.Effect<Element, unknown, never> = Effect.gen(function* () {
        const rawComponent = match.route.definition.component;
        if (rawComponent === undefined) return text("");

        const routeIdentity = { path: routePath };
        const leafElement =
          options.deferLazyLeaf && isComponentLoader(rawComponent)
            ? renderLazyLeaf(rawComponent, routeIdentity)
            : yield* Effect.flatMap(resolveComponent(rawComponent), (component) =>
                renderComponent(component, decodedParams, decodedQuery, routeIdentity),
              );

        const ancestorRawLayouts = Arr.filterMap(match.route.ancestors, (a) =>
          a !== undefined && a.definition.layout !== undefined
            ? Result.succeed(a.definition.layout)
            : Result.failVoid,
        );
        const allRawLayouts =
          match.route.definition.layout !== undefined
            ? [...ancestorRawLayouts, match.route.definition.layout]
            : ancestorRawLayouts;

        const allLayouts = yield* Effect.all(
          allRawLayouts.map((l) => resolveComponent(l)),
          { concurrency: "unbounded" },
        );

        const leafEffect: Effect.Effect<Element, unknown, never> = Effect.succeed(leafElement);
        return yield* Arr.reduceRight(allLayouts, leafEffect, (acc, layout) =>
          Effect.flatMap(acc, (child) =>
            renderLayout(layout, child, decodedParams, decodedQuery, routeIdentity),
          ),
        );
      });

      const allLayers = [
        ...match.route.ancestors.flatMap((a) => (a !== undefined ? a.definition.layers : [])),
        ...match.route.definition.layers,
      ];

      return allLayers.length > 0
        ? Effect.flatMap(unsafeBuildContext<unknown>(allLayers), (services) =>
            Effect.provide(renderBase, services),
          )
        : renderBase;
    };

    /** Wrap render effect with nearest-wins error boundary. */
    const wrapWithErrorBoundary = (
      renderRoute: Effect.Effect<Element, unknown, never>,
      match: RouteMatch,
      routePath: string,
    ): Effect.Effect<Element, unknown, never> =>
      Option.match(boundaries.resolveError(match.route), {
        onNone: () => renderRoute,
        onSome: (errorComp) =>
          Effect.gen(function* () {
            const resolvedErrorComp = yield* resolveComponent(errorComp);
            const routeElement = yield* renderRoute.pipe(
              Effect.catchCause((resolutionCause) =>
                renderError(resolvedErrorComp, resolutionCause, routePath),
              ),
            );
            return Element.ErrorBoundaryElement({
              child: routeElement,
              fallback: (sandboxedCause) =>
                Element.fromEffect(renderError(resolvedErrorComp, sandboxedCause, routePath), {
                  identity: outletErrorBoundaryIdentity,
                  inputs: { errorComponent: resolvedErrorComp, routePath },
                }),
              onError: null,
            });
          }),
      });

    /** Get existing AsyncLoader or create + wire subscription. */
    const getOrCreateAsyncLoader = (loadingComp: ComponentInput) =>
      Effect.gen(function* () {
        const current = yield* Ref.get(asyncLoaderRef);
        if (Option.isSome(current)) return current.value;

        const resolvedLoading = yield* resolveComponent(loadingComp);
        const loadingElement = yield* renderComponent(resolvedLoading, {}, {});
        const loader = yield* AsyncLoader.make(loadingElement, scope);
        yield* Ref.set(asyncLoaderRef, Option.some(loader));

        // Propagate loader.view -> viewSignal. Deferred scroll is consumed only
        // once the loader reaches Ready so loading/refreshing frames do not
        // steal the pending navigation scroll.
        const _unsubLoader = yield* Signal.subscribe(loader.view, () =>
          unsafeEraseR(
            Effect.gen(function* () {
              const state = yield* SubscriptionRef.get(loader.state._ref);
              const val = yield* SubscriptionRef.get(loader.view._ref);
              if (pendingScroll !== null && state._tag === "Ready") {
                const { strategyLayer } = pendingScroll;
                pendingScroll = null;
                yield* setViewAndAwaitSwap(val);
                yield* applyScroll(strategyLayer);
              } else {
                yield* Signal.set(viewSignal, val);
              }
            }),
          ),
        );
        yield* Scope.addFinalizer(scope, _unsubLoader);

        return loader;
      });

    /** Commit rendered element: async loader path or direct set + scroll. */
    const commitView = (
      renderEffect: Effect.Effect<ElementType, unknown, never>,
      match: RouteMatch,
      queryString: string,
      epoch: number,
      routePath: string,
    ) =>
      Effect.gen(function* () {
        const nearestLoadingComp = boundaries.resolveLoading(match.route);

        if (Option.isSome(nearestLoadingComp)) {
          const loader = yield* getOrCreateAsyncLoader(nearestLoadingComp.value);
          const matchKey = buildMatchKey(match, queryString);
          const strategyLayer = resolveScrollStrategy(match.route);
          // Defer scroll across loading/refreshing states. `track` forks the
          // render fiber, so fast loads can already be Ready by the time it
          // returns; handle that window explicitly after track.
          pendingScroll = { strategyLayer };
          yield* loader.track(matchKey, renderEffect, { epoch });
          const currentState = yield* SubscriptionRef.get(loader.state._ref);
          const currentView = yield* SubscriptionRef.get(loader.view._ref);
          if (pendingScroll !== null && currentState._tag === "Ready") {
            pendingScroll = null;
            yield* setViewAndAwaitSwap(currentView);
            yield* ContractTrace.emit({
              event: "outlet.process.commit",
              level: "semantic",
              payload: {
                path: routePath,
                routePattern: match.route.path,
                query: queryString,
                epoch,
              },
            });
            yield* applyScroll(strategyLayer);
          } else {
            yield* Signal.set(viewSignal, currentView);
            yield* ContractTrace.emit({
              event: "outlet.process.commit",
              level: "semantic",
              payload: {
                path: routePath,
                routePattern: match.route.path,
                query: queryString,
                epoch,
                state: currentState._tag,
              },
            });
          }
        } else {
          yield* setViewAndAwaitSwap(yield* renderEffect);
          yield* ContractTrace.emit({
            event: "outlet.process.commit",
            level: "semantic",
            payload: { path: routePath, routePattern: match.route.path, query: queryString, epoch },
          });
          yield* applyScroll(resolveScrollStrategy(match.route));
        }
      });

    // -------------------------------------------------------------------------
    // processRoute — match, middleware, render, commit
    // -------------------------------------------------------------------------

    const processRoute = Effect.gen(function* () {
      // Clear stale scroll intent from prior navigation
      pendingScroll = null;

      const epoch = ++routeEpoch;
      const route = yield* SubscriptionRef.get(router.current._ref);
      yield* ContractTrace.emit({
        event: "outlet.process.start",
        level: "semantic",
        payload: { path: route.path, epoch },
      });
      const matchOption = yield* matcher.match(route.path);

      // 404
      if (Option.isNone(matchOption)) {
        yield* ContractTrace.emit({
          event: "outlet.match.notFound",
          level: "semantic",
          payload: { path: route.path, epoch },
        });
        const notFoundEl = yield* Option.match(boundaries.resolveNotFoundRoot(), {
          onNone: () => Effect.succeed(text("404 - Not Found")),
          onSome: (comp) =>
            Effect.flatMap(resolveComponent(comp), (resolved) => renderComponent(resolved, {}, {})),
        });
        yield* setViewAndAwaitSwap(notFoundEl);
        yield* applyScroll(undefined);
        return;
      }

      const match = matchOption.value;
      yield* ContractTrace.emit({
        event: "outlet.match.found",
        level: "semantic",
        payload: { path: route.path, routePattern: match.route.path, epoch },
      });

      // Middleware
      const middlewareResult = yield* runRouteMiddleware(match.route);

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
        yield* setViewAndAwaitSwap(el);
        yield* applyScroll(resolveScrollStrategy(match.route));
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
        yield* setViewAndAwaitSwap(el);
        yield* applyScroll(resolveScrollStrategy(match.route));
        return;
      }

      // Decode params + query (strict: schema failures route to error boundary)
      const decodedParamsResult = yield* decodeRouteParams(match.route, match.params).pipe(
        Effect.result,
      );
      if (Result.isFailure(decodedParamsResult)) {
        const el = yield* Option.match(boundaries.resolveError(match.route), {
          onNone: () =>
            Debug.log({
              event: "router.outlet.error",
              phase: "decode_params",
              path: route.path,
              error: decodedParamsResult.failure,
            }).pipe(Effect.as(text("Error"))),
          onSome: (comp) =>
            Effect.flatMap(resolveComponent(comp), (resolved) =>
              renderError(resolved, Cause.fail(decodedParamsResult.failure), route.path),
            ),
        });
        yield* setViewAndAwaitSwap(el);
        yield* applyScroll(resolveScrollStrategy(match.route));
        return;
      }

      const queryString = route.query.toString();
      const decodedQueryResult = yield* decodeRouteQuery(match.route, route.query).pipe(
        Effect.result,
      );
      if (Result.isFailure(decodedQueryResult)) {
        const el = yield* Option.match(boundaries.resolveError(match.route), {
          onNone: () =>
            Debug.log({
              event: "router.outlet.error",
              phase: "decode_query",
              path: route.path,
              error: decodedQueryResult.failure,
            }).pipe(Effect.as(text("Error"))),
          onSome: (comp) =>
            Effect.flatMap(resolveComponent(comp), (resolved) =>
              renderError(resolved, Cause.fail(decodedQueryResult.failure), route.path),
            ),
        });
        yield* setViewAndAwaitSwap(el);
        yield* applyScroll(resolveScrollStrategy(match.route));
        return;
      }

      const decodedParams = decodedParamsResult.success;
      const decodedQuery = decodedQueryResult.success;

      // Build → wrap → commit
      const hasLoadingBoundary = Option.isSome(boundaries.resolveLoading(match.route));
      const routeElement = buildRouteElement(match, decodedParams, decodedQuery, route.path, {
        deferLazyLeaf: !hasLoadingBoundary,
      });
      const withError = wrapWithErrorBoundary(routeElement, match, route.path);
      yield* commitView(withError, match, queryString, epoch, route.path);
    }).pipe(
      Effect.catchCause((cause) =>
        Effect.gen(function* () {
          const currentRoute = yield* SubscriptionRef.get(router.current._ref);
          yield* ContractTrace.emit({
            event: "effect.error.ignored",
            level: "semantic",
            payload: {
              owner: "router.outlet",
              operation: "processRoute",
              path: currentRoute.path,
              cause: Cause.pretty(cause),
            },
          });
          yield* Debug.log({
            event: "router.outlet.error",
            phase: "process_route",
            path: currentRoute.path,
            error: Cause.pretty(cause),
          });
        }),
      ),
    );

    // Process the initial route
    yield* processRoute;

    // Subscribe to route changes — calls processRoute reactively.
    // Does NOT cause component re-render (subscription, not Signal.get).
    // Router signal outlives the outlet — must unsubscribe on scope close.
    const unsubRouter = yield* Signal.subscribe(router.current, () => unsafeEraseR(processRoute));
    yield* Scope.addFinalizer(scope, unsubRouter);

    return signalElement(viewSignal, { onSwap: onSwapEffect });
  });

  return Element.fromEffect(outletEffect, { identity: outletRuntimeIdentity, inputs: props });
});
