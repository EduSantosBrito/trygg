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
import { Effect, Exit, Predicate, Schema, Scope } from "effect";
import { gen, Component, type ComponentProps } from "./component.js";
import { type Element, Element as ElementEnum, signalElement, empty } from "./element.js";
import type { MaybeSignal } from "./element.js";
import * as Signal from "./signal.js";
import { asFinalizer } from "./render-cleanup.js";

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
export class PortalTargetNotFoundError extends Schema.TaggedError<PortalTargetNotFoundError>()(
  "PortalTargetNotFoundError",
  {
    target: Schema.String,
  },
) {
  override get message() {
    return `Portal target not found: ${this.target}`;
  }
}

/**
 * A native DOM operation failed while acquiring or releasing a portal target.
 *
 * @remarks
 * Acquisition failures stay in the typed error channel. A failed removal during
 * Scope finalization is promoted to a defect because finalizers cannot expose a
 * typed failure; it remains observable in the closing Scope's Cause.
 *
 * @example
 * ```tsx
 * const portal = Portal.make(<div />, { target: "[" }).pipe(
 *   Effect.catchTag("PortalDomError", (error) => Effect.logError(error.operation)),
 * )
 * ```
 *
 * @category Portals
 * @public
 * @since 1.0.0
 */
export class PortalDomError extends Schema.TaggedError<PortalDomError>()("PortalDomError", {
  operation: Schema.Literals([
    "createElement",
    "setAttribute",
    "appendChild",
    "querySelector",
    "remove",
  ]),
  cause: Schema.Unknown,
}) {}

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

const domOperation = <A>(operation: PortalDomError["operation"], evaluate: () => A) =>
  Effect.try({ try: evaluate, catch: (cause) => new PortalDomError({ operation, cause }) });

const dynamicTarget = Effect.gen(function* () {
  const componentScope = yield* Signal.CurrentComponentScope;
  const owner = componentScope ?? (yield* Effect.scope);
  if (Predicate.isTagged(owner.state, "Closed")) return yield* Effect.interrupt;
  const scope = yield* Scope.fork(owner);

  return yield* Effect.gen(function* () {
    // Acquire the detached node before publishing it. The child Scope rolls back
    // a partial append immediately on failure, without closing the caller's Scope.
    const container = yield* Effect.acquireRelease(
      domOperation("createElement", () => document.createElement("div")),
      // Scope finalizers have no typed error channel; retain failed removal as a
      // defect so shutdown reports it while attempting its other finalizers.
      (node) => domOperation("remove", () => node.remove()).pipe(asFinalizer),
    );
    if (Predicate.isTagged(scope.state, "Closed")) return yield* Effect.interrupt;
    yield* domOperation("setAttribute", () => container.setAttribute("data-portal-container", ""));
    yield* domOperation("appendChild", () => document.body.appendChild(container));
    return container;
  }).pipe(
    Scope.provide(scope),
    Effect.onExit((exit) => (Exit.isFailure(exit) ? Scope.close(scope, exit) : Effect.void)),
  );
});

// =============================================================================
// Portal.make
// =============================================================================

/**
 * Create a portal component that renders content into a different DOM location.
 *
 * @remarks
 * Returns a ComponentType that accepts an optional `visible` prop to control
 * mount/unmount. When `visible` is a Signal, the portal reacts to changes.
 * Invalid selectors and native DOM acquisition failures return `PortalDomError`.
 * Dynamic containers are owned before insertion and rolled back on failed or
 * interrupted acquisition. Dynamic acquisition into a closed owner is interrupted.
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
  PortalTargetNotFoundError | PortalDomError,
  Scope.Scope
> = Effect.fn("Portal.make")(function* (content, options) {
  let resolvedTarget: HTMLElement;

  if (options?.target === undefined) {
    resolvedTarget = yield* dynamicTarget;
  } else if (typeof options.target === "string") {
    // CSS selector: resolve at creation time
    const selector = options.target;
    const el = yield* domOperation("querySelector", () => document.querySelector(selector));
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
