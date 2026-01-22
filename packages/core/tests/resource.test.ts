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
import * as Resource from "../src/Resource.js";
import * as Signal from "../src/signal.js";

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
    const resource = Resource.make({
      key: "test:123",
      fetch: Effect.succeed(42),
    });

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
      const resource = Resource.make({
        key: "user:1",
        fetch: Effect.succeed({ name: "Alice" }),
      });

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

      const resource = Resource.make({
        key: "cached:1",
        fetch: Ref.updateAndGet(fetchCount, (n) => n + 1),
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

  it.scoped("should transition to Failure on error", () =>
    Effect.gen(function* () {
      const resource = Resource.make({
        key: "error:1",
        fetch: Effect.fail("fetch error"),
      });

      const state = yield* Resource.fetch(resource);
      yield* TestClock.adjust(0);

      const result = yield* Signal.get(state);
      assert.strictEqual(result._tag, "Failure");
      if (Resource.isFailure(result)) {
        assert.strictEqual(result.error, "fetch error");
        assert.isTrue(Option.isNone(result.staleValue));
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

      const resource = Resource.make({
        key: "dedupe:1",
        fetch: Ref.updateAndGet(fetchCount, (n) => n + 1),
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

      const resource = Resource.make({
        key: "dedupe:2",
        fetch: Ref.updateAndGet(fetchCount, (n) => n + 1),
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

      const resource = Resource.make({
        key: "invalidate:1",
        fetch: Effect.gen(function* () {
          const count = yield* Ref.updateAndGet(fetchCount, (n) => n + 1);
          if (count > 1) {
            yield* Deferred.await(secondFetchComplete);
          }
          return `result-${count}`;
        }),
      });

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
      const resource = Resource.make({
        key: "invalidate:nonexistent:1",
        fetch: Effect.succeed("value"),
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

      const resource = Resource.make({
        key: "invalidate:fail:1",
        fetch: Effect.gen(function* () {
          const count = yield* Ref.updateAndGet(fetchCount, (n) => n + 1);
          if (count > 1) {
            return yield* Effect.fail("refetch failed");
          }
          return "original";
        }),
      });

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

      const resource = Resource.make({
        key: "refresh:1",
        fetch: Effect.gen(function* () {
          const count = yield* Ref.updateAndGet(fetchCount, (n) => n + 1);
          if (count > 1) {
            yield* Deferred.await(secondFetchComplete);
          }
          return `result-${count}`;
        }),
      });

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

      const resource = Resource.make({
        key: "refresh:refetch:1",
        fetch: Ref.updateAndGet(fetchCount, (n) => n + 1),
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

      const resource = Resource.make({
        key: "clear:1",
        fetch: Ref.updateAndGet(fetchCount, (n) => n + 1),
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
      const resource1 = Resource.make({
        key: "user:1",
        fetch: Effect.succeed("Alice"),
      });

      const resource2 = Resource.make({
        key: "user:2",
        fetch: Effect.succeed("Bob"),
      });

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
