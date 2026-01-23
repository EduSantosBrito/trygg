/**
 * EventTarget Service Tests
 *
 * Tests the in-memory test layer for EventTarget.
 */
import { assert, describe, it } from "@effect/vitest";
import { Effect, Exit, Scope } from "effect";
import {
  PlatformEventTarget,
  test as eventTargetTest,
  type TestEventTargetService,
} from "../event-target.js";

describe("EventTarget", () => {
  it.scoped("on registers handler that receives dispatched events", () =>
    Effect.gen(function* () {
      const et = yield* PlatformEventTarget;
      const received: Array<string> = [];
      const target = { __testId: "btn" } as unknown as EventTarget;

      yield* et.on(target, "click", (_e: Event) =>
        Effect.sync(() => {
          received.push("clicked");
        }),
      );

      yield* (et as TestEventTargetService).dispatch(target, "click", new Event("click"));

      assert.deepStrictEqual(received, ["clicked"]);
    }).pipe(Effect.provide(eventTargetTest)),
  );

  it.scoped("on can register multiple handlers for same event", () =>
    Effect.gen(function* () {
      const et = yield* PlatformEventTarget;
      const received: Array<string> = [];
      const target = { __testId: "multi" } as unknown as EventTarget;

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

      yield* (et as TestEventTargetService).dispatch(target, "click", new Event("click"));

      assert.deepStrictEqual(received, ["handler1", "handler2"]);
    }).pipe(Effect.provide(eventTargetTest)),
  );

  it.effect("handler is removed when scope closes", () =>
    Effect.gen(function* () {
      const et = yield* PlatformEventTarget;
      const received: Array<string> = [];
      const target = { __testId: "scoped" } as unknown as EventTarget;

      const scope = yield* Scope.make();
      yield* et
        .on(target, "click", (_e: Event) =>
          Effect.sync(() => {
            received.push("clicked");
          }),
        )
        .pipe(Effect.provideService(Scope.Scope, scope));

      // Dispatch before close
      yield* (et as TestEventTargetService).dispatch(target, "click", new Event("click"));
      assert.deepStrictEqual(received, ["clicked"]);

      // Close scope
      yield* Scope.close(scope, Exit.void);

      // Dispatch after close — handler should be removed
      yield* (et as TestEventTargetService).dispatch(target, "click", new Event("click"));
      assert.deepStrictEqual(received, ["clicked"]);
    }).pipe(Effect.provide(eventTargetTest)),
  );

  it.scoped("dispatch to unknown target is no-op", () =>
    Effect.gen(function* () {
      const et = yield* PlatformEventTarget;
      const target = { __testId: "unknown" } as unknown as EventTarget;
      // Should not throw
      yield* (et as TestEventTargetService).dispatch(target, "click", new Event("click"));
    }).pipe(Effect.provide(eventTargetTest)),
  );

  it.scoped("different events on same target are independent", () =>
    Effect.gen(function* () {
      const et = yield* PlatformEventTarget;
      const received: Array<string> = [];
      const target = { __testId: "events" } as unknown as EventTarget;

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

      yield* (et as TestEventTargetService).dispatch(target, "click", new Event("click"));
      assert.deepStrictEqual(received, ["click"]);

      yield* (et as TestEventTargetService).dispatch(target, "mouseover", new Event("mouseover"));
      assert.deepStrictEqual(received, ["click", "mouseover"]);
    }).pipe(Effect.provide(eventTargetTest)),
  );
});
