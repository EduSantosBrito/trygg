import { assert, describe, vi } from "@effect/vitest";
import { Cause, Deferred, Effect, Exit, Fiber, Schema } from "effect";
import { scoped } from "../../testing/effect-vitest.js";
import { browserLayer, Renderer } from "../renderer.js";
import * as Signal from "../signal.js";

class ChildFailure extends Schema.TaggedError<ChildFailure>()("ChildFailure", {}) {}

describe("intrinsic child acquisition", () => {
  for (const keyed of [false, true]) {
    scoped(
      `should keep child Effects cancelable after acquiring earlier children (keyed: ${keyed})`,
      () =>
        Effect.gen(function* () {
          // Scope: a later child suspends while its parent owns earlier acquired bindings.
          // Assertion: caller cancellation terminates rendering and releases the entire partial subtree.
          const count = yield* Signal.make(0);
          const entered = yield* Deferred.make<void>();
          const container = document.createElement("main");
          const acquired = new Set<globalThis.Element>();
          const nativeSet = globalThis.Element.prototype.setAttribute;
          const setter = vi
            .spyOn(globalThis.Element.prototype, "setAttribute")
            .mockImplementation(function (this: globalThis.Element, name, value) {
              nativeSet.call(this, name, value);
              if (name === "data-count") acquired.add(this);
            });
          yield* Effect.addFinalizer(() =>
            Effect.sync(() => {
              setter.mockRestore();
              container.replaceChildren();
            }),
          );
          const pending = Deferred.succeed(entered, undefined).pipe(Effect.andThen(Effect.never));
          const fiber = yield* Effect.gen(function* () {
            const renderer = yield* Renderer;
            yield* renderer.mount(
              container,
              <article data-count={count} data-force={Effect.void}>
                <span
                  {...(keyed ? { key: "first" } : {})}
                  data-count={count}
                  data-force={Effect.void}
                >
                  first
                </span>
                <span data-count={count} data-force={pending}>
                  pending
                </span>
              </article>,
            );
          }).pipe(Effect.provide(browserLayer), Effect.scoped, Effect.forkScoped);
          yield* Deferred.await(entered);
          yield* Fiber.interrupt(fiber);
          const exit = yield* Fiber.await(fiber);
          assert.isTrue(Exit.hasInterrupts(exit));
          yield* Signal.set(count, 1);
          assert.strictEqual(acquired.size, 3);
          for (const node of acquired) assert.strictEqual(node.getAttribute("data-count"), "0");
          assert.strictEqual(container.childNodes.length, 0);
        }),
    );
  }
  for (const phase of ["root", "end"]) {
    for (const writeFails of [false, true]) {
      scoped(
        `should release native acquisitions when interrupted during ${phase} insertion (write fails: ${writeFails})`,
        () =>
          Effect.gen(function* () {
            // Scope: native insertion synchronously interrupts the current rendering fiber.
            // Assertion: bounded native work rolls back before handoff and preserves interruption plus any native defect.
            const count = yield* Signal.make(0);
            const container = document.createElement("main");
            const acquired = new Set<globalThis.Element>();
            let interrupt = () => {};
            const nativeSet = globalThis.Element.prototype.setAttribute;
            const setter = vi
              .spyOn(globalThis.Element.prototype, "setAttribute")
              .mockImplementation(function (this: globalThis.Element, name, value) {
                nativeSet.call(this, name, value);
                if (name === "data-count") acquired.add(this);
              });
            const nativeAppend = Node.prototype.appendChild;
            const append = vi.spyOn(Node.prototype, "appendChild").mockImplementation(function <
              T extends Node,
            >(this: Node, child: T): T {
              nativeAppend.call(this, child);
              if (
                (phase === "root" &&
                  child instanceof globalThis.Element &&
                  child.tagName === "ARTICLE") ||
                (phase === "end" && child instanceof Comment && child.data === "child-end")
              ) {
                interrupt();
                if (writeFails) decodeURIComponent("%");
              }
              return child;
            });
            yield* Effect.addFinalizer(() =>
              Effect.sync(() => {
                setter.mockRestore();
                append.mockRestore();
                container.replaceChildren();
              }),
            );
            const fiber = yield* Effect.gen(function* () {
              const renderer = yield* Renderer;
              yield* Effect.withFiber((current) => {
                interrupt = () => current.interruptUnsafe();
                return renderer.mount(
                  container,
                  <article data-count={count} data-force={Effect.void}>
                    <span key="first" data-count={count} data-force={Effect.void}>
                      first
                    </span>
                  </article>,
                );
              });
            }).pipe(Effect.provide(browserLayer), Effect.scoped, Effect.forkScoped);
            const exit = yield* Fiber.await(fiber);
            if (Exit.isSuccess(exit)) return assert.fail("Expected interrupted acquisition");
            yield* Signal.set(count, 1);
            assert.strictEqual(acquired.size, phase === "root" ? 1 : 2);
            for (const node of acquired) assert.strictEqual(node.getAttribute("data-count"), "0");
            assert.strictEqual(container.childNodes.length, 0);
            assert.isTrue(Cause.hasInterrupts(exit.cause));
            if (writeFails)
              assert.isTrue(
                exit.cause.reasons.some(
                  (reason) => Cause.isDieReason(reason) && reason.defect instanceof URIError,
                ),
              );
          }),
      );
    }
  }
  for (const phase of ["root", "anchor", "end", "slot", "keyed-child", "plain-child"]) {
    for (const releaseFails of [false, true]) {
      scoped(
        `should roll back acquired DOM when ${phase} fails (release fails: ${releaseFails})`,
        () =>
          Effect.gen(function* () {
            // Scope: native insertion or a later child fails after earlier bindings were acquired.
            // Assertion: all acquired nodes stop reacting, partial DOM is detached, and cleanup defects remain in the Cause.
            const count = yield* Signal.make(0);
            const container = document.createElement("main");
            const acquired = new Set<globalThis.Element>();
            const nativeSet = globalThis.Element.prototype.setAttribute;
            const setter = vi
              .spyOn(globalThis.Element.prototype, "setAttribute")
              .mockImplementation(function (this: globalThis.Element, name, value) {
                nativeSet.call(this, name, value);
                if (name === "data-count") acquired.add(this);
              });
            const nativeAppend = Node.prototype.appendChild;
            const append = vi.spyOn(Node.prototype, "appendChild").mockImplementation(function <
              T extends Node,
            >(this: Node, child: T): T {
              nativeAppend.call(this, child);
              if (
                (phase === "root" &&
                  child instanceof globalThis.Element &&
                  child.tagName === "ARTICLE") ||
                (phase === "anchor" && child instanceof Comment && child.data === "children-end") ||
                (phase === "end" && child instanceof Comment && child.data === "child-end")
              )
                decodeURIComponent("%");
              return child;
            });
            const nativeInsert = Node.prototype.insertBefore;
            const insert = vi.spyOn(Node.prototype, "insertBefore").mockImplementation(function <
              T extends Node,
            >(this: Node, child: T, before: Node | null): T {
              nativeInsert.call(this, child, before);
              if (
                phase === "slot" &&
                this instanceof globalThis.Element &&
                this.tagName === "ARTICLE"
              )
                decodeURIComponent("%");
              return child;
            });
            const nativeRemove = globalThis.Element.prototype.remove;
            const remove = vi
              .spyOn(globalThis.Element.prototype, "remove")
              .mockImplementation(function (this: globalThis.Element) {
                nativeRemove.call(this);
                if (releaseFails && this.tagName === "ARTICLE") BigInt("invalid");
              });
            const reporter = vi.spyOn(console, "error").mockImplementation(() => {});
            yield* Effect.addFinalizer(() =>
              Effect.sync(() => {
                setter.mockRestore();
                append.mockRestore();
                insert.mockRestore();
                remove.mockRestore();
                reporter.mockRestore();
                container.replaceChildren();
              }),
            );
            const laterChild = phase === "keyed-child" || phase === "plain-child";
            const exit = yield* Effect.gen(function* () {
              const renderer = yield* Renderer;
              yield* renderer.mount(
                container,
                <article data-count={count} data-force={Effect.void}>
                  <span
                    {...(phase === "plain-child" ? {} : { key: "first" })}
                    data-count={count}
                    data-force={Effect.void}
                  >
                    first
                  </span>
                  {laterChild ? (
                    <span data-force={Effect.fail(new ChildFailure({}))}>second</span>
                  ) : null}
                </article>,
              );
            }).pipe(Effect.provide(browserLayer), Effect.scoped, Effect.exit);
            if (Exit.isSuccess(exit)) return assert.fail("Expected failed acquisition");
            yield* Signal.set(count, 1);
            assert.strictEqual(acquired.size, phase === "root" || phase === "anchor" ? 1 : 2);
            for (const node of acquired) assert.strictEqual(node.getAttribute("data-count"), "0");
            assert.strictEqual(container.childNodes.length, 0);
            if (laterChild)
              assert.isTrue(
                exit.cause.reasons.some(
                  (reason) => Cause.isFailReason(reason) && reason.error instanceof ChildFailure,
                ),
              );
            else
              assert.isTrue(
                exit.cause.reasons.some(
                  (reason) => Cause.isDieReason(reason) && reason.defect instanceof URIError,
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
