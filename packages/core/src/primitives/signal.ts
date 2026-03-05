/**
 * @since 1.0.0
 * Signal - Effect-native reactive state primitive
 *
 * Fine-grained reactivity built on SubscriptionRef.
 * Signals are first-class reactive values that can be:
 * - Passed to JSX for automatic DOM subscriptions
 * - Passed to JSX for fine-grained DOM updates
 * - Composed with derive for computed values
 */
import {
  Cause,
  Data,
  Effect,
  Equal,
  Exit,
  Pipeable,
  Ref,
  Scope,
  SubscriptionRef,
} from "effect";
import * as ServiceMap from "effect/ServiceMap";
import * as Debug from "../debug/debug.js";
import * as Metrics from "../debug/metrics.js";
import type { Element } from "./element.js";
import { type Component } from "./component.js";
import { unsafeMakeKeyedListElement, unsafeRunComponent, unsafeTagCallable } from "../internal/unsafe.js";

/**
 * Error raised when Signal module is not properly initialized.
 * @since 1.0.0
 */
export class SignalInitError extends Data.TaggedError("SignalInitError")<{
  readonly message: string;
}> {}

/**
 * Callback type for signal change notifications.
 * Effect-based for trace context propagation.
 * @internal
 */
export type SignalListener = () => Effect.Effect<void>;

/**
 * A Signal holds reactive state.
 *
 * Signals are first-class values that can be:
 * - Read with `Signal.get(signal)`
 * - Written with `Signal.set(signal, value)`
 * - Updated with `Signal.update(signal, fn)`
 * - Passed to JSX for fine-grained DOM updates
 *
 * @since 1.0.0
 */
export interface Signal<A> {
  readonly _tag: "Signal";
  readonly _ref: SubscriptionRef.SubscriptionRef<A>;
  /** Sync listeners for immediate change notifications */
  readonly _listeners: Set<SignalListener>;
  /** Debug ID for tracing */
  readonly _debugId: string;
}

/**
 * Internal signal storage type - uses any to work around invariance.
 * @internal
 */
type AnySignal = Signal<any>;

type PropsInput<Props> = [Props] extends [never] ? {} : Props;

declare global {
  var __tryggSignalCurrentRenderPhase: ServiceMap.Reference<RenderPhase | null> | undefined;
  var __tryggSignalCurrentRenderPhaseId: string | undefined;
  var __tryggSignalCurrentComponentScope: ServiceMap.Reference<Scope.Closeable | null> | undefined;
  var __tryggSignalCurrentRenderScope: ServiceMap.Reference<Scope.Closeable | null> | undefined;
}

/**
 * Render phase context - managed by Renderer during component execution.
 * Tracks signals created during render for identity across re-renders.
 * @internal
 */
export interface RenderPhase {
  /** Current signal index (for position-based identity like React hooks) */
  readonly signalIndex: Ref.Ref<number>;
  /** Array of signals created in this component */
  readonly signals: Ref.Ref<Array<AnySignal>>;
  /** Set of signals accessed during this render (for subscriptions) */
  readonly accessed: Set<AnySignal>;
}

/**
 * Reference to track current render phase.
 * Set by Renderer before executing component effects.
 * Stored on globalThis to survive module duplication.
 * @internal
 */
export const CurrentRenderPhase: ServiceMap.Reference<RenderPhase | null> =
  globalThis.__tryggSignalCurrentRenderPhase ??=
    ServiceMap.Reference<RenderPhase | null>("trygg/Signal/CurrentRenderPhase", {
      defaultValue: () => null,
    });

// Debug: unique ID to detect module duplication
export const _currentRenderPhaseId =
  globalThis.__tryggSignalCurrentRenderPhaseId ??=
    `reference_${Math.random().toString(36).slice(2, 8)}`;

/**
 * Reference to track current component lifetime scope.
 * Set by Renderer before executing component effects.
 * Stored on globalThis to survive module duplication.
 * @internal
 */
export const CurrentComponentScope: ServiceMap.Reference<Scope.Closeable | null> =
  globalThis.__tryggSignalCurrentComponentScope ??=
    ServiceMap.Reference<Scope.Closeable | null>("trygg/Signal/CurrentComponentScope", {
      defaultValue: () => null,
    });

/**
 * Reference to track current render scope (cleared on re-render).
 * Set by Renderer before executing component effects.
 * Stored on globalThis to survive module duplication.
 * @internal
 */
export const CurrentRenderScope: ServiceMap.Reference<Scope.Closeable | null> =
  globalThis.__tryggSignalCurrentRenderScope ??=
    ServiceMap.Reference<Scope.Closeable | null>("trygg/Signal/CurrentRenderScope", {
      defaultValue: () => null,
    });

/**
 * Create a new RenderPhase for a component.
 * @internal
 */
export const makeRenderPhase = Effect.gen(function* () {
  const signalIndex = yield* Ref.make(0);
  const signals = yield* Ref.make<Array<AnySignal>>([]);
  const accessed = new Set<AnySignal>();
  return { signalIndex, signals, accessed } satisfies RenderPhase;
});

/**
 * Reset render phase for re-render (keeps signals, resets index).
 * @internal
 */
export const resetRenderPhase = Effect.fn("Signal.resetRenderPhase")(function* (
  phase: RenderPhase,
) {
  yield* Ref.set(phase.signalIndex, 0);
  phase.accessed.clear();
});

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
export const make: <A>(initial: A) => Effect.Effect<Signal<A>> = Effect.fn("Signal.make")(
  function* <A>(initial: A) {
    const phase = yield* CurrentRenderPhase;

    if (phase === null) {
      // Not in component render - create standalone signal
      const ref = yield* SubscriptionRef.make(initial);
      const debugId = Debug.nextSignalId();
      yield* Debug.log({
        event: "signal.create",
        signal_id: debugId,
        value: initial,
        component: "standalone",
      });
      const signal: Signal<A> = {
        _tag: "Signal",
        _ref: ref,
        _listeners: new Set(),
        _debugId: debugId,
      };
      return signal;
    }

    // In component render - use position-based identity
    const index = yield* Ref.get(phase.signalIndex);
    yield* Ref.update(phase.signalIndex, (n) => n + 1);

    const signals = yield* Ref.get(phase.signals);

    let signal: Signal<A>;
    const existing = signals[index];
    if (index < signals.length && existing !== undefined) {
      // Reuse existing signal from previous render.
      // AnySignal = Signal<any> — position-based identity guarantees
      // the signal at this index was created with the same type A.
      signal = existing;
      yield* Debug.log({
        event: "signal.create",
        signal_id: signal._debugId,
        value: initial,
        component: "reused",
      });
    } else {
      // First render - create new signal
      const ref = yield* SubscriptionRef.make(initial);
      const debugId = Debug.nextSignalId();
      signal = { _tag: "Signal", _ref: ref, _listeners: new Set(), _debugId: debugId };
      yield* Ref.update(phase.signals, (arr) => [...arr, signal]);
      yield* Debug.log({
        event: "signal.create",
        signal_id: debugId,
        value: initial,
        component: "new",
      });
    }

    // Note: We do NOT add to phase.accessed here.
    // Only Signal.get() adds to accessed, enabling fine-grained reactivity:
    // - If you read a signal (Signal.get), the component re-renders when it changes
    // - If you just pass the signal to JSX, you get fine-grained DOM updates

    return signal;
  },
);

/**
 * Create a Signal synchronously, outside of Effect context.
 *
 * Use `Signal.makeSync` for global/module-level signals that exist for the
 * lifetime of the application (e.g. auth state, theme, locale). These
 * signals are created eagerly at module load time and can be shared
 * across components via services or direct import.
 *
 * Recommended global-state service pattern:
 * - Keep the signal module-private with `Signal.makeSync`
 * - Expose state operations through a `Context.Tag` service contract
 * - Provide the service with `Layer.succeed` (stable reference)
 *
 * Anti-pattern (state loss):
 * - Creating signals inside `Layer.effect` / `Layer.sync` using `Signal.make`
 * - The renderer rebuilds layers on each render, so `Layer.effect` /
 *   `Layer.sync` re-execute and recreate those signals
 *
 * Rule: stateful services should use `Signal.makeSync` + `Layer.succeed`.
 *
 * Use `Signal.make` inside `Component.gen` for component-local state
 * that is scoped to the component's lifecycle and cleaned up automatically.
 *
 * @example
 * ```tsx
 * // Global auth state — module-private, created at module load
 * const authSignal = Signal.makeSync<Option.Option<User>>(Option.none())
 *
 * // Expose via service contract; components depend on Tag, not raw signal
 * const user = yield* Signal.get(authSignal)
 * yield* Signal.set(authSignal, Option.some(newUser))
 * ```
 *
 * @since 1.0.0
 */
export const makeSync = <A>(initial: A): Signal<A> => {
  const ref = Effect.runSync(SubscriptionRef.make(initial));
  const debugId = Debug.nextSignalId();
  // Note: No logging here since we're outside Effect context.
  // makeSync is for global signals created at module load time.
  return { _tag: "Signal", _ref: ref, _listeners: new Set(), _debugId: debugId };
};

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
export const get: <A>(signal: Signal<A>) => Effect.Effect<A> = Effect.fn("Signal.get")(function* <
  A,
>(signal: Signal<A>) {
  // Track this signal as accessed - subscribes component to changes
  const phase = yield* CurrentRenderPhase;
  yield* Debug.log({
    event: "signal.get.phase",
    signal_id: signal._debugId,
    has_phase: phase !== null,
  });
  if (phase !== null) {
    phase.accessed.add(signal);
    yield* Debug.log({
      event: "signal.get",
      signal_id: signal._debugId,
      trigger: "component subscription",
    });
  }
  return yield* SubscriptionRef.get(signal._ref);
});

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
  Effect.runSync(SubscriptionRef.get(signal._ref));

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
    const prevValue = yield* SubscriptionRef.get(signal._ref);

    // Skip update if value is unchanged (prevents unnecessary re-renders)
    if (Equal.equals(prevValue, value)) {
      yield* Debug.log({
        event: "signal.set.skipped",
        signal_id: signal._debugId,
        value: value,
        reason: "unchanged",
      });
      return;
    }

    yield* SubscriptionRef.set(signal._ref, value);
    yield* Debug.log({
      event: "signal.set",
      signal_id: signal._debugId,
      prev_value: prevValue,
      value: value,
      listener_count: signal._listeners.size,
    });
    // Record signal update metric
    yield* Metrics.recordSignalUpdate;
    yield* notifyListeners(signal);
  },
);

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
export const update: <A>(signal: Signal<A>, f: (a: A) => A) => Effect.Effect<void> = Effect.fn(
  "Signal.update",
)(function* <A>(signal: Signal<A>, f: (a: A) => A) {
  const prevValue = yield* SubscriptionRef.get(signal._ref);
  const newValue = f(prevValue);

  // Skip update if value is unchanged (prevents unnecessary re-renders)
  if (Equal.equals(prevValue, newValue)) {
    yield* Debug.log({
      event: "signal.update.skipped",
      signal_id: signal._debugId,
      value: newValue,
      reason: "unchanged",
    });
    return;
  }

  yield* SubscriptionRef.set(signal._ref, newValue);
  yield* Debug.log({
    event: "signal.update",
    signal_id: signal._debugId,
    prev_value: prevValue,
    value: newValue,
    listener_count: signal._listeners.size,
  });
  // Record signal update metric
  yield* Metrics.recordSignalUpdate;
  yield* notifyListeners(signal);
});

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
export const modify = <A, B>(signal: Signal<A>, f: (a: A) => readonly [B, A]): Effect.Effect<B> =>
  SubscriptionRef.modify(signal._ref, f).pipe(Effect.tap(() => notifyListeners(signal)));

/**
 * Options for Signal.derive
 * @since 1.0.0
 */
export interface DeriveOptions {
  /** Explicit scope for subscription cleanup. If not provided, uses current Effect scope. */
  readonly scope: Scope.Scope;
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
  options: DeriveOptions,
): Effect.Effect<Signal<B>>;
export function derive<A, B>(
  source: Signal<A>,
  f: (a: A) => B,
): Effect.Effect<Signal<B>, never, Scope.Scope>;
export function derive<A, B>(
  source: Signal<A>,
  f: (a: A) => B,
  options?: DeriveOptions,
): Effect.Effect<Signal<B>, never, Scope.Scope> {
  return Effect.gen(function* () {
    const renderScope = yield* CurrentRenderScope;
    // Get scope from options or from render scope
    const scope = options?.scope ?? renderScope ?? (yield* Effect.scope);

    const initial = yield* SubscriptionRef.get(source._ref);
    const derivedRef = yield* SubscriptionRef.make(f(initial));
    const debugId = Debug.nextSignalId();
    const derivedSignal: Signal<B> = {
      _tag: "Signal",
      _ref: derivedRef,
      _listeners: new Set(),
      _debugId: debugId,
    };

    yield* Debug.log({
      event: "signal.derive.create",
      signal_id: debugId,
      source_id: source._debugId,
      value: f(initial),
    });

    // Subscribe to source changes with Effect-based listener
    const unsubscribe = yield* subscribe(source, () =>
      Effect.gen(function* () {
        const current = yield* SubscriptionRef.get(source._ref);
        yield* SubscriptionRef.set(derivedRef, f(current));
        yield* notifyListeners(derivedSignal);
      }),
    );

    // Register cleanup on scope finalization
    yield* Scope.addFinalizer(
      scope,
      Effect.gen(function* () {
        yield* unsubscribe;
        yield* Debug.log({
          event: "signal.derive.cleanup",
          signal_id: debugId,
          source_id: source._debugId,
        });
      }),
    );

    return derivedSignal;
  }).pipe(Effect.withSpan("Signal.derive"));
}

/**
 * Create a derived signal that computes its value from multiple source signals.
 *
 * The derived signal updates eagerly when any source signal changes.
 * Subscriptions are automatically cleaned up when the scope closes.
 * Each source signal's value is passed as a corresponding argument to the function.
 *
 * @example
 * ```tsx
 * const count = yield* Signal.make(0)
 * const name = yield* Signal.make("hello")
 *
 * const label = yield* Signal.deriveAll(
 *   [count, name],
 *   (c, n) => `${n}: ${c}`
 *   //  ^number ^string — fully inferred
 * )
 * ```
 *
 * @since 1.0.0
 */
export function deriveAll<A, B>(
  sources: readonly [Signal<A>],
  f: (a: A) => B,
  options?: DeriveOptions,
): Effect.Effect<Signal<B>, never, Scope.Scope>;
export function deriveAll<A, B, R>(
  sources: readonly [Signal<A>, Signal<B>],
  f: (a: A, b: B) => R,
  options?: DeriveOptions,
): Effect.Effect<Signal<R>, never, Scope.Scope>;
export function deriveAll<A, B, C, R>(
  sources: readonly [Signal<A>, Signal<B>, Signal<C>],
  f: (a: A, b: B, c: C) => R,
  options?: DeriveOptions,
): Effect.Effect<Signal<R>, never, Scope.Scope>;
export function deriveAll<A, B, C, D, R>(
  sources: readonly [Signal<A>, Signal<B>, Signal<C>, Signal<D>],
  f: (a: A, b: B, c: C, d: D) => R,
  options?: DeriveOptions,
): Effect.Effect<Signal<R>, never, Scope.Scope>;
export function deriveAll<A, B, C, D, E, R>(
  sources: readonly [Signal<A>, Signal<B>, Signal<C>, Signal<D>, Signal<E>],
  f: (a: A, b: B, c: C, d: D, e: E) => R,
  options?: DeriveOptions,
): Effect.Effect<Signal<R>, never, Scope.Scope>;
export function deriveAll<A, B, C, D, E, F, R>(
  sources: readonly [Signal<A>, Signal<B>, Signal<C>, Signal<D>, Signal<E>, Signal<F>],
  f: (a: A, b: B, c: C, d: D, e: E, f_: F) => R,
  options?: DeriveOptions,
): Effect.Effect<Signal<R>, never, Scope.Scope>;
export function deriveAll(
  sources: ReadonlyArray<Signal<unknown>>,
  f: (...values: ReadonlyArray<unknown>) => unknown,
  options?: DeriveOptions,
): Effect.Effect<Signal<unknown>, never, Scope.Scope> {
  return Effect.gen(function* () {
    const renderScope = yield* CurrentRenderScope;
    const scope = options?.scope ?? renderScope ?? (yield* Effect.scope);

    // Read initial values from all sources
    const readAll = () => Effect.forEach(sources, (source) => SubscriptionRef.get(source._ref));

    const initialValues = yield* readAll();
    const initial = f(...initialValues);

    const derivedRef = yield* SubscriptionRef.make(initial);
    const debugId = Debug.nextSignalId();
    const derivedSignal: Signal<unknown> = {
      _tag: "Signal",
      _ref: derivedRef,
      _listeners: new Set(),
      _debugId: debugId,
    };

    yield* Debug.log({
      event: "signal.deriveAll.create",
      signal_id: debugId,
      source_count: sources.length,
      value: initial,
    });

    // Recompute: read all sources, apply f, update derived if changed
    const recompute = Effect.gen(function* () {
      const values = yield* readAll();
      const newValue = f(...values);
      const prevValue = yield* SubscriptionRef.get(derivedRef);
      if (!Equal.equals(prevValue, newValue)) {
        yield* SubscriptionRef.set(derivedRef, newValue);
        yield* notifyListeners(derivedSignal);
      }
    });

    // Subscribe to all source signals
    const unsubscribes: Array<Effect.Effect<void>> = [];
    for (const source of sources) {
      const unsubscribe = yield* subscribe(source, () => recompute);
      unsubscribes.push(unsubscribe);
    }

    // Register cleanup on scope finalization
    yield* Scope.addFinalizer(
      scope,
      Effect.gen(function* () {
        for (const unsub of unsubscribes) {
          yield* unsub;
        }
        yield* Debug.log({
          event: "signal.deriveAll.cleanup",
          signal_id: debugId,
          source_count: sources.length,
        });
      }),
    );

    return derivedSignal;
  }).pipe(Effect.withSpan("Signal.deriveAll"));
}

/**
 * Check if a value is a Signal.
 * @since 1.0.0
 */
export const isSignal = (value: unknown): value is Signal<unknown> =>
  typeof value === "object" && value !== null && "_tag" in value && value._tag === "Signal";

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
const notifyListeners: <A>(signal: Signal<A>) => Effect.Effect<void> = Effect.fnUntraced(function* <
  A,
>(signal: Signal<A>) {
  const listenerCount = signal._listeners.size;

  yield* Debug.log({
    event: "signal.notify",
    signal_id: signal._debugId,
    listener_count: listenerCount,
  });

  // Skip if no listeners
  if (listenerCount === 0) return;

  // Snapshot listeners to handle mid-notification unsubscribes safely
  const listeners = Array.from(signal._listeners);

  // Notify all listeners in parallel with error isolation
  yield* Effect.forEach(
      listeners,
      (listener, index) =>
        listener().pipe(
          Effect.catchCause((cause) =>
            Debug.log({
              event: "signal.listener.error",
              signal_id: signal._debugId,
            cause: Cause.pretty(cause),
            listener_index: index,
          }),
        ),
      ),
    { concurrency: "unbounded", discard: true },
  );
});

/**
 * Subscribe to a signal's changes with an Effect-based callback.
 * Returns an Effect that yields an unsubscribe Effect.
 * @since 1.0.0
 */
export const subscribe: <A>(
  signal: Signal<A>,
  listener: SignalListener,
) => Effect.Effect<Effect.Effect<void>> = Effect.fn("Signal.subscribe")(function* <A>(
  signal: Signal<A>,
  listener: SignalListener,
) {
  signal._listeners.add(listener);
  yield* Debug.log({
    event: "signal.subscribe",
    signal_id: signal._debugId,
    listener_count: signal._listeners.size,
  });
  // Return unsubscribe effect (intentionally returns Effect for later execution)
  return yield* Effect.succeed(
    Effect.sync(() => {
      signal._listeners.delete(listener);
      return signal._listeners.size;
    }).pipe(
      Effect.tap((listenerCount) =>
        Debug.log({
          event: "signal.unsubscribe",
          signal_id: signal._debugId,
          listener_count: listenerCount,
        }),
      ),
      Effect.asVoid,
    ),
  );
});

// =============================================================================
// Signal.suspend - Component suspension with async state tracking
// =============================================================================

/**
 * Import Element type from element.ts
 * Using import type to avoid circular dependency issues at runtime
 * @internal
 */
type SuspendElement = import("./element.js").Element;

type SuspendState = "Pending" | "Failure";

type PendingHandler<R> =
  | Component.Type<{ stale: SuspendElement | null }, unknown, R>
  | SuspendElement
  | ((stale: SuspendElement | null) => SuspendElement);

type FailureHandler<R> =
  | Component.Type<{ cause: Cause.Cause<unknown>; stale: SuspendElement | null }, unknown, R>
  | ((cause: Cause.Cause<unknown>, stale: SuspendElement | null) => SuspendElement);

type StateHandler<State extends SuspendState, R> = State extends "Pending"
  ? PendingHandler<R>
  : FailureHandler<R>;

/**
 * Suspended component preserving `Props`, `E`, `R` and exposing the internal
 * signal for tests/debugging.
 *
 * @since 1.0.0
 */
export interface SuspendedComponent<Props = never, E = never, R = never>
  extends Component.Type<Props, E, R> {
  readonly _signal: Signal<SuspendElement>;
}

/**
 * Pipeable matcher for `Signal.suspend`.
 *
 * `E` is the wrapped component error type. This remains on the returned
 * component type and documents failures from the wrapped component itself.
 * The `Failure` branch is for the suspend lifecycle fallback UI.
 *
 * @since 1.0.0
 */
export interface SuspendMatcher<
  Props,
  E,
  R,
  HasPending extends boolean,
  HasFailure extends boolean,
> extends Pipeable.Pipeable {
  readonly _tag: "SuspendMatcher";
  readonly component: Component.Type<Props, E, R>;
  readonly pending?: PendingHandler<unknown>;
  readonly failure?: FailureHandler<unknown>;
  readonly _hasPending?: HasPending;
  readonly _hasFailure?: HasFailure;
}

const makeSuspendMatcher = <Props, E, R, HasPending extends boolean, HasFailure extends boolean>(
  component: Component.Type<Props, E, R>,
  pending?: PendingHandler<unknown>,
  failure?: FailureHandler<unknown>,
): SuspendMatcher<Props, E, R, HasPending, HasFailure> => ({
  _tag: "SuspendMatcher",
  component,
  ...(pending === undefined ? {} : { pending }),
  ...(failure === undefined ? {} : { failure }),
  pipe() {
    return Pipeable.pipeArguments(this, arguments);
  },
});

const makeTextElement = (content: string): SuspendElement =>
  ({ _tag: "Text", content }) satisfies Extract<SuspendElement, { readonly _tag: "Text" }>;

const makeSignalElement = (signal: Signal<Element>): SuspendElement =>
  ({
    _tag: "SignalElement",
    signal,
    onSwap: undefined,
  }) satisfies Extract<SuspendElement, { readonly _tag: "SignalElement" }>;

const makeComponentElement = <E, R>(
  run: () => Effect.Effect<SuspendElement, E, R>,
): SuspendElement =>
  ({ _tag: "Component", run, key: null }) satisfies Extract<SuspendElement, { readonly _tag: "Component" }>;

const isEffectComponentLike = (value: unknown): value is Component.Type<unknown, unknown, unknown> =>
  typeof value === "function" && value !== null && Reflect.get(value, "_tag") === "EffectComponent";

const isPendingComponent = (
  handler: PendingHandler<unknown>,
): handler is Component.Type<{ stale: SuspendElement | null }, unknown, unknown> => isEffectComponentLike(handler);

const isFailureComponent = (
  handler: FailureHandler<unknown>,
): handler is Component.Type<{ cause: Cause.Cause<unknown>; stale: SuspendElement | null }, unknown, unknown> =>
  isEffectComponentLike(handler);

const renderPending = (
  handler: PendingHandler<unknown>,
  stale: SuspendElement | null,
): SuspendElement => {
  if (isPendingComponent(handler)) {
    return handler({ stale });
  }
  if (typeof handler === "function") {
    return handler(stale);
  }
  return handler;
};

const renderFailure = (
  handler: FailureHandler<unknown>,
  cause: Cause.Cause<unknown>,
  stale: SuspendElement | null,
): SuspendElement => {
  if (isFailureComponent(handler)) {
    return handler({ cause, stale });
  }
  return handler(cause, stale);
};

const runSuspendRender = <Props, E>(
  component: Component.Type<Props, E, unknown>,
  props: PropsInput<Props>,
  renderPhase: RenderPhase,
): Effect.Effect<SuspendElement, E> =>
  Effect.provideService(unsafeRunComponent(component, props), CurrentRenderPhase, renderPhase).pipe(
    Effect.withSpan("Signal.suspend.render"),
  );

/**
 * Start building a suspended component.
 *
 * @example
 * ```tsx
 * const SuspendedProfile = yield* Signal
 *   .suspend(UserProfile)
 *   .pipe(
 *     Signal.on("Pending", Spinner),
 *     Signal.on("Failure", ErrorView),
 *     Signal.exhaustive,
 *   )
 * ```
 *
 * @since 1.0.0
 */
export const suspend = <Props, E, R>(
  component: Component.Type<Props, E, R>,
): SuspendMatcher<Props, E, R, false, false> => makeSuspendMatcher(component);

/**
 * Register a suspend-state handler.
 *
 * `Pending` receives `{ stale }`.
 * `Failure` receives `{ cause, stale }`.
 *
 * @since 1.0.0
 */
export const on =
  <
    Props,
    E,
    R,
    HasPending extends boolean,
    HasFailure extends boolean,
    State extends SuspendState,
    RHandler,
  >(
    state: State,
    handler: StateHandler<State, RHandler>,
  ) =>
  (
    self: SuspendMatcher<Props, E, R, HasPending, HasFailure>,
  ): SuspendMatcher<
    Props,
    E,
    R | RHandler,
    State extends "Pending" ? true : HasPending,
    State extends "Failure" ? true : HasFailure
  > =>
    state === "Pending"
      ? makeSuspendMatcher(self.component, handler as PendingHandler<unknown>, self.failure)
      : makeSuspendMatcher(self.component, self.pending, handler as FailureHandler<unknown>);

/**
 * Finalize the suspend matcher.
 *
 * The returned component preserves the wrapped component `Props`, `E`, and the
 * accumulated requirements from both the wrapped component and state handlers.
 *
 * @since 1.0.0
 */
export const exhaustive = <Props, E, R>(
  self: SuspendMatcher<Props, E, R, true, true>,
): Effect.Effect<SuspendedComponent<Props, E, R>, never> =>
  Effect.gen(function* () {
    const { tagComponent } = yield* Effect.promise(() => import("./component.js"));
    const pending = self.pending;
    const failure = self.failure;

    if (pending === undefined || failure === undefined) {
      return unsafeTagCallable<SuspendedComponent<Props, E, R>>(
        (_props: PropsInput<Props>) =>
          makeComponentElement(() =>
            Effect.die(
              new SignalInitError({
                message: "Signal.suspend exhaustive requires Pending and Failure handlers",
              }),
            ),
          ),
        {
          _tag: "EffectComponent",
          _layers: self.component._layers,
          _signal: makeSync(makeTextElement("Signal.suspend unavailable")),
        },
      );
    }

    const initialSignal = makeSync<SuspendElement>(renderPending(pending, null));

    const runFn = (props: PropsInput<Props>): Effect.Effect<Element, never, R> =>
      Effect.gen(function* () {
        const componentScope = yield* CurrentComponentScope;
        const scope = componentScope ?? (yield* Scope.make());
        const cache = new Map<string, SuspendElement>();
        const viewSignal = yield* make(renderPending(pending, null));
        const renderPhase = yield* makeRenderPhase;

        let requestId = 0;
        let isRunning = false;
        let subscriptionCleanups: Array<Effect.Effect<void>> = [];

        const computeDepKey = (accessed: Set<AnySignal>): string => {
          if (accessed.size === 0) return "";
          const entries: Array<[string, unknown]> = [];
          for (const signal of accessed) {
            entries.push([signal._debugId, peekSync(signal)]);
          }
          entries.sort((a, b) => a[0].localeCompare(b[0]));
          return JSON.stringify(entries.map(([, value]) => value));
        };

        const cleanupSubscriptions = Effect.fn("Signal.suspend.cleanup")(function* () {
          const oldCleanups = subscriptionCleanups;
          subscriptionCleanups = [];
          for (const cleanup of oldCleanups) {
            yield* cleanup;
          }
        });

        const refreshRef = yield* Ref.make<Effect.Effect<void>>(Effect.void);

        const setView = (element: SuspendElement): Effect.Effect<void> =>
          SubscriptionRef.set(viewSignal._ref, element).pipe(
            Effect.flatMap(() => notifyListeners(viewSignal)),
          );

        const subscribeToSignals = Effect.fn("Signal.suspend.subscribe")(function* (signals: Set<AnySignal>) {
          yield* cleanupSubscriptions();
          if (signals.size === 0) return;

          for (const signal of signals) {
            const unsubscribe = yield* subscribe(signal, () =>
              Ref.get(refreshRef).pipe(Effect.flatMap((refresh) => refresh)),
            );
            subscriptionCleanups.push(unsubscribe);
          }
        });

        const runRender = (runId: number): Effect.Effect<void> =>
          Effect.gen(function* () {
          yield* resetRenderPhase(renderPhase);
          const exit = yield* Effect.exit(runSuspendRender(self.component, props, renderPhase));

          const latestRequest = requestId;
          if (runId !== latestRequest) {
            yield* runRender(latestRequest);
            return;
          }

          const depKey = computeDepKey(renderPhase.accessed);
          if (Exit.isSuccess(exit)) {
            cache.set(depKey, exit.value);
            yield* setView(exit.value);
          } else {
            const stale = cache.get(depKey) ?? null;
            yield* setView(renderFailure(failure, exit.cause, stale));
          }

          yield* subscribeToSignals(renderPhase.accessed);

          const nextRequest = requestId;
          if (runId !== nextRequest) {
            yield* runRender(nextRequest);
          }
          });

        const refresh: Effect.Effect<void> = Effect.gen(function* () {
          requestId += 1;
          const runId = requestId;
          const peekDepKey = computeDepKey(renderPhase.accessed);
          const stale = cache.get(peekDepKey) ?? null;
          yield* setView(renderPending(pending, stale));

          if (isRunning) return;
          isRunning = true;
          yield* Effect.forkIn(
            runRender(runId).pipe(
              Effect.ensuring(
                Effect.sync(() => {
                  isRunning = false;
                }),
              ),
            ),
            scope,
          );
        }).pipe(Effect.withSpan("Signal.suspend.refresh"));

        yield* Ref.set(refreshRef, refresh);

        yield* Scope.addFinalizer(scope, cleanupSubscriptions());
        yield* refresh;
        yield* SubscriptionRef.set(initialSignal._ref, makeSignalElement(viewSignal));
        return makeSignalElement(viewSignal);
      });

    const suspendedComponent = (props: PropsInput<Props>): SuspendElement => makeComponentElement(() => runFn(props));

    return unsafeTagCallable<SuspendedComponent<Props, E, R>>(suspendedComponent, {
      _tag: "EffectComponent",
      _layers: self.component._layers,
      _runFn: runFn,
      _signal: initialSignal,
      provide: tagComponent(suspendedComponent, self.component._layers, runFn).provide,
    });
  });

/**
 * Key type for list items
 * @since 1.0.0
 */
export type ItemKey = string | number;

/**
 * Options for Signal.each
 * @since 1.0.0
 */
export interface EachOptions<T> {
  /**
   * Function to extract a unique key from each item.
   * Items with the same key maintain their scope across updates.
   */
  readonly key: (item: T, index: number) => ItemKey;
}

/**
 * Render function return type for Signal.each.
 * Accepts either a plain Element or an Effect that produces an Element.
 * @since 1.0.0
 */
export type EachRenderResult<E> = Element | Effect.Effect<Element, E, unknown>;

type EachFn = <T, E>(
  source: Signal<ReadonlyArray<T>>,
  renderFn: (item: T, index: number) => EachRenderResult<E>,
  options: EachOptions<T>,
) => Element;

const makeKeyedListElement = <T, E>(
  source: Signal<ReadonlyArray<T>>,
  renderFn: (item: T, index: number) => EachRenderResult<E>,
  key: (item: T, index: number) => ItemKey,
): Element =>
  unsafeMakeKeyedListElement(source, (item, index) => {
    const result = renderFn(item, index);
    return Effect.isEffect(result) ? result : Effect.succeed(result);
  }, key);

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
  return makeKeyedListElement(source, renderFn, options.key);
};
