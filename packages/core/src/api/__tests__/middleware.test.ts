/**
 * API Middleware Unit Tests
 *
 * Tests for API middleware error types and behavior.
 *
 * Note: Node.js <-> Web API conversions are now handled internally by
 * Effect's NodeHttpServer.makeHandler, so those tests have been removed.
 *
 * @module
 */
import { assert, describe, it } from "@effect/vitest";
import { Deferred, Effect } from "effect";
import { ApiInitError } from "../middleware.js";

// =============================================================================
// Error Types - Verify yieldable
// =============================================================================
// Scope: Error types are properly constructed and yieldable in Effect.gen

describe("ApiInitError", () => {
  it.scoped("should be yieldable in Effect.gen", () =>
    Effect.gen(function* () {
      const error = new ApiInitError({ message: "test error" });

      const result = yield* Effect.fail(error).pipe(Effect.flip);

      assert.strictEqual(result._tag, "ApiInitError");
      assert.strictEqual(result.message, "test error");
    }),
  );

  it.scoped("should include optional cause", () =>
    Effect.gen(function* () {
      const cause = new Error("root cause");
      const error = new ApiInitError({ message: "test", cause });

      const result = yield* Effect.fail(error).pipe(Effect.flip);

      assert.strictEqual(result.cause, cause);
    }),
  );

  it.scoped("should allow catching by tag", () =>
    Effect.gen(function* () {
      const effect = Effect.fail(new ApiInitError({ message: "test" })).pipe(
        Effect.catchTag("ApiInitError", (e) => Effect.succeed(`caught: ${e.message}`)),
      );

      const result = yield* effect;

      assert.strictEqual(result, "caught: test");
    }),
  );

  it.scoped("should allow recovering from errors", () =>
    Effect.gen(function* () {
      const recovered = yield* Deferred.make<void>();
      const effect = Effect.fail(new ApiInitError({ message: "failed" })).pipe(
        Effect.catchAll(() => Deferred.succeed(recovered, void 0)),
      );

      yield* effect;

      const isDone = yield* Deferred.isDone(recovered);
      assert.isTrue(isDone);
    }),
  );
});
