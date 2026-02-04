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
  Deferred,
  Effect,
  FiberRef,
  Layer,
  Option,
  Ref,
  Schema,
  SubscriptionRef,
} from "effect";
import * as Debug from "../debug/debug.js";
import { type Element, text, signalElement, componentElement } from "../primitives/element.js";
import * as Signal from "../primitives/signal.js";
import * as Component from "../primitives/component.js";
import type { ComponentProps } from "../primitives/component.js";
import { type RoutesManifest, CurrentRoutesManifest } from "./routes.js";
import {
  buildTrieMatcher,
  resolveRoutes,
  resolveScrollStrategy,
  runRouteMiddleware,
  decodeRouteParams,
  decodeRouteQuery,
  type RouteMatch,
  type RouteMatcherShape,
} from "./matching.js";
import { get as getRouter, CurrentOutletChild } from "./service.js";
import { runPrefetch } from "./prefetch.js";
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
import { type ComponentInput, type ComponentLoader, type RouteComponent } from "./types.js";
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
      const matchOption = yield* matcher.match(path);
      if (Option.isNone(matchOption)) return;

      const targets = collectPrefetchTargets(matchOption.value);
      const loaders = targets.filter(isComponentLoader);
      if (loaders.length === 0) return;

      // Call all loaders in parallel — browser module cache handles dedup
      yield* Effect.forEach(
        loaders,
        (loader) =>
          Effect.tryPromise({
            try: () => loader(),
            catch: () => undefined,
          }).pipe(Effect.ignore),
        { concurrency: "unbounded" },
      );
    }).pipe(Effect.ignore);

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
        Schema.decodeUnknown(RouteComponentSchema)(m.default).pipe(
          Effect.mapError((parseError) => new RenderLoadError({ cause: parseError })),
        ),
      ),
    );
  }
  // Direct component (Component.gen result or Effect<Element>)
  return Schema.decodeUnknown(RouteComponentSchema)(component).pipe(
    Effect.mapError((parseError) => new RenderLoadError({ cause: parseError })),
  );
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

    // Register prefetch resolver so router.prefetch() can warm lazy modules
    const currentMatcher = yield* Ref.get(cachedMatcherRef);
    if (Option.isSome(currentMatcher)) {
      yield* Ref.set(router._prefetchRef, buildPrefetchResolver(currentMatcher.value));
    }

    const componentScope = yield* FiberRef.get(Signal.CurrentComponentScope);
    const scope = componentScope ?? (yield* Effect.scope);

    // Create a unified view signal — holds the currently rendered element.
    // Updated reactively by processRoute (via AsyncLoader or direct set).
    const viewSignal = yield* Signal.make<Element>(text(""));

    // Helper: apply scroll behavior for a given strategy layer.
    // Resolves the ScrollStrategy service from the route's layer and passes
    // the full discriminated union type to the router for _tag dispatch.
    const applyScroll = (strategyLayer: Layer.Layer<ScrollStrategy> | undefined) =>
      Effect.gen(function* () {
        const strategy = yield* Effect.provide(
          ScrollStrategy,
          strategyLayer ?? ScrollStrategy.Auto,
        );
        yield* router._applyScroll({ strategy });
      }).pipe(Effect.ignore);

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
    const afterFrame: Effect.Effect<void> = Effect.async((resume) => {
      requestAnimationFrame(() => resume(Effect.void));
    });

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
    ): Effect.Effect<Element, unknown, never> => {
      const renderBase: Effect.Effect<Element, unknown, never> = Effect.gen(function* () {
        const rawComponent = match.route.definition.component;
        if (rawComponent === undefined) return text("");

        const component = yield* resolveComponent(rawComponent);
        const leafElement = yield* renderComponent(component, decodedParams, decodedQuery);

        const ancestorRawLayouts = Arr.filterMap(match.route.ancestors, (a) =>
          a !== undefined && a.definition.layout !== undefined
            ? Option.some(a.definition.layout)
            : Option.none(),
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
          Effect.flatMap(acc, (child) => renderLayout(layout, child, decodedParams, decodedQuery)),
        );
      });

      const allLayers = [
        ...match.route.ancestors.flatMap((a) => (a !== undefined ? a.definition.layers : [])),
        ...match.route.definition.layers,
      ];

      return allLayers.length > 0
        ? Effect.flatMap(unsafeMergeLayers(allLayers), (merged) =>
            renderBase.pipe(Effect.provide(merged)),
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
              Effect.catchAllCause((resolutionCause) =>
                renderError(resolvedErrorComp, resolutionCause, routePath),
              ),
            );
            return componentElement(() =>
              Effect.gen(function* () {
                if (routeElement._tag === "Component") {
                  return yield* routeElement.run().pipe(
                    Effect.sandbox,
                    Effect.catchAllCause((sandboxedCause) =>
                      Effect.gen(function* () {
                        const cause = Cause.flatten(sandboxedCause);
                        const errorEl = yield* renderError(resolvedErrorComp, cause, routePath);
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

        // Propagate loader.view → viewSignal, apply deferred scroll on Ready.
        // pendingScroll is set after loader.track returns — the Refreshing
        // transition fires during track (sees null), only Ready consumes it.
        const _unsubLoader = yield* Signal.subscribe(loader.view, () =>
          Effect.gen(function* () {
            const val = yield* SubscriptionRef.get(loader.view._ref);
            if (pendingScroll !== null) {
              const { strategyLayer } = pendingScroll;
              pendingScroll = null;
              yield* setViewAndAwaitSwap(val);
              yield* applyScroll(strategyLayer);
            } else {
              yield* Signal.set(viewSignal, val);
            }
          }),
        );
        void _unsubLoader;

        return loader;
      });

    /** Commit rendered element: async loader path or direct set + scroll. */
    const commitView = (
      renderEffect: Effect.Effect<Element, unknown, never>,
      match: RouteMatch,
      queryString: string,
    ) =>
      Effect.gen(function* () {
        const nearestLoadingComp = boundaries.resolveLoading(match.route);

        if (Option.isSome(nearestLoadingComp)) {
          const loader = yield* getOrCreateAsyncLoader(nearestLoadingComp.value);
          const matchKey = buildMatchKey(match, queryString);
          // Defer scroll: loader.track forks a render fiber and returns
          // immediately. pendingScroll is set AFTER track returns so the
          // loader.view subscription (which fires on Refreshing DURING track)
          // sees null. Ready-state subscription consumes pendingScroll.
          yield* loader.track(matchKey, renderEffect);
          pendingScroll = { strategyLayer: resolveScrollStrategy(match.route) };
          // Sync current loader.view → viewSignal (initial render)
          const currentView = yield* SubscriptionRef.get(loader.view._ref);
          yield* Signal.set(viewSignal, currentView);
        } else {
          yield* setViewAndAwaitSwap(yield* renderEffect);
          yield* applyScroll(resolveScrollStrategy(match.route));
        }
      });

    // -------------------------------------------------------------------------
    // processRoute — match, middleware, render, commit
    // -------------------------------------------------------------------------

    const processRoute = Effect.gen(function* () {
      // Clear stale scroll intent from prior navigation
      pendingScroll = null;

      const route = yield* SubscriptionRef.get(router.current._ref);
      const matchOption = yield* matcher.match(route.path);

      // 404
      if (Option.isNone(matchOption)) {
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

      // Decode params + query
      const decodedParams = yield* decodeRouteParams(match.route, match.params).pipe(
        Effect.catchAll(() => Effect.succeed<Record<string, unknown>>(match.params)),
      );
      const queryString = route.query.toString();
      const decodedQuery = yield* decodeRouteQuery(match.route, route.query).pipe(
        Effect.catchAll(() => Effect.succeed<Record<string, unknown>>({})),
      );

      // Prefetch
      const prefetchFns = match.route.definition.prefetch;
      if (prefetchFns.length > 0) {
        yield* runPrefetch(prefetchFns, { params: decodedParams, query: decodedQuery });
      }

      // Build → wrap → commit
      const routeElement = buildRouteElement(match, decodedParams, decodedQuery);
      const withError = wrapWithErrorBoundary(routeElement, match, route.path);
      yield* commitView(withError, match, queryString);
    }).pipe(
      Effect.catchAllCause((cause) =>
        Debug.log({
          event: "router.outlet.error",
          error: Cause.pretty(cause),
        }),
      ),
    );

    // Process the initial route
    yield* processRoute;

    // Subscribe to route changes — calls processRoute reactively.
    // Does NOT cause component re-render (subscription, not Signal.get).
    // Router signal outlives the outlet — must unsubscribe on scope close.
    const unsubRouter = yield* Signal.subscribe(router.current, () => processRoute);
    yield* Effect.addFinalizer(() => unsubRouter);

    return signalElement(viewSignal, { onSwap: onSwapEffect });
  });

  return componentElement(() => outletEffect);
});
