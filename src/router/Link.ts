/**
 * @since 1.0.0
 * Router Link components for effect-ui
 * 
 * ## Type-Safe Navigation
 * 
 * ```tsx
 * // Static path - no params needed
 * <Link to="/">Home</Link>
 * 
 * // Dynamic path - params required and type-checked
 * <Link to="/users/:id" params={{ id: "123" }}>User</Link>
 * ```
 * 
 * ## Active Link Styling
 * 
 * Use `Link` with `Router.isActive()` for active state:
 * 
 * ```tsx
 * const NavItem = Effect.gen(function* () {
 *   const isActive = yield* Router.isActive("/users")
 *   return (
 *     <Link 
 *       to="/users" 
 *       className={isActive ? "nav-link active" : "nav-link"}
 *       aria-current={isActive ? "page" : undefined}
 *     >
 *       Users
 *     </Link>
 *   )
 * })
 * ```
 * 
 * **Note:** `NavLink` is deprecated. Use `Link` + `Router.isActive()` instead.
 */
import { Effect } from "effect"
import { Element, intrinsic, componentElement, normalizeChildren, type ElementProps } from "../Element.js"
import * as Signal from "../Signal.js"
import * as Debug from "../debug.js"
import { getRouter } from "./RouterService.js"
import { buildPath } from "./matching.js"
import { cx } from "./utils.js"
import type { RouteParamsFor, RoutePath } from "./types.js"
import { buildPathWithParams } from "./types.js"

// F-001: Prefetch constants from framework research
/** Hover delay before prefetch triggers (TanStack Router default) */
const PREFETCH_HOVER_DELAY_MS = 50

/**
 * Prefetch strategy for Link component.
 * 
 * - `"intent"` (default): prefetch on hover (50ms debounce) or focus
 * - `"viewport"`: prefetch when link enters viewport (IntersectionObserver + requestIdleCallback)
 * - `"render"`: prefetch immediately when Link renders
 * - `false`: no prefetch
 * 
 * @since 1.0.0
 */
export type PrefetchStrategy = "intent" | "viewport" | "render" | false

/**
 * Check if a type has any keys
 * @internal
 */
type HasKeys<T> = keyof T extends never ? false : true

/**
 * Base link props without params
 * @internal
 */
interface BaseLinkProps<Path extends RoutePath> {
  /** Target path pattern - autocompletes from your routes */
  readonly to: Path
  /** Query parameters */
  readonly query?: Record<string, string>
  /** Replace history instead of push */
  readonly replace?: boolean
  /** Link content */
  readonly children?: unknown
  /** CSS class name */
  readonly className?: string
  /** 
   * Prefetch strategy (default: "intent")
   * - "intent": prefetch on hover (50ms debounce) or focus
   * - "viewport": prefetch when link enters viewport (IntersectionObserver + idle callback)
   * - "render": prefetch immediately when Link renders
   * - false: no prefetch
   */
  readonly prefetch?: PrefetchStrategy
}

/**
 * Link props with route autocomplete.
 * 
 * When the path contains dynamic segments (`:param`), the `params` prop is required.
 * When the path is static, `params` is not allowed.
 * 
 * @since 1.0.0
 */
export type LinkProps<Path extends RoutePath = RoutePath> = 
  HasKeys<RouteParamsFor<Path>> extends true
    ? BaseLinkProps<Path> & {
        /** Route params to substitute into path (required for this route) */
        readonly params: RouteParamsFor<Path>
      }
    : BaseLinkProps<Path> & {
        /** Route params - not needed for static paths */
        readonly params?: never
      }

/**
 * Router Link - navigates without full page reload
 * 
 * Renders an `<a>` element with proper href for accessibility and SEO,
 * but intercepts clicks to use client-side navigation.
 * 
 * ## Active Link Styling
 * 
 * Link does NOT track active state. Use `Router.isActive()` to compute active
 * state and set attributes like `aria-current` and `data-active`:
 * 
 * ```tsx
 * const NavItem = Effect.gen(function* () {
 *   const isActive = yield* Router.isActive("/users")
 *   return (
 *     <Link 
 *       to="/users" 
 *       className={isActive ? "nav-link active" : "nav-link"}
 *       aria-current={isActive ? "page" : undefined}
 *       data-active={isActive ? "true" : undefined}
 *     >
 *       Users
 *     </Link>
 *   )
 * })
 * ```
 * 
 * ## Usage
 * 
 * ```tsx
 * // Static path
 * <Link to="/about">About</Link>
 * 
 * // Dynamic path - params required
 * <Link to="/users/:id" params={{ id: "123" }}>View User</Link>
 * 
 * // With query params
 * <Link to="/search" query={{ q: "effect" }}>Search</Link>
 * 
 * // Replace history instead of push
 * <Link to="/login" replace>Login</Link>
 * ```
 * 
 * @since 1.0.0
 */
export const Link = <Path extends RoutePath>(props: LinkProps<Path>): Element => {
  const { to, params, query: queryParams, replace, children, className, prefetch = "intent" } = props
  
  // Build resolved path (substitute params if provided)
  const resolvedPath = params ? buildPathWithParams(to, params) : to
  
  // Build full href with query string
  const href = buildPath(resolvedPath, queryParams)
  
  // Link needs router for click handler, but does NOT subscribe to route changes
  const linkEffect = Effect.gen(function* () {
    const router = yield* getRouter
    
    // F-001: Prefetch state and handlers
    let prefetchTriggered = false
    let hoverTimeout: ReturnType<typeof setTimeout> | null = null
    
    // Trigger prefetch once (guarded by flag)
    const triggerPrefetch = Effect.gen(function* () {
      if (prefetchTriggered) return
      prefetchTriggered = true
      yield* router.prefetch(resolvedPath)
    })
    
    // Mouse enter handler - 50ms debounce before prefetch
    const handleMouseEnter = prefetch === "intent"
      ? Effect.fnUntraced(function* () {
          if (prefetchTriggered) return
          hoverTimeout = setTimeout(() => {
            Effect.runFork(triggerPrefetch)
          }, PREFETCH_HOVER_DELAY_MS)
        })
      : undefined
    
    // Mouse leave handler - cancel pending prefetch
    const handleMouseLeave = prefetch === "intent"
      ? Effect.fnUntraced(function* () {
          if (hoverTimeout !== null) {
            clearTimeout(hoverTimeout)
            hoverTimeout = null
          }
        })
      : undefined
    
    // Focus handler - immediate prefetch (accessibility)
    const handleFocus = prefetch === "intent"
      ? Effect.fnUntraced(function* () {
          if (prefetchTriggered) return
          yield* triggerPrefetch
        })
      : undefined
    
    // Click handler - prevents default and uses router
    // NOTE: We capture `router` from the closure instead of calling getRouter again,
    // because event handlers run in forked fibers that don't inherit FiberRef values.
    const handleClick = Effect.fnUntraced(function* (event: Event) {
      // Don't intercept if modifier keys are pressed (open in new tab, etc.)
      if (event instanceof MouseEvent) {
        if (event.metaKey || event.ctrlKey || event.shiftKey) {
          yield* Debug.log({
            event: "router.link.click",
            to_path: resolvedPath,
            reason: "modifier key pressed, allowing default"
          })
          return
        }
      }
      
      yield* Debug.log({
        event: "router.link.click",
        to_path: resolvedPath,
        ...(replace !== undefined ? { replace } : {})
      })
      
      event.preventDefault()
      const options = {
        ...(replace !== undefined ? { replace } : {}),
        ...(queryParams !== undefined ? { query: queryParams } : {})
      }
      yield* router.navigate(resolvedPath, Object.keys(options).length > 0 ? options : undefined)
    })
    
    // F-001: Trigger prefetch immediately for "render" strategy
    if (prefetch === "render") {
      yield* triggerPrefetch
    }
    
    // Build props for the anchor element
    const anchorProps: ElementProps = {
      href,
      onClick: handleClick,
      ...(className ? { className } : {}),
      ...(handleMouseEnter ? { onMouseEnter: handleMouseEnter } : {}),
      ...(handleMouseLeave ? { onMouseLeave: handleMouseLeave } : {}),
      ...(handleFocus ? { onFocus: handleFocus } : {}),
      // F-001: Viewport prefetch uses data attributes + global observer
      ...(prefetch === "viewport" ? { 
        "data-effectui-prefetch": "viewport",
        "data-effectui-prefetch-path": resolvedPath
      } : {})
    }
    
    const childElements = normalizeChildren(children)
    
    return intrinsic("a", anchorProps, childElements)
  })
  
  return componentElement(() => linkEffect)
}

/**
 * Base NavLink props without params
 * @internal
 */
interface BaseNavLinkProps<Path extends RoutePath> extends BaseLinkProps<Path> {
  /** Class to add when link is active */
  readonly activeClassName?: string
  /** Only match exact path (no prefix matching) */
  readonly exact?: boolean
}

/**
 * NavLink props with route autocomplete
 * @since 1.0.0
 */
export type NavLinkProps<Path extends RoutePath = RoutePath> = 
  HasKeys<RouteParamsFor<Path>> extends true
    ? BaseNavLinkProps<Path> & {
        /** Route params to substitute into path (required for this route) */
        readonly params: RouteParamsFor<Path>
      }
    : BaseNavLinkProps<Path> & {
        /** Route params - not needed for static paths */
        readonly params?: never
      }

/**
 * NavLink - Link with active state styling
 * 
 * **@deprecated** Use `Link` with `Router.isActive()` instead.
 * This component will be removed in a future version.
 * 
 * NavLink overlaps responsibility - users can derive active state from
 * `Router.current` or `Router.isActive()` and set `aria-current`/`data-active`
 * themselves. This gives full control over the semantics and attributes.
 * 
 * ## Migration
 * 
 * Before (NavLink):
 * ```tsx
 * <NavLink to="/users" className="nav-link" activeClassName="active">
 *   Users
 * </NavLink>
 * ```
 * 
 * After (Link + Router.isActive):
 * ```tsx
 * const NavLink = Effect.gen(function* () {
 *   const isActive = yield* Router.isActive("/users")
 *   return (
 *     <Link 
 *       to="/users" 
 *       className={`nav-link ${isActive ? "active" : ""}`}
 *       aria-current={isActive ? "page" : undefined}
 *     >
 *       Users
 *     </Link>
 *   )
 * })
 * ```
 * 
 * Or use the `cx` utility:
 * ```tsx
 * const NavLink = Effect.gen(function* () {
 *   const isActive = yield* Router.isActive("/users")
 *   const className = yield* cx("nav-link", isActive && "active")
 *   return (
 *     <Link to="/users" className={className} aria-current={isActive ? "page" : undefined}>
 *       Users
 *     </Link>
 *   )
 * })
 * ```
 * 
 * @since 1.0.0
 * @deprecated Use `Link` with `Router.isActive()` instead
 */
export const NavLink = <Path extends RoutePath>(props: NavLinkProps<Path>): Element => {
  const { activeClassName, className, params, exact, to, query: queryParams, replace, children } = props
  
  // Build resolved path (substitute params if provided)
  const resolvedPath = params ? buildPathWithParams(to, params) : to
  
  // Build full href with query string
  const href = buildPath(resolvedPath, queryParams)
  
  const navLinkEffect = Effect.gen(function* () {
    const router = yield* getRouter
    const route = yield* Signal.get(router.current)
    
    // Check if active - exact match only if exact prop is true
    const isActive = exact 
      ? route.path === resolvedPath
      : route.path === resolvedPath || route.path.startsWith(resolvedPath + "/")
    
    // Build final className
    const finalClassName = yield* cx(className, isActive && activeClassName)
    
    // Click handler - same as Link
    const handleClick = Effect.fnUntraced(function* (event: Event) {
      if (event instanceof MouseEvent) {
        if (event.metaKey || event.ctrlKey || event.shiftKey) {
          yield* Debug.log({
            event: "router.link.click",
            to_path: resolvedPath,
            reason: "modifier key pressed, allowing default"
          })
          return
        }
      }
      
      yield* Debug.log({
        event: "router.link.click",
        to_path: resolvedPath,
        ...(replace !== undefined ? { replace } : {})
      })
      
      event.preventDefault()
      const options = {
        ...(replace !== undefined ? { replace } : {}),
        ...(queryParams !== undefined ? { query: queryParams } : {})
      }
      yield* router.navigate(resolvedPath, Object.keys(options).length > 0 ? options : undefined)
    })
    
    // Build props for the anchor element - render directly, not via Link
    const anchorProps: ElementProps = {
      href,
      onClick: handleClick,
      ...(finalClassName ? { className: finalClassName } : {})
    }
    
    const childElements = normalizeChildren(children)
    
    return intrinsic("a", anchorProps, childElements)
  })
  
  return componentElement(() => navLinkEffect)
}
