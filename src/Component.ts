/**
 * @since 1.0.0
 * Component wrapper for JSX compatibility
 * 
 * Creates components that can be used with JSX syntax: `<MyComponent />`
 * 
 * @example
 * ```tsx
 * import { component, Signal, mount } from "effect-ui"
 * 
 * const Counter = component(function* () {
 *   const count = yield* Signal.make(0)
 *   return (
 *     <button onClick={() => Signal.update(count, n => n + 1)}>
 *       Count: {count}
 *     </button>
 *   )
 * })
 * 
 * // Now you can use JSX syntax!
 * mount(container, <Counter />)
 * ```
 */
import { Effect } from "effect"
import { type Element, componentElement } from "./Element.js"

/**
 * Component type - a callable that returns an Element when used in JSX.
 * 
 * This is the return type of the `component` function. It can be used
 * directly in JSX: `<MyComponent />`
 * 
 * @since 1.0.0
 */
export interface ComponentType<E = never> {
  /** The underlying Effect */
  readonly effect: Effect.Effect<Element, E, never>
  /** Call signature for JSX compatibility - returns Element */
  (props?: Record<string, never>): Element
}

/**
 * Create a JSX-compatible component from a generator function.
 * 
 * Works like Effect.gen but returns a component usable with JSX syntax.
 * This is the recommended way to define components in effect-ui.
 * 
 * @example
 * ```tsx
 * import { component, Signal, mount, DevMode } from "effect-ui"
 * 
 * const Counter = component(function* () {
 *   const count = yield* Signal.make(0)
 *   return (
 *     <button onClick={() => Signal.update(count, n => n + 1)}>
 *       Count: {count}
 *     </button>
 *   )
 * })
 * 
 * // Use with JSX syntax
 * mount(container, <>
 *   <Counter />
 *   <DevMode />
 * </>)
 * ```
 * 
 * @since 1.0.0
 */
export const component: {
  <Eff extends Effect.Effect<Element, unknown, never>, AEff>(
    f: (resume: Effect.Adapter) => Generator<Eff, AEff, never>
  ): ComponentType<Effect.Effect.Error<Eff>>
  <Self, Eff extends Effect.Effect<Element, unknown, never>, AEff>(
    self: Self,
    f: (this: Self, resume: Effect.Adapter) => Generator<Eff, AEff, never>
  ): ComponentType<Effect.Effect.Error<Eff>>
} = <Eff extends Effect.Effect<Element, unknown, never>, AEff>(
  ...args: [
    f: (resume: Effect.Adapter) => Generator<Eff, AEff, never>
  ] | [
    self: unknown,
    f: (resume: Effect.Adapter) => Generator<Eff, AEff, never>
  ]
): ComponentType<Effect.Effect.Error<Eff>> => {
  // Create the underlying Effect using Effect.gen
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const effect = (Effect.gen as any)(...args) as Effect.Effect<Element, Effect.Effect.Error<Eff>, never>
  
  // Create a function that the JSX runtime will call
  const componentFn = (_props?: Record<string, never>): Element => {
    return componentElement(effect)
  }
  
  // Attach the effect for direct access if needed
  Object.defineProperty(componentFn, "effect", {
    value: effect,
    writable: false,
    enumerable: true
  })
  
  return componentFn as ComponentType<Effect.Effect.Error<Eff>>
}

/**
 * Wrap an existing Effect<Element> to make it usable with JSX syntax.
 * 
 * Use this when you already have an Effect and want to use it as a JSX component.
 * For new components, prefer `component(function* () { ... })`.
 * 
 * @example
 * ```tsx
 * const myEffect = Effect.succeed(<div>Hello</div>)
 * const MyComponent = Component(myEffect)
 * 
 * // Use with JSX syntax
 * <MyComponent />
 * ```
 * 
 * @since 1.0.0
 */
export const Component = <E>(
  effect: Effect.Effect<Element, E, never>
): ComponentType<E> => {
  // Create a function that the JSX runtime will call
  const componentFn = (_props?: Record<string, never>): Element => {
    return componentElement(effect)
  }
  
  // Attach the effect for direct access if needed
  Object.defineProperty(componentFn, "effect", {
    value: effect,
    writable: false,
    enumerable: true
  })
  
  return componentFn as ComponentType<E>
}
