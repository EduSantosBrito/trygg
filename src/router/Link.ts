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
 * 
 * // Active link styling - use NavLink with activeClassName
 * <NavLink to="/users" activeClassName="active">Users</NavLink>
 * ```
 */
import { Effect } from "effect"
import { Element, intrinsic, componentElement, normalizeChildren, type ElementProps } from "../Element.js"
import * as Signal from "../Signal.js"
import * as Debug from "../debug.js"
import { getRouter } from "./RouterService.js"
import { buildPath } from "./matching.js"
import { cx } from "./utils.js"
import type { ExtractRouteParams, RoutePath, RouteMap } from "./types.js"
import { buildPathWithParams } from "./types.js"

/**
 * Check if a type has any keys
 * @internal
 */
type HasKeys<T> = keyof T extends never ? false : true

/**
 * Simplify intersection types for better display
 * @internal
 */
type Simplify<T> = { [K in keyof T]: T[K] } & {}

/**
 * Get params type for a path - from RouteMap if available, otherwise extract from path
 * @internal
 */
type GetParams<Path extends string> = 
  Path extends keyof RouteMap 
    ? RouteMap[Path] 
    : Simplify<ExtractRouteParams<Path>>

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
  HasKeys<GetParams<Path>> extends true
    ? BaseLinkProps<Path> & {
        /** Route params to substitute into path (required for this route) */
        readonly params: GetParams<Path>
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
 * **Note:** Link does NOT track active state. Use `NavLink` with `activeClassName`
 * for active link styling.
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
  const { to, params, query: queryParams, replace, children, className } = props
  
  // Build resolved path (substitute params if provided)
  const resolvedPath = params ? buildPathWithParams(to, params as Record<string, string> as ExtractRouteParams<Path>) : to
  
  // Build full href with query string
  const href = buildPath(resolvedPath, queryParams)
  
  // Link needs router for click handler, but does NOT subscribe to route changes
  const linkEffect = Effect.gen(function* () {
    const router = yield* getRouter
    
    // Click handler - prevents default and uses router
    // NOTE: We capture `router` from the closure instead of calling getRouter again,
    // because event handlers run in forked fibers that don't inherit FiberRef values.
    const handleClick = Effect.fnUntraced(function* (event: Event) {
      // Don't intercept if modifier keys are pressed (open in new tab, etc.)
      if (event instanceof MouseEvent) {
        if (event.metaKey || event.ctrlKey || event.shiftKey) {
          Debug.log({
            event: "router.link.click",
            to_path: resolvedPath,
            reason: "modifier key pressed, allowing default"
          })
          return
        }
      }
      
      Debug.log({
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
    
    // Build props for the anchor element
    const anchorProps: ElementProps = {
      href,
      onClick: handleClick,
      ...(className ? { className } : {})
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
  HasKeys<GetParams<Path>> extends true
    ? BaseNavLinkProps<Path> & {
        /** Route params to substitute into path (required for this route) */
        readonly params: GetParams<Path>
      }
    : BaseNavLinkProps<Path> & {
        /** Route params - not needed for static paths */
        readonly params?: never
      }

/**
 * NavLink - Link with active state styling
 * 
 * Subscribes to route changes and applies `activeClassName` when the route matches.
 * Use this when you need visual feedback for the current route.
 * 
 * @example
 * ```tsx
 * // Basic usage - adds "active" class when on /users
 * <NavLink to="/users" className="nav-link" activeClassName="active">
 *   Users
 * </NavLink>
 * 
 * // Exact matching - only active on exact /settings, not /settings/profile
 * <NavLink to="/settings" activeClassName="active" exact>
 *   Settings
 * </NavLink>
 * 
 * // With params
 * <NavLink 
 *   to="/users/:id" 
 *   params={{ id: "123" }}
 *   activeClassName="active"
 * >
 *   User Profile
 * </NavLink>
 * ```
 * 
 * @since 1.0.0
 */
export const NavLink = <Path extends RoutePath>(props: NavLinkProps<Path>): Element => {
  const { activeClassName, className, params, exact, to, query: queryParams, replace, children } = props
  
  // Build resolved path (substitute params if provided)
  const resolvedPath = params ? buildPathWithParams(to, params as Record<string, string> as ExtractRouteParams<Path>) : to
  
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
          Debug.log({
            event: "router.link.click",
            to_path: resolvedPath,
            reason: "modifier key pressed, allowing default"
          })
          return
        }
      }
      
      Debug.log({
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
