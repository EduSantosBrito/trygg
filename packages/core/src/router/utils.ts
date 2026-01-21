/**
 * @since 1.0.0
 * Utility functions for router
 */
import { Effect, Predicate } from "effect"
import type { Signal } from "../signal.js"
import * as SignalModule from "../signal.js"

/**
 * Class name input type - basic values
 * @since 1.0.0
 */
export type ClassValue = string | boolean | null | undefined | Record<string, boolean | undefined>

/**
 * Class name input that can include Signals for reactive class names
 * @since 1.0.0
 */
export type ClassInput = 
  | ClassValue 
  | Signal<string>
  | Signal<boolean>
  | Signal<string | boolean | null | undefined>

/**
 * Check if a value is a Signal
 * @internal
 */
const isSignal = (value: unknown): value is Signal<unknown> =>
  Predicate.isObject(value) && "_tag" in value && value._tag === "Signal"

/**
 * Process a single class input and return class strings
 * @internal
 */
const processInput = Effect.fnUntraced(function* (input: ClassInput) {
    if (!input) return [] as ReadonlyArray<string>
    
    if (isSignal(input)) {
      // Resolve signal - this subscribes the component to changes
      const value = yield* SignalModule.get(input)
      if (value && typeof value === "string") {
        return [value] as ReadonlyArray<string>
      }
      return [] as ReadonlyArray<string>
    }
    
    if (typeof input === "string") {
      return [input] as ReadonlyArray<string>
    }
    
    if (typeof input === "object") {
      const classes: string[] = []
      for (const [key, value] of Object.entries(input)) {
        if (value) {
          classes.push(key)
        }
      }
      return classes as ReadonlyArray<string>
    }
    
    return [] as ReadonlyArray<string>
  })

/**
 * Combine class names, filtering out falsy values.
 * 
 * Supports both static values and Signals for reactive class names.
 * When Signals are passed, they are resolved via `Signal.get()`, which
 * subscribes the component to re-render when those signals change.
 * 
 * @example
 * ```tsx
 * // Static class names
 * const className = yield* cx("btn", isActive && "btn-active")
 * // Result: "btn btn-active" or "btn"
 * 
 * // Object notation for conditional classes
 * const className = yield* cx("nav", { active: isActive, disabled: isDisabled })
 * 
 * // Reactive class names with Signals
 * const Button = Effect.gen(function* () {
 *   const variant = yield* Signal.make("primary")  // Signal<string>
 *   
 *   const className = yield* cx("btn", variant)
 *   // Result: "btn primary" - updates when variant changes
 *   
 *   return <button className={className}>Click</button>
 * })
 * ```
 * 
 * @since 1.0.0
 */
export const cx = Effect.fn("cx")(function* (...inputs: ReadonlyArray<ClassInput>) {
    const allClasses: string[] = []
    
    for (const input of inputs) {
      const classes = yield* processInput(input)
      allClasses.push(...classes)
    }
    
    return allClasses.join(" ")
  })
