/**
 * @since 1.0.0
 * Router Link component for trygg
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
 */
import { Duration, Effect, Fiber, FiberRef, Layer, Context } from "effect";
import * as Signal from "../primitives/signal.js";
import {
  Element,
  intrinsic,
  normalizeChildren,
  type ElementProps,
  componentElement,
  provideElement,
} from "../primitives/element.js";

import * as Debug from "../debug/debug.js";
import { get as getRouter, Router } from "./service.js";
import { buildPath } from "./utils.js";
import type { HasKeys, RouteParamsFor, RoutePath } from "./types.js";
import { buildPathWithParams } from "./types.js";

// F-001: Prefetch constants from framework research
/** Hover delay before prefetch triggers (TanStack Router default) */
const PREFETCH_HOVER_DELAY_MS = 50;

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
  readonly className?: string;
  /**
   * Prefetch strategy (default: "intent")
   * - "intent": prefetch on hover (50ms debounce) or focus
   * - "viewport": prefetch when link enters viewport (IntersectionObserver + idle callback)
   * - "render": prefetch immediately when Link renders
   * - false: no prefetch
   */
  readonly prefetch?: PrefetchStrategy;
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
function LinkImpl<Path extends RoutePath>(props: LinkProps<Path>): Element {
  const {
    to,
    params,
    query: queryParams,
    replace,
    children,
    className,
    prefetch = "intent",
  } = props;

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
      const prefetchScope = yield* FiberRef.get(Signal.CurrentComponentScope);

      // F-001: Prefetch state and handlers
      let prefetchTriggered = false;
      let hoverFiber: Fiber.RuntimeFiber<void> | null = null;

      // Trigger prefetch once (guarded by flag)
      const triggerPrefetch = Effect.gen(function* () {
        if (prefetchTriggered) return;
        prefetchTriggered = true;
        yield* router.prefetch(resolvedPath);
      });

      // Mouse enter handler — 50ms debounce via scoped fiber.
      // Uses forkIn(componentScope) so the fiber is tied to the component
      // lifecycle: auto-interrupted on unmount, no floating fibers.
      const handleMouseEnter =
        prefetch === "intent" && prefetchScope !== null
          ? Effect.fnUntraced(function* () {
              if (prefetchTriggered) return;
              // Cancel pending hover fiber before starting a new one
              if (hoverFiber !== null) {
                yield* Fiber.interrupt(hoverFiber);
              }
              const fiber = yield* Effect.forkIn(
                Effect.sleep(Duration.millis(PREFETCH_HOVER_DELAY_MS)).pipe(
                  Effect.flatMap(() => triggerPrefetch),
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
              yield* triggerPrefetch;
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
        const options = {
          ...(replace !== undefined ? { replace } : {}),
          ...(queryParams !== undefined ? { query: queryParams } : {}),
        };
        yield* router
          .navigate(resolvedPath, Object.keys(options).length > 0 ? options : undefined)
          .pipe(Effect.ignore);
      });

      // F-001: Trigger prefetch immediately for "render" strategy
      if (prefetch === "render") {
        yield* triggerPrefetch;
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
        ...(prefetch === "viewport"
          ? {
              "data-trygg-prefetch": "viewport",
              "data-trygg-prefetch-path": resolvedPath,
            }
          : {}),
      };

      const childElements = normalizeChildren(children);

      return intrinsic("a", anchorProps, childElements);
    });

  // Return a component element that will execute the effect when rendered
  return componentElement(run);
}

// Define the Link component type with Component.Type properties
interface LinkComponent {
  <Path extends RoutePath>(props: LinkProps<Path>): Element;
  readonly _tag: "EffectComponent";
  readonly _layers: ReadonlyArray<Layer.Layer.Any>;
  readonly _displayName: "Link";
  provide<RIn, E2, ROut>(layer: Layer.Layer<ROut, E2, RIn>): LinkComponent;
}

// Apply Component.Type properties to Link function
const linkComponent: LinkComponent = Object.assign(
  <Path extends RoutePath>(props: LinkProps<Path>): Element => LinkImpl(props),
  {
    _tag: "EffectComponent" as const,
    _layers: [] as ReadonlyArray<Layer.Layer.Any>,
    _displayName: "Link" as const,
    provide: <RIn, E2, ROut>(layer: Layer.Layer<ROut, E2, RIn>): LinkComponent => {
      const wrappedLink: LinkComponent = Object.assign(
        <Path extends RoutePath>(props: LinkProps<Path>): Element => {
          const run = (): Effect.Effect<Element, E2, RIn> =>
            Effect.gen(function* () {
              const context = yield* Effect.context<ROut>().pipe(
                Effect.provide(layer),
                Effect.map((ctx) => ctx as Context.Context<unknown>),
              );
              const element = LinkImpl(props);
              return provideElement(context, element);
            });
          return componentElement(run);
        },
        {
          _tag: "EffectComponent" as const,
          _layers: [layer] as ReadonlyArray<Layer.Layer.Any>,
          _displayName: "Link" as const,
          provide: linkComponent.provide,
        },
      );
      return wrappedLink;
    },
  },
);

// Export the tagged Link component
export { linkComponent as Link };
