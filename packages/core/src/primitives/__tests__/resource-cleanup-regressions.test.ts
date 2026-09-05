import { assert, describe } from "@effect/vitest";
import { Cause, Effect, Exit, Option, Scope } from "effect";
import { TestClock } from "effect/testing";
import { scoped } from "../../testing/effect-vitest.js";
import * as Resource from "../resource.js";

describe("Resource registry cleanup failures", () => {
  scoped("should preserve finalizer defects while releasing a deleted entry's capacity", () =>
    Effect.gen(function* () {
      // Scope: the real registry closes an entry whose finalizer fails with a defect.
      // Assertion: delete preserves the defect, evicts the entry, and frees its capacity.
      const registry = yield* Resource.ResourceRegistryTag;
      const entry = yield* registry.getOrCreate("first");
      const defect = "release failed";
      yield* Scope.addFinalizer(
        entry.scope,
        // oxlint-disable-next-line effect/no-effect-escape-hatch -- Injects a finalizer defect to prove cleanup preserves it.
        Effect.die(defect),
      );

      const exit = yield* Effect.exit(registry.delete("first"));
      assert.isTrue(Exit.isFailure(exit));
      if (Exit.isFailure(exit)) assert.strictEqual(Cause.squash(exit.cause), defect);
      assert.isTrue(Option.isNone(yield* registry.get("first")));
      const replacement = yield* registry.getOrCreate("replacement");
      assert.strictEqual(replacement.key, "replacement");
    }).pipe(Effect.provide(Resource.ResourceRegistry.layer({ capacity: 1, timeToLive: "1 hour" }))),
  );

  scoped("should finalize every expired entry while preserving all release defects", () =>
    Effect.gen(function* () {
      // Scope: TTL pruning retires a batch before finalizing it outside the state update.
      // Assertion: both releases execute, both defects survive, and all capacity is reusable.
      const registry = yield* Resource.ResourceRegistryTag;
      const first = yield* registry.getOrCreate("first");
      const second = yield* registry.getOrCreate("second");
      const releases: Array<string> = [];
      const firstDefect = "first release";
      const secondDefect = "second release";
      yield* Scope.addFinalizer(
        first.scope,
        Effect.sync(() => {
          releases.push("first");
        }).pipe(
          // oxlint-disable-next-line effect/no-effect-escape-hatch -- Injects a finalizer defect to prove later releases still run.
          Effect.andThen(Effect.die(firstDefect)),
        ),
      );
      yield* Scope.addFinalizer(
        second.scope,
        Effect.sync(() => {
          releases.push("second");
        }).pipe(
          // oxlint-disable-next-line effect/no-effect-escape-hatch -- Injects a second finalizer defect to verify Cause aggregation.
          Effect.andThen(Effect.die(secondDefect)),
        ),
      );
      yield* TestClock.adjust(101);

      const exit = yield* Effect.exit(registry.get("missing"));
      assert.deepStrictEqual(releases, ["first", "second"]);
      assert.isTrue(Exit.isFailure(exit));
      if (Exit.isFailure(exit)) {
        const defects = exit.cause.reasons.filter(Cause.isDieReason).map((reason) => reason.defect);
        assert.deepStrictEqual(defects, [firstDefect, secondDefect]);
      }
      yield* registry.getOrCreate("third");
      yield* registry.getOrCreate("fourth");
      assert.isTrue(Option.isSome(yield* registry.get("third")));
      assert.isTrue(Option.isSome(yield* registry.get("fourth")));
    }).pipe(Effect.provide(Resource.ResourceRegistry.layer({ capacity: 2, timeToLive: 100 }))),
  );
});
