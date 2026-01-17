/**
 * @since 1.0.0
 * useAtom hook for reactive state in effect-ui
 * 
 * Subscribes to an effect-atom and provides the current value.
 * When the atom changes, the component will be re-rendered.
 */
import { Effect } from "effect"
import { Atom, Registry } from "@effect-atom/atom"
import * as AtomTracker from "../AtomTracker.js"

/**
 * Read the current value of an atom.
 * 
 * This effect gets the current value from an atom and sets up a subscription
 * for re-rendering when the value changes. Requires AtomRegistry to be provided.
 * 
 * @example
 * ```tsx
 * import { Atom } from "@effect-atom/atom"
 * import { useAtom, atomRegistryLayer } from "effect-ui"
 * 
 * const countAtom = Atom.make(0)
 * 
 * const Counter = Effect.gen(function* () {
 *   const count = yield* useAtom(countAtom)
 *   return <div>Count: {count}</div>
 * })
 * 
 * // Provide AtomRegistry at app level
 * const App = Effect.provide(Counter, atomRegistryLayer)
 * ```
 * 
 * @since 1.0.0
 */
export const useAtom = Effect.fn("useAtom")(
  function* <A>(atom: Atom.Atom<A>) {
    const registry = yield* Registry.AtomRegistry
    
    // Track this atom for the re-render mechanism
    yield* AtomTracker.track(atom)
    
    // Get current value
    const value = registry.get(atom)
    
    // Mount the atom to ensure it stays alive while component is mounted
    const unmount = registry.mount(atom)
    
    // Add cleanup when scope closes
    yield* Effect.addFinalizer(() => Effect.sync(unmount))
    
    return value
  }
)

/**
 * Read the current value of a writable atom and get a setter function.
 * 
 * Returns both the current value and an Effect that sets a new value.
 * 
 * @example
 * ```tsx
 * const countAtom = Atom.make(0)
 * 
 * const Counter = Effect.gen(function* () {
 *   const [count, setCount] = yield* useAtomState(countAtom)
 *   return (
 *     <button onClick={() => setCount(count + 1)}>
 *       Count: {count}
 *     </button>
 *   )
 * })
 * ```
 * 
 * @since 1.0.0
 */
export const useAtomState = Effect.fn("useAtomState")(
  function* <A>(atom: Atom.Writable<A, A>) {
    const registry = yield* Registry.AtomRegistry
    
    // Track this atom for the re-render mechanism
    yield* AtomTracker.track(atom)
    
    // Get current value
    const value = registry.get(atom)
    
    // Mount the atom
    const unmount = registry.mount(atom)
    yield* Effect.addFinalizer(() => Effect.sync(unmount))
    
    // Create setter that captures the registry
    const setValue = (newValue: A): Effect.Effect<void, never, never> =>
      Effect.sync(() => {
        registry.set(atom, newValue)
      })
    
    return [value, setValue] as const
  }
)

/**
 * Update an atom value using a function.
 * 
 * Similar to useAtomState but the setter takes a function that receives
 * the current value and returns the new value.
 * 
 * @example
 * ```tsx
 * const countAtom = Atom.make(0)
 * 
 * const Counter = Effect.gen(function* () {
 *   const [count, updateCount] = yield* useAtomUpdate(countAtom)
 *   return (
 *     <button onClick={() => updateCount(n => n + 1)}>
 *       Count: {count}
 *     </button>
 *   )
 * })
 * ```
 * 
 * @since 1.0.0
 */
export const useAtomUpdate = Effect.fn("useAtomUpdate")(
  function* <A>(atom: Atom.Writable<A, A>) {
    const registry = yield* Registry.AtomRegistry
    
    // Track this atom for the re-render mechanism
    yield* AtomTracker.track(atom)
    
    // Get current value
    const value = registry.get(atom)
    
    // Mount the atom
    const unmount = registry.mount(atom)
    yield* Effect.addFinalizer(() => Effect.sync(unmount))
    
    // Create updater that captures the registry
    const updateValue = (f: (current: A) => A): Effect.Effect<void, never, never> =>
      Effect.sync(() => {
        registry.update(atom, f)
      })
    
    return [value, updateValue] as const
  }
)

/**
 * Re-export AtomRegistry and layer for convenience
 * @since 1.0.0
 */
export const AtomRegistry = Registry.AtomRegistry
export { Atom }
export const atomRegistryLayer = Registry.layer
