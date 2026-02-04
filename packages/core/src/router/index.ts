/**
 * @since 1.0.0
 * Router module for trygg
 *
 * Routing with Schema-validated params, middleware composition,
 * and Layer-based rendering strategies.
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
 * mount(document.getElementById("root")!, App)
 * ```
 *
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
export type { LinkProps } from "./link.js";

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
  decodeRouteParams,
  decodeRouteQuery,
} from "./matching.js";
export type { ResolvedRoute, RouteMatch, RouteMatcherShape, SyncMatcher } from "./matching.js";

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
export type { RenderStrategyService } from "./render-strategy.js";

// Scroll Strategy
export {
  ScrollStrategy,
  saveScrollPosition,
  restoreScrollPosition,
  scrollToTop,
  scrollToHash,
  applyScrollBehavior,
} from "./scroll-strategy.js";
export type { ScrollStrategyService, ScrollLocation } from "./scroll-strategy.js";

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
 * `Route.provide(...layers)`, `Route.current`, `Route.redirect(path)`,
 * and `Route.forbidden()`.
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
 * @since 1.0.0
 */
export const Route = {
  make: _routeMake,
  index: _routeIndex,
  provide: _routeProvide,
  current: _currentRoute,
  redirect: _redirect,
  forbidden: _forbidden,
} as const;

/**
 * Routes namespace - provides `Routes.make()` for route collection.
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
 * @since 1.0.0
 */
export const Routes = {
  make: _routesMake,
} as const;
