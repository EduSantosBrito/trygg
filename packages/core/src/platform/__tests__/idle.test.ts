/**
 * Idle Service Tests
 *
 * Tests the in-memory test layer for Idle.
 * Test layer executes handler immediately.
 */
import { assert, describe, it } from "@effect/vitest";
import { Deferred, Effect, Exit, Ref, Scope } from "effect";
import { Idle, browser as idleBrowser, test as idleTest } from "../idle.js";

describe("Idle", () => {
  it.effect("request executes handler immediately in test layer", () =>
    Effect.gen(function* () {
      const idle = yield* Idle;
      let executed = false;
      yield* idle.request(() =>
        Effect.sync(() => {
          executed = true;
        }),
      );
      assert.strictEqual(executed, true);
    }).pipe(Effect.provide(idleTest)),
  );

  it.effect("request executes multiple handlers in order", () =>
    Effect.gen(function* () {
      const idle = yield* Idle;
      const order: Array<number> = [];
      yield* idle.request(() =>
        Effect.sync(() => {
          order.push(1);
        }),
      );
      yield* idle.request(() =>
        Effect.sync(() => {
          order.push(2);
        }),
      );
      yield* idle.request(() =>
        Effect.sync(() => {
          order.push(3);
        }),
      );
      assert.deepStrictEqual(order, [1, 2, 3]);
    }).pipe(Effect.provide(idleTest)),
  );

  it.effect("request with timeout option does not affect test behavior", () =>
    Effect.gen(function* () {
      const idle = yield* Idle;
      let executed = false;
      yield* idle.request(
        () =>
          Effect.sync(() => {
            executed = true;
          }),
        { timeout: 5000 },
      );
      assert.strictEqual(executed, true);
    }).pipe(Effect.provide(idleTest)),
  );

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
        globalThis.requestIdleCallback = ((cb: IdleRequestCallback) => {
          scheduledRef.current = () => cb({ didTimeout: false, timeRemaining: () => 0 });
          return 1;
        }) as typeof requestIdleCallback;
        globalThis.cancelIdleCallback = ((_id: number) => {
          scheduledRef.current = null;
        }) as typeof cancelIdleCallback;
      });

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
    }).pipe(Effect.provide(idleBrowser)),
  );
});
