/**
 * Element values and child-shape types for trygg rendering.
 *
 * @remarks
 * Owner module for the `Element` topic. This module defines the virtual element
 * model that JSX produces, along with the core child and prop types used by the
 * renderer and component surfaces.
 *
 * @see ./element.docs.md - Source-owned topic guide
 * @since 1.0.0
 * @module trygg/primitives/element
 */
import { Cause, Data, Effect, Schema, Scope, SubscriptionRef } from "effect";
import * as Context from "effect/Context";
import type { Signal } from "./signal.js";

/**
 * Check if a value is an Effect
 * @internal
 */
export const isEffect = (value: unknown): value is Effect.Effect<Element, unknown, unknown> =>
  Effect.isEffect(value);

/**
 * Key type for list reconciliation.
 * Uses Effect's Equal and Hash traits for efficient comparison.
 *
 * @remarks
 * Keys let renderer-managed collections preserve DOM identity across inserts,
 * removals, and reordering.
 *
 * @example
 * ```tsx
 * const key: ElementKey = "todo-1"
 * ```
 *
 * @category Elements
 * @public
 * @since 1.0.0
 */
export type ElementKey = string | number;

/**
 * Event handler type - a function that receives the event and returns an Effect.
 *
 * @example
 * ```tsx
 * // Function form - when you need the event
 * <input onInput={(e) => handleInput(e.target.value)} />
 *
 * // Thunk form - when you don't need the event
 * <button onClick={() => submitForm}>Submit</button>
 * <button onClick={() => reset}>Retry</button>
 * ```
 *
 * @remarks
 * trygg event props always return an Effect thunk. The renderer runs that
 * effect inside the active render scope and service context.
 *
 * @example
 * ```tsx
 * <button onClick={() => Effect.void}>Save</button>
 * ```
 *
 * @category Elements
 * @public
 * @since 1.0.0
 */
export type EventHandler<A = void, E = never, R = never> = (event: Event) => Effect.Effect<A, E, R>;

export class InvalidJsxChildError extends Data.TaggedError("InvalidJsxChildError")<{
  readonly reason: "effect";
}> {
  override get message() {
    return "Invalid JSX child: raw Effect values are not allowed; wrap in Component.gen";
  }
}

/**
 * A Signal of arbitrary type (for JSX children).
 * Internal existential wrapper around Signal invariance.
 * @internal
 */
type AnySignal = Signal<any>;

/**
 * Helper type for props that can accept either a value or a Signal
 * Enables fine-grained reactivity when passing Signals to props
 * @since 1.0.0
 */
export type MaybeSignal<T> = T | Signal<T>;

export type AttributePrimitive = string | number | boolean;

export type AttributeSignal =
  | Signal<string>
  | Signal<number>
  | Signal<boolean>
  | Signal<AttributePrimitive>;

export type AttributeInput = AttributePrimitive | AttributeSignal;

/**
 * Valid child types for JSX elements
 *
 * @remarks
 * `ElementChild` models every value JSX accepts in trygg, including nested
 * arrays, primitives, and Signals that drive fine-grained updates.
 *
 * @example
 * ```tsx
 * const child: ElementChild = "hello"
 * ```
 *
 * @category Elements
 * @public
 * @since 1.0.0
 */
export type ElementChild =
  | Element
  | AnySignal
  | string
  | number
  | boolean
  | null
  | undefined
  | ReadonlyArray<ElementChild>;

/**
 * Children prop type - can be a single child or array of children
 *
 * @remarks
 * Use `ElementChildren` when authoring low-level helpers that need the same
 * permissive child input shape as JSX intrinsic elements.
 *
 * @example
 * ```ts
 * const children: ElementChildren = ["title", 1]
 * ```
 *
 * @category Elements
 * @public
 * @since 1.0.0
 */
export type ElementChildren = ElementChild | ReadonlyArray<ElementChild>;

/**
 * Base props shared by all intrinsic elements.
 *
 * @remarks
 * `BaseProps` carries the common attributes every intrinsic element accepts
 * before element-specific props extend the shape.
 *
 * @example
 * ```ts
 * const props: BaseProps = { id: "app", children: "hello" }
 * ```
 *
 * @category Elements
 * @public
 * @since 1.0.0
 */
export interface BaseProps {
  readonly key?: ElementKey;
  readonly className?:
    | MaybeSignal<string>
    | Effect.Effect<string | Signal<string>, never, Scope.Scope>;
  readonly id?: string;
  readonly style?: Readonly<Record<string, string | number>>;
  readonly children?: ElementChildren;
  readonly [key: `data-${string}`]: AttributeInput | undefined;
  readonly [key: `aria-${string}`]: AttributeInput | undefined;
}

/**
 * Event handler that accepts any service requirements.
 * Services are provided by the ManagedRuntime at mount time.
 * @internal
 */
type AnyEventHandler = EventHandler<void, never, unknown>;

/**
 * Event props that can be attached to intrinsic elements.
 * Event handlers can have any service requirements (R) since
 * services are provided by the ManagedRuntime at mount time.
 *
 * @remarks
 * `EventProps` is the shared event-handler surface mixed into `ElementProps`
 * for intrinsic elements.
 *
 * @example
 * ```tsx
 * const props: EventProps = { onClick: () => Effect.void }
 * ```
 *
 * @category Elements
 * @public
 * @since 1.0.0
 */
export interface EventProps {
  readonly onClick?: AnyEventHandler;
  readonly onDblclick?: AnyEventHandler;
  readonly onInput?: AnyEventHandler;
  readonly onChange?: AnyEventHandler;
  readonly onSubmit?: AnyEventHandler;
  readonly onKeyDown?: AnyEventHandler;
  readonly onKeyUp?: AnyEventHandler;
  readonly onKeyPress?: AnyEventHandler;
  readonly onFocus?: AnyEventHandler;
  readonly onBlur?: AnyEventHandler;
  readonly onMouseEnter?: AnyEventHandler;
  readonly onMouseLeave?: AnyEventHandler;
  readonly onMouseDown?: AnyEventHandler;
  readonly onMouseUp?: AnyEventHandler;
  readonly onMouseMove?: AnyEventHandler;
  readonly onScroll?: AnyEventHandler;
  readonly onLoad?: AnyEventHandler;
  readonly onError?: AnyEventHandler;
}

/**
 * Props for intrinsic HTML elements
 *
 * Props marked with MaybeSignal can accept either a static value or a Signal
 * for fine-grained reactivity. When you pass a Signal, the DOM attribute
 * updates directly without re-rendering the component.
 *
 * @remarks
 * `ElementProps` is the shared prop shape used by the JSX runtime when the tag
 * is an intrinsic string like `div` or `button`.
 *
 * @example
 * ```ts
 * const props: ElementProps = { id: "root", hidden: false }
 * ```
 *
 * @category Elements
 * @public
 * @since 1.0.0
 */
export interface ElementProps extends BaseProps, EventProps {
  // Form elements - these support Signal for fine-grained updates
  // Note: Using union of individual Signal types due to invariance
  readonly value?:
    | string
    | number
    | readonly string[]
    | Signal<string>
    | Signal<number>
    | Signal<readonly string[]>;
  readonly checked?: MaybeSignal<boolean>;
  readonly disabled?: MaybeSignal<boolean>;
  readonly placeholder?: MaybeSignal<string>;
  readonly type?: string;
  readonly name?: string;
  readonly required?: boolean;
  readonly readonly?: boolean;
  readonly min?: string | number;
  readonly max?: string | number;
  readonly step?: string | number;
  readonly pattern?: string;
  readonly autoComplete?: string;
  readonly autoFocus?: boolean;
  readonly htmlFor?: string; // For label elements

  // Links and media
  readonly href?: MaybeSignal<string>;
  readonly src?: MaybeSignal<string>;
  readonly alt?: string;
  readonly target?: string;
  readonly rel?: string;
  readonly download?: string | boolean;

  // Meta elements
  readonly content?: string;
  readonly property?: string;
  readonly httpEquiv?: string;
  readonly charset?: string;

  // Script attributes
  readonly defer?: MaybeSignal<boolean>;

  // Head hoisting control
  readonly mode?: "hoisted" | "static";

  // Layout
  readonly width?: string | number;
  readonly height?: string | number;
  readonly tabIndex?: number;
  readonly title?: string;
  readonly role?: string;

  // Document-level attributes
  readonly lang?: string;
  readonly dir?: "ltr" | "rtl" | "auto";

  // Misc - className supports Signal for dynamic styling
  readonly hidden?: MaybeSignal<boolean>;
  readonly draggable?: boolean;
  readonly contentEditable?: boolean | "true" | "false" | "inherit";
  readonly spellCheck?: boolean | "true" | "false";
}

/**
 * Virtual DOM Element - the core type of trygg
 * Modeled as a tagged enum for pattern matching
 *
 * @remarks
 * `Element` is the runtime shape produced by the JSX runtime and consumed by the
 * renderer. Components return this type directly or inside Effects.
 *
 * @example
 * ```tsx
 * const view: Element = <div>Hello</div>
 * ```
 *
 * @category Elements
 * @public
 * @since 1.0.0
 */
export type Element = Data.TaggedEnum<{
  /**
   * Intrinsic HTML element like <div>, <span>, <button>
   */
  readonly Intrinsic: {
    readonly tag: string;
    readonly props: ElementProps;
    readonly children: ReadonlyArray<Element>;
    readonly key: ElementKey | null;
  };
  /**
   * Text node content
   */
  readonly Text: {
    readonly content: string;
  };
  /**
   * Reactive text node - subscribes to a Signal and updates automatically
   */
  readonly SignalText: {
    readonly signal: Signal<unknown>;
  };
  /**
   * Reactive element - subscribes to a Signal<Element> and swaps DOM when signal changes.
   * Enables conditionals without component re-renders via Signal.derive.
   * @example
   * ```tsx
   * const content = yield* Signal.derive(editText, (value) =>
   *   Option.isSome(value) ? <input /> : <span />
   * )
   * return <li>{content}</li>  // No re-render, just DOM swap!
   * ```
   */
  readonly SignalElement: {
    readonly signal: AnySignal;
    /**
     * Optional Effect invoked synchronously after the renderer's `insertBefore`
     * during a DOM swap. Used by the router outlet to synchronize scroll
     * restoration with the actual DOM update.
     * @internal
     */
    readonly onSwap: Effect.Effect<void> | undefined;
  };
  /**
   * Context boundary - provides a captured context to child components.
   * @internal
   */
  readonly Provide: {
    readonly context: Context.Context<unknown>;
    readonly child: Element;
  };
  /**
   * Effect-based component that produces an Element.
   * Stores a thunk that creates the effect at render time.
   * Services must be available in the current context before rendering.
   */
  readonly Component: {
    readonly run: () => Effect.Effect<Element, unknown, unknown>;
    readonly key: ElementKey | null;
    readonly identity: unknown;
    readonly inputs: unknown;
  };
  /**
   * Fragment containing multiple children without a wrapper element
   */
  readonly Fragment: {
    readonly children: ReadonlyArray<Element>;
  };
  /**
   * Portal - renders children into a different DOM container
   */
  readonly Portal: {
    readonly target: HTMLElement | string;
    readonly children: ElementChildren;
  };
  /**
   * KeyedList - efficient list rendering with stable scopes per key
   * Maintains identity across list updates so nested signals are preserved
   */
  readonly KeyedList: {
    readonly source: Signal<ReadonlyArray<unknown>>;
    readonly renderFn: (item: unknown, index: number) => Effect.Effect<Element, unknown, unknown>;
    readonly keyFn: (item: unknown, index: number) => string | number;
  };
  /**
   * ErrorBoundary - catches errors from child rendering and shows fallback
   * When a child component fails during re-render, swaps to fallback element
   * @internal
   */
  readonly ErrorBoundaryElement: {
    readonly child: Element;
    readonly fallback: Element | ((cause: Cause.Cause<unknown>) => Element);
    readonly onError: ((cause: Cause.Cause<unknown>) => Effect.Effect<void, never, unknown>) | null;
  };
}>;

export declare const ElementRequirementsSymbol: unique symbol;

export type ElementWithRequirements<R> = Element & {
  readonly [ElementRequirementsSymbol]?: R;
};

export type ComponentElement = Extract<Element, { _tag: "Component" }>;

export type ComponentElementWithRequirements<R> = ComponentElement & {
  readonly [ElementRequirementsSymbol]?: R;
};

/**
 * Options for Effect-backed component element construction.
 *
 * @remarks
 * Use these options to attach reconciliation metadata when lifting an
 * `Effect` into an `Element.Component`.
 *
 * @example
 * ```ts
 * const node = Element.fromEffect(Effect.succeed(text("ok")), {
 *   key: "row-1",
 *   identity: Row,
 *   inputs: { id: 1 },
 * })
 * ```
 *
 * @category Elements
 * @public
 * @since 1.0.0
 */
export interface ComponentElementOptions {
  readonly key?: ElementKey | undefined;
  readonly identity?: unknown;
  readonly inputs?: unknown;
}

/**
 * Element constructors and utilities
 *
 * @remarks
 * Use `Element` when you need explicit tagged constructors or pattern matching
 * instead of JSX syntax.
 *
 * @example
 * ```ts
 * const node = Element.Text({ content: "Hello" })
 * ```
 *
 * @category Elements
 * @public
 * @since 1.0.0
 */
const ElementBase = Data.taggedEnum<Element>();

/**
 * Create an intrinsic element.
 *
 * @remarks
 * `intrinsic` is the low-level constructor behind JSX lowering for string tag
 * names.
 *
 * @example
 * ```ts
 * const div = intrinsic("div", {}, [text("hello")])
 * ```
 *
 * @category Elements
 * @public
 * @since 1.0.0
 */
export const intrinsic = (
  tag: string,
  props: ElementProps,
  children: ReadonlyArray<Element>,
  key: ElementKey | null = null,
) => ElementBase.Intrinsic({ tag, props, children, key });

/**
 * Create a text element.
 *
 * @remarks
 * `text` creates the tagged text-node form used by the renderer.
 *
 * @example
 * ```ts
 * const node = text("hello")
 * ```
 *
 * @category Elements
 * @public
 * @since 1.0.0
 */
export const text = (content: string) => ElementBase.Text({ content });

const ComponentElementOptionsSchema = Schema.Struct({
  key: Schema.optional(Schema.Union([Schema.String, Schema.Number])),
  identity: Schema.optional(Schema.Any),
  inputs: Schema.optional(Schema.Any),
});

const decodeComponentElementOptions = Schema.decodeUnknownSync<
  typeof ComponentElementOptionsSchema
>(ComponentElementOptionsSchema);

/**
 * Create a component element from an Effect.
 *
 * @remarks
 * `Element.fromEffect` lifts an `Effect` that produces an `Element` into the
 * component node used by the renderer. If callers need to defer effect
 * construction until render-time, wrap it in `Effect.suspend` before calling
 * this constructor.
 *
 * @example
 * ```ts
 * const node = Element.fromEffect(Effect.succeed(text("hello")))
 * ```
 *
 * @category Elements
 * @public
 * @since 1.0.0
 */
export const fromEffect = <E, R>(
  effect: Effect.Effect<Element, E, R>,
  options?: ComponentElementOptions,
): ComponentElementWithRequirements<R> => {
  const decoded = decodeComponentElementOptions(options ?? {});

  return ElementBase.Component({
    run: () => effect,
    key: decoded.key ?? null,
    identity: decoded.identity,
    inputs: decoded.inputs,
  });
};

/**
 * Create a component element that fails when rendered.
 *
 * @remarks
 * `Element.fail` is the convenience constructor for lazy render-time failure
 * elements. It is equivalent to `Element.fromEffect(Effect.fail(error),
 * options)`.
 *
 * @example
 * ```ts
 * const node = Element.fail(new Error("boom"))
 * ```
 *
 * @category Elements
 * @public
 * @since 1.0.0
 */
export const fail = <E>(
  error: E,
  options?: ComponentElementOptions,
): ComponentElementWithRequirements<never> => Element.fromEffect(Effect.fail(error), options);

/**
 * Lift an unknown child-like value into an `Element`.
 *
 * @remarks
 * `Element.fromUnknown` is the Effect-native child boundary. Use it when
 * lower-level code needs JSX child normalization without introducing a new sync
 * runtime boundary.
 *
 * @example
 * ```ts
 * const child = yield* Element.fromUnknown("hello")
 * ```
 *
 * @category Elements
 * @public
 * @since 1.0.0
 */
export const fromUnknown: (child: unknown) => Effect.Effect<Element> = Effect.fn(
  "Element.fromUnknown",
)(function* (child: unknown) {
  if (child == null || child === false) {
    return empty;
  }
  if (typeof child === "string") {
    return text(child);
  }
  if (typeof child === "number") {
    return text(String(child));
  }
  if (child === true) {
    return empty;
  }
  if (isSignal(child)) {
    const currentValue = yield* SubscriptionRef.get(child._ref);
    return isElement(currentValue) ? signalElement(child) : signalText(child);
  }
  if (isElement(child)) {
    return child;
  }
  if (isEffect(child)) {
    return Element.fail(new InvalidJsxChildError({ reason: "effect" }));
  }

  return empty;
});

/**
 * Lift arbitrary JSX children into normalized `Element` values.
 *
 * @remarks
 * `Element.fromChildren` is the Effect-native collection boundary for child
 * normalization. It flattens nested arrays and drops empty children while
 * staying inside the current Effect pipeline.
 *
 * @example
 * ```ts
 * const children = yield* Element.fromChildren(["a", ["b", null]])
 * ```
 *
 * @category Elements
 * @public
 * @since 1.0.0
 */
export const fromChildren: (children: unknown) => Effect.Effect<ReadonlyArray<Element>> = Effect.fn(
  "Element.fromChildren",
)(function* (children: unknown) {
  if (children == null) {
    return [];
  }

  if (Array.isArray(children)) {
    const normalizedChildren = yield* Effect.forEach(children, (child) =>
      Effect.suspend(() =>
        Array.isArray(child)
          ? Element.fromChildren(child)
          : Element.fromUnknown(child).pipe(
              Effect.map((normalized) => (isEmpty(normalized) ? [] : [normalized])),
            ),
      ),
    );

    return normalizedChildren.flat();
  }

  const normalized = yield* Element.fromUnknown(children);
  return isEmpty(normalized) ? [] : [normalized];
});

/**
 * Element constructors and utilities
 *
 * @remarks
 * Use `Element` when you need explicit tagged constructors or pattern matching
 * instead of JSX syntax. The namespace also includes `Element.fromEffect`,
 * `Element.fail`, `Element.fromUnknown`, and `Element.fromChildren` for
 * Effect-native component construction and child normalization.
 *
 * @example
 * ```ts
 * const node = Element.fromEffect(Effect.succeed(Element.Text({ content: "Hello" })))
 * ```
 *
 * @category Elements
 * @public
 * @since 1.0.0
 */
export const Element: typeof ElementBase & {
  readonly fromEffect: typeof fromEffect;
  readonly fail: typeof fail;
  readonly fromUnknown: typeof fromUnknown;
  readonly fromChildren: typeof fromChildren;
} = {
  Intrinsic: ElementBase.Intrinsic,
  Text: ElementBase.Text,
  SignalText: ElementBase.SignalText,
  SignalElement: ElementBase.SignalElement,
  Provide: ElementBase.Provide,
  Component: ElementBase.Component,
  Fragment: ElementBase.Fragment,
  Portal: ElementBase.Portal,
  KeyedList: ElementBase.KeyedList,
  ErrorBoundaryElement: ElementBase.ErrorBoundaryElement,
  $is: ElementBase.$is,
  $match: ElementBase.$match,
  fromEffect,
  fail,
  fromUnknown,
  fromChildren,
};

/**
 * Create a context boundary element.
 * @internal
 */
export const provideElement = (context: Context.Context<unknown>, child: Element): Element =>
  ElementBase.Provide({ context, child });

/**
 * Create a fragment element.
 *
 * @remarks
 * `fragment` groups children without producing an intrinsic wrapper node.
 *
 * @example
 * ```ts
 * const node = fragment([text("a"), text("b")])
 * ```
 *
 * @category Elements
 * @public
 * @since 1.0.0
 */
export const fragment = (children: ReadonlyArray<Element>) => ElementBase.Fragment({ children });

const snapshotElementChild = (child: ElementChild): ElementChild =>
  Array.isArray(child) ? child.map(snapshotElementChild) : child;

const snapshotElementChildren = (children: ElementChildren): ElementChildren =>
  Array.isArray(children) ? children.map(snapshotElementChild) : children;

/**
 * Create a portal element.
 *
 * @remarks
 * `portal` moves children into another DOM target while keeping the element in
 * the same component tree. Child inputs stay in their JSX-facing shape until
 * render time, where the renderer normalizes them inside the active Effect
 * pipeline, but the child array shape is snapshotted when the portal is
 * created so later caller mutations do not leak into first render.
 *
 * @example
 * ```tsx
 * const node = portal("#modal-root", <div>Dialog</div>)
 * ```
 *
 * @category Elements
 * @public
 * @since 1.0.0
 */
export const portal = (target: HTMLElement | string, children: ElementChildren) =>
  ElementBase.Portal({ target, children: snapshotElementChildren(children) });

/**
 * Create a keyed list element for efficient list rendering.
 * Maintains stable scopes per key so nested signals are preserved across updates.
 *
 * @remarks
 * `keyedList` is the low-level list primitive behind stable keyed collection
 * rendering.
 *
 * @example
 * ```ts
 * const list = keyedList(items, (item) => Effect.succeed(text(String(item))), (item) => item)
 * ```
 *
 * @category Elements
 * @public
 * @since 1.0.0
 */
export const keyedList = <T>(
  source: Signal<ReadonlyArray<T>>,
  renderFn: (item: T, index: number) => Effect.Effect<Element, unknown, unknown>,
  keyFn: (item: T, index: number) => string | number,
) =>
  Element.KeyedList({
    source: source as Signal<ReadonlyArray<unknown>>,
    renderFn: renderFn as (
      item: unknown,
      index: number,
    ) => Effect.Effect<Element, unknown, unknown>,
    keyFn: keyFn as (item: unknown, index: number) => string | number,
  });

/**
 * Empty element singleton (empty fragment).
 *
 * @remarks
 * `empty` is the canonical no-op element value used when child normalization
 * drops nullish or boolean content.
 *
 * @example
 * ```ts
 * const node = empty
 * ```
 *
 * @category Elements
 * @public
 * @since 1.0.0
 */
export const empty: Element = Element.Fragment({ children: [] });

/**
 * Check if a value is a Signal
 * @internal
 */
const isSignal = (value: unknown): value is Signal<unknown> =>
  typeof value === "object" &&
  value !== null &&
  "_tag" in value &&
  (value as { _tag: unknown })._tag === "Signal";

/**
 * Check if a value is an `Element`.
 *
 * @remarks
 * `isElement` narrows unknown values to the tagged element union consumed by
 * the renderer.
 *
 * @example
 * ```ts
 * const value: unknown = text("hello")
 * if (isElement(value)) {
 *   value._tag
 * }
 * ```
 *
 * @category Elements
 * @public
 * @since 1.0.0
 */
export const isElement = (value: unknown): value is Element =>
  typeof value === "object" &&
  value !== null &&
  "_tag" in value &&
  typeof (value as { _tag: unknown })._tag === "string" &&
  [
    "Intrinsic",
    "Text",
    "SignalText",
    "SignalElement",
    "Provide",
    "Component",
    "Fragment",
    "Portal",
    "KeyedList",
    "ErrorBoundaryElement",
  ].includes((value as { _tag: string })._tag);

/**
 * Create a reactive text element from a Signal
 * @since 1.0.0
 */
export const signalText = (signal: Signal<unknown>): Element => Element.SignalText({ signal });

/**
 * Create a reactive element from a Signal<Element>.
 * Updates DOM directly when signal changes without component re-render.
 * @since 1.0.0
 */
export const signalElement = <A>(
  signal: Signal<A>,
  options?: { readonly onSwap?: Effect.Effect<void> },
): Element => Element.SignalElement({ signal, onSwap: options?.onSwap });

/**
 * Check if an element is empty (empty fragment).
 *
 * @remarks
 * `isEmpty` identifies the canonical empty fragment used by child
 * normalization.
 *
 * @example
 * ```ts
 * const emptyChild = isEmpty(empty)
 * ```
 *
 * @category Elements
 * @public
 * @since 1.0.0
 */
export const isEmpty = (element: Element): boolean =>
  element._tag === "Fragment" && element.children.length === 0;

/**
 * Get the key from an `Element` if it has one.
 *
 * @remarks
 * `getKey` reads reconciliation keys from intrinsic and component elements.
 *
 * @example
 * ```ts
 * const key = getKey(keyed("row-1", text("hello")))
 * ```
 *
 * @category Elements
 * @public
 * @since 1.0.0
 */
export const getKey = (element: Element): ElementKey | null => {
  switch (element._tag) {
    case "Intrinsic":
      return element.key;
    case "Component":
      return element.key;
    default:
      return null;
  }
};

/**
 * Create a keyed element - used for list reconciliation
 * Elements with keys use Effect's Equal and Hash for efficient diffing
 *
 * @remarks
 * `keyed` attaches a reconciliation key to intrinsic or component elements.
 *
 * @example
 * ```ts
 * const node = keyed("row-1", text("hello"))
 * ```
 *
 * @category Elements
 * @public
 * @since 1.0.0
 */
export const keyed = (key: ElementKey, element: Element): Element => {
  switch (element._tag) {
    case "Intrinsic":
      return Element.Intrinsic({ ...element, key });
    case "Component":
      return Element.Component({ ...element, key });
    default:
      return element;
  }
};
