/**
 * @since 1.0.0
 * Router service for effect-ui
 */
import { Context, Effect, FiberRef, GlobalValue, Layer, Option, Ref, Schema, Scope } from "effect";
import { CurrentRouteQuery } from "./route.js";

import * as Signal from "../primitives/signal.js";
import * as Debug from "../debug/debug.js";
import * as Metrics from "../debug/metrics.js";
import type {
  Route,
  RouteParams,
  RouterService,
  NavigateOptions,
  NavigationContext,
  IsActiveOptions,
  RouteErrorInfo,
  RoutePath,
  RouteParamsFor,
} from "./types.js";
import { NavigationError, interpolateParams } from "./types.js";
import type { Element } from "../primitives/element.js";
import { parsePath, buildPath } from "./utils.js";
import { SessionStorage } from "../platform/storage.js";
import { Scroll } from "../platform/scroll.js";
import { Dom, DomError } from "../platform/dom.js";
import { History } from "../platform/history.js";
import { Location } from "../platform/location.js";
import { PlatformEventTarget } from "../platform/event-target.js";
import { Observer } from "../platform/observer.js";
import { ScrollPositionJson } from "./scroll-strategy.js";

// F-001: Viewport prefetch constants from framework research
/** IntersectionObserver threshold - 10% visible triggers prefetch */
const INTERSECTION_THRESHOLD = 0.1;
/** IntersectionObserver rootMargin for slight lookahead */
const INTERSECTION_ROOT_MARGIN = "100px";
/** Data attribute for viewport prefetch links */
const PREFETCH_ATTR = "data-effectui-prefetch";
/** Data attribute for prefetch path */
const PREFETCH_PATH_ATTR = "data-effectui-prefetch-path";

/**
 * Setup global viewport prefetch observer.
 * Uses Observer + Idle + Dom services for lifecycle-managed prefetching.
 * SvelteKit-style: single global observer for all viewport prefetch links.
 *
 * Cleanup is automatic via Scope finalizers.
 *
 * @internal
 */
const setupViewportPrefetch = (
  router: RouterService,
): Effect.Effect<void, DomError, Dom | Observer | Scope.Scope> =>
  Effect.gen(function* () {
    const dom = yield* Dom;
    const observer = yield* Observer;

    // Track observed elements to avoid double-observing
    const observed = new WeakSet<globalThis.Element>();

    // Use mutable ref to break circular reference (handle used in its own callback)
    let handleRef:
      | {
          observe: (el: globalThis.Element) => Effect.Effect<void>;
          unobserve: (el: globalThis.Element) => Effect.Effect<void>;
        }
      | undefined;

    // Create IntersectionObserver via service (auto-disconnect on scope close)
    const handle = yield* observer.intersection({
      threshold: INTERSECTION_THRESHOLD,
      rootMargin: INTERSECTION_ROOT_MARGIN,
      onIntersect: (entry) =>
        Effect.gen(function* () {
          const anchor = entry.target;

          // Unobserve immediately (one-shot)
          if (handleRef !== undefined) {
            yield* handleRef.unobserve(anchor);
          }

          // Get prefetch path from attribute
          const path = yield* dom.getAttribute(anchor, PREFETCH_PATH_ATTR);
          if (path === null) return;

          // Run prefetch directly (IntersectionObserver already fires async)
          yield* Debug.log({
            event: "router.prefetch.viewport",
            path,
          });
          yield* router.prefetch(path);
        }).pipe(Effect.ignore),
    });

    handleRef = handle;

    // Observe a viewport prefetch link
    const observeLink = (anchor: globalThis.Element): Effect.Effect<void> =>
      Effect.gen(function* () {
        if (observed.has(anchor)) return;
        observed.add(anchor);
        yield* handle.observe(anchor);
      });

    // Scan and observe all viewport prefetch links in a subtree
    const scanLinks = (root: Node): Effect.Effect<void> =>
      Effect.gen(function* () {
        const links = yield* dom.querySelectorAll(`[${PREFETCH_ATTR}="viewport"]`, root);
        for (const link of links) {
          yield* observeLink(link);
        }
      }).pipe(Effect.ignore);

    // Initial scan of existing links
    const body = yield* dom.body;
    yield* scanLinks(body);

    // MutationObserver to detect new links (auto-disconnect on scope close)
    yield* observer.mutation(body, { childList: true, subtree: true }, (mutations) =>
      Effect.gen(function* () {
        for (const mutation of mutations) {
          for (const node of mutation.addedNodes) {
            if (node.nodeType !== 1) continue; // ELEMENT_NODE
            const el = node as globalThis.Element;

            // Check if the node itself is a viewport prefetch link
            const isMatch = yield* dom.matches(el, `[${PREFETCH_ATTR}="viewport"]`);
            if (isMatch) {
              yield* observeLink(el);
            }

            // Check children for viewport prefetch links
            yield* scanLinks(el);
          }
        }
      }).pipe(Effect.ignore),
    );

    yield* Debug.log({ event: "router.viewport.observer.added" });
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
 * FiberRef to store route error info for .error() boundary components.
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
 * Get the current router service.
 * Uses the Router Context.Tag which is provided to all components
 * via the render context in browserLayer.
 * @since 1.0.0
 */
export const get: Effect.Effect<RouterService, never, Router> = Router;

/**
 * @deprecated Use `Router.get` instead
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
 * Get the current route value (resolved from Signal).
 * Combines Router service access + Signal.get into one step.
 *
 * @example
 * ```tsx
 * const route = yield* Router.currentRoute
 * // route: { path: "/users/123", params: {...}, query: URLSearchParams }
 * ```
 *
 * @since 1.0.0
 */
export const currentRoute: Effect.Effect<Route, never, Router> = Effect.gen(function* () {
  const router = yield* Router;
  return yield* Signal.get(router.current);
});

/**
 * Get the raw query params signal (URLSearchParams).
 * For decoded query access, use `queryParams(path)`.
 * @since 1.0.0
 */
export const querySignal: Effect.Effect<Signal.Signal<URLSearchParams>, never, Router> = Effect.map(
  Router,
  (router) => router.query,
);

/**
 * Get decoded query params with type safety based on path pattern.
 * Pass the path for autocomplete and type inference (not used at runtime).
 * Reads from `CurrentRouteQuery` FiberRef which is set by the Outlet at match time.
 *
 * @example
 * ```ts
 * const { q, page } = yield* Router.query("/search")
 * ```
 *
 * @since 1.0.0
 */
export const query = <Path extends RoutePath>(
  _path: Path,
): Effect.Effect<Record<string, unknown>> => FiberRef.get(CurrentRouteQuery);

/**
 * Navigate to a path. Supports param interpolation via options.params.
 *
 * @example
 * ```ts
 * yield* Router.navigate("/users/:id", { params: { id: 123 } })
 * // Navigates to /users/123
 * ```
 *
 * @since 1.0.0
 */
export const navigate = (
  path: string,
  options?: NavigateOptions,
): Effect.Effect<void, NavigationError, Router> =>
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
 * Check if a path is currently active.
 * Supports param interpolation for exact matching on parameterized routes.
 *
 * @example
 * ```ts
 * // Prefix match (default)
 * const usersActive = yield* Router.isActive("/users")
 *
 * // Exact match
 * const homeActive = yield* Router.isActive("/", { exact: true })
 *
 * // With params (interpolated before comparison)
 * const userActive = yield* Router.isActive("/users/:id", { params: { id: 123 } })
 * ```
 *
 * @since 1.0.0
 */
export const isActive = (
  path: string,
  options?: IsActiveOptions,
): Effect.Effect<boolean, never, Router> =>
  Effect.flatMap(Router, (router) => router.isActive(path, options));

/**
 * Prefetch route modules for a path.
 * Loads all modules (component, layouts) for the matched route into cache.
 * Best-effort: failures are silently ignored.
 * @since 1.0.0
 */
export const prefetch = (path: string): Effect.Effect<void, never, Router> =>
  Effect.flatMap(Router, (router) => router.prefetch(path));

/**
 * Get route error info in an error boundary component.
 * Returns the error, path, and a reset effect to retry rendering.
 *
 * @example
 * ```tsx
 * const ErrorBoundary = Component.gen(function* () {
 *   const { cause, path, reset } = yield* Router.currentError
 *   return (
 *     <div>
 *       <h1>Error on {path}</h1>
 *       <p>{String(Cause.squash(cause))}</p>
 *       <button onClick={reset}>Retry</button>
 *     </div>
 *   )
 * })
 *
 * Route.make("/users/:id")
 *   .component(UserProfile)
 *   .error(ErrorBoundary)
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
            "This should only be used in .error() boundary components.",
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
  ): ((event: Event) => Effect.Effect<void, NavigationError, Router>) =>
  (event: Event) =>
    Effect.gen(function* () {
      event.preventDefault();
      yield* navigate(path, options);
    });

/**
 * Create the browser router layer
 * Uses History API for navigation via platform services.
 * @since 1.0.0
 */
export const browserLayer: Layer.Layer<
  Router,
  NavigationError,
  SessionStorage | Scroll | Dom | History | Location | PlatformEventTarget | Observer
> = Layer.scoped(
  Router,
  Effect.gen(function* () {
    // Resolve platform services
    const storage = yield* SessionStorage;
    const scroll = yield* Scroll;
    const dom = yield* Dom;
    const history = yield* History;
    const location = yield* Location;
    const eventTarget = yield* PlatformEventTarget;

    // Get initial location from Location service
    const initialPath = yield* location.fullPath.pipe(
      Effect.mapError((cause) => new NavigationError({ operation: "init.fullPath", cause })),
    );
    const { path, query: initialQuery } = yield* parsePath(initialPath);

    // Generate unique key for scroll position storage
    const random = yield* Effect.random;
    const generateKey = Effect.map(random.nextInt, (n) => Math.abs(n).toString(36).slice(0, 8));
    let currentNavKey = yield* generateKey;

    // Ensure initial history state has a key
    const existingState = yield* history.state.pipe(
      Effect.mapError((cause) => new NavigationError({ operation: "init.state", cause })),
    );
    if (
      existingState !== null &&
      typeof existingState === "object" &&
      "_scrollKey" in (existingState as object)
    ) {
      currentNavKey = (existingState as { _scrollKey: string })._scrollKey;
    } else {
      yield* history
        .replaceState({ _scrollKey: currentNavKey }, initialPath)
        .pipe(
          Effect.mapError(
            (cause) => new NavigationError({ operation: "init.replaceState", cause }),
          ),
        );
    }

    // Create signals for current route and query
    const currentSignal = yield* Signal.make<Route>({
      path,
      params: {},
      query: initialQuery,
    });

    const querySignal = yield* Signal.make<URLSearchParams>(initialQuery);

    // Navigation context for outlet scroll handling
    const navContextRef = yield* Ref.make<NavigationContext>({
      isPopstate: false,
      hash: "",
      scrollKey: currentNavKey,
    });

    // Update signals from a path
    const updateFromPath = (fullPath: string) =>
      Effect.gen(function* () {
        const { path: newPath, query: newQuery } = yield* parsePath(fullPath);
        yield* Signal.set(currentSignal, {
          path: newPath,
          params: {},
          query: newQuery,
        });
        yield* Signal.set(querySignal, newQuery);
      });

    // Save scroll using captured services (best-effort, errors ignored)
    const doSaveScroll = () =>
      Effect.gen(function* () {
        const pos = yield* scroll.getPosition;
        const encoded = yield* Schema.encode(ScrollPositionJson)(pos);
        yield* storage.set(`effect-ui:scroll:${currentNavKey}`, encoded);
      }).pipe(Effect.ignore);

    // Apply scroll behavior using captured services (best-effort)
    const doApplyScroll = (opts: {
      key: string;
      hash: string;
      isPopstate: boolean;
      strategyKey: string;
    }) =>
      Effect.gen(function* () {
        if (opts.strategyKey === "__none__") return;

        // Hash takes priority
        if (opts.hash !== "" && opts.hash !== "#") {
          const id = opts.hash.startsWith("#") ? opts.hash.slice(1) : opts.hash;
          const el = yield* dom.getElementById(id);
          if (el !== null) {
            yield* scroll.scrollIntoView(el);
            return;
          }
        }

        // Popstate: restore saved position
        if (opts.isPopstate) {
          const stored = yield* storage.get(`effect-ui:scroll:${opts.key}`);
          if (stored !== null) {
            const pos = yield* Schema.decode(ScrollPositionJson)(stored);
            yield* scroll.scrollTo(pos.x, pos.y);
          }
          return;
        }

        // New navigation: scroll to top
        yield* scroll.scrollTo(0, 0);
      }).pipe(Effect.ignore);

    // Listen to browser popstate (back/forward) via EventTarget service
    // Lifecycle managed by scope — removed when layer scope closes
    yield* eventTarget.on(globalThis.window, "popstate", (_e: PopStateEvent) =>
      Effect.gen(function* () {
        // Save scroll position for the page we're leaving
        yield* doSaveScroll();

        // Update key from history state
        const state = yield* history.state;
        if (state !== null && typeof state === "object" && "_scrollKey" in (state as object)) {
          currentNavKey = (state as { _scrollKey: string })._scrollKey;
        }

        // Set navigation context for outlet scroll handling
        const hash = yield* location.hash;
        yield* Ref.set(navContextRef, {
          isPopstate: true,
          hash,
          scrollKey: currentNavKey,
        });

        // Read current location and update signals
        const currentPath = yield* location.fullPath;
        yield* updateFromPath(currentPath);
      }).pipe(Effect.ignore),
    );

    yield* Debug.log({ event: "router.popstate.added" });

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

        // Interpolate params into path pattern if provided
        const resolvedPath = options?.params
          ? yield* interpolateParams(targetPath, options.params)
          : targetPath;

        const current = yield* Signal.get(currentSignal);
        yield* Debug.log({
          event: "router.navigate",
          from_path: current.path,
          to_path: resolvedPath,
          ...(options?.replace !== undefined ? { replace: options.replace } : {}),
        });

        // Record navigation metric
        yield* Metrics.recordNavigation;

        // Save scroll position before navigating away (best-effort)
        yield* doSaveScroll();

        const fullPath = yield* buildPath(resolvedPath, options?.query);

        // Generate new key for this navigation entry
        const newKey = yield* generateKey;
        const historyState = { _scrollKey: newKey };

        if (options?.replace) {
          yield* history
            .replaceState(historyState, fullPath)
            .pipe(
              Effect.mapError((cause) => new NavigationError({ operation: "replaceState", cause })),
            );
        } else {
          yield* history
            .pushState(historyState, fullPath)
            .pipe(
              Effect.mapError((cause) => new NavigationError({ operation: "pushState", cause })),
            );
        }

        currentNavKey = newKey;

        // Set navigation context for outlet scroll handling
        const hash = yield* location.hash.pipe(Effect.orElseSucceed(() => ""));
        yield* Ref.set(navContextRef, {
          isPopstate: false,
          hash,
          scrollKey: currentNavKey,
        });

        const { path: newPath, query: newQuery } = yield* parsePath(fullPath);
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

      back: () => Effect.ignore(history.back),

      forward: () => Effect.ignore(history.forward),

      params: <Path extends RoutePath>(_path: Path) =>
        FiberRef.get(CurrentRouteParams) as Effect.Effect<RouteParamsFor<Path>>,

      isActive: Effect.fn("RouterService.isActive")(function* (
        targetPath: string,
        options?: IsActiveOptions,
      ) {
        const resolvedPath = options?.params
          ? yield* interpolateParams(targetPath, options.params)
          : targetPath;
        const route = yield* Signal.get(currentSignal);
        if (options?.exact) {
          return route.path === resolvedPath;
        }
        return route.path.startsWith(resolvedPath);
      }),

      prefetch: Effect.fn("RouterService.prefetch")(function* (targetPath: string) {
        // Prefetch is handled at the route level via .prefetch() chains.
        // This method is a best-effort hint for link-level prefetching.
        yield* Debug.log({
          event: "router.prefetch.start",
          path: targetPath,
          route_pattern: targetPath,
          module_count: 0,
        });
      }),

      _navigationContext: navContextRef,

      _applyScroll: (opts) =>
        Effect.gen(function* () {
          const navCtx = yield* Ref.get(navContextRef);
          yield* doApplyScroll({
            key: navCtx.scrollKey,
            hash: navCtx.hash,
            isPopstate: navCtx.isPopstate,
            strategyKey: opts.strategyKey,
          });
        }),

      _saveScroll: doSaveScroll(),
    };

    // Store router in FiberRef during layer building.
    // ManagedRuntime captures FiberRefs at layer build time and propagates
    // them to all forked fibers, solving the fiber-local variable problem.
    yield* FiberRef.set(CurrentRouter, Option.some(routerService));

    // F-001: Setup viewport prefetch observer
    // Uses Observer + Dom services, auto-cleanup via Scope. Best-effort.
    yield* setupViewportPrefetch(routerService).pipe(Effect.ignore);

    return routerService;
  }),
);

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
      const { path, query: initialQuery } = yield* parsePath(initialPath);

      // Create signals for current route and query
      const currentSignal = yield* Signal.make<Route>({
        path,
        params: {},
        query: initialQuery,
      });

      const querySignal = yield* Signal.make<URLSearchParams>(initialQuery);

      // Navigation context for outlet scroll handling (no-op in tests)
      const navContextRef = yield* Ref.make<NavigationContext>({
        isPopstate: false,
        hash: "",
        scrollKey: "",
      });

      // History stack for back/forward (in-memory)
      const historyStack: Array<string> = [initialPath];
      let historyIndex = 0;

      const updateFromPath = (fullPath: string) =>
        Effect.gen(function* () {
          const { path: newPath, query: newQuery } = yield* parsePath(fullPath);
          yield* Signal.set(currentSignal, {
            path: newPath,
            params: {},
            query: newQuery,
          });
          yield* Signal.set(querySignal, newQuery);
        });

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

          // Interpolate params into path pattern if provided
          const resolvedPath = options?.params
            ? yield* interpolateParams(targetPath, options.params)
            : targetPath;

          const current = yield* Signal.get(currentSignal);
          yield* Debug.log({
            event: "router.navigate",
            from_path: current.path,
            to_path: resolvedPath,
            ...(options?.replace !== undefined ? { replace: options.replace } : {}),
          });

          // Record navigation metric
          yield* Metrics.recordNavigation;

          const fullPath = yield* buildPath(resolvedPath, options?.query);
          const { path: newPath, query: newQuery } = yield* parsePath(fullPath);

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
          Effect.gen(function* () {
            if (historyIndex > 0) {
              historyIndex--;
              const path = historyStack[historyIndex];
              if (path !== undefined) {
                yield* updateFromPath(path);
              }
            }
          }),

        forward: () =>
          Effect.gen(function* () {
            if (historyIndex < historyStack.length - 1) {
              historyIndex++;
              const path = historyStack[historyIndex];
              if (path !== undefined) {
                yield* updateFromPath(path);
              }
            }
          }),

        params: <Path extends RoutePath>(_path: Path) =>
          FiberRef.get(CurrentRouteParams) as Effect.Effect<RouteParamsFor<Path>>,

        isActive: Effect.fn("RouterService.isActive")(function* (
          targetPath: string,
          options?: IsActiveOptions,
        ) {
          const resolvedPath = options?.params
            ? yield* interpolateParams(targetPath, options.params)
            : targetPath;
          const route = yield* Signal.get(currentSignal);
          if (options?.exact) {
            return route.path === resolvedPath;
          }
          return route.path.startsWith(resolvedPath);
        }),

        prefetch: Effect.fn("RouterService.prefetch")(function* (targetPath: string) {
          // Routing handles prefetch at the route level via .prefetch() chains.
          yield* Debug.log({
            event: "router.prefetch.start",
            path: targetPath,
            route_pattern: targetPath,
            module_count: 0,
          });
        }),

        _navigationContext: navContextRef,
        _applyScroll: () => Effect.void,
        _saveScroll: Effect.void,
      };

      // Store router in FiberRef
      yield* FiberRef.set(CurrentRouter, Option.some(routerService));

      return routerService;
    }),
  );
