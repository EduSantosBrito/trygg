import { assert, describe, it } from "@effect/vitest";
import { Deferred, Effect, Layer, Scheduler } from "effect";
import { PlatformEventTarget, browser as eventTargetBrowser } from "../event-target.js";
import { Idle, TestIdle, test as idleTest } from "../idle.js";
import { Observer, TestObserver, test as observerTest } from "../observer.js";

describe("platform callback execution context", () => {
  it.effect.each(["event", "idle", "observer"])(
    "should preserve the caller Scheduler inside an owned %s callback",
    (kind) =>
      Effect.gen(function* () {
        // Scope: native callback launch must not replace the handler's captured Scheduler.
        // Assertion: the handler executes with the exact configured Scheduler instance.
        const scheduler = new Scheduler.MixedScheduler("async");
        const observed = yield* Deferred.make<Scheduler.Scheduler>();
        const handler = () =>
          Effect.flatMap(Scheduler.Scheduler, (value) => Deferred.succeed(observed, value));
        if (kind === "event") {
          const events = yield* PlatformEventTarget;
          const target = new EventTarget();
          yield* events
            .on(target, "test", handler)
            .pipe(Effect.provideService(Scheduler.Scheduler, scheduler));
          yield* events.dispatch(target, "test", new Event("test"));
        } else if (kind === "idle") {
          const idle = yield* Idle;
          const controls = yield* TestIdle;
          yield* idle.request(handler).pipe(Effect.provideService(Scheduler.Scheduler, scheduler));
          yield* controls.flush;
        } else {
          const observers = yield* Observer;
          const controls = yield* TestObserver;
          const target = document.createElement("div");
          yield* observers
            .mutation(target, { childList: true }, handler)
            .pipe(Effect.provideService(Scheduler.Scheduler, scheduler));
          yield* controls.triggerMutation(target, []);
        }
        assert.strictEqual(yield* Deferred.await(observed), scheduler);
      }).pipe(
        Effect.scoped,
        Effect.provide(Layer.mergeAll(eventTargetBrowser, idleTest, observerTest)),
      ),
  );
});
