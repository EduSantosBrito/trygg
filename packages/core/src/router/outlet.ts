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
  Context,
  Deferred,
  Effect,
  Layer,
  Option,
  Ref,
  Result,
  Schema,
  Scope,
  Semaphore,
} from "effect";
import * as Trace from "../trace/index.js";
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
import { get as getRouter, CurrentRouter, takeCurrentOutletChild } from "./service.js";
import { runPrefetch } from "./prefetch.js";
import { parsePath } from "./utils.js";
import {
  RoutePathSegment,
  compileRoutePathPattern,
  compareCompiledRoutePathPatterns,
  type CompiledRoutePathPattern,
  type InvalidRoutePathPattern,
} from "./path-pattern.js";
import {
  AsyncLoadState,
  AsyncLoader,
  BoundaryResolver,
  renderComponent,
  renderError,
  renderLayout,
  renderLayoutReactive,
  routeRenderIdentity,
  routeRenderKey,
  type AsyncLoaderShape,
  type BoundaryResolverShape,
  type RouteRenderIdentity,
} from "./outlet-services.js";
import { RenderLoadError } from "./render-strategy.js";
import {
  RouteActivationOutcome,
  RouteActivationRenderIntent,
  makeRouteActivation,
  makeRouteActivationBoundary,
} from "./route-activation.js";
import type { RouteActivationRequest } from "./route-activation.js";
import { ScrollStrategy } from "./scroll-strategy.js";
import {
  type ComponentInput,
  type ComponentLoader,
  type RouteComponent,
  type RouteParams,
} from "./types.js";
import { getFiberRef } from "../internal/fiber-ref.js";
import { unsafeEraseR } from "../internal/unsafe.js";

const outletRuntimeIdentity = Symbol("trygg/router/Outlet.runtime");
const outletErrorBoundaryIdentity = Symbol("trygg/router/Outlet.error-boundary");
const outletLazyLeafIdentity = Symbol("trygg/router/Outlet.lazy-leaf");

// =============================================================================
// Trie-Based Matching
// =============================================================================

/** @internal */
interface CompiledRoute {
  readonly resolved: ResolvedRoute;
  readonly pattern: CompiledRoutePathPattern;
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
const createTrieNode = (): TrieNode => ({
  staticChildren: new Map(),
  paramChild: undefined,
  wildcardChild: undefined,
  routes: [],
});

/** @internal */
const segmentName = (
  segment: Extract<RoutePathSegment, { readonly _tag: "Param" | "Wildcard" | "CatchAllRequired" }>,
): string => segment.name;

/** @internal */
const insertIntoTrie = (root: TrieNode, route: CompiledRoute): void => {
  let current = root;

  for (const segment of route.pattern.segments) {
    if (RoutePathSegment.$is("Static")(segment)) {
      let child = current.staticChildren.get(segment.value);
      if (child === undefined) {
        child = createTrieNode();
        current.staticChildren.set(segment.value, child);
      }
      current = child;
    } else if (RoutePathSegment.$is("Param")(segment)) {
      if (current.paramChild === undefined) {
        current.paramChild = { node: createTrieNode(), name: segmentName(segment) };
      }
      current = current.paramChild.node;
    } else if (
      RoutePathSegment.$is("Wildcard")(segment) ||
      RoutePathSegment.$is("CatchAllRequired")(segment)
    ) {
      if (current.wildcardChild === undefined) {
        current.wildcardChild = { node: createTrieNode(), name: segmentName(segment) };
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
      const lastSegment = route.pattern.segments[route.pattern.segments.length - 1];
      if (
        (lastSegment === undefined ||
          (!RoutePathSegment.$is("Wildcard")(lastSegment) &&
            !RoutePathSegment.$is("CatchAllRequired")(lastSegment))) &&
        route.pattern.segments.length === pathIndex
      ) {
        results.push({ route, params: { ...params } });
      }
    }
    if (node.wildcardChild !== undefined) {
      const newParams = { ...params, [node.wildcardChild.name]: "" };
      for (const route of node.wildcardChild.node.routes) {
        const lastSeg = route.pattern.segments[route.pattern.segments.length - 1];
        if (lastSeg !== undefined && RoutePathSegment.$is("Wildcard")(lastSeg)) {
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
      const lastSeg = route.pattern.segments[route.pattern.segments.length - 1];
      if (
        lastSeg === undefined ||
        !RoutePathSegment.$is("CatchAllRequired")(lastSeg) ||
        rest !== ""
      ) {
        results.push({ route, params: { ...newParams } });
      }
    }
  }

  return results;
};

/** @internal */
export const buildTrieMatcher: (
  resolved: ReadonlyArray<ResolvedRoute>,
) => Effect.Effect<(path: string) => Option.Option<RouteMatch>, InvalidRoutePathPattern> =
  Effect.fn("Outlet.buildTrieMatcher")(function* (resolved: ReadonlyArray<ResolvedRoute>) {
    const compiled = yield* Effect.forEach(resolved, (route) =>
      Effect.map(
        compileRoutePathPattern(route.path),
        (pattern): CompiledRoute => ({
          resolved: route,
          pattern,
        }),
      ),
    );

    const sorted = [...compiled].sort((a, b) =>
      compareCompiledRoutePathPatterns(a.pattern, b.pattern),
    );

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

      const sortedMatches = [...matches].sort((a, b) =>
        compareCompiledRoutePathPatterns(a.route.pattern, b.route.pattern),
      );

      const best = sortedMatches[0];
      if (best === undefined) return Option.none();

      return Option.some({ route: best.route.resolved, params: best.params });
    };
  });

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
const isRouteComponent = (u: unknown): u is RouteComponent =>
  Component.isEffectComponent(u) || Effect.isEffect(u);

const RouteComponentSchema = Schema.declare<RouteComponent>(isRouteComponent, {
  identifier: "RouteComponent",
});

const LoadedRouteComponentSchema = Schema.Union([
  RouteComponentSchema,
  Schema.Struct({ default: RouteComponentSchema }),
]);

const decodeRouteComponent = Schema.decodeUnknownEffect(RouteComponentSchema);
const decodeLoadedRouteComponentInput = Schema.decodeUnknownEffect(LoadedRouteComponentSchema);

const decodeLoadedRouteComponent = (
  loaded: unknown,
): Effect.Effect<RouteComponent, unknown, never> =>
  unsafeEraseR(decodeLoadedRouteComponentInput(loaded)).pipe(
    Effect.map((decoded) => (isRouteComponent(decoded) ? decoded : decoded.default)),
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
        yield* Trace.emit("router.prefetch.no_match", () => ({
          path,
        }));
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
                  catch: (cause) => new RenderLoadError({ cause }),
                }).pipe(
                  Effect.catchTag("RenderLoadError", (error) =>
                    Trace.emit("router.prefetch.error", () => ({
                      path,
                      phase: "load_module",
                      error_message: String(error.cause),
                    })),
                  ),
                ),
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
      yield* Trace.emit("router.prefetch.complete", () => ({
        path,
      }));
    }).pipe(
      Effect.catchCause((cause) =>
        Trace.emit("router.prefetch.error", () => ({
          path,
          phase: "resolver",
          error_message: String(Cause.squash(cause)),
        })),
      ),
    );

/**
 * Resolve a route component — handles both direct references and loader functions.
 * - Direct component (Component.gen or Effect): returns as-is
 * - Loader function (from vite transform): invokes loader via Effect.tryPromise
 *
 * At build time, the vite plugin transforms default imports to module loaders
 * and named imports to direct component loaders. This function detects the
 * loader and invokes it, or passes through direct components.
 *
 * @internal
 */
const resolveComponent = (
  component: ComponentInput,
): Effect.Effect<RouteComponent, RenderLoadError, never> => {
  if (isComponentLoader(component)) {
    return Effect.tryPromise({
      try: () => component(),
      catch: (cause) => new RenderLoadError({ cause }),
    }).pipe(
      Effect.flatMap((loaded) =>
        decodeLoadedRouteComponent(loaded).pipe(
          Effect.mapError((parseError) => new RenderLoadError({ cause: parseError })),
        ),
      ),
    );
  }
  // Direct component (Component.gen result or Effect<Element>)
  return unsafeEraseR(decodeRouteComponent(component)).pipe(
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

  /** Route context identity for layout preservation. */
  const buildRouteContextKey = (match: RouteMatch, queryString: string): string => {
    const params = Object.keys(match.params)
      .sort()
      .map((key) => `${encodeURIComponent(key)}=${encodeURIComponent(match.params[key] ?? "")}`)
      .join("&");
    return queryString === ""
      ? `${match.route.path}|${params}`
      : `${match.route.path}|${params}?${queryString}`;
  };

  // Main outlet effect
  const outletEffect = Effect.gen(function* () {
    // Instance-scoped state (persists across re-renders of this outlet)
    const cachedMatcherRef = yield* Ref.make<Option.Option<RouteMatcherShape>>(Option.none());
    const cachedManifestRef = yield* Ref.make<Option.Option<RoutesManifest>>(Option.none());
    type AsyncLoaderSlot = {
      readonly loadingComp: ComponentInput;
      readonly loader: AsyncLoaderShape;
    };
    const asyncLoaderRef = yield* Ref.make<Option.Option<AsyncLoaderSlot>>(Option.none());
    // Nested outlet check: if there's child content, render it
    const childContent = yield* takeCurrentOutletChild();
    if (Option.isSome(childContent)) {
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
      const matchFn = yield* buildTrieMatcher(resolved);
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
    const routeActivation = yield* makeRouteActivation(matcher);
    const boundaries: BoundaryResolverShape = BoundaryResolver.make(manifest);
    const routeActivationBoundary = yield* makeRouteActivationBoundary(
      { interruptStaleLoads: true },
      {
        matcher,
        collectPrefetchTargets,
        isComponentLoader: (component) => isComponentLoader(component),
        loadComponent: (component) => resolveComponent(component),
        runRoutePrefetch: (_path, match, query) =>
          Effect.gen(function* () {
            const prefetchFns = match.route.definition.prefetch;
            if (prefetchFns.length === 0) return;
            const decodedParamsResult = yield* decodeRouteParams(match.route, match.params).pipe(
              Effect.result,
            );
            if (Result.isFailure(decodedParamsResult)) return;
            const decodedQueryResult = yield* decodeRouteQuery(match.route, query).pipe(
              Effect.result,
            );
            if (Result.isFailure(decodedQueryResult)) return;
            yield* runPrefetch(prefetchFns, {
              params: decodedParamsResult.success,
              query: decodedQueryResult.success,
            });
          }),
        resolveLoading: (match) => boundaries.resolveLoading(match.route),
        resolveError: (match) => boundaries.resolveError(match.route),
        resolveNotFound: () => boundaries.resolveNotFoundRoot(),
        resolveForbidden: (match) => boundaries.resolveForbidden(match.route),
        runMiddleware: (match) => runRouteMiddleware(match.route),
        isStale: (activationId) =>
          Effect.gen(function* () {
            const current = yield* routeActivation.currentActivationId;
            return Option.isSome(current) && current.value !== activationId;
          }),
      },
    );

    const router = yield* getRouter;
    const currentRouteRenderKey = Effect.sync(() => {
      const current = router.current._cell.value;
      return routeRenderKey(current.path, current.query);
    });

    // Context fragment carrying CurrentRouter for this outlet's router service.
    // Threaded into every route/layout render (renderComponent/renderLayout) so
    // the route staleness gate reads the live router.current on each child's
    // render AND re-render fiber — see mergeRouterContext in outlet-services.
    // Render fibers fork from a structurally-captured context, so setting this on
    // the outlet's own fiber would not reach them; the Provide boundary that each
    // route/layout element already is IS the channel that does.
    const routerContext = Context.add(Context.empty(), CurrentRouter, Option.some(router));

    // Register prefetch resolver so router.prefetch() can warm lazy modules
    if (Option.isSome(yield* Ref.get(cachedMatcherRef))) {
      yield* router.outletCoordination.activatePrefetch(routeActivationBoundary.prefetch);
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
        return yield* router.outletCoordination.applyScroll({ strategy });
      }).pipe(
        Effect.catchCause((cause) =>
          Trace.emit("effect.error.ignored", () => ({
            owner: "router.outlet",
            operation: "applyScroll",
            cause: Cause.pretty(cause),
          })),
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

    // -----------------------------------------------------------------------
    // Per-swap-target swap completion.
    //
    // Each driven SignalElement — the root viewSignal AND every persistent
    // layout frame's childSignal (see frameStack below) — needs its OWN
    // completion Deferred: setting a deep frame's childSignal fires THAT
    // SignalElement's onSwap, not the root's. A single shared Deferred would
    // let scroll fire before the real DOM commit under throttle. Each target
    // owns a SwapSlot; its SignalElement is wired with makeOnSwap(slot).
    // -----------------------------------------------------------------------

    type SwapSlot = { deferred: Deferred.Deferred<void> | null };

    /** Build an onSwap callback bound to a specific target's slot. */
    const makeOnSwap = (slot: SwapSlot): Effect.Effect<void> =>
      Effect.suspend(() => {
        if (slot.deferred !== null) {
          const d = slot.deferred;
          slot.deferred = null;
          return Deferred.succeed(d, undefined).pipe(Effect.asVoid);
        }
        return Effect.void;
      });

    /** rAF fallback for when signal value is unchanged (dedup, same element). */
    const afterFrame: Effect.Effect<void> = Effect.promise(
      () => new Promise((resolve) => requestAnimationFrame(() => resolve())),
    );

    /**
     * Set a target signal and wait for ITS DOM swap to complete before
     * returning. Uses the target's per-slot Deferred (resolved by its onSwap)
     * raced against a rAF fallback (no-swap dedup case).
     */
    const setSlotSignalAndAwaitSwap = Effect.fnUntraced(function* (
      slot: SwapSlot,
      signal: Signal.Signal<Element>,
      element: Element,
    ) {
      const d = yield* Deferred.make<void>();
      slot.deferred = d;
      yield* Signal.set(signal, element);
      yield* Effect.raceFirst(Deferred.await(d), afterFrame);
    });

    /** Root view target (the outlet's top-level SignalElement). */
    const rootSlot: SwapSlot = { deferred: null };
    const onRootSwap = makeOnSwap(rootSlot);

    /** Set the root viewSignal and await its swap. Used by every non-layout-preserving path. */
    const setViewAndAwaitSwap = (element: Element): Effect.Effect<void> =>
      setSlotSignalAndAwaitSwap(rootSlot, viewSignal, element);

    // -----------------------------------------------------------------------
    // Persistent layout frames (layout-preservation).
    //
    // Each frame is one layout level kept mounted across sibling navigations
    // while its decoded route context is unchanged. A frame's childSignal drives
    // the SignalElement that the layout's nested <Outlet/> resolves to. On a
    // same-context sibling nav only the DEEPEST frame's childSignal is updated
    // with the new leaf — the layout DOM (header/sidebar/rail) stays mounted.
    // Mutated only under frameLock.
    // -----------------------------------------------------------------------

    type LayoutFrame = {
      readonly rawLayout: ComponentInput;
      readonly routeContextKey: string;
      readonly childSignal: Signal.Signal<Element>;
      readonly slot: SwapSlot;
    };
    let frameStack: ReadonlyArray<LayoutFrame> = [];
    const frameLock = Semaphore.makeUnsafe(1);

    // Pending scroll intent for AsyncLoader path.
    // Set in processRoute, consumed by loader.view subscription after Ready state.
    // loader.track() forks a render fiber and returns immediately — scroll must
    // wait until the Ready state propagates and the DOM has been swapped.
    let pendingScroll: {
      readonly activationId: string;
      readonly routePath: string;
      readonly strategyLayer: Layer.Layer<ScrollStrategy> | undefined;
    } | null = null;
    let routeEpoch = 0;

    const nextActivationId = () => `route-${++routeEpoch}`;

    /**
     * Process a route: match, middleware, boundaries, render, update view.
     * Called for both initial render AND subsequent route changes.
     * Does NOT read router.current via Signal.get (no component re-render).
     */
    // -------------------------------------------------------------------------
    // Sub-effects for processRoute (closures capturing outletEffect scope)
    // -------------------------------------------------------------------------

    /** Render a deferred (lazy) leaf component as a self-driving SignalElement. */
    const renderLazyLeaf = (
      loader: ComponentLoader,
      routeIdentity: RouteRenderIdentity,
      decodedParams: Record<string, unknown>,
      decodedQuery: Record<string, unknown>,
      request: RouteActivationRequest,
    ): Element =>
      Element.fromEffect(
        Effect.gen(function* () {
          const childSignal = yield* Signal.make<Element>(text(""));

          yield* Effect.forkScoped(
            Effect.gen(function* () {
              const component = yield* routeActivationBoundary.loadComponent(request, loader);
              const leafElement = yield* renderComponent(
                component,
                decodedParams,
                decodedQuery,
                routeIdentity,
                routerContext,
              );
              yield* Signal.set(childSignal, leafElement);
            }).pipe(
              Effect.catchCause((cause) =>
                Signal.set(
                  childSignal,
                  Element.fail(Cause.squash(cause), {
                    identity: outletLazyLeafIdentity,
                    inputs: { routeIdentity, phase: "error" },
                  }),
                ),
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

    /** Build the route's leaf element (component only — no layout wrapping). */
    const buildLeaf = Effect.fnUntraced(function* (
      match: RouteMatch,
      decodedParams: Record<string, unknown>,
      decodedQuery: Record<string, unknown>,
      routePath: string,
      options: { readonly deferLazyLeaf: boolean; readonly request: RouteActivationRequest },
    ) {
      const rawComponent = match.route.definition.component;
      if (rawComponent === undefined) return text("");
      const routeIdentity = routeRenderIdentity(
        routePath,
        options.request.query,
        currentRouteRenderKey,
      );
      return options.deferLazyLeaf && isComponentLoader(rawComponent)
        ? renderLazyLeaf(rawComponent, routeIdentity, decodedParams, decodedQuery, options.request)
        : yield* Effect.flatMap(resolveComponent(rawComponent), (component) =>
            renderComponent(component, decodedParams, decodedQuery, routeIdentity, routerContext),
          );
    });

    /** Raw (unresolved) layout chain for a match, outermost → innermost. */
    const computeRawLayouts = (match: RouteMatch): ReadonlyArray<ComponentInput> => {
      const ancestorRawLayouts = Arr.filterMap(match.route.ancestors, (a) =>
        a !== undefined && a.definition.layout !== undefined
          ? Result.succeed(a.definition.layout)
          : Result.failVoid,
      );
      return match.route.definition.layout !== undefined
        ? [...ancestorRawLayouts, match.route.definition.layout]
        : ancestorRawLayouts;
    };

    /** Resolve component + layouts and stack root-to-leaf (boundary path). */
    const buildRouteElement = Effect.fnUntraced(function* (
      match: RouteMatch,
      decodedParams: Record<string, unknown>,
      decodedQuery: Record<string, unknown>,
      routePath: string,
      options: { readonly deferLazyLeaf: boolean; readonly request: RouteActivationRequest },
    ) {
      if (match.route.definition.component === undefined) return text("");

      const routeIdentity = routeRenderIdentity(
        routePath,
        options.request.query,
        currentRouteRenderKey,
      );
      const leafElement = yield* buildLeaf(match, decodedParams, decodedQuery, routePath, options);

      const allLayouts = yield* Effect.all(
        computeRawLayouts(match).map((l) => resolveComponent(l)),
        { concurrency: "unbounded" },
      );

      const leafEffect: Effect.Effect<Element, unknown, never> = Effect.succeed(leafElement);
      return yield* Arr.reduceRight(allLayouts, leafEffect, (acc, layout) =>
        Effect.flatMap(acc, (child) =>
          renderLayout(layout, child, decodedParams, decodedQuery, routeIdentity, routerContext),
        ),
      );
    });

    /**
     * Layout-preserving commit (no loading/error boundary on this route).
     *
     * Diffs the route's raw layout chain against the mounted frameStack by raw
     * reference (longest common prefix). Reused frames stay mounted; only the
     * divergent suffix is rebuilt and its deepest child region swaps. The leaf
     * is always rebuilt with the new params and driven into the deepest frame.
     * Caller MUST hold frameLock.
     */
    const commitWithLayoutPreservation = Effect.fnUntraced(function* (
      match: RouteMatch,
      decodedParams: Record<string, unknown>,
      decodedQuery: Record<string, unknown>,
      routePath: string,
      activationId: string,
      request: RouteActivationRequest,
    ) {
      const scrollStrategy = resolveScrollStrategy(match.route);

      // No component: mirror buildRouteElement's early text("") and drop frames.
      if (match.route.definition.component === undefined) {
        frameStack = [];
        yield* routeActivation.commitAfterDomSwap(
          { activationId, path: routePath },
          setViewAndAwaitSwap(text("")),
          applyScroll(scrollStrategy),
        );
        return;
      }

      const allRawLayouts = computeRawLayouts(match);
      const routeContextKey = buildRouteContextKey(match, request.query.toString());

      // Without an error boundary, lazy leaves must render as self-loading
      // components so loader failures stay contained inside the route view
      // instead of failing the outlet process. Routes with an error boundary use
      // the boundary path below, where the loader is awaited so errors render
      // through that boundary.
      const leaf = yield* buildLeaf(match, decodedParams, decodedQuery, routePath, {
        deferLazyLeaf: true,
        request,
      });

      // Longest common prefix of the layout chain by raw reference.
      let common = 0;
      while (common < frameStack.length && common < allRawLayouts.length) {
        const frame = frameStack[common];
        if (
          frame === undefined ||
          frame.rawLayout !== allRawLayouts[common] ||
          frame.routeContextKey !== routeContextKey
        ) {
          break;
        }
        common++;
      }

      // Case A: entire layout chain reused → swap only the deepest child.
      const deepest =
        allRawLayouts.length > 0 && common === allRawLayouts.length && common === frameStack.length
          ? frameStack[frameStack.length - 1]
          : undefined;
      if (deepest !== undefined) {
        yield* routeActivation.commitAfterDomSwap(
          { activationId, path: routePath },
          setSlotSignalAndAwaitSwap(deepest.slot, deepest.childSignal, leaf),
          applyScroll(scrollStrategy),
        );
        return;
      }

      // Case B: rebuild the divergent suffix (layers common..end), innermost
      // wrapping the leaf. Frames 0..common-1 stay mounted and untouched.
      const reused = frameStack.slice(0, common);
      const suffix = allRawLayouts.slice(common);
      const newFrames: Array<LayoutFrame> = [];
      let child: Element = leaf;
      for (const rawLayout of suffix.slice().reverse()) {
        const layout = yield* resolveComponent(rawLayout);
        const childSignal = yield* Signal.make<Element>(text(""));
        const slot: SwapSlot = { deferred: null };
        const layoutEl = yield* renderLayoutReactive(
          layout,
          signalElement(childSignal, { onSwap: makeOnSwap(slot) }),
          decodedParams,
          decodedQuery,
          routeContextKey,
        );
        // Seed BEFORE mount: the SignalElement's initial render reads this
        // value (peek); a fresh, unmounted frame fires no swap to await.
        yield* Signal.set(childSignal, child);
        newFrames.unshift({ rawLayout, routeContextKey, childSignal, slot });
        child = layoutEl;
      }
      frameStack = [...reused, ...newFrames];

      // Attach point: the deepest reused frame's child slot, or the root view
      // when no outer frame was reused (`child` is then the whole tree).
      const parent = common > 0 ? reused[common - 1] : undefined;
      if (parent === undefined) {
        yield* routeActivation.commitAfterDomSwap(
          { activationId, path: routePath },
          setSlotSignalAndAwaitSwap(rootSlot, viewSignal, child),
          applyScroll(scrollStrategy),
        );
      } else {
        yield* routeActivation.commitAfterDomSwap(
          { activationId, path: routePath },
          setSlotSignalAndAwaitSwap(parent.slot, parent.childSignal, child),
          applyScroll(scrollStrategy),
        );
      }
    });

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
    const getOrCreateAsyncLoader: (
      loadingComp: ComponentInput,
    ) => Effect.Effect<AsyncLoaderShape, unknown, never> = Effect.fn(
      "Outlet.getOrCreateAsyncLoader",
    )(function* (loadingComp: ComponentInput) {
      const current = yield* Ref.get(asyncLoaderRef);
      if (Option.isSome(current) && current.value.loadingComp === loadingComp) {
        return current.value.loader;
      }

      const resolvedLoading = yield* resolveComponent(loadingComp);
      const loadingElement = yield* renderComponent(resolvedLoading, {}, {});
      const loader = yield* AsyncLoader.make(loadingElement, scope);
      const slot: AsyncLoaderSlot = { loadingComp, loader };
      yield* Ref.set(asyncLoaderRef, Option.some(slot));

      // Propagate loader.view -> viewSignal. Deferred scroll is consumed only
      // once the loader reaches Ready so loading/refreshing frames do not
      // steal the pending navigation scroll.
      const _unsubLoader = yield* Signal.subscribe(loader.view, () =>
        unsafeEraseR(
          Effect.gen(function* () {
            const activeSlot = yield* Ref.get(asyncLoaderRef);
            if (Option.isNone(activeSlot) || activeSlot.value.loader !== loader) return;
            const state = loader.state._cell.value;
            const val = loader.view._cell.value;
            if (pendingScroll !== null && AsyncLoadState.$is("Ready")(state)) {
              const { activationId, routePath, strategyLayer } = pendingScroll;
              pendingScroll = null;
              yield* routeActivation.commitAfterDomSwap(
                { activationId, path: routePath },
                setViewAndAwaitSwap(val),
                applyScroll(strategyLayer),
              );
            } else if (pendingScroll !== null) {
              yield* routeActivation.showLoadingFallback(
                { activationId: pendingScroll.activationId, path: pendingScroll.routePath },
                Signal.set(viewSignal, val),
              );
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
    const commitView: (
      renderEffect: Effect.Effect<ElementType, unknown, never>,
      match: RouteMatch,
      queryString: string,
      epoch: number,
      activationId: string,
      routePath: string,
    ) => Effect.Effect<void, unknown, never> = Effect.fn("Outlet.commitView")(function* (
      renderEffect: Effect.Effect<ElementType, unknown, never>,
      match: RouteMatch,
      queryString: string,
      epoch: number,
      activationId: string,
      routePath: string,
    ) {
      const nearestLoadingComp = boundaries.resolveLoading(match.route);

      if (Option.isSome(nearestLoadingComp)) {
        const loader = yield* getOrCreateAsyncLoader(nearestLoadingComp.value);
        const matchKey = buildMatchKey(match, queryString);
        const strategyLayer = resolveScrollStrategy(match.route);
        // Defer scroll across loading/refreshing states. `track` forks the
        // render fiber, so fast loads can already be Ready by the time it
        // returns; handle that window explicitly after track.
        pendingScroll = { activationId, routePath, strategyLayer };
        yield* loader.track(matchKey, renderEffect, { epoch });
        const currentState = loader.state._cell.value;
        const currentView = loader.view._cell.value;
        if (pendingScroll !== null && AsyncLoadState.$is("Ready")(currentState)) {
          pendingScroll = null;
          yield* routeActivation.commitAfterDomSwap(
            { activationId, path: routePath },
            setViewAndAwaitSwap(currentView),
            applyScroll(strategyLayer),
          );
        } else {
          yield* routeActivation.showLoadingFallback(
            { activationId, path: routePath },
            Signal.set(viewSignal, currentView),
          );
        }
      } else {
        const rendered = yield* renderEffect;
        yield* routeActivation.commitAfterDomSwap(
          { activationId, path: routePath },
          setViewAndAwaitSwap(rendered),
          applyScroll(resolveScrollStrategy(match.route)),
        );
      }
    });

    // -------------------------------------------------------------------------
    // processRoute — match, middleware, render, commit
    // -------------------------------------------------------------------------

    const processRoute = Effect.gen(function* () {
      // Clear stale scroll intent from prior navigation
      pendingScroll = null;

      const activationId = nextActivationId();
      const epoch = routeEpoch;
      const route = router.current._cell.value;
      const activationRequest: RouteActivationRequest = {
        activationId,
        path: route.path,
        query: route.query,
        scrollIntent: Option.none(),
      };
      const activationOutcome = yield* routeActivation.activate(activationRequest);
      const matchOption =
        RouteActivationOutcome.$is("Committed")(activationOutcome) &&
        Option.isSome(activationOutcome.match)
          ? activationOutcome.match
          : RouteActivationOutcome.$is("NotFound")(activationOutcome)
            ? Option.none()
            : yield* matcher.match(route.path);

      // 404
      if (Option.isNone(matchOption)) {
        const notFoundIntent =
          yield* routeActivationBoundary.resolveNotFoundBoundary(activationRequest);
        const notFoundEl = RouteActivationRenderIntent.$is("NotFoundBoundary")(notFoundIntent)
          ? yield* Effect.flatMap(resolveComponent(notFoundIntent.component), (resolved) =>
              renderComponent(resolved, {}, {}),
            )
          : text("404 - Not Found");
        yield* routeActivation.commitAfterDomSwap(
          { activationId, path: route.path },
          setViewAndAwaitSwap(notFoundEl),
          applyScroll(undefined),
        );
        return;
      }

      const match = matchOption.value;
      // Middleware
      const middlewareIntent = yield* routeActivationBoundary.resolveMiddleware(
        activationRequest,
        match,
      );

      if (RouteActivationRenderIntent.$is("Redirect")(middlewareIntent)) {
        yield* router.navigate(
          middlewareIntent.location,
          middlewareIntent.replace !== undefined ? { replace: middlewareIntent.replace } : {},
        );
        return;
      }
      if (RouteActivationRenderIntent.$is("ForbiddenBoundary")(middlewareIntent)) {
        const el = yield* Effect.flatMap(resolveComponent(middlewareIntent.component), (resolved) =>
          renderComponent(resolved, {}, {}),
        );
        yield* routeActivation.commitAfterDomSwap(
          { activationId, path: route.path },
          setViewAndAwaitSwap(el),
          applyScroll(resolveScrollStrategy(match.route)),
        );
        return;
      }
      if (RouteActivationRenderIntent.$is("ErrorBoundary")(middlewareIntent)) {
        const el = yield* Effect.flatMap(resolveComponent(middlewareIntent.component), (resolved) =>
          renderError(resolved, Cause.fail(middlewareIntent.cause), route.path),
        );
        yield* routeActivation.commitAfterDomSwap(
          { activationId, path: route.path },
          setViewAndAwaitSwap(el),
          applyScroll(resolveScrollStrategy(match.route)),
        );
        return;
      }
      if (RouteActivationRenderIntent.$is("NoBoundary")(middlewareIntent)) {
        const el = text(middlewareIntent.cause === "forbidden" ? "403 - Forbidden" : "Error");
        yield* routeActivation.commitAfterDomSwap(
          { activationId, path: route.path },
          setViewAndAwaitSwap(el),
          applyScroll(resolveScrollStrategy(match.route)),
        );
        return;
      }

      // Decode params + query (strict: schema failures route to error boundary)
      const decodedParamsResult = yield* decodeRouteParams(match.route, match.params).pipe(
        Effect.result,
      );
      if (Result.isFailure(decodedParamsResult)) {
        const errorIntent = yield* routeActivationBoundary.resolveErrorBoundary(
          activationRequest,
          match,
          decodedParamsResult.failure,
        );
        const el = RouteActivationRenderIntent.$is("ErrorBoundary")(errorIntent)
          ? yield* Effect.flatMap(resolveComponent(errorIntent.component), (resolved) =>
              renderError(resolved, Cause.fail(decodedParamsResult.failure), route.path),
            )
          : yield* Trace.emit("router.outlet.error", () => ({
              phase: "decode_params",
              path: route.path,
              error: decodedParamsResult.failure,
            })).pipe(Effect.as(text("Error")));
        yield* routeActivation.commitAfterDomSwap(
          { activationId, path: route.path },
          setViewAndAwaitSwap(el),
          applyScroll(resolveScrollStrategy(match.route)),
        );
        return;
      }

      const queryString = route.query.toString();
      const decodedQueryResult = yield* decodeRouteQuery(match.route, route.query).pipe(
        Effect.result,
      );
      if (Result.isFailure(decodedQueryResult)) {
        const errorIntent = yield* routeActivationBoundary.resolveErrorBoundary(
          activationRequest,
          match,
          decodedQueryResult.failure,
        );
        const el = RouteActivationRenderIntent.$is("ErrorBoundary")(errorIntent)
          ? yield* Effect.flatMap(resolveComponent(errorIntent.component), (resolved) =>
              renderError(resolved, Cause.fail(decodedQueryResult.failure), route.path),
            )
          : yield* Trace.emit("router.outlet.error", () => ({
              phase: "decode_query",
              path: route.path,
              error: decodedQueryResult.failure,
            })).pipe(Effect.as(text("Error")));
        yield* routeActivation.commitAfterDomSwap(
          { activationId, path: route.path },
          setViewAndAwaitSwap(el),
          applyScroll(resolveScrollStrategy(match.route)),
        );
        return;
      }

      const decodedParams = decodedParamsResult.success;
      const decodedQuery = decodedQueryResult.success;

      // Build → wrap → commit
      const hasLoadingBoundary = Option.isSome(boundaries.resolveLoading(match.route));
      const hasErrorBoundary = Option.isSome(boundaries.resolveError(match.route));
      const request: RouteActivationRequest = {
        activationId,
        path: route.path,
        query: route.query,
        scrollIntent: Option.none(),
      };

      // Layout-preserving path: only when neither a loading nor an error
      // boundary applies. Reuses mounted layout frames and swaps just the
      // changed region. Serialized via frameLock so concurrent navigations
      // cannot corrupt the shared frame stack.
      if (!hasLoadingBoundary && !hasErrorBoundary) {
        yield* frameLock.withPermits(1)(
          commitWithLayoutPreservation(
            match,
            decodedParams,
            decodedQuery,
            route.path,
            activationId,
            request,
          ),
        );
        return;
      }

      // Boundary path (loading and/or error): full tree rebuild driven through
      // viewSignal. Drop persistent frames so a later return to a plain layout
      // rebuilds cleanly; the viewSignal replace tears down the old subtree.
      yield* frameLock.withPermits(1)(
        Effect.sync(() => {
          frameStack = [];
        }),
      );
      const routeElement = buildRouteElement(match, decodedParams, decodedQuery, route.path, {
        // Same blank-flash guard as the layout-preserving path: with no loading
        // boundary AND no layout chrome, a deferred lazy leaf would blank the
        // whole view until the import resolves. Await the load instead so the
        // swap is atomic (and load failures route to the error boundary).
        deferLazyLeaf: !hasLoadingBoundary && computeRawLayouts(match).length > 0,
        request,
      });
      const withError = wrapWithErrorBoundary(routeElement, match, route.path);
      yield* commitView(withError, match, queryString, epoch, activationId, route.path);
    }).pipe(
      Effect.catchCause((cause) =>
        Effect.gen(function* () {
          const currentRoute = router.current._cell.value;
          yield* Trace.emit("effect.error.ignored", () => ({
            owner: "router.outlet",
            operation: "processRoute",
            path: currentRoute.path,
            cause: Cause.pretty(cause),
          }));
          yield* Trace.emit("router.outlet.error", () => ({
            phase: "process_route",
            path: currentRoute.path,
            error: Cause.pretty(cause),
          }));
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

    return signalElement(viewSignal, { onSwap: onRootSwap });
  });

  return Element.fromEffect(outletEffect, { identity: outletRuntimeIdentity, inputs: props });
});
