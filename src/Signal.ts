/**
 * @since 1.0.0
 * Signal - Effect-native reactive state primitive
 *
 * Fine-grained reactivity built on SubscriptionRef.
 * Signals are first-class reactive values that can be:
 * - Passed to JSX for automatic DOM subscriptions
 * - Watched to re-run Effect scopes
 * - Composed with derive for computed values
 */
import {
  Effect,
  Equal,
  FiberRef,
  Ref,
  Runtime,
  Scope,
  Stream,
  SubscriptionRef
} from "effect"
import * as Debug from "./debug.js"

/**
 * Callback type for signal change notifications.
 * @internal
 */
export type SignalListener = () => void

/**
 * A Signal holds reactive state.
 * 
 * Signals are first-class values that can be:
 * - Read with `Signal.get(signal)` 
 * - Written with `Signal.set(signal, value)`
 * - Updated with `Signal.update(signal, fn)`
 * - Watched with `Signal.watch(signal)` to re-run scopes
 * - Passed to JSX for fine-grained DOM updates
 * 
 * @since 1.0.0
 */
export interface Signal<A> {
  readonly _tag: "Signal"
  readonly _ref: SubscriptionRef.SubscriptionRef<A>
  /** Sync listeners for immediate change notifications */
  readonly _listeners: Set<SignalListener>
  /** Debug ID for tracing */
  readonly _debugId: string
}

/**
 * Internal signal storage type - uses any to work around invariance.
 * @internal
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnySignal = Signal<any>

/**
 * Render phase context - managed by Renderer during component execution.
 * Tracks signals created during render for identity across re-renders.
 * @internal
 */
export interface RenderPhase {
  /** Current signal index (for position-based identity like React hooks) */
  readonly signalIndex: Ref.Ref<number>
  /** Array of signals created in this component */
  readonly signals: Ref.Ref<Array<AnySignal>>
  /** Set of signals accessed during this render (for subscriptions) */
  readonly accessed: Set<AnySignal>
}

/**
 * FiberRef to track current render phase.
 * Set by Renderer before executing component effects.
 * @internal
 */
export const CurrentRenderPhase: FiberRef.FiberRef<RenderPhase | null> =
  FiberRef.unsafeMake<RenderPhase | null>(null)

/**
 * Create a new RenderPhase for a component.
 * @internal
 */
export const makeRenderPhase = Effect.gen(function* () {
  const signalIndex = yield* Ref.make(0)
  const signals = yield* Ref.make<Array<AnySignal>>([])
  const accessed = new Set<AnySignal>()
  return { signalIndex, signals, accessed } satisfies RenderPhase
})

/**
 * Reset render phase for re-render (keeps signals, resets index).
 * @internal
 */
export const resetRenderPhase = Effect.fn("Signal.resetRenderPhase")(
  function* (phase: RenderPhase) {
    yield* Ref.set(phase.signalIndex, 0)
    phase.accessed.clear()
  }
)

/**
 * Create a new Signal with an initial value.
 *
 * When called inside a component (during render phase), signals are
 * tracked by position for identity across re-renders (like React hooks).
 *
 * @example
 * ```tsx
 * const Counter = Effect.gen(function* () {
 *   const count = yield* Signal.make(0)
 *
 *   return (
 *     <button onClick={() => Signal.update(count, n => n + 1)}>
 *       Count: {count}
 *     </button>
 *   )
 * })
 * ```
 *
 * @since 1.0.0
 */
export const make: <A>(initial: A) => Effect.Effect<Signal<A>> = Effect.fn(
  "Signal.make"
)(function* <A>(initial: A) {
  const phase = yield* FiberRef.get(CurrentRenderPhase)

  if (phase === null) {
    // Not in component render - create standalone signal
    const ref = yield* SubscriptionRef.make(initial)
    const debugId = Debug.nextSignalId()
    Debug.log({
      event: "signal.create",
      signal_id: debugId,
      value: initial,
      component: "standalone"
    })
    return { _tag: "Signal", _ref: ref, _listeners: new Set(), _debugId: debugId } as Signal<A>
  }

  // In component render - use position-based identity
  const index = yield* Ref.get(phase.signalIndex)
  yield* Ref.update(phase.signalIndex, (n) => n + 1)

  const signals = yield* Ref.get(phase.signals)

  let signal: Signal<A>
  if (index < signals.length) {
    // Reuse existing signal from previous render
    signal = signals[index] as Signal<A>
    Debug.log({
      event: "signal.create",
      signal_id: signal._debugId,
      value: initial,
      component: "reused"
    })
  } else {
    // First render - create new signal
    const ref = yield* SubscriptionRef.make(initial)
    const debugId = Debug.nextSignalId()
    signal = { _tag: "Signal", _ref: ref, _listeners: new Set(), _debugId: debugId }
    yield* Ref.update(phase.signals, (arr) => [...arr, signal])
    Debug.log({
      event: "signal.create",
      signal_id: debugId,
      value: initial,
      component: "new"
    })
  }

  // Note: We do NOT add to phase.accessed here.
  // Only Signal.get() adds to accessed, enabling fine-grained reactivity:
  // - If you read a signal (Signal.get), the component re-renders when it changes
  // - If you just pass the signal to JSX, you get fine-grained DOM updates

  return signal
})

/**
 * Create a Signal synchronously (unsafe).
 * 
 * Use this only for global/module-level signals that need to be
 * created outside of Effect context. For component state, always
 * use `Signal.make` inside `Effect.gen`.
 * 
 * @example
 * ```tsx
 * // Global auth state
 * export const authSignal = Signal.unsafeMake<Option<User>>(Option.none())
 * 
 * // In components, use normally
 * const user = yield* Signal.get(authSignal)
 * yield* Signal.set(authSignal, Option.some(newUser))
 * ```
 * 
 * @since 1.0.0
 */
export const unsafeMake = <A>(initial: A): Signal<A> => {
  const ref = Effect.runSync(SubscriptionRef.make(initial))
  const debugId = Debug.nextSignalId()
  Debug.log({
    event: "signal.create",
    signal_id: debugId,
    value: initial,
    component: "unsafe-global"
  })
  return { _tag: "Signal", _ref: ref, _listeners: new Set(), _debugId: debugId }
}

/**
 * Get the current value of a signal.
 * 
 * IMPORTANT: Reading a signal with Signal.get() subscribes the current
 * component to that signal. When the signal changes, the component re-renders.
 * 
 * For fine-grained reactivity (no re-render), pass signals directly to JSX
 * children or props instead of reading them.
 *
 * @example
 * ```tsx
 * // This subscribes the component - it will re-render when count changes:
 * const current = yield* Signal.get(count)
 * 
 * // For fine-grained updates, pass signal directly to JSX:
 * return <span>Count: {count}</span>  // No re-render, just text update!
 * ```
 *
 * @since 1.0.0
 */
export const get: <A>(signal: Signal<A>) => Effect.Effect<A> = Effect.fn("Signal.get")(
  function* <A>(signal: Signal<A>) {
    // Track this signal as accessed - subscribes component to changes
    const phase = yield* FiberRef.get(CurrentRenderPhase)
    Debug.log({
      event: "signal.get.phase",
      signal_id: signal._debugId,
      has_phase: phase !== null
    })
    if (phase !== null) {
      phase.accessed.add(signal)
      Debug.log({
        event: "signal.get",
        signal_id: signal._debugId,
        trigger: "component subscription"
      })
    }
    return yield* SubscriptionRef.get(signal._ref)
  }
)

/**
 * Set the value of a signal and notify listeners.
 *
 * @example
 * ```tsx
 * yield* Signal.set(count, 5)
 * ```
 *
 * @since 1.0.0
 */
export const set: <A>(signal: Signal<A>, value: A) => Effect.Effect<void> = Effect.fn("Signal.set")(
  function* <A>(signal: Signal<A>, value: A) {
    const prevValue = yield* SubscriptionRef.get(signal._ref)
    
    // Skip update if value is unchanged (prevents unnecessary re-renders)
    if (Equal.equals(prevValue, value)) {
      Debug.log({
        event: "signal.set.skipped",
        signal_id: signal._debugId,
        value: value,
        reason: "unchanged"
      })
      return
    }
    
    yield* SubscriptionRef.set(signal._ref, value)
    Debug.log({
      event: "signal.set",
      signal_id: signal._debugId,
      prev_value: prevValue,
      value: value,
      listener_count: signal._listeners.size
    })
    notifyListeners(signal)
  }
)

/**
 * Update the value of a signal using a function and notify listeners.
 *
 * @example
 * ```tsx
 * yield* Signal.update(count, n => n + 1)
 * ```
 *
 * @since 1.0.0
 */
export const update: <A>(signal: Signal<A>, f: (a: A) => A) => Effect.Effect<void> = Effect.fn("Signal.update")(
  function* <A>(signal: Signal<A>, f: (a: A) => A) {
    const prevValue = yield* SubscriptionRef.get(signal._ref)
    const newValue = f(prevValue)
    
    // Skip update if value is unchanged (prevents unnecessary re-renders)
    if (Equal.equals(prevValue, newValue)) {
      Debug.log({
        event: "signal.update.skipped",
        signal_id: signal._debugId,
        value: newValue,
        reason: "unchanged"
      })
      return
    }
    
    yield* SubscriptionRef.set(signal._ref, newValue)
    Debug.log({
      event: "signal.update",
      signal_id: signal._debugId,
      prev_value: prevValue,
      value: newValue,
      listener_count: signal._listeners.size
    })
    notifyListeners(signal)
  }
)

/**
 * Modify a signal's value and return a result.
 *
 * @example
 * ```tsx
 * const oldValue = yield* Signal.modify(count, n => [n, n + 1])
 * ```
 *
 * @since 1.0.0
 */
export const modify = <A, B>(
  signal: Signal<A>,
  f: (a: A) => readonly [B, A]
): Effect.Effect<B> =>
  SubscriptionRef.modify(signal._ref, f).pipe(
    Effect.tap(() => Effect.sync(() => notifyListeners(signal)))
  )

/**
 * Watch a signal and re-run the Effect scope when it changes.
 *
 * Returns the current value of the signal and subscribes to changes.
 * When the signal changes, the Effect scope from `Signal.watch` onwards
 * is re-executed.
 *
 * @example
 * ```tsx
 * const ConditionalView = Effect.gen(function* () {
 *   const isLoggedIn = yield* Signal.watch(authSignal)
 *
 *   if (isLoggedIn) {
 *     return yield* Dashboard
 *   }
 *   return yield* LoginForm
 * })
 * ```
 *
 * @since 1.0.0
 */
export const watch: <A>(signal: Signal<A>) => Effect.Effect<A, never, Scope.Scope> = Effect.fn("Signal.watch")(
  function* <A>(signal: Signal<A>) {
    const phase = yield* FiberRef.get(CurrentRenderPhase)

    // Track as accessed for reactivity
    if (phase !== null) {
      phase.accessed.add(signal)
    }

    return yield* SubscriptionRef.get(signal._ref)
  }
)

/**
 * Create a derived signal that computes its value from other signals.
 *
 * The derived signal updates eagerly when any source signal changes.
 *
 * @example
 * ```tsx
 * const count = yield* Signal.make(5)
 * const doubled = yield* Signal.derive(count, n => n * 2)
 * // doubled is always count * 2
 * ```
 *
 * @since 1.0.0
 */
export const derive: <A, B>(source: Signal<A>, f: (a: A) => B) => Effect.Effect<Signal<B>> = Effect.fn("Signal.derive")(
  function* <A, B>(source: Signal<A>, f: (a: A) => B) {
    // Capture runtime for use in sync callbacks
    const runtime = yield* Effect.runtime<never>()
    
    const initial = yield* SubscriptionRef.get(source._ref)
    const derivedRef = yield* SubscriptionRef.make(f(initial))
    const debugId = Debug.nextSignalId()
    const derivedSignal: Signal<B> = {
      _tag: "Signal",
      _ref: derivedRef,
      _listeners: new Set(),
      _debugId: debugId
    }
    
    Debug.log({
      event: "signal.create",
      signal_id: debugId,
      value: f(initial),
      component: `derived from ${source._debugId}`
    })

    // Subscribe to source changes
    // Using Runtime.runSync with captured runtime for sync callbacks
    const unsubscribe = subscribe(source, () => {
      Runtime.runSync(runtime)(
        Effect.gen(function* () {
          const current = yield* SubscriptionRef.get(source._ref)
          yield* SubscriptionRef.set(derivedRef, f(current))
          notifyListeners(derivedSignal)
        })
      )
    })

    // Track unsubscribe for cleanup (would need scope integration)
    // For now, derived signals live as long as the source
    void unsubscribe

    return derivedSignal
  }
)

/**
 * Get the changes stream from a signal.
 * Useful for advanced reactive patterns.
 * @since 1.0.0
 */
export const changes = <A>(signal: Signal<A>): Stream.Stream<A> =>
  signal._ref.changes

/**
 * Check if a value is a Signal.
 * @since 1.0.0
 */
export const isSignal = (value: unknown): value is Signal<unknown> =>
  typeof value === "object" &&
  value !== null &&
  "_tag" in value &&
  (value as { _tag: unknown })._tag === "Signal"

/**
 * Notify all listeners that a signal has changed.
 * @internal
 */
const notifyListeners = <A>(signal: Signal<A>): void => {
  Debug.log({
    event: "signal.notify",
    signal_id: signal._debugId,
    listener_count: signal._listeners.size
  })
  for (const listener of signal._listeners) {
    listener()
  }
}

/**
 * Subscribe to a signal's changes with a sync callback.
 * Returns an unsubscribe function.
 * @since 1.0.0
 */
export const subscribe = <A>(
  signal: Signal<A>,
  listener: SignalListener
): (() => void) => {
  signal._listeners.add(listener)
  Debug.log({
    event: "signal.subscribe",
    signal_id: signal._debugId,
    listener_count: signal._listeners.size
  })
  return () => {
    signal._listeners.delete(listener)
    Debug.log({
      event: "signal.unsubscribe",
      signal_id: signal._debugId,
      listener_count: signal._listeners.size
    })
  }
}

/**
 * Key type for list items
 * @since 1.0.0
 */
export type ItemKey = string | number

/**
 * Options for Signal.each
 * @since 1.0.0
 */
export interface EachOptions<T> {
  /**
   * Function to extract a unique key from each item.
   * Items with the same key maintain their scope across updates.
   */
  readonly key: (item: T, index: number) => ItemKey
}

// Note: Signal.each creates a KeyedList Element.
// We use a lazy getter to avoid circular dependency issues.
// The actual implementation is in _setEachImpl, called by Element.ts

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type EachFn = <T, E>(
  source: Signal<ReadonlyArray<T>>,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  renderFn: (item: T, index: number) => Effect.Effect<any, E, never>,
  options: EachOptions<T>
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
) => any

let _eachImpl: EachFn | null = null

/**
 * @internal
 * Set the implementation of Signal.each (called by Element.ts to break circular dependency)
 */
export const _setEachImpl = (impl: EachFn): void => {
  _eachImpl = impl
}

/**
 * Create a keyed list from a Signal of arrays.
 * 
 * Each item in the array is rendered using the provided render function.
 * Items are identified by a key function - items with the same key maintain
 * their Effect scope across list updates, preserving nested signals.
 * 
 * @example
 * ```tsx
 * const TodoList = Effect.gen(function* () {
 *   const todos = yield* Signal.make<ReadonlyArray<Todo>>([])
 *   
 *   const items = Signal.each(
 *     todos,
 *     (todo) => Effect.gen(function* () {
 *       // This signal is stable per todo.id - preserved across list updates!
 *       const editing = yield* Signal.make(false)
 *       return (
 *         <li>
 *           {editing ? <input value={todo.text} /> : <span>{todo.text}</span>}
 *         </li>
 *       )
 *     }),
 *     { key: (todo) => todo.id }
 *   )
 *   
 *   return <ul>{items}</ul>
 * })
 * ```
 * 
 * @since 1.0.0
 */
export const each: EachFn = (source, renderFn, options) => {
  if (_eachImpl === null) {
    throw new Error(
      "Signal.each is not initialized.\n\n" +
      "This usually means you imported Signal directly from 'effect-ui/Signal' " +
      "before the main 'effect-ui' module was loaded.\n\n" +
      "Fix: Import from 'effect-ui' instead:\n" +
      "  import { Signal } from 'effect-ui'\n\n" +
      "Or ensure 'effect-ui' is imported before using Signal.each."
    )
  }
  return _eachImpl(source, renderFn, options)
}
