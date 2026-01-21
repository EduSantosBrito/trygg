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
  Cause,
  Context,
  Effect,
  Equal,
  Exit,
  FiberRef,
  Ref,
  Scope,
  Stream,
  SubscriptionRef
} from "effect"
import * as Debug from "./debug.js"
import * as Metrics from "./metrics.js"
import { signalElement } from "./Element.js"

/**
 * Callback type for signal change notifications.
 * Effect-based for trace context propagation.
 * @internal
 */
export type SignalListener = () => Effect.Effect<void>

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
 * State for async resources managed by Signal.resource.
 *
 * - Loading: no previous value
 * - Refreshing: retains the previous Exit while reloading
 * - Success: completed successfully with value + Exit
 * - Failure: failed with Cause + Exit
 *
 * @since 1.0.0
 */
export type ResourceState<E, A> =
  | { readonly _tag: "Loading" }
  | { readonly _tag: "Refreshing"; readonly previous: Exit.Exit<A, E> }
  | { readonly _tag: "Success"; readonly value: A; readonly exit: Exit.Exit<A, E> }
  | { readonly _tag: "Failure"; readonly cause: Cause.Cause<E>; readonly exit: Exit.Exit<A, E> }

/**
 * Resource handle returned by Signal.resource.
 * @since 1.0.0
 */
export interface Resource<E, A> {
  readonly state: Signal<ResourceState<E, A>>
  readonly refresh: Effect.Effect<void>
}

/**
 * Internal resource runtime for Signal.resource.
 * @internal
 */
interface ResourceRuntime<E, A> {
  readonly resource: Resource<E, A>
  readonly setEffect: (effect: Effect.Effect<A, E>) => void
}

/**
 * Internal signal storage type - uses any to work around invariance.
 * @internal
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnySignal = Signal<any>

/**
 * Internal resource runtime storage type - uses any to work around invariance.
 * @internal
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyResourceRuntime = ResourceRuntime<any, any>

const resourceRegistry: WeakMap<AnySignal, AnyResourceRuntime> = new WeakMap()

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
 * FiberRef to track the current component lifetime scope.
 * Set by Renderer before executing component effects.
 * @internal
 */
export const CurrentComponentScope: FiberRef.FiberRef<Scope.CloseableScope | null> =
  FiberRef.unsafeMake<Scope.CloseableScope | null>(null)

/**
 * FiberRef to track the current render scope (cleared on re-render).
 * Set by Renderer before executing component effects.
 * @internal
 */
export const CurrentRenderScope: FiberRef.FiberRef<Scope.CloseableScope | null> =
  FiberRef.unsafeMake<Scope.CloseableScope | null>(null)

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
    yield* Debug.log({
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
    yield* Debug.log({
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
    yield* Debug.log({
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
  // Note: No logging here since we're outside Effect context.
  // unsafeMake is for global signals created at module load time.
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
    yield* Debug.log({
      event: "signal.get.phase",
      signal_id: signal._debugId,
      has_phase: phase !== null
    })
    if (phase !== null) {
      phase.accessed.add(signal)
      yield* Debug.log({
        event: "signal.get",
        signal_id: signal._debugId,
        trigger: "component subscription"
      })
    }
    return yield* SubscriptionRef.get(signal._ref)
  }
)

/**
 * Peek at the current value of a signal synchronously without subscribing.
 * 
 * WARNING: This is for internal use only (e.g., normalizeChild detecting
 * Signal<Element> vs Signal<primitive>). Do not use in components - use
 * Signal.get instead which properly tracks dependencies.
 * 
 * @internal
 * @since 1.0.0
 */
export const peekSync = <A>(signal: Signal<A>): A =>
  Effect.runSync(SubscriptionRef.get(signal._ref))

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
      yield* Debug.log({
        event: "signal.set.skipped",
        signal_id: signal._debugId,
        value: value,
        reason: "unchanged"
      })
      return
    }
    
    yield* SubscriptionRef.set(signal._ref, value)
    yield* Debug.log({
      event: "signal.set",
      signal_id: signal._debugId,
      prev_value: prevValue,
      value: value,
      listener_count: signal._listeners.size
    })
    // Record signal update metric
    yield* Metrics.recordSignalUpdate
    yield* notifyListeners(signal)
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
      yield* Debug.log({
        event: "signal.update.skipped",
        signal_id: signal._debugId,
        value: newValue,
        reason: "unchanged"
      })
      return
    }
    
    yield* SubscriptionRef.set(signal._ref, newValue)
    yield* Debug.log({
      event: "signal.update",
      signal_id: signal._debugId,
      prev_value: prevValue,
      value: newValue,
      listener_count: signal._listeners.size
    })
    // Record signal update metric
    yield* Metrics.recordSignalUpdate
    yield* notifyListeners(signal)
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
    Effect.tap(() => notifyListeners(signal))
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
 * Options for Signal.derive
 * @since 1.0.0
 */
export interface DeriveOptions {
  /** Explicit scope for subscription cleanup. If not provided, uses current Effect scope. */
  readonly scope: Scope.Scope
}

/**
 * Create a derived signal that computes its value from other signals.
 *
 * The derived signal updates eagerly when any source signal changes.
 * Subscriptions are automatically cleaned up when the scope closes.
 *
 * @example
 * ```tsx
 * // Uses current Effect scope (component lifetime)
 * const doubled = yield* Signal.derive(count, n => n * 2)
 *
 * // Explicit scope for long-lived signals
 * const scope = yield* Scope.make()
 * const doubled = yield* Signal.derive(count, n => n * 2, { scope })
 * // Later: yield* Scope.close(scope, Exit.void)
 * ```
 *
 * @since 1.0.0
 */
export function derive<A, B>(
  source: Signal<A>,
  f: (a: A) => B,
  options: DeriveOptions
): Effect.Effect<Signal<B>>
export function derive<A, B>(
  source: Signal<A>,
  f: (a: A) => B
): Effect.Effect<Signal<B>, never, Scope.Scope>
export function derive<A, B>(
  source: Signal<A>,
  f: (a: A) => B,
  options?: DeriveOptions
): Effect.Effect<Signal<B>, never, Scope.Scope> {
  return Effect.gen(function* () {
    const renderScope = yield* FiberRef.get(CurrentRenderScope)
    // Get scope from options or from render scope
    const scope = options?.scope ?? renderScope ?? (yield* Effect.scope)
    
    const initial = yield* SubscriptionRef.get(source._ref)
    const derivedRef = yield* SubscriptionRef.make(f(initial))
    const debugId = Debug.nextSignalId()
    const derivedSignal: Signal<B> = {
      _tag: "Signal",
      _ref: derivedRef,
      _listeners: new Set(),
      _debugId: debugId
    }
    
    yield* Debug.log({
      event: "signal.derive.create",
      signal_id: debugId,
      source_id: source._debugId,
      value: f(initial)
    })

    // Subscribe to source changes with Effect-based listener
    const unsubscribe = yield* subscribe(source, () =>
      Effect.gen(function* () {
        const current = yield* SubscriptionRef.get(source._ref)
        yield* SubscriptionRef.set(derivedRef, f(current))
        yield* notifyListeners(derivedSignal)
      })
    )

    // Register cleanup on scope finalization
    yield* Scope.addFinalizer(scope, Effect.gen(function* () {
      yield* unsubscribe
      yield* Debug.log({
        event: "signal.derive.cleanup",
        signal_id: debugId,
        source_id: source._debugId
      })
    }))

    return derivedSignal
  }).pipe(Effect.withSpan("Signal.derive"))
}

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
 * 
 * F-003: Listeners run in parallel with error isolation.
 * - Uses Effect.forEach with unbounded concurrency
 * - Errors in one listener don't affect others
 * - Errors are logged via signal.listener.error event
 * - Listeners are snapshotted to handle mid-notification unsubscribes
 * 
 * @internal
 */
const notifyListeners: <A>(signal: Signal<A>) => Effect.Effect<void> = Effect.fnUntraced(
  function* <A>(signal: Signal<A>) {
    const listenerCount = signal._listeners.size
    
    yield* Debug.log({
      event: "signal.notify",
      signal_id: signal._debugId,
      listener_count: listenerCount
    })
    
    // Skip if no listeners
    if (listenerCount === 0) return
    
    // Snapshot listeners to handle mid-notification unsubscribes safely
    const listeners = Array.from(signal._listeners)
    
    // Notify all listeners in parallel with error isolation
    yield* Effect.forEach(
      listeners,
      (listener, index) =>
        listener().pipe(
          Effect.catchAllCause((cause) =>
            Debug.log({
              event: "signal.listener.error",
              signal_id: signal._debugId,
              cause: Cause.pretty(cause),
              listener_index: index
            })
          )
        ),
      { concurrency: "unbounded", discard: true }
    )
  }
)

/**
 * Subscribe to a signal's changes with an Effect-based callback.
 * Returns an Effect that yields an unsubscribe Effect.
 * @since 1.0.0
 */
export const subscribe: <A>(
  signal: Signal<A>,
  listener: SignalListener
) => Effect.Effect<Effect.Effect<void>> = Effect.fn("Signal.subscribe")(
  function* <A>(signal: Signal<A>, listener: SignalListener) {
    signal._listeners.add(listener)
    yield* Debug.log({
      event: "signal.subscribe",
      signal_id: signal._debugId,
      listener_count: signal._listeners.size
    })
    // Return unsubscribe effect (intentionally returns Effect for later execution)
    return yield* Effect.succeed(
      Effect.sync(() => {
        signal._listeners.delete(listener)
        return signal._listeners.size
      }).pipe(
        Effect.tap((listenerCount) =>
          Debug.log({
            event: "signal.unsubscribe",
            signal_id: signal._debugId,
            listener_count: listenerCount
          })
        ),
        Effect.asVoid
      )
    )
  }
)

/**
 * Create a resource that tracks loading, refreshing, and error state for an Effect.
 *
 * The Effect runs immediately and re-runs automatically when any Signals read
 * inside the Effect change. Use the returned state Signal to drive UI via
 * Signal.derive, and call refresh to manually re-run.
 *
 * @example
 * ```tsx
 * const userId = yield* Signal.make(1)
 * const resource = yield* Signal.resource(
 *   Effect.gen(function* () {
 *     const id = yield* Signal.get(userId)
 *     return yield* fetchUser(id)
 *   })
 * )
 *
 * const view = yield* Signal.derive(resource.state, (state) =>
 *   state._tag === "Loading" ? <Skeleton /> : <UserCard user={state.value} />
 * )
 *
 * return <>{view}</>
 * ```
 *
 * @since 1.0.0
 */
export const resource = <A, E, R>(
  effect: Effect.Effect<A, E, R>
): Effect.Effect<Resource<E, A>, never, R | Scope.Scope> =>
  Effect.contextWithEffect((context: Context.Context<R>) =>
    Effect.gen(function* () {
      const componentScope = yield* FiberRef.get(CurrentComponentScope)
      const scope = componentScope ?? (yield* Effect.scope)
      const state = yield* make<ResourceState<E, A>>({ _tag: "Loading" })
      const providedEffect = Effect.provide(effect, context)

      const existing: ResourceRuntime<E, A> | undefined = resourceRegistry.get(state)
      if (existing !== undefined) {
        existing.setEffect(providedEffect)
        return existing.resource
      }

      const renderPhase = yield* makeRenderPhase

      let currentEffect = providedEffect
      let lastExit: Exit.Exit<A, E> | null = null
      let requestId = 0
      let isRunning = false
      let subscriptionCleanups: Array<Effect.Effect<void>> = []

      const setEffect = (next: Effect.Effect<A, E>) => {
        currentEffect = next
      }

      const cleanupSubscriptions: () => Effect.Effect<void> = Effect.fn("Signal.resource.cleanup")(
        function* () {
          const oldCleanups = subscriptionCleanups
          subscriptionCleanups = []
          for (const cleanup of oldCleanups) {
            yield* cleanup
          }
        }
      )

      const subscribeToSignals: (signals: Set<AnySignal>) => Effect.Effect<void> = Effect.fn(
        "Signal.resource.subscribe"
      )(function* (signals: Set<AnySignal>) {
        yield* cleanupSubscriptions()
        if (signals.size === 0) return

        for (const signal of signals) {
          const unsubscribe = yield* subscribe(signal, () => refresh)
          subscriptionCleanups.push(unsubscribe)
        }
      })

      const runEffect: (runId: number) => Effect.Effect<void> = Effect.fn("Signal.resource.run")(
        function* (runId: number) {
          yield* resetRenderPhase(renderPhase)

          const exit = yield* Effect.exit(
            currentEffect.pipe(Effect.locally(CurrentRenderPhase, renderPhase))
          )

          const latestRequest = requestId
          if (runId !== latestRequest) {
            return yield* runEffect(latestRequest)
          }

          lastExit = exit

          if (Exit.isSuccess(exit)) {
            yield* set(state, { _tag: "Success", value: exit.value, exit })
          } else {
            yield* set(state, { _tag: "Failure", cause: exit.cause, exit })
          }

          yield* subscribeToSignals(renderPhase.accessed)

          const nextRequest = requestId
          if (runId !== nextRequest) {
            return yield* runEffect(nextRequest)
          }
        }
      )

      const refresh: Effect.Effect<void> = Effect.gen(function* () {
        requestId += 1
        const runId = requestId

        if (lastExit === null) {
          yield* set(state, { _tag: "Loading" })
        } else {
          yield* set(state, { _tag: "Refreshing", previous: lastExit })
        }

        if (isRunning) return
        isRunning = true

        yield* Effect.forkIn(
          runEffect(runId).pipe(
            Effect.ensuring(
              Effect.sync(() => {
                isRunning = false
              })
            )
          ),
          scope
        )
      }).pipe(Effect.withSpan("Signal.resource.refresh"))

      const resource: Resource<E, A> = { state, refresh }
      const runtime: ResourceRuntime<E, A> = { resource, setEffect }

      resourceRegistry.set(state, runtime)

      yield* Scope.addFinalizer(scope, cleanupSubscriptions())
      yield* refresh

      return resource
    })
  ).pipe(Effect.withSpan("Signal.resource"))

// =============================================================================
// Signal.suspend - Component suspension with async state tracking
// =============================================================================

/**
 * Import Element type from Element.ts
 * Using import type to avoid circular dependency issues at runtime
 * @internal
 */
type SuspendElement = import("./Element.js").Element

/**
 * ComponentType interface for suspend - matches Component.ts
 * @internal
 */
interface SuspendComponentType<_Props = unknown, _E = never> {
  readonly _tag: "EffectComponent"
  (props: _Props): SuspendElement
}

/**
 * Result type for suspend - a ComponentType with no props
 * Also exposes the internal signal for testing/debugging
 * @since 1.0.0
 */
export interface SuspendedComponent<E = never> {
  readonly _tag: "EffectComponent"
  (props: Record<string, never>): SuspendElement
  /** Internal signal for testing/debugging. Do not use in production code. */
  readonly _signal: Signal<SuspendElement>
}

/**
 * Handlers for Signal.suspend to define what to show during async states.
 * @since 1.0.0
 */
export interface SuspendHandlers<E> {
  /**
   * What to show while the component is doing async work.
   * Receives the stale Element if this dep-key was previously rendered.
   */
  readonly Pending: SuspendElement | ((stale: SuspendElement | null) => SuspendElement)
  /**
   * What to show if the component fails.
   * Receives the Cause and optionally the stale Element.
   */
  readonly Failure: (cause: Cause.Cause<E>, stale: SuspendElement | null) => SuspendElement
  /**
   * The component to render. May do async work (Effect.sleep, fetch, etc).
   * While async is in progress, Pending is shown.
   */
  readonly Success: SuspendElement
}

/**
 * Create a suspended component that tracks async state.
 *
 * Returns a ComponentType that can be rendered with JSX: `<SuspendedView />`
 *
 * The first parameter is the ComponentType for type inference and component identity.
 * The Success handler should be a call to that component with props.
 *
 * Caching: Dependencies (Signals read via Signal.get) are serialized as a cache key.
 * - New dep-key: shows Pending (no stale)
 * - Previously seen dep-key: shows Pending with stale Element
 *
 * @example
 * ```tsx
 * const UserProfile = Component.gen(function* (Props: ComponentProps<{ userId: Signal<number> }>) {
 *   const { userId } = yield* Props
 *   const id = yield* Signal.get(userId)
 *   const user = yield* fetchUser(id)
 *   return <UserCard user={user} />
 * })
 *
 * const SuspendedProfile = yield* Signal.suspend(UserProfile, {
 *   Pending: (stale) => stale ?? <Spinner />,
 *   Failure: (cause) => <ErrorView cause={cause} />,
 *   Success: <UserProfile userId={userId} />
 * })
 *
 * return <SuspendedProfile />
 * ```
 *
 * @since 1.0.0
 */
export const suspend: <Props, E>(
  _component: SuspendComponentType<Props, E>,
  handlers: SuspendHandlers<E>
) => Effect.Effect<SuspendedComponent<E>, never, Scope.Scope> = Effect.fn("Signal.suspend")(
  function* <Props, E>(_component: SuspendComponentType<Props, E>, handlers: SuspendHandlers<E>) {
    const componentScope = yield* FiberRef.get(CurrentComponentScope)
    const scope = componentScope ?? (yield* Effect.scope)

    // Cache: dep-key -> last successful Element for that dep-key
    const cache = new Map<string, SuspendElement>()

    // State signal for the current view
    const viewSignal: Signal<SuspendElement> = yield* make<SuspendElement>(
      typeof handlers.Pending === "function"
        ? handlers.Pending(null)
        : handlers.Pending
    )

    // Render phase for tracking deps
    const renderPhase = yield* makeRenderPhase

    let requestId = 0
    let isRunning = false
    let subscriptionCleanups: Array<Effect.Effect<void>> = []

    /**
     * Serialize accessed signals' current values as a cache key.
     * Uses peekSync to avoid running Effect inside Effect.
     * @internal
     */
    const computeDepKey = (accessed: Set<AnySignal>): string => {
      if (accessed.size === 0) return ""
      const entries: Array<[string, unknown]> = []
      for (const signal of accessed) {
        const value = peekSync(signal)
        entries.push([signal._debugId, value])
      }
      // Sort by debugId for deterministic key
      entries.sort((a, b) => a[0].localeCompare(b[0]))
      return JSON.stringify(entries.map(([, v]) => v))
    }

    const cleanupSubscriptions: () => Effect.Effect<void> = Effect.fn("Signal.suspend.cleanup")(
      function* () {
        const oldCleanups = subscriptionCleanups
        subscriptionCleanups = []
        for (const cleanup of oldCleanups) {
          yield* cleanup
        }
      }
    )

    const subscribeToSignals: (signals: Set<AnySignal>) => Effect.Effect<void> = Effect.fn(
      "Signal.suspend.subscribe"
    )(function* (signals: Set<AnySignal>) {
      yield* cleanupSubscriptions()
      if (signals.size === 0) return

      for (const signal of signals) {
        const unsubscribe = yield* subscribe(signal, () => refresh)
        subscriptionCleanups.push(unsubscribe)
      }
    })

    /**
     * Get the Success element. If it's a Component element, we need to
     * extract and run its effect. Otherwise just return it.
     * @internal
     */
    const renderSuccess: Effect.Effect<SuspendElement, unknown, never> = Effect.suspend(() =>
      Effect.gen(function* () {
        const element = handlers.Success
        // Check if it's a Component element that needs to be run
        if (typeof element === "object" && element !== null && element._tag === "Component") {
          const componentEffect = element.run() as Effect.Effect<SuspendElement, unknown, never>
          return yield* componentEffect.pipe(
            Effect.locally(CurrentRenderPhase, renderPhase)
          )
        }
        // For non-Component elements, just return them
        return element
      })
    ).pipe(Effect.withSpan("Signal.suspend.render"))

    const runRender: (runId: number) => Effect.Effect<void> = Effect.fn("Signal.suspend.run")(
      function* (runId: number) {
        yield* resetRenderPhase(renderPhase)

        const exit = yield* Effect.exit(renderSuccess)

        const latestRequest = requestId
        if (runId !== latestRequest) {
          return yield* runRender(latestRequest)
        }

        // Compute dep key from accessed signals
        const depKey = computeDepKey(renderPhase.accessed)

        if (Exit.isSuccess(exit)) {
          const element = exit.value as SuspendElement

          // Cache the successful render for this dep-key
          cache.set(depKey, element)

          yield* set(viewSignal, element)
        } else {
          // Failure - show error handler with stale from cache (if this dep-key succeeded before)
          const stale = cache.get(depKey) ?? null
          const errorElement = handlers.Failure(exit.cause as Cause.Cause<E>, stale)
          yield* set(viewSignal, errorElement)
        }

        yield* subscribeToSignals(renderPhase.accessed)

        const nextRequest = requestId
        if (runId !== nextRequest) {
          return yield* runRender(nextRequest)
        }
      }
    )

    const refresh: Effect.Effect<void> = Effect.gen(function* () {
      requestId += 1
      const runId = requestId

      // Compute what the new dep key will be (peek at current signal values)
      // We need to peek without fully running to check if cached
      const peekDepKey = computeDepKey(renderPhase.accessed)
      const cached = cache.get(peekDepKey)

      // Stale element is ONLY from cache for this specific dep-key
      // If dep-key was never fetched, stale is null (shows Loading)
      // If dep-key was previously fetched, stale is the cached element (shows stale)
      const stale = cached ?? null

      // Show pending state
      const pendingElement = typeof handlers.Pending === "function"
        ? handlers.Pending(stale)
        : handlers.Pending
      yield* set(viewSignal, pendingElement)

      if (isRunning) return
      isRunning = true

      yield* Effect.forkIn(
        runRender(runId).pipe(
          Effect.ensuring(
            Effect.sync(() => {
              isRunning = false
            })
          )
        ),
        scope
      )
    }).pipe(Effect.withSpan("Signal.suspend.refresh"))

    yield* Scope.addFinalizer(scope, cleanupSubscriptions())
    yield* refresh

    // Return a ComponentType that renders the signal as a SignalElement
    // This allows usage as <SuspendedView /> in JSX
    const suspendedComponent = (_props: Record<string, never>): SuspendElement => {
      return signalElement(viewSignal as Signal<SuspendElement>)
    }

    // Tag as EffectComponent and expose signal for testing
    return Object.assign(suspendedComponent, {
      _tag: "EffectComponent" as const,
      _signal: viewSignal
    }) as SuspendedComponent<E>
  }
)

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
  renderFn: (item: T, index: number) => Effect.Effect<any, E, unknown>,
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
