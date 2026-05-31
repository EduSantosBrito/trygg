/**
 * Public router entrypoint for trygg.
 *
 * @remarks
 * Owner module for the router entry surface. This module owns the `Route` and
 * `Routes` namespace objects and re-exports the supported navigation, matching,
 * outlet, link, params, and strategy APIs from the router owner modules.
 *
 * ## Quick Start
 *
 * ```tsx
 * // app/routes.ts
 * import { Route, Routes } from "trygg/router"
 *
 * export const routes = Routes.make()
 *   .add(Route.make("/").component(HomePage))
 *   .add(Route.make("/users/:id")
 *     .params(Schema.Struct({ id: Schema.NumberFromString }))
 *     .component(UserProfile))
 * ```
 *
 * ```tsx
 * // app/main.tsx
 * import { mount, Component } from "trygg"
 * import * as Router from "trygg/router"
 * import { routes } from "./routes"
 *
 * const App = Component.gen(function* () {
 *   return (
 *     <div>
 *       <nav>
 *         <Router.Link to="/">Home</Router.Link>
 *         <Router.Link to="/users">Users</Router.Link>
 *       </nav>
 *       <Router.Outlet routes={routes.manifest} />
 *     </div>
 *   )
 * })
 *
 * const root = document.getElementById("root")
 * if (root !== null) {
 *   mount(root, App)
 * }
 * ```
 *
 * @see ./router.docs.md - Source-owned topic guide
 * @since 1.0.0
 * @module trygg/router
 */

// Types (shared)
export type {
  Route as RouteState,
  RouteParams,
  NavigateOptions,
  IsActiveOptions,
  RouterService,
  RouteErrorInfo,
  RouteComponent,
  ComponentLoader,
  ComponentInput,
  ExtractRouteParams,
  RouteParamsFor,
  TypeSafeLinkProps,
  RouteMap,
  RoutePath,
} from "./types.js";

export { buildPathWithParams, InvalidRouteComponent, NavigationError } from "./types.js";

// Router service
export {
  Router,
  get,
  getRouter,
  current,
  currentRoute,
  query,
  querySignal,
  navigate,
  back,
  forward,
  params,
  isActive,
  link,
  prefetch,
  browserLayer,
  testLayer,
  currentError,
} from "./service.js";

// Outlet
export { Outlet } from "./outlet.js";
export type { OutletProps } from "./outlet.js";

// Outlet Services (exposed for testing)
export {
  OutletRenderer,
  BoundaryResolver,
  AsyncLoader,
  AsyncLoadState,
} from "./outlet-services.js";
export type {
  OutletRendererShape,
  BoundaryResolverShape,
  AsyncLoaderShape,
  AsyncLoadState as AsyncLoadStateType,
} from "./outlet-services.js";

// Link
export { Link } from "./link.js";
export type { LinkProps, PrefetchStrategy } from "./link.js";

// Matching (RouteMatcher is now a Context.Tag)
export {
  RouteMatcher,
  resolveRoutes,
  createMatcher,
  collectRouteMiddleware,
  runRouteMiddleware,
  resolveErrorBoundary,
  resolveNotFoundBoundary,
  resolveForbiddenBoundary,
  resolveLoadingBoundary,
  resolveRenderStrategy,
  resolveScrollStrategy,
  decodeRouteParams,
  decodeRouteQuery,
} from "./matching.js";
export type { ResolvedRoute, RouteMatch, RouteMatcherShape, SyncMatcher } from "./matching.js";

// Route Path Pattern
export {
  RoutePathPattern,
  RoutePathInterpolation,
  compileRoutePathPattern,
  compareCompiledRoutePathPatterns,
  matchCompiledRoutePathPattern,
  interpolateCompiledRoutePathPattern,
  getPathParamOption,
  InvalidRoutePathPattern,
  MissingRoutePathParam,
  UnusedRoutePathParam,
  InvalidRoutePathParamValue,
  RoutePathPatternConfigInput,
  RoutePathInterpolationConfigInput,
} from "./path-pattern.js";
export type {
  RoutePathSegment,
  CompiledRoutePathPattern,
  RoutePathPatternMatch,
  PathParamValue,
  PathParamInput,
} from "./path-pattern.js";

// Navigation Core
export {
  NavigationCore,
  NavigationCoreError,
  NavigationCoreConfigInput,
  makeNavigationCore,
  makeInMemoryNavigationAdapter,
  navigationTarget,
  resolveNavigationTarget,
  sameQuery,
} from "./navigation-core.js";
export type {
  NavigationSnapshot,
  NavigationTarget,
  NavigationAdapter,
  NavigationCoreShape,
} from "./navigation-core.js";

// Navigation Outlet Coordination
export {
  NavigationOutletCoordination,
  NavigationOutletCoordinationConfigInput,
  makeNavigationOutletCoordination,
} from "./navigation-outlet-coordination.js";
export type {
  NavigationPrefetchState,
  ScrollIntent,
  NavigationOutletCoordinationShape,
} from "./navigation-outlet-coordination.js";

// Route Activation
export {
  RouteActivation,
  RouteActivationBoundary,
  RouteActivationError,
  LazyRouteLoadError,
  BoundaryResolutionError,
  RouteActivationBoundaryConfigInput,
  makeRouteActivation,
  makeRouteActivationBoundary,
} from "./route-activation.js";
export type {
  RouteActivationRequest,
  RouteActivationOutcome,
  RouteActivationShape,
  RouteActivationBoundaryShape,
  RouteActivationBoundaryDependencies,
  RouteActivationRenderIntent,
  RouteActivationMatch,
} from "./route-activation.js";

// Route Builder
export {
  make as routeMake,
  index as routeIndex,
  provide as routeProvide,
  isRouteBuilder,
  routeRedirect,
  routeForbidden,
  CurrentRouteQuery,
} from "./route.js";

// Router.redirect / Router.forbidden (preferred API)
export { routeRedirect as redirect, routeForbidden as forbidden } from "./route.js";

export type {
  RouteBuilder,
  AnyRouteBuilder,
  ExtractParams,
  RouteDefinition,
  MiddlewareResult,
} from "./route.js";

// Routes Collection
export { make as routesMake, CurrentRoutesManifest } from "./routes.js";
export type { RoutesCollection, RoutesManifest } from "./routes.js";

// Render Strategy
export { RenderStrategy, RenderLoadError } from "./render-strategy.js";
export type { RenderStrategyType, Eager, Lazy } from "./render-strategy.js";

// Scroll Strategy
export { ScrollStrategy } from "./scroll-strategy.js";
export type { ScrollStrategyType, ScrollAuto, ScrollNone } from "./scroll-strategy.js";

// Prefetch
export { runPrefetch } from "./prefetch.js";

// Path utilities
export { parsePath, buildPath } from "./utils.js";

// Utility functions
export { cx, type ClassValue, type ClassInput } from "../primitives/cx.js";

// =============================================================================
// Namespace Objects (for import { Route, Routes } from "trygg/router")
// =============================================================================

import { make as _routeMake, index as _routeIndex, provide as _routeProvide } from "./route.js";
import { routeRedirect as _redirect, routeForbidden as _forbidden } from "./route.js";
import { make as _routesMake } from "./routes.js";
import { currentRoute as _currentRoute } from "./service.js";

/**
 * Route namespace - provides `Route.make(path)`, `Route.index(component)`,
 * `Route.provide(strategy)`, `Route.current`, `Route.redirect(path)`, and
 * `Route.forbidden`.
 *
 * @remarks
 * Use `Route` for the fluent route-definition API. The namespace groups the
 * builder entrypoints and middleware escape hatches under the import users see
 * most often in application code.
 *
 * @example
 * ```tsx
 * import { Route, RenderStrategy } from "trygg/router"
 *
 * Route.make("/users/:id")
 *   .component(UserProfile)
 *   .pipe(Route.provide(RenderStrategy.Eager))
 * ```
 *
 * @category Routing
 * @public
 * @since 1.0.0
 */
export const Route = {
  make: _routeMake,
  index: _routeIndex,
  provide: _routeProvide,
  current: _currentRoute,
  redirect: _redirect,
  forbidden: _forbidden,
};

/**
 * Routes namespace - provides `Routes.make()` for route collection.
 *
 * @remarks
 * Use `Routes` to build the root manifest consumed by `Outlet`. The namespace
 * keeps the collection builder distinct from individual `Route` definitions.
 *
 * @example
 * ```tsx
 * import { Routes } from "trygg/router"
 *
 * export const routes = Routes.make()
 *   .add(Route.make("/").component(HomePage))
 *   .add(Route.make("/users").component(UsersList))
 * ```
 *
 * @category Routing
 * @public
 * @since 1.0.0
 */
export const Routes = {
  make: _routesMake,
};
