/**
 * @since 1.0.0
 * Router service for effect-ui
 */
import { Context, Effect, FiberRef, GlobalValue, Layer, Option, Runtime } from "effect";
import * as Signal from "../signal.js";
import * as Debug from "../debug/debug.js";
import * as Metrics from "../debug/metrics.js";
import type {
  Route,
  RouteParams,
  RouterService,
  NavigateOptions,
  RouteErrorInfo,
  RoutePath,
  RouteParamsFor,
  RoutesManifest,
} from "./types.js";
import type { Element } from "../element.js";
import { parsePath, buildPath, createMatcher } from "./matching.js";
import { moduleLoader } from "./module-loader.js";

// F-001: Viewport prefetch constants from framework research
/** IntersectionObserver threshold - 10% visible triggers prefetch */
const INTERSECTION_THRESHOLD = 0.1;
/** IntersectionObserver rootMargin for slight lookahead */
const INTERSECTION_ROOT_MARGIN = "100px";
/** requestIdleCallback timeout - max wait for idle state */
const IDLE_TIMEOUT_MS = 5000;
/** Data attribute for viewport prefetch links */
const PREFETCH_ATTR = "data-effectui-prefetch";
/** Data attribute for prefetch path */
const PREFETCH_PATH_ATTR = "data-effectui-prefetch-path";

/**
 * Setup global viewport prefetch observer.
 * Uses IntersectionObserver + MutationObserver + requestIdleCallback pattern.
 * SvelteKit-style: single global observer for all viewport prefetch links.
 *
 * @internal
 */
const setupViewportPrefetch = (
  router: RouterService,
  runtime: Runtime.Runtime<never>,
): Effect.Effect<() => void> =>
  Effect.sync(() => {
    if (typeof window === "undefined" || typeof IntersectionObserver === "undefined") {
      // SSR or no IntersectionObserver support - return no-op cleanup
      return () => {};
    }

    // Track observed elements to avoid double-observing
    const observed = new WeakSet<globalThis.Element>();

    // Track pending idle callbacks for cleanup
    const pendingCallbacks = new Set<number>();

    // Handle intersection - one-shot prefetch trigger
    const handleIntersection: IntersectionObserverCallback = (entries) => {
      for (const entry of entries) {
        if (!entry.isIntersecting) continue;

        const anchor = entry.target as HTMLAnchorElement;
        const path = anchor.getAttribute(PREFETCH_PATH_ATTR);

        if (path === null) continue;

        // Unobserve immediately (one-shot)
        intersectionObserver.unobserve(anchor);

        // Schedule prefetch via requestIdleCallback for non-blocking execution
        const callbackId = requestIdleCallback(
          () => {
            pendingCallbacks.delete(callbackId);

            // Log viewport trigger event and run prefetch
            Runtime.runFork(runtime)(
              Effect.gen(function* () {
                yield* Debug.log({
                  event: "router.prefetch.viewport",
                  path,
                });
                yield* router.prefetch(path);
              }),
            );
          },
          { timeout: IDLE_TIMEOUT_MS },
        );
        pendingCallbacks.add(callbackId);
      }
    };

    // Create singleton IntersectionObserver
    const intersectionObserver = new IntersectionObserver(handleIntersection, {
      threshold: INTERSECTION_THRESHOLD,
      rootMargin: INTERSECTION_ROOT_MARGIN,
    });

    // Observe a viewport prefetch link
    const observeLink = (anchor: globalThis.Element): void => {
      if (observed.has(anchor)) return;
      observed.add(anchor);
      intersectionObserver.observe(anchor);
    };

    // Scan and observe all viewport prefetch links in a subtree
    const scanLinks = (root: globalThis.Element | Document): void => {
      const links = root.querySelectorAll(`[${PREFETCH_ATTR}="viewport"]`);
      links.forEach(observeLink);
    };

    // Initial scan of existing links
    scanLinks(document);

    // Create MutationObserver to detect new links
    const mutationObserver = new MutationObserver((mutations) => {
      for (const mutation of mutations) {
        // Check added nodes for viewport prefetch links
        for (const node of mutation.addedNodes) {
          if (node.nodeType !== Node.ELEMENT_NODE) continue;
          const element = node as globalThis.Element;

          // Check if the node itself is a viewport prefetch link
          if (element.matches?.(`[${PREFETCH_ATTR}="viewport"]`)) {
            observeLink(element);
          }

          // Check children for viewport prefetch links
          scanLinks(element);
        }
      }
    });

    // Start observing document for DOM changes
    mutationObserver.observe(document.body, {
      childList: true,
      subtree: true,
    });

    // Return cleanup function
    return () => {
      // Disconnect observers
      intersectionObserver.disconnect();
      mutationObserver.disconnect();

      // Cancel pending idle callbacks
      for (const callbackId of pendingCallbacks) {
        cancelIdleCallback(callbackId);
      }
      pendingCallbacks.clear();
    };
  });

/**
 * Router service tag
 * @since 1.0.0
 */
export class Router extends Context.Tag("@effect-ui/Router")<Router, RouterService>() {}

/**
 * FiberRef to store current route params for the active route
 * Used by Router.params() to provide type-safe access
 * Uses GlobalValue to ensure single instance even with module duplication (Vite aliasing).
 * @internal
 */
export const CurrentRouteParams: FiberRef.FiberRef<RouteParams> = GlobalValue.globalValue(
  Symbol.for("effect-ui/Router/CurrentRouteParams"),
  () => FiberRef.unsafeMake<RouteParams>({}),
);

/**
 * FiberRef to store the current router service.
 * Set during layer building and propagated via ManagedRuntime to all forked fibers.
 * This replaces the module-level variable approach - FiberRefs set during layer
 * building are captured in the Runtime and copied to forked fibers.
 * Uses GlobalValue to ensure single instance even with module duplication.
 * @internal
 */
export const CurrentRouter: FiberRef.FiberRef<Option.Option<RouterService>> =
  GlobalValue.globalValue(Symbol.for("effect-ui/Router/CurrentRouter"), () =>
    FiberRef.unsafeMake<Option.Option<RouterService>>(Option.none()),
  );

/**
 * FiberRef to store route error info for _error.tsx components.
 * Set by Outlet when a route errors, read by error components via currentError.
 * Uses GlobalValue to ensure single instance even with module duplication.
 * @internal
 */
export const CurrentRouteError: FiberRef.FiberRef<Option.Option<RouteErrorInfo>> =
  GlobalValue.globalValue(Symbol.for("effect-ui/Router/CurrentRouteError"), () =>
    FiberRef.unsafeMake<Option.Option<RouteErrorInfo>>(Option.none()),
  );

/**
 * FiberRef to store child content passed from parent outlet to nested outlet.
 * Used by layouts - the parent outlet sets this before rendering the layout,
 * and the nested outlet inside the layout reads it.
 * Using FiberRef instead of module-level variable ensures isolation between
 * multiple router instances and proper cleanup on unmount.
 * Uses GlobalValue to ensure single instance even with module duplication.
 * @internal
 */
export const CurrentOutletChild: FiberRef.FiberRef<Option.Option<Element>> =
  GlobalValue.globalValue(Symbol.for("effect-ui/Router/CurrentOutletChild"), () =>
    FiberRef.unsafeMake<Option.Option<Element>>(Option.none()),
  );

/**
 * FiberRef to store the routes manifest for prefetching.
 * Set by Outlet when routes are provided, read by prefetch.
 * Uses GlobalValue to ensure single instance even with module duplication.
 * @internal
 */
export const CurrentRoutes: FiberRef.FiberRef<RoutesManifest> = GlobalValue.globalValue(
  Symbol.for("effect-ui/Router/CurrentRoutes"),
  () => FiberRef.unsafeMake<RoutesManifest>([]),
);

/**
 * Get the current router service.
 * Uses the Router Context.Tag which is provided to all components
 * via the render context in browserLayer.
 * @internal
 */
export const getRouter: Effect.Effect<RouterService, never, Router> = Router;

/**
 * Get the current route signal
 * @since 1.0.0
 */
export const current: Effect.Effect<Signal.Signal<Route>, never, Router> = Effect.map(
  Router,
  (router) => router.current,
);

/**
 * Get the query params signal
 * @since 1.0.0
 */
export const query: Effect.Effect<Signal.Signal<URLSearchParams>, never, Router> = Effect.map(
  Router,
  (router) => router.query,
);

/**
 * Navigate to a path
 * @since 1.0.0
 */
export const navigate = (
  path: string,
  options?: NavigateOptions,
): Effect.Effect<void, never, Router> =>
  Effect.flatMap(Router, (router) => router.navigate(path, options));

/**
 * Go back in history
 * @since 1.0.0
 */
export const back: Effect.Effect<void, never, Router> = Effect.flatMap(Router, (router) =>
  router.back(),
);

/**
 * Go forward in history
 * @since 1.0.0
 */
export const forward: Effect.Effect<void, never, Router> = Effect.flatMap(Router, (router) =>
  router.forward(),
);

/**
 * Get route params with type safety based on path pattern.
 * Pass the path for autocomplete and type inference (not used at runtime).
 *
 * @example
 * ```ts
 * const { id } = yield* Router.params("/users/:id")
 * ```
 *
 * @since 1.0.0
 */
export const params = <Path extends RoutePath>(_path: Path): Effect.Effect<RouteParamsFor<Path>> =>
  FiberRef.get(CurrentRouteParams) as Effect.Effect<RouteParamsFor<Path>>;

/**
 * Check if a path is currently active
 * @since 1.0.0
 */
export const isActive = (
  path: string,
  exact: boolean = false,
): Effect.Effect<boolean, never, Router> =>
  Effect.flatMap(Router, (router) => router.isActive(path, exact));

/**
 * Prefetch route modules for a path.
 * Loads all modules (component, layouts) for the matched route into cache.
 * Best-effort: failures are silently ignored.
 * @since 1.0.0
 */
export const prefetch = (path: string): Effect.Effect<void, never, Router> =>
  Effect.flatMap(Router, (router) => router.prefetch(path));

/**
 * Get route error info in an _error.tsx component.
 * Returns the error, path, and a reset effect to retry rendering.
 *
 * @example
 * ```tsx
 * // routes/_error.tsx
 * import { Effect } from "effect"
 * import * as Router from "effect-ui/router"
 *
 * export default Effect.gen(function* () {
 *   const { cause, path, reset } = yield* Router.currentError
 *   return (
 *     <div>
 *       <h1>Error on {path}</h1>
 *       <p>{String(Cause.squash(cause))}</p>
 *       <button onClick={reset}>Retry</button>
 *     </div>
 *   )
 * })
 * ```
 *
 * @since 1.0.0
 */
export const currentError: Effect.Effect<RouteErrorInfo> = Effect.flatMap(
  FiberRef.get(CurrentRouteError),
  (maybeError) => {
    if (Option.isNone(maybeError)) {
      return Effect.die(
        new Error(
          "Router.currentError called outside of an error boundary.\n" +
            "This should only be used in _error.tsx components.",
        ),
      );
    }
    return Effect.succeed(maybeError.value);
  },
);

/**
 * Create a link click handler that navigates to a path
 * Prevents default browser navigation and uses router instead
 * @since 1.0.0
 */
export const link =
  (
    path: string,
    options?: NavigateOptions,
  ): ((event: Event) => Effect.Effect<void, never, Router>) =>
  (event: Event) =>
    Effect.gen(function* () {
      event.preventDefault();
      yield* navigate(path, options);
    });

/**
 * Create the browser router layer
 * Uses History API for navigation
 * @since 1.0.0
 */
export const browserLayer: Layer.Layer<Router> = Layer.scoped(
  Router,
  Effect.gen(function* () {
    // Get initial location
    const initialPath =
      typeof window !== "undefined" ? window.location.pathname + window.location.search : "/";
    const { path, query: initialQuery } = parsePath(initialPath);

    // Create signals for current route and query
    const currentSignal = yield* Signal.make<Route>({
      path,
      params: {},
      query: initialQuery,
    });

    const querySignal = yield* Signal.make<URLSearchParams>(initialQuery);

    // Get runtime for running effects from sync callbacks (like popstate)
    const runtime = yield* Effect.runtime<never>();

    // Update signals from a path - used by popstate handler
    const updateFromPath = (fullPath: string): void => {
      const { path: newPath, query: newQuery } = parsePath(fullPath);

      // Use the extracted runtime to run effects from sync callbacks
      Runtime.runSync(runtime)(
        Signal.set(currentSignal, {
          path: newPath,
          params: {},
          query: newQuery,
        }),
      );

      Runtime.runSync(runtime)(Signal.set(querySignal, newQuery));
    };

    // Listen to browser popstate (back/forward) with proper lifecycle management
    // The listener is added when the layer is built and removed when the scope closes
    if (typeof window !== "undefined") {
      const popstateHandler = () => {
        updateFromPath(window.location.pathname + window.location.search);
      };

      yield* Effect.acquireRelease(
        Effect.gen(function* () {
          window.addEventListener("popstate", popstateHandler);
          yield* Debug.log({ event: "router.popstate.added" });
          return popstateHandler;
        }),
        (handler) =>
          Effect.gen(function* () {
            window.removeEventListener("popstate", handler);
            yield* Debug.log({ event: "router.popstate.removed" });
          }),
      );
    }

    const routerService: RouterService = {
      current: currentSignal,
      query: querySignal,

      navigate: Effect.fn("RouterService.navigate")(function* (
        targetPath: string,
        options?: NavigateOptions,
      ) {
        // Start a new trace for this navigation
        const traceId = Debug.nextTraceId();
        yield* Debug.setTraceId(traceId);

        const current = yield* Signal.get(currentSignal);
        yield* Debug.log({
          event: "router.navigate",
          from_path: current.path,
          to_path: targetPath,
          ...(options?.replace !== undefined ? { replace: options.replace } : {}),
        });

        // Record navigation metric
        yield* Metrics.recordNavigation;

        const fullPath = buildPath(targetPath, options?.query);

        if (typeof window !== "undefined") {
          if (options?.replace) {
            window.history.replaceState(null, "", fullPath);
          } else {
            window.history.pushState(null, "", fullPath);
          }
        }

        const { path: newPath, query: newQuery } = parsePath(fullPath);
        yield* Signal.set(currentSignal, {
          path: newPath,
          params: {},
          query: newQuery,
        });
        yield* Signal.set(querySignal, newQuery);

        yield* Debug.log({
          event: "router.navigate.complete",
          path: fullPath,
        });

        // Note: We don't clear trace context here because render events
        // should continue to use the same traceId. The trace context is
        // cleared when the next navigation starts (by setTraceId above).
      }),

      back: () =>
        Effect.sync(() => {
          if (typeof window !== "undefined") {
            window.history.back();
          }
        }),

      forward: () =>
        Effect.sync(() => {
          if (typeof window !== "undefined") {
            window.history.forward();
          }
        }),

      params: <Path extends RoutePath>(_path: Path) =>
        FiberRef.get(CurrentRouteParams) as Effect.Effect<RouteParamsFor<Path>>,

      isActive: Effect.fn("RouterService.isActive")(function* (
        targetPath: string,
        exact: boolean = false,
      ) {
        const route = yield* Signal.get(currentSignal);
        if (exact) {
          return route.path === targetPath;
        }
        return route.path.startsWith(targetPath);
      }),

      prefetch: Effect.fn("RouterService.prefetch")(function* (targetPath: string) {
        // Get routes from FiberRef (set by Outlet)
        const routes = yield* FiberRef.get(CurrentRoutes);

        if (routes.length === 0) {
          yield* Debug.log({
            event: "router.prefetch.no_match",
            path: targetPath,
          });
          return;
        }

        const matcher = createMatcher(routes);
        const matchOption = matcher.match(targetPath);

        if (Option.isNone(matchOption)) {
          yield* Debug.log({
            event: "router.prefetch.no_match",
            path: targetPath,
          });
          return;
        }

        const match = matchOption.value;

        // Count modules to prefetch
        const moduleCount =
          1 + (match.route.layout ? 1 : 0) + match.parents.filter((p) => p.route.layout).length;

        yield* Debug.log({
          event: "router.prefetch.start",
          path: targetPath,
          route_pattern: match.route.path,
          module_count: moduleCount,
        });

        // Collect all modules to prefetch
        const loaders: Array<Effect.Effect<unknown, unknown>> = [];

        // Component
        loaders.push(moduleLoader.load(match.route.path, "component", true, match.route.component));

        // Leaf layout
        if (match.route.layout) {
          loaders.push(moduleLoader.load(match.route.path, "layout", true, match.route.layout));
        }

        // Parent layouts
        for (const parent of match.parents) {
          if (parent.route.layout) {
            loaders.push(moduleLoader.load(parent.route.path, "layout", true, parent.route.layout));
          }
        }

        // Load all in parallel, ignore errors (prefetch is best-effort)
        yield* Effect.all(loaders, { concurrency: "unbounded" }).pipe(
          Effect.catchAll(() => Effect.void),
        );

        yield* Debug.log({
          event: "router.prefetch.complete",
          path: targetPath,
        });
      }),
    };

    // Store router in FiberRef during layer building.
    // ManagedRuntime captures FiberRefs at layer build time and propagates
    // them to all forked fibers, solving the fiber-local variable problem.
    yield* FiberRef.set(CurrentRouter, Option.some(routerService));

    // F-001: Setup viewport prefetch observer (global IntersectionObserver + MutationObserver)
    yield* Effect.acquireRelease(
      Effect.gen(function* () {
        const cleanup = yield* setupViewportPrefetch(routerService, runtime);
        yield* Debug.log({ event: "router.viewport.observer.added" });
        return cleanup;
      }),
      (cleanup) =>
        Effect.gen(function* () {
          cleanup();
          yield* Debug.log({ event: "router.viewport.observer.removed" });
        }),
    );

    return routerService;
  }),
);

/**
 * Redirect effect - use in guards to redirect to another route
 * @since 1.0.0
 */
export const redirect = (
  path: string,
  options?: NavigateOptions,
): Effect.Effect<never, never, Router> =>
  Effect.flatMap(navigate(path, options), () => Effect.never);

/**
 * Create a test router layer
 * Uses in-memory state instead of window.location/history.
 * Useful for unit tests that don't have a DOM or need isolated routing.
 *
 * @param initialPath - The initial path (defaults to "/")
 * @since 1.0.0
 */
export const testLayer = (initialPath: string = "/"): Layer.Layer<Router> =>
  Layer.effect(
    Router,
    Effect.gen(function* () {
      const { path, query: initialQuery } = parsePath(initialPath);

      // Create signals for current route and query
      const currentSignal = yield* Signal.make<Route>({
        path,
        params: {},
        query: initialQuery,
      });

      const querySignal = yield* Signal.make<URLSearchParams>(initialQuery);

      // History stack for back/forward (in-memory)
      const historyStack: Array<string> = [initialPath];
      let historyIndex = 0;

      // Get runtime for running effects from sync callbacks
      const runtime = yield* Effect.runtime<never>();

      const updateFromPath = (fullPath: string): void => {
        const { path: newPath, query: newQuery } = parsePath(fullPath);
        Runtime.runSync(runtime)(
          Signal.set(currentSignal, {
            path: newPath,
            params: {},
            query: newQuery,
          }),
        );
        Runtime.runSync(runtime)(Signal.set(querySignal, newQuery));
      };

      const routerService: RouterService = {
        current: currentSignal,
        query: querySignal,

        navigate: Effect.fn("RouterService.navigate")(function* (
          targetPath: string,
          options?: NavigateOptions,
        ) {
          // Start a new trace for this navigation
          const traceId = Debug.nextTraceId();
          yield* Debug.setTraceId(traceId);

          const current = yield* Signal.get(currentSignal);
          yield* Debug.log({
            event: "router.navigate",
            from_path: current.path,
            to_path: targetPath,
            ...(options?.replace !== undefined ? { replace: options.replace } : {}),
          });

          // Record navigation metric
          yield* Metrics.recordNavigation;

          const fullPath = buildPath(targetPath, options?.query);
          const { path: newPath, query: newQuery } = parsePath(fullPath);

          if (options?.replace) {
            // Replace current entry
            historyStack[historyIndex] = fullPath;
          } else {
            // Push new entry, removing any forward history
            historyStack.splice(historyIndex + 1);
            historyStack.push(fullPath);
            historyIndex = historyStack.length - 1;
          }

          yield* Signal.set(currentSignal, {
            path: newPath,
            params: {},
            query: newQuery,
          });
          yield* Signal.set(querySignal, newQuery);

          yield* Debug.log({
            event: "router.navigate.complete",
            path: fullPath,
          });
        }),

        back: () =>
          Effect.sync(() => {
            if (historyIndex > 0) {
              historyIndex--;
              const path = historyStack[historyIndex];
              if (path !== undefined) {
                updateFromPath(path);
              }
            }
          }),

        forward: () =>
          Effect.sync(() => {
            if (historyIndex < historyStack.length - 1) {
              historyIndex++;
              const path = historyStack[historyIndex];
              if (path !== undefined) {
                updateFromPath(path);
              }
            }
          }),

        params: <Path extends RoutePath>(_path: Path) =>
          FiberRef.get(CurrentRouteParams) as Effect.Effect<RouteParamsFor<Path>>,

        isActive: Effect.fn("RouterService.isActive")(function* (
          targetPath: string,
          exact: boolean = false,
        ) {
          const route = yield* Signal.get(currentSignal);
          if (exact) {
            return route.path === targetPath;
          }
          return route.path.startsWith(targetPath);
        }),

        prefetch: Effect.fn("RouterService.prefetch")(function* (targetPath: string) {
          // Get routes from FiberRef (set by Outlet)
          const routes = yield* FiberRef.get(CurrentRoutes);

          if (routes.length === 0) {
            yield* Debug.log({
              event: "router.prefetch.no_match",
              path: targetPath,
            });
            return;
          }

          const matcher = createMatcher(routes);
          const matchOption = matcher.match(targetPath);

          if (Option.isNone(matchOption)) {
            yield* Debug.log({
              event: "router.prefetch.no_match",
              path: targetPath,
            });
            return;
          }

          const match = matchOption.value;

          // Count modules to prefetch
          const moduleCount =
            1 + (match.route.layout ? 1 : 0) + match.parents.filter((p) => p.route.layout).length;

          yield* Debug.log({
            event: "router.prefetch.start",
            path: targetPath,
            route_pattern: match.route.path,
            module_count: moduleCount,
          });

          // Collect all modules to prefetch
          const loaders: Array<Effect.Effect<unknown, unknown>> = [];

          // Component
          loaders.push(
            moduleLoader.load(match.route.path, "component", true, match.route.component),
          );

          // Leaf layout
          if (match.route.layout) {
            loaders.push(moduleLoader.load(match.route.path, "layout", true, match.route.layout));
          }

          // Parent layouts
          for (const parent of match.parents) {
            if (parent.route.layout) {
              loaders.push(
                moduleLoader.load(parent.route.path, "layout", true, parent.route.layout),
              );
            }
          }

          // Load all in parallel, ignore errors (prefetch is best-effort)
          yield* Effect.all(loaders, { concurrency: "unbounded" }).pipe(
            Effect.catchAll(() => Effect.void),
          );

          yield* Debug.log({
            event: "router.prefetch.complete",
            path: targetPath,
          });
        }),
      };

      // Store router in FiberRef
      yield* FiberRef.set(CurrentRouter, Option.some(routerService));

      return routerService;
    }),
  );
