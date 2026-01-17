/**
 * @since 1.0.0
 * Virtual DOM Element representation for effect-ui
 */
import { Data, Deferred, Effect } from "effect"
import type { Signal, EachOptions } from "./Signal.js"
import { _setEachImpl } from "./Signal.js"

/**
 * Check if a value is an Effect
 * @internal
 */
const isEffect = (value: unknown): value is Effect.Effect<Element, unknown, never> =>
  typeof value === "object" &&
  value !== null &&
  Effect.EffectTypeId in value

/**
 * Key type for list reconciliation.
 * Uses Effect's Equal and Hash traits for efficient comparison.
 * @since 1.0.0
 */
export type ElementKey = string | number

/**
 * Event handler type - returns an Effect that will be executed by the renderer
 * @since 1.0.0
 */
export type EventHandler<A = void, E = never, R = never> = (
  event: Event
) => Effect.Effect<A, E, R>

/**
 * A Signal of any type (for JSX children)
 * @internal
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnySignal = Signal<any>

/**
 * Helper type for props that can accept either a value or a Signal
 * Enables fine-grained reactivity when passing Signals to props
 * @since 1.0.0
 */
export type MaybeSignal<T> = T | Signal<T>

/**
 * Valid child types for JSX elements
 * @since 1.0.0
 */
export type ElementChild = Element | AnySignal | string | number | boolean | null | undefined

/**
 * Children prop type - can be a single child or array of children
 * @since 1.0.0
 */
export type ElementChildren = ElementChild | ReadonlyArray<ElementChild>

/**
 * Base props shared by all intrinsic elements
 * @since 1.0.0
 */
export interface BaseProps {
  readonly key?: ElementKey
  readonly className?: MaybeSignal<string>
  readonly id?: string
  readonly style?: Readonly<Record<string, string | number>>
  readonly children?: ElementChildren
  readonly [key: `data-${string}`]: string | undefined
  readonly [key: `aria-${string}`]: string | undefined
}

/**
 * Event props that can be attached to intrinsic elements
 * @since 1.0.0
 */
export interface EventProps {
  readonly onClick?: EventHandler
  readonly onDblclick?: EventHandler
  readonly onInput?: EventHandler
  readonly onChange?: EventHandler
  readonly onSubmit?: EventHandler
  readonly onKeyDown?: EventHandler
  readonly onKeyUp?: EventHandler
  readonly onKeyPress?: EventHandler
  readonly onFocus?: EventHandler
  readonly onBlur?: EventHandler
  readonly onMouseEnter?: EventHandler
  readonly onMouseLeave?: EventHandler
  readonly onMouseDown?: EventHandler
  readonly onMouseUp?: EventHandler
  readonly onMouseMove?: EventHandler
  readonly onScroll?: EventHandler
  readonly onLoad?: EventHandler
  readonly onError?: EventHandler
}

/**
 * Props for intrinsic HTML elements
 * 
 * Props marked with MaybeSignal can accept either a static value or a Signal
 * for fine-grained reactivity. When you pass a Signal, the DOM attribute
 * updates directly without re-rendering the component.
 * 
 * @since 1.0.0
 */
export interface ElementProps extends BaseProps, EventProps {
  // Form elements - these support Signal for fine-grained updates
  // Note: Using union of individual Signal types due to invariance
  readonly value?: string | number | readonly string[] | Signal<string> | Signal<number> | Signal<readonly string[]>
  readonly checked?: MaybeSignal<boolean>
  readonly disabled?: MaybeSignal<boolean>
  readonly placeholder?: MaybeSignal<string>
  readonly type?: string
  readonly name?: string
  readonly required?: boolean
  readonly readonly?: boolean
  readonly min?: string | number
  readonly max?: string | number
  readonly step?: string | number
  readonly pattern?: string
  readonly autoComplete?: string
  readonly autoFocus?: boolean
  readonly htmlFor?: string  // For label elements

  // Links and media
  readonly href?: MaybeSignal<string>
  readonly src?: MaybeSignal<string>
  readonly alt?: string
  readonly target?: string
  readonly rel?: string
  readonly download?: string | boolean

  // Layout
  readonly width?: string | number
  readonly height?: string | number
  readonly tabIndex?: number
  readonly title?: string
  readonly role?: string

  // Misc - className supports Signal for dynamic styling
  readonly hidden?: MaybeSignal<boolean>
  readonly draggable?: boolean
  readonly contentEditable?: boolean | "true" | "false" | "inherit"
  readonly spellCheck?: boolean | "true" | "false"
}

/**
 * Virtual DOM Element - the core type of effect-ui
 * Modeled as a tagged enum for pattern matching
 * @since 1.0.0
 */
export type Element = Data.TaggedEnum<{
  /**
   * Intrinsic HTML element like <div>, <span>, <button>
   */
  readonly Intrinsic: {
    readonly tag: string
    readonly props: ElementProps
    readonly children: ReadonlyArray<Element>
    readonly key: ElementKey | null
  }
  /**
   * Text node content
   */
  readonly Text: {
    readonly content: string
  }
  /**
   * Reactive text node - subscribes to a Signal and updates automatically
   */
  readonly SignalText: {
    readonly signal: Signal<unknown>
  }
  /**
   * Effect-based component that produces an Element.
   * Stores a thunk that creates the effect at render time.
   * R must be never - all requirements must be satisfied via Effect.provide
   * before creating a Component element.
   */
  readonly Component: {
    readonly run: () => Effect.Effect<Element, unknown, never>
    readonly key: ElementKey | null
  }
  /**
   * Fragment containing multiple children without a wrapper element
   */
  readonly Fragment: {
    readonly children: ReadonlyArray<Element>
  }
  /**
   * Suspense boundary - shows fallback while Deferred resolves
   */
  readonly Suspense: {
    readonly deferred: Deferred.Deferred<Element, unknown>
    readonly fallback: Element
  }
  /**
   * Portal - renders children into a different DOM container
   */
  readonly Portal: {
    readonly target: HTMLElement | string
    readonly children: ReadonlyArray<Element>
  }
  /**
   * KeyedList - efficient list rendering with stable scopes per key
   * Maintains identity across list updates so nested signals are preserved
   */
  readonly KeyedList: {
    readonly source: Signal<ReadonlyArray<unknown>>
    readonly renderFn: (item: unknown, index: number) => Effect.Effect<Element, unknown, never>
    readonly keyFn: (item: unknown, index: number) => string | number
  }
}>

/**
 * Element constructors and utilities
 * @since 1.0.0
 */
export const Element = Data.taggedEnum<Element>()

/**
 * Create an intrinsic element
 * @since 1.0.0
 */
export const intrinsic = (
  tag: string,
  props: ElementProps,
  children: ReadonlyArray<Element>,
  key: ElementKey | null = null
): Element =>
  Element.Intrinsic({ tag, props, children, key })

/**
 * Create a text element
 * @since 1.0.0
 */
export const text = (content: string): Element =>
  Element.Text({ content })

/**
 * Create a component element from a thunk that produces an Effect.
 * 
 * This is the low-level function for creating Component elements.
 * For defining JSX-compatible components, use `Component()` from effect-ui instead.
 * 
 * If the effect has unsatisfied requirements (R != never), it will fail
 * at runtime with "service not found".
 * 
 * @since 1.0.0
 * @internal
 */
export const componentElement = <E>(
  run: () => Effect.Effect<Element, E, never>,
  key: ElementKey | null = null
): Element =>
  Element.Component({ run, key })

/**
 * Create a fragment element
 * @since 1.0.0
 */
export const fragment = (children: ReadonlyArray<Element>): Element =>
  Element.Fragment({ children })

/**
 * Create a suspense boundary
 * @since 1.0.0
 */
export const suspense = (
  deferred: Deferred.Deferred<Element, unknown>,
  fallback: Element
): Element =>
  Element.Suspense({ deferred, fallback })

/**
 * Create a portal element
 * @since 1.0.0
 */
export const portal = (
  target: HTMLElement | string,
  children: ReadonlyArray<Element>
): Element =>
  Element.Portal({ target, children })

/**
 * Create a keyed list element for efficient list rendering.
 * Maintains stable scopes per key so nested signals are preserved across updates.
 * @since 1.0.0
 */
export const keyedList = <T>(
  source: Signal<ReadonlyArray<T>>,
  renderFn: (item: T, index: number) => Effect.Effect<Element, unknown, never>,
  keyFn: (item: T, index: number) => string | number
): Element =>
  Element.KeyedList({
    source: source as Signal<ReadonlyArray<unknown>>,
    renderFn: renderFn as (item: unknown, index: number) => Effect.Effect<Element, unknown, never>,
    keyFn: keyFn as (item: unknown, index: number) => string | number
  })

// Initialize Signal.each implementation to break circular dependency
_setEachImpl(<T, E>(
  source: Signal<ReadonlyArray<T>>,
  renderFn: (item: T, index: number) => Effect.Effect<Element, E, never>,
  options: EachOptions<T>
): Element => keyedList(source, renderFn, options.key))

/**
 * Empty element singleton (empty fragment)
 * @since 1.0.0
 */
export const empty: Element = Element.Fragment({ children: [] })

/**
 * Check if a value is a Signal
 * @internal
 */
const isSignal = (value: unknown): value is Signal<unknown> =>
  typeof value === "object" &&
  value !== null &&
  "_tag" in value &&
  (value as { _tag: unknown })._tag === "Signal"

/**
 * Check if a value is an Element
 * @since 1.0.0
 */
export const isElement = (value: unknown): value is Element =>
  typeof value === "object" &&
  value !== null &&
  "_tag" in value &&
  typeof (value as { _tag: unknown })._tag === "string" &&
  ["Intrinsic", "Text", "SignalText", "Component", "Fragment", "Suspense", "Portal", "KeyedList"].includes(
    (value as { _tag: string })._tag
  )

/**
 * Create a reactive text element from a Signal
 * @since 1.0.0
 */
export const signalText = (signal: Signal<unknown>): Element =>
  Element.SignalText({ signal })

/**
 * Normalize a child value to an Element
 * @since 1.0.0
 */
export const normalizeChild = (child: unknown): Element => {
  if (child == null || child === false) {
    return empty
  }
  if (typeof child === "string") {
    return text(child)
  }
  if (typeof child === "number") {
    return text(String(child))
  }
  if (child === true) {
    return empty
  }
  if (isSignal(child)) {
    // Signal child - create reactive text node
    return signalText(child)
  }
  if (isElement(child)) {
    return child
  }
  if (isEffect(child)) {
    // Effect child - wrap as Component element
    // Wrap in thunk to defer execution
    return componentElement(() => child)
  }
  
  // Unknown child type - silently ignore
  // TypeScript types should catch most invalid children at compile time.
  // At runtime, we gracefully degrade to an empty element.
  return empty
}

/**
 * Normalize an array of children to Elements
 * @since 1.0.0
 */
/**
 * Check if an element is empty (empty fragment)
 * @since 1.0.0
 */
export const isEmpty = (element: Element): boolean =>
  element._tag === "Fragment" && element.children.length === 0

/**
 * Normalize an array of children to Elements
 * @since 1.0.0
 */
export const normalizeChildren = (
  children: unknown
): ReadonlyArray<Element> => {
  if (children == null) {
    return []
  }
  if (Array.isArray(children)) {
    return children.flatMap((child) => {
      if (Array.isArray(child)) {
        return normalizeChildren(child)
      }
      const normalized = normalizeChild(child)
      return isEmpty(normalized) ? [] : [normalized]
    })
  }
  const normalized = normalizeChild(children)
  return isEmpty(normalized) ? [] : [normalized]
}

/**
 * Get the key from an Element if it has one
 * @since 1.0.0
 */
export const getKey = (element: Element): ElementKey | null => {
  switch (element._tag) {
    case "Intrinsic":
      return element.key
    case "Component":
      return element.key
    default:
      return null
  }
}

/**
 * Create a keyed element - used for list reconciliation
 * Elements with keys use Effect's Equal and Hash for efficient diffing
 * @since 1.0.0
 */
export const keyed = (key: ElementKey, element: Element): Element => {
  switch (element._tag) {
    case "Intrinsic":
      return Element.Intrinsic({ ...element, key })
    case "Component":
      return Element.Component({ ...element, key })
    default:
      return element
  }
}
