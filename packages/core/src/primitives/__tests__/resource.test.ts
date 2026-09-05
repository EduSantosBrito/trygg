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
import { assert, describe, it, vi } from "@effect/vitest";
import { scoped } from "../../testing/effect-vitest.js";
import { Cause, Clock, Deferred, Effect, Exit, Fiber, Option, Ref, Scope } from "effect";
import * as Logger from "effect/Logger";
import * as References from "effect/References";
import { TestClock } from "effect/testing";
import * as Trace from "../../trace/index.js";
import * as Resource from "../resource.js";
import * as Signal from "../signal.js";

const expireAfterFirstLease = Effect.fnUntraced(function* (
  registry: Resource.ResourceRegistry,
  key: string,
  barrier: Deferred.Deferred<void>,
) {
  const firstLease = yield* Ref.make(true);
  const wrapped: Resource.ResourceRegistry = {
    ...registry,
    acquire: (candidateKey, entry, lease) =>
      registry.acquire(candidateKey, entry, lease).pipe(
        Effect.tap((acquired) =>
          Effect.gen(function* () {
            if (!acquired || candidateKey !== key) return;
            if (!(yield* Ref.getAndSet(firstLease, false))) return;

            // A TTL=0 lookup retires the just-leased generation before its flight claim.
            yield* registry.get(`${key}:ttl-race-barrier`);
            yield* Deferred.succeed(barrier, undefined);
          }),
        ),
      ),
  };
  return wrapped;
});

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
  it.effect("should create resource with key and fetch effect", () =>
    Effect.sync(() => {
      const resource = Resource.make(() => Effect.succeed(42), { key: "test:123" });

      assert.strictEqual(resource._tag, "Resource");
      assert.strictEqual(resource.key, "test:123");
    }),
  );
});

// =============================================================================
// Resource.hash
// =============================================================================

describe("Resource.hash", () => {
  it("should encode positional primitive values deterministically without representation aliases", () => {
    // Scope: safe structural identity is limited to immutable primitive positions.
    // Assertion: repeated tuples share a v3 key and every listed representation remains distinct.
    assert.strictEqual(
      Resource.hash("identity", "tenant-a", 1, 2),
      Resource.hash("identity", "tenant-a", 1, 2),
    );
    assert.notStrictEqual(
      Resource.hash("identity", "tenant-a", 1, 2),
      Resource.hash("identity", "tenant-a", 0, 3),
    );

    const identities = [
      Resource.hash("identity"),
      Resource.hash("identity", undefined),
      Resource.hash("identity", null),
      Resource.hash("identity", false),
      Resource.hash("identity", 0),
      Resource.hash("identity", -0),
      Resource.hash("identity", Number.NaN),
      Resource.hash("identity", Number.POSITIVE_INFINITY),
      Resource.hash("identity", Number.NEGATIVE_INFINITY),
      Resource.hash("identity", "1"),
      Resource.hash("identity", 1),
      Resource.hash("identity", 1n),
      Resource.hash("identity", "a:b|c"),
      Resource.hash("identity:a", "b|c"),
    ];

    assert.strictEqual(new Set(identities).size, identities.length);
    assert.isTrue(identities.every((identity) => identity.startsWith("trygg-resource:v3:")));
  });

  it("should use trap-free reference identity for getter objects and hostile Proxies", () => {
    // Scope: arbitrary references can execute application code through reflection and property reads.
    // Assertion: hashing invokes no getter or Proxy trap, while same and distinct references stay stable.
    let getterCalls = 0;
    const getterObject = Object.defineProperty({}, "tenant", {
      enumerable: true,
      get: () => {
        getterCalls += 1;
        // oxlint-disable-next-line effect/no-raw-throw, effect/no-built-in-error-constructor -- A hostile getter must fail if Resource.hash accidentally invokes it.
        throw new Error("getter must not run");
      },
    });
    let proxyTraps = 0;
    const trap = () => {
      proxyTraps += 1;
      // oxlint-disable-next-line effect/no-raw-throw, effect/no-built-in-error-constructor -- A hostile Proxy trap must fail if Resource.hash accidentally invokes it.
      throw new Error("Proxy trap must not run");
    };
    const proxy = new Proxy(
      {},
      {
        get: trap,
        getOwnPropertyDescriptor: trap,
        getPrototypeOf: trap,
        ownKeys: trap,
      },
    );
    const secondProxy = new Proxy({}, { ownKeys: trap });

    assert.strictEqual(
      Resource.hash("reference", getterObject),
      Resource.hash("reference", getterObject),
    );
    assert.strictEqual(Resource.hash("reference", proxy), Resource.hash("reference", proxy));
    assert.notStrictEqual(Resource.hash("reference", getterObject), Resource.hash("reference", {}));
    assert.notStrictEqual(
      Resource.hash("reference", proxy),
      Resource.hash("reference", secondProxy),
    );
    assert.strictEqual(getterCalls, 0);
    assert.strictEqual(proxyTraps, 0);
  });

  it("should keep cyclic and mutable function references opaque", () => {
    // Scope: cycles and mutable functions must never be traversed or content-hashed.
    // Assertion: distinct cycles do not alias and function mutation cannot change its key.
    const firstCycle: { self?: unknown } = {};
    firstCycle.self = firstCycle;
    const secondCycle: { self?: unknown } = {};
    secondCycle.self = secondCycle;
    const callable = () => "value";
    const beforeMutation = Resource.hash("function", callable);
    Object.defineProperty(callable, "tenant", { value: "changed", enumerable: true });

    assert.notStrictEqual(Resource.hash("cycle", firstCycle), Resource.hash("cycle", secondCycle));
    assert.strictEqual(beforeMutation, Resource.hash("function", callable));
  });

  it("should share opaque reference identity across duplicate module copies", async () => {
    // Scope: HMR can retain two independently-instantiated copies of the Resource module.
    // Assertion: the copies agree for one object and cannot assign one ID to two distinct objects.
    vi.resetModules();
    const firstCopy = await import("../resource.js");
    const shared = {};
    const firstOnly = {};
    const sharedFromFirst = firstCopy.hash("hmr", shared);
    const firstIdentity = firstCopy.hash("hmr", firstOnly);

    vi.resetModules();
    const secondCopy = await import("../resource.js");
    const secondOnly = {};
    const sharedFromSecond = secondCopy.hash("hmr", shared);
    const secondIdentity = secondCopy.hash("hmr", secondOnly);

    assert.strictEqual(sharedFromSecond, sharedFromFirst);
    assert.notStrictEqual(secondIdentity, firstIdentity);
  });

  it("should encode Symbol.for deterministically and reject non-global Symbols", () => {
    // Scope: local Symbol identity cannot be weakly retained for the registry lifetime.
    // Assertion: global symbols are structural, while local and well-known symbols fail explicitly.
    assert.strictEqual(
      Resource.hash("symbol", Symbol.for("trygg.resource.tenant")),
      Resource.hash("symbol", Symbol.for("trygg.resource.tenant")),
    );
    assert.throws(
      () => Resource.hash("symbol", Symbol("tenant")),
      Resource.ResourceHashLocalSymbolError,
    );
    assert.throws(
      () => Resource.hash("symbol", Symbol.iterator),
      Resource.ResourceHashLocalSymbolError,
    );
  });
});

// =============================================================================
// Resource.fetch - Initial fetch
// =============================================================================

describe("Resource.fetch", () => {
  scoped("should return Pending initially then Success after fetch completes", () =>
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
    }).pipe(Effect.provide(Resource.ResourceRegistry.layer())),
  );

  scoped("should return cached state on subsequent fetch", () =>
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
    }).pipe(Effect.provide(Resource.ResourceRegistry.layer())),
  );

  scoped("should not inspect a Proxy result when Trace is enabled", () =>
    Effect.gen(function* () {
      // Scope: compares Resource success under enabled, filtered, and logger-free Trace paths.
      // Assertion: Trace adds no Proxy operations and stores the same application value by identity.
      type TraceMode = "enabled" | "filtered" | "absent";
      const runCase = Effect.fnUntraced(function* (mode: TraceMode) {
        let traps = 0;
        const target = { state: "stable" };
        const value = new Proxy(target, {
          get: (object, key, receiver) => {
            traps++;
            target.state = "mutated";
            // oxlint-disable-next-line effect/no-unknown-shape-probing -- The hostile Proxy must otherwise preserve target behavior.
            return Reflect.get(object, key, receiver);
          },
          getOwnPropertyDescriptor: (object, key) => {
            traps++;
            target.state = "mutated";
            return Reflect.getOwnPropertyDescriptor(object, key);
          },
          ownKeys: (object) => {
            traps++;
            target.state = "mutated";
            return Reflect.ownKeys(object);
          },
        });
        const key = `proxy-result:${mode}`;
        const resource = Resource.make(() => Effect.succeed(value), { key });
        const recorder = Trace.makeRecorder();
        const program = Effect.gen(function* () {
          const state = yield* Resource.fetch(resource);
          yield* TestClock.adjust(0);
          return yield* Signal.peek(state);
        });
        const final = yield* mode === "enabled"
          ? Trace.record(program, recorder)
          : mode === "filtered"
            ? program.pipe(Effect.provideService(References.MinimumLogLevel, "Fatal"))
            : program.pipe(
                Effect.provide(Logger.layer([])),
                Effect.provideService(References.MinimumLogLevel, "Trace"),
              );

        return {
          traps,
          targetState: target.state,
          success: Resource.isSuccess(final),
          storedIdentity: Resource.isSuccess(final) && final.value === value,
          payload: recorder.records().find((record) => record.name === "resource.fetch.success")
            ?.payload,
        };
      });

      const enabled = yield* runCase("enabled");
      const filtered = yield* runCase("filtered");
      const absent = yield* runCase("absent");
      assert.deepStrictEqual({ ...enabled, payload: undefined }, filtered);
      assert.deepStrictEqual(filtered, absent);
      assert.deepStrictEqual(enabled.payload, {
        key: "proxy-result:enabled",
        value_type: "object",
      });
    }).pipe(Effect.provide(Resource.ResourceRegistry.layer())),
  );
});

// =============================================================================
// Resource.fetch reactive — render phase isolation
// =============================================================================

describe("Resource.fetch reactive invalidate/refresh", () => {
  scoped("should reflect invalidate on reactive fetch output signal", () =>
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
    }).pipe(Effect.provide(Resource.ResourceRegistry.layer())),
  );

  scoped("should reflect refresh (pending transition) on reactive fetch output", () =>
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
    }).pipe(Effect.provide(Resource.ResourceRegistry.layer())),
  );

  scoped("should not overwrite current key with stale previous key result", () =>
    Effect.gen(function* () {
      const gate1 = yield* Deferred.make<void>();
      const gate2 = yield* Deferred.make<void>();

      const factory = Resource.make(
        (params: { id: string }) =>
          Effect.gen(function* () {
            if (params.id === "1") {
              yield* Deferred.await(gate1);
            }
            if (params.id === "2") {
              yield* Deferred.await(gate2);
            }
            return `user-${params.id}`;
          }),
        { key: (params) => `reactive-switch:${params.id}` },
      );

      const userId = yield* Signal.make("1");
      const state = yield* Resource.fetch(factory, { id: userId });
      yield* TestClock.adjust(0);

      // Switch before the first request resolves.
      yield* Signal.set(userId, "2");
      yield* TestClock.adjust(0);

      // Resolve stale request first; it must NOT win.
      yield* Deferred.succeed(gate1, undefined);
      yield* TestClock.adjust(0);

      const afterStale = yield* Signal.get(state);
      if (Resource.isSuccess(afterStale)) {
        assert.notStrictEqual(afterStale.value, "user-1");
      }

      // Resolve current request; now output must be for id=2.
      yield* Deferred.succeed(gate2, undefined);
      yield* TestClock.adjust(0);

      const final = yield* Signal.get(state);
      assert.strictEqual(final._tag, "Success");
      if (Resource.isSuccess(final)) {
        assert.strictEqual(final.value, "user-2");
      }
    }).pipe(Effect.provide(Resource.ResourceRegistry.layer())),
  );
});

describe("Resource.fetch reactive render phase", () => {
  scoped("should not register param signals in component render phase accessed set", () =>
    Effect.gen(function* () {
      const factory = Resource.make(
        (params: { id: string }) => Effect.succeed(`user-${params.id}`),
        { key: (params) => `phase-isolation:${params.id}` },
      );

      const userId = yield* Signal.make("1");

      // Simulate component render phase
      const phase = yield* Signal.makeRenderPhase;

      yield* Effect.provideService(
        Resource.fetch(factory, { id: userId }),
        Signal.CurrentRenderPhase,
        phase,
      );
      yield* TestClock.adjust(0);

      // userId should NOT be in the accessed set —
      // fetchReactive should not leak param signals as component dependencies
      assert.isFalse(
        phase.accessed.has(userId),
        "param signal should not be registered as a component dependency",
      );
    }).pipe(Effect.provide(Resource.ResourceRegistry.layer())),
  );

  scoped("should re-fetch when params change even inside a render phase context", () =>
    Effect.gen(function* () {
      const fetchCount = yield* Ref.make(0);

      const factory = Resource.make(
        (params: { id: string }) =>
          Ref.updateAndGet(fetchCount, (n) => n + 1).pipe(Effect.map(() => `user-${params.id}`)),
        { key: (params) => `phase-refetch:${params.id}` },
      );

      const userId = yield* Signal.make("1");
      const phase = yield* Signal.makeRenderPhase;

      const state = yield* Effect.provideService(
        Resource.fetch(factory, { id: userId }),
        Signal.CurrentRenderPhase,
        phase,
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
    }).pipe(Effect.provide(Resource.ResourceRegistry.layer())),
  );
});

describe("Resource.fetch reactive render ownership", () => {
  scoped(
    "should replace per-render listeners and daemons while retaining only the output signal",
    () =>
      Effect.gen(function* () {
        // Scope: repeated unrelated component renders reuse output state but rebuild reactive machinery.
        // Assertion: listener counts stay constant, one param change reacts once, and render cleanup stops all work.
        const fetchCount = yield* Ref.make(0);
        const factory = Resource.make(
          (params: { id: string }) =>
            Ref.updateAndGet(fetchCount, (count) => count + 1).pipe(
              Effect.map(() => `user-${params.id}`),
            ),
          { key: (params) => `render-owner:${params.id}` },
        );
        const id = yield* Signal.make("1");
        const parentScope = yield* Effect.scope;
        const componentScope = yield* Scope.fork(parentScope);
        const phase = yield* Signal.makeRenderPhase;
        let currentRenderScope = yield* Scope.fork(componentScope);

        const output = yield* Resource.fetch(factory, { id }).pipe(
          Scope.provide(componentScope),
          Effect.provideService(Signal.CurrentComponentScope, componentScope),
          Effect.provideService(Signal.CurrentRenderScope, currentRenderScope),
          Effect.provideService(Signal.CurrentRenderPhase, phase),
        );
        yield* TestClock.adjust(0);

        for (let render = 0; render < 12; render++) {
          yield* Signal.resetRenderPhase(phase);
          const nextRenderScope = yield* Scope.fork(componentScope);
          const nextOutput = yield* Resource.fetch(factory, { id }).pipe(
            Scope.provide(componentScope),
            Effect.provideService(Signal.CurrentComponentScope, componentScope),
            Effect.provideService(Signal.CurrentRenderScope, nextRenderScope),
            Effect.provideService(Signal.CurrentRenderPhase, phase),
          );
          assert.strictEqual(nextOutput, output);
          yield* Scope.close(currentRenderScope, Exit.void);
          currentRenderScope = nextRenderScope;
          yield* TestClock.adjust(0);
        }

        const registry = yield* Resource.ResourceRegistryTag;
        const firstEntry = yield* registry.get("render-owner:1");
        assert.strictEqual(id._listeners.size, 1);
        assert.isTrue(Option.isSome(firstEntry));
        if (Option.isSome(firstEntry)) {
          assert.strictEqual(firstEntry.value.state._listeners.size, 1);
        }

        yield* Signal.set(id, "2");
        yield* TestClock.adjust(0);
        assert.strictEqual(yield* Ref.get(fetchCount), 2);
        const current = yield* Signal.peek(output);
        assert.isTrue(Resource.isSuccess(current));
        if (Resource.isSuccess(current)) {
          assert.strictEqual(current.value, "user-2");
        }

        const secondEntry = yield* registry.get("render-owner:2");
        if (Option.isSome(firstEntry)) {
          assert.strictEqual(firstEntry.value.state._listeners.size, 0);
        }
        assert.isTrue(Option.isSome(secondEntry));
        if (Option.isSome(secondEntry)) {
          assert.strictEqual(secondEntry.value.state._listeners.size, 1);
        }

        yield* Scope.close(currentRenderScope, Exit.void);
        assert.strictEqual(id._listeners.size, 0);
        if (Option.isSome(secondEntry)) {
          assert.strictEqual(secondEntry.value.state._listeners.size, 0);
        }
        assert.isFalse(yield* Ref.get(output._disposed));
        yield* Scope.close(componentScope, Exit.void);
        assert.isTrue(yield* Ref.get(output._disposed));
      }).pipe(Effect.provide(Resource.ResourceRegistry.layer())),
  );

  scoped("should own a parameter listener when interrupted exactly at signal.subscribe", () =>
    Effect.gen(function* () {
      // Scope: the caller is interrupted by the signal.subscribe trace after listener installation.
      // Assertion: acquisition first registers cleanup, and closing the render Scope restores baseline.
      const id = yield* Signal.make("1");
      const renderScope = yield* Scope.fork(yield* Effect.scope);
      const sourceStarted = yield* Deferred.make<void>();
      const factory = Resource.make(
        ({ id }: { readonly id: string }) =>
          Deferred.succeed(sourceStarted, undefined).pipe(
            Effect.andThen(Effect.never),
            Effect.as(id),
          ),
        { key: ({ id }) => `subscribe-interrupt:param:${id}` },
      );
      const reader = Trace.makeRecordReader();
      let interrupted = false;
      const logger = reader.register(
        Logger.make<unknown, void>((options) => {
          const record = reader.read(options);
          if (
            !interrupted &&
            record !== null &&
            record !== undefined &&
            record.name === "signal.subscribe" &&
            record.payload?.signal_id === id._debugId
          ) {
            interrupted = true;
            // oxlint-disable-next-line effect/no-effect-escape-hatch -- Deterministically injects interruption after Signal installed the target listener.
            options.fiber.interruptUnsafe(201);
          }
        }),
      );

      const fetchFiber = yield* Resource.fetch(factory, { id }).pipe(
        Scope.provide(renderScope),
        Effect.provideService(Signal.CurrentRenderScope, renderScope),
        Effect.provide(Logger.layer([logger])),
        Effect.provideService(References.MinimumLogLevel, "Trace"),
        Effect.forkChild,
      );
      const exit = yield* Fiber.await(fetchFiber);

      assert.isTrue(interrupted);
      assert.isTrue(yield* Deferred.isDone(sourceStarted));
      assert.isTrue(Exit.isFailure(exit));
      if (Exit.isFailure(exit)) assert.isTrue(Cause.hasInterruptsOnly(exit.cause));
      assert.strictEqual(id._listeners.size, 1);

      yield* Scope.close(renderScope, Exit.void);
      assert.strictEqual(id._listeners.size, 0);
    }).pipe(Effect.provide(Resource.ResourceRegistry.layer())),
  );

  scoped("should release an entry listener interrupted exactly at signal.subscribe", () =>
    Effect.gen(function* () {
      // Scope: the daemon is interrupted after installing its entry-state listener, then the key changes.
      // Assertion: the interrupted and switched daemons return listeners to zero; owner close clears params.
      const id = yield* Signal.make("1");
      const renderScope = yield* Scope.fork(yield* Effect.scope);
      const factory = Resource.make(
        ({ id }: { readonly id: string }) => Effect.succeed(`user-${id}`),
        { key: ({ id }) => `subscribe-interrupt:entry:${id}` },
      );
      const reader = Trace.makeRecordReader();
      let interrupted = false;
      const logger = reader.register(
        Logger.make<unknown, void>((options) => {
          const record = reader.read(options);
          if (
            !interrupted &&
            record !== null &&
            record !== undefined &&
            record.name === "signal.subscribe" &&
            record.payload?.signal_id !== id._debugId
          ) {
            interrupted = true;
            // oxlint-disable-next-line effect/no-effect-escape-hatch -- Deterministically injects interruption after Signal installed the entry listener.
            options.fiber.interruptUnsafe(202);
          }
        }),
      );

      const output = yield* Resource.fetch(factory, { id }).pipe(
        Scope.provide(renderScope),
        Effect.provideService(Signal.CurrentRenderScope, renderScope),
        Effect.provide(Logger.layer([logger])),
        Effect.provideService(References.MinimumLogLevel, "Trace"),
      );
      yield* TestClock.adjust(0);

      const registry = yield* Resource.ResourceRegistryTag;
      const firstEntry = yield* registry.get("subscribe-interrupt:entry:1");
      assert.isTrue(interrupted);
      assert.isTrue(Option.isSome(firstEntry));
      assert.strictEqual(id._listeners.size, 1);
      if (Option.isSome(firstEntry)) {
        assert.strictEqual(firstEntry.value.state._listeners.size, 0);
      }
      const firstOutput = yield* Signal.peek(output);
      assert.isTrue(Resource.isSuccess(firstOutput));

      yield* Signal.set(id, "2");
      yield* TestClock.adjust(0);
      const secondEntry = yield* registry.get("subscribe-interrupt:entry:2");
      assert.isTrue(Option.isSome(secondEntry));
      if (Option.isSome(firstEntry)) {
        assert.strictEqual(firstEntry.value.state._listeners.size, 0);
      }
      if (Option.isSome(secondEntry)) {
        assert.strictEqual(secondEntry.value.state._listeners.size, 1);
      }

      yield* Scope.close(renderScope, Exit.void);
      assert.strictEqual(id._listeners.size, 0);
      if (Option.isSome(secondEntry)) {
        assert.strictEqual(secondEntry.value.state._listeners.size, 0);
      }
    }).pipe(Effect.provide(Resource.ResourceRegistry.layer())),
  );
});

// =============================================================================
// Resource.fetch static render phase isolation
// =============================================================================
// CRITICAL: Resource.fetch(resource) must NOT register the returned state signal
// as a component dependency. If it does, component re-renders on Pending→Success,
// causing keyed-list teardown/remount race that blanks rendered items.

describe("Resource.fetch static render phase isolation", () => {
  scoped("should NOT register state signal in component render phase accessed set", () =>
    Effect.gen(function* () {
      const resource = Resource.make(() => Effect.succeed("data"), {
        key: "phase-isolation:static:1",
      });

      // Simulate component render phase
      const phase = yield* Signal.makeRenderPhase;

      const state = yield* Effect.provideService(
        Resource.fetch(resource),
        Signal.CurrentRenderPhase,
        phase,
      );
      yield* TestClock.adjust(0);

      // State signal should NOT be in the accessed set —
      // Resource.fetch should not leak state signal as component dependency
      assert.isFalse(
        phase.accessed.has(state),
        "state signal should not be registered as a component dependency",
      );
    }).pipe(Effect.provide(Resource.ResourceRegistry.layer())),
  );

  scoped("should NOT register state signal even when checking cached state", () =>
    Effect.gen(function* () {
      const resource = Resource.make(() => Effect.succeed("cached-data"), {
        key: "phase-isolation:static:2",
      });

      // First fetch outside render phase — populates cache
      yield* Resource.fetch(resource);
      yield* TestClock.adjust(0);

      // Second fetch inside render phase — should hit cache but NOT track
      const phase = yield* Signal.makeRenderPhase;

      const state = yield* Effect.provideService(
        Resource.fetch(resource),
        Signal.CurrentRenderPhase,
        phase,
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
    }).pipe(Effect.provide(Resource.ResourceRegistry.layer())),
  );
});

describe("Resource registry signal ownership", () => {
  scoped("should keep a shared entry alive when its first component owner unmounts", () =>
    Effect.gen(function* () {
      // Scope: registry state is shared across components but is first allocated during render.
      // Assertion: it occupies no component slot, survives the first owner, and emits no disposed access.
      const recorder = Trace.makeRecorder();
      const fetchCount = yield* Ref.make(0);
      const resource = Resource.make(() => Ref.updateAndGet(fetchCount, (count) => count + 1), {
        key: "ownership:shared-entry",
      });
      const parentScope = yield* Effect.scope;
      const firstComponentScope = yield* Scope.fork(parentScope);
      const secondComponentScope = yield* Scope.fork(parentScope);
      const firstPhase = yield* Signal.makeRenderPhase;
      const secondPhase = yield* Signal.makeRenderPhase;

      const { firstState, secondState } = yield* Trace.record(
        Effect.gen(function* () {
          const firstState = yield* Resource.fetch(resource).pipe(
            Scope.provide(firstComponentScope),
            Effect.provideService(Signal.CurrentComponentScope, firstComponentScope),
            Effect.provideService(Signal.CurrentRenderPhase, firstPhase),
          );
          yield* TestClock.adjust(0);

          const secondState = yield* Resource.fetch(resource).pipe(
            Scope.provide(secondComponentScope),
            Effect.provideService(Signal.CurrentComponentScope, secondComponentScope),
            Effect.provideService(Signal.CurrentRenderPhase, secondPhase),
          );

          yield* Scope.close(firstComponentScope, Exit.void);
          assert.isFalse(yield* Ref.get(firstState._disposed));

          yield* Resource.invalidate(resource);
          yield* TestClock.adjust(0);
          return { firstState, secondState };
        }),
        recorder,
      );

      assert.strictEqual(firstState, secondState);
      assert.strictEqual(firstPhase.signals.length, 0);
      assert.strictEqual(secondPhase.signals.length, 0);
      const current = yield* Signal.peek(secondState);
      assert.isTrue(Resource.isSuccess(current));
      if (Resource.isSuccess(current)) {
        assert.strictEqual(current.value, 2);
      }
      assert.isFalse(recorder.records().some((record) => record.name === "signal.disposed_access"));
    }).pipe(Effect.provide(Resource.ResourceRegistry.layer())),
  );
});

// =============================================================================
// Resource.fetch - Deduplication
// =============================================================================

describe("Resource.fetch deduplication", () => {
  scoped("should return same signal for same key", () =>
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
    }).pipe(Effect.provide(Resource.ResourceRegistry.layer())),
  );

  scoped("should only fetch once for same key", () =>
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
    }).pipe(Effect.provide(Resource.ResourceRegistry.layer())),
  );

  scoped("should claim one static flight under truly parallel callers", () =>
    Effect.gen(function* () {
      // Scope: parallel static fetches race on a previously unseen Pending entry.
      // Assertion: one fetch runs, every caller shares settlement, and the flight clears.
      const fetchCount = yield* Ref.make(0);
      const started = yield* Deferred.make<void>();
      const release = yield* Deferred.make<void>();
      const resource = Resource.make(
        () =>
          Effect.gen(function* () {
            yield* Ref.update(fetchCount, (count) => count + 1);
            yield* Deferred.succeed(started, undefined);
            yield* Deferred.await(release);
            return "shared";
          }),
        { key: "dedupe:parallel-static" },
      );

      const callers = yield* Effect.all(
        Array.from({ length: 16 }, () => Resource.fetch(resource)),
        { concurrency: "unbounded" },
      ).pipe(Effect.forkChild);

      yield* Deferred.await(started);
      assert.strictEqual(yield* Ref.get(fetchCount), 1);
      const registry = yield* Resource.ResourceRegistryTag;
      const maybeEntry = yield* registry.get(resource.key);
      assert.isTrue(Option.isSome(maybeEntry));

      yield* Deferred.succeed(release, undefined);
      const states = yield* Fiber.join(callers);
      const first = states[0];
      assert.isDefined(first);
      if (first !== undefined) {
        assert.isTrue(states.every((state) => state === first));
      }
      if (Option.isSome(maybeEntry)) {
        assert.isTrue(Option.isNone(yield* Ref.get(maybeEntry.value.inFlight)));
      }
    }).pipe(Effect.provide(Resource.ResourceRegistry.layer())),
  );

  scoped("should claim one invalidate flight under parallel invalidations", () =>
    Effect.gen(function* () {
      // Scope: stale-while-revalidate callers race after a cached success.
      // Assertion: one background refetch starts and the shared state settles once.
      const fetchCount = yield* Ref.make(0);
      const refetchStarted = yield* Deferred.make<void>();
      const release = yield* Deferred.make<void>();
      const resource = Resource.make(
        () =>
          Effect.gen(function* () {
            const count = yield* Ref.updateAndGet(fetchCount, (current) => current + 1);
            if (count > 1) {
              yield* Deferred.succeed(refetchStarted, undefined);
              yield* Deferred.await(release);
            }
            return count;
          }),
        { key: "dedupe:parallel-invalidate" },
      );

      const state = yield* Resource.fetch(resource);
      yield* TestClock.adjust(0);
      const callers = yield* Effect.all(
        Array.from({ length: 16 }, () => Resource.invalidate(resource)),
        { concurrency: "unbounded" },
      ).pipe(Effect.forkChild);

      yield* Deferred.await(refetchStarted);
      assert.strictEqual(yield* Ref.get(fetchCount), 2);
      yield* Fiber.join(callers);
      yield* Deferred.succeed(release, undefined);
      yield* TestClock.adjust(0);

      const current = yield* Signal.peek(state);
      assert.isTrue(Resource.isSuccess(current));
      if (Resource.isSuccess(current)) {
        assert.strictEqual(current.value, 2);
      }
    }).pipe(Effect.provide(Resource.ResourceRegistry.layer())),
  );

  scoped("should claim one refresh flight and make parallel refresh waiters share it", () =>
    Effect.gen(function* () {
      // Scope: hard-refresh callers race after a cached success.
      // Assertion: one refetch runs and all refresh effects complete from its Deferred.
      const fetchCount = yield* Ref.make(0);
      const refetchStarted = yield* Deferred.make<void>();
      const release = yield* Deferred.make<void>();
      const resource = Resource.make(
        () =>
          Effect.gen(function* () {
            const count = yield* Ref.updateAndGet(fetchCount, (current) => current + 1);
            if (count > 1) {
              yield* Deferred.succeed(refetchStarted, undefined);
              yield* Deferred.await(release);
            }
            return count;
          }),
        { key: "dedupe:parallel-refresh" },
      );

      yield* Resource.fetch(resource);
      yield* TestClock.adjust(0);
      const callers = yield* Effect.all(
        Array.from({ length: 16 }, () => Resource.refresh(resource)),
        { concurrency: "unbounded" },
      ).pipe(Effect.forkChild);

      yield* Deferred.await(refetchStarted);
      assert.strictEqual(yield* Ref.get(fetchCount), 2);
      yield* Deferred.succeed(release, undefined);
      yield* Fiber.join(callers);
      const registry = yield* Resource.ResourceRegistryTag;
      const maybeEntry = yield* registry.get(resource.key);
      if (Option.isSome(maybeEntry)) {
        assert.isTrue(Option.isNone(yield* Ref.get(maybeEntry.value.inFlight)));
      } else {
        assert.fail("expected refreshed entry");
      }
    }).pipe(Effect.provide(Resource.ResourceRegistry.layer())),
  );

  scoped("should claim one flight across concurrent reactive fetch machinery", () =>
    Effect.gen(function* () {
      // Scope: independent reactive outputs concurrently request the same unseen key.
      // Assertion: all outputs join one fetch and settle to the same success value.
      const fetchCount = yield* Ref.make(0);
      const started = yield* Deferred.make<void>();
      const release = yield* Deferred.make<void>();
      const factory = Resource.make(
        (params: { id: string }) =>
          Effect.gen(function* () {
            yield* Ref.update(fetchCount, (count) => count + 1);
            yield* Deferred.succeed(started, undefined);
            yield* Deferred.await(release);
            return `user-${params.id}`;
          }),
        { key: (params) => `dedupe:parallel-reactive:${params.id}` },
      );
      const id = yield* Signal.make("1");

      const outputs = yield* Effect.all(
        Array.from({ length: 12 }, () => Resource.fetch(factory, { id })),
        { concurrency: "unbounded" },
      );
      yield* Deferred.await(started);
      assert.strictEqual(yield* Ref.get(fetchCount), 1);
      yield* Deferred.succeed(release, undefined);
      yield* TestClock.adjust(0);

      for (const output of outputs) {
        const current = yield* Signal.peek(output);
        assert.isTrue(Resource.isSuccess(current));
        if (Resource.isSuccess(current)) {
          assert.strictEqual(current.value, "user-1");
        }
      }
    }).pipe(Effect.provide(Resource.ResourceRegistry.layer())),
  );
});

// =============================================================================
// Resource.invalidate - Stale-while-revalidate
// =============================================================================

describe("Resource.invalidate", () => {
  scoped("should mark state as stale and trigger refetch", () =>
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
    }).pipe(Effect.provide(Resource.ResourceRegistry.layer())),
  );

  scoped("should not invalidate non-existent resource", () =>
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
    }).pipe(Effect.provide(Resource.ResourceRegistry.layer())),
  );

  scoped("should preserve stale value on refetch failure", () =>
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
    }).pipe(Effect.provide(Resource.ResourceRegistry.layer())),
  );
});

describe("Resource fetch Cause classification", () => {
  scoped("should report each lone fatal Cause intact once and retry with a fresh entry", () =>
    Effect.gen(function* () {
      // Scope: no joiner observes the starter; a direct owner reporter receives its terminal Exit.
      // Assertion: typed Fail stays state-only, while Die/Interrupt/mixed reasons report once in order.
      const services = yield* Effect.context<never>();
      const reports: Array<Exit.Exit<unknown, unknown>> = [];
      let reportTarget: Deferred.Deferred<void> | null = null;
      const reporter: Resource.ResourceFetchExitReporter = (exit) => {
        reports.push(exit);
        if (reportTarget !== null) {
          Effect.runSyncWith(services)(
            Deferred.succeed(reportTarget, undefined).pipe(Effect.asVoid),
          );
        }
      };
      const reasonValues = (cause: Cause.Cause<unknown>): ReadonlyArray<unknown> =>
        cause.reasons.map((reason) => {
          if (Cause.isFailReason(reason)) return { _tag: reason._tag, error: reason.error };
          if (Cause.isDieReason(reason)) return { _tag: reason._tag, defect: reason.defect };
          return { _tag: reason._tag, fiberId: reason.fiberId };
        });

      const typed = Resource.make(() => Effect.fail("typed"), {
        key: "cause:reporter:typed",
      });
      const typedState = yield* Resource.fetch(typed).pipe(
        Effect.provideService(Resource.CurrentResourceFetchExitReporter, reporter),
      );
      yield* TestClock.adjust(0);
      const typedCurrent = yield* Signal.peek(typedState);
      assert.isTrue(Resource.isFailure(typedCurrent));
      if (Resource.isFailure(typedCurrent)) assert.strictEqual(typedCurrent.error, "typed");
      assert.strictEqual(reports.length, 0);

      const runFatal = Effect.fnUntraced(function* (
        key: string,
        expectedCause: Cause.Cause<string>,
      ) {
        const runs = yield* Ref.make(0);
        const reported = yield* Deferred.make<void>();
        reportTarget = reported;
        const resource = Resource.make(
          () =>
            Ref.updateAndGet(runs, (count) => count + 1).pipe(
              Effect.flatMap((run) =>
                run === 1 ? Effect.failCause(expectedCause) : Effect.succeed("recovered"),
              ),
            ),
          { key },
        );
        const reportIndex = reports.length;

        const first = yield* Resource.fetch(resource).pipe(
          Effect.provideService(Resource.CurrentResourceFetchExitReporter, reporter),
        );
        yield* Deferred.await(reported);
        yield* TestClock.adjust(0);

        assert.strictEqual(reports.length, reportIndex + 1);
        const observed = reports[reportIndex];
        assert.isDefined(observed);
        assert.isTrue(observed !== undefined && Exit.isFailure(observed));
        if (observed !== undefined && Exit.isFailure(observed)) {
          assert.deepStrictEqual(reasonValues(observed.cause), reasonValues(expectedCause));
        }
        const registry = yield* Resource.ResourceRegistryTag;
        assert.isTrue(Option.isNone(yield* registry.get(key)));

        const recovered = yield* Resource.fetch(resource).pipe(
          Effect.provideService(Resource.CurrentResourceFetchExitReporter, reporter),
        );
        yield* TestClock.adjust(0);
        assert.notStrictEqual(recovered, first);
        const current = yield* Signal.peek(recovered);
        assert.isTrue(Resource.isSuccess(current));
        if (Resource.isSuccess(current)) assert.strictEqual(current.value, "recovered");
        assert.strictEqual(reports.length, reportIndex + 1);
        reportTarget = null;
      });

      yield* runFatal("cause:reporter:defect", Cause.die("boom"));
      yield* runFatal("cause:reporter:interrupt", Cause.interrupt(303));
      yield* runFatal(
        "cause:reporter:mixed",
        Cause.combine(Cause.fail("expected"), Cause.die("mixed-boom")),
      );
    }).pipe(Effect.provide(Resource.ResourceRegistry.layer())),
  );

  scoped("should report every lone starter terminal once and retire fatal Pending entries", () =>
    Effect.gen(function* () {
      // Scope: no second fetch joins the first flight; its owner must classify the terminal itself.
      // Assertion: one terminal event is emitted, typed failure becomes state, and fatal keys retry fresh.
      type TerminalEvent =
        | "resource.fetch.set_failure"
        | "resource.fetch.interrupted"
        | "resource.fetch.unhandled";

      const observe = Effect.fn("Resource.test.observeLoneCause")(function* <E>(
        key: string,
        terminal: Effect.Effect<never, E>,
        expectedEvent: TerminalEvent,
        retires: boolean,
      ) {
        const runs = yield* Ref.make(0);
        const finished = yield* Deferred.make<void>();
        const resource = Resource.make(
          () =>
            Effect.gen(function* () {
              const run = yield* Ref.updateAndGet(runs, (count) => count + 1);
              if (run === 1) {
                return yield* terminal.pipe(Effect.ensuring(Deferred.succeed(finished, undefined)));
              }
              return "recovered";
            }),
          { key },
        );
        const recorder = Trace.makeRecorder();

        const first = yield* Trace.record(
          Effect.gen(function* () {
            const state = yield* Resource.fetch(resource);
            yield* Deferred.await(finished);
            const registry = yield* Resource.ResourceRegistryTag;
            while (true) {
              const terminal = retires
                ? Option.isNone(yield* registry.get(resource.key))
                : !Resource.isPending(yield* Signal.peek(state));
              if (terminal) break;
              yield* Effect.yieldNow;
            }
            return state;
          }),
          recorder,
        );
        const terminalEvents = recorder
          .records()
          .filter(
            (record) =>
              record.name === "resource.fetch.set_failure" ||
              record.name === "resource.fetch.interrupted" ||
              record.name === "resource.fetch.unhandled",
          )
          .map((record) => record.name);
        assert.deepStrictEqual(terminalEvents, [expectedEvent]);

        if (retires) {
          const registry = yield* Resource.ResourceRegistryTag;
          assert.isTrue(Option.isNone(yield* registry.get(resource.key)));

          const recovered = yield* Resource.fetch(resource);
          yield* TestClock.adjust(0);
          assert.notStrictEqual(recovered, first);
          const recoveredState = yield* Signal.peek(recovered);
          assert.isTrue(Resource.isSuccess(recoveredState));
          if (Resource.isSuccess(recoveredState)) {
            assert.strictEqual(recoveredState.value, "recovered");
          }
        }

        return yield* Signal.peek(first);
      });

      const typed = yield* observe(
        "cause:lone:typed",
        Effect.fail("expected"),
        "resource.fetch.set_failure",
        false,
      );
      assert.isTrue(Resource.isFailure(typed));
      if (Resource.isFailure(typed)) assert.strictEqual(typed.error, "expected");

      yield* observe(
        "cause:lone:defect",
        Effect.failCause(Cause.die("boom")),
        "resource.fetch.unhandled",
        true,
      );
      yield* observe("cause:lone:interrupt", Effect.interrupt, "resource.fetch.interrupted", true);
      yield* observe(
        "cause:lone:mixed",
        Effect.failCause(Cause.combine(Cause.fail("expected"), Cause.die("mixed-boom"))),
        "resource.fetch.unhandled",
        true,
      );
    }).pipe(
      Effect.provideService(Resource.CurrentResourceFetchExitReporter, () => {}),
      Effect.provide(Resource.ResourceRegistry.layer()),
    ),
  );

  scoped("should preserve defect, interrupt, and mixed Causes through the shared Deferred", () =>
    Effect.gen(function* () {
      // Scope: a shared-flight waiter observes each descriptor termination class.
      // Assertion: typed failure becomes state; all unrecoverable Causes retain their distinct Exit shape.
      const observe = Effect.fn("Resource.test.observeCause")(function* <E>(
        key: string,
        terminal: Effect.Effect<never, E>,
      ) {
        const fetchCount = yield* Ref.make(0);
        const started = yield* Deferred.make<void>();
        const release = yield* Deferred.make<void>();
        const resource = Resource.make(
          () =>
            Effect.gen(function* () {
              yield* Ref.update(fetchCount, (count) => count + 1);
              yield* Deferred.succeed(started, undefined);
              yield* Deferred.await(release);
              return yield* terminal;
            }),
          { key },
        );

        const state = yield* Resource.fetch(resource);
        yield* Deferred.await(started);
        const waiter = yield* Resource.fetch(resource).pipe(Effect.exit, Effect.forkChild);
        yield* TestClock.adjust(0);
        assert.strictEqual(yield* Ref.get(fetchCount), 1);
        yield* Deferred.succeed(release, undefined);
        const exit = yield* Fiber.join(waiter);
        const registry = yield* Resource.ResourceRegistryTag;
        return {
          admitted: yield* registry.get(resource.key),
          exit,
          state: yield* Signal.peek(state),
        };
      });

      const typed = yield* observe("cause:typed", Effect.fail("expected"));
      assert.isTrue(Exit.isSuccess(typed.exit));
      assert.isTrue(Resource.isFailure(typed.state));
      if (Resource.isFailure(typed.state)) {
        assert.strictEqual(typed.state.error, "expected");
      }
      assert.isTrue(Option.isSome(typed.admitted));

      const defect = yield* observe("cause:defect", Effect.failCause(Cause.die("boom")));
      assert.isTrue(Exit.isFailure(defect.exit));
      if (Exit.isFailure(defect.exit)) {
        assert.isTrue(Cause.hasDies(defect.exit.cause));
        assert.isFalse(Cause.hasInterrupts(defect.exit.cause));
      }
      assert.isTrue(Option.isNone(defect.admitted));

      const interrupted = yield* observe("cause:interrupt", Effect.interrupt);
      assert.isTrue(Exit.isFailure(interrupted.exit));
      if (Exit.isFailure(interrupted.exit)) {
        assert.isTrue(Cause.hasInterruptsOnly(interrupted.exit.cause));
      }
      assert.isTrue(Option.isNone(interrupted.admitted));

      const mixedCause = Cause.combine(Cause.fail("expected"), Cause.die("mixed-boom"));
      const mixed = yield* observe("cause:mixed", Effect.failCause(mixedCause));
      assert.isTrue(Exit.isFailure(mixed.exit));
      if (Exit.isFailure(mixed.exit)) {
        assert.isTrue(Cause.hasFails(mixed.exit.cause));
        assert.isTrue(Cause.hasDies(mixed.exit.cause));
      }
      assert.isTrue(Option.isNone(mixed.admitted));
    }).pipe(
      Effect.provideService(Resource.CurrentResourceFetchExitReporter, () => {}),
      Effect.provide(Resource.ResourceRegistry.layer()),
    ),
  );
});

// =============================================================================
// Resource.refresh - Hard reload
// =============================================================================

describe("Resource.refresh", () => {
  scoped("should transition to Pending and refetch", () =>
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
    }).pipe(Effect.provide(Resource.ResourceRegistry.layer())),
  );

  scoped("should refetch after initial fetch completes", () =>
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
    }).pipe(Effect.provide(Resource.ResourceRegistry.layer())),
  );
});

// =============================================================================
// Resource.clear
// =============================================================================

describe("Resource.clear", () => {
  scoped("should remove resource from cache", () =>
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
    }).pipe(Effect.provide(Resource.ResourceRegistry.layer())),
  );

  scoped("should interrupt in-flight fetch when clearing cache", () =>
    Effect.gen(function* () {
      const gate = yield* Deferred.make<void>();
      const interrupted = yield* Ref.make(false);

      const resource = Resource.make(
        () =>
          Deferred.await(gate).pipe(
            Effect.onInterrupt(() => Ref.set(interrupted, true)),
            Effect.as("done"),
          ),
        { key: "clear:interrupt" },
      );

      yield* Resource.fetch(resource);
      yield* TestClock.adjust(0);

      yield* Resource.clear(resource);
      yield* TestClock.adjust(0);

      assert.isTrue(yield* Ref.get(interrupted));
    }).pipe(Effect.provide(Resource.ResourceRegistry.layer())),
  );

  scoped("should not publish interruption failure to cleared state", () =>
    Effect.gen(function* () {
      const gate = yield* Deferred.make<void>();

      const resource = Resource.make(() => Deferred.await(gate).pipe(Effect.as("done")), {
        key: "clear:no-failure",
      });

      const state = yield* Resource.fetch(resource);
      yield* TestClock.adjust(0);

      yield* Resource.clear(resource);
      yield* TestClock.adjust(0);

      const current = yield* Signal.get(state);
      assert.strictEqual(current._tag, "Pending");
    }).pipe(Effect.provide(Resource.ResourceRegistry.layer())),
  );
});

describe("Resource registry eviction policy", () => {
  scoped("should retry a new static fetch retired between its lease and flight claim", () =>
    Effect.gen(function* () {
      // Scope: a TTL=0 barrier retires the first generation after consumer lease acquisition.
      // Assertion: the stale lease releases, a fresh generation runs once, and no Pending is stranded.
      const key = "policy:ttl-flight-race:static";
      const barrier = yield* Deferred.make<void>();
      const runs = yield* Ref.make(0);
      const registry = yield* Resource.ResourceRegistryTag;
      const wrapped = yield* expireAfterFirstLease(registry, key, barrier);
      const resource = Resource.make(
        () => Ref.updateAndGet(runs, (count) => count + 1).pipe(Effect.as("resolved")),
        { key },
      );

      const state = yield* Resource.fetch(resource).pipe(
        Effect.provideService(Resource.ResourceRegistryTag, wrapped),
      );
      assert.isTrue(yield* Deferred.isDone(barrier));
      yield* TestClock.adjust(0);

      const current = yield* Signal.peek(state);
      assert.isTrue(Resource.isSuccess(current));
      if (Resource.isSuccess(current)) assert.strictEqual(current.value, "resolved");
      assert.strictEqual(yield* Ref.get(runs), 1);
    }).pipe(Effect.provide(Resource.ResourceRegistry.layer({ capacity: 1, timeToLive: 0 }))),
  );

  scoped("should retry a new reactive fetch retired between its lease and flight claim", () =>
    Effect.gen(function* () {
      // Scope: reactive admission hits the same deterministic TTL=0 lease/claim boundary.
      // Assertion: the daemon follows a fresh generation and publishes Success rather than Pending forever.
      const key = "policy:ttl-flight-race:reactive";
      const barrier = yield* Deferred.make<void>();
      const runs = yield* Ref.make(0);
      const registry = yield* Resource.ResourceRegistryTag;
      const wrapped = yield* expireAfterFirstLease(registry, key, barrier);
      const id = yield* Signal.make("1");
      const factory = Resource.make(
        ({ id }: { readonly id: string }) =>
          Ref.updateAndGet(runs, (count) => count + 1).pipe(Effect.as(`resolved-${id}`)),
        { key: () => key },
      );

      const state = yield* Resource.fetch(factory, { id }).pipe(
        Effect.provideService(Resource.ResourceRegistryTag, wrapped),
      );
      assert.isTrue(yield* Deferred.isDone(barrier));
      yield* TestClock.adjust(0);

      const current = yield* Signal.peek(state);
      assert.isTrue(Resource.isSuccess(current));
      if (Resource.isSuccess(current)) assert.strictEqual(current.value, "resolved-1");
      assert.strictEqual(yield* Ref.get(runs), 1);
    }).pipe(Effect.provide(Resource.ResourceRegistry.layer({ capacity: 1, timeToLive: 0 }))),
  );

  scoped("should enforce LRU capacity and dispose the evicted entry once", () =>
    Effect.gen(function* () {
      // Scope: a capacity-two registry receives three keys after refreshing A's recency.
      // Assertion: B alone is evicted, its signal is disposed, and A/C remain addressable.
      const resourceA = Resource.make(() => Effect.succeed("A"), { key: "policy:lru:a" });
      const resourceB = Resource.make(() => Effect.succeed("B"), { key: "policy:lru:b" });
      const resourceC = Resource.make(() => Effect.succeed("C"), { key: "policy:lru:c" });
      const parentScope = yield* Effect.scope;
      const consumerA = yield* Scope.fork(parentScope);
      const consumerB = yield* Scope.fork(parentScope);
      const consumerC = yield* Scope.fork(parentScope);

      const stateA = yield* Resource.fetch(resourceA).pipe(Scope.provide(consumerA));
      const stateB = yield* Resource.fetch(resourceB).pipe(Scope.provide(consumerB));
      yield* TestClock.adjust(0);
      yield* Scope.close(consumerB, Exit.void);
      yield* Resource.fetch(resourceA).pipe(Scope.provide(consumerA));
      yield* Resource.fetch(resourceC).pipe(Scope.provide(consumerC));
      yield* TestClock.adjust(0);

      const registry = yield* Resource.ResourceRegistryTag;
      assert.isTrue(Option.isSome(yield* registry.get(resourceA.key)));
      assert.isTrue(Option.isNone(yield* registry.get(resourceB.key)));
      assert.isTrue(Option.isSome(yield* registry.get(resourceC.key)));
      assert.isFalse(yield* Ref.get(stateA._disposed));
      assert.isTrue(yield* Ref.get(stateB._disposed));
    }).pipe(Effect.provide(Resource.ResourceRegistry.layer({ capacity: 2, timeToLive: "1 hour" }))),
  );

  scoped("should expire idle entries at the TTL boundary using TestClock", () =>
    Effect.gen(function* () {
      // Scope: one completed entry reaches its exact configured idle TTL.
      // Assertion: the next fetch recreates it, disposes the old signal, and runs I/O again.
      const fetchCount = yield* Ref.make(0);
      const resource = Resource.make(() => Ref.updateAndGet(fetchCount, (count) => count + 1), {
        key: "policy:ttl",
      });
      const parentScope = yield* Effect.scope;
      const firstConsumer = yield* Scope.fork(parentScope);
      const secondConsumer = yield* Scope.fork(parentScope);

      const first = yield* Resource.fetch(resource).pipe(Scope.provide(firstConsumer));
      yield* TestClock.adjust(0);
      yield* Scope.close(firstConsumer, Exit.void);
      yield* TestClock.adjust(100);
      const second = yield* Resource.fetch(resource).pipe(Scope.provide(secondConsumer));
      yield* TestClock.adjust(0);

      assert.notStrictEqual(first, second);
      assert.isTrue(yield* Ref.get(first._disposed));
      assert.strictEqual(yield* Ref.get(fetchCount), 2);
    }).pipe(Effect.provide(Resource.ResourceRegistry.layer({ capacity: 4, timeToLive: 100 }))),
  );

  scoped("should reject admission while an in-flight entry owns the only slot", () =>
    Effect.gen(function* () {
      // Scope: a shared fetch keeps its own lease after its static consumer releases.
      // Assertion: another key fails immediately, then succeeds after the flight releases its slot.
      const started = yield* Deferred.make<void>();
      const release = yield* Deferred.make<void>();
      const resourceA = Resource.make(
        () =>
          Effect.gen(function* () {
            yield* Deferred.succeed(started, undefined);
            yield* Deferred.await(release);
            return "A";
          }),
        { key: "policy:in-flight:a" },
      );
      const resourceB = Resource.make(() => Effect.succeed("B"), {
        key: "policy:in-flight:b",
      });
      const parentScope = yield* Effect.scope;
      const firstConsumer = yield* Scope.fork(parentScope);
      const secondConsumer = yield* Scope.fork(parentScope);

      const stateA = yield* Resource.fetch(resourceA).pipe(Scope.provide(firstConsumer));
      yield* Deferred.await(started);
      yield* Scope.close(firstConsumer, Exit.void);

      const saturated = yield* Resource.fetch(resourceB).pipe(
        Scope.provide(secondConsumer),
        Effect.exit,
      );
      assert.isTrue(Exit.isFailure(saturated));
      if (Exit.isFailure(saturated)) {
        const error = Cause.squash(saturated.cause);
        assert.instanceOf(error, Resource.ResourceRegistrySaturatedError);
        if (error instanceof Resource.ResourceRegistrySaturatedError) {
          assert.strictEqual(error.capacity, 1);
          assert.strictEqual(error.key, resourceB.key);
        }
      }
      assert.isFalse(yield* Ref.get(stateA._disposed));

      yield* Deferred.succeed(release, undefined);
      yield* TestClock.adjust(0);
      const stateB = yield* Resource.fetch(resourceB).pipe(Scope.provide(secondConsumer));
      yield* TestClock.adjust(0);

      assert.isTrue(yield* Ref.get(stateA._disposed));
      const current = yield* Signal.peek(stateB);
      assert.isTrue(Resource.isSuccess(current));
      if (Resource.isSuccess(current)) assert.strictEqual(current.value, "B");
    }).pipe(Effect.provide(Resource.ResourceRegistry.layer({ capacity: 1, timeToLive: "1 hour" }))),
  );

  scoped("should count a TTL-retired static lease until its owner releases", () =>
    Effect.gen(function* () {
      // Scope: expiration removes A from lookup while its static owner still leases the old Signal.
      // Assertion: the retired lease consumes capacity until release, without disposing A early.
      const resourceA = Resource.make(() => Effect.succeed("A"), {
        key: "policy:retired-lease:a",
      });
      const resourceB = Resource.make(() => Effect.succeed("B"), {
        key: "policy:retired-lease:b",
      });
      const parentScope = yield* Effect.scope;
      const firstConsumer = yield* Scope.fork(parentScope);
      const secondConsumer = yield* Scope.fork(parentScope);

      const stateA = yield* Resource.fetch(resourceA).pipe(Scope.provide(firstConsumer));
      yield* TestClock.adjust(0);
      yield* TestClock.adjust(100);
      const registry = yield* Resource.ResourceRegistryTag;
      yield* registry.get("policy:retired-lease:missing");

      assert.isTrue(Option.isNone(yield* registry.get(resourceA.key)));
      assert.isFalse(yield* Ref.get(stateA._disposed));
      const saturated = yield* Resource.fetch(resourceB).pipe(
        Scope.provide(secondConsumer),
        Effect.exit,
      );
      assert.isTrue(Exit.isFailure(saturated));
      if (Exit.isFailure(saturated)) {
        assert.instanceOf(Cause.squash(saturated.cause), Resource.ResourceRegistrySaturatedError);
      }
      const refreshSaturated = yield* Resource.refresh(resourceB).pipe(Effect.exit);
      assert.isTrue(Exit.isFailure(refreshSaturated));
      if (Exit.isFailure(refreshSaturated)) {
        assert.instanceOf(
          Cause.squash(refreshSaturated.cause),
          Resource.ResourceRegistrySaturatedError,
        );
      }
      const reactiveB = Resource.make(({ id }: { readonly id: string }) => Effect.succeed(id), {
        key: () => resourceB.key,
      });
      const reactiveSaturated = yield* Resource.fetch(reactiveB, { id: "B" }).pipe(Effect.exit);
      assert.isTrue(Exit.isFailure(reactiveSaturated));
      if (Exit.isFailure(reactiveSaturated)) {
        assert.instanceOf(
          Cause.squash(reactiveSaturated.cause),
          Resource.ResourceRegistrySaturatedError,
        );
      }

      yield* Scope.close(firstConsumer, Exit.void);
      assert.isTrue(yield* Ref.get(stateA._disposed));
      const stateB = yield* Resource.fetch(resourceB).pipe(Scope.provide(secondConsumer));
      yield* TestClock.adjust(0);
      const current = yield* Signal.peek(stateB);
      assert.isTrue(Resource.isSuccess(current));
      if (Resource.isSuccess(current)) assert.strictEqual(current.value, "B");
    }).pipe(Effect.provide(Resource.ResourceRegistry.layer({ capacity: 1, timeToLive: 100 }))),
  );

  scoped("should force clear every TTL-retired generation and free capacity", () =>
    Effect.gen(function* () {
      // Scope: one key has a leased TTL-retired generation plus a newer cached generation.
      // Assertion: clear disposes both once, releases both slots, and later lease release is inert.
      const recorder = Trace.makeRecorder();
      yield* Trace.record(
        Effect.gen(function* () {
          const resourceA = Resource.make(() => Effect.succeed("A"), {
            key: "policy:force-clear-generations:a",
          });
          const resourceB = Resource.make(() => Effect.succeed("B"), {
            key: "policy:force-clear-generations:b",
          });
          const parentScope = yield* Effect.scope;
          const firstConsumer = yield* Scope.fork(parentScope);
          const secondConsumer = yield* Scope.fork(parentScope);
          const bConsumer = yield* Scope.fork(parentScope);

          const first = yield* Resource.fetch(resourceA).pipe(Scope.provide(firstConsumer));
          yield* TestClock.adjust(0);
          yield* TestClock.adjust(100);
          const registry = yield* Resource.ResourceRegistryTag;
          yield* registry.get("policy:force-clear-generations:expiry-barrier");
          assert.isTrue(Option.isNone(yield* registry.get(resourceA.key)));
          assert.isFalse(yield* Ref.get(first._disposed));

          const second = yield* Resource.fetch(resourceA).pipe(Scope.provide(secondConsumer));
          yield* TestClock.adjust(0);
          assert.notStrictEqual(second, first);
          const saturated = yield* Resource.fetch(resourceB).pipe(
            Scope.provide(bConsumer),
            Effect.exit,
          );
          assert.isTrue(Exit.isFailure(saturated));
          if (Exit.isFailure(saturated)) {
            assert.instanceOf(
              Cause.squash(saturated.cause),
              Resource.ResourceRegistrySaturatedError,
            );
          }

          yield* Resource.clear(resourceA);
          assert.isTrue(yield* Ref.get(first._disposed));
          assert.isTrue(yield* Ref.get(second._disposed));
          assert.isTrue(Option.isNone(yield* registry.get(resourceA.key)));

          const stateB = yield* Resource.fetch(resourceB).pipe(Scope.provide(bConsumer));
          yield* TestClock.adjust(0);
          const currentB = yield* Signal.peek(stateB);
          assert.isTrue(Resource.isSuccess(currentB));
          if (Resource.isSuccess(currentB)) assert.strictEqual(currentB.value, "B");

          yield* Scope.close(firstConsumer, Exit.void);
          yield* Scope.close(secondConsumer, Exit.void);
          assert.strictEqual(
            recorder.records().filter((record) => record.name === "signal.dispose").length,
            2,
          );
        }),
        recorder,
      );
    }).pipe(Effect.provide(Resource.ResourceRegistry.layer({ capacity: 2, timeToLive: 100 }))),
  );

  scoped("should publish reactive key-change saturation as Failure with stale data", () =>
    Effect.gen(function* () {
      // Scope: another static owner keeps the reactive fetch's previous key at capacity.
      // Assertion: a key change publishes typed saturation, preserves stale data, and later recovers.
      const id = yield* Signal.make("1");
      const factory = Resource.make(
        ({ id }: { readonly id: string }) => Effect.succeed(`user-${id}`),
        { key: ({ id }) => `policy:reactive-saturation:${id}` },
      );
      const parentScope = yield* Effect.scope;
      const staticConsumer = yield* Scope.fork(parentScope);

      const output = yield* Resource.fetch(factory, { id });
      yield* TestClock.adjust(0);
      yield* Resource.fetch(factory({ id: "1" })).pipe(Scope.provide(staticConsumer));

      yield* Signal.set(id, "2");
      yield* TestClock.adjust(0);
      const failed = yield* Signal.peek(output);
      assert.isTrue(Resource.isFailure(failed));
      if (Resource.isFailure(failed)) {
        assert.instanceOf(failed.error, Resource.ResourceRegistrySaturatedError);
        assert.isTrue(Option.isSome(failed.staleValue));
        if (Option.isSome(failed.staleValue)) {
          assert.strictEqual(failed.staleValue.value, "user-1");
        }
      }

      yield* Scope.close(staticConsumer, Exit.void);
      yield* Signal.set(id, "3");
      yield* TestClock.adjust(0);
      const recovered = yield* Signal.peek(output);
      assert.isTrue(Resource.isSuccess(recovered));
      if (Resource.isSuccess(recovered)) assert.strictEqual(recovered.value, "user-3");
    }).pipe(Effect.provide(Resource.ResourceRegistry.layer({ capacity: 1, timeToLive: "1 hour" }))),
  );

  scoped("should count a reserved candidate and close it when interrupted before commit", () =>
    Effect.gen(function* () {
      // Scope: admission is interrupted at the Clock read after candidate allocation.
      // Assertion: the reservation rejects another key, then cancellation disposes it and frees the slot.
      const recorder = Trace.makeRecorder();
      const clockReads = yield* Ref.make(0);
      const candidateReady = yield* Deferred.make<void>();
      const clock: Clock.Clock = {
        currentTimeMillisUnsafe: () => 0,
        currentTimeMillis: Ref.updateAndGet(clockReads, (count) => count + 1).pipe(
          Effect.flatMap((read) =>
            read === 2
              ? Deferred.succeed(candidateReady, undefined).pipe(Effect.andThen(Effect.never))
              : Effect.succeed(0),
          ),
        ),
        currentTimeNanosUnsafe: () => 0n,
        currentTimeNanos: Effect.succeed(0n),
        monotonicTimeNanosUnsafe: () => 0n,
        monotonicTimeNanos: Effect.succeed(0n),
        sleep: () => Effect.void,
      };

      yield* Trace.record(
        Effect.gen(function* () {
          const registry = yield* Resource.ResourceRegistryTag;
          const candidate = yield* registry
            .getOrCreate("policy:candidate:a")
            .pipe(Effect.provideService(Clock.Clock, clock), Effect.forkChild);
          yield* Deferred.await(candidateReady);

          const saturated = yield* registry
            .getOrCreate("policy:candidate:b")
            .pipe(Effect.provideService(Clock.Clock, clock), Effect.exit);
          assert.isTrue(Exit.isFailure(saturated));
          if (Exit.isFailure(saturated)) {
            assert.instanceOf(
              Cause.squash(saturated.cause),
              Resource.ResourceRegistrySaturatedError,
            );
          }

          yield* Fiber.interrupt(candidate);
          const candidateExit = yield* Fiber.await(candidate);
          assert.isTrue(Exit.isFailure(candidateExit));
          if (Exit.isFailure(candidateExit)) {
            assert.isTrue(Cause.hasInterruptsOnly(candidateExit.cause));
          }
          assert.isTrue(Option.isNone(yield* registry.get("policy:candidate:a")));
          assert.strictEqual(
            recorder.records().filter((record) => record.name === "signal.dispose").length,
            1,
          );

          yield* registry
            .getOrCreate("policy:candidate:b")
            .pipe(Effect.provideService(Clock.Clock, clock));
          assert.isTrue(Option.isSome(yield* registry.get("policy:candidate:b")));
        }),
        recorder,
      );
    }).pipe(Effect.provide(Resource.ResourceRegistry.layer({ capacity: 1, timeToLive: "1 hour" }))),
  );

  scoped("should finish an interrupted removed batch before freeing its slots", () =>
    Effect.gen(function* () {
      // Scope: one TTL lookup removes two entries, then blocks in the first entry finalizer.
      // Assertion: interruption cannot skip either cleanup, and closing entries consume capacity.
      const resourceA = Resource.make(() => Effect.succeed("A"), {
        key: "policy:batch:a",
      });
      const resourceB = Resource.make(() => Effect.succeed("B"), {
        key: "policy:batch:b",
      });
      const parentScope = yield* Effect.scope;
      const consumerA = yield* Scope.fork(parentScope);
      const consumerB = yield* Scope.fork(parentScope);
      const stateA = yield* Resource.fetch(resourceA).pipe(Scope.provide(consumerA));
      const stateB = yield* Resource.fetch(resourceB).pipe(Scope.provide(consumerB));
      yield* TestClock.adjust(0);
      yield* Scope.close(consumerA, Exit.void);
      yield* Scope.close(consumerB, Exit.void);

      const registry = yield* Resource.ResourceRegistryTag;
      const entryA = yield* registry.get(resourceA.key);
      const entryB = yield* registry.get(resourceB.key);
      assert.isTrue(Option.isSome(entryA));
      assert.isTrue(Option.isSome(entryB));
      if (Option.isNone(entryA) || Option.isNone(entryB)) {
        return yield* Effect.fail("expected batch entries");
      }

      const firstFinalizerStarted = yield* Deferred.make<void>();
      const releaseFirstFinalizer = yield* Deferred.make<void>();
      const finalizedA = yield* Ref.make(0);
      const finalizedB = yield* Ref.make(0);
      yield* Scope.addFinalizer(
        entryA.value.scope,
        Effect.gen(function* () {
          yield* Deferred.succeed(firstFinalizerStarted, undefined);
          yield* Deferred.await(releaseFirstFinalizer);
          yield* Ref.update(finalizedA, (count) => count + 1);
        }),
      );
      yield* Scope.addFinalizer(
        entryB.value.scope,
        Ref.update(finalizedB, (count) => count + 1),
      );

      yield* TestClock.adjust(100);
      const cleanup = yield* registry.get("policy:batch:missing").pipe(Effect.forkChild);
      yield* Deferred.await(firstFinalizerStarted);
      const interrupting = yield* Fiber.interrupt(cleanup).pipe(Effect.forkChild);
      yield* TestClock.adjust(0);

      const saturated = yield* registry.getOrCreate("policy:batch:c").pipe(Effect.exit);
      assert.isTrue(Exit.isFailure(saturated));
      if (Exit.isFailure(saturated)) {
        assert.instanceOf(Cause.squash(saturated.cause), Resource.ResourceRegistrySaturatedError);
      }

      yield* Deferred.succeed(releaseFirstFinalizer, undefined);
      yield* Fiber.join(interrupting);
      const cleanupExit = yield* Fiber.await(cleanup);
      assert.isTrue(Exit.isFailure(cleanupExit));
      if (Exit.isFailure(cleanupExit)) {
        assert.isTrue(Cause.hasInterruptsOnly(cleanupExit.cause));
      }
      assert.strictEqual(yield* Ref.get(finalizedA), 1);
      assert.strictEqual(yield* Ref.get(finalizedB), 1);
      assert.isTrue(yield* Ref.get(stateA._disposed));
      assert.isTrue(yield* Ref.get(stateB._disposed));

      yield* registry.getOrCreate("policy:batch:c");
      assert.isTrue(Option.isSome(yield* registry.get("policy:batch:c")));
    }).pipe(Effect.provide(Resource.ResourceRegistry.layer({ capacity: 2, timeToLive: 100 }))),
  );

  scoped("should reject a non-positive capacity policy", () =>
    Effect.gen(function* () {
      // Scope: policy validation rejects an unusable zero-entry registry.
      // Assertion: layer construction fails with ResourceRegistryOptionsError.
      const exit = yield* Resource.ResourceRegistryTag.pipe(
        Effect.provide(Resource.ResourceRegistry.layer({ capacity: 0, timeToLive: "1 second" })),
        Effect.exit,
      );

      assert.isTrue(Exit.isFailure(exit));
      if (Exit.isFailure(exit)) {
        assert.instanceOf(Cause.squash(exit.cause), Resource.ResourceRegistryOptionsError);
      }
    }),
  );
});

describe("Resource registry scope closure", () => {
  scoped("should recreate A and operate on B while A's old finalizer is blocked", () =>
    Effect.gen(function* () {
      // Scope: clear removes A while its interrupted fetch finalizer waits on a Deferred.
      // Assertion: A recreation and B lookup finish before release; the old cleanup runs once.
      const runs = yield* Ref.make(0);
      const cleanups = yield* Ref.make(0);
      const finalizerStarted = yield* Deferred.make<void>();
      const releaseFinalizer = yield* Deferred.make<void>();
      const resourceA = Resource.make(
        () =>
          Effect.gen(function* () {
            const run = yield* Ref.updateAndGet(runs, (count) => count + 1);
            if (run === 1) {
              return yield* Effect.never.pipe(
                Effect.ensuring(
                  Effect.gen(function* () {
                    yield* Ref.update(cleanups, (count) => count + 1);
                    yield* Deferred.succeed(finalizerStarted, undefined);
                    yield* Deferred.await(releaseFinalizer);
                  }),
                ),
              );
            }
            return `A-${run}`;
          }),
        { key: "closure:outside-lock:a" },
      );
      const resourceB = Resource.make(() => Effect.succeed("B"), {
        key: "closure:outside-lock:b",
      });

      const oldA = yield* Resource.fetch(resourceA);
      yield* TestClock.adjust(0);
      const clearFiber = yield* Resource.clear(resourceA).pipe(Effect.forkChild);
      yield* Deferred.await(finalizerStarted);

      const recreatedReturned =
        yield* Deferred.make<Signal.Signal<Resource.ResourceState<string, never>>>();
      const bReturned = yield* Deferred.make<void>();
      const recreateFiber = yield* Resource.fetch(resourceA).pipe(
        Effect.tap((state) => Deferred.succeed(recreatedReturned, state)),
        Effect.forkChild,
      );
      const bFiber = yield* Resource.fetch(resourceB).pipe(
        Effect.tap(() => Deferred.succeed(bReturned, undefined)),
        Effect.forkChild,
      );
      yield* TestClock.adjust(0);

      const recreatedBeforeRelease = yield* Deferred.isDone(recreatedReturned);
      const bBeforeRelease = yield* Deferred.isDone(bReturned);
      yield* Deferred.succeed(releaseFinalizer, undefined);
      yield* Fiber.join(clearFiber);
      const newA = yield* Fiber.join(recreateFiber);
      yield* Fiber.join(bFiber);
      yield* TestClock.adjust(0);

      assert.isTrue(recreatedBeforeRelease);
      assert.isTrue(bBeforeRelease);
      assert.notStrictEqual(oldA, newA);
      assert.strictEqual(yield* Ref.get(cleanups), 1);
      const current = yield* Signal.peek(newA);
      assert.isTrue(Resource.isSuccess(current));
      if (Resource.isSuccess(current)) {
        assert.strictEqual(current.value, "A-2");
      }
    }).pipe(Effect.provide(Resource.ResourceRegistry.layer())),
  );
});

// =============================================================================
// Different keys are independent
// =============================================================================

describe("Resource key isolation", () => {
  scoped("should maintain separate state for different keys", () =>
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
    }).pipe(Effect.provide(Resource.ResourceRegistry.layer())),
  );
});

// =============================================================================
// Resource.fetch reactive - Signal-driven re-fetching
// =============================================================================

describe("Resource.fetch reactive", () => {
  scoped("should fetch once per key — no duplicate fetches for same key", () =>
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
    }).pipe(Effect.provide(Resource.ResourceRegistry.layer())),
  );

  scoped("should re-fetch when signal changes and resolve correct value", () =>
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
    }).pipe(Effect.provide(Resource.ResourceRegistry.layer())),
  );

  scoped("should cancel in-flight fetch when key changes before completion", () =>
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
    }).pipe(Effect.provide(Resource.ResourceRegistry.layer())),
  );

  scoped("should not duplicate fetches when signal changes rapidly", () =>
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
    }).pipe(Effect.provide(Resource.ResourceRegistry.layer())),
  );

  scoped("should deduplicate when async fetch is already in-flight for same key", () =>
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
    }).pipe(Effect.provide(Resource.ResourceRegistry.layer())),
  );

  scoped(
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
      }).pipe(Effect.provide(Resource.ResourceRegistry.layer())),
  );

  scoped("should not re-fetch when signal changes to same value", () =>
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
    }).pipe(Effect.provide(Resource.ResourceRegistry.layer())),
  );
});
