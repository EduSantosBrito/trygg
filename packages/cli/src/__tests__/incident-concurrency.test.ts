import { assert, describe, it } from "@effect/vitest";
import { Cause, Clock, Deferred, Effect, Exit, Fiber, Predicate } from "effect";
import { IncidentId } from "../../templates/incident/app/errors/incidents";
import { Incidents } from "../../templates/incident/app/services/incidents";

describe("incident repository execution", () => {
  it.effect("should read the current incident each time a reusable get Effect executes", () =>
    Effect.gen(function* () {
      // Scope: repository reads must happen at execution, including a reused Effect.
      // Assertion: a read constructed before a transition observes the committed status afterward.
      const repository = Incidents.make();
      const id = IncidentId.make(2);
      const read = repository.get(id);
      assert.strictEqual((yield* read).status, "Detected");
      yield* repository.transition(id, "Investigating");
      assert.strictEqual((yield* read).status, "Investigating");
    }),
  );

  it.effect.each(["timeline", "transition"])(
    "should preserve a concurrent commit while a %s mutation waits for its timestamp",
    (operation) =>
      Effect.gen(function* () {
        // Scope: the real Clock seam suspends the first mutation before another commits.
        // Assertion: timeline entries survive; competing state transitions cannot both succeed.
        const repository = Incidents.make();
        const id = IncidentId.make(2);
        const entered = yield* Deferred.make<void>();
        const release = yield* Deferred.make<void>();
        const clock = yield* Clock.Clock;
        const controlled: Clock.Clock = {
          ...clock,
          currentTimeMillis: Deferred.succeed(entered, undefined).pipe(
            Effect.andThen(Deferred.await(release)),
            Effect.andThen(clock.currentTimeMillis),
          ),
        };
        const first = yield* (
          operation === "timeline"
            ? repository.addTimelineEntry(id, "first")
            : repository.transition(id, "Investigating").pipe(Effect.asVoid)
        ).pipe(Effect.provideService(Clock.Clock, controlled), Effect.forkChild);
        yield* Deferred.await(entered);
        if (operation === "timeline") yield* repository.addTimelineEntry(id, "second");
        else yield* repository.transition(id, "Investigating");
        yield* Deferred.succeed(release, undefined);
        const exit = yield* Fiber.await(first);
        const incident = yield* repository.get(id);
        if (operation === "timeline") {
          assert.isTrue(Exit.isSuccess(exit));
          assert.deepStrictEqual(
            incident.timeline.slice(1).map((entry) => entry.message),
            ["second", "first"],
          );
        } else {
          assert.isTrue(Exit.isFailure(exit));
          if (Exit.isFailure(exit))
            assert.isTrue(
              exit.cause.reasons.some(
                (reason) =>
                  Cause.isFailReason(reason) &&
                  Predicate.isTagged(reason.error, "InvalidTransition"),
              ),
            );
          assert.strictEqual(incident.timeline.length, 2);
        }
      }),
  );
});
