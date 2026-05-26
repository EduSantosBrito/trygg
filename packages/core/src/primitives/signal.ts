/**
 * Reactive state primitives for trygg.
 *
 * @remarks
 * Owner module for the `Signal` topic. Use this module when you need local or
 * module-level reactive state, derived state, suspended views, or keyed list
 * rendering. The root `trygg` entrypoint publishes this topic as `Signal.*`.
 *
 * `Signal` has two read modes:
 * - pass signals directly to JSX for fine-grained DOM updates
 * - call `Signal.get` when a component must re-run on changes
 *
 * @see ./signal.docs.md - Source-owned topic guide
 * @since 1.0.0
 * @module trygg/primitives/signal
 */
import {
  Cause,
  Data,
  Effect,
  Equal,
  Exit,
  Hash,
  Pipeable,
  Ref,
  Result,
  Scope,
  SubscriptionRef,
} from "effect";
import * as Context from "effect/Context";
import * as Debug from "../debug/debug.js";
import * as Metrics from "../debug/metrics.js";
import * as ContractTrace from "../contract/trace.js";
import type { Element } from "./element.js";
import { type Component } from "./component.js";
import {
  unsafeMakeKeyedListElement,
  unsafeRunComponent,
  unsafeTagCallable,
} from "../internal/unsafe.js";
import * as ReactiveMatcher from "./reactive-matcher.js";

/**
 * Error raised when Signal module is not properly initialized.
 *
 * @remarks
 * Internal guard for impossible `Signal.suspend` states and duplicated module
 * initialization paths.
 * @since 1.0.0
 * @internal
 */
export class SignalInitError extends Data.TaggedError("SignalInitError")<{
  readonly message: string;
}> {}

/**
 * Error raised when a signal is created without an owning Effect scope.
 *
 * @remarks
 * `Signal.make` needs a component, provider, or explicit Effect scope so the
 * signal can be disposed deterministically with its owner.
 *
 * @example
 * ```ts
 * const exit = yield* Effect.exit(Signal.make(0))
 * ```
 *
 * @category Reactivity
 * @public
 * @since 1.0.0
 */
export class SignalScopeError extends Data.TaggedError("SignalScopeError")<{
  readonly operation: "make";
  readonly message: string;
}> {}

/**
 * Operation attempted against a disposed signal.
 *
 * @remarks
 * Included on `SignalDisposedError` so diagnostics can distinguish stale reads
 * from stale writes.
 *
 * @example
 * ```ts
 * const operation: Signal.SignalDisposedOperation = "get"
 * ```
 *
 * @category Reactivity
 * @public
 * @since 1.0.0
 */
export type SignalDisposedOperation = "get" | "peek" | "set" | "update" | "modify";

/**
 * Error raised when user code accesses a signal after its owner scope closes.
 *
 * @remarks
 * Disposed access usually means a component event, async callback, or service
 * method outlived the component or provider scope that created the signal.
 *
 * @example
 * ```ts
 * const exit = yield* Effect.exit(Signal.peek(signal))
 * ```
 *
 * @category Reactivity
 * @public
 * @since 1.0.0
 */
export class SignalDisposedError extends Data.TaggedError("SignalDisposedError")<{
  readonly operation: SignalDisposedOperation;
  readonly signalId: string;
}> {}

/**
 * Signal owner category for lifecycle tracing.
 *
 * @remarks
 * Internal observability label attached to signal create/dispose events.
 *
 * @since 1.0.0
 * @internal
 */
export type SignalOwner = "component" | "provider" | "effect";

/**
 * Callback type for signal change notifications.
 *
 * @remarks
 * Internal listener contract. Listeners stay Effect-based so trace context and
 * scoped cleanup propagate through signal updates.
 *
 * @since 1.0.0
 * @internal
 */
export type SignalListener = () => Effect.Effect<void, unknown>;

/**
 * A Signal holds reactive state.
 *
 * @remarks
 * Signals are first-class values that can be:
 * - Read reactively with `Signal.get(signal)`
 * - Read without tracking with `Signal.peek(signal)`
 * - Written with `Signal.set(signal, value)`
 * - Updated with `Signal.update(signal, fn)`
 * - Passed to JSX for fine-grained DOM updates
 *
 * `Signal.make` creates component-local or scoped state and is disposed with
 * the owning component, provider layer, or explicit Effect scope.
 *
 * @example
 * ```tsx
 * const count = yield* Signal.make(0)
 * yield* Signal.update(count, (n) => n + 1)
 * ```
 *
 * @category Reactivity
 * @public
 * @since 1.0.0
 */
export interface Signal<A> {
  readonly _tag: "Signal";
  readonly _ref: SubscriptionRef.SubscriptionRef<A>;
  /** Sync listeners for immediate change notifications */
  readonly _listeners: Set<SignalListener>;
  /** Debug ID for tracing */
  readonly _debugId: string;
  /** Owner kind for lifecycle tracing */
  readonly _owner: SignalOwner;
  /** Disposal flag set when the owner scope closes */
  readonly _disposed: Ref.Ref<boolean>;
}

/**
 * Internal signal storage type - uses any to work around invariance.
 *
 * @remarks
 * Only used to store heterogeneously typed signals during render-phase tracking.
 * @internal
 */
type AnySignal = Signal<any>;

type PropsInput<Props> = [Props] extends [never] ? {} : Props;

declare global {
  var __tryggSignalCurrentRenderPhase: Context.Reference<RenderPhase | null> | undefined;
  var __tryggSignalCurrentRenderPhaseId: string | undefined;
  var __tryggSignalCurrentComponentScope: Context.Reference<Scope.Closeable | null> | undefined;
  var __tryggSignalCurrentRenderScope: Context.Reference<Scope.Closeable | null> | undefined;
  var __tryggSignalCurrentOwner: Context.Reference<SignalOwner> | undefined;
}

/**
 * Render phase context - managed by Renderer during component execution.
 * Tracks signals created during render for identity across re-renders.
 *
 * @remarks
 * Internal renderer bookkeeping for hook-like position tracking and dependency
 * collection.
 *
 * @since 1.0.0
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
 *
 * @remarks
 * Internal service reference used to make signal reads and allocations render-phase aware.
 *
 * @since 1.0.0
 * @internal
 */
export const CurrentRenderPhase: Context.Reference<RenderPhase | null> =
  (globalThis.__tryggSignalCurrentRenderPhase ??= Context.Reference<RenderPhase | null>(
    "trygg/Signal/CurrentRenderPhase",
    {
      defaultValue: () => null,
    },
  ));

/**
 * Debug identifier for the shared render-phase reference.
 *
 * @remarks
 * Internal duplication detector used by debugging tools and diagnostics.
 *
 * @since 1.0.0
 * @internal
 */
export const _currentRenderPhaseId =
  (globalThis.__tryggSignalCurrentRenderPhaseId ??= `reference_${Math.random().toString(36).slice(2, 8)}`);

/**
 * Reference to track current component lifetime scope.
 * Set by Renderer before executing component effects.
 * Stored on globalThis to survive module duplication.
 *
 * @remarks
 * Internal scope reference for subscriptions that should live for the whole component instance.
 *
 * @since 1.0.0
 * @internal
 */
export const CurrentComponentScope: Context.Reference<Scope.Closeable | null> =
  (globalThis.__tryggSignalCurrentComponentScope ??= Context.Reference<Scope.Closeable | null>(
    "trygg/Signal/CurrentComponentScope",
    {
      defaultValue: () => null,
    },
  ));

/**
 * Reference to track current render scope (cleared on re-render).
 * Set by Renderer before executing component effects.
 * Stored on globalThis to survive module duplication.
 *
 * @remarks
 * Internal scope reference for subscriptions tied to the current render pass only.
 *
 * @since 1.0.0
 * @internal
 */
export const CurrentRenderScope: Context.Reference<Scope.Closeable | null> =
  (globalThis.__tryggSignalCurrentRenderScope ??= Context.Reference<Scope.Closeable | null>(
    "trygg/Signal/CurrentRenderScope",
    {
      defaultValue: () => null,
    },
  ));

/**
 * Reference to classify signals created outside component render.
 * Provider layer acquisition sets this to `provider`; explicit scoped effects
 * keep the default `effect` owner.
 *
 * @remarks
 * Renderer internals set this fiber ref while acquiring provider layers so
 * signal lifecycle traces can identify provider-owned state.
 *
 * @since 1.0.0
 * @internal
 */
export const CurrentSignalOwner: Context.Reference<SignalOwner> =
  (globalThis.__tryggSignalCurrentOwner ??= Context.Reference<SignalOwner>(
    "trygg/Signal/CurrentSignalOwner",
    {
      defaultValue: () => "effect",
    },
  ));

/**
 * Create a new RenderPhase for a component.
 *
 * @remarks
 * Internal helper used by the renderer and `Signal.suspend` to start a fresh dependency pass.
 *
 * @since 1.0.0
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
 *
 * @remarks
 * Internal helper that preserves signal identity while clearing per-render access tracking.
 *
 * @since 1.0.0
 * @internal
 */
export const resetRenderPhase = Effect.fn("Signal.resetRenderPhase")(function* (
  phase: RenderPhase,
) {
  yield* Ref.set(phase.signalIndex, 0);
  phase.accessed.clear();
});

const traceSignalCreate = <A>(signal: Signal<A>, value: unknown): Effect.Effect<void> =>
  ContractTrace.emit({
    event: "signal.create",
    level: "semantic",
    payload: {
      signal_id: signal._debugId,
      owner: signal._owner,
      value,
    },
  });

const disposeSignal = <A>(signal: Signal<A>): Effect.Effect<void> =>
  Effect.gen(function* () {
    const wasDisposed = yield* Ref.getAndSet(signal._disposed, true);
    if (wasDisposed) return;

    const listenerCount = signal._listeners.size;
    signal._listeners.clear();

    yield* Debug.log({
      event: "signal.dispose",
      signal_id: signal._debugId,
      owner: signal._owner,
      listener_count: listenerCount,
    });
    yield* ContractTrace.emit({
      event: "signal.dispose",
      level: "semantic",
      payload: {
        signal_id: signal._debugId,
        owner: signal._owner,
      },
    });
  });

const makeOwnedSignal = <A>(
  initial: A,
  owner: SignalOwner,
  ownerScope: Scope.Scope,
  component: string,
): Effect.Effect<Signal<A>> =>
  Effect.gen(function* () {
    const ref = yield* SubscriptionRef.make(initial);
    const disposed = yield* Ref.make(false);
    const debugId = Debug.nextSignalId();
    const signal: Signal<A> = {
      _tag: "Signal",
      _ref: ref,
      _listeners: new Set(),
      _debugId: debugId,
      _owner: owner,
      _disposed: disposed,
    };

    yield* Scope.addFinalizer(ownerScope, disposeSignal(signal));
    yield* Debug.log({
      event: "signal.create",
      signal_id: debugId,
      value: initial,
      component,
      owner,
    });
    yield* traceSignalCreate(signal, initial);
    return signal;
  });

const isSignalDisposedCause = (cause: Cause.Cause<unknown>): boolean => {
  const defect = Cause.findDefect(cause);
  return Result.isSuccess(defect) && defect.success instanceof SignalDisposedError;
};

const ignoreSignalDisposedCause = <A, E, R>(
  effect: Effect.Effect<A, E, R>,
): Effect.Effect<A | void, E, R> =>
  Effect.catchCause(effect, (cause) =>
    isSignalDisposedCause(cause) ? Effect.void : Effect.failCause(cause),
  );

const ensureSignalOpen = <A>(
  signal: Signal<A>,
  operation: SignalDisposedOperation,
): Effect.Effect<void> =>
  Effect.gen(function* () {
    const disposed = yield* Ref.get(signal._disposed);
    if (!disposed) return;

    yield* Debug.log({
      event: "signal.disposed_access",
      signal_id: signal._debugId,
      owner: signal._owner,
      operation,
    });
    yield* ContractTrace.emit({
      event: "signal.disposed_access",
      level: "semantic",
      payload: {
        signal_id: signal._debugId,
        owner: signal._owner,
        operation,
      },
    });
    yield* Metrics.recordDisposedSignalAccess;
    return yield* Effect.die(new SignalDisposedError({ operation, signalId: signal._debugId }));
  });

const currentOwnerScope = Effect.gen(function* () {
  const componentScope = yield* CurrentComponentScope;
  if (componentScope !== null) {
    return { owner: "component" as const, scope: componentScope };
  }

  const scope = yield* Effect.serviceOption(Scope.Scope);
  if (scope._tag === "None") {
    return yield* new SignalScopeError({
      operation: "make",
      message:
        "Signal.make requires an owner scope. Create signals inside Component.gen, a lifecycle-provided Layer.effect, or an explicitly scoped Effect.",
    });
  }

  const owner = yield* CurrentSignalOwner;
  return { owner, scope: scope.value };
});

const valuesEqual = (left: unknown, right: unknown): boolean => {
  try {
    return Equal.equals(left, right);
  } catch {
    return Object.is(left, right);
  }
};

const valueHash = (value: unknown): number => {
  try {
    return Hash.hash(value);
  } catch {
    return Hash.hash(String(value));
  }
};

/**
 * Create a new Signal with an initial value.
 *
 * When called inside a component (during render phase), signals are
 * tracked by position for identity across re-renders (like React hooks).
 *
 * @remarks
 * Use `Signal.make` for component-local state. Outside a render phase it creates
 * a standalone signal in the current Effect scope.
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
 * @category Reactivity
 * @public
 * @since 1.0.0
 */
export const make: <A>(initial: A) => Effect.Effect<Signal<A>, SignalScopeError> = Effect.fn(
  "Signal.make",
)(function* <A>(initial: A) {
  const phase = yield* CurrentRenderPhase;
  const ownerScope = yield* currentOwnerScope;

  if (phase === null) {
    return yield* makeOwnedSignal(initial, ownerScope.owner, ownerScope.scope, "standalone");
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
      owner: signal._owner,
    });
  } else {
    // First render - create new signal owned by the component scope.
    signal = yield* makeOwnedSignal(initial, ownerScope.owner, ownerScope.scope, "new");
    yield* Ref.update(phase.signals, (arr) => [...arr, signal]);
  }

  // Note: We do NOT add to phase.accessed here.
  // Only Signal.get() adds to accessed, enabling fine-grained reactivity:
  // - If you read a signal (Signal.get), the component re-renders when it changes
  // - If you just pass the signal to JSX, you get fine-grained DOM updates

  return signal;
});

/**
 * Get the current value of a signal.
 *
 * IMPORTANT: Reading a signal with Signal.get() subscribes the current
 * component to that signal. When the signal changes, the component re-renders.
 *
 * For fine-grained reactivity (no re-render), pass signals directly to JSX
 * children or props instead of reading them.
 *
 * @remarks
 * `Signal.get` is the opt-in bridge from fine-grained updates to component re-renders.
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
 * @category Reactivity
 * @public
 * @since 1.0.0
 */
export const get: <A>(signal: Signal<A>) => Effect.Effect<A> = Effect.fn("Signal.get")(function* <
  A,
>(signal: Signal<A>) {
  yield* ensureSignalOpen(signal, "get");
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
 * Peek at the current value of a signal without subscribing the current render.
 *
 * @remarks
 * `Signal.peek` is for imperative snapshots in event handlers, services,
 * middleware, and framework internals that manage their own subscriptions. In a
 * component body, prefer `Signal.get` when the component must re-run after the
 * signal changes, or pass the signal directly to JSX for fine-grained DOM
 * updates.
 *
 * @example
 * ```tsx
 * const onSubmit = () =>
 *   Effect.gen(function* () {
 *     const currentEmail = yield* Signal.peek(email)
 *     yield* submit(currentEmail)
 *   })
 * ```
 *
 * @category Reactivity
 * @public
 * @since 1.0.0
 */
export const peek: <A>(signal: Signal<A>) => Effect.Effect<A> = Effect.fn("Signal.peek")(function* <
  A,
>(signal: Signal<A>) {
  yield* ensureSignalOpen(signal, "peek");
  yield* Debug.log({
    event: "signal.peek",
    signal_id: signal._debugId,
  });
  return yield* SubscriptionRef.get(signal._ref);
});

/**
 * Set the value of a signal and notify listeners.
 *
 * @remarks
 * Updates are equality-checked first. Setting the same value is a no-op and does
 * not trigger listeners or re-renders.
 *
 * @example
 * ```tsx
 * yield* Signal.set(count, 5)
 * ```
 *
 * @category Reactivity
 * @public
 * @since 1.0.0
 */
export const set: <A>(signal: Signal<A>, value: A) => Effect.Effect<void> = Effect.fn("Signal.set")(
  function* <A>(signal: Signal<A>, value: A) {
    yield* ensureSignalOpen(signal, "set");
    const prevValue = yield* SubscriptionRef.get(signal._ref);

    // Skip update if value is unchanged (prevents unnecessary re-renders)
    if (valuesEqual(prevValue, value)) {
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
 * @remarks
 * Prefer this when the next value depends on the current one.
 *
 * @example
 * ```tsx
 * yield* Signal.update(count, n => n + 1)
 * ```
 *
 * @category Reactivity
 * @public
 * @since 1.0.0
 */
export const update: <A>(signal: Signal<A>, f: (a: A) => A) => Effect.Effect<void> = Effect.fn(
  "Signal.update",
)(function* <A>(signal: Signal<A>, f: (a: A) => A) {
  yield* ensureSignalOpen(signal, "update");
  const prevValue = yield* SubscriptionRef.get(signal._ref);
  const newValue = f(prevValue);

  // Skip update if value is unchanged (prevents unnecessary re-renders)
  if (valuesEqual(prevValue, newValue)) {
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
 * @remarks
 * Use this when one atomic read-modify-write step should also return a derived result.
 *
 * @example
 * ```tsx
 * const oldValue = yield* Signal.modify(count, n => [n, n + 1])
 * ```
 *
 * @category Reactivity
 * @public
 * @since 1.0.0
 */
export const modify = <A, B>(signal: Signal<A>, f: (a: A) => readonly [B, A]): Effect.Effect<B> =>
  ensureSignalOpen(signal, "modify").pipe(
    Effect.flatMap(() => SubscriptionRef.modify(signal._ref, f)),
    Effect.tap(() => notifyListeners(signal)),
  );

/**
 * Options for Signal.derive
 *
 * @remarks
 * Pass an explicit scope when the derived signal should outlive the current render scope.
 *
 * @example
 * ```tsx
 * const scope = yield* Scope.make()
 * const doubled = yield* Signal.derive(count, (n) => n * 2, { scope })
 * ```
 *
 * @category Reactivity
 * @public
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
 * @remarks
 * Derived signals let you keep fine-grained updates while moving computation out of JSX.
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
 * @category Reactivity
 * @public
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
    const componentScope = yield* CurrentComponentScope;
    const currentOwner = yield* CurrentSignalOwner;
    const owner = componentScope === null ? currentOwner : "component";

    const initial = yield* peek(source);
    const derivedSignal = yield* makeOwnedSignal(f(initial), owner, scope, "derived");

    yield* Debug.log({
      event: "signal.derive.create",
      signal_id: derivedSignal._debugId,
      source_id: source._debugId,
      value: f(initial),
    });

    // Subscribe to source changes with Effect-based listener
    const unsubscribe = yield* subscribe(source, () =>
      Effect.gen(function* () {
        const current = yield* peek(source);
        yield* set(derivedSignal, f(current));
      }),
    );

    // Register cleanup on scope finalization
    yield* Scope.addFinalizer(
      scope,
      Effect.gen(function* () {
        yield* unsubscribe;
        yield* Debug.log({
          event: "signal.derive.cleanup",
          signal_id: derivedSignal._debugId,
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
 * @remarks
 * Use `deriveAll` when one reactive value depends on multiple upstream signals.
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
 * @category Reactivity
 * @public
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
    const componentScope = yield* CurrentComponentScope;
    const currentOwner = yield* CurrentSignalOwner;
    const owner = componentScope === null ? currentOwner : "component";

    // Read initial values from all sources
    const readAll = () => Effect.forEach(sources, (source) => peek(source));

    const initialValues = yield* readAll();
    const initial = f(...initialValues);

    const derivedSignal = yield* makeOwnedSignal(initial, owner, scope, "derivedAll");

    yield* Debug.log({
      event: "signal.deriveAll.create",
      signal_id: derivedSignal._debugId,
      source_count: sources.length,
      value: initial,
    });

    // Recompute: read all sources, apply f, update derived if changed
    const recompute = Effect.gen(function* () {
      const values = yield* readAll();
      const newValue = f(...values);
      const prevValue = yield* peek(derivedSignal);
      if (!valuesEqual(prevValue, newValue)) {
        yield* set(derivedSignal, newValue);
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
          signal_id: derivedSignal._debugId,
          source_count: sources.length,
        });
      }),
    );

    return derivedSignal;
  }).pipe(Effect.withSpan("Signal.deriveAll"));
}

/**
 * Check if a value is a Signal.
 *
 * @remarks
 * Useful at API boundaries that accept either plain values or signals.
 *
 * @example
 * ```ts
 * const value: unknown = maybeSignal
 * if (Signal.isSignal(value)) {
 *   return yield* Signal.peek(value)
 * }
 * ```
 *
 * @category Reactivity
 * @public
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
 *
 * @remarks
 * Most component code should prefer direct JSX usage or `Signal.get`. Reach for
 * `subscribe` when bridging signals into lower-level reactive machinery.
 *
 * @example
 * ```tsx
 * const unsubscribe = yield* Signal.subscribe(count, () => Effect.log("changed"))
 * yield* unsubscribe
 * ```
 *
 * @category Reactivity
 * @public
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
 *
 * @remarks
 * Internal alias for the suspend implementation.
 * @internal
 */
type SuspendElement = import("./element.js").Element;

type SuspendState = "Pending" | "Failure";

type PendingComponentHandler<R> = Component.Type<{ stale: SuspendElement | null }, unknown, R>;

type PendingRenderFunction = ((stale: SuspendElement | null) => SuspendElement) & {
  readonly _tag?: never;
};

type PendingRenderHandler = SuspendElement | PendingRenderFunction;

type PendingHandler<R> = PendingComponentHandler<R> | PendingRenderHandler;

type FailureComponentHandler<R> = Component.Type<
  { cause: Cause.Cause<unknown>; stale: SuspendElement | null },
  unknown,
  R
>;

type FailureRenderHandler = ((
  cause: Cause.Cause<unknown>,
  stale: SuspendElement | null,
) => SuspendElement) & {
  readonly _tag?: never;
};

type FailureHandler<R> = FailureComponentHandler<R> | FailureRenderHandler;
type SuspendHandler = PendingHandler<unknown> | FailureHandler<unknown>;

type HandlerRequirements<State extends SuspendState, Handler> = State extends "Pending"
  ? Handler extends PendingComponentHandler<infer RHandler>
    ? RHandler
    : never
  : Handler extends FailureComponentHandler<infer RHandler>
    ? RHandler
    : never;

type ValidHandler<State extends SuspendState, Handler> = State extends "Pending"
  ? Handler extends PendingHandler<unknown>
    ? Handler
    : never
  : Handler extends FailureHandler<unknown>
    ? Handler
    : never;

/**
 * Suspended component preserving `Props`, `E`, `R` and exposing the internal
 * signal for tests/debugging.
 *
 * @remarks
 * Produced by `Signal.suspend(...).pipe(..., Signal.exhaustive)`. It behaves like
 * the wrapped component while exposing the rendered signal for advanced tooling.
 *
 * @example
 * ```tsx
 * const SuspendedProfile = yield* Signal
 *   .suspend(UserProfile)
 *   .pipe(Signal.on("Pending", Spinner), Signal.on("Failure", ErrorView), Signal.exhaustive)
 * ```
 *
 * @category Reactivity
 * @public
 * @since 1.0.0
 */
export interface SuspendedComponent<Props = never, E = never, R = never> extends Component.Type<
  Props,
  E,
  R
> {
  readonly _signal: Signal<SuspendElement>;
}

/**
 * Pipeable matcher for `Signal.suspend`.
 *
 * `E` is the wrapped component error type. This remains on the returned
 * component type and documents failures from the wrapped component itself.
 * The `Failure` branch is for the suspend lifecycle fallback UI.
 *
 * @remarks
 * Build this matcher with `Signal.suspend`, then register handlers with `Signal.on`.
 *
 * @example
 * ```tsx
 * const matcher = Signal.suspend(UserProfile)
 * ```
 *
 * @category Reactivity
 * @public
 * @since 1.0.0
 */
export interface SuspendMatcher<
  Props,
  E,
  R,
  HasPending extends boolean,
  HasFailure extends boolean,
> extends ReactiveMatcher.ReactiveMatcher<
  "SuspendMatcher",
  Component.Type<Props, E, R>,
  ReadonlyMap<SuspendState, SuspendHandler>
> {
  readonly _tag: "SuspendMatcher";
  readonly source: Component.Type<Props, E, R>;
  readonly component: Component.Type<Props, E, R>;
  readonly handlers: ReadonlyMap<SuspendState, SuspendHandler>;
  readonly pending?: PendingHandler<unknown>;
  readonly failure?: FailureHandler<unknown>;
  readonly _hasPending?: HasPending;
  readonly _hasFailure?: HasFailure;
}

const makeSuspendMatcher = <Props, E, R, HasPending extends boolean, HasFailure extends boolean>(
  component: Component.Type<Props, E, R>,
  pending?: PendingHandler<unknown>,
  failure?: FailureHandler<unknown>,
): SuspendMatcher<Props, E, R, HasPending, HasFailure> => {
  const handlers = new Map<SuspendState, SuspendHandler>();
  if (pending !== undefined) handlers.set("Pending", pending);
  if (failure !== undefined) handlers.set("Failure", failure);

  return {
    ...ReactiveMatcher.make("SuspendMatcher", component, handlers),
    source: component,
    component,
    ...(pending === undefined ? {} : { pending }),
    ...(failure === undefined ? {} : { failure }),
  };
};

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
  ({
    _tag: "Component",
    run,
    key: null,
    identity: undefined,
    inputs: undefined,
    provider: null,
  }) satisfies Extract<SuspendElement, { readonly _tag: "Component" }>;

const isEffectComponentLike = (
  value: unknown,
): value is Component.Type<unknown, unknown, unknown> =>
  typeof value === "function" && value !== null && Reflect.get(value, "_tag") === "EffectComponent";

const isPendingComponent = <R>(handler: PendingHandler<R>): handler is PendingComponentHandler<R> =>
  isEffectComponentLike(handler);

const isFailureComponent = <R>(handler: FailureHandler<R>): handler is FailureComponentHandler<R> =>
  isEffectComponentLike(handler);

const isPendingStateHandler = (
  state: SuspendState,
  _handler: PendingHandler<unknown> | FailureHandler<unknown>,
): _handler is PendingHandler<unknown> => state === "Pending";

const isFailureStateHandler = (
  state: SuspendState,
  _handler: PendingHandler<unknown> | FailureHandler<unknown>,
): _handler is FailureHandler<unknown> => state === "Failure";

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

/**
 * Start building a suspended component.
 *
 * @remarks
 * Use this when a component can re-run with async dependencies and should show
 * pending or failure fallbacks without leaving the signal-based rendering model.
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
 * @category Reactivity
 * @public
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
 * @remarks
 * `Signal.on` keeps suspend fallback wiring pipeable and typed until `Signal.exhaustive`.
 *
 * @example
 * ```tsx
 * const matcher = Signal.suspend(UserProfile).pipe(Signal.on("Pending", Spinner))
 * ```
 *
 * @category Reactivity
 * @public
 * @since 1.0.0
 */
export const on =
  <State extends SuspendState, Handler>(state: State, handler: ValidHandler<State, Handler>) =>
  <Props, E, R, HasPending extends boolean, HasFailure extends boolean>(
    self: SuspendMatcher<Props, E, R, HasPending, HasFailure>,
  ): SuspendMatcher<
    Props,
    E,
    R | HandlerRequirements<State, Handler>,
    State extends "Pending" ? true : HasPending,
    State extends "Failure" ? true : HasFailure
  > => {
    if (isPendingStateHandler(state, handler)) {
      return makeSuspendMatcher(self.component, handler, self.failure);
    }
    if (isFailureStateHandler(state, handler)) {
      return makeSuspendMatcher(self.component, self.pending, handler);
    }
    return makeSuspendMatcher(self.component, self.pending, self.failure);
  };

/**
 * Finalize the suspend matcher.
 *
 * The returned component preserves the wrapped component `Props`, `E`, and the
 * accumulated requirements from both the wrapped component and state handlers.
 *
 * @remarks
 * This is the step that turns a suspend matcher back into a component.
 *
 * @example
 * ```tsx
 * const SuspendedProfile = yield* Signal
 *   .suspend(UserProfile)
 *   .pipe(Signal.on("Pending", Spinner), Signal.on("Failure", ErrorView), Signal.exhaustive)
 * ```
 *
 * @category Reactivity
 * @public
 * @since 1.0.0
 */
export const exhaustive = <Props, E, R>(
  self: SuspendMatcher<Props, E, R, true, true>,
): Effect.Effect<SuspendedComponent<Props, E, R>, SignalScopeError> =>
  Effect.gen(function* () {
    const pending = self.pending;
    const failure = self.failure;

    if (pending === undefined || failure === undefined) {
      const unavailableSignal = yield* make(makeTextElement("Signal.suspend unavailable"));
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
          _signal: unavailableSignal,
          pipe() {
            return Pipeable.pipeArguments(this, arguments);
          },
        },
      );
    }

    const initialSignal = yield* make<SuspendElement>(renderPending(pending, null));

    const runFn = (props: PropsInput<Props>): Effect.Effect<Element, never, R> =>
      Effect.gen(function* () {
        const componentScope = yield* CurrentComponentScope;
        const scope = componentScope ?? (yield* Scope.make());
        const owner: SignalOwner = componentScope === null ? "effect" : "component";
        const cache = new Map<string, SuspendElement>();
        const viewSignal = yield* makeOwnedSignal(
          renderPending(pending, null),
          owner,
          scope,
          "suspend",
        );
        const renderPhase = yield* makeRenderPhase;

        let requestId = 0;
        let isRunning = false;
        let subscriptionCleanups: Array<Effect.Effect<void>> = [];

        const computeDepKey = (accessed: Set<AnySignal>): Effect.Effect<string> =>
          Effect.gen(function* () {
            if (accessed.size === 0) return "";
            const entries: Array<[string, number]> = [];
            for (const signal of accessed) {
              const value = yield* ignoreSignalDisposedCause(peek(signal));
              entries.push([signal._debugId, valueHash(value)]);
            }
            entries.sort((a, b) => a[0].localeCompare(b[0]));
            return entries.map(([id, valueHash]) => `${id}:${valueHash}`).join("|");
          });

        const cleanupSubscriptions = Effect.fn("Signal.suspend.cleanup")(function* () {
          const oldCleanups = subscriptionCleanups;
          subscriptionCleanups = [];
          for (const cleanup of oldCleanups) {
            yield* cleanup;
          }
        });

        const refreshRef = yield* Ref.make<Effect.Effect<void>>(Effect.void);

        const setView = (element: SuspendElement): Effect.Effect<void> =>
          ignoreSignalDisposedCause(set(viewSignal, element));

        const subscribeToSignals = Effect.fn("Signal.suspend.subscribe")(function* (
          signals: Set<AnySignal>,
        ) {
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
            const exit = yield* Effect.exit(
              Effect.provideService(
                unsafeRunComponent(self.component, props),
                CurrentRenderPhase,
                renderPhase,
              ).pipe(Effect.withSpan("Signal.suspend.render")),
            );

            const latestRequest = requestId;
            if (runId !== latestRequest) {
              yield* runRender(latestRequest);
              return;
            }

            const depKey = yield* computeDepKey(renderPhase.accessed);
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
          const peekDepKey = yield* computeDepKey(renderPhase.accessed);
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
        yield* ignoreSignalDisposedCause(set(initialSignal, makeSignalElement(viewSignal)));
        return makeSignalElement(viewSignal);
      });

    const suspendedComponent = (props: PropsInput<Props>): SuspendElement =>
      makeComponentElement(() => runFn(props));

    return unsafeTagCallable<SuspendedComponent<Props, E, R>>(suspendedComponent, {
      _tag: "EffectComponent",
      _layers: self.component._layers,
      _runFn: runFn,
      _signal: initialSignal,
      pipe() {
        return Pipeable.pipeArguments(this, arguments);
      },
    });
  });

/**
 * Key type for list items
 *
 * @remarks
 * Stable keys preserve per-item Effect scopes and nested signal identity across list updates.
 *
 * @example
 * ```ts
 * const key: Signal.ItemKey = "todo-1"
 * ```
 *
 * @category Reactivity
 * @public
 * @since 1.0.0
 */
export type ItemKey = string | number;

/**
 * Options for Signal.each
 *
 * @remarks
 * The `key` function should return a stable identifier for the logical item, not the current index.
 *
 * @example
 * ```tsx
 * const options: Signal.EachOptions<Todo> = { key: (todo) => todo.id }
 * ```
 *
 * @category Reactivity
 * @public
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
 *
 * @remarks
 * This keeps keyed list rendering ergonomic while still allowing scoped Effect work per item.
 *
 * @example
 * ```tsx
 * const renderTodo = (todo: Todo): Signal.EachRenderResult<never> => <li>{todo.text}</li>
 * ```
 *
 * @category Reactivity
 * @public
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
  unsafeMakeKeyedListElement(
    source,
    (item, index) => {
      const result = renderFn(item, index);
      return Effect.isEffect(result) ? result : Effect.succeed(result);
    },
    key,
  );

/**
 * Create a keyed list from a Signal of arrays.
 *
 * Each item in the array is rendered using the provided render function.
 * Items are identified by a key function - items with the same key maintain
 * their Effect scope across list updates, preserving nested signals.
 *
 * @remarks
 * Prefer `Signal.each` over `array.map(...)` when list items own signals, scopes,
 * or async work that must survive reordering.
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
 * @category Reactivity
 * @public
 * @since 1.0.0
 */
export const each: EachFn = (source, renderFn, options) => {
  return makeKeyedListElement(source, renderFn, options.key);
};
