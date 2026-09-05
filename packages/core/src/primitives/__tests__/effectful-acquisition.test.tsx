import { assert, describe, vi } from "@effect/vitest";
import { Cause, Deferred, Effect, Exit, Fiber, Schema } from "effect";
import { scoped } from "../../testing/effect-vitest.js";
import { browserLayer, Renderer } from "../renderer.js";
import * as Signal from "../signal.js";

class PropertyFailure extends Schema.TaggedError<PropertyFailure>()("PropertyFailure", {}) {}

describe("effectful DOM acquisition", () => {
  scoped("should release bindings when native listener registration mutates and then fails", () =>
    Effect.gen(function* () {
      // Scope: a host registration may install its listener before throwing.
      // Assertion: partial listeners and earlier signal subscriptions are released.
      const count = yield* Signal.make(0);
      const container = document.createElement("main");
      let acquired: globalThis.Element | undefined;
      let releasedClicks = 0;
      const nativeAdd = globalThis.Element.prototype.addEventListener;
      const add = vi
        .spyOn(globalThis.Element.prototype, "addEventListener")
        .mockImplementation(function (this: globalThis.Element, ...args) {
          nativeAdd.apply(this, args);
          if (this.tagName === "ARTICLE" && args[0] === "click") {
            acquired = this;
            decodeURIComponent("%");
          }
        });
      const nativeRemove = globalThis.Element.prototype.removeEventListener;
      const remove = vi
        .spyOn(globalThis.Element.prototype, "removeEventListener")
        .mockImplementation(function (this: globalThis.Element, ...args) {
          nativeRemove.apply(this, args);
          if (this === acquired && args[0] === "click") releasedClicks++;
        });
      yield* Effect.addFinalizer(() =>
        Effect.sync(() => {
          add.mockRestore();
          remove.mockRestore();
          container.replaceChildren();
        }),
      );
      const exit = yield* Effect.gen(function* () {
        const renderer = yield* Renderer;
        yield* renderer.mount(
          container,
          <article data-count={count} onClick={() => Effect.void} data-force={Effect.void} />,
        );
      }).pipe(Effect.provide(browserLayer), Effect.scoped, Effect.exit);
      if (Exit.isSuccess(exit)) return assert.fail("Expected native acquisition failure");
      if (acquired === undefined) return assert.fail("Expected native listener registration");
      yield* Signal.set(count, 1);
      assert.strictEqual(acquired.getAttribute("data-count"), "0");
      assert.strictEqual(releasedClicks, 1);
      assert.strictEqual(container.childNodes.length, 0);
      assert.isTrue(
        exit.cause.reasons.some(
          (reason) => Cause.isDieReason(reason) && reason.defect instanceof URIError,
        ),
      );
    }),
  );
  for (const interrupted of [false, true]) {
    for (const releaseFails of [false, true]) {
      scoped(
        `should release earlier bindings after a property stops (interrupted: ${interrupted}, release fails: ${releaseFails})`,
        () =>
          Effect.gen(function* () {
            // Scope: a later property fails or suspends after event and signal bindings were acquired.
            // Assertion: cancellation/failure releases both bindings and retains every cleanup Cause.
            const count = yield* Signal.make(0);
            const entered = yield* Deferred.make<void>();
            const container = document.createElement("main");
            let acquired: globalThis.Element | undefined;
            let clicks = 0;
            let releasedClicks = 0;
            const nativeSet = globalThis.Element.prototype.setAttribute;
            const setter = vi
              .spyOn(globalThis.Element.prototype, "setAttribute")
              .mockImplementation(function (this: globalThis.Element, name, value) {
                nativeSet.call(this, name, value);
                if (name === "data-count") acquired = this;
              });
            const nativeRemove = globalThis.Element.prototype.removeEventListener;
            const remove = vi
              .spyOn(globalThis.Element.prototype, "removeEventListener")
              .mockImplementation(function (this: globalThis.Element, ...args) {
                nativeRemove.apply(this, args);
                if (this === acquired && args[0] === "click") releasedClicks++;
                if (releaseFails && this === acquired && args[0] === "click") BigInt("invalid");
              });
            yield* Effect.addFinalizer(() =>
              Effect.sync(() => {
                setter.mockRestore();
                remove.mockRestore();
                container.replaceChildren();
              }),
            );
            const property = Effect.gen(function* () {
              yield* Deferred.succeed(entered, undefined);
              if (interrupted) return yield* Effect.never;
              return yield* new PropertyFailure({});
            });
            const fiber = yield* Effect.gen(function* () {
              const renderer = yield* Renderer;
              yield* renderer.mount(
                container,
                <article
                  onClick={() =>
                    Effect.sync(() => {
                      clicks++;
                    })
                  }
                  data-count={count}
                  data-value={property}
                />,
              );
            }).pipe(Effect.provide(browserLayer), Effect.scoped, Effect.forkScoped);
            yield* Deferred.await(entered);
            if (interrupted) yield* Fiber.interrupt(fiber);
            const exit = yield* Fiber.await(fiber);
            if (Exit.isSuccess(exit)) return assert.fail("Expected failed acquisition");
            if (acquired === undefined) return assert.fail("Expected acquired property binding");
            yield* Signal.set(count, 1);
            acquired.dispatchEvent(new Event("click"));
            yield* Effect.yieldNow;
            assert.strictEqual(acquired.getAttribute("data-count"), "0");
            assert.strictEqual(clicks, 0);
            assert.strictEqual(releasedClicks, 1);
            assert.strictEqual(container.childNodes.length, 0);
            if (interrupted) assert.isTrue(Cause.hasInterrupts(exit.cause));
            else
              assert.isTrue(
                exit.cause.reasons.some(
                  (reason) => Cause.isFailReason(reason) && reason.error instanceof PropertyFailure,
                ),
              );
            if (releaseFails)
              assert.isTrue(
                exit.cause.reasons.some(
                  (reason) => Cause.isDieReason(reason) && reason.defect instanceof SyntaxError,
                ),
              );
          }),
      );
    }
  }
});
