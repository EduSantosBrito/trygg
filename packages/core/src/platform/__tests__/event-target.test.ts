/* oxlint-disable effect/no-raw-throw, effect/no-built-in-error-constructor, effect/no-type-casting -- Native failure fakes must throw through the browser boundary under test. */
/**
 * EventTarget Service Tests
 *
 * Tests the in-memory test layer for EventTarget.
 */
import { assert, describe, it } from "@effect/vitest";
import { Cause, Deferred, Effect, Exit, Layer, Logger, Option, Ref, Scope } from "effect";
import {
  EventTargetError,
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

  it.effect("browser registration and dispatch throws fail with EventTargetError", () =>
    Effect.gen(function* () {
      // Test: should translate browser registration and dispatch throws into EventTargetError.
      // Scope: covers both normal native operations exposed by the EventTarget port.
      // Assertion: each Exit contains a typed failure with the precise operation and original cause.
      const et = yield* PlatformEventTarget;
      const addFailure = new Error("add failed");
      const dispatchFailure = new Error("dispatch failed");
      const addTarget = {
        addEventListener: () => {
          throw addFailure;
        },
        removeEventListener: () => undefined,
        dispatchEvent: () => true,
      } as unknown as EventTarget;
      const dispatchTarget = {
        addEventListener: () => undefined,
        removeEventListener: () => undefined,
        dispatchEvent: () => {
          throw dispatchFailure;
        },
      } as unknown as EventTarget;

      const addExit = yield* Effect.exit(et.on(addTarget, "click", () => Effect.void));
      const dispatchExit = yield* Effect.exit(
        et.dispatch(dispatchTarget, "click", new Event("click")),
      );

      if (Exit.isSuccess(addExit) || Exit.isSuccess(dispatchExit)) {
        return assert.fail("Expected both native throws to fail");
      }
      const addError = Option.getOrNull(Cause.findErrorOption(addExit.cause));
      const dispatchError = Option.getOrNull(Cause.findErrorOption(dispatchExit.cause));
      assert.instanceOf(addError, EventTargetError);
      assert.strictEqual(addError?.operation, "addEventListener");
      assert.strictEqual(addError?.cause, addFailure);
      assert.instanceOf(dispatchError, EventTargetError);
      assert.strictEqual(dispatchError?.operation, "dispatchEvent");
      assert.strictEqual(dispatchError?.cause, dispatchFailure);
    }).pipe(Effect.provide(eventTargetBrowser)),
  );

  it.effect("browser cleanup reports once without skipping other finalizers", () =>
    Effect.gen(function* () {
      // Test: should report a throwing listener release once without skipping other finalizers.
      // Scope: verifies acquireRelease ownership and infallible scope cleanup at the native boundary.
      // Assertion: remove runs exactly once, one error log is emitted, and the sibling finalizer completes.
      const messages: Array<unknown> = [];
      const logger = Logger.make<unknown, void>(({ logLevel, message }) => {
        if (logLevel === "Error") messages.push(message);
      });
      const removeFailure = new Error("remove failed");
      let removals = 0;
      let siblingFinalized = false;
      const target = {
        addEventListener: () => undefined,
        removeEventListener: () => {
          removals++;
          throw removeFailure;
        },
        dispatchEvent: () => true,
      } as unknown as EventTarget;

      const scope = yield* Scope.make();
      const program = Effect.gen(function* () {
        const et = yield* PlatformEventTarget;
        yield* Scope.addFinalizer(
          scope,
          Effect.sync(() => {
            siblingFinalized = true;
          }),
        );
        yield* et.on(target, "click", () => Effect.void).pipe(Scope.provide(scope));
        yield* Scope.close(scope, Exit.void);
      }).pipe(Effect.provide(Layer.merge(eventTargetBrowser, Logger.layer([logger]))));

      yield* program;
      assert.strictEqual(removals, 1);
      assert.strictEqual(messages.length, 1);
      assert.isTrue(siblingFinalized);
    }),
  );

  it.effect("browser callback construction throws stay inside the Effect runtime", () =>
    Effect.gen(function* () {
      // Test: should keep callback construction throws inside the Effect runtime.
      // Scope: covers the synchronous browser-to-Effect callback bridge.
      // Assertion: dispatch does not throw to the host and the supervised defect is reported exactly once.
      const messages: Array<unknown> = [];
      const logger = Logger.make<unknown, void>(({ logLevel, message }) => {
        if (logLevel === "Error") messages.push(message);
      });
      const target = new EventTarget();
      const failure = new Error("handler construction failed");

      yield* Effect.gen(function* () {
        const et = yield* PlatformEventTarget;
        yield* et.on(target, "click", () => {
          throw failure;
        });
        const dispatchExit = yield* Effect.exit(
          Effect.sync(() => target.dispatchEvent(new Event("click"))),
        );
        assert.isTrue(Exit.isSuccess(dispatchExit));
        yield* Effect.yieldNow;
      }).pipe(Effect.provide(Layer.merge(eventTargetBrowser, Logger.layer([logger]))));

      assert.strictEqual(messages.length, 1);
    }),
  );
});
