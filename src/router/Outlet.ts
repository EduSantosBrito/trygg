/**
 * @since 1.0.0
 * Router Outlet component for effect-ui
 */
import { Deferred, Effect, FiberRef, Option, Scope } from "effect"
import { Element, componentElement, text, suspense as suspenseElement } from "../Element.js"
import * as Signal from "../Signal.js"
import * as Debug from "../debug.js"
import type { RoutesManifest, RouteMatch, RouterRedirect, RouteErrorInfo } from "./types.js"
import { isRedirect } from "./types.js"
import { createMatcher } from "./matching.js"
import { getRouter, CurrentRouteParams, CurrentRouteError } from "./RouterService.js"

/**
 * Module-level storage for child content passed from parent outlet to nested outlet.
 * Used by layouts - the parent outlet sets this before rendering the layout,
 * and the nested outlet inside the layout reads it.
 * We use a module-level variable instead of FiberRef because FiberRefs are
 * fiber-local and don't persist across component renders.
 * @internal
 */
let _currentOutletChild: Option.Option<Element> = Option.none()

/**
 * Outlet props
 * @since 1.0.0
 */
export interface OutletProps {
  /** Routes manifest (optional when used inside layouts) */
  readonly routes?: RoutesManifest
  /** Fallback element when no route matches */
  readonly fallback?: Element
}

/**
 * Internal: Run a guard if present.
 * Returns a redirect if the guard blocks navigation.
 * @internal
 */
const runGuard: (match: RouteMatch) => Effect.Effect<void | RouterRedirect, unknown, never> = 
  Effect.fn("runGuard")(function* (match: RouteMatch) {
    if (match.route.guard) {
      Debug.log({
        event: "router.guard.start",
        route_pattern: match.route.path,
        has_guard: true
      })
      
      const guardModule = yield* Effect.promise(() => match.route.guard!())
      
      if (guardModule.guard) {
        // Run the guard effect - it may return a redirect
        const result = yield* guardModule.guard
        if (isRedirect(result)) {
          Debug.log({
            event: "router.guard.redirect",
            route_pattern: match.route.path,
            redirect_to: result.path
          })
          return result
        }
        Debug.log({
          event: "router.guard.allow",
          route_pattern: match.route.path
        })
      } else {
        Debug.log({
          event: "router.guard.skip",
          route_pattern: match.route.path,
          reason: "no guard export in module"
        })
      }
    }
    return undefined
  })

/**
 * Internal result from loadAndRender - either rendered element or redirect
 * @internal
 */
type LoadAndRenderResult = 
  | { readonly _tag: "element"; readonly element: Element }
  | { readonly _tag: "redirect"; readonly redirect: RouterRedirect }

/**
 * Render a component - handles both Effect and Component.gen exports
 * @internal
 */
const renderComponent = (component: unknown): Effect.Effect<Element, unknown, never> => {
  if (typeof component === "function" && (component as { _tag?: string })._tag === "EffectComponent") {
    // It's a Component.gen result - call it with empty props to get Element
    return Effect.succeed((component as (props: Record<string, unknown>) => Element)({}))
  }
  // It's an Effect - yield it to get Element
  return component as Effect.Effect<Element, unknown, never>
}

/**
 * Internal: Load and render a route component, including layout if present.
 * Returns a redirect if the guard blocks navigation.
 * @internal
 */
const loadAndRender: (match: RouteMatch) => Effect.Effect<LoadAndRenderResult, unknown, never> = 
  Effect.fn("loadAndRender")(function* (match: RouteMatch) {
    Debug.log({
      event: "router.render.start",
      route_pattern: match.route.path,
      params: match.params,
      has_guard: !!match.route.guard,
      has_layout: !!match.route.layout,
      has_loading: !!match.route.loadingComponent,
      has_error: !!match.route.errorComponent
    })
    
    // Run guard before rendering
    const guardResult = yield* runGuard(match)
    
    // If guard returned a redirect, don't render - return the redirect
    if (guardResult !== undefined) {
      return { _tag: "redirect" as const, redirect: guardResult }
    }
    
    // Set route params in FiberRef for params() to access
    yield* FiberRef.set(CurrentRouteParams, match.params)
    
    // Load the component module
    const module = yield* Effect.promise(() => match.route.component())
    const renderedComponent = yield* renderComponent(module.default)
    
    // If this route has a layout, wrap the component in the layout
    if (match.route.layout) {
      const layoutModule = yield* Effect.promise(() => match.route.layout!())
      
      // Set the child content for nested Outlet to render
      _currentOutletChild = Option.some(renderedComponent)
      
      const layoutElement = yield* renderComponent(layoutModule.default)
      
      // Note: _currentOutletChild is cleared by the nested Outlet when it consumes the content
      
      Debug.log({
        event: "router.render.complete",
        route_pattern: match.route.path,
        has_layout: true
      })
      
      return { _tag: "element" as const, element: layoutElement }
    }
    
    Debug.log({
      event: "router.render.complete",
      route_pattern: match.route.path,
      has_layout: false
    })
    
    return { _tag: "element" as const, element: renderedComponent }
  })

/**
 * Router Outlet - renders the matched route component
 * 
 * When used at the top level with `routes` prop, matches current path and renders component.
 * When used inside a layout (without routes), renders the child content passed from parent.
 * 
 * ## Loading States
 * 
 * If a route directory contains `_loading.tsx`, it will be displayed while the route
 * component is loading. This works with code splitting to show immediate feedback.
 * 
 * ```tsx
 * // routes/_loading.tsx
 * export default Effect.succeed(<div>Loading...</div>)
 * ```
 * 
 * ## Error Handling
 * 
 * If a route directory contains `_error.tsx`, errors from the route component will
 * be caught and the error component displayed instead. Use `Router.useRouteError()`
 * to access error details.
 * 
 * ```tsx
 * // routes/_error.tsx
 * export default Effect.gen(function* () {
 *   const { error, path, reset } = yield* Router.useRouteError()
 *   return (
 *     <div>
 *       <h1>Error</h1>
 *       <p>{String(error)}</p>
 *       <button onClick={() => Effect.sync(reset)}>Retry</button>
 *     </div>
 *   )
 * })
 * ```
 * 
 * @example
 * ```tsx
 * // Top-level outlet
 * import { routes } from "virtual:effect-ui-routes"
 * 
 * const App = Effect.gen(function* () {
 *   return (
 *     <div>
 *       <nav>...</nav>
 *       <Router.Outlet routes={routes} />
 *     </div>
 *   )
 * })
 * ```
 * 
 * @example
 * ```tsx
 * // Inside a layout (_layout.tsx)
 * export default Effect.gen(function* () {
 *   return (
 *     <div className="layout">
 *       <Sidebar />
 *       <main>
 *         <Router.Outlet />
 *       </main>
 *     </div>
 *   )
 * })
 * ```
 * 
 * @since 1.0.0
 */
export const Outlet = (props: OutletProps = {}): Element => {
  const { routes = [], fallback } = props
  
  // Signal to trigger re-render on reset
  let resetTrigger: Signal.Signal<number> | null = null
  
  // The outlet is a component that reactively renders based on context
  const outletEffect = Effect.gen(function* () {
    // Check if we're a nested outlet (inside a layout) with pre-set child content
    const childContent = _currentOutletChild
    
    // If there's child content, we're inside a layout - render the child
    // Clear the content so subsequent Outlet renders don't see stale data
    if (Option.isSome(childContent)) {
      _currentOutletChild = Option.none()
      return childContent.value
    }
    
    // Otherwise, we're a top-level outlet - match routes
    if (routes.length === 0) {
      // No routes provided and no child content - render fallback
      return fallback ?? text("No routes configured")
    }
    
    // Create route matcher
    const matcher = createMatcher(routes)
    
    const router = yield* getRouter
    
    // Get current route (subscribes to changes via Signal.get)
    const route = yield* Signal.get(router.current)
    
    // Subscribe to reset trigger if it exists
    if (resetTrigger !== null) {
      yield* Signal.get(resetTrigger)
    }
    
    // Match the current path
    const match = matcher.match(route.path)
    
    if (match === null) {
      Debug.log({
        event: "router.match.notfound",
        path: route.path
      })
      // No match - render fallback or empty
      return fallback ?? text("404 - Not Found")
    }
    
    Debug.log({
      event: "router.match",
      path: route.path,
      route_pattern: match.route.path,
      params: match.params
    })
    
    // Wrap in error handling if route has error component
    const renderWithErrorHandling = Effect.gen(function* () {
      const result = yield* loadAndRender(match)
      
      // Handle redirect from guard
      if (result._tag === "redirect") {
        // Navigate to the redirect path
        yield* router.navigate(result.redirect.path, result.redirect.options)
        // Return empty element while redirect is processing
        return text("")
      }
      
      return result.element
    })
    
    // Apply error boundary if route has error component
    if (match.route.errorComponent) {
      const renderWithError = renderWithErrorHandling.pipe(
        Effect.catchAll((error: unknown) => 
          Effect.gen(function* () {
            Debug.log({
              event: "router.error",
              route_pattern: match.route.path,
              error: String(error)
            })
            
            // Initialize reset trigger if needed
            if (resetTrigger === null) {
              resetTrigger = yield* Signal.make(0)
            }
            
            // Capture the signal for the reset effect
            const capturedTrigger = resetTrigger
            
            // Create error info and set in FiberRef
            const errorInfo: RouteErrorInfo = {
              error,
              path: route.path,
              // Reset effect - increments trigger to cause re-render
              reset: Signal.update(capturedTrigger, (n) => n + 1)
            }
            yield* FiberRef.set(CurrentRouteError, Option.some(errorInfo))
            
            // Load and render error component
            const errorModule = yield* Effect.promise(() => match.route.errorComponent!())
            const errorElement = yield* renderComponent(errorModule.default)
            
            // Clear error info after rendering
            yield* FiberRef.set(CurrentRouteError, Option.none())
            
            return errorElement
          })
        )
      )
      
      // If route has loading component, wrap in Suspense-like pattern
      if (match.route.loadingComponent) {
        // Load the loading component synchronously (it should be fast)
        const loadingModule = yield* Effect.promise(() => match.route.loadingComponent!())
        const loadingElement = yield* renderComponent(loadingModule.default)
        
        // Create deferred for async route loading
        const deferred = yield* Deferred.make<Element, unknown>()
        const scope = yield* Scope.make()
        
        // Fork the route loading effect
        yield* Effect.forkIn(
          renderWithError.pipe(
            Effect.flatMap((element) => Deferred.succeed(deferred, element)),
            Effect.catchAll((error) => Deferred.fail(deferred, error))
          ),
          scope
        )
        
        // Return Suspense element
        return suspenseElement(deferred, loadingElement)
      }
      
      return yield* renderWithError
    }
    
    // No error component - just render with loading if present
    if (match.route.loadingComponent) {
      const loadingModule = yield* Effect.promise(() => match.route.loadingComponent!())
      const loadingElement = yield* renderComponent(loadingModule.default)
      
      const deferred = yield* Deferred.make<Element, unknown>()
      const scope = yield* Scope.make()
      
      yield* Effect.forkIn(
        renderWithErrorHandling.pipe(
          Effect.flatMap((element) => Deferred.succeed(deferred, element)),
          Effect.catchAll((error) => Deferred.fail(deferred, error))
        ),
        scope
      )
      
      return suspenseElement(deferred, loadingElement)
    }
    
    return yield* renderWithErrorHandling
  })
  
  return componentElement(() => outletEffect)
}

/**
 * Define routes from an object map
 * Convenience function for manual route definition
 * 
 * @example
 * ```tsx
 * const routes = Router.define({
 *   "/": () => import("./Home"),
 *   "/users": () => import("./Users"),
 *   "/users/:id": () => import("./UserProfile"),
 * })
 * ```
 * 
 * @since 1.0.0
 */
export const define = (
  routeMap: Record<string, () => Promise<{ default: Effect.Effect<Element, unknown, never> }>>
): RoutesManifest => {
  return Object.entries(routeMap).map(([path, component]) => ({
    path,
    component
  }))
}
