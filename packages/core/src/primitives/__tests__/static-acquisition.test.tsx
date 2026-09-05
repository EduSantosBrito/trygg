import { assert, describe, vi } from "@effect/vitest";
import { Cause, Effect, Exit, Fiber } from "effect";
import { scoped } from "../../testing/effect-vitest.js";
import { browserLayer, Renderer } from "../renderer.js";
import * as Signal from "../signal.js";

describe("static DOM acquisition", () => {
  scoped(
    "should release static subscriptions when native removal fails during normal unmount",
    () =>
      Effect.gen(function* () {
        // Scope: cleanup must release external references even if DOM detachment throws.
        // Assertion: the release defect remains observable and the retained node stops reacting.
        const count = yield* Signal.make(0);
        const container = document.createElement("main");
        const nativeRemove = globalThis.Element.prototype.remove;
        const remove = vi
          .spyOn(globalThis.Element.prototype, "remove")
          .mockImplementation(function (this: globalThis.Element) {
            if (this.tagName === "ARTICLE") BigInt("invalid");
            nativeRemove.call(this);
          });
        yield* Effect.addFinalizer(() =>
          Effect.sync(() => {
            remove.mockRestore();
            container.replaceChildren();
          }),
        );
        const exit = yield* Effect.gen(function* () {
          const renderer = yield* Renderer;
          yield* renderer.mount(container, <article data-count={count} />);
        }).pipe(Effect.provide(browserLayer), Effect.scoped, Effect.exit);
        if (Exit.isSuccess(exit)) return assert.fail("Expected native release failure");
        const node = container.querySelector("article");
        if (node === null) return assert.fail("Expected retained node after failed removal");
        assert.isTrue(
          exit.cause.reasons.some(
            (reason) => Cause.isDieReason(reason) && reason.defect instanceof SyntaxError,
          ),
        );
        yield* Signal.set(count, 1);
        assert.strictEqual(node.getAttribute("data-count"), "0");
      }),
  );
  for (const writeFails of [true, false]) {
    for (const mode of ["direct", "keyed"]) {
      scoped(
        `should release native acquisitions and preserve mixed Cause when interrupted during a write (${mode}, fails: ${writeFails})`,
        () =>
          Effect.gen(function* () {
            // Scope: a native callback interrupts its own rendering fiber immediately before throwing.
            // Assertion: cancellation cannot skip acquisition rollback or erase the native defect.
            const count = yield* Signal.make(0);
            const container = document.createElement("main");
            const acquired = new Set<globalThis.Element>();
            let interrupt = () => {};
            let rowFiber: Fiber.Fiber<unknown, unknown> | undefined;
            const nativeSet = globalThis.Element.prototype.setAttribute;
            const setter = vi
              .spyOn(globalThis.Element.prototype, "setAttribute")
              .mockImplementation(function (this: globalThis.Element, name, value) {
                nativeSet.call(this, name, value);
                if (name === "data-count") acquired.add(this);
                if (name === "title") {
                  interrupt();
                  if (writeFails) decodeURIComponent("%");
                }
              });
            yield* Effect.addFinalizer(() => Effect.sync(() => setter.mockRestore()));
            const fiber = yield* Effect.gen(function* () {
              const renderer = yield* Renderer;
              const element = <article data-count={count} title="blocked" />;
              const items = yield* Signal.make([1]);
              yield* Effect.withFiber((current) => {
                interrupt = () => current.interruptUnsafe();
                return renderer.mount(
                  container,
                  mode === "direct" ? (
                    element
                  ) : (
                    <ul>
                      {Signal.each(
                        items,
                        () =>
                          Effect.withFiber((worker) => {
                            rowFiber = worker;
                            interrupt = () => worker.interruptUnsafe();
                            return Effect.succeed(element);
                          }),
                        { key: (id) => id },
                      )}
                    </ul>
                  ),
                );
              });
            }).pipe(Effect.provide(browserLayer), Effect.scoped, Effect.forkScoped);
            const mountExit = yield* Fiber.await(fiber);
            const exit = mode === "direct" ? mountExit : rowFiber?.pollUnsafe();
            if (exit === undefined) return assert.fail("Expected settled rendering worker");
            if (Exit.isSuccess(exit)) return assert.fail("Expected interrupted native failure");
            setter.mockRestore();
            yield* Signal.set(count, 1);
            assert.strictEqual(acquired.size, 1);
            for (const node of acquired) assert.strictEqual(node.getAttribute("data-count"), "0");
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
  for (const mode of ["direct", "keyed"]) {
    for (const phase of [
      "property",
      "child-insertion",
      "root-insertion",
      "root-rollback",
      "end-marker",
    ]) {
      if (phase === "end-marker" && mode === "direct") continue;
      scoped(`should release partial subscriptions while ${phase} fails (${mode})`, () =>
        Effect.gen(function* () {
          // Scope: real native acquisition fails after subscriptions, including insertion that mutates before failing.
          // Assertion: retained nodes stop reacting; insertion rollback removes the root or preserves both native defects.
          const reporter = vi.spyOn(console, "error").mockImplementation(() => {});
          const count = yield* Signal.make(0);
          const container = document.createElement("main");
          const acquired = new Set<globalThis.Element>();
          const nativeSet = globalThis.Element.prototype.setAttribute;
          const setter = vi
            .spyOn(globalThis.Element.prototype, "setAttribute")
            .mockImplementation(function (this: globalThis.Element, name, value) {
              nativeSet.call(this, name, value);
              if (name === "data-count") acquired.add(this);
              if (phase === "property" && name === "title") decodeURIComponent("%");
            });
          const nativeAppend = Node.prototype.appendChild;
          const append = vi.spyOn(Node.prototype, "appendChild").mockImplementation(function <
            T extends Node,
          >(this: Node, child: T): T {
            nativeAppend.call(this, child);
            if (
              (phase === "end-marker" && child instanceof Comment && child.data === "item-end") ||
              (phase === "child-insertion" &&
                this instanceof globalThis.Element &&
                this.tagName === "ARTICLE") ||
              ((phase === "root-insertion" || phase === "root-rollback") &&
                child instanceof globalThis.Element &&
                child.tagName === "ARTICLE")
            )
              decodeURIComponent("%");
            // Return the input because native appendChild returns that exact node.
            return child;
          });
          const nativeRemove = globalThis.Element.prototype.remove;
          const remove = vi
            .spyOn(globalThis.Element.prototype, "remove")
            .mockImplementation(function (this: globalThis.Element) {
              if (phase === "root-rollback" && this.tagName === "ARTICLE") BigInt("invalid");
              nativeRemove.call(this);
            });
          yield* Effect.addFinalizer(() =>
            Effect.sync(() => {
              reporter.mockRestore();
              setter.mockRestore();
              append.mockRestore();
              remove.mockRestore();
              container.replaceChildren();
            }),
          );
          const exit = yield* Effect.gen(function* () {
            const renderer = yield* Renderer;
            const element = (
              <article data-count={count}>
                <span data-count={count}>first</span>
                <b data-count={count} title="blocked">
                  second
                </b>
              </article>
            );
            const items = yield* Signal.make([1]);
            yield* renderer.mount(
              container,
              mode === "direct" ? (
                element
              ) : (
                <ul>{Signal.each(items, () => element, { key: (id) => id })}</ul>
              ),
            );
          }).pipe(Effect.provide(browserLayer), Effect.scoped, Effect.exit);
          assert.strictEqual(acquired.size, phase === "child-insertion" ? 2 : 3);
          if (mode === "direct") {
            if (Exit.isSuccess(exit)) return assert.fail("Expected native acquisition failure");
            assert.isTrue(
              exit.cause.reasons.some(
                (reason) => Cause.isDieReason(reason) && reason.defect instanceof URIError,
              ),
            );
            if (phase === "root-rollback") {
              assert.isTrue(
                exit.cause.reasons.some(
                  (reason) => Cause.isDieReason(reason) && reason.defect instanceof SyntaxError,
                ),
              );
            }
          } else {
            // Keyed initial rendering belongs to its scoped worker; defects reach its reporter.
            assert.isTrue(Exit.isSuccess(exit));
            const reports = reporter.mock.calls.flat();
            assert.isTrue(
              reports.some((value) => typeof value === "string" && value.includes("URIError")),
            );
            if (phase === "root-rollback")
              assert.isTrue(
                reports.some((value) => typeof value === "string" && value.includes("SyntaxError")),
              );
          }
          if (phase !== "root-rollback") assert.isNull(container.querySelector("article"));
          setter.mockRestore();
          append.mockRestore();
          remove.mockRestore();
          yield* Signal.set(count, 1);
          for (const node of acquired) assert.strictEqual(node.getAttribute("data-count"), "0");
        }),
      );
    }
  }
});
