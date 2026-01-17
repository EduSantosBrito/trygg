/**
 * @since 1.0.0
 * JSX Runtime for effect-ui
 * 
 * This module provides the JSX transformation functions used by TypeScript/Babel
 * when compiling JSX syntax. It implements the "automatic" JSX runtime.
 */
import { Effect } from "effect"
import {
  Element,
  type ElementProps,
  type ElementKey,
  normalizeChildren,
  componentElement,
  isElement,
  empty
} from "./Element.js"

/**
 * Props passed to JSX elements
 * @since 1.0.0
 */
export interface JSXProps extends ElementProps {
  readonly key?: ElementKey
}

/**
 * Component function type - a function that takes props and returns an Effect<Element>.
 * 
 * The effect must have R=never - all service requirements must be satisfied via
 * Effect.provide before the component can be used in JSX.
 * 
 * For components that need services, use the yield* pattern:
 * ```tsx
 * const App = Effect.gen(function* () {
 *   const counter = yield* Counter  // Counter needs AtomRegistry
 *   return <div>{counter}</div>
 * })
 * ```
 * 
 * @since 1.0.0
 */
export type ComponentFunction<Props = Record<string, unknown>, E = never> = (
  props: Props
) => Effect.Effect<Element, E, never>

/**
 * JSX element type - either a string (intrinsic), a component function, or an Effect
 * @since 1.0.0
 */
export type JSXElementType<Props = Record<string, unknown>, E = never> =
  | string
  | ComponentFunction<Props, E>
  | Effect.Effect<Element, E, never>

/**
 * Check if a value is an Effect
 * @internal
 */
const isEffect = (value: unknown): value is Effect.Effect<Element, unknown, never> =>
  typeof value === "object" &&
  value !== null &&
  Effect.EffectTypeId in value

/**
 * Create a JSX element
 * 
 * This is called by the TypeScript compiler for JSX expressions.
 * Supports three types:
 * - String: intrinsic elements like `<div>`
 * - Function: component functions `(props) => Effect<Element>`
 * - Effect: component effects directly `Effect<Element>`
 * 
 * @since 1.0.0
 */
export const jsx = <Props extends JSXProps>(
  type: JSXElementType<Props>,
  props: Props | null,
  key?: ElementKey
): Element => {
  const resolvedProps = props ?? {} as Props
  const { children, key: propsKey, ...restProps } = resolvedProps as JSXProps & { children?: unknown }
  const resolvedKey = key ?? propsKey ?? null
  const childElements = normalizeChildren(children)

  if (typeof type === "string") {
    // Intrinsic element: <div>, <span>, etc.
    return Element.Intrinsic({
      tag: type,
      props: restProps as ElementProps,
      children: childElements,
      key: resolvedKey
    })
  }

  if (isEffect(type)) {
    // Effect passed directly: <Counter /> where Counter is Effect<Element>
    return componentElement(() => type, resolvedKey)
  }

  // Component function: call it to get the result
  const result = type(resolvedProps)
  
  // ComponentType from component()/Component() returns Element directly
  if (isElement(result)) {
    return result
  }
  
  // Traditional component function returns Effect<Element>
  return componentElement(() => result, resolvedKey)
}

/**
 * Create a JSX element with static children
 * 
 * This is called by the TypeScript compiler for JSX expressions with
 * multiple static children.
 * 
 * @since 1.0.0
 */
export const jsxs = jsx

/**
 * Fragment component
 * 
 * Used for grouping elements without adding extra DOM nodes.
 * 
 * @since 1.0.0
 */
export const Fragment = (props: { children?: unknown }): Element => {
  const children = normalizeChildren(props?.children)
  if (children.length === 0) {
    return empty
  }
  return Element.Fragment({ children })
}

// Re-export Element type for use in JSX
export { Element }
export type { ElementProps, ElementKey }

// JSX namespace for TypeScript - required for jsxImportSource
export namespace JSX {
  export type Element = import("./Element.js").Element
  
  export interface IntrinsicAttributes {
    readonly key?: ElementKey
  }
  
  export interface IntrinsicElements {
    [elemName: string]: ElementProps
  }
  
  export interface ElementChildrenAttribute {
    children: {}
  }
}
