/**
 * Resource Unit Tests
 *
 * Resource provides cached, deduplicated data fetching with stale-while-revalidate.
 *
 * Test Categories:
 * - State constructors: Pending, Success, Failure
 * - Resource.make: Create resource descriptors
 * - Resource.fetch: Fetch with caching and dedupe
 * - Resource.invalidate: Stale-while-revalidate
 * - Resource.refresh: Hard reload
 * - Resource.clear: Remove from cache
 * - Deduplication: Concurrent fetch handling
 */
import { assert, describe, it } from "@effect/vitest";
import { Deferred, Effect, Option, Ref, TestClock } from "effect";
import * as Resource from "../resource.js";
import * as Signal from "../signal.js";

// =============================================================================
// ResourceState constructors
// =============================================================================

describe("ResourceState", () => {
  it("Pending should create Pending state", () => {
    const state = Resource.Pending<number, string>();

    assert.strictEqual(state._tag, "Pending");
    assert.isTrue(Resource.isPending(state));
    assert.isFalse(Resource.isSuccess(state));
    assert.isFalse(Resource.isFailure(state));
  });

  it("Success should create Success state with value", () => {
    const state = Resource.Success<number, string>(42, false);

    assert.strictEqual(state._tag, "Success");
    assert.isTrue(Resource.isSuccess(state));
    if (Resource.isSuccess(state)) {
      assert.strictEqual(state.value, 42);
      assert.strictEqual(state.stale, false);
    }
  });

  it("Success should create stale Success state", () => {
    const state = Resource.Success<number, string>(42, true);

    if (Resource.isSuccess(state)) {
      assert.strictEqual(state.value, 42);
      assert.strictEqual(state.stale, true);
    }
  });

  it("Failure should create Failure state with error", () => {
    const state = Resource.Failure<number, string>("error", Option.none());

    assert.strictEqual(state._tag, "Failure");
    assert.isTrue(Resource.isFailure(state));
    if (Resource.isFailure(state)) {
      assert.strictEqual(state.error, "error");
      assert.isTrue(Option.isNone(state.staleValue));
    }
  });

  it("Failure should include stale value when available", () => {
    const state = Resource.Failure<number, string>("error", Option.some(42));

    if (Resource.isFailure(state)) {
      assert.strictEqual(state.error, "error");
      assert.isTrue(Option.isSome(state.staleValue));
      if (Option.isSome(state.staleValue)) {
        assert.strictEqual(state.staleValue.value, 42);
      }
    }
  });
});

// =============================================================================
// Resource.make
// =============================================================================

describe("Resource.make", () => {
  it("should create resource with key and fetch effect", () => {
    const resource = Resource.make(() => Effect.succeed(42), { key: "test:123" });

    assert.strictEqual(resource._tag, "Resource");
    assert.strictEqual(resource.key, "test:123");
  });
});

// =============================================================================
// Resource.fetch - Initial fetch
// =============================================================================

describe("Resource.fetch", () => {
  it.scoped("should return Pending initially then Success after fetch completes", () =>
    Effect.gen(function* () {
      const resource = Resource.make(() => Effect.succeed({ name: "Alice" }), { key: "user:1" });

      const state = yield* Resource.fetch(resource);

      // Should start as Pending (fetch is forked)
      const initial = yield* Signal.get(state);
      assert.strictEqual(initial._tag, "Pending");

      // Advance clock to let forked fiber complete
      yield* TestClock.adjust(0);

      const final = yield* Signal.get(state);
      assert.strictEqual(final._tag, "Success");
      if (Resource.isSuccess(final)) {
        assert.deepStrictEqual(final.value, { name: "Alice" });
        assert.strictEqual(final.stale, false);
      }
    }).pipe(Effect.provide(Resource.ResourceRegistryLive)),
  );

  it.scoped("should return cached state on subsequent fetch", () =>
    Effect.gen(function* () {
      const fetchCount = yield* Ref.make(0);

      const resource = Resource.make(() => Ref.updateAndGet(fetchCount, (n) => n + 1), {
        key: "cached:1",
      });

      // First fetch
      const state1 = yield* Resource.fetch(resource);
      yield* TestClock.adjust(0);

      // Second fetch - should return same signal without re-fetching
      const state2 = yield* Resource.fetch(resource);

      // Should be same signal instance
      assert.strictEqual(state1, state2);

      // Fetch should have run only once
      const count = yield* Ref.get(fetchCount);
      assert.strictEqual(count, 1);
    }).pipe(Effect.provide(Resource.ResourceRegistryLive)),
  );
});

// =============================================================================
// Resource.fetch reactive — render phase isolation
// =============================================================================

describe("Resource.fetch reactive invalidate/refresh", () => {
  it.scoped("should reflect invalidate on reactive fetch output signal", () =>
    Effect.gen(function* () {
      const fetchCount = yield* Ref.make(0);
      const gate = yield* Deferred.make<void>();

      const factory = Resource.make(
        (params: { id: string }) =>
          Effect.gen(function* () {
            const n = yield* Ref.updateAndGet(fetchCount, (c) => c + 1);
            // Block refetch so we can observe intermediate stale state
            if (n > 1) yield* Deferred.await(gate);
            return `user-${params.id}-v${n}`;
          }),
        { key: (params) => `reactive-invalidate:${params.id}` },
      );

      const userId = yield* Signal.make("1");
      const state = yield* Resource.fetch(factory, { id: userId });
      yield* TestClock.adjust(0);

      // Verify initial fetch
      const first = yield* Signal.get(state);
      assert.strictEqual(first._tag, "Success");
      if (Resource.isSuccess(first)) {
        assert.strictEqual(first.value, "user-1-v1");
        assert.strictEqual(first.stale, false);
      }

      // Invalidate the resource — should mark stale and trigger refetch
      yield* Resource.invalidate(factory({ id: "1" }));
      yield* TestClock.adjust(0);

      // The reactive output signal should reflect the stale marking
      const stale = yield* Signal.get(state);
      assert.strictEqual(stale._tag, "Success");
      if (Resource.isSuccess(stale)) {
        assert.strictEqual(stale.stale, true);
      }

      // Complete the refetch
      yield* Deferred.succeed(gate, undefined);
      yield* TestClock.adjust(0);

      const refreshed = yield* Signal.get(state);
      assert.strictEqual(refreshed._tag, "Success");
      if (Resource.isSuccess(refreshed)) {
        assert.strictEqual(refreshed.value, "user-1-v2");
        assert.strictEqual(refreshed.stale, false);
      }
    }).pipe(Effect.provide(Resource.ResourceRegistryLive)),
  );

  it.scoped("should reflect refresh (pending transition) on reactive fetch output", () =>
    Effect.gen(function* () {
      const fetchCount = yield* Ref.make(0);
      const gate = yield* Deferred.make<void>();

      const factory = Resource.make(
        (params: { id: string }) =>
          Effect.gen(function* () {
            const n = yield* Ref.updateAndGet(fetchCount, (c) => c + 1);
            if (n > 1) yield* Deferred.await(gate);
            return `user-${params.id}-v${n}`;
          }),
        { key: (params) => `reactive-refresh:${params.id}` },
      );

      const userId = yield* Signal.make("1");
      const state = yield* Resource.fetch(factory, { id: userId });
      yield* TestClock.adjust(0);

      const first = yield* Signal.get(state);
      assert.strictEqual(first._tag, "Success");
      if (Resource.isSuccess(first)) {
        assert.strictEqual(first.value, "user-1-v1");
      }

      // Refresh — should transition to Pending
      yield* Resource.refresh(factory({ id: "1" }));
      yield* TestClock.adjust(0);

      const pending = yield* Signal.get(state);
      assert.strictEqual(pending._tag, "Pending");

      // Complete the refetch
      yield* Deferred.succeed(gate, undefined);
      yield* TestClock.adjust(0);

      const refreshed = yield* Signal.get(state);
      assert.strictEqual(refreshed._tag, "Success");
      if (Resource.isSuccess(refreshed)) {
        assert.strictEqual(refreshed.value, "user-1-v2");
      }
    }).pipe(Effect.provide(Resource.ResourceRegistryLive)),
  );
});

describe("Resource.fetch reactive render phase", () => {
  it.scoped("should not register param signals in component render phase accessed set", () =>
    Effect.gen(function* () {
      const factory = Resource.make(
        (params: { id: string }) => Effect.succeed(`user-${params.id}`),
        { key: (params) => `phase-isolation:${params.id}` },
      );

      const userId = yield* Signal.make("1");

      // Simulate component render phase
      const phase = yield* Signal.makeRenderPhase;

      yield* Resource.fetch(factory, { id: userId }).pipe(
        Effect.locally(Signal.CurrentRenderPhase, phase),
      );
      yield* TestClock.adjust(0);

      // userId should NOT be in the accessed set —
      // fetchReactive should not leak param signals as component dependencies
      assert.isFalse(
        phase.accessed.has(userId),
        "param signal should not be registered as a component dependency",
      );
    }).pipe(Effect.provide(Resource.ResourceRegistryLive)),
  );

  it.scoped("should re-fetch when params change even inside a render phase context", () =>
    Effect.gen(function* () {
      const fetchCount = yield* Ref.make(0);

      const factory = Resource.make(
        (params: { id: string }) =>
          Ref.updateAndGet(fetchCount, (n) => n + 1).pipe(Effect.map(() => `user-${params.id}`)),
        { key: (params) => `phase-refetch:${params.id}` },
      );

      const userId = yield* Signal.make("1");
      const phase = yield* Signal.makeRenderPhase;

      const state = yield* Resource.fetch(factory, { id: userId }).pipe(
        Effect.locally(Signal.CurrentRenderPhase, phase),
      );
      yield* TestClock.adjust(0);

      const first = yield* Signal.get(state);
      assert.strictEqual(first._tag, "Success");
      if (Resource.isSuccess(first)) {
        assert.strictEqual(first.value, "user-1");
      }

      // Change param — should trigger re-fetch via subscription, not re-render
      yield* Signal.set(userId, "2");
      yield* TestClock.adjust(0);

      const second = yield* Signal.get(state);
      assert.strictEqual(second._tag, "Success");
      if (Resource.isSuccess(second)) {
        assert.strictEqual(second.value, "user-2");
      }

      const count = yield* Ref.get(fetchCount);
      assert.strictEqual(count, 2);
    }).pipe(Effect.provide(Resource.ResourceRegistryLive)),
  );
});

// =============================================================================
// Resource.fetch static render phase isolation
// =============================================================================
// CRITICAL: Resource.fetch(resource) must NOT register the returned state signal
// as a component dependency. If it does, component re-renders on Pending→Success,
// causing keyed-list teardown/remount race that blanks rendered items.

describe("Resource.fetch static render phase isolation", () => {
  it.scoped("should NOT register state signal in component render phase accessed set", () =>
    Effect.gen(function* () {
      const resource = Resource.make(() => Effect.succeed("data"), {
        key: "phase-isolation:static:1",
      });

      // Simulate component render phase
      const phase = yield* Signal.makeRenderPhase;

      const state = yield* Resource.fetch(resource).pipe(
        Effect.locally(Signal.CurrentRenderPhase, phase),
      );
      yield* TestClock.adjust(0);

      // State signal should NOT be in the accessed set —
      // Resource.fetch should not leak state signal as component dependency
      assert.isFalse(
        phase.accessed.has(state),
        "state signal should not be registered as a component dependency",
      );
    }).pipe(Effect.provide(Resource.ResourceRegistryLive)),
  );

  it.scoped("should NOT register state signal even when checking cached state", () =>
    Effect.gen(function* () {
      const resource = Resource.make(() => Effect.succeed("cached-data"), {
        key: "phase-isolation:static:2",
      });

      // First fetch outside render phase — populates cache
      yield* Resource.fetch(resource);
      yield* TestClock.adjust(0);

      // Second fetch inside render phase — should hit cache but NOT track
      const phase = yield* Signal.makeRenderPhase;

      const state = yield* Resource.fetch(resource).pipe(
        Effect.locally(Signal.CurrentRenderPhase, phase),
      );

      // State signal should NOT be in the accessed set even for cached reads
      assert.isFalse(
        phase.accessed.has(state),
        "cached state signal should not be registered as a component dependency",
      );

      // Verify we got the cached data
      const result = yield* Signal.get(state);
      assert.strictEqual(result._tag, "Success");
      if (Resource.isSuccess(result)) {
        assert.strictEqual(result.value, "cached-data");
      }
    }).pipe(Effect.provide(Resource.ResourceRegistryLive)),
  );
});

// =============================================================================
// Resource.fetch - Deduplication
// =============================================================================

describe("Resource.fetch deduplication", () => {
  it.scoped("should return same signal for same key", () =>
    Effect.gen(function* () {
      const fetchCount = yield* Ref.make(0);

      const resource = Resource.make(() => Ref.updateAndGet(fetchCount, (n) => n + 1), {
        key: "dedupe:1",
      });

      // Fetch twice with same key
      const state1 = yield* Resource.fetch(resource);
      const state2 = yield* Resource.fetch(resource);

      // Should be same signal
      assert.strictEqual(state1, state2);
    }).pipe(Effect.provide(Resource.ResourceRegistryLive)),
  );

  it.scoped("should only fetch once for same key", () =>
    Effect.gen(function* () {
      const fetchCount = yield* Ref.make(0);

      const resource = Resource.make(() => Ref.updateAndGet(fetchCount, (n) => n + 1), {
        key: "dedupe:2",
      });

      // Fetch multiple times
      yield* Resource.fetch(resource);
      yield* TestClock.adjust(0);
      yield* Resource.fetch(resource);
      yield* Resource.fetch(resource);

      // Should only have fetched once
      const count = yield* Ref.get(fetchCount);
      assert.strictEqual(count, 1);
    }).pipe(Effect.provide(Resource.ResourceRegistryLive)),
  );
});

// =============================================================================
// Resource.invalidate - Stale-while-revalidate
// =============================================================================

describe("Resource.invalidate", () => {
  it.scoped("should mark state as stale and trigger refetch", () =>
    Effect.gen(function* () {
      const fetchCount = yield* Ref.make(0);
      const secondFetchComplete = yield* Deferred.make<void>();

      const resource = Resource.make(
        () =>
          Effect.gen(function* () {
            const count = yield* Ref.updateAndGet(fetchCount, (n) => n + 1);
            if (count > 1) {
              yield* Deferred.await(secondFetchComplete);
            }
            return `result-${count}`;
          }),
        { key: "invalidate:1" },
      );

      // Initial fetch
      const state = yield* Resource.fetch(resource);
      yield* TestClock.adjust(0);

      const initial = yield* Signal.get(state);
      assert.strictEqual(initial._tag, "Success");
      if (Resource.isSuccess(initial)) {
        assert.strictEqual(initial.value, "result-1");
        assert.strictEqual(initial.stale, false);
      }

      // Invalidate - should mark stale and start refetch
      yield* Resource.invalidate(resource);
      yield* TestClock.adjust(0);

      const stale = yield* Signal.get(state);
      assert.strictEqual(stale._tag, "Success");
      if (Resource.isSuccess(stale)) {
        assert.strictEqual(stale.value, "result-1");
        assert.strictEqual(stale.stale, true);
      }

      // Complete refetch
      yield* Deferred.succeed(secondFetchComplete, undefined);
      yield* TestClock.adjust(0);

      const refreshed = yield* Signal.get(state);
      assert.strictEqual(refreshed._tag, "Success");
      if (Resource.isSuccess(refreshed)) {
        assert.strictEqual(refreshed.value, "result-2");
        assert.strictEqual(refreshed.stale, false);
      }
    }).pipe(Effect.provide(Resource.ResourceRegistryLive)),
  );

  it.scoped("should not invalidate non-existent resource", () =>
    Effect.gen(function* () {
      const resource = Resource.make(() => Effect.succeed("value"), {
        key: "invalidate:nonexistent:1",
      });

      // Invalidate before any fetch - should no-op (nothing to invalidate)
      yield* Resource.invalidate(resource);

      // Now fetch
      const state = yield* Resource.fetch(resource);
      yield* TestClock.adjust(0);

      const result = yield* Signal.get(state);
      assert.strictEqual(result._tag, "Success");
      if (Resource.isSuccess(result)) {
        assert.strictEqual(result.value, "value");
        assert.strictEqual(result.stale, false);
      }
    }).pipe(Effect.provide(Resource.ResourceRegistryLive)),
  );

  it.scoped("should preserve stale value on refetch failure", () =>
    Effect.gen(function* () {
      const fetchCount = yield* Ref.make(0);

      const resource = Resource.make(
        () =>
          Effect.gen(function* () {
            const count = yield* Ref.updateAndGet(fetchCount, (n) => n + 1);
            if (count > 1) {
              return yield* Effect.fail("refetch failed");
            }
            return "original";
          }),
        { key: "invalidate:fail:1" },
      );

      // Initial successful fetch
      const state = yield* Resource.fetch(resource);
      yield* TestClock.adjust(0);

      // Invalidate and wait for failed refetch
      yield* Resource.invalidate(resource);
      yield* TestClock.adjust(0);

      const result = yield* Signal.get(state);
      assert.strictEqual(result._tag, "Failure");
      if (Resource.isFailure(result)) {
        assert.strictEqual(result.error, "refetch failed");
        assert.isTrue(Option.isSome(result.staleValue));
        if (Option.isSome(result.staleValue)) {
          assert.strictEqual(result.staleValue.value, "original");
        }
      }
    }).pipe(Effect.provide(Resource.ResourceRegistryLive)),
  );
});

// =============================================================================
// Resource.refresh - Hard reload
// =============================================================================

describe("Resource.refresh", () => {
  it.scoped("should transition to Pending and refetch", () =>
    Effect.gen(function* () {
      const fetchCount = yield* Ref.make(0);
      const secondFetchComplete = yield* Deferred.make<void>();

      const resource = Resource.make(
        () =>
          Effect.gen(function* () {
            const count = yield* Ref.updateAndGet(fetchCount, (n) => n + 1);
            if (count > 1) {
              yield* Deferred.await(secondFetchComplete);
            }
            return `result-${count}`;
          }),
        { key: "refresh:1" },
      );

      // Initial fetch
      const state = yield* Resource.fetch(resource);
      yield* TestClock.adjust(0);

      // Refresh - should go to Pending
      yield* Resource.refresh(resource);
      yield* TestClock.adjust(0);

      const pending = yield* Signal.get(state);
      assert.strictEqual(pending._tag, "Pending");

      // Complete refetch
      yield* Deferred.succeed(secondFetchComplete, undefined);
      yield* TestClock.adjust(0);

      const refreshed = yield* Signal.get(state);
      assert.strictEqual(refreshed._tag, "Success");
      if (Resource.isSuccess(refreshed)) {
        assert.strictEqual(refreshed.value, "result-2");
      }
    }).pipe(Effect.provide(Resource.ResourceRegistryLive)),
  );

  it.scoped("should refetch after initial fetch completes", () =>
    Effect.gen(function* () {
      const fetchCount = yield* Ref.make(0);

      const resource = Resource.make(() => Ref.updateAndGet(fetchCount, (n) => n + 1), {
        key: "refresh:refetch:1",
      });

      // Initial fetch
      const state = yield* Resource.fetch(resource);
      yield* TestClock.adjust(0);

      const first = yield* Signal.get(state);
      if (Resource.isSuccess(first)) {
        assert.strictEqual(first.value, 1);
      }

      // Refresh triggers new fetch
      yield* Resource.refresh(resource);
      yield* TestClock.adjust(0);

      const second = yield* Signal.get(state);
      if (Resource.isSuccess(second)) {
        assert.strictEqual(second.value, 2);
      }

      // Should have fetched twice
      const count = yield* Ref.get(fetchCount);
      assert.strictEqual(count, 2);
    }).pipe(Effect.provide(Resource.ResourceRegistryLive)),
  );
});

// =============================================================================
// Resource.clear
// =============================================================================

describe("Resource.clear", () => {
  it.scoped("should remove resource from cache", () =>
    Effect.gen(function* () {
      const fetchCount = yield* Ref.make(0);

      const resource = Resource.make(() => Ref.updateAndGet(fetchCount, (n) => n + 1), {
        key: "clear:1",
      });

      // First fetch
      const state1 = yield* Resource.fetch(resource);
      yield* TestClock.adjust(0);

      // Clear cache
      yield* Resource.clear(resource);

      // Second fetch should create new entry and re-fetch
      const state2 = yield* Resource.fetch(resource);
      yield* TestClock.adjust(0);

      // Should be different signals
      assert.notStrictEqual(state1, state2);

      // Should have fetched twice
      const count = yield* Ref.get(fetchCount);
      assert.strictEqual(count, 2);
    }).pipe(Effect.provide(Resource.ResourceRegistryLive)),
  );
});

// =============================================================================
// Different keys are independent
// =============================================================================

describe("Resource key isolation", () => {
  it.scoped("should maintain separate state for different keys", () =>
    Effect.gen(function* () {
      const resource1 = Resource.make(() => Effect.succeed("Alice"), { key: "user:1" });

      const resource2 = Resource.make(() => Effect.succeed("Bob"), { key: "user:2" });

      const state1 = yield* Resource.fetch(resource1);
      const state2 = yield* Resource.fetch(resource2);
      yield* TestClock.adjust(0);

      assert.notStrictEqual(state1, state2);

      const value1 = yield* Signal.get(state1);
      const value2 = yield* Signal.get(state2);

      if (Resource.isSuccess(value1) && Resource.isSuccess(value2)) {
        assert.strictEqual(value1.value, "Alice");
        assert.strictEqual(value2.value, "Bob");
      }
    }).pipe(Effect.provide(Resource.ResourceRegistryLive)),
  );
});

// =============================================================================
// Resource.fetch reactive - Signal-driven re-fetching
// =============================================================================

describe("Resource.fetch reactive", () => {
  it.scoped("should fetch once per key — no duplicate fetches for same key", () =>
    Effect.gen(function* () {
      const fetchCount = yield* Ref.make(0);

      const factory = Resource.make(
        (params: { id: string }) =>
          Ref.updateAndGet(fetchCount, (n) => n + 1).pipe(
            Effect.map((n) => `user-${params.id}-fetch-${n}`),
          ),
        { key: (params) => `reactive-dedupe:${params.id}` },
      );

      const userId = yield* Signal.make("1");
      const state = yield* Resource.fetch(factory, { id: userId });

      // Let initial fetch complete
      yield* TestClock.adjust(0);

      const result = yield* Signal.get(state);
      assert.strictEqual(result._tag, "Success");
      if (Resource.isSuccess(result)) {
        assert.strictEqual(result.value, "user-1-fetch-1");
      }

      // Fetch should have run exactly once
      const count = yield* Ref.get(fetchCount);
      assert.strictEqual(count, 1);
    }).pipe(Effect.provide(Resource.ResourceRegistryLive)),
  );

  it.scoped("should re-fetch when signal changes and resolve correct value", () =>
    Effect.gen(function* () {
      const fetchCount = yield* Ref.make(0);

      const factory = Resource.make(
        (params: { id: string }) =>
          Ref.updateAndGet(fetchCount, (n) => n + 1).pipe(Effect.map(() => `user-${params.id}`)),
        { key: (params) => `reactive-change:${params.id}` },
      );

      const userId = yield* Signal.make("1");
      const state = yield* Resource.fetch(factory, { id: userId });
      yield* TestClock.adjust(0);

      // Verify initial fetch
      const first = yield* Signal.get(state);
      assert.strictEqual(first._tag, "Success");
      if (Resource.isSuccess(first)) {
        assert.strictEqual(first.value, "user-1");
      }

      // Change to user 2
      yield* Signal.set(userId, "2");
      yield* TestClock.adjust(0);

      const second = yield* Signal.get(state);
      assert.strictEqual(second._tag, "Success");
      if (Resource.isSuccess(second)) {
        assert.strictEqual(second.value, "user-2");
      }

      // Should have fetched exactly twice (once per key)
      const count = yield* Ref.get(fetchCount);
      assert.strictEqual(count, 2);
    }).pipe(Effect.provide(Resource.ResourceRegistryLive)),
  );

  it.scoped("should cancel in-flight fetch when key changes before completion", () =>
    Effect.gen(function* () {
      const fetchCount = yield* Ref.make(0);
      const gate1 = yield* Deferred.make<void>();

      const factory = Resource.make(
        (params: { id: string }) =>
          Effect.gen(function* () {
            const n = yield* Ref.updateAndGet(fetchCount, (c) => c + 1);
            // First fetch blocks until gate opens
            if (params.id === "1") {
              yield* Deferred.await(gate1);
            }
            return `user-${params.id}-fetch-${n}`;
          }),
        { key: (params) => `reactive-cancel:${params.id}` },
      );

      const userId = yield* Signal.make("1");
      const state = yield* Resource.fetch(factory, { id: userId });
      yield* TestClock.adjust(0);

      // user-1 fetch is in-flight (blocked on gate)
      const pending = yield* Signal.get(state);
      assert.strictEqual(pending._tag, "Pending");

      // Change to user 2 while user 1 is still fetching
      yield* Signal.set(userId, "2");
      yield* TestClock.adjust(0);

      // user-2 should resolve since it doesn't block
      const result = yield* Signal.get(state);
      assert.strictEqual(result._tag, "Success");
      if (Resource.isSuccess(result)) {
        assert.strictEqual(result.value, "user-2-fetch-2");
      }
    }).pipe(Effect.provide(Resource.ResourceRegistryLive)),
  );

  it.scoped("should not duplicate fetches when signal changes rapidly", () =>
    Effect.gen(function* () {
      const fetchCount = yield* Ref.make(0);

      const factory = Resource.make(
        (params: { id: string }) =>
          Ref.updateAndGet(fetchCount, (n) => n + 1).pipe(Effect.map(() => `user-${params.id}`)),
        { key: (params) => `reactive-rapid:${params.id}` },
      );

      const userId = yield* Signal.make("1");
      const state = yield* Resource.fetch(factory, { id: userId });
      yield* TestClock.adjust(0);

      // Rapidly change: 1 → 2 → 3
      yield* Signal.set(userId, "2");
      yield* Signal.set(userId, "3");
      yield* TestClock.adjust(0);

      // Final state should be user-3
      const result = yield* Signal.get(state);
      assert.strictEqual(result._tag, "Success");
      if (Resource.isSuccess(result)) {
        assert.strictEqual(result.value, "user-3");
      }

      // Should have fetched exactly 3 times (one per distinct key)
      const count = yield* Ref.get(fetchCount);
      assert.strictEqual(count, 3);
    }).pipe(Effect.provide(Resource.ResourceRegistryLive)),
  );

  it.scoped("should deduplicate when async fetch is already in-flight for same key", () =>
    Effect.gen(function* () {
      const fetchCount = yield* Ref.make(0);
      const gate = yield* Deferred.make<void>();

      const factory = Resource.make(
        (params: { id: string }) =>
          Effect.gen(function* () {
            const n = yield* Ref.updateAndGet(fetchCount, (c) => c + 1);
            // Simulate async: all fetches wait on gate
            yield* Deferred.await(gate);
            return `user-${params.id}-fetch-${n}`;
          }),
        { key: (params) => `reactive-async-dedupe:${params.id}` },
      );

      const userId = yield* Signal.make("1");
      yield* Resource.fetch(factory, { id: userId });
      yield* TestClock.adjust(0);

      // Fetch for "1" is now in-flight (blocked on gate)
      // Change to "2" then back to "1" — second fetch for key "1" should deduplicate
      yield* Signal.set(userId, "2");
      yield* TestClock.adjust(0);
      yield* Signal.set(userId, "1");
      yield* TestClock.adjust(0);

      // Release the gate
      yield* Deferred.succeed(gate, undefined);
      yield* TestClock.adjust(0);

      // Key "1" should have been fetched only once (deduplicated on second visit)
      // Key "2" fetched once
      // Total = 2
      const count = yield* Ref.get(fetchCount);
      assert.strictEqual(count, 2);
    }).pipe(Effect.provide(Resource.ResourceRegistryLive)),
  );

  it.scoped(
    "should not start multiple fetches for same new key when signal changes during async fetch",
    () =>
      Effect.gen(function* () {
        const fetchCount = yield* Ref.make(0);
        const gate1 = yield* Deferred.make<void>();

        const factory = Resource.make(
          (params: { id: string }) =>
            Effect.gen(function* () {
              const n = yield* Ref.updateAndGet(fetchCount, (c) => c + 1);
              if (params.id === "1") {
                yield* Deferred.await(gate1);
              }
              return `user-${params.id}-fetch-${n}`;
            }),
          { key: (params) => `reactive-no-multi:${params.id}` },
        );

        const userId = yield* Signal.make("1");
        const state = yield* Resource.fetch(factory, { id: userId });
        yield* TestClock.adjust(0);

        // Fetch for "1" is in-flight. Change to "2".
        yield* Signal.set(userId, "2");
        yield* TestClock.adjust(0);

        // user-2 fetch should succeed (it's synchronous)
        const result = yield* Signal.get(state);
        assert.strictEqual(result._tag, "Success");
        if (Resource.isSuccess(result)) {
          assert.strictEqual(result.value, "user-2-fetch-2");
        }

        // user-2 should have been fetched exactly once
        // Total: 1 for user-1 (interrupted or blocked), 1 for user-2
        const count = yield* Ref.get(fetchCount);
        assert.strictEqual(count, 2);
      }).pipe(Effect.provide(Resource.ResourceRegistryLive)),
  );

  it.scoped("should not re-fetch when signal changes to same value", () =>
    Effect.gen(function* () {
      const fetchCount = yield* Ref.make(0);

      const factory = Resource.make(
        (params: { id: string }) =>
          Ref.updateAndGet(fetchCount, (n) => n + 1).pipe(Effect.map(() => `user-${params.id}`)),
        { key: (params) => `reactive-same:${params.id}` },
      );

      const userId = yield* Signal.make("1");
      const state = yield* Resource.fetch(factory, { id: userId });
      yield* TestClock.adjust(0);

      // Set to same value
      yield* Signal.set(userId, "1");
      yield* TestClock.adjust(0);

      // Should still show user-1, fetched only once
      const result = yield* Signal.get(state);
      assert.strictEqual(result._tag, "Success");
      if (Resource.isSuccess(result)) {
        assert.strictEqual(result.value, "user-1");
      }

      const count = yield* Ref.get(fetchCount);
      assert.strictEqual(count, 1);
    }).pipe(Effect.provide(Resource.ResourceRegistryLive)),
  );
});
