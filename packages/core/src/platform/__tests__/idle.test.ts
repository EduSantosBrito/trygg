/**
 * Idle Service Tests
 *
 * Tests the in-memory test layer for Idle.
 * Test layer executes handler immediately.
 */
import { assert, describe, it } from "@effect/vitest";
import { Effect } from "effect";
import { Idle, test as idleTest } from "../idle.js";

describe("Idle", () => {
  it.scoped("request executes handler immediately in test layer", () =>
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

  it.scoped("request executes multiple handlers in order", () =>
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

  it.scoped("request with timeout option does not affect test behavior", () =>
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
});
