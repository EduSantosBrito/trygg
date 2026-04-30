import { assert, describe } from "@effect/vitest";
import { Effect, Exit, Scope } from "effect";
import { scoped } from "../../testing/effect-vitest.js";
import { render } from "../../testing/index.js";

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
});
