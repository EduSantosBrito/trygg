/**
 * Router service and navigation helpers for `trygg/router`.
 *
 * @remarks
 * Owner module for programmatic navigation. This module owns the router service
 * tag, current-route accessors, navigation effects, active-link state helpers,
 * and the browser and test layers that back the router runtime.
 *
 * @see ./service.docs.md - Source-owned topic guide
 * @since 1.0.0
 * @module trygg/router/service
 */
import {
  Cause,
  Deferred,
  Effect,
  Exit,
  Fiber,
  Layer,
  Option,
  Random,
  Ref,
  Schema,
  Scope,
} from "effect";
import * as Context from "effect/Context";
import { CurrentRouteQuery } from "./route.js";

import * as Signal from "../primitives/signal.js";
import * as Metrics from "../debug/metrics.js";
import * as Trace from "../trace/index.js";
import type {
  DecodedRouteParams,
  DecodedRouteParamsByPattern,
  Route,
  RouterService,
  NavigateArguments,
  NavigateOptions,
  NavigationContext,
  IsActiveArguments,
  RouteErrorInfo,
  RoutePath,
  RouteParamsFor,
  RouteQueryFor,
  ScrollApplyPayload,
  OutletPrefetchState,
} from "./types.js";
import { NavigationError, RouteParamsPatternMismatch } from "./types.js";
import type { Element } from "../primitives/element.js";
import { parsePath } from "./utils.js";
import { SessionStorage, type StorageService } from "../platform/storage.js";
import { Scroll, type ScrollService } from "../platform/scroll.js";
import { Dom, DomError, type DomService } from "../platform/dom.js";
import { History } from "../platform/history.js";
import { Location } from "../platform/location.js";
import { PlatformEventTarget } from "../platform/event-target.js";
import { Observer, ObserverError } from "../platform/observer.js";
import { getFiberRef, locallyFiberRef, setFiberRef } from "../internal/fiber-ref.js";
import { ScrollStrategyType } from "./scroll-strategy.js";
import {
  NavigationAdapter,
  makePublishingNavigationCore,
  NavigationCoreError,
  type NavigationSnapshot,
  navigationTarget,
  resolveNavigationTarget,
  sameQuery,
} from "./navigation-core.js";
import {
  NavigationOutletCoordination,
  type ScrollIntent,
} from "./navigation-outlet-coordination.js";

/** @internal */
const ScrollPosition = Schema.Struct({ x: Schema.Number, y: Schema.Number });
/** @internal */
const ScrollPositionJson = Schema.fromJsonString(ScrollPosition);
/** @internal Schema for history.state scroll key — replaces unsafe `as` casts. */
const ScrollState = Schema.Struct({ _scrollKey: Schema.String });
/** @internal */
const decodeScrollState = Schema.decodeUnknownOption(ScrollState);
/** @internal */
const encodeScrollPositionJson = Schema.encodeUnknownEffect(ScrollPositionJson);
/** @internal */
const decodeScrollPositionJson = Schema.decodeUnknownEffect(ScrollPositionJson);

interface ScrollApplicationDependencies {
  readonly storage: Pick<StorageService, "get">;
  readonly scroll: Pick<ScrollService, "scrollIntoView" | "scrollTo">;
  readonly dom: Pick<DomService, "getElementById">;
}

/** Apply one activation-owned scroll intent, recovering typed adapter failures only. */
export const applyScrollForNavigation = (
  dependencies: ScrollApplicationDependencies,
  options: { readonly strategy: ScrollStrategyType; readonly intent: ScrollIntent },
): Effect.Effect<ScrollApplyPayload, unknown> =>
  Effect.gen(function* () {
    const payloadBase = {
      strategy: options.strategy._tag,
      hash: options.intent.hash,
      isPopstate: options.intent.isPopstate,
      scrollKey: options.intent.scrollKey,
    };
    if (ScrollStrategyType.$is("None")(options.strategy)) {
      const payload: ScrollApplyPayload = { ...payloadBase, kind: "none" };
      return payload;
    }

    if (options.intent.hash !== "" && options.intent.hash !== "#") {
      const id = options.intent.hash.startsWith("#")
        ? options.intent.hash.slice(1)
        : options.intent.hash;
      const element = yield* dependencies.dom.getElementById(id);
      if (element !== null) {
        yield* dependencies.scroll.scrollIntoView(element);
        const payload: ScrollApplyPayload = { ...payloadBase, kind: "hash" };
        return payload;
      }
    }

    if (options.intent.isPopstate) {
      const stored = yield* dependencies.storage.get(`trygg:scroll:${options.intent.scrollKey}`);
      if (stored !== null) {
        const position = yield* decodeScrollPositionJson(stored);
        yield* Trace.emit("router.scroll.restore", () => ({
          key: options.intent.scrollKey,
          x: position.x,
          y: position.y,
        }));
        yield* dependencies.scroll.scrollTo(position.x, position.y);
        const payload: ScrollApplyPayload = {
          ...payloadBase,
          kind: "restore",
          restored: true,
        };
        return payload;
      }
      const payload: ScrollApplyPayload = {
        ...payloadBase,
        kind: "restore",
        restored: false,
      };
      return payload;
    }

    yield* Trace.emit("router.scroll.top");
    yield* dependencies.scroll.scrollTo(0, 0);
    const payload: ScrollApplyPayload = { ...payloadBase, kind: "top" };
    return payload;
  }).pipe(
    Effect.catchCause((cause) =>
      cause.reasons.length > 0 && cause.reasons.every(Cause.isFailReason)
        ? Effect.succeed<ScrollApplyPayload>({
            strategy: options.strategy._tag,
            hash: options.intent.hash,
            isPopstate: options.intent.isPopstate,
            scrollKey: options.intent.scrollKey,
            kind: "ignoredError",
          })
        : Effect.failCause(cause),
    ),
  );

const toNavigationError = (cause: NavigationCoreError): NavigationError =>
  new NavigationError({ operation: cause.operation, cause });

const reportPublicationExit = (
  snapshot: NavigationSnapshot,
  exit: Exit.Exit<boolean>,
): Effect.Effect<void> =>
  Exit.isFailure(exit)
    ? Trace.emit("router.error", () => ({
        operation: "publication",
        navigation_id: snapshot.navigationId,
        cause_type: Trace.causeValueType(exit.cause),
        interrupted: Cause.hasInterrupts(exit.cause),
      }))
    : Effect.void;

// F-001: Viewport prefetch constants from framework research
/** IntersectionObserver threshold - 10% visible triggers prefetch */
const INTERSECTION_THRESHOLD = 0.1;
/** IntersectionObserver rootMargin for slight lookahead */
const INTERSECTION_ROOT_MARGIN = "100px";
/** Data attribute for viewport prefetch links */
const PREFETCH_ATTR = "data-trygg-prefetch";
/** Data attribute for prefetch path */
const PREFETCH_PATH_ATTR = "data-trygg-prefetch-path";

/**
 * Setup global viewport prefetch observer.
 * Uses Observer + Idle + Dom services for lifecycle-managed prefetching.
 * SvelteKit-style: single global observer for all viewport prefetch links.
 *
 * Cleanup is automatic via Scope finalizers.
 *
 * @internal
 */
const logViewportPrefetchFailure = (operation: string, cause: unknown): Effect.Effect<void> =>
  Trace.emit("router.viewport.observer.error", () => ({
    operation,
    cause_type: Trace.valueType(cause),
  }));

const setupViewportPrefetch: (
  router: RouterService,
) => Effect.Effect<void, DomError | ObserverError, Dom | Observer | Scope.Scope> = Effect.fn(
  "RouterService.setupViewportPrefetch",
)(function* (router: RouterService) {
  const dom = yield* Dom;
  const observer = yield* Observer;

  // Track observed elements to avoid double-observing
  const observed = new WeakSet<globalThis.Element>();

  // Use mutable ref to break circular reference (handle used in its own callback)
  let handleRef:
    | {
        observe: (el: globalThis.Element) => Effect.Effect<void, ObserverError>;
        unobserve: (el: globalThis.Element) => Effect.Effect<void, ObserverError>;
      }
    | undefined;

  const prefetchViewportEntry = Effect.fn("RouterService.prefetchViewportEntry")(function* (
    entry: IntersectionObserverEntry,
  ) {
    const anchor = entry.target;

    // Unobserve immediately (one-shot)
    if (handleRef !== undefined) {
      yield* handleRef.unobserve(anchor);
    }

    // Get prefetch path from attribute
    const path = yield* dom.getAttribute(anchor, PREFETCH_PATH_ATTR);
    if (path === null) return;

    // Run prefetch directly (IntersectionObserver already fires async)
    yield* Trace.emit("router.prefetch.viewport", () => ({ path }));
    yield* Trace.emit("router.prefetch.trigger", () => ({
      path,
      trigger: "viewport",
    }));
    yield* router.prefetch(path);
  });

  // Create IntersectionObserver via service (auto-disconnect on scope close)
  const handle = yield* observer.intersection({
    threshold: INTERSECTION_THRESHOLD,
    rootMargin: INTERSECTION_ROOT_MARGIN,
    onIntersect: (entry) =>
      prefetchViewportEntry(entry).pipe(
        Effect.catch((cause) => logViewportPrefetchFailure("intersection", cause)),
      ),
  });

  handleRef = handle;

  // Observe a viewport prefetch link
  const observeLink = Effect.fn("RouterService.observeViewportPrefetchLink")(function* (
    anchor: globalThis.Element,
  ) {
    if (observed.has(anchor)) return;
    observed.add(anchor);
    yield* handle.observe(anchor);
  });

  // Scan and observe all viewport prefetch links in a subtree
  const scanLinks = Effect.fn("RouterService.scanViewportPrefetchLinks")(function* (
    root: ParentNode,
  ) {
    const links = yield* dom.querySelectorAll(`[${PREFETCH_ATTR}="viewport"]`, root);
    for (const link of links) {
      yield* observeLink(link);
    }
  });

  // Initial scan of existing links
  const body = yield* dom.body;
  yield* scanLinks(body);

  // MutationObserver to detect new links (auto-disconnect on scope close)
  const observeMutatedLinks = Effect.fn("RouterService.observeMutatedViewportLinks")(function* (
    mutations: ReadonlyArray<MutationRecord>,
  ) {
    for (const mutation of mutations) {
      for (const node of mutation.addedNodes) {
        if (node.nodeType !== 1) continue; // ELEMENT_NODE
        if (!(node instanceof globalThis.Element)) continue;
        const el = node;

        // Check if the node itself is a viewport prefetch link
        const isMatch = yield* dom.matches(el, `[${PREFETCH_ATTR}="viewport"]`);
        if (isMatch) {
          yield* observeLink(el);
        }

        // Check children for viewport prefetch links
        yield* scanLinks(el);
      }
    }
  });

  yield* observer.mutation(body, { childList: true, subtree: true }, (mutations) =>
    observeMutatedLinks(mutations).pipe(
      Effect.catch((cause) => logViewportPrefetchFailure("mutation", cause)),
    ),
  );

  yield* Trace.emit("router.viewport.observer.added");
});

/**
 * Router service key
 *
 * @remarks
 * Yield `Router` inside Effects when you need direct access to the active
 * router implementation rather than the convenience helpers exported beside it.
 *
 * @example
 * ```ts
 * const router = yield* Router
 * ```
 *
 * @category Router Navigation
 * @public
 * @since 1.0.0
 */
export interface Router extends Context.Service<
  Router,
  {
    readonly current: Signal.Signal<Route>;
    readonly navigate: <Path extends RoutePath>(
      path: Path,
      ...options: NavigateArguments<Path>
    ) => Effect.Effect<void, NavigationError>;
    readonly back: () => Effect.Effect<void, NavigationError>;
    readonly forward: () => Effect.Effect<void, NavigationError>;
    readonly params: <Path extends RoutePath>(
      path: Path,
    ) => Effect.Effect<RouteParamsFor<Path>, RouteParamsPatternMismatch>;
    readonly query: Signal.Signal<URLSearchParams>;
    readonly isActive: <Path extends RoutePath>(
      path: Path,
      ...options: IsActiveArguments<Path>
    ) => Effect.Effect<Signal.Signal<boolean>, NavigationError, Scope.Scope>;
    readonly prefetch: (path: string) => Effect.Effect<void>;
    readonly outletCoordination: {
      readonly prefetchState: Effect.Effect<OutletPrefetchState>;
      readonly activatePrefetch: (
        prefetch: (path: string) => Effect.Effect<void>,
      ) => Effect.Effect<void>;
      readonly awaitOutletReady: Effect.Effect<void>;
      readonly applyScroll: (options: {
        readonly strategy: ScrollStrategyType;
        readonly intent: import("./navigation-outlet-coordination.js").ScrollIntent;
      }) => Effect.Effect<ScrollApplyPayload, unknown>;
    };
    readonly _saveScroll: Effect.Effect<void>;
  }
> {}

export const Router = Context.Service<
  Router,
  {
    readonly current: Signal.Signal<Route>;
    readonly navigate: <Path extends RoutePath>(
      path: Path,
      ...options: NavigateArguments<Path>
    ) => Effect.Effect<void, NavigationError>;
    readonly back: () => Effect.Effect<void, NavigationError>;
    readonly forward: () => Effect.Effect<void, NavigationError>;
    readonly params: <Path extends RoutePath>(
      path: Path,
    ) => Effect.Effect<RouteParamsFor<Path>, RouteParamsPatternMismatch>;
    readonly query: Signal.Signal<URLSearchParams>;
    readonly isActive: <Path extends RoutePath>(
      path: Path,
      ...options: IsActiveArguments<Path>
    ) => Effect.Effect<Signal.Signal<boolean>, NavigationError, Scope.Scope>;
    readonly prefetch: (path: string) => Effect.Effect<void>;
    readonly outletCoordination: {
      readonly prefetchState: Effect.Effect<OutletPrefetchState>;
      readonly activatePrefetch: (
        prefetch: (path: string) => Effect.Effect<void>,
      ) => Effect.Effect<void>;
      readonly awaitOutletReady: Effect.Effect<void>;
      readonly applyScroll: (options: {
        readonly strategy: ScrollStrategyType;
        readonly intent: import("./navigation-outlet-coordination.js").ScrollIntent;
      }) => Effect.Effect<ScrollApplyPayload, unknown>;
    };
    readonly _saveScroll: Effect.Effect<void>;
  }
>("@trygg/Router");

/**
 * FiberRef to store current route params for the active route
 * Used by Router.params() to provide type-safe access
 * Uses GlobalValue to ensure single instance even with module duplication (Vite aliasing).
 * @internal
 */
export const CurrentRouteParams = Context.Reference<DecodedRouteParamsByPattern>(
  "trygg/Router/CurrentRouteParams",
  {
    defaultValue: () => new Map(),
  },
);

function narrowDecodedParams<P, E, R>(
  effect: Effect.Effect<DecodedRouteParams, E, R>,
): Effect.Effect<P, E, R>;
function narrowDecodedParams<E, R>(
  effect: Effect.Effect<DecodedRouteParams, E, R>,
): Effect.Effect<unknown, E, R> {
  return effect;
}

const paramsForPattern: (
  path: string,
) => Effect.Effect<DecodedRouteParams, RouteParamsPatternMismatch> = Effect.fnUntraced(function* (
  path: string,
) {
  const paramsByPattern = yield* getFiberRef(CurrentRouteParams);
  const decoded = paramsByPattern.get(path);
  if (decoded === undefined) {
    return yield* new RouteParamsPatternMismatch({
      requestedPattern: path,
      activePatterns: [...paramsByPattern.keys()],
    });
  }
  return decoded;
});

const makeRouteQueryView: (
  current: Signal.Signal<Route>,
) => Effect.Effect<Signal.Signal<URLSearchParams>, Signal.SignalScopeError, Scope.Scope> =
  Effect.fnUntraced(function* (current: Signal.Signal<Route>) {
    const initial = yield* Signal.peek(current);
    const notifications = yield* Signal.make(0);
    let notifiedQuery = initial.query;
    const query: Signal.Signal<URLSearchParams> = {
      ...notifications,
      _cell: {
        get value() {
          return current._cell.value.query;
        },
        set value(value: URLSearchParams) {
          current._cell.value = { ...current._cell.value, query: value };
        },
      },
    };
    const publishNotification = Effect.gen(function* () {
      const route = yield* Signal.peek(current);
      if (sameQuery(notifiedQuery, route.query)) return;
      notifiedQuery = route.query;
      yield* Signal.update(notifications, (revision) => revision + 1);
    });
    const unsubscribe = yield* Signal.subscribe(current, () => publishNotification);
    const scope = yield* Effect.scope;
    yield* Scope.addFinalizer(scope, unsubscribe);
    return query;
  });

/**
 * FiberRef to store the current router service.
 * Set during layer building and propagated via ManagedRuntime to all forked fibers.
 * This replaces the module-level variable approach - FiberRefs set during layer
 * building are captured in the Runtime and copied to forked fibers.
 * Uses GlobalValue to ensure single instance even with module duplication.
 * @internal
 */
export const CurrentRouter = Context.Reference<Option.Option<RouterService>>(
  "trygg/Router/CurrentRouter",
  {
    defaultValue: Option.none,
  },
);

/**
 * FiberRef to store route error info for .error() boundary components.
 * Set by Outlet when a route errors, read by error components via currentError.
 * Uses GlobalValue to ensure single instance even with module duplication.
 * @internal
 */
export const CurrentRouteError = Context.Reference<Option.Option<RouteErrorInfo>>(
  "trygg/Router/CurrentRouteError",
  {
    defaultValue: Option.none,
  },
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
export const CurrentOutletChild = Context.Reference<Option.Option<Ref.Ref<Option.Option<Element>>>>(
  "trygg/Router/CurrentOutletChild",
  {
    defaultValue: Option.none,
  },
);

export const takeCurrentOutletChild: () => Effect.Effect<Option.Option<Element>> = Effect.fn(
  "Router.takeCurrentOutletChild",
)(function* () {
  const outletChildRef = yield* getFiberRef(CurrentOutletChild);
  if (Option.isNone(outletChildRef)) return Option.none();
  return yield* Ref.getAndSet(outletChildRef.value, Option.none());
});

export const setCurrentOutletChild = (
  child: Option.Option<Element>,
): Effect.Effect<void, never, never> =>
  Ref.make(child).pipe(
    Effect.flatMap((outletChildRef) =>
      setFiberRef(CurrentOutletChild, Option.some(outletChildRef)),
    ),
  );

export const locallyCurrentOutletChild = <A, E, R>(
  child: Element,
  effect: Effect.Effect<A, E, R>,
): Effect.Effect<A, E, R> =>
  Ref.make<Option.Option<Element>>(Option.some(child)).pipe(
    Effect.flatMap((outletChildRef) =>
      locallyFiberRef(CurrentOutletChild, Option.some(outletChildRef), effect),
    ),
  );

export class CurrentErrorOutsideBoundaryError extends Schema.TaggedError<CurrentErrorOutsideBoundaryError>()(
  "CurrentErrorOutsideBoundaryError",
  {},
) {}

/**
 * Get the current router service.
 * Uses the Router service key which is provided to all components
 * via the render context in browserLayer.
 *
 * @remarks
 * This is the preferred way to access the router in Effect code when you need
 * to call navigation methods directly.
 *
 * @example
 * ```ts
 * const router = yield* Router.get
 * ```
 *
 * @category Router Navigation
 * @public
 * @since 1.0.0
 */
export const get: Effect.Effect<RouterService, never, Router> = Effect.service(Router);

/**
 * Backward-compatible alias for `get`.
 *
 * @remarks
 * Kept for older code. Prefer `Router.get` for new code.
 *
 * @deprecated Use `Router.get` instead
 * @internal
 */
export const getRouter: Effect.Effect<RouterService, never, Router> = Effect.service(Router);

/**
 * Get the current route signal
 *
 * @remarks
 * Use `current` when you need the reactive `Signal<Route>` itself rather than
 * the current snapshot value.
 *
 * @example
 * ```ts
 * const currentRoute = yield* Router.current
 * ```
 *
 * @category Router Navigation
 * @public
 * @since 1.0.0
 */
export const current: Effect.Effect<Signal.Signal<Route>, never, Router> = Effect.map(
  Effect.service(Router),
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
 * @remarks
 * `currentRoute` is the one-step helper for code that only needs the latest
 * route snapshot and not the underlying signal.
 *
 * @category Router Navigation
 * @public
 * @since 1.0.0
 */
export const currentRoute: Effect.Effect<Route, never, Router> = Effect.gen(function* () {
  const router = yield* Router;
  return yield* Signal.get(router.current);
});

/**
 * Get the raw query params signal (URLSearchParams).
 * For decoded query access, use `queryParams(path)`.
 *
 * @remarks
 * This exposes the raw `URLSearchParams` signal when code needs low-level query
 * inspection instead of schema-decoded values.
 *
 * @example
 * ```ts
 * const query = yield* Router.querySignal
 * ```
 *
 * @category Router Navigation
 * @public
 * @since 1.0.0
 */
export const querySignal: Effect.Effect<Signal.Signal<URLSearchParams>, never, Router> = Effect.map(
  Effect.service(Router),
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
 * @remarks
 * `query` reads the decoded query object the outlet placed in router context
 * for the currently matched route.
 *
 * @category Router Navigation
 * @public
 * @since 1.0.0
 */
export const query = <Path extends RoutePath>(_path: Path): Effect.Effect<RouteQueryFor<Path>> =>
  narrowDecodedParams<RouteQueryFor<Path>, never, never>(getFiberRef(CurrentRouteQuery));

/**
 * Move to a typed route and publish its versioned route/query snapshot.
 *
 * @example
 * ```ts
 * yield* Router.navigate("/users/:id", { params: { id: 123 } })
 * // Navigates to /users/123
 * ```
 *
 * @remarks
 * `navigate` serializes each history mutation with the platform snapshot read
 * that follows it. A newer navigation can supersede that snapshot before it is
 * published; supersession itself is not an error, so the older Effect succeeds
 * when its own transition succeeded and cannot overwrite newer router state.
 *
 * Completion means the history transition has settled and any still-current
 * snapshot has been published. It does not await Outlet matching, DOM swap
 * acknowledgement, or scroll application.
 *
 * @category Router Navigation
 * @public
 * @since 1.0.0
 */
export const navigate: <Path extends RoutePath>(
  path: Path,
  ...options: NavigateArguments<Path>
) => Effect.Effect<void, NavigationError, Router> = <Path extends RoutePath>(
  path: Path,
  ...options: NavigateArguments<Path>
) => Effect.flatMap(Effect.service(Router), (router) => router.navigate(path, ...options));

/**
 * Go back in history
 *
 * @remarks
 * Delegates to the active router's history implementation.
 *
 * @example
 * ```ts
 * yield* Router.back
 * ```
 *
 * @category Router Navigation
 * @public
 * @since 1.0.0
 */
export const back: Effect.Effect<void, NavigationError, Router> = Effect.flatMap(
  Effect.service(Router),
  (router) => router.back(),
);

/**
 * Go forward in history
 *
 * @remarks
 * Delegates to the active router's history implementation.
 *
 * @example
 * ```ts
 * yield* Router.forward
 * ```
 *
 * @category Router Navigation
 * @public
 * @since 1.0.0
 */
export const forward: Effect.Effect<void, NavigationError, Router> = Effect.flatMap(
  Effect.service(Router),
  (router) => router.forward(),
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
 * @remarks
 * `params` reads the decoded params object the outlet placed in router context
 * for the currently matched route.
 *
 * @category Router Navigation
 * @public
 * @since 1.0.0
 */
export const params = <Path extends RoutePath>(
  path: Path,
): Effect.Effect<RouteParamsFor<Path>, RouteParamsPatternMismatch> =>
  narrowDecodedParams<RouteParamsFor<Path>, RouteParamsPatternMismatch, never>(
    paramsForPattern(path),
  );

/**
 * Derive a reactive Signal\<boolean\> that tracks whether a path is active.
 *
 * Returns a `Signal<boolean>` that can be passed directly to JSX attributes
 * for fine-grained DOM updates without component re-render.
 *
 * @example
 * ```tsx
 * // Prefix match (default)
 * const usersActive = yield* Router.isActive("/users")
 *
 * // Exact match
 * const homeActive = yield* Router.isActive("/", { exact: true })
 *
 * // With params (interpolated before comparison)
 * const userActive = yield* Router.isActive("/users/:id", { params: { id: 123 } })
 *
 * // Pass to JSX for fine-grained updates (no component re-render on navigation)
 * const dataActive = yield* Signal.derive(usersActive, a => a ? "true" : "")
 * <Router.Link to="/users" data-active={dataActive}>
 *
 * // If you need the boolean value (subscribes component to route changes):
 * const isActive = yield* Signal.get(usersActive)
 * ```
 *
 * @remarks
 * `isActive` derives a boolean signal from the current route signal so callers
 * can keep active-state rendering fine-grained.
 *
 * @category Router Navigation
 * @public
 * @since 1.0.0
 */
export const isActive: <Path extends RoutePath>(
  path: Path,
  ...options: IsActiveArguments<Path>
) => Effect.Effect<Signal.Signal<boolean>, NavigationError, Router | Scope.Scope> = <
  Path extends RoutePath,
>(
  path: Path,
  ...options: IsActiveArguments<Path>
) => Effect.flatMap(Effect.service(Router), (router) => router.isActive(path, ...options));

/**
 * Prefetch route modules for a path.
 * Loads all modules (component, layouts) for the matched route into cache.
 * Best-effort: failures are silently ignored.
 *
 * @remarks
 * `prefetch` delegates to the outlet-registered resolver, so it only starts
 * doing real work once an outlet has mounted for the current router.
 *
 * @example
 * ```ts
 * yield* Router.prefetch("/users/123")
 * ```
 *
 * @category Router Navigation
 * @public
 * @since 1.0.0
 */
export const prefetch = (path: string): Effect.Effect<void, never, Router> =>
  Effect.flatMap(Effect.service(Router), (router) => router.prefetch(path));

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
 * @remarks
 * `currentError` only succeeds while an error boundary is rendering for the
 * active route.
 *
 * @category Router Navigation
 * @public
 * @since 1.0.0
 */
export const currentError: Effect.Effect<RouteErrorInfo, CurrentErrorOutsideBoundaryError> =
  Effect.flatMap(getFiberRef(CurrentRouteError), (maybeError) => {
    if (Option.isNone(maybeError)) {
      return Effect.fail(new CurrentErrorOutsideBoundaryError());
    }
    return Effect.succeed(maybeError.value);
  });

/**
 * Create a link click handler that navigates to a path
 * Prevents default browser navigation and uses router instead
 *
 * @remarks
 * Lower-level helper used by `Link`. Prefer the component unless you need to
 * wire navigation into a custom element.
 *
 * @internal
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
 *
 * @remarks
 * `browserLayer` wires the router to real browser services, including history,
 * location, scroll management, and viewport-prefetch observation.
 *
 * @example
 * ```ts
 * const app = Router.currentRoute.pipe(Effect.provide(Router.browserLayer))
 * ```
 *
 * @category Router Navigation
 * @public
 * @since 1.0.0
 */
export const browserLayer: Layer.Layer<
  Router,
  NavigationError | Signal.SignalScopeError,
  SessionStorage | Scroll | Dom | History | Location | PlatformEventTarget | Observer
> = Layer.effect(
  Router,
  Effect.gen(function* () {
    // Resolve platform services
    const storage = yield* SessionStorage;
    const scroll = yield* Scroll;
    const dom = yield* Dom;
    const history = yield* History;
    const location = yield* Location;
    const eventTarget = yield* PlatformEventTarget;

    // Disable browser's automatic scroll restoration — trygg manages scroll
    // manually via sessionStorage + ScrollStrategy per route.
    yield* history
      .setScrollRestoration("manual")
      .pipe(
        Effect.mapError(
          (cause) => new NavigationError({ operation: "init.scrollRestoration", cause }),
        ),
      );

    // Get initial location from Location service
    const initialPath = yield* location.fullPath.pipe(
      Effect.mapError((cause) => new NavigationError({ operation: "init.fullPath", cause })),
    );
    const { path, query: initialQuery } = yield* parsePath(initialPath);

    // Generate unique key for scroll position storage
    const generateKey = Effect.map(Random.nextInt, (n) => Math.abs(n).toString(36).slice(0, 8));
    let currentNavKey = yield* generateKey;

    // Ensure initial history state has a key
    const existingState = yield* history.state.pipe(
      Effect.mapError((cause) => new NavigationError({ operation: "init.state", cause })),
    );
    const existingScrollState = decodeScrollState(existingState);
    if (Option.isSome(existingScrollState)) {
      currentNavKey = existingScrollState.value._scrollKey;
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
      navigation: {
        navigationId: 0,
        isPopstate: false,
        hash: "",
        scrollKey: currentNavKey,
      },
    });

    const querySignal = yield* makeRouteQueryView(currentSignal);

    // Navigation context for outlet scroll handling
    const navContextRef = yield* Ref.make<NavigationContext>({
      navigationId: 0,
      isPopstate: false,
      hash: "",
      scrollKey: currentNavKey,
    });

    const outletCoordination = yield* NavigationOutletCoordination.make({
      replayLatestPrefetchState: true,
    });

    // Yield to requestAnimationFrame — lets forked render fibers (microtasks)
    // complete DOM updates before we scroll. Effect.async suspends the current
    // fiber, draining the microtask queue, then rAF fires after layout/paint.
    const afterFrame: Effect.Effect<void> = Effect.promise(
      () => new Promise((resolve) => requestAnimationFrame(() => resolve())),
    );

    type PopstateWaiter = Deferred.Deferred<void>;
    const popstateWaitersRef = yield* Ref.make<ReadonlyArray<PopstateWaiter>>([]);

    const readLocationForPopstate = location.fullPath.pipe(
      Effect.mapError(
        (cause) => new NavigationCoreError({ operation: "location.fullPath", cause }),
      ),
    );
    const readScrollKeyForPopstate = history.state.pipe(
      Effect.map((state) =>
        Option.match(decodeScrollState(state), {
          onNone: () => "",
          onSome: (scrollState) => scrollState._scrollKey,
        }),
      ),
      Effect.mapError((cause) => new NavigationCoreError({ operation: "history.state", cause })),
    );

    const completePopstateWaiters = Effect.gen(function* () {
      const waiters = yield* Ref.getAndSet(popstateWaitersRef, []);
      yield* Effect.forEach(waiters, (waiter) => Deferred.succeed(waiter, undefined), {
        discard: true,
      });
      return waiters.length > 0;
    });

    const waitForPopstateAfter = Effect.fn("RouterService.waitForPopstateAfter")(function* (
      operation: Effect.Effect<void, NavigationCoreError>,
    ) {
      const beforePath = yield* readLocationForPopstate;
      const beforeScrollKey = yield* readScrollKeyForPopstate;
      const waiter = yield* Deferred.make<void>();
      yield* Ref.update(popstateWaitersRef, (waiters) => [...waiters, waiter]);

      const removeWaiter = Ref.update(popstateWaitersRef, (waiters) =>
        waiters.filter((candidate) => candidate !== waiter),
      );

      const noPopstateFallback = Effect.gen(function* () {
        yield* afterFrame;
        yield* afterFrame;
        const afterPath = yield* readLocationForPopstate;
        const afterScrollKey = yield* readScrollKeyForPopstate;
        if (afterPath === beforePath && afterScrollKey === beforeScrollKey) return;
        yield* Deferred.await(waiter);
      });

      yield* operation;
      yield* Effect.raceFirst(Deferred.await(waiter), noPopstateFallback).pipe(
        Effect.ensuring(removeWaiter),
      );
    });

    const navigationAdapter = {
      read: Effect.gen(function* () {
        const fullPath = yield* location.fullPath.pipe(
          Effect.mapError(
            (cause) => new NavigationCoreError({ operation: "location.fullPath", cause }),
          ),
        );
        const { path: snapshotPath, query } = yield* parsePath(fullPath).pipe(
          Effect.mapError((cause) => new NavigationCoreError({ operation: "parsePath", cause })),
        );
        const navigationContext = yield* Ref.get(navContextRef);
        return {
          path: snapshotPath,
          query,
          isPopstate: navigationContext.isPopstate,
          hash: navigationContext.hash,
          scrollKey: navigationContext.scrollKey,
        };
      }),
      push: (url: string, state: unknown) =>
        Effect.gen(function* () {
          yield* history.pushState(state, url);
          const currentContext = yield* Ref.get(navContextRef);
          const scrollState = decodeScrollState(state);
          if (Option.isSome(scrollState)) {
            currentNavKey = scrollState.value._scrollKey;
          }
          const hashIndex = url.indexOf("#");
          yield* Ref.set(navContextRef, {
            navigationId: currentContext.navigationId,
            isPopstate: false,
            hash: hashIndex < 0 ? "" : url.slice(hashIndex),
            scrollKey: currentNavKey,
          });
        }).pipe(
          Effect.mapError((cause) => new NavigationCoreError({ operation: "pushState", cause })),
        ),
      replace: (url: string, state: unknown) =>
        Effect.gen(function* () {
          yield* history.replaceState(state, url);
          const currentContext = yield* Ref.get(navContextRef);
          const scrollState = decodeScrollState(state);
          if (Option.isSome(scrollState)) {
            currentNavKey = scrollState.value._scrollKey;
          }
          const hashIndex = url.indexOf("#");
          yield* Ref.set(navContextRef, {
            navigationId: currentContext.navigationId,
            isPopstate: false,
            hash: hashIndex < 0 ? "" : url.slice(hashIndex),
            scrollKey: currentNavKey,
          });
        }).pipe(
          Effect.mapError((cause) => new NavigationCoreError({ operation: "replaceState", cause })),
        ),
      back: waitForPopstateAfter(
        history.back.pipe(
          Effect.mapError((cause) => new NavigationCoreError({ operation: "history.back", cause })),
        ),
      ),
      forward: waitForPopstateAfter(
        history.forward.pipe(
          Effect.mapError(
            (cause) => new NavigationCoreError({ operation: "history.forward", cause }),
          ),
        ),
      ),
    };
    const publicationScope = yield* Effect.scope;
    const navigationCore = yield* makePublishingNavigationCore(
      { notifyUnchangedQuery: false },
      navigationAdapter,
      publicationScope,
      (snapshot) =>
        applyNavigationSnapshot(snapshot).pipe(
          Effect.onExit((exit) => reportPublicationExit(snapshot, exit)),
        ),
    ).pipe(Effect.mapError((cause) => new NavigationError({ operation: cause.operation, cause })));

    const applyNavigationSnapshot: (snapshot: NavigationSnapshot) => Effect.Effect<boolean> =
      Effect.fn("RouterService.applyNavigationSnapshot")(function* (snapshot: NavigationSnapshot) {
        const latest = yield* navigationCore.current;
        if (latest.navigationId !== snapshot.navigationId) return false;
        const before = yield* Signal.peek(currentSignal);
        yield* Signal.update(currentSignal, (current) => {
          if (current.navigation.navigationId >= snapshot.navigationId) return current;
          const queryChanged = !sameQuery(current.query, snapshot.query);
          return {
            path: snapshot.path,
            params: {},
            query: queryChanged ? snapshot.query : current.query,
            navigation: {
              navigationId: snapshot.navigationId,
              isPopstate: snapshot.isPopstate,
              hash: snapshot.hash,
              scrollKey: snapshot.scrollKey,
            },
          };
        });
        const published = yield* Signal.peek(currentSignal);
        if (published.navigation.navigationId !== snapshot.navigationId) return false;
        const afterPublish = yield* navigationCore.current;
        if (afterPublish.navigationId !== snapshot.navigationId) return false;
        const queryChanged = !sameQuery(before.query, published.query);
        yield* Trace.emit("router.current.set", () => ({
          fromPath: before.path,
          toPath: published.path,
        }));
        yield* Trace.emit("router.query.set", () => ({
          fromQuery: before.query.toString(),
          toQuery: published.query.toString(),
          changed: queryChanged,
          notified: queryChanged,
        }));
        return true;
      });

    // Save scroll using captured services. Failures are logged because scroll save is best-effort.
    const doSaveScroll = Effect.gen(function* () {
      const pos = yield* scroll.getPosition;
      yield* Trace.emit("router.scroll.save", () => ({
        key: currentNavKey,
        x: pos.x,
        y: pos.y,
      }));
      const encoded = yield* encodeScrollPositionJson(pos);
      yield* storage.set(`trygg:scroll:${currentNavKey}`, encoded);
    }).pipe(
      Effect.catch((cause) =>
        Trace.emit("router.scroll.save.error", () => ({ cause_type: Trace.valueType(cause) })),
      ),
    );

    // Listen to browser popstate (back/forward) via EventTarget service
    // Lifecycle managed by scope — removed when layer scope closes
    yield* eventTarget
      .on(globalThis.window, "popstate", (_event) =>
        Effect.gen(function* () {
          // Save scroll position for the page we're leaving
          yield* doSaveScroll;

          // Update key from history state
          const state = yield* history.state;
          const popScrollState = decodeScrollState(state);
          if (Option.isSome(popScrollState)) {
            currentNavKey = popScrollState.value._scrollKey;
          }

          // Set navigation context for outlet scroll handling
          const hash = yield* location.hash;
          const currentContext = yield* Ref.get(navContextRef);
          yield* Ref.set(navContextRef, {
            navigationId: currentContext.navigationId,
            isPopstate: true,
            hash,
            scrollKey: currentNavKey,
          });

          const internalNavigation = yield* completePopstateWaiters;
          if (!internalNavigation) {
            const { publication } = yield* navigationCore.refresh.pipe(
              Effect.mapError(toNavigationError),
            );
            yield* Fiber.join(publication);
          }
        }).pipe(
          Effect.ensuring(completePopstateWaiters.pipe(Effect.asVoid)),
          Effect.catch((cause) =>
            Trace.emit("router.popstate.error", () => ({ cause_type: Trace.valueType(cause) })),
          ),
        ),
      )
      .pipe(
        Effect.mapError(
          (cause) => new NavigationError({ operation: "init.popstateListener", cause }),
        ),
      );

    yield* Trace.emit("router.popstate.added");

    const routerService: RouterService = {
      current: currentSignal,
      query: querySignal,

      navigate: <Path extends RoutePath>(targetPath: Path, ...args: NavigateArguments<Path>) =>
        Effect.gen(function* () {
          const options = args[0];
          const target = navigationTarget(targetPath, options);
          const fullPath = yield* resolveNavigationTarget(target).pipe(
            Effect.mapError((cause) => new NavigationError({ operation: cause.operation, cause })),
          );
          const { path: resolvedPath } = yield* parsePath(fullPath);

          const current = yield* Signal.get(currentSignal);
          yield* Trace.emit("router.navigate.request", () => ({
            fromPath: current.path,
            toPath: resolvedPath,
            replace: options?.replace === true,
          }));

          // Record navigation metric
          yield* Metrics.recordNavigation;

          // Save scroll position before navigating away (best-effort)
          yield* doSaveScroll;

          const { snapshot, publication } = yield* navigationCore
            .navigate(target)
            .pipe(
              Effect.mapError(
                (cause) => new NavigationError({ operation: cause.operation, cause }),
              ),
            );

          const applied = yield* Fiber.join(publication);
          if (!applied) return;
          yield* Trace.emit(options?.replace ? "history.replace" : "history.push", () => ({
            path: fullPath,
          }));

          yield* Trace.emit("router.navigate.commit", () => ({
            path: fullPath,
            query: snapshot.query.toString(),
          }));
          yield* Trace.emit("router.navigate.stateApplied", () => ({ path: fullPath }));
        }),

      back: () =>
        Effect.gen(function* () {
          const before = yield* Signal.get(currentSignal);
          const { publication } = yield* navigationCore.back.pipe(
            Effect.mapError(toNavigationError),
          );
          yield* Fiber.join(publication);
          const after = yield* Signal.get(currentSignal);
          yield* Trace.emit("history.back", () => ({
            fromPath: before.path,
            toPath: after.path,
          }));
        }),

      forward: () =>
        Effect.gen(function* () {
          const before = yield* Signal.get(currentSignal);
          const { publication } = yield* navigationCore.forward.pipe(
            Effect.mapError(toNavigationError),
          );
          yield* Fiber.join(publication);
          const after = yield* Signal.get(currentSignal);
          yield* Trace.emit("history.forward", () => ({
            fromPath: before.path,
            toPath: after.path,
          }));
        }),

      params: <Path extends RoutePath>(path: Path) =>
        narrowDecodedParams<RouteParamsFor<Path>, RouteParamsPatternMismatch, never>(
          paramsForPattern(path),
        ),

      isActive: <Path extends RoutePath>(targetPath: Path, ...args: IsActiveArguments<Path>) =>
        Effect.gen(function* () {
          const options = args[0];
          const target = navigationTarget(targetPath, options);
          const resolvedPath = yield* resolveNavigationTarget(target).pipe(
            Effect.mapError(toNavigationError),
          );
          const pathOnly = resolvedPath.split("?")[0] ?? resolvedPath;
          const matcher = options?.exact
            ? (route: Route) => route.path === pathOnly
            : (route: Route) => route.path.startsWith(pathOnly);
          return yield* Signal.derive(currentSignal, matcher);
        }),

      prefetch: Effect.fn("RouterService.prefetch")(function* (targetPath: string) {
        yield* Trace.emit("router.prefetch.start", () => ({ path: targetPath }));
        yield* outletCoordination.prefetch(targetPath);
      }),

      outletCoordination: {
        prefetchState: outletCoordination.prefetchState,
        activatePrefetch: outletCoordination.activatePrefetch,
        awaitOutletReady: Effect.flatMap(outletCoordination.outletReady, Deferred.await),
        applyScroll: (options) => applyScrollForNavigation({ storage, scroll, dom }, options),
      },

      _saveScroll: doSaveScroll,
    };

    // Store router in FiberRef during layer building.
    // ManagedRuntime captures FiberRefs at layer build time and propagates
    // them to all forked fibers, solving the fiber-local variable problem.
    yield* setFiberRef(CurrentRouter, Option.some(routerService));

    // F-001: Setup viewport prefetch observer
    // Uses Observer + Dom services, auto-cleanup via Scope. Best-effort.
    yield* setupViewportPrefetch(routerService).pipe(
      Effect.catch((cause) =>
        Trace.emit("router.viewport.observer.error", () => ({
          operation: "setup",
          cause_type: Trace.valueType(cause),
        })),
      ),
    );

    return routerService;
  }).pipe(Effect.annotateLogs({ service: "Router", constructor: "browser" })),
);

/**
 * Create a test router layer
 * Uses in-memory state instead of window.location/history.
 * Useful for unit tests that don't have a DOM or need isolated routing.
 *
 * @param initialPath - The initial path (defaults to "/")
 *
 * @remarks
 * `testLayer` keeps navigation purely in memory so router-aware Effects and
 * components can run in unit tests without browser platform services.
 *
 * @example
 * ```ts
 * const program = Router.navigate("/users").pipe(Effect.provide(Router.testLayer("/")))
 * ```
 *
 * @category Router Navigation
 * @public
 * @since 1.0.0
 */
export const testLayer = (
  initialPath: string = "/",
): Layer.Layer<Router, NavigationError | Signal.SignalScopeError> =>
  Layer.effect(
    Router,
    Effect.gen(function* () {
      const { path, query: initialQuery } = yield* parsePath(initialPath);

      // Create signals for current route and query
      const currentSignal = yield* Signal.make<Route>({
        path,
        params: {},
        query: initialQuery,
        navigation: {
          navigationId: 0,
          isPopstate: false,
          hash: "",
          scrollKey: "memory-0",
        },
      });

      const querySignal = yield* makeRouteQueryView(currentSignal);

      const outletCoordination = yield* NavigationOutletCoordination.make({
        replayLatestPrefetchState: true,
      });

      const navigationAdapter = yield* NavigationAdapter.makeInMemory(initialPath).pipe(
        Effect.mapError(toNavigationError),
      );
      const publicationScope = yield* Effect.scope;
      const navigationCore = yield* makePublishingNavigationCore(
        { notifyUnchangedQuery: false },
        navigationAdapter,
        publicationScope,
        (snapshot) =>
          applyNavigationSnapshot(snapshot).pipe(
            Effect.onExit((exit) => reportPublicationExit(snapshot, exit)),
          ),
      ).pipe(Effect.mapError(toNavigationError));

      const applyNavigationSnapshot: (snapshot: NavigationSnapshot) => Effect.Effect<boolean> =
        Effect.fn("RouterService.applyNavigationSnapshot")(function* (
          snapshot: NavigationSnapshot,
        ) {
          const latest = yield* navigationCore.current;
          if (latest.navigationId !== snapshot.navigationId) return false;
          const before = yield* Signal.peek(currentSignal);
          yield* Signal.update(currentSignal, (current) => {
            if (current.navigation.navigationId >= snapshot.navigationId) return current;
            const queryChanged = !sameQuery(current.query, snapshot.query);
            return {
              path: snapshot.path,
              params: {},
              query: queryChanged ? snapshot.query : current.query,
              navigation: {
                navigationId: snapshot.navigationId,
                isPopstate: snapshot.isPopstate,
                hash: snapshot.hash,
                scrollKey: snapshot.scrollKey,
              },
            };
          });
          const published = yield* Signal.peek(currentSignal);
          if (published.navigation.navigationId !== snapshot.navigationId) return false;
          const afterPublish = yield* navigationCore.current;
          if (afterPublish.navigationId !== snapshot.navigationId) return false;
          const queryChanged = !sameQuery(before.query, published.query);
          yield* Trace.emit("router.current.set", () => ({
            fromPath: before.path,
            toPath: published.path,
          }));
          yield* Trace.emit("router.query.set", () => ({
            fromQuery: before.query.toString(),
            toQuery: published.query.toString(),
            changed: queryChanged,
            notified: queryChanged,
          }));
          return true;
        });

      const routerService: RouterService = {
        current: currentSignal,
        query: querySignal,

        navigate: <Path extends RoutePath>(targetPath: Path, ...args: NavigateArguments<Path>) =>
          Effect.gen(function* () {
            const options = args[0];
            const target = navigationTarget(targetPath, options);
            const resolvedPath = yield* resolveNavigationTarget(target).pipe(
              Effect.mapError(
                (cause) => new NavigationError({ operation: cause.operation, cause }),
              ),
            );
            const current = yield* Signal.get(currentSignal);
            yield* Trace.emit("router.navigate.request", () => ({
              fromPath: current.path,
              toPath: resolvedPath,
              replace: options?.replace === true,
            }));

            // Record navigation metric
            yield* Metrics.recordNavigation;

            const { snapshot, publication } = yield* navigationCore
              .navigate(target)
              .pipe(
                Effect.mapError(
                  (cause) => new NavigationError({ operation: cause.operation, cause }),
                ),
              );
            const applied = yield* Fiber.join(publication);
            if (!applied) return;
            yield* Trace.emit(options?.replace ? "history.replace" : "history.push", () => ({
              path: resolvedPath,
            }));

            yield* Trace.emit("router.navigate.commit", () => ({
              path: resolvedPath,
              query: snapshot.query.toString(),
            }));
            yield* Trace.emit("router.navigate.stateApplied", () => ({ path: resolvedPath }));
          }),

        back: () =>
          Effect.gen(function* () {
            const before = yield* Signal.get(currentSignal);
            const { publication } = yield* navigationCore.back.pipe(
              Effect.mapError(toNavigationError),
            );
            yield* Fiber.join(publication);
            const after = yield* Signal.get(currentSignal);
            yield* Trace.emit("history.back", () => ({
              fromPath: before.path,
              toPath: after.path,
            }));
          }),

        forward: () =>
          Effect.gen(function* () {
            const before = yield* Signal.get(currentSignal);
            const { publication } = yield* navigationCore.forward.pipe(
              Effect.mapError(toNavigationError),
            );
            yield* Fiber.join(publication);
            const after = yield* Signal.get(currentSignal);
            yield* Trace.emit("history.forward", () => ({
              fromPath: before.path,
              toPath: after.path,
            }));
          }),

        params: <Path extends RoutePath>(path: Path) =>
          narrowDecodedParams<RouteParamsFor<Path>, RouteParamsPatternMismatch, never>(
            paramsForPattern(path),
          ),

        isActive: <Path extends RoutePath>(targetPath: Path, ...args: IsActiveArguments<Path>) =>
          Effect.gen(function* () {
            const options = args[0];
            const target = navigationTarget(targetPath, options);
            const resolvedPath = yield* resolveNavigationTarget(target).pipe(
              Effect.mapError(toNavigationError),
            );
            const matcher = options?.exact
              ? (route: Route) => route.path === resolvedPath.split("?")[0]
              : (route: Route) => route.path.startsWith(resolvedPath.split("?")[0] ?? resolvedPath);
            return yield* Signal.derive(currentSignal, matcher);
          }),

        prefetch: Effect.fn("RouterService.prefetch")(function* (targetPath: string) {
          yield* Trace.emit("router.prefetch.start", () => ({ path: targetPath }));
          yield* outletCoordination.prefetch(targetPath);
        }),

        outletCoordination: {
          prefetchState: outletCoordination.prefetchState,
          activatePrefetch: outletCoordination.activatePrefetch,
          awaitOutletReady: Effect.flatMap(outletCoordination.outletReady, Deferred.await),
          applyScroll: ({ strategy, intent }) =>
            Effect.succeed({
              kind: ScrollStrategyType.$is("None")(strategy) ? "none" : "top",
              strategy: strategy._tag,
              hash: intent.hash,
              isPopstate: intent.isPopstate,
              scrollKey: intent.scrollKey,
            }),
        },
        _saveScroll: Effect.void,
      };

      // Store router in FiberRef
      yield* setFiberRef(CurrentRouter, Option.some(routerService));

      return routerService;
    }).pipe(Effect.annotateLogs({ service: "Router", constructor: "test" })),
  );
