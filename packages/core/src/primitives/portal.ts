/**
 * @since 1.0.0
 * Portal - Effect-native DOM teleportation
 *
 * Portal.make wraps content into a ComponentType that renders
 * into a different DOM location (the target).
 *
 * @example
 * ```tsx
 * const Modal = Component.gen(function* () {
 *   const isOpen = yield* Signal.make(false)
 *
 *   const PortalledDialog = yield* Portal.make(
 *     <Dialog onClose={() => Signal.set(isOpen, false)} />,
 *     { target: document.body }
 *   )
 *
 *   return (
 *     <div>
 *       <button onClick={() => Signal.set(isOpen, true)}>Open</button>
 *       <PortalledDialog visible={isOpen} />
 *     </div>
 *   )
 * })
 * ```
 */
import { Data, Effect, FiberRef, Scope } from "effect";
import { gen, Component, type ComponentProps } from "./component.js";
import { type Element, Element as ElementEnum, signalElement, empty } from "./element.js";
import type { MaybeSignal } from "./element.js";
import * as Signal from "./signal.js";

// =============================================================================
// Errors
// =============================================================================

/**
 * Error raised when a CSS selector target cannot be resolved.
 * @since 1.0.0
 */
export class PortalTargetNotFoundError extends Data.TaggedError("PortalTargetNotFoundError")<{
  readonly target: string;
}> {
  override get message() {
    return `Portal target not found: ${this.target}`;
  }
}

// =============================================================================
// Types
// =============================================================================

/**
 * Props accepted by the ComponentType returned from Portal.make.
 * @since 1.0.0
 */
export interface PortalProps {
  readonly visible?: MaybeSignal<boolean>;
}

/**
 * Options for Portal.make.
 * @since 1.0.0
 */
export interface PortalOptions {
  /** Target DOM element or CSS selector. If omitted, creates a dynamic container on document.body. */
  readonly target?: HTMLElement | string;
}

// =============================================================================
// Internal Helpers
// =============================================================================

const isSignal = (value: unknown): value is Signal.Signal<unknown> => {
  if (typeof value !== "object" || value === null) return false;
  if (!("_tag" in value)) return false;
  return value._tag === "Signal";
};

// =============================================================================
// Portal.make
// =============================================================================

/**
 * Create a portal component that renders content into a different DOM location.
 *
 * Returns a ComponentType that accepts an optional `visible` prop to control
 * mount/unmount. When `visible` is a Signal, the portal reacts to changes.
 *
 * @example
 * ```tsx
 * // Targeted (HTMLElement)
 * const MyPortal = yield* Portal.make(<Dialog />, { target: myDiv })
 *
 * // Targeted (CSS selector)
 * const MyPortal = yield* Portal.make(<Dialog />, { target: "#modal-root" })
 *
 * // Dynamic (creates container on document.body)
 * const MyPortal = yield* Portal.make(<Toast message="Saved" />)
 *
 * // Use in JSX with visibility control
 * return <MyPortal visible={isOpenSignal} />
 * ```
 *
 * @since 1.0.0
 */
export const make = (
  content: Element,
  options?: PortalOptions,
): Effect.Effect<
  Component.Type<PortalProps, never, Scope.Scope>,
  PortalTargetNotFoundError,
  Scope.Scope
> =>
  Effect.gen(function* () {
    let resolvedTarget: HTMLElement;

    if (options?.target === undefined) {
      // Dynamic: create container on document.body
      const container = document.createElement("div");
      container.setAttribute("data-portal-container", "");
      document.body.appendChild(container);

      // Register cleanup: remove container when scope closes
      const componentScope = yield* FiberRef.get(Signal.CurrentComponentScope);
      const scope = componentScope ?? (yield* Effect.scope);
      yield* Scope.addFinalizer(
        scope,
        Effect.sync(() => {
          container.remove();
        }),
      );

      resolvedTarget = container;
    } else if (typeof options.target === "string") {
      // CSS selector: resolve at creation time
      const el = document.querySelector(options.target);
      if (el === null || !(el instanceof HTMLElement)) {
        return yield* new PortalTargetNotFoundError({ target: options.target });
      }
      resolvedTarget = el;
    } else {
      // HTMLElement: use directly
      resolvedTarget = options.target;
    }

    // Capture target for the component closure
    const target = resolvedTarget;

    // Return a ComponentType that renders content into target
    return gen(function* (Props: ComponentProps<PortalProps>) {
      const { visible } = yield* Props;

      // No visible prop → always render into target
      if (visible === undefined) {
        return ElementEnum.Portal({ target, children: [content] });
      }

      // Static boolean
      if (!isSignal(visible)) {
        if (visible) {
          return ElementEnum.Portal({ target, children: [content] });
        }
        return empty;
      }

      // Signal<boolean> → derive reactive element
      const derived = yield* Signal.derive(
        visible as Signal.Signal<boolean>,
        (show): Element => (show ? ElementEnum.Portal({ target, children: [content] }) : empty),
      );

      return signalElement(derived);
    });
  });
