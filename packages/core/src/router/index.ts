/**
 * @since 1.0.0
 * Router module for effect-ui
 * 
 * File-based routing with automatic code splitting.
 * 
 * ## Quick Start
 * 
 * ```tsx
 * // vite.config.ts
 * import { defineConfig } from "vite"
 * import effectUI from "effect-ui/vite-plugin"
 * 
 * export default defineConfig({
 *   plugins: [effectUI({ routes: "./src/routes" })]
 * })
 * ```
 * 
 * ```tsx
 * // src/main.tsx
 * import { Effect } from "effect"
 * import { mount, Router } from "effect-ui"
 * import { routes } from "virtual:effect-ui-routes"
 * 
 * const App = Effect.gen(function* () {
 *   return (
 *     <div>
 *       <nav>
 *         <Router.Link to="/">Home</Router.Link>
 *         <Router.Link to="/users">Users</Router.Link>
 *       </nav>
 *       <Router.Outlet routes={routes} />
 *     </div>
 *   )
 * })
 * 
 * mount(document.getElementById("root")!, App)
 * ```
 * 
 * ## Route Files
 * 
 * ```
 * src/routes/
 * ├── index.tsx           → /
 * ├── _loading.tsx        → Loading fallback (optional)
 * ├── _error.tsx          → Error boundary (optional)
 * ├── users/
 * │   ├── index.tsx       → /users
 * │   └── [id].tsx        → /users/:id
 * └── settings/
 *     ├── _layout.tsx     → Layout wrapper
 *     ├── _loading.tsx    → Loading for /settings/* routes
 *     └── index.tsx       → /settings
 * ```
 * 
 * ## Special Files
 * 
 * - `_layout.tsx` - Wraps child routes with shared UI
 * - `_loading.tsx` - Shown while route is loading (code splitting)
 * - `_error.tsx` - Shown when route throws an error
 * 
 * @see ROUTER.md for full documentation
 * 
 * @module effect-ui/router
 */

// Types
export type {
  Route,
  RouteParams,
  NavigateOptions,
  RouteDefinition,
  RouteMatch,
  RouterRedirect,
  RoutesManifest,
  RouterService,
  RouteErrorInfo,
  // Type-safe routing utilities
  ExtractRouteParams,
  RouteParamsFor,
  TypeSafeLinkProps,
  RouteMap,
  RoutePath
} from "./types.js"

export { redirect, isRedirect, buildPathWithParams } from "./types.js"

// Router service
export {
  Router,
  getRouter,
  current,
  query,
  navigate,
  back,
  forward,
  params,
  isActive,
  link,
  browserLayer,
  testLayer,
  currentError
} from "./router-service.js"

// Components
export { Outlet, define } from "./outlet.js"
export type { OutletProps } from "./outlet.js"

export { Link, NavLink } from "./link.js"
export type { LinkProps, NavLinkProps } from "./link.js"

// Matching utilities (for advanced use)
export { createMatcher, parsePath, buildPath } from "./matching.js"
export type { RouteMatcher } from "./matching.js"

// Utility functions
export { cx } from "./utils.js"
export type { ClassValue, ClassInput } from "./utils.js"
