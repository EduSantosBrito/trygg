import { assert, describe } from "@effect/vitest";
import { Cause, Context, Effect, Exit, Scope } from "effect";
import { scoped } from "../../testing/effect-vitest.js";
import { render } from "../../testing/index.js";
import { unsafeEraseR, unsafeWidenContext } from "../../internal/unsafe.js";
import * as SafeUrl from "../../security/safe-url.js";
import { Element } from "../element.js";
import { renderFragment } from "../render-fragment.js";
import type { RenderContext, RenderResult } from "../renderer.js";

describe("render-fragment", () => {
  scoped("renders children without wrapper", () =>
    Effect.gen(function* () {
      const { getByTestId } = yield* render(
        <div data-testid="parent">
          <>
            <span data-testid="first">A</span>
            <span data-testid="second">B</span>
          </>
        </div>,
      );

      const parent = yield* getByTestId("parent");
      assert.strictEqual((yield* getByTestId("first")).parentElement, parent);
      assert.strictEqual((yield* getByTestId("second")).parentElement, parent);
    }),
  );

  scoped("cleans rendered children", () =>
    Effect.gen(function* () {
      const scope = yield* Scope.make();

      yield* render(
        <>
          <span id="fragment-cleanup" />
        </>,
      ).pipe(Scope.provide(scope));

      assert.isNotNull(document.querySelector("#fragment-cleanup"));
      yield* Scope.close(scope, Exit.void);
      assert.isNull(document.querySelector("#fragment-cleanup"));
    }),
  );

  scoped("should attempt every child cleanup and preserve the first cleanup defect", () =>
    Effect.gen(function* () {
      // Scope: covers sibling cleanup after one Fragment child release fails.
      // Assertion: both releases run exactly once and the original Die Cause remains observable.
      const scope = yield* Scope.make();
      const parent = document.createElement("div");
      const cleanupDefect = "fragment cleanup defect";
      const attempts: Array<string> = [];
      let childIndex = 0;
      const renderContext: RenderContext = {
        services: unsafeWidenContext(Context.empty()),
        scope,
        safeUrlConfig: SafeUrl.defaultConfig,
      };

      const fragment = yield* unsafeEraseR(
        renderFragment(
          [Element.Text({ content: "first" }), Element.Text({ content: "second" })],
          parent,
          renderContext,
          null,
          { errorHandler: null },
          {
            renderElement: (_element, target): Effect.Effect<RenderResult> =>
              Effect.sync(() => {
                const index = childIndex++;
                const label = index === 0 ? "first" : "second";
                const node = document.createTextNode(label);
                target.appendChild(node);
                return {
                  node,
                  cleanup:
                    index === 0
                      ? // oxlint-disable-next-line effect/no-effect-escape-hatch -- Deliberately verifies that sibling cleanup continues after a defect.
                        Effect.die(cleanupDefect).pipe(
                          Effect.ensuring(
                            Effect.sync(() => {
                              attempts.push(label);
                              node.remove();
                            }),
                          ),
                        )
                      : Effect.sync(() => {
                          attempts.push(label);
                          node.remove();
                        }),
                };
              }),
          },
        ),
      );

      const exit = yield* Effect.exit(unsafeEraseR(fragment.cleanup));

      assert.deepStrictEqual(attempts, ["first", "second"]);
      assert.isTrue(Exit.hasDies(exit));
      if (Exit.isFailure(exit)) assert.strictEqual(Cause.squash(exit.cause), cleanupDefect);
      assert.strictEqual(parent.textContent, "");
      yield* Scope.close(scope, Exit.void);
    }),
  );
});
