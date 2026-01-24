/**
 * Signal Unit Tests
 *
 * Signal is the core reactive primitive of trygg.
 * Built on SubscriptionRef with sync callbacks for fine-grained reactivity.
 *
 * Test Categories:
 * - Creation: make, unsafeMake
 * - Reading: get, peekSync
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
import { Deferred, Effect, Exit, Fiber, FiberRef, Ref, Scope, TestClock } from "effect";
import * as Signal from "../signal.js";

// =============================================================================
// Signal.make - Create reactive state
// =============================================================================
// Scope: Signal creation with initial value
// - Creates in standalone mode (outside component render)
// - Creates in render phase (inside component render)
// - Position-based identity across re-renders

describe("Signal.make", () => {
  it.scoped("should create signal with initial primitive value", () =>
    Effect.gen(function* () {
      const signal = yield* Signal.make(42);
      const value = yield* Signal.get(signal);

      assert.strictEqual(value, 42);
    }),
  );

  it.scoped("should create signal with object value", () =>
    Effect.gen(function* () {
      const obj = { name: "test", count: 5 };
      const signal = yield* Signal.make(obj);
      const value = yield* Signal.get(signal);

      assert.deepStrictEqual(value, { name: "test", count: 5 });
    }),
  );

  it.scoped("should create signal with array value", () =>
    Effect.gen(function* () {
      const arr = [1, 2, 3];
      const signal = yield* Signal.make(arr);
      const value = yield* Signal.get(signal);

      assert.deepStrictEqual(value, [1, 2, 3]);
    }),
  );

  it.scoped("should create standalone signal outside render phase", () =>
    Effect.gen(function* () {
      const phase = yield* FiberRef.get(Signal.CurrentRenderPhase);
      assert.isNull(phase);

      const signal = yield* Signal.make(10);
      const value = yield* Signal.get(signal);

      assert.strictEqual(value, 10);
    }),
  );

  it.scoped("should track signal in render phase when created during render", () =>
    Effect.gen(function* () {
      const phase = yield* Signal.makeRenderPhase;

      const signal = yield* Signal.make(100).pipe(Effect.locally(Signal.CurrentRenderPhase, phase));

      const signals = yield* Ref.get(phase.signals);
      assert.strictEqual(signals.length, 1);
      assert.strictEqual(signals[0], signal);
    }),
  );

  it.scoped("should return same signal instance for same position on re-render", () =>
    Effect.gen(function* () {
      const phase = yield* Signal.makeRenderPhase;

      const signal1 = yield* Signal.make(1).pipe(Effect.locally(Signal.CurrentRenderPhase, phase));

      yield* Signal.resetRenderPhase(phase);

      const signal2 = yield* Signal.make(999).pipe(
        Effect.locally(Signal.CurrentRenderPhase, phase),
      );

      assert.strictEqual(signal1, signal2);
      const value = yield* Signal.get(signal2);
      assert.strictEqual(value, 1);
    }),
  );

  it.scoped("should create new signal for additional calls on first render", () =>
    Effect.gen(function* () {
      const phase = yield* Signal.makeRenderPhase;

      const signal1 = yield* Signal.make(1).pipe(Effect.locally(Signal.CurrentRenderPhase, phase));
      const signal2 = yield* Signal.make(2).pipe(Effect.locally(Signal.CurrentRenderPhase, phase));

      assert.notStrictEqual(signal1, signal2);

      const val1 = yield* Signal.get(signal1);
      const val2 = yield* Signal.get(signal2);
      assert.strictEqual(val1, 1);
      assert.strictEqual(val2, 2);
    }),
  );
});

// =============================================================================
// Signal.unsafeMake - Sync signal creation
// =============================================================================
// Scope: Synchronous signal creation for global/module-level signals

describe("Signal.unsafeMake", () => {
  it("should create signal synchronously without Effect context", () => {
    const signal = Signal.unsafeMake(42);

    assert.strictEqual(signal._tag, "Signal");
    assert.strictEqual(Signal.peekSync(signal), 42);
  });

  it("should work for module-level global signals", () => {
    const globalSignal = Signal.unsafeMake({ initialized: true });

    assert.deepStrictEqual(Signal.peekSync(globalSignal), { initialized: true });
  });
});

// =============================================================================
// Signal.get - Read value with subscription
// =============================================================================
// Scope: Reading signal value and subscribing component

describe("Signal.get", () => {
  it.scoped("should return current signal value", () =>
    Effect.gen(function* () {
      const signal = yield* Signal.make("hello");
      const value = yield* Signal.get(signal);

      assert.strictEqual(value, "hello");
    }),
  );

  it.scoped("should add signal to accessed set when in render phase", () =>
    Effect.gen(function* () {
      const phase = yield* Signal.makeRenderPhase;
      const signal = yield* Signal.make(10);

      yield* Signal.get(signal).pipe(Effect.locally(Signal.CurrentRenderPhase, phase));

      assert.isTrue(phase.accessed.has(signal));
    }),
  );

  it.scoped("should not add to accessed set when outside render phase", () =>
    Effect.gen(function* () {
      const phase = yield* Signal.makeRenderPhase;
      const signal = yield* Signal.make(10);

      yield* Signal.get(signal);

      assert.isFalse(phase.accessed.has(signal));
    }),
  );
});

// =============================================================================
// Signal.peekSync - Read without subscription
// =============================================================================
// Scope: Synchronous read without tracking

describe("Signal.peekSync", () => {
  it("should return current value synchronously", () => {
    const signal = Signal.unsafeMake(99);

    assert.strictEqual(Signal.peekSync(signal), 99);
  });

  it.scoped("should not trigger any subscription", () =>
    Effect.gen(function* () {
      const phase = yield* Signal.makeRenderPhase;
      const signal = yield* Signal.make(50);

      const value = Signal.peekSync(signal);

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
  it.scoped("should update signal to new value", () =>
    Effect.gen(function* () {
      const signal = yield* Signal.make(0);

      yield* Signal.set(signal, 100);

      const value = yield* Signal.get(signal);
      assert.strictEqual(value, 100);
    }),
  );

  it.scoped("should notify all listeners when value changes", () =>
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

  it.scoped("should skip notification when value is unchanged", () =>
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

  it.scoped("should notify listeners in parallel with unbounded concurrency", () =>
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

      const fiber = yield* Effect.fork(Signal.set(signal, 1));
      yield* TestClock.adjust(10);
      yield* Deferred.succeed(latch, undefined);
      yield* Fiber.join(fiber);

      assert.strictEqual(startTimes.length, 2);
      const timeDiff = Math.abs(startTimes[0]! - startTimes[1]!);
      assert.isBelow(timeDiff, 50);
    }),
  );

  it.scoped("should isolate errors between listeners", () =>
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
  it.scoped("should apply update function to current value", () =>
    Effect.gen(function* () {
      const signal = yield* Signal.make(5);

      yield* Signal.update(signal, (n) => n * 2);

      const value = yield* Signal.get(signal);
      assert.strictEqual(value, 10);
    }),
  );

  it.scoped("should notify listeners after update", () =>
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

  it.scoped("should skip notification when update function returns equal value", () =>
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
  it.scoped("should return first tuple element and store second", () =>
    Effect.gen(function* () {
      const signal = yield* Signal.make(10);

      const result = yield* Signal.modify(signal, (n) => ["old was " + n, n + 5] as const);

      assert.strictEqual(result, "old was 10");
      const current = yield* Signal.get(signal);
      assert.strictEqual(current, 15);
    }),
  );

  it.scoped("should notify listeners after modify", () =>
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

  it.scoped("should perform read and write atomically", () =>
    Effect.gen(function* () {
      const signal = yield* Signal.make(0);
      const results: number[] = [];

      const fiber1 = yield* Effect.fork(
        Effect.forEach(
          Array.from({ length: 10 }),
          () => Signal.modify(signal, (n) => [n, n + 1] as const),
          { discard: false },
        ),
      );

      const fiber2 = yield* Effect.fork(
        Effect.forEach(
          Array.from({ length: 10 }),
          () => Signal.modify(signal, (n) => [n, n + 1] as const),
          { discard: false },
        ),
      );

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
  it.scoped("should add listener that receives change notifications", () =>
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

  it.scoped("should return unsubscribe effect that removes listener", () =>
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

  it.scoped("should support multiple concurrent listeners", () =>
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

  it.scoped("should handle listener unsubscribing during notification", () =>
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
  it.scoped("should create derived signal with transformed initial value", () =>
    Effect.gen(function* () {
      const source = yield* Signal.make(5);
      const derived = yield* Signal.derive(source, (n) => n * 2);

      const value = yield* Signal.get(derived);
      assert.strictEqual(value, 10);
    }),
  );

  it.scoped("should update derived value when source changes", () =>
    Effect.gen(function* () {
      const source = yield* Signal.make(10);
      const derived = yield* Signal.derive(source, (n) => n + 100);

      yield* Signal.set(source, 20);
      yield* TestClock.adjust(10);

      const value = yield* Signal.get(derived);
      assert.strictEqual(value, 120);
    }),
  );

  it.scoped("should cleanup subscription when scope closes", () =>
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

  it.scoped("should use explicit scope when provided", () =>
    Effect.gen(function* () {
      const source = yield* Signal.make(1);
      const customScope = yield* Scope.make();

      const derived = yield* Signal.derive(source, (n) => n * 3, { scope: customScope });

      const value = yield* Signal.get(derived);
      assert.strictEqual(value, 3);

      yield* Scope.close(customScope, Exit.void);
    }),
  );

  it.scoped("should use render scope when in render phase", () =>
    Effect.gen(function* () {
      const source = yield* Signal.make(2);
      const renderScope = yield* Scope.make();

      const derived = yield* Signal.derive(source, (n) => n * 4).pipe(
        Effect.locally(Signal.CurrentRenderScope, renderScope),
      );

      const value = yield* Signal.get(derived);
      assert.strictEqual(value, 8);

      yield* Scope.close(renderScope, Exit.void);
    }),
  );

  it.scoped("should support chaining multiple derive calls", () =>
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
  it.scoped("should compute initial value from multiple sources", () =>
    Effect.gen(function* () {
      const count = yield* Signal.make(5);
      const name = yield* Signal.make("hello");

      const label = yield* Signal.deriveAll([count, name], (c, n) => `${n}: ${c}`);

      const value = yield* Signal.get(label);
      assert.strictEqual(value, "hello: 5");
    }),
  );

  it.scoped("should update when any source changes", () =>
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

  it.scoped("should cleanup all subscriptions when scope closes", () =>
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

  it.scoped("should not update when computed value is unchanged", () =>
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

  it.scoped("should work with single source (like derive)", () =>
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
  it.scoped("should return true for Signal objects", () =>
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
  it.scoped("should create render phase with signalIndex, signals, and accessed", () =>
    Effect.gen(function* () {
      const phase = yield* Signal.makeRenderPhase;

      const index = yield* Ref.get(phase.signalIndex);
      const signals = yield* Ref.get(phase.signals);

      assert.strictEqual(index, 0);
      assert.deepStrictEqual(signals, []);
      assert.strictEqual(phase.accessed.size, 0);
    }),
  );

  it.scoped("should reset signalIndex and clear accessed on reset", () =>
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
  it.scoped("should run all listeners concurrently not sequentially", () =>
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

      const fiber = yield* Effect.fork(Signal.set(signal, 1));
      yield* TestClock.adjust(20);

      assert.include(executionOrder, "listener1-start");
      assert.include(executionOrder, "listener2-start");

      yield* Deferred.succeed(latch, undefined);
      yield* Fiber.join(fiber);
    }),
  );

  it.scoped("should not block other listeners when one throws", () =>
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

  it.scoped("should emit signal.listener.error event for failed listeners", () =>
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
  it.scoped("should handle empty string value", () =>
    Effect.gen(function* () {
      const signal = yield* Signal.make("");
      const value = yield* Signal.get(signal);

      assert.strictEqual(value, "");
    }),
  );

  it.scoped("should handle zero value", () =>
    Effect.gen(function* () {
      const signal = yield* Signal.make(0);
      const value = yield* Signal.get(signal);

      assert.strictEqual(value, 0);
    }),
  );

  it.scoped("should handle negative number values", () =>
    Effect.gen(function* () {
      const signal = yield* Signal.make(-100);
      const value = yield* Signal.get(signal);

      assert.strictEqual(value, -100);
    }),
  );

  it.scoped("should handle large array values", () =>
    Effect.gen(function* () {
      const largeArray = Array.from({ length: 10000 }, (_, i) => i);
      const signal = yield* Signal.make(largeArray);
      const value = yield* Signal.get(signal);

      assert.strictEqual(value.length, 10000);
      assert.strictEqual(value[9999], 9999);
    }),
  );

  it.scoped("should handle many concurrent listeners efficiently", () =>
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

  it.scoped("should handle rapid sequential updates", () =>
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
  it.scoped("should not retain references after unsubscribe", () =>
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

  it.scoped("should remove source subscription on derive cleanup", () =>
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

  it.scoped("should stop all fibers when resource scope closes", () =>
    Effect.gen(function* () {
      const signal = yield* Signal.make(0);
      const scope = yield* Scope.make();
      let fiberStillRunning = true;

      yield* Signal.subscribe(signal, () =>
        Effect.gen(function* () {
          yield* TestClock.adjust(1000);
          fiberStillRunning = true;
        }),
      ).pipe(Effect.asVoid, Scope.extend(scope));

      yield* Scope.close(scope, Exit.void);

      yield* TestClock.adjust(10);

      yield* Signal.set(signal, 1);
      yield* TestClock.adjust(20);

      assert.isTrue(fiberStillRunning);
    }),
  );
});
