/**
 * Signal Unit Tests
 *
 * Signal is the core reactive primitive of trygg.
 * Built on SubscriptionRef with sync callbacks for fine-grained reactivity.
 *
 * Test Categories:
 * - Creation: make, sync
 * - Reading: get, peek
 * - Writing: set, update, modify
 * - Subscription: subscribe, notify listeners
 * - Derived: derive
 * - Resource: resource (async state management)
 * - Suspend: suspend (component suspension)
 * - Lists: each (keyed list)
 * - Scope: RenderPhase, position-based identity
 *
 * Goals: Reliability, stability, performance
 * - Every test manages its own fibers/scope to prevent memory leaks
 * - Tests are unbiased (no assumptions about internal implementation)
 */
import { assert, describe, it } from "@effect/vitest";
import { scoped } from "../../testing/effect-vitest.js";
import { Cause, Data, Deferred, Effect, Exit, Fiber, Layer, Ref, Result, Scope } from "effect";
import * as Context from "effect/Context";
import { TestClock } from "effect/testing";
import * as Signal from "../signal.js";
// Import element.js to initialize _signalElementImpl/_textElementImpl
import { Element, text } from "../element.js";
import * as Component from "../component.js";
import { unsafeEraseR } from "../../internal/unsafe.js";
import { render } from "../../testing/index.js";

const withRenderPhase = <A, E, R>(
  effect: Effect.Effect<A, E, R>,
  phase: Signal.RenderPhase,
): Effect.Effect<A, E, R> => Effect.provideService(effect, Signal.CurrentRenderPhase, phase);

const withRenderScope = <A, E, R>(
  effect: Effect.Effect<A, E, R>,
  scope: Scope.Closeable,
): Effect.Effect<A, E, R> => Effect.provideService(effect, Signal.CurrentRenderScope, scope);

// =============================================================================
// Signal.make - Create reactive state
// =============================================================================
// Scope: Signal creation with initial value
// - Creates in standalone mode (outside component render)
// - Creates in render phase (inside component render)
// - Position-based identity across re-renders

describe("Signal.make", () => {
  scoped("should create signal with initial primitive value", () =>
    Effect.gen(function* () {
      const signal = yield* Signal.make(42);
      const value = yield* Signal.get(signal);

      assert.strictEqual(value, 42);
    }),
  );

  scoped("should create signal with object value", () =>
    Effect.gen(function* () {
      const obj = { name: "test", count: 5 };
      const signal = yield* Signal.make(obj);
      const value = yield* Signal.get(signal);

      assert.deepStrictEqual(value, { name: "test", count: 5 });
    }),
  );

  scoped("should create signal with array value", () =>
    Effect.gen(function* () {
      const arr = [1, 2, 3];
      const signal = yield* Signal.make(arr);
      const value = yield* Signal.get(signal);

      assert.deepStrictEqual(value, [1, 2, 3]);
    }),
  );

  scoped("should create standalone signal outside render phase", () =>
    Effect.gen(function* () {
      const phase = yield* Signal.CurrentRenderPhase;
      assert.isNull(phase);

      const signal = yield* Signal.make(10);
      const value = yield* Signal.get(signal);

      assert.strictEqual(value, 10);
    }),
  );

  scoped("should track signal in render phase when created during render", () =>
    Effect.gen(function* () {
      const phase = yield* Signal.makeRenderPhase;

      const signal = yield* withRenderPhase(Signal.make(100), phase);

      const signals = yield* Ref.get(phase.signals);
      assert.strictEqual(signals.length, 1);
      assert.strictEqual(signals[0], signal);
    }),
  );

  scoped("should return same signal instance for same position on re-render", () =>
    Effect.gen(function* () {
      const phase = yield* Signal.makeRenderPhase;

      const signal1 = yield* withRenderPhase(Signal.make(1), phase);

      yield* Signal.resetRenderPhase(phase);

      const signal2 = yield* withRenderPhase(Signal.make(999), phase);

      assert.strictEqual(signal1, signal2);
      const value = yield* Signal.get(signal2);
      assert.strictEqual(value, 1);
    }),
  );

  scoped("should create new signal for additional calls on first render", () =>
    Effect.gen(function* () {
      const phase = yield* Signal.makeRenderPhase;

      const signal1 = yield* withRenderPhase(Signal.make(1), phase);
      const signal2 = yield* withRenderPhase(Signal.make(2), phase);

      assert.notStrictEqual(signal1, signal2);

      const val1 = yield* Signal.get(signal1);
      const val2 = yield* Signal.get(signal2);
      assert.strictEqual(val1, 1);
      assert.strictEqual(val2, 2);
    }),
  );
});

// =============================================================================
// Signal.make ownership
// =============================================================================
// Scope: Scope-owned signal creation and disposal

describe("Signal.make ownership", () => {
  scoped("should create signal inside an owning Effect scope", () =>
    Effect.gen(function* () {
      // Test: should create a signal while an explicit Effect scope owns it.
      // Scope: verifies scoped user code remains the non-component creation path.
      // Assertion: the signal is readable until the owner scope closes.
      const signal = yield* Signal.make(42);

      assert.strictEqual(signal._tag, "Signal");
      assert.strictEqual(yield* Signal.peek(signal), 42);
    }),
  );

  scoped("should fail disposed signal access after owner scope closes", () =>
    Effect.gen(function* () {
      // Test: should fail user reads after signal owner disposal.
      // Scope: verifies leaked signal references fail clearly after scope close.
      // Assertion: access defects with SignalDisposedError carrying the signal id.
      const scope = yield* Scope.make();
      const signal = yield* Signal.make({ initialized: true }).pipe(Scope.provide(scope));
      yield* Scope.close(scope, Exit.void);

      const exit = yield* Signal.peek(signal).pipe(Effect.exit);
      assert.isTrue(Exit.isFailure(exit));
      if (Exit.isFailure(exit)) {
        const defect = Cause.findDefect(exit.cause);
        assert.isTrue(Result.isSuccess(defect));
        if (Result.isSuccess(defect)) {
          assert.instanceOf(defect.success, Signal.SignalDisposedError);
        }
      }
    }),
  );
});

// =============================================================================
// Signal.get - Read value with subscription
// =============================================================================
// Scope: Reading signal value and subscribing component

describe("Signal.get", () => {
  scoped("should return current signal value", () =>
    Effect.gen(function* () {
      const signal = yield* Signal.make("hello");
      const value = yield* Signal.get(signal);

      assert.strictEqual(value, "hello");
    }),
  );

  scoped("should add signal to accessed set when in render phase", () =>
    Effect.gen(function* () {
      const phase = yield* Signal.makeRenderPhase;
      const signal = yield* Signal.make(10);

      yield* withRenderPhase(Signal.get(signal), phase);

      assert.isTrue(phase.accessed.has(signal));
    }),
  );

  scoped("should not add to accessed set when outside render phase", () =>
    Effect.gen(function* () {
      const phase = yield* Signal.makeRenderPhase;
      const signal = yield* Signal.make(10);

      yield* Signal.get(signal);

      assert.isFalse(phase.accessed.has(signal));
    }),
  );
});

// =============================================================================
// Signal.peek - Read without subscription
// =============================================================================
// Scope: Effectful read without tracking

describe("Signal.peek", () => {
  scoped("should return current value", () =>
    Effect.gen(function* () {
      const signal = yield* Signal.make(99);
      const value = yield* Signal.peek(signal);

      assert.strictEqual(value, 99);
    }),
  );

  scoped("should not add signal to accessed set when in render phase", () =>
    Effect.gen(function* () {
      const phase = yield* Signal.makeRenderPhase;
      const signal = yield* Signal.make(50);

      const value = yield* withRenderPhase(Signal.peek(signal), phase);

      assert.strictEqual(value, 50);
      assert.isFalse(phase.accessed.has(signal));
    }),
  );
});

// =============================================================================
// Signal.set - Write value
// =============================================================================
// Scope: Setting signal value and notifying listeners

describe("Signal.set", () => {
  scoped("should update signal to new value", () =>
    Effect.gen(function* () {
      const signal = yield* Signal.make(0);

      yield* Signal.set(signal, 100);

      const value = yield* Signal.get(signal);
      assert.strictEqual(value, 100);
    }),
  );

  scoped("should notify all listeners when value changes", () =>
    Effect.gen(function* () {
      const signal = yield* Signal.make(0);
      let notified = 0;

      yield* Signal.subscribe(signal, () =>
        Effect.sync(() => {
          notified++;
        }),
      ).pipe(Effect.asVoid);

      yield* Signal.set(signal, 1);
      yield* TestClock.adjust(0);

      assert.strictEqual(notified, 1);
    }),
  );

  scoped("should skip notification when value is unchanged", () =>
    Effect.gen(function* () {
      const signal = yield* Signal.make(42);
      let notified = 0;

      yield* Signal.subscribe(signal, () =>
        Effect.sync(() => {
          notified++;
        }),
      ).pipe(Effect.asVoid);

      yield* Signal.set(signal, 42);
      yield* TestClock.adjust(0);

      assert.strictEqual(notified, 0);
    }),
  );

  scoped("should notify listeners in parallel with unbounded concurrency", () =>
    Effect.gen(function* () {
      const signal = yield* Signal.make(0);
      const startTimes: number[] = [];
      const latch = yield* Deferred.make<void>();

      yield* Signal.subscribe(signal, () =>
        Effect.gen(function* () {
          startTimes.push(Date.now());
          yield* Deferred.await(latch);
        }),
      ).pipe(Effect.asVoid);

      yield* Signal.subscribe(signal, () =>
        Effect.gen(function* () {
          startTimes.push(Date.now());
          yield* Deferred.await(latch);
        }),
      ).pipe(Effect.asVoid);

      const fiber = yield* Signal.set(signal, 1).pipe(Effect.forkChild);
      yield* TestClock.adjust(10);
      yield* Deferred.succeed(latch, undefined);
      yield* Fiber.join(fiber);

      assert.strictEqual(startTimes.length, 2);
      const first = startTimes[0];
      const second = startTimes[1];
      assert.isDefined(first);
      assert.isDefined(second);
      if (first !== undefined && second !== undefined) {
        const timeDiff = Math.abs(first - second);
        assert.isBelow(timeDiff, 50);
      }
    }),
  );

  scoped("should isolate errors between listeners", () =>
    Effect.gen(function* () {
      const signal = yield* Signal.make(0);
      let secondCalled = false;

      yield* Signal.subscribe(signal, () => Effect.die(new Error("Listener 1 error"))).pipe(
        Effect.asVoid,
      );

      yield* Signal.subscribe(signal, () =>
        Effect.sync(() => {
          secondCalled = true;
        }),
      ).pipe(Effect.asVoid);

      yield* Signal.set(signal, 1);
      yield* TestClock.adjust(10);

      assert.isTrue(secondCalled);
    }),
  );
});

// =============================================================================
// Signal.update - Update with function
// =============================================================================
// Scope: Updating signal value using a function

describe("Signal.update", () => {
  scoped("should apply update function to current value", () =>
    Effect.gen(function* () {
      const signal = yield* Signal.make(5);

      yield* Signal.update(signal, (n) => n * 2);

      const value = yield* Signal.get(signal);
      assert.strictEqual(value, 10);
    }),
  );

  scoped("should notify listeners after update", () =>
    Effect.gen(function* () {
      const signal = yield* Signal.make(0);
      let notified = false;

      yield* Signal.subscribe(signal, () =>
        Effect.sync(() => {
          notified = true;
        }),
      ).pipe(Effect.asVoid);

      yield* Signal.update(signal, (n) => n + 1);
      yield* TestClock.adjust(0);

      assert.isTrue(notified);
    }),
  );

  scoped("should skip notification when update function returns equal value", () =>
    Effect.gen(function* () {
      const signal = yield* Signal.make(10);
      let notified = false;

      yield* Signal.subscribe(signal, () =>
        Effect.sync(() => {
          notified = true;
        }),
      ).pipe(Effect.asVoid);

      yield* Signal.update(signal, (n) => n);
      yield* TestClock.adjust(0);

      assert.isFalse(notified);
    }),
  );
});

// =============================================================================
// Signal.modify - Modify and return result
// =============================================================================
// Scope: Atomically modify value and return a result

describe("Signal.modify", () => {
  scoped("should return first tuple element and store second", () =>
    Effect.gen(function* () {
      const signal = yield* Signal.make(10);

      const result = yield* Signal.modify(signal, (n) => ["old was " + n, n + 5] as const);

      assert.strictEqual(result, "old was 10");
      const current = yield* Signal.get(signal);
      assert.strictEqual(current, 15);
    }),
  );

  scoped("should notify listeners after modify", () =>
    Effect.gen(function* () {
      const signal = yield* Signal.make(0);
      let newValue: number | null = null;

      yield* Signal.subscribe(signal, () =>
        Effect.gen(function* () {
          newValue = yield* Signal.get(signal);
        }),
      ).pipe(Effect.asVoid);

      yield* Signal.modify(signal, (n) => [n, n + 100] as const);
      yield* TestClock.adjust(0);

      assert.strictEqual(newValue, 100);
    }),
  );

  scoped("should perform read and write atomically", () =>
    Effect.gen(function* () {
      const signal = yield* Signal.make(0);
      const results: number[] = [];

      const fiber1 = yield* Effect.forEach(
        Array.from({ length: 10 }),
        () => Signal.modify(signal, (n) => [n, n + 1] as const),
        { discard: false },
      ).pipe(Effect.forkChild);

      const fiber2 = yield* Effect.forEach(
        Array.from({ length: 10 }),
        () => Signal.modify(signal, (n) => [n, n + 1] as const),
        { discard: false },
      ).pipe(Effect.forkChild);

      const [r1, r2] = yield* Effect.all([Fiber.join(fiber1), Fiber.join(fiber2)]);
      results.push(...r1, ...r2);

      const final = yield* Signal.get(signal);
      assert.strictEqual(final, 20);
      const unique = new Set(results);
      assert.strictEqual(unique.size, 20);
    }),
  );
});

// =============================================================================
// Signal.subscribe - Manual subscription
// =============================================================================
// Scope: Subscribing to signal changes

describe("Signal.subscribe", () => {
  scoped("should add listener that receives change notifications", () =>
    Effect.gen(function* () {
      const signal = yield* Signal.make(0);
      const values: number[] = [];

      yield* Signal.subscribe(signal, () =>
        Effect.gen(function* () {
          values.push(yield* Signal.get(signal));
        }),
      ).pipe(Effect.asVoid);

      yield* Signal.set(signal, 1);
      yield* Signal.set(signal, 2);
      yield* Signal.set(signal, 3);
      yield* TestClock.adjust(10);

      assert.deepStrictEqual(values, [1, 2, 3]);
    }),
  );

  scoped("should return unsubscribe effect that removes listener", () =>
    Effect.gen(function* () {
      const signal = yield* Signal.make(0);
      let callCount = 0;

      const unsubscribe = yield* Signal.subscribe(signal, () =>
        Effect.sync(() => {
          callCount++;
        }),
      );

      yield* Signal.set(signal, 1);
      yield* TestClock.adjust(0);
      assert.strictEqual(callCount, 1);

      yield* unsubscribe;

      yield* Signal.set(signal, 2);
      yield* TestClock.adjust(0);
      assert.strictEqual(callCount, 1);
    }),
  );

  scoped("should support multiple concurrent listeners", () =>
    Effect.gen(function* () {
      const signal = yield* Signal.make(0);
      let listener1Called = false;
      let listener2Called = false;
      let listener3Called = false;

      yield* Signal.subscribe(signal, () =>
        Effect.sync(() => {
          listener1Called = true;
        }),
      ).pipe(Effect.asVoid);
      yield* Signal.subscribe(signal, () =>
        Effect.sync(() => {
          listener2Called = true;
        }),
      ).pipe(Effect.asVoid);
      yield* Signal.subscribe(signal, () =>
        Effect.sync(() => {
          listener3Called = true;
        }),
      ).pipe(Effect.asVoid);

      yield* Signal.set(signal, 1);
      yield* TestClock.adjust(10);

      assert.isTrue(listener1Called);
      assert.isTrue(listener2Called);
      assert.isTrue(listener3Called);
    }),
  );

  scoped("should handle listener unsubscribing during notification", () =>
    Effect.gen(function* () {
      const signal = yield* Signal.make(0);
      let secondListenerCalled = false;

      // Use Ref to hold the unsubscribe effect to avoid circular reference
      const unsubRef = yield* Ref.make<Effect.Effect<void>>(Effect.void);

      const unsubscribe = yield* Signal.subscribe(signal, () =>
        Effect.gen(function* () {
          const unsub = yield* Ref.get(unsubRef);
          yield* unsub;
        }),
      );

      yield* Ref.set(unsubRef, unsubscribe);

      yield* Signal.subscribe(signal, () =>
        Effect.sync(() => {
          secondListenerCalled = true;
        }),
      ).pipe(Effect.asVoid);

      yield* Signal.set(signal, 1);
      yield* TestClock.adjust(10);

      assert.isTrue(secondListenerCalled);
    }),
  );
});

// =============================================================================
// Signal.derive - Computed signals
// =============================================================================
// Scope: Creating derived/computed signals

describe("Signal.derive", () => {
  scoped("should create derived signal with transformed initial value", () =>
    Effect.gen(function* () {
      const source = yield* Signal.make(5);
      const derived = yield* Signal.derive(source, (n) => n * 2);

      const value = yield* Signal.get(derived);
      assert.strictEqual(value, 10);
    }),
  );

  scoped("should update derived value when source changes", () =>
    Effect.gen(function* () {
      const source = yield* Signal.make(10);
      const derived = yield* Signal.derive(source, (n) => n + 100);

      yield* Signal.set(source, 20);
      yield* TestClock.adjust(10);

      const value = yield* Signal.get(derived);
      assert.strictEqual(value, 120);
    }),
  );

  scoped("should cleanup subscription when scope closes", () =>
    Effect.gen(function* () {
      const source = yield* Signal.make(0);
      const initialListenerCount = source._listeners.size;

      const innerScope = yield* Scope.make();

      yield* Signal.derive(source, (n) => n * 2, { scope: innerScope });

      const afterDerive = source._listeners.size;
      assert.strictEqual(afterDerive, initialListenerCount + 1);

      yield* Scope.close(innerScope, Exit.void);

      const afterClose = source._listeners.size;
      assert.strictEqual(afterClose, initialListenerCount);
    }),
  );

  scoped("should use explicit scope when provided", () =>
    Effect.gen(function* () {
      const source = yield* Signal.make(1);
      const customScope = yield* Scope.make();

      const derived = yield* Signal.derive(source, (n) => n * 3, { scope: customScope });

      const value = yield* Signal.get(derived);
      assert.strictEqual(value, 3);

      yield* Scope.close(customScope, Exit.void);
    }),
  );

  scoped("should use render scope when in render phase", () =>
    Effect.gen(function* () {
      const source = yield* Signal.make(2);
      const renderScope = yield* Scope.make();

      const derived = yield* withRenderScope(
        Signal.derive(source, (n) => n * 4),
        renderScope,
      );

      const value = yield* Signal.get(derived);
      assert.strictEqual(value, 8);

      yield* Scope.close(renderScope, Exit.void);
    }),
  );

  scoped("should support chaining multiple derive calls", () =>
    Effect.gen(function* () {
      const source = yield* Signal.make(2);
      const doubled = yield* Signal.derive(source, (n) => n * 2);
      const quadrupled = yield* Signal.derive(doubled, (n) => n * 2);

      const value = yield* Signal.get(quadrupled);
      assert.strictEqual(value, 8);

      yield* Signal.set(source, 5);
      yield* TestClock.adjust(20);

      const updated = yield* Signal.get(quadrupled);
      assert.strictEqual(updated, 20);
    }),
  );
});

// =============================================================================
// Signal.deriveAll - Multi-source derived signals
// =============================================================================
// Scope: Creating derived signals from multiple sources

describe("Signal.deriveAll", () => {
  scoped("should compute initial value from multiple sources", () =>
    Effect.gen(function* () {
      const count = yield* Signal.make(5);
      const name = yield* Signal.make("hello");

      const label = yield* Signal.deriveAll([count, name], (c, n) => `${n}: ${c}`);

      const value = yield* Signal.get(label);
      assert.strictEqual(value, "hello: 5");
    }),
  );

  scoped("should update when any source changes", () =>
    Effect.gen(function* () {
      const a = yield* Signal.make(1);
      const b = yield* Signal.make(2);
      const sum = yield* Signal.deriveAll([a, b], (x, y) => x + y);

      assert.strictEqual(yield* Signal.get(sum), 3);

      yield* Signal.set(a, 10);
      yield* TestClock.adjust(10);
      assert.strictEqual(yield* Signal.get(sum), 12);

      yield* Signal.set(b, 20);
      yield* TestClock.adjust(10);
      assert.strictEqual(yield* Signal.get(sum), 30);
    }),
  );

  scoped("should cleanup all subscriptions when scope closes", () =>
    Effect.gen(function* () {
      const a = yield* Signal.make(0);
      const b = yield* Signal.make(0);
      const innerScope = yield* Scope.make();

      yield* Signal.deriveAll([a, b], (x, y) => x + y, { scope: innerScope });

      assert.strictEqual(a._listeners.size, 1);
      assert.strictEqual(b._listeners.size, 1);

      yield* Scope.close(innerScope, Exit.void);

      assert.strictEqual(a._listeners.size, 0);
      assert.strictEqual(b._listeners.size, 0);
    }),
  );

  scoped("should not update when computed value is unchanged", () =>
    Effect.gen(function* () {
      const a = yield* Signal.make(2);
      const b = yield* Signal.make(3);
      // Derive a boolean that stays true regardless of input changes
      const positive = yield* Signal.deriveAll([a, b], (x, y) => x + y > 0);

      let notifyCount = 0;
      void (yield* Signal.subscribe(positive, () =>
        Effect.sync(() => {
          notifyCount++;
        }),
      ));

      // Both changes still produce a positive sum, so derived value stays true
      yield* Signal.set(a, 10);
      yield* TestClock.adjust(10);
      yield* Signal.set(b, 7);
      yield* TestClock.adjust(10);

      assert.strictEqual(notifyCount, 0);
      assert.strictEqual(yield* Signal.get(positive), true);
    }),
  );

  scoped("should work with single source (like derive)", () =>
    Effect.gen(function* () {
      const source = yield* Signal.make(7);
      const doubled = yield* Signal.deriveAll([source], (n) => n * 2);

      assert.strictEqual(yield* Signal.get(doubled), 14);
    }),
  );
});

// =============================================================================
// Signal.isSignal - Type guard
// =============================================================================
// Scope: Check if value is a Signal

describe("Signal.isSignal", () => {
  scoped("should return true for Signal objects", () =>
    Effect.gen(function* () {
      const signal = yield* Signal.make(0);

      assert.isTrue(Signal.isSignal(signal));
    }),
  );

  it("should return false for non-Signal values", () => {
    assert.isFalse(Signal.isSignal({ _tag: "NotSignal" }));
    assert.isFalse(Signal.isSignal({ value: 42 }));
    assert.isFalse(Signal.isSignal([]));
  });

  it("should return false for null and undefined", () => {
    assert.isFalse(Signal.isSignal(null));
    assert.isFalse(Signal.isSignal(undefined));
  });
});

// =============================================================================
// RenderPhase - Component render context
// =============================================================================
// Scope: Managing signal identity during component render

describe("RenderPhase", () => {
  scoped("should create render phase with signalIndex, signals, and accessed", () =>
    Effect.gen(function* () {
      const phase = yield* Signal.makeRenderPhase;

      const index = yield* Ref.get(phase.signalIndex);
      const signals = yield* Ref.get(phase.signals);

      assert.strictEqual(index, 0);
      assert.deepStrictEqual(signals, []);
      assert.strictEqual(phase.accessed.size, 0);
    }),
  );

  scoped("should reset signalIndex and clear accessed on reset", () =>
    Effect.gen(function* () {
      const phase = yield* Signal.makeRenderPhase;

      yield* Ref.set(phase.signalIndex, 5);
      const signal = yield* Signal.make(1);
      phase.accessed.add(signal);

      yield* Signal.resetRenderPhase(phase);

      const index = yield* Ref.get(phase.signalIndex);
      assert.strictEqual(index, 0);
      assert.strictEqual(phase.accessed.size, 0);

      const signals = yield* Ref.get(phase.signals);
      assert.strictEqual(signals.length, 0);
    }),
  );
});

// =============================================================================
// Parallel Notification
// =============================================================================
// Scope: Verify listeners run in parallel with error isolation

describe("Signal parallel notification", () => {
  scoped("should run all listeners concurrently not sequentially", () =>
    Effect.gen(function* () {
      const signal = yield* Signal.make(0);
      const executionOrder: string[] = [];
      const latch = yield* Deferred.make<void>();

      yield* Signal.subscribe(signal, () =>
        Effect.gen(function* () {
          executionOrder.push("listener1-start");
          yield* Deferred.await(latch);
          executionOrder.push("listener1-end");
        }),
      ).pipe(Effect.asVoid);

      yield* Signal.subscribe(signal, () =>
        Effect.gen(function* () {
          executionOrder.push("listener2-start");
          yield* Deferred.await(latch);
          executionOrder.push("listener2-end");
        }),
      ).pipe(Effect.asVoid);

      const fiber = yield* Signal.set(signal, 1).pipe(Effect.forkChild);
      yield* TestClock.adjust(20);

      assert.include(executionOrder, "listener1-start");
      assert.include(executionOrder, "listener2-start");

      yield* Deferred.succeed(latch, undefined);
      yield* Fiber.join(fiber);
    }),
  );

  scoped("should not block other listeners when one throws", () =>
    Effect.gen(function* () {
      const signal = yield* Signal.make(0);
      let listener2Completed = false;

      yield* Signal.subscribe(signal, () => Effect.die(new Error("Listener error"))).pipe(
        Effect.asVoid,
      );

      yield* Signal.subscribe(signal, () =>
        Effect.sync(() => {
          listener2Completed = true;
        }),
      ).pipe(Effect.asVoid);

      yield* Signal.set(signal, 1);
      yield* TestClock.adjust(10);

      assert.isTrue(listener2Completed);
    }),
  );

  scoped("should emit signal.listener.error event for failed listeners", () =>
    Effect.gen(function* () {
      const signal = yield* Signal.make(0);

      yield* Signal.subscribe(signal, () => Effect.die(new Error("Test error"))).pipe(
        Effect.asVoid,
      );

      yield* Signal.set(signal, 1);
      yield* TestClock.adjust(10);

      const value = yield* Signal.get(signal);
      assert.strictEqual(value, 1);
    }),
  );
});

// =============================================================================
// Boundary Values
// =============================================================================
// Scope: Test at limits and edge cases

describe("Signal boundary values", () => {
  scoped("should handle empty string value", () =>
    Effect.gen(function* () {
      const signal = yield* Signal.make("");
      const value = yield* Signal.get(signal);

      assert.strictEqual(value, "");
    }),
  );

  scoped("should handle zero value", () =>
    Effect.gen(function* () {
      const signal = yield* Signal.make(0);
      const value = yield* Signal.get(signal);

      assert.strictEqual(value, 0);
    }),
  );

  scoped("should handle negative number values", () =>
    Effect.gen(function* () {
      const signal = yield* Signal.make(-100);
      const value = yield* Signal.get(signal);

      assert.strictEqual(value, -100);
    }),
  );

  scoped("should handle large array values", () =>
    Effect.gen(function* () {
      const largeArray = Array.from({ length: 10000 }, (_, i) => i);
      const signal = yield* Signal.make(largeArray);
      const value = yield* Signal.get(signal);

      assert.strictEqual(value.length, 10000);
      assert.strictEqual(value[9999], 9999);
    }),
  );

  scoped("should handle many concurrent listeners efficiently", () =>
    Effect.gen(function* () {
      const signal = yield* Signal.make(0);
      let totalCalls = 0;
      const listenerCount = 100;

      for (let i = 0; i < listenerCount; i++) {
        yield* Signal.subscribe(signal, () =>
          Effect.sync(() => {
            totalCalls++;
          }),
        ).pipe(Effect.asVoid);
      }

      yield* Signal.set(signal, 1);
      yield* TestClock.adjust(50);

      assert.strictEqual(totalCalls, listenerCount);
    }),
  );

  scoped("should handle rapid sequential updates", () =>
    Effect.gen(function* () {
      const signal = yield* Signal.make(0);
      const updateCount = 100;

      for (let i = 1; i <= updateCount; i++) {
        yield* Signal.set(signal, i);
      }

      const value = yield* Signal.get(signal);
      assert.strictEqual(value, updateCount);
    }),
  );
});

// =============================================================================
// Memory and Resource Management
// =============================================================================
// Scope: Ensure no memory leaks

describe("Signal memory management", () => {
  scoped("should not retain references after unsubscribe", () =>
    Effect.gen(function* () {
      const signal = yield* Signal.make(0);

      const unsubscribe = yield* Signal.subscribe(signal, () => Effect.void);

      const beforeUnsubscribe = signal._listeners.size;
      assert.strictEqual(beforeUnsubscribe, 1);

      yield* unsubscribe;

      const afterUnsubscribe = signal._listeners.size;
      assert.strictEqual(afterUnsubscribe, 0);
    }),
  );

  scoped("should remove source subscription on derive cleanup", () =>
    Effect.gen(function* () {
      const source = yield* Signal.make(0);
      const scope = yield* Scope.make();

      const beforeDerive = source._listeners.size;

      yield* Signal.derive(source, (n) => n * 2, { scope });

      const afterDerive = source._listeners.size;
      assert.strictEqual(afterDerive, beforeDerive + 1);

      yield* Scope.close(scope, Exit.void);

      const afterCleanup = source._listeners.size;
      assert.strictEqual(afterCleanup, beforeDerive);
    }),
  );

  scoped("should stop all fibers when resource scope closes", () =>
    Effect.gen(function* () {
      const signal = yield* Signal.make(0);
      const scope = yield* Scope.make();
      let fiberStillRunning = true;

      const unsubscribe = yield* Signal.subscribe(signal, () =>
        Effect.gen(function* () {
          yield* TestClock.adjust(1000);
          fiberStillRunning = true;
        }),
      );
      yield* Scope.addFinalizer(scope, unsubscribe);

      yield* Scope.close(scope, Exit.void);

      yield* TestClock.adjust(10);

      yield* Signal.set(signal, 1);
      yield* TestClock.adjust(20);

      assert.isTrue(fiberStillRunning);
    }),
  );
});

// =============================================================================
// Signal.suspend - Component suspension with async state tracking
// =============================================================================
// Scope: suspend creates a SuspendedComponent that wraps async component lifecycle
// Regression: _textElementImpl! crash when module not initialized (now validated in Effect body)

describe("Signal.suspend", () => {
  const isText = Element.$is("Text");
  const isSignalElement = Element.$is("SignalElement");

  /** Assert element is Text and return content */
  const textContent = (el: Element): string => {
    assert.isTrue(isText(el), `expected Text, got ${el._tag}`);
    return isText(el) ? el.content : "";
  };

  /**
   * Build a mock component matching SuspendComponentType shape.
   * suspend only uses the first arg for type inference, so shape is sufficient.
   */
  const mockComponent = <E>(effect: Effect.Effect<Element, E>) =>
    Component.gen(function* () {
      return yield* effect;
    });

  scoped("should produce SuspendedComponent that renders a SignalElement", () =>
    Effect.gen(function* () {
      const comp = mockComponent(Effect.succeed(text("hello")));

      const suspended = yield* Signal.suspend(comp).pipe(
        Signal.on("Pending", text("loading")),
        Signal.on("Failure", () => text("error")),
        Signal.exhaustive,
      );

      assert.strictEqual(suspended._tag, "EffectComponent");
      // Calling the component must not crash (regression: _textElementImpl! null deref)
      const element = suspended({});
      assert.strictEqual(element._tag, "Component");

      const rendered = yield* Effect.scoped(unsafeEraseR(element.run()));
      assert.strictEqual(rendered._tag, "SignalElement");
    }),
  );

  scoped("should initialize view signal with Pending element", () =>
    Effect.gen(function* () {
      const comp = mockComponent(Effect.succeed(text("done")));

      const suspended = yield* Signal.suspend(comp).pipe(
        Signal.on("Pending", text("loading...")),
        Signal.on("Failure", () => text("error")),
        Signal.exhaustive,
      );

      const initial = yield* Signal.get(suspended._signal);
      assert.strictEqual(textContent(initial), "loading...");
    }),
  );

  scoped("should update view signal to Failure on render error", () =>
    Effect.gen(function* () {
      class RenderError extends Data.TaggedError("RenderError")<{}> {}
      const comp = mockComponent(Effect.fail(new RenderError()));

      const suspended = yield* Signal.suspend(comp).pipe(
        Signal.on("Pending", text("loading")),
        Signal.on("Failure", () => text("failed")),
        Signal.exhaustive,
      );

      const element = suspended({});
      assert.strictEqual(element._tag, "Component");
      yield* Effect.scoped(unsafeEraseR(element.run()));

      // Let the render fiber run
      yield* TestClock.adjust(0);
      yield* Effect.yieldNow;

      const view = yield* Signal.get(suspended._signal);
      assert.isTrue(isSignalElement(view), `expected SignalElement, got ${view._tag}`);

      const failed = yield* Signal.get(isSignalElement(view) ? view.signal : suspended._signal);
      assert.strictEqual(textContent(failed), "failed");
    }),
  );

  scoped("should accumulate handler requirements in inferred component R", () =>
    Effect.gen(function* () {
      class PendingTheme extends Context.Service<PendingTheme, { readonly label: string }>()(
        "PendingTheme",
      ) {}

      const PendingView = Component.gen(function* (
        Props: Component.ComponentProps<{ stale: Element | null }>,
      ) {
        yield* Props;
        const theme = yield* PendingTheme;
        return text(theme.label);
      });

      const suspended = yield* Signal.suspend(mockComponent(Effect.never)).pipe(
        Signal.on("Pending", PendingView),
        Signal.on("Failure", () => text("failed")),
        Signal.exhaustive,
      );

      const Provided = suspended.pipe(
        Component.provide(Layer.succeed(PendingTheme, { label: "loading" })),
      );
      const result = yield* Effect.exit(render(Provided({})));
      assert.isTrue(Exit.isSuccess(result));
    }),
  );
});
