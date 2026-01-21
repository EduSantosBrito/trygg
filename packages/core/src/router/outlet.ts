/**
 * @since 1.0.0
 * Router Outlet component for effect-ui
 */
import { Cause, Effect, Exit, FiberRef, Option } from "effect"
import { Element, componentElement, text, signalElement } from "../element.js"
import * as Signal from "../signal.js"
import * as Debug from "../debug/debug.js"
import * as Metrics from "../debug/metrics.js"
import type { RoutesManifest, RouteMatch, RouterRedirect, RouteErrorInfo, RouteDefinition, RouteParams } from "./types.js"
import { isRedirect } from "./types.js"
import { createMatcher } from "./matching.js"
import { moduleLoader } from "./module-loader.js"
import { getRouter, CurrentRouteParams, CurrentRouteError, CurrentOutletChild, CurrentRoutes } from "./router-service.js"
import { isEffectComponent } from "../component.js"

/**
 * Type guard for Effect values
 * @internal
 */
const isEffect = (value: unknown): value is Effect.Effect<Element, unknown, unknown> =>
  typeof value === "object" &&
  value !== null &&
  Effect.EffectTypeId in value



/**
 * Outlet props
 * @since 1.0.0
 */
export interface OutletProps {
  /** Routes manifest (optional when used inside layouts) */
  readonly routes?: RoutesManifest
  /** 
   * Fallback element when no route matches and no _404.tsx exists.
   * Prefer using a _404.tsx file in your routes directory instead.
   */
  readonly fallback?: Element
}

/**
 * Find the _404 route in the manifest (top-level only).
 * The _404 route should have path "_404" (set by vite plugin).
 * @internal
 */
const find404Route = (routes: RoutesManifest): RouteDefinition | undefined => {
  for (const route of routes) {
    // Check for _404 path pattern (vite plugin uses "_404" as the path)
    if (route.path === "_404" || route.path === "/_404") {
      return route
    }
  }
  return undefined
}

/**
 * Internal: Run a guard if present on a route definition.
 * Returns a redirect if the guard blocks navigation.
 * @internal
 */
const runGuardForRoute: (route: RouteDefinition) => Effect.Effect<void | RouterRedirect, unknown, never> = 
  Effect.fn("runGuardForRoute")(function* (route: RouteDefinition) {
    if (route.guard) {
      yield* Debug.log({
        event: "router.guard.start",
        route_pattern: route.path,
        has_guard: true
      })
      
      const guardModule = yield* Effect.promise(() => route.guard!())
      
      if (guardModule.guard) {
        // Run the guard effect - it may return a redirect
        const result = yield* guardModule.guard
        if (isRedirect(result)) {
          yield* Debug.log({
            event: "router.guard.redirect",
            route_pattern: route.path,
            redirect_to: result.path
          })
          return result
        }
        yield* Debug.log({
          event: "router.guard.allow",
          route_pattern: route.path
        })
      } else {
        yield* Debug.log({
          event: "router.guard.skip",
          route_pattern: route.path,
          reason: "no guard export in module"
        })
      }
    }
    return undefined
  })

/**
 * Internal: Run guards for all routes in the chain (parents + leaf).
 * Returns a redirect if any guard blocks navigation.
 * Guards run from root to leaf; first redirect stops execution.
 * @internal
 */
const runGuardsForChain: (match: RouteMatch) => Effect.Effect<void | RouterRedirect, unknown, never> = 
  Effect.fn("runGuardsForChain")(function* (match: RouteMatch) {
    // Run guards for parents first (root to leaf order)
    for (const parent of match.parents) {
      const result = yield* runGuardForRoute(parent.route)
      if (result !== undefined) return result
    }
    // Run guard for the leaf route
    return yield* runGuardForRoute(match.route)
  })

/**
 * Internal result from loadAndRender - either rendered element or redirect
 * @internal
 */
type LoadAndRenderResult = 
  | { readonly _tag: "element"; readonly element: Element }
  | { readonly _tag: "redirect"; readonly redirect: RouterRedirect }

/**
 * Render a route component with params embedded via Effect.locally.
 * 
 * IMPORTANT: For Component.gen results, we must wrap the INNER run thunk,
 * not the outer effect. When component({}) returns Element.Component,
 * its run thunk is what actually executes Router.params(). We extract
 * that run thunk and wrap it with Effect.locally so params are available.
 * 
 * @internal
 */
const renderComponent = (
  component: unknown,
  params: RouteParams
): Effect.Effect<Element, unknown, never> => {
  if (isEffectComponent(component)) {
    // Component.gen result - calling it returns Element.Component({ run, key })
    // We need to wrap the INNER run thunk with Effect.locally
    const element = component({})
    if (element._tag === "Component") {
      const originalRun = element.run
      return Effect.succeed(
        componentElement(() =>
          originalRun().pipe(Effect.locally(CurrentRouteParams, params))
        )
      )
    }
    // Non-Component element (shouldn't happen for Component.gen, but handle gracefully)
    return Effect.succeed(element)
  }
  
  if (isEffect(component)) {
    // Effect export - wrap directly with Effect.locally
    return Effect.succeed(
      componentElement(() =>
        component.pipe(Effect.locally(CurrentRouteParams, params))
      )
    )
  }
  
  return Effect.die(new Error("Invalid route component: must be Effect or Component.gen result"))
}

/**
 * Render a layout component with child content and params embedded.
 * 
 * IMPORTANT: CurrentOutletChild uses FiberRef.set (not Effect.locally) because
 * the nested <Router.Outlet /> inside the layout runs AFTER the layout's effect
 * completes. FiberRef.set persists the value in the fiber until the nested
 * Outlet reads and clears it.
 * 
 * CurrentRouteParams uses Effect.locally since it's read DURING the layout's
 * effect execution.
 * 
 * @internal
 */
const renderLayout = (
  layout: unknown,
  child: Element,
  params: RouteParams
): Effect.Effect<Element, unknown, never> => {
  if (isEffectComponent(layout)) {
    const element = layout({})
    if (element._tag === "Component") {
      const originalRun = element.run
      return Effect.succeed(
        componentElement(() =>
          Effect.gen(function* () {
            // Set child content for nested Outlet - uses FiberRef.set because
            // the nested Outlet's effect runs AFTER this effect completes.
            // The nested Outlet will clear it after reading.
            yield* FiberRef.set(CurrentOutletChild, Option.some(child))
            // Run the layout with params set via Effect.locally
            return yield* originalRun().pipe(
              Effect.locally(CurrentRouteParams, params)
            )
          })
        )
      )
    }
    return Effect.succeed(element)
  }
  
  if (isEffect(layout)) {
    return Effect.succeed(
      componentElement(() =>
        Effect.gen(function* () {
          yield* FiberRef.set(CurrentOutletChild, Option.some(child))
          return yield* layout.pipe(
            Effect.locally(CurrentRouteParams, params)
          )
        })
      )
    )
  }
  
  return Effect.die(new Error("Invalid layout component: must be Effect or Component.gen result"))
}

/**
 * Merge params from all routes in the chain (parents + leaf).
 * Later params override earlier ones.
 * @internal
 */
const mergeParams = (match: RouteMatch): Record<string, string> => {
  let merged: Record<string, string> = {}
  for (const parent of match.parents) {
    merged = { ...merged, ...parent.params }
  }
  return { ...merged, ...match.params }
}

/**
 * Find the nearest error component in the chain (leaf to root).
 * Returns undefined if none found.
 * @internal
 */
const findNearestErrorComponent = (match: RouteMatch): RouteDefinition["errorComponent"] | undefined => {
  // Check leaf first
  if (match.route.errorComponent) {
    return match.route.errorComponent
  }
  // Check parents from nearest to root
  for (let i = match.parents.length - 1; i >= 0; i--) {
    const parent = match.parents[i]
    if (parent?.route.errorComponent) {
      return parent.route.errorComponent
    }
  }
  return undefined
}

/**
 * Find the nearest loading component in the chain (leaf to root).
 * Returns undefined if none found.
 * @internal
 */
const findNearestLoadingComponent = (match: RouteMatch): RouteDefinition["loadingComponent"] | undefined => {
  // Check leaf first
  if (match.route.loadingComponent) {
    return match.route.loadingComponent
  }
  // Check parents from nearest to root
  for (let i = match.parents.length - 1; i >= 0; i--) {
    const parent = match.parents[i]
    if (parent?.route.loadingComponent) {
      return parent.route.loadingComponent
    }
  }
  return undefined
}

/**
 * Internal: Load and render a route component, including nested layouts.
 * Layouts are stacked from root to leaf: RootLayout -> ChildLayout -> ... -> LeafComponent
 * Returns a redirect if any guard blocks navigation.
 * @internal
 */
const loadAndRender: (match: RouteMatch) => Effect.Effect<LoadAndRenderResult, unknown, never> = 
  Effect.fn("loadAndRender")(function* (match: RouteMatch) {
    const hasParents = match.parents.length > 0
    
    yield* Debug.log({
      event: "router.render.start",
      route_pattern: match.route.path,
      params: match.params,
      parent_count: match.parents.length,
      has_guard: !!match.route.guard,
      has_layout: !!match.route.layout,
      has_loading: !!match.route.loadingComponent,
      has_error: !!match.route.errorComponent
    })
    
    // Run guards for the full chain (parents + leaf)
    const guardResult = yield* runGuardsForChain(match)
    
    // If any guard returned a redirect, don't render - return the redirect
    if (guardResult !== undefined) {
      return { _tag: "redirect" as const, redirect: guardResult }
    }
    
    // Merge params from all levels (embedded into components via Effect.locally)
    const mergedParams = mergeParams(match)
    
    // F-001: Parallel module loading
    // Collect all modules to load, then load in parallel for better performance
    
    interface ModuleLoadTask {
      readonly kind: "component" | "layout"
      readonly path: string
      readonly loader: () => Promise<{ default: unknown }>
      /** For layouts: index determines nesting order (innermost = highest) */
      readonly index: number
    }
    
    const tasks: Array<ModuleLoadTask> = []
    
    // Leaf component (always present)
    tasks.push({
      kind: "component",
      path: match.route.path,
      loader: match.route.component,
      index: -1 // Not used for components
    })
    
    // Leaf layout (optional) - innermost layout
    if (match.route.layout) {
      tasks.push({
        kind: "layout",
        path: match.route.path,
        loader: match.route.layout,
        index: match.parents.length // Innermost = highest index
      })
    }
    
    // Parent layouts (from nearest to root)
    for (let i = match.parents.length - 1; i >= 0; i--) {
      const parent = match.parents[i]
      if (parent?.route.layout) {
        tasks.push({
          kind: "layout",
          path: parent.route.path,
          loader: parent.route.layout,
          index: i // Index in parent array = nesting level
        })
      }
    }
    
    // Load all modules in parallel (browser handles network scheduling)
    const loadedModules = yield* Effect.all(
      tasks.map((task) =>
        moduleLoader.load(task.path, task.kind, false, task.loader).pipe(
          Effect.map((mod) => ({ ...task, module: mod as { default: unknown } }))
        )
      ),
      { concurrency: "unbounded" }
    )
    
    // Find component module
    const componentResult = loadedModules.find((m) => m.kind === "component")
    if (componentResult === undefined) {
      return yield* Effect.die(new Error("Component module not found"))
    }
    
    // Render the leaf component
    let currentElement = yield* renderComponent(componentResult.module.default, mergedParams)
    
    // Sort layouts by index descending (innermost first, wrap outward to root)
    const layoutResults = loadedModules
      .filter((m): m is typeof m & { kind: "layout" } => m.kind === "layout")
      .sort((a, b) => b.index - a.index)
    
    // Wrap with layouts from innermost to outermost
    for (const layoutResult of layoutResults) {
      currentElement = yield* renderLayout(layoutResult.module.default, currentElement, mergedParams)
    }
    
    yield* Debug.log({
      event: "router.render.complete",
      route_pattern: match.route.path,
      has_layout: !!match.route.layout || match.parents.some(p => !!p.route.layout),
      nested_depth: hasParents ? match.parents.length + 1 : 1
    })
    
    return { _tag: "element" as const, element: currentElement }
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
 * be caught and the error component displayed instead. Use `Router.currentError`
 * to access error details.
 * 
 * ```tsx
 * // routes/_error.tsx
 * import { Cause, Effect } from "effect"
 * 
 * export default Effect.gen(function* () {
 *   const { cause, path, reset } = yield* Router.currentError
 *   return (
 *     <div>
 *       <h1>Error</h1>
 *       <p>{String(Cause.squash(cause))}</p>
 *       <button onClick={reset}>Retry</button>
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
  
  // Cache the compiled matcher per routes tree identity (reference equality)
  // This avoids recompiling on every render when routes don't change
  let cachedMatcher: ReturnType<typeof createMatcher> | null = null
  let cachedRoutes: RoutesManifest | null = null
  
  // Get or create matcher (memoized by routes reference)
  const getMatcher = Effect.gen(function* () {
    if (cachedMatcher === null || cachedRoutes !== routes) {
      yield* Debug.log({
        event: "router.matcher.compile",
        route_count: routes.length,
        is_recompile: cachedMatcher !== null
      })
      cachedMatcher = createMatcher(routes)
      cachedRoutes = routes
    } else {
      yield* Debug.log({
        event: "router.matcher.cached",
        route_count: routes.length
      })
    }
    return cachedMatcher
  })
  
  // Signal to trigger re-render on reset
  let resetTrigger: Signal.Signal<number> | null = null

  // Track the active match key to trigger resource refreshes on navigation or reset
  let currentMatchKey: string | null = null

  /**
   * Build stable key from match for comparison.
   * Key changes when route path, params, query, or reset trigger change.
   * @internal
   */
  const buildMatchKey = (
    match: RouteMatch,
    query: string,
    resetValue: number | null
  ): string =>
    JSON.stringify({ path: match.route.path, params: match.params, query, resetValue })

  const resolveResourceState = (
    state: Signal.ResourceState<unknown, Element>,
    fallbackElement: Element
  ): Element => {
    switch (state._tag) {
      case "Loading":
        return fallbackElement
      case "Refreshing":
        return Exit.isSuccess(state.previous)
          ? state.previous.value
          : fallbackElement
      case "Success":
        return state.value
      case "Failure":
        return fallbackElement
    }
  }
  
  // The outlet is a component that reactively renders based on context
  const outletEffect = Effect.gen(function* () {
    // Check if we're a nested outlet (inside a layout) with pre-set child content
    const childContent = yield* FiberRef.get(CurrentOutletChild)
    
    // If there's child content, we're inside a layout - render the child
    // Clear the content so subsequent Outlet renders don't see stale data
    if (Option.isSome(childContent)) {
      yield* FiberRef.set(CurrentOutletChild, Option.none())
      return childContent.value
    }
    
    // Otherwise, we're a top-level outlet - match routes
    if (routes.length === 0) {
      // No routes provided and no child content - render fallback
      return fallback ?? text("No routes configured")
    }
    
    // F-001: Set routes in FiberRef for prefetching
    yield* FiberRef.set(CurrentRoutes, routes)
    
    // Get route matcher (memoized)
    const matcher = yield* getMatcher
    
    const router = yield* getRouter
    
    // Get current route (subscribes to changes via Signal.get)
    const route = yield* Signal.get(router.current)
    
    // Subscribe to reset trigger if it exists
    let resetValue: number | null = null
    if (resetTrigger !== null) {
      resetValue = yield* Signal.get(resetTrigger)
    }
    
    // Match the current path
    const matchOption = matcher.match(route.path)
    
    if (Option.isNone(matchOption)) {
      yield* Debug.log({
        event: "router.match.notfound",
        path: route.path
      })
      
      // Check for _404 route in manifest
      const notFoundRoute = find404Route(routes)
      if (notFoundRoute) {
        yield* Debug.log({
          event: "router.404.render",
          path: route.path,
          has_custom_404: true
        })
        
        // Load and render the _404 component (no route params for 404)
        const module = yield* Effect.promise(() => notFoundRoute.component())
        return yield* renderComponent(module.default, {})
      }
      
      // No _404 route - render fallback or default text
      yield* Debug.log({
        event: "router.404.fallback",
        path: route.path,
        has_custom_404: false
      })
      return fallback ?? text("404 - Not Found")
    }
    
    const match = matchOption.value
    
    yield* Debug.log({
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
    
    // Find nearest error/loading components in the chain (leaf to root)
    const nearestErrorComponent = findNearestErrorComponent(match)
    const nearestLoadingComponent = findNearestLoadingComponent(match)
    
    // Apply error boundary if any route in the chain has error component
    // Use sandbox + catchAllCause to handle both typed failures AND defects (thrown exceptions)
    if (nearestErrorComponent) {
      const renderWithError = renderWithErrorHandling.pipe(
        Effect.sandbox,
        Effect.catchAllCause((sandboxedCause) => 
          Effect.gen(function* () {
            // Flatten the nested Cause<Cause<E>> from sandbox into Cause<E>
            const cause = Cause.flatten(sandboxedCause)
            const isDefect = Cause.isDie(cause)
            
            yield* Debug.log({
              event: "router.error",
              route_pattern: match.route.path,
              error: String(Cause.squash(cause)),
              error_boundary: "nearest",
              is_defect: isDefect
            })
            
            // Record route error metric
            yield* Metrics.recordRouteError
            
            // Initialize reset trigger if needed
            if (resetTrigger === null) {
              resetTrigger = yield* Signal.make(0)
            }
            
            // Capture the signal for the reset effect
            const capturedTrigger = resetTrigger
            
            // Create error info for the error component
            const errorInfo: RouteErrorInfo = {
              cause,
              path: route.path,
              // Reset effect - increments trigger to cause re-render
              reset: Signal.update(capturedTrigger, (n) => n + 1)
            }
            
            // Load the error component module
            const errorModule = yield* Effect.promise(() => nearestErrorComponent())
            const errorComponent = errorModule.default
            
            // Return a componentElement that wraps execution in Effect.locally
            // This ensures the error is available when currentError is called,
            // and automatically clears after the error component renders
            return componentElement(() => 
              Effect.locally(
                Effect.gen(function* () {
                  // Render the error component inside the Effect.locally scope
                  // If the error component throws, it will propagate to parent boundary
                  if (isEffectComponent(errorComponent)) {
                    // Component.gen result - call it to get Element
                    return errorComponent({})
                  }
                  // Effect-based component - run the effect
                  return yield* (errorComponent as Effect.Effect<Element, unknown, never>)
                }),
                CurrentRouteError,
                Option.some(errorInfo)
              )
            )
          })
        )
      )
      
      // If any route in chain has loading component, map resource state to loading fallback
      if (nearestLoadingComponent) {
        const loadingModule = yield* Effect.promise(() => nearestLoadingComponent())
        const loadingElement = yield* renderComponent(loadingModule.default, {})

        const resource = yield* Signal.resource(renderWithError)
        const matchKey = buildMatchKey(match, route.query.toString(), resetValue)

        if (currentMatchKey === null) {
          currentMatchKey = matchKey
        } else if (currentMatchKey !== matchKey) {
          currentMatchKey = matchKey
          yield* resource.refresh
        }

        const view = yield* Signal.derive(resource.state, (state) =>
          resolveResourceState(state, loadingElement)
        )

        return signalElement(view)
      }

      return yield* renderWithError
    }
    
    // No error component - just render with loading if present
    if (nearestLoadingComponent) {
      const loadingModule = yield* Effect.promise(() => nearestLoadingComponent())
      const loadingElement = yield* renderComponent(loadingModule.default, {})
      
      const resource = yield* Signal.resource(renderWithErrorHandling)
      const matchKey = buildMatchKey(match, route.query.toString(), resetValue)

      if (currentMatchKey === null) {
        currentMatchKey = matchKey
      } else if (currentMatchKey !== matchKey) {
        currentMatchKey = matchKey
        yield* resource.refresh
      }

      const view = yield* Signal.derive(resource.state, (state) =>
        resolveResourceState(state, loadingElement)
      )

      return signalElement(view)
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
