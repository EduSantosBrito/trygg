import { assert, describe, it, vi } from "@effect/vitest";
import { Cause, Effect, Exit } from "effect";
import * as Component from "../component.js";
import { browserLayer, Renderer } from "../renderer.js";

describe("mount cleanup Cause", () => {
  it.effect.each([false, true])(
    "should preserve a failed release while finalizing the remaining mount (interrupted: %s)",
    (interrupted) =>
      Effect.gen(function* () {
        // Scope: closes the production renderer's root with a defective child release.
        // Assertion: every sibling releases, DOM is removed, and the owner observes the original defect.
        const defect = { message: "child release failed" };
        const releaseCause = interrupted
          ? Cause.combine(Cause.die(defect), Cause.interrupt(123))
          : Cause.die(defect);
        const releases: Array<string> = [];
        const container = document.createElement("div");
        const reporter = vi.spyOn(console, "error").mockImplementation(() => {});
        const First = Component.gen(function* () {
          yield* Effect.addFinalizer(() =>
            Effect.sync(() => {
              releases.push("first");
            }).pipe(Effect.andThen(Effect.failCause(releaseCause))),
          );
          return <span>first</span>;
        });
        const Second = Component.gen(function* () {
          yield* Effect.addFinalizer(() =>
            Effect.sync(() => {
              releases.push("second");
            }),
          );
          return <span>second</span>;
        });
        const exit = yield* Effect.gen(function* () {
          const renderer = yield* Renderer;
          yield* renderer.mount(
            container,
            <div>
              <First />
              <Second />
            </div>,
          );
        }).pipe(
          Effect.provide(browserLayer),
          Effect.scoped,
          Effect.exit,
          Effect.ensuring(Effect.sync(() => reporter.mockRestore())),
        );

        assert.deepStrictEqual(releases.toSorted(), ["first", "second"]);
        assert.strictEqual(container.childNodes.length, 0);
        assert.isTrue(Exit.isFailure(exit));
        assert.strictEqual(Exit.hasInterrupts(exit), interrupted);
        if (Exit.isFailure(exit))
          assert.isTrue(
            exit.cause.reasons.some(
              (reason) => Cause.isDieReason(reason) && reason.defect === defect,
            ),
          );
      }),
  );
});
