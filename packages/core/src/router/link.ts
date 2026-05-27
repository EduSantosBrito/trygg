/**
 * Link component primitives for `trygg/router`.
 *
 * @remarks
 * Owner module for declarative router links. This module owns the `Link`
 * component, its type-safe props, and the prefetch strategy type used to decide
 * when route work should warm before navigation.
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
 * Use `Link` with `Router.isActive()` for reactive active state:
 *
 * ```tsx
 * const NavItem = Component.gen(function* () {
 *   const active = yield* Router.isActive("/users")
 *   // Derive string attributes from the boolean Signal
 *   const dataActive = yield* Signal.derive(active, a => a ? "true" : "")
 *   const ariaCurrent = yield* Signal.derive(active, a => a ? "page" : "")
 *   return (
 *     <Link
 *       to="/users"
 *       className="nav-link"
 *       data-active={dataActive}
 *       aria-current={ariaCurrent}
 *     >
 *       Users
 *     </Link>
 *   )
 * })
 * ```
 * @see ./link.docs.md - Source-owned topic guide
 * @since 1.0.0
 * @module trygg/router/link
 */
import { Duration, Effect, Fiber } from "effect";
import * as Signal from "../primitives/signal.js";
import {
  Element,
  intrinsic,
  type ElementProps,
  type AttributeInput,
} from "../primitives/element.js";

import * as Debug from "../debug/debug.js";
import * as ContractTrace from "../contract/trace.js";
import { get as getRouter, Router } from "./service.js";
import { buildPath } from "./utils.js";
import type { HasKeys, RouteParamsFor, RoutePath } from "./types.js";
import { buildPathWithParams } from "./types.js";

// F-001: Prefetch constants from framework research
/** Hover delay before prefetch triggers (TanStack Router default) */
const PREFETCH_HOVER_DELAY_MS = 50;
const linkRuntimeIdentity = Symbol("trygg/router/Link");

/**
 * Prefetch strategy for Link component.
 *
 * @remarks
 * `PrefetchStrategy` controls when `Link` should ask the router to prefetch the
 * target route's work.
 *
 * - `"intent"` (default): prefetch on hover (50ms debounce) or focus
 * - `"viewport"`: prefetch when link enters viewport (IntersectionObserver + requestIdleCallback)
 * - `"render"`: prefetch immediately when Link renders
 * - `false`: no prefetch
 *
 * @example
 * ```tsx
 * <Link to="/users" prefetch="viewport">Users</Link>
 * ```
 *
 * @category Router Links
 * @public
 * @since 1.0.0
 */
export type PrefetchStrategy = "intent" | "viewport" | "render" | false;

/**
 * Base link props without params
 * @internal
 */
interface BaseLinkProps<Path extends RoutePath> {
  /** Target path pattern - autocompletes from your routes */
  readonly to: Path;
  /** Query parameters */
  readonly query?: Record<string, string>;
  /** Replace history instead of push */
  readonly replace?: boolean;
  /** Link content */
  readonly children?: unknown;
  /** CSS class name */
  readonly className?: ElementProps["className"];
  /**
   * Prefetch strategy (default: "intent")
   * - "intent": prefetch on hover (50ms debounce) or focus
   * - "viewport": prefetch when link enters viewport (IntersectionObserver + idle callback)
   * - "render": prefetch immediately when Link renders
   * - false: no prefetch
   */
  readonly prefetch?: PrefetchStrategy;
  /** Forwarded to the underlying `<a>` element */
  readonly [key: `data-${string}`]: AttributeInput | undefined;
  /** Forwarded to the underlying `<a>` element */
  readonly [key: `aria-${string}`]: AttributeInput | undefined;
}

/**
 * Link props with route autocomplete.
 *
 * @remarks
 * `LinkProps` makes the `params` prop required only for route patterns that
 * actually contain dynamic segments.
 *
 * When the path contains dynamic segments (`:param`), the `params` prop is required.
 * When the path is static, `params` is not allowed.
 *
 * @example
 * ```tsx
 * const profileLink: LinkProps<"/users/:id"> = {
 *   to: "/users/:id",
 *   params: { id: "123" },
 * }
 * ```
 *
 * @category Router Links
 * @public
 * @since 1.0.0
 */
export type LinkProps<Path extends RoutePath = RoutePath> =
  HasKeys<RouteParamsFor<Path>> extends true
    ? BaseLinkProps<Path> & {
        /** Route params to substitute into path (required for this route) */
        readonly params: RouteParamsFor<Path>;
      }
    : BaseLinkProps<Path> & {
        /** Route params - not needed for static paths */
        readonly params?: never;
      };

/**
 * Router Link - navigates without full page reload
 *
 * Renders an `<a>` element with proper href for accessibility and SEO,
 * but intercepts clicks to use client-side navigation.
 *
 * ## Active Link Styling
 *
 * Link does NOT track active state. Use `Router.isActive()` to get a reactive
 * `Signal<boolean>`, then derive string attributes for `aria-current` / `data-active`:
 *
 * ```tsx
 * const NavItem = Component.gen(function* () {
 *   const active = yield* Router.isActive("/users")
 *   const dataActive = yield* Signal.derive(active, a => a ? "true" : "")
 *   const ariaCurrent = yield* Signal.derive(active, a => a ? "page" : "")
 *   return (
 *     <Link
 *       to="/users"
 *       className="nav-link"
 *       data-active={dataActive}
 *       aria-current={ariaCurrent}
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
function LinkImpl<Path extends RoutePath>(props: LinkProps<Path>): Element {
  const {
    to,
    params,
    query: queryParams,
    replace,
    children,
    className,
    prefetch = "intent",
    ...rest
  } = props;

  // Collect data-* and aria-* attributes for forwarding to <a>
  // Excludes data-trygg-* (reserved for internal framework use)
  const forwarded: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(rest)) {
    if (key.startsWith("data-trygg-")) continue;
    if (key.startsWith("data-") || key.startsWith("aria-")) {
      forwarded[key] = value;
    }
  }

  // Create the effect that builds the link element
  // Requires Router service from parent context
  const run = (): Effect.Effect<Element, never, Router> =>
    Effect.gen(function* () {
      // Build resolved path (substitute params if provided)
      const resolvedPath = params ? yield* buildPathWithParams(to, params) : to;

      // Build full href with query string
      const href = yield* buildPath(resolvedPath, queryParams);

      const router = yield* getRouter;

      // Capture component scope — ties prefetch fibers to component lifecycle.
      // Always set inside a component render. If somehow null (should not happen),
      // prefetch handlers become no-ops via the guard below.
      const prefetchScope = yield* Signal.CurrentComponentScope;

      // F-001: Prefetch state and handlers
      let prefetchTriggered = false;
      let hoverFiber: Fiber.Fiber<void, never> | null = null;

      // Trigger prefetch once (guarded by flag)
      const triggerPrefetch = (
        trigger: "render" | "intent_hover" | "intent_focus",
      ): Effect.Effect<void> =>
        Effect.gen(function* () {
          if (prefetchTriggered) return;
          prefetchTriggered = true;
          yield* Debug.log({
            event: "router.prefetch.trigger",
            path: href,
            trigger,
          });
          yield* router.prefetch(href);
        });

      // Pointer move handler — 50ms debounce via scoped fiber.
      // Uses forkIn(componentScope) so the fiber is tied to the component
      // lifecycle: auto-interrupted on unmount, no floating fibers.
      const handlePointerMove =
        prefetch === "intent" && prefetchScope !== null
          ? Effect.fnUntraced(function* () {
              if (prefetchTriggered) return;
              // Cancel pending hover fiber before starting a new one
              if (hoverFiber !== null) {
                yield* Fiber.interrupt(hoverFiber);
              }
              const fiber = yield* Effect.forkIn(
                Effect.sleep(Duration.millis(PREFETCH_HOVER_DELAY_MS)).pipe(
                  Effect.flatMap(() => triggerPrefetch("intent_hover")),
                ),
                prefetchScope,
              );
              hoverFiber = fiber;
            })
          : undefined;

      // Mouse leave handler - interrupt pending prefetch fiber
      const handleMouseLeave =
        prefetch === "intent"
          ? Effect.fnUntraced(function* () {
              if (hoverFiber !== null) {
                yield* Fiber.interrupt(hoverFiber);
                hoverFiber = null;
              }
            })
          : undefined;

      // Focus handler - immediate prefetch (accessibility)
      const handleFocus =
        prefetch === "intent"
          ? Effect.fnUntraced(function* () {
              if (prefetchTriggered) return;
              yield* triggerPrefetch("intent_focus");
            })
          : undefined;

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
              reason: "modifier key pressed, allowing default",
            });
            return;
          }
        }

        yield* Debug.log({
          event: "router.link.click",
          to_path: resolvedPath,
          ...(replace !== undefined ? { replace } : {}),
        });

        event.preventDefault();
        yield* ContractTrace.emit({
          event: "event.preventDefault",
          level: "semantic",
          payload: { eventType: event.type, target: resolvedPath },
        });
        const options = {
          ...(replace !== undefined ? { replace } : {}),
          ...(queryParams !== undefined ? { query: queryParams } : {}),
        };
        yield* router
          .navigate(resolvedPath, Object.keys(options).length > 0 ? options : undefined)
          .pipe(
            Effect.catchCause((cause) =>
              ContractTrace.emit({
                event: "effect.error.ignored",
                level: "semantic",
                payload: {
                  owner: "router.link",
                  operation: "navigate",
                  cause: String(cause),
                },
              }),
            ),
          );
      });

      // F-001: Trigger prefetch immediately for "render" strategy
      if (prefetch === "render") {
        if (prefetchScope !== null) {
          yield* Effect.forkIn(
            Effect.yieldNow.pipe(Effect.flatMap(() => triggerPrefetch("render"))),
            prefetchScope,
          );
        } else {
          yield* triggerPrefetch("render");
        }
      }

      // Build props for the anchor element
      const anchorProps: ElementProps = {
        href,
        onClick: handleClick,
        ...(className ? { className } : {}),
        ...(handlePointerMove ? { onPointerMove: handlePointerMove } : {}),
        ...(handleMouseLeave ? { onMouseLeave: handleMouseLeave } : {}),
        ...(handleFocus ? { onFocus: handleFocus } : {}),
        // F-001: Viewport prefetch uses data attributes + global observer
        ...(prefetch === "viewport"
          ? {
              "data-trygg-prefetch": "viewport",
              "data-trygg-prefetch-path": href,
            }
          : {}),
        // Forward data-* and aria-* attributes to <a>
        ...forwarded,
      };

      const childElements = yield* Element.fromChildren(children);

      return intrinsic("a", anchorProps, childElements);
    });

  // Return a component element that will execute the effect when rendered
  return Element.fromEffect(Effect.suspend(run), { identity: linkRuntimeIdentity, inputs: props });
}

// Define the Link component type with Component.Type properties.
interface LinkComponent {
  <Path extends RoutePath>(props: LinkProps<Path>): Element;
  readonly _tag: "EffectComponent";
  readonly _layers: ReadonlyArray<unknown>;
  readonly _displayName: "Link";
}

// Apply Component.Type properties to Link function.
const linkComponent: LinkComponent = Object.assign(
  <Path extends RoutePath>(props: LinkProps<Path>): Element => LinkImpl(props),
  {
    _tag: "EffectComponent" as const,
    _layers: [] as ReadonlyArray<unknown>,
    _displayName: "Link" as const,
  },
);

/**
 * Router Link - navigates without full page reload.
 *
 * @remarks
 * `Link` renders a real anchor for accessibility and SEO, but intercepts normal
 * clicks to drive the router, keeping params, query, and prefetch behavior in
 * one place.
 *
 * @example
 * ```tsx
 * <Link to="/users/:id" params={{ id: "123" }} prefetch="intent">
 *   View user
 * </Link>
 * ```
 *
 * @category Router Links
 * @public
 * @since 1.0.0
 */
export const Link: LinkComponent = linkComponent;
