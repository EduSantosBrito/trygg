/**
 * EventTarget Service Tests
 *
 * Tests the in-memory test layer for EventTarget.
 */
import { assert, describe, it } from "@effect/vitest";
import { Deferred, Effect, Exit, Ref, Scope } from "effect";
import {
  PlatformEventTarget,
  browser as eventTargetBrowser,
  test as eventTargetTest,
} from "../event-target.js";

describe("EventTarget", () => {
  it.effect("on registers handler that receives dispatched events", () =>
    Effect.gen(function* () {
      const et = yield* PlatformEventTarget;
      const received: Array<string> = [];
      const target = new EventTarget();

      yield* et.on(target, "click", (_e: Event) =>
        Effect.sync(() => {
          received.push("clicked");
        }),
      );

      yield* et.dispatch(target, "click", new Event("click"));

      assert.deepStrictEqual(received, ["clicked"]);
    }).pipe(Effect.provide(eventTargetTest)),
  );

  it.effect("on can register multiple handlers for same event", () =>
    Effect.gen(function* () {
      const et = yield* PlatformEventTarget;
      const received: Array<string> = [];
      const target = new EventTarget();

      yield* et.on(target, "click", (_e: Event) =>
        Effect.sync(() => {
          received.push("handler1");
        }),
      );
      yield* et.on(target, "click", (_e: Event) =>
        Effect.sync(() => {
          received.push("handler2");
        }),
      );

      yield* et.dispatch(target, "click", new Event("click"));

      assert.deepStrictEqual(received, ["handler1", "handler2"]);
    }).pipe(Effect.provide(eventTargetTest)),
  );

  it.effect("handler is removed when scope closes", () =>
    Effect.gen(function* () {
      const et = yield* PlatformEventTarget;
      const received: Array<string> = [];
      const target = new EventTarget();

      const scope = yield* Scope.make();
      yield* et
        .on(target, "click", (_e: Event) =>
          Effect.sync(() => {
            received.push("clicked");
          }),
        )
        .pipe(Effect.provideService(Scope.Scope, scope));

      // Dispatch before close
      yield* et.dispatch(target, "click", new Event("click"));
      assert.deepStrictEqual(received, ["clicked"]);

      // Close scope
      yield* Scope.close(scope, Exit.void);

      // Dispatch after close — handler should be removed
      yield* et.dispatch(target, "click", new Event("click"));
      assert.deepStrictEqual(received, ["clicked"]);
    }).pipe(Effect.provide(eventTargetTest)),
  );

  it.effect("dispatch to unknown target is no-op", () =>
    Effect.gen(function* () {
      const et = yield* PlatformEventTarget;
      const target = new EventTarget();
      // Should not throw
      yield* et.dispatch(target, "click", new Event("click"));
    }).pipe(Effect.provide(eventTargetTest)),
  );

  it.effect("different events on same target are independent", () =>
    Effect.gen(function* () {
      const et = yield* PlatformEventTarget;
      const received: Array<string> = [];
      const target = new EventTarget();

      yield* et.on(target, "click", (_e: Event) =>
        Effect.sync(() => {
          received.push("click");
        }),
      );
      yield* et.on(target, "mouseover", (_e: Event) =>
        Effect.sync(() => {
          received.push("mouseover");
        }),
      );

      yield* et.dispatch(target, "click", new Event("click"));
      assert.deepStrictEqual(received, ["click"]);

      yield* et.dispatch(target, "mouseover", new Event("mouseover"));
      assert.deepStrictEqual(received, ["click", "mouseover"]);
    }).pipe(Effect.provide(eventTargetTest)),
  );

  it.effect("browser handlers are interrupted when registration scope closes", () =>
    Effect.gen(function* () {
      const et = yield* PlatformEventTarget;
      const target = new EventTarget();
      const gate = yield* Deferred.make<void>();
      const interrupted = yield* Ref.make(false);

      const scope = yield* Scope.make();

      yield* et
        .on(target, "click", (_e: Event) =>
          Deferred.await(gate).pipe(Effect.onInterrupt(() => Ref.set(interrupted, true))),
        )
        .pipe(Effect.provideService(Scope.Scope, scope));

      yield* Effect.sync(() => {
        target.dispatchEvent(new Event("click"));
      });

      yield* Scope.close(scope, Exit.void);

      assert.isTrue(yield* Ref.get(interrupted));
    }).pipe(Effect.provide(eventTargetBrowser)),
  );
});
