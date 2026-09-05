import { assert, describe, it } from "@effect/vitest";
import { Cause, Deferred, Effect, Exit, Fiber } from "effect";
import * as Context from "effect/Context";
import { asFinalizer, cleanupAll } from "../render-cleanup.js";

describe("render cleanup", () => {
  it.effect("should retain release annotations while promoting typed finalizer failures", () =>
    Effect.gen(function* () {
      // Scope: finalizer error translation must keep correlation and diagnostic context.
      // Assertion: typed failures become defects with their annotations; other reasons survive intact.
      const failure = Cause.makeFailReason("release").annotate(
        Context.makeUnsafe(new Map([["request.id", "request-1"]])),
      );
      const defect = Cause.makeDieReason("existing defect");
      const interruption = Cause.makeInterruptReason(123);
      const exit = yield* Effect.failCause(Cause.fromReasons([failure, defect, interruption])).pipe(
        asFinalizer,
        Effect.exit,
      );
      assert.isTrue(Exit.isFailure(exit));
      if (Exit.isFailure(exit)) {
        const promoted = exit.cause.reasons.find(
          (reason) => Cause.isDieReason(reason) && reason.defect === "release",
        );
        assert.strictEqual(promoted?.annotations.get("request.id"), "request-1");
        assert.isTrue(exit.cause.reasons.includes(defect));
        assert.isTrue(exit.cause.reasons.includes(interruption));
      }
    }),
  );

  it.effect("should run every cleanup exactly once under external interruption", () =>
    Effect.gen(function* () {
      // Scope: interrupts cleanupAll while its first release is suspended.
      // Assertion: all releases run once and their failures remain combined with interruption.
      const firstStarted = yield* Deferred.make<void>();
      const firstGate = yield* Deferred.make<void>();
      const releases: Array<string> = [];

      const cleanupFiber = yield* cleanupAll([
        Effect.gen(function* () {
          yield* Deferred.succeed(firstStarted, undefined);
          yield* Deferred.await(firstGate);
          releases.push("first");
          return yield* Effect.fail("first-cleanup-failure");
        }),
        Effect.sync(() => {
          releases.push("second");
        }).pipe(
          // oxlint-disable-next-line effect/no-effect-escape-hatch -- Deliberately verifies cleanup defects survive external interruption.
          Effect.andThen(Effect.die("second-cleanup-defect")),
        ),
        Effect.sync(() => {
          releases.push("third");
        }),
      ]).pipe(Effect.forkChild);

      yield* Deferred.await(firstStarted);
      const interruptFiber = yield* Fiber.interrupt(cleanupFiber).pipe(Effect.forkChild);
      yield* Effect.yieldNow;
      yield* Deferred.succeed(firstGate, undefined);

      const cleanupExit = yield* Fiber.await(cleanupFiber);
      yield* Fiber.await(interruptFiber);

      assert.deepStrictEqual(releases, ["first", "second", "third"]);
      assert.isTrue(Exit.hasInterrupts(cleanupExit));
      assert.isTrue(Exit.hasFails(cleanupExit));
      assert.isTrue(Exit.hasDies(cleanupExit));
    }),
  );
});
