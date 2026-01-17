/**
 * @since 1.0.0
 * Router service for effect-ui
 */
import { Context, Effect, FiberRef, Layer, Option, Runtime } from "effect"
import * as Signal from "../Signal.js"
import * as Debug from "../debug.js"
import type { Route, RouteParams, RouterService, NavigateOptions, RouteErrorInfo } from "./types.js"
import { parsePath, buildPath } from "./matching.js"

/**
 * Router service tag
 * @since 1.0.0
 */
export class Router extends Context.Tag("@effect-ui/Router")<
  Router,
  RouterService
>() {}

/**
 * FiberRef to store current route params for the active route
 * Used by Router.params() to provide type-safe access
 * @internal
 */
export const CurrentRouteParams: FiberRef.FiberRef<RouteParams> = 
  FiberRef.unsafeMake<RouteParams>({})

/**
 * FiberRef to store the current router service.
 * Set during layer building and propagated via ManagedRuntime to all forked fibers.
 * This replaces the module-level variable approach - FiberRefs set during layer
 * building are captured in the Runtime and copied to forked fibers.
 * @internal
 */
export const CurrentRouter: FiberRef.FiberRef<Option.Option<RouterService>> = 
  FiberRef.unsafeMake<Option.Option<RouterService>>(Option.none())

/**
 * FiberRef to store route error info for _error.tsx components.
 * Set by Outlet when a route errors, read by error components via useRouteError().
 * @internal
 */
export const CurrentRouteError: FiberRef.FiberRef<Option.Option<RouteErrorInfo>> = 
  FiberRef.unsafeMake<Option.Option<RouteErrorInfo>>(Option.none())

/**
 * Get the current router service from FiberRef.
 * Works in forked fibers when running through ManagedRuntime because
 * FiberRefs set during layer building are propagated to child fibers.
 * @internal
 */
export const getRouter: Effect.Effect<RouterService> = 
  Effect.flatMap(FiberRef.get(CurrentRouter), (maybeRouter) => {
    if (Option.isNone(maybeRouter)) {
      return Effect.die(
        new Error(
          "Router not found. Make sure your app is wrapped with Router.browserLayer.\n" +
          "Example: mount(container, App.pipe(Effect.provide(Router.browserLayer)))"
        )
      )
    }
    return Effect.succeed(maybeRouter.value)
  })

/**
 * Get the current route signal
 * @since 1.0.0
 */
export const current: Effect.Effect<Signal.Signal<Route>, never, Router> = 
  Effect.map(Router, (router) => router.current)

/**
 * Get the query params signal
 * @since 1.0.0
 */
export const query: Effect.Effect<Signal.Signal<URLSearchParams>, never, Router> =
  Effect.map(Router, (router) => router.query)

/**
 * Navigate to a path
 * @since 1.0.0
 */
export const navigate = (
  path: string, 
  options?: NavigateOptions
): Effect.Effect<void, never, Router> =>
  Effect.flatMap(Router, (router) => router.navigate(path, options))

/**
 * Go back in history
 * @since 1.0.0
 */
export const back: Effect.Effect<void, never, Router> =
  Effect.flatMap(Router, (router) => router.back())

/**
 * Go forward in history
 * @since 1.0.0
 */
export const forward: Effect.Effect<void, never, Router> =
  Effect.flatMap(Router, (router) => router.forward())

/**
 * Get route params with type safety
 * @since 1.0.0
 */
export const params = <P extends RouteParams>(): Effect.Effect<P> =>
  Effect.map(FiberRef.get(CurrentRouteParams), (p) => p as P)

/**
 * Check if a path is currently active
 * @since 1.0.0
 */
export const isActive = (
  path: string, 
  exact: boolean = false
): Effect.Effect<boolean, never, Router> =>
  Effect.flatMap(Router, (router) => router.isActive(path, exact))

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
 *   const { error, path, reset } = yield* Router.useRouteError()
 *   return (
 *     <div>
 *       <h1>Error on {path}</h1>
 *       <p>{String(error)}</p>
 *       <button onClick={() => reset}>Retry</button>
 *     </div>
 *   )
 * })
 * ```
 * 
 * @since 1.0.0
 */
export const useRouteError: Effect.Effect<RouteErrorInfo> = 
  Effect.flatMap(FiberRef.get(CurrentRouteError), (maybeError) => {
    if (Option.isNone(maybeError)) {
      return Effect.die(
        new Error(
          "useRouteError called outside of an error boundary.\n" +
          "This function should only be used in _error.tsx components."
        )
      )
    }
    return Effect.succeed(maybeError.value)
  })

/**
 * Create a link click handler that navigates to a path
 * Prevents default browser navigation and uses router instead
 * @since 1.0.0
 */
export const link = (
  path: string, 
  options?: NavigateOptions
): (event: Event) => Effect.Effect<void, never, Router> =>
  (event: Event) => Effect.gen(function* () {
    event.preventDefault()
    yield* navigate(path, options)
  })

/**
 * Create the browser router layer
 * Uses History API for navigation
 * @since 1.0.0
 */
export const browserLayer: Layer.Layer<Router> = Layer.effect(
  Router,
  Effect.gen(function* () {
    // Get initial location
    const initialPath = typeof window !== "undefined" 
      ? window.location.pathname + window.location.search
      : "/"
    const { path, query: initialQuery } = parsePath(initialPath)
    
    // Create signals for current route and query
    const currentSignal = yield* Signal.make<Route>({
      path,
      params: {},
      query: initialQuery
    })
    
    const querySignal = yield* Signal.make<URLSearchParams>(initialQuery)
    
    // Get runtime for running effects from sync callbacks (like popstate)
    const runtime = yield* Effect.runtime<never>()
    
    // Update signals from a path - used by popstate handler
    const updateFromPath = (fullPath: string): void => {
      const { path: newPath, query: newQuery } = parsePath(fullPath)
      
      // Use the extracted runtime to run effects from sync callbacks
      Runtime.runSync(runtime)(Signal.set(currentSignal, {
        path: newPath,
        params: {},
        query: newQuery
      }))
      
      Runtime.runSync(runtime)(Signal.set(querySignal, newQuery))
    }
    
    // Listen to browser popstate (back/forward)
    if (typeof window !== "undefined") {
      window.addEventListener("popstate", () => {
        updateFromPath(window.location.pathname + window.location.search)
      })
    }
    
    const routerService: RouterService = {
      current: currentSignal,
      query: querySignal,
      
      navigate: Effect.fn("RouterService.navigate")(function* (targetPath: string, options?: NavigateOptions) {
          const current = yield* Signal.get(currentSignal)
          Debug.log({
            event: "router.navigate",
            from_path: current.path,
            to_path: targetPath,
            ...(options?.replace !== undefined ? { replace: options.replace } : {})
          })
          
          const fullPath = buildPath(targetPath, options?.query)
          
          if (typeof window !== "undefined") {
            if (options?.replace) {
              window.history.replaceState(null, "", fullPath)
            } else {
              window.history.pushState(null, "", fullPath)
            }
          }
          
          const { path: newPath, query: newQuery } = parsePath(fullPath)
          yield* Signal.set(currentSignal, {
            path: newPath,
            params: {},
            query: newQuery
          })
          yield* Signal.set(querySignal, newQuery)
          
          Debug.log({
            event: "router.navigate.complete",
            path: fullPath
          })
        }),
      
      back: () => Effect.sync(() => {
        if (typeof window !== "undefined") {
          window.history.back()
        }
      }),
      
      forward: () => Effect.sync(() => {
        if (typeof window !== "undefined") {
          window.history.forward()
        }
      }),
      
      params: <P extends RouteParams>() => 
        Effect.map(FiberRef.get(CurrentRouteParams), (p) => p as P),
      
      isActive: Effect.fn("RouterService.isActive")(function* (targetPath: string, exact: boolean = false) {
          const route = yield* Signal.get(currentSignal)
          if (exact) {
            return route.path === targetPath
          }
          return route.path.startsWith(targetPath)
        })
    }
    
    // Store router in FiberRef during layer building.
    // ManagedRuntime captures FiberRefs at layer build time and propagates
    // them to all forked fibers, solving the fiber-local variable problem.
    yield* FiberRef.set(CurrentRouter, Option.some(routerService))
    
    return routerService
  })
)

/**
 * Redirect effect - use in guards to redirect to another route
 * @since 1.0.0
 */
export const redirect = (
  path: string, 
  options?: NavigateOptions
): Effect.Effect<never, never, Router> =>
  Effect.flatMap(
    navigate(path, options),
    () => Effect.never
  )

/**
 * Create a test router layer
 * Uses in-memory state instead of window.location/history.
 * Useful for unit tests that don't have a DOM or need isolated routing.
 * 
 * @param initialPath - The initial path (defaults to "/")
 * @since 1.0.0
 */
export const testLayer = (initialPath: string = "/"): Layer.Layer<Router> => Layer.effect(
  Router,
  Effect.gen(function* () {
    const { path, query: initialQuery } = parsePath(initialPath)
    
    // Create signals for current route and query
    const currentSignal = yield* Signal.make<Route>({
      path,
      params: {},
      query: initialQuery
    })
    
    const querySignal = yield* Signal.make<URLSearchParams>(initialQuery)
    
    // History stack for back/forward (in-memory)
    const historyStack: Array<string> = [initialPath]
    let historyIndex = 0
    
    // Get runtime for running effects from sync callbacks
    const runtime = yield* Effect.runtime<never>()
    
    const updateFromPath = (fullPath: string): void => {
      const { path: newPath, query: newQuery } = parsePath(fullPath)
      Runtime.runSync(runtime)(Signal.set(currentSignal, {
        path: newPath,
        params: {},
        query: newQuery
      }))
      Runtime.runSync(runtime)(Signal.set(querySignal, newQuery))
    }
    
    const routerService: RouterService = {
      current: currentSignal,
      query: querySignal,
      
      navigate: Effect.fn("RouterService.navigate")(function* (targetPath: string, options?: NavigateOptions) {
          const fullPath = buildPath(targetPath, options?.query)
          const { path: newPath, query: newQuery } = parsePath(fullPath)
          
          if (options?.replace) {
            // Replace current entry
            historyStack[historyIndex] = fullPath
          } else {
            // Push new entry, removing any forward history
            historyStack.splice(historyIndex + 1)
            historyStack.push(fullPath)
            historyIndex = historyStack.length - 1
          }
          
          yield* Signal.set(currentSignal, {
            path: newPath,
            params: {},
            query: newQuery
          })
          yield* Signal.set(querySignal, newQuery)
        }),
      
      back: () => Effect.sync(() => {
        if (historyIndex > 0) {
          historyIndex--
          const path = historyStack[historyIndex]
          if (path !== undefined) {
            updateFromPath(path)
          }
        }
      }),
      
      forward: () => Effect.sync(() => {
        if (historyIndex < historyStack.length - 1) {
          historyIndex++
          const path = historyStack[historyIndex]
          if (path !== undefined) {
            updateFromPath(path)
          }
        }
      }),
      
      params: <P extends RouteParams>() => 
        Effect.map(FiberRef.get(CurrentRouteParams), (p) => p as P),
      
      isActive: Effect.fn("RouterService.isActive")(function* (targetPath: string, exact: boolean = false) {
          const route = yield* Signal.get(currentSignal)
          if (exact) {
            return route.path === targetPath
          }
          return route.path.startsWith(targetPath)
        })
    }
    
    // Store router in FiberRef
    yield* FiberRef.set(CurrentRouter, Option.some(routerService))
    
    return routerService
  })
)
