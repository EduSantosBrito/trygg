/**
 * Portal components for rendering into alternate DOM targets.
 *
 * @remarks
 * Owner module for the `Portal` topic. Use this module when a component should
 * keep its data flow in the current render tree but mount DOM nodes under a
 * separate target like `document.body` or a modal root.
 *
 * @see ./portal.docs.md - Source-owned topic guide
 * @since 1.0.0
 * @module trygg/primitives/portal
 */
import { Effect, Schema, Scope } from "effect";
import { gen, Component, type ComponentProps } from "./component.js";
import { type Element, Element as ElementEnum, signalElement, empty } from "./element.js";
import type { MaybeSignal } from "./element.js";
import * as Signal from "./signal.js";

// =============================================================================
// Errors
// =============================================================================

/**
 * Error raised when a CSS selector target cannot be resolved.
 *
 * @remarks
 * `Portal.make` fails with this error when a selector target is missing or does
 * not resolve to an `HTMLElement`.
 *
 * @example
 * ```ts
 * const exit = yield* Effect.exit(Portal.make(<div />, { target: "#missing" }))
 * ```
 *
 * @category Portals
 * @public
 * @since 1.0.0
 */
export class PortalTargetNotFoundError extends Schema.TaggedErrorClass<PortalTargetNotFoundError>()(
  "PortalTargetNotFoundError",
  {
    target: Schema.String,
  },
) {
  override get message() {
    return `Portal target not found: ${this.target}`;
  }
}

// =============================================================================
// Types
// =============================================================================

/**
 * Props accepted by the ComponentType returned from Portal.make.
 *
 * @remarks
 * `visible` can stay static or reactive, so the returned portal component can
 * mount and unmount without changing the original content definition.
 *
 * @example
 * ```ts
 * const props: PortalProps = { visible: true }
 * ```
 *
 * @category Portals
 * @public
 * @since 1.0.0
 */
export interface PortalProps {
  readonly visible?: MaybeSignal<boolean>;
}

/**
 * Options for Portal.make.
 *
 * @remarks
 * Omit `target` to allocate a container under `document.body`, or pass a DOM
 * node or selector when the mount point already exists.
 *
 * @example
 * ```ts
 * const options: PortalOptions = { target: "#modal-root" }
 * ```
 *
 * @category Portals
 * @public
 * @since 1.0.0
 */
export interface PortalOptions {
  /** Target DOM element or CSS selector. If omitted, creates a dynamic container on document.body. */
  readonly target?: HTMLElement | string;
}

// =============================================================================
// Internal Helpers
// =============================================================================

const isBooleanSignal = (value: MaybeSignal<boolean>): value is Signal.Signal<boolean> =>
  Signal.isSignal(value);

// =============================================================================
// Portal.make
// =============================================================================

/**
 * Create a portal component that renders content into a different DOM location.
 *
 * @remarks
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
 * @category Portals
 * @public
 * @since 1.0.0
 */
export const make: (
  content: Element,
  options?: PortalOptions,
) => Effect.Effect<
  Component.Type<PortalProps, never, Scope.Scope>,
  PortalTargetNotFoundError,
  Scope.Scope
> = Effect.fn("Portal.make")(function* (content, options) {
  let resolvedTarget: HTMLElement;

  if (options?.target === undefined) {
    // Dynamic: create container on document.body
    const container = document.createElement("div");
    container.setAttribute("data-portal-container", "");
    document.body.appendChild(container);

    // Register cleanup: remove container when scope closes
    const componentScope = yield* Signal.CurrentComponentScope;
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
    if (!isBooleanSignal(visible)) {
      if (visible) {
        return ElementEnum.Portal({ target, children: [content] });
      }
      return empty;
    }

    // Signal<boolean> → derive reactive element
    const derived = yield* Signal.derive(
      visible,
      (show): Element => (show ? ElementEnum.Portal({ target, children: [content] }) : empty),
    );

    return signalElement(derived);
  });
});
