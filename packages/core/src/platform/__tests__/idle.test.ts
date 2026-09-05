/* oxlint-disable effect/no-raw-throw, effect/no-built-in-error-constructor -- Native failure fakes must throw through the browser boundary under test. */
/**
 * Idle Service Tests
 *
 * Shared scheduling and lifecycle coverage for controlled and browser adapters.
 */
import { assert, describe, it } from "@effect/vitest";
import {
  Cause,
  Deferred,
  Effect,
  Exit,
  Layer,
  Logger,
  Option,
  Ref,
  Scheduler,
  Scope,
} from "effect";
import { Idle, IdleError, TestIdle, browser as idleBrowser, test as idleTest } from "../idle.js";

type IdleAdapterName = "controlled" | "browser";

interface IdleConformanceHarness {
  readonly layer: Layer.Layer<Idle | TestIdle, IdleError>;
}

const setupIdleConformance = (
  adapter: IdleAdapterName,
): Effect.Effect<IdleConformanceHarness, never, Scope.Scope> => {
  if (adapter === "controlled") {
    return Effect.succeed({ layer: idleTest });
  }

  const originalRequest = globalThis.requestIdleCallback;
  const originalCancel = globalThis.cancelIdleCallback;
  const scheduled = new Map<number, IdleRequestCallback>();
  let nextId = 1;
  let requests = 0;
  let cancellations = 0;

  return Effect.acquireRelease(
    Effect.sync(() => {
      globalThis.requestIdleCallback = (callback) => {
        const id = nextId++;
        requests++;
        scheduled.set(id, callback);
        return id;
      };
      globalThis.cancelIdleCallback = (id) => {
        cancellations++;
        scheduled.delete(id);
      };

      const controls = TestIdle.of({
        flush: Effect.sync(() => {
          const callbacks = Array.from(scheduled.values());
          scheduled.clear();
          for (const callback of callbacks) {
            callback({ didTimeout: false, timeRemaining: () => 1 });
          }
        }),
        pendingCount: Effect.sync(() => scheduled.size),
        requestCount: Effect.sync(() => requests),
        cancellationCount: Effect.sync(() => cancellations),
      });

      return {
        layer: Layer.merge(idleBrowser, Layer.succeed(TestIdle, controls)),
      };
    }),
    () =>
      Effect.sync(() => {
        globalThis.requestIdleCallback = originalRequest;
        globalThis.cancelIdleCallback = originalCancel;
      }),
  );
};

const idleAdapters: ReadonlyArray<IdleAdapterName> = ["controlled", "browser"];

for (const adapter of idleAdapters) {
  describe(`Idle ${adapter} adapter conformance`, () => {
    it.effect("should preserve the configured Scheduler when the idle callback starts", () =>
      Effect.gen(function* () {
        // Scope: exercises callback context through both controlled and native adapters.
        // Assertion: launch policy does not replace the caller's Scheduler in the handler.
        const harness = yield* setupIdleConformance(adapter);
        yield* Effect.gen(function* () {
          const idle = yield* Idle;
          const controls = yield* TestIdle;
          const scheduler = new Scheduler.MixedScheduler("async");
          const observed = yield* Deferred.make<Scheduler.Scheduler>();
          yield* idle
            .request(() =>
              Effect.flatMap(Scheduler.Scheduler, (value) => Deferred.succeed(observed, value)),
            )
            .pipe(Effect.provideService(Scheduler.Scheduler, scheduler));
          yield* controls.flush;
          assert.strictEqual(yield* Deferred.await(observed), scheduler);
        }).pipe(Effect.provide(harness.layer));
      }),
    );

    it.effect("should register now and execute once on a later flush", () =>
      Effect.gen(function* () {
        // Test: should register now and execute once on a later flush through every Idle adapter.
        // Scope: runs the same deferred scheduling contract against controlled and browser Layers.
        // Assertion: registration returns with one pending callback, flush executes it once, and finalization cancels once.
        const harness = yield* setupIdleConformance(adapter);

        yield* Effect.gen(function* () {
          const idle = yield* Idle;
          const controls = yield* TestIdle;
          const scope = yield* Scope.make();
          const executions = yield* Ref.make(0);
          const completed = yield* Deferred.make<void>();
          yield* idle
            .request(
              () =>
                Effect.gen(function* () {
                  yield* Ref.update(executions, (count) => count + 1);
                  yield* Deferred.succeed(completed, undefined);
                }),
              { timeout: 25 },
            )
            .pipe(Scope.provide(scope));

          assert.strictEqual(yield* Ref.get(executions), 0);
          assert.strictEqual(yield* controls.requestCount, 1);
          assert.strictEqual(yield* controls.pendingCount, 1);

          yield* controls.flush;
          yield* Deferred.await(completed);
          yield* controls.flush;
          assert.strictEqual(yield* Ref.get(executions), 1);
          assert.strictEqual(yield* controls.pendingCount, 0);

          yield* Scope.close(scope, Exit.void);
          assert.strictEqual(yield* controls.cancellationCount, 1);
        }).pipe(Effect.provide(harness.layer));
      }),
    );

    it.effect("should prevent work after its owning scope closes", () =>
      Effect.gen(function* () {
        // Test: should prevent pending work after its owning scope closes through every Idle adapter.
        // Scope: closes a pending registration before either controlled or native scheduling can invoke it.
        // Assertion: close removes the pending callback, records one cancellation, and later flushes stay inert.
        const harness = yield* setupIdleConformance(adapter);

        yield* Effect.gen(function* () {
          const idle = yield* Idle;
          const controls = yield* TestIdle;
          const scope = yield* Scope.make();
          const executions = yield* Ref.make(0);
          yield* idle
            .request(() => Ref.update(executions, (count) => count + 1))
            .pipe(Scope.provide(scope));

          assert.strictEqual(yield* controls.pendingCount, 1);
          yield* Scope.close(scope, Exit.void);
          assert.strictEqual(yield* controls.pendingCount, 0);
          assert.strictEqual(yield* controls.cancellationCount, 1);
          yield* controls.flush;
          assert.strictEqual(yield* Ref.get(executions), 0);
        }).pipe(Effect.provide(harness.layer));
      }),
    );

    it.effect("should supervise later handler defects without failing registration", () =>
      Effect.gen(function* () {
        // Test: should supervise a later handler defect without retroactively failing registration.
        // Scope: compares the callback-to-runtime boundary for controlled and browser scheduling.
        // Assertion: registration and flush succeed, the defect is logged once, and cleanup still cancels once.
        const harness = yield* setupIdleConformance(adapter);
        const messages: Array<unknown> = [];
        const logger = Logger.make<unknown, void>(({ logLevel, message }) => {
          if (logLevel === "Error") messages.push(message);
        });

        yield* Effect.gen(function* () {
          const idle = yield* Idle;
          const controls = yield* TestIdle;
          const scope = yield* Scope.make();
          const started = yield* Deferred.make<void>();
          const failure = new Error("idle callback defect");
          const registration = yield* Effect.exit(
            idle
              .request(() =>
                Effect.gen(function* () {
                  yield* Deferred.succeed(started, undefined);
                  // oxlint-disable-next-line effect/no-effect-escape-hatch -- The callback deliberately defects to verify host-boundary supervision.
                  return yield* Effect.die(failure);
                }),
              )
              .pipe(Scope.provide(scope)),
          );

          assert.isTrue(Exit.isSuccess(registration));
          assert.strictEqual(messages.length, 0);
          assert.strictEqual(yield* controls.pendingCount, 1);

          const flushExit = yield* Effect.exit(controls.flush);
          assert.isTrue(Exit.isSuccess(flushExit));
          yield* Deferred.await(started);
          yield* Effect.yieldNow;
          assert.strictEqual(messages.length, 1);

          yield* Scope.close(scope, Exit.void);
          assert.strictEqual(yield* controls.cancellationCount, 1);
        }).pipe(Effect.provide(Layer.merge(harness.layer, Logger.layer([logger]))));
      }),
    );
  });
}

describe("Idle", () => {
  it.effect("browser idle handler fiber is interrupted on scope close", () =>
    Effect.gen(function* () {
      const originalRequestIdleCallback = globalThis.requestIdleCallback;
      const originalCancelIdleCallback = globalThis.cancelIdleCallback;
      const scheduledRef: { current: (() => void) | null } = { current: null };

      yield* Effect.addFinalizer(() =>
        Effect.sync(() => {
          globalThis.requestIdleCallback = originalRequestIdleCallback;
          globalThis.cancelIdleCallback = originalCancelIdleCallback;
        }),
      );

      yield* Effect.sync(() => {
        const requestIdleCallbackStub: typeof requestIdleCallback = (cb) => {
          scheduledRef.current = () => cb({ didTimeout: false, timeRemaining: () => 0 });
          return 1;
        };
        const cancelIdleCallbackStub: typeof cancelIdleCallback = (_id) => {
          scheduledRef.current = null;
        };
        globalThis.requestIdleCallback = requestIdleCallbackStub;
        globalThis.cancelIdleCallback = cancelIdleCallbackStub;
      });

      yield* Effect.gen(function* () {
        const interrupted = yield* Ref.make(false);
        const gate = yield* Deferred.make<void>();
        const scope = yield* Scope.make();
        const idle = yield* Idle;

        yield* idle
          .request(() =>
            Deferred.await(gate).pipe(Effect.onInterrupt(() => Ref.set(interrupted, true))),
          )
          .pipe(Effect.provideService(Scope.Scope, scope));

        if (scheduledRef.current !== null) {
          const runScheduled = scheduledRef.current;
          runScheduled();
        }
        yield* Scope.close(scope, Exit.void);

        assert.isTrue(yield* Ref.get(interrupted));
      }).pipe(Effect.provide(idleBrowser));
    }),
  );

  it.effect("browser layer fails readiness while idle APIs are unavailable", () =>
    Effect.gen(function* () {
      // Test: should fail browser-layer readiness while required idle APIs are unavailable.
      // Scope: covers capability validation before the Idle service is published.
      // Assertion: layer acquisition fails with IdleError operation initialize.
      const originalRequest = globalThis.requestIdleCallback;
      const originalCancel = globalThis.cancelIdleCallback;
      yield* Effect.addFinalizer(() =>
        Effect.sync(() => {
          globalThis.requestIdleCallback = originalRequest;
          globalThis.cancelIdleCallback = originalCancel;
        }),
      );
      yield* Effect.sync(() => {
        Object.defineProperty(globalThis, "requestIdleCallback", {
          configurable: true,
          writable: true,
          value: undefined,
        });
        Object.defineProperty(globalThis, "cancelIdleCallback", {
          configurable: true,
          writable: true,
          value: undefined,
        });
      });

      const exit = yield* Effect.exit(Idle.pipe(Effect.provide(idleBrowser)));
      assert.isTrue(Exit.isFailure(exit));
      if (Exit.isFailure(exit)) {
        const error = Option.getOrNull(Cause.findErrorOption(exit.cause));
        assert.instanceOf(error, IdleError);
        assert.strictEqual(error?.operation, "initialize");
      }
    }),
  );

  it.effect("browser request throws fail with IdleError", () =>
    Effect.gen(function* () {
      // Test: should translate requestIdleCallback throws into IdleError.
      // Scope: covers the normal native scheduling operation exposed by Idle.
      // Assertion: request fails in the typed channel with the original cause.
      const originalRequest = globalThis.requestIdleCallback;
      const originalCancel = globalThis.cancelIdleCallback;
      const failure = new Error("request failed");
      yield* Effect.addFinalizer(() =>
        Effect.sync(() => {
          globalThis.requestIdleCallback = originalRequest;
          globalThis.cancelIdleCallback = originalCancel;
        }),
      );
      yield* Effect.sync(() => {
        globalThis.requestIdleCallback = () => {
          throw failure;
        };
        globalThis.cancelIdleCallback = () => undefined;
      });

      const exit = yield* Effect.exit(
        Effect.gen(function* () {
          const idle = yield* Idle;
          yield* idle.request(() => Effect.void);
        }).pipe(Effect.provide(idleBrowser)),
      );
      assert.isTrue(Exit.isFailure(exit));
      if (Exit.isFailure(exit)) {
        const error = Option.getOrNull(Cause.findErrorOption(exit.cause));
        assert.instanceOf(error, IdleError);
        assert.strictEqual(error?.operation, "requestIdleCallback");
        assert.strictEqual(error?.cause, failure);
      }
    }),
  );

  it.effect("browser cancel reports once without failing scope close", () =>
    Effect.gen(function* () {
      // Test: should report a throwing cancelIdleCallback once without failing scope close.
      // Scope: verifies bracketed idle registration and infallible finalization.
      // Assertion: cancel runs once, the reporter observes one error, and close succeeds.
      const originalRequest = globalThis.requestIdleCallback;
      const originalCancel = globalThis.cancelIdleCallback;
      const messages: Array<unknown> = [];
      const logger = Logger.make<unknown, void>(({ logLevel, message }) => {
        if (logLevel === "Error") messages.push(message);
      });
      let cancellations = 0;
      yield* Effect.addFinalizer(() =>
        Effect.sync(() => {
          globalThis.requestIdleCallback = originalRequest;
          globalThis.cancelIdleCallback = originalCancel;
        }),
      );
      yield* Effect.sync(() => {
        globalThis.requestIdleCallback = () => 1;
        globalThis.cancelIdleCallback = () => {
          cancellations++;
          throw new Error("cancel failed");
        };
      });

      yield* Effect.gen(function* () {
        const idle = yield* Idle;
        const scope = yield* Scope.make();
        yield* idle.request(() => Effect.void).pipe(Scope.provide(scope));
        yield* Scope.close(scope, Exit.void);
      }).pipe(Effect.provide(Layer.merge(idleBrowser, Logger.layer([logger]))));

      assert.strictEqual(cancellations, 1);
      assert.strictEqual(messages.length, 1);
    }),
  );

  it.effect("browser callback construction throws are supervised", () =>
    Effect.gen(function* () {
      // Test: should supervise a throw before an idle handler returns its Effect.
      // Scope: covers the imperative callback-to-runtime bridge.
      // Assertion: the native callback does not throw and one error reaches the captured logger.
      const originalRequest = globalThis.requestIdleCallback;
      const originalCancel = globalThis.cancelIdleCallback;
      let scheduled: IdleRequestCallback | undefined;
      const messages: Array<unknown> = [];
      const logger = Logger.make<unknown, void>(({ logLevel, message }) => {
        if (logLevel === "Error") messages.push(message);
      });
      yield* Effect.addFinalizer(() =>
        Effect.sync(() => {
          globalThis.requestIdleCallback = originalRequest;
          globalThis.cancelIdleCallback = originalCancel;
        }),
      );
      yield* Effect.sync(() => {
        globalThis.requestIdleCallback = (callback) => {
          scheduled = callback;
          return 1;
        };
        globalThis.cancelIdleCallback = () => undefined;
      });

      yield* Effect.gen(function* () {
        const idle = yield* Idle;
        yield* idle.request(() => {
          throw new Error("idle handler failed");
        });
        const callbackExit = yield* Effect.exit(
          Effect.sync(() => scheduled?.({ didTimeout: false, timeRemaining: () => 0 })),
        );
        assert.isTrue(Exit.isSuccess(callbackExit));
        yield* Effect.yieldNow;
      }).pipe(Effect.provide(Layer.merge(idleBrowser, Logger.layer([logger]))));

      assert.strictEqual(messages.length, 1);
    }),
  );
});
