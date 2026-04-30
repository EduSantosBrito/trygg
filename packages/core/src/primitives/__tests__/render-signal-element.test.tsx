import { assert, describe } from "@effect/vitest";
import { Effect, Exit, Scope } from "effect";
import { TestClock } from "effect/testing";
import { scoped } from "../../testing/effect-vitest.js";
import { render } from "../../testing/index.js";
import * as Signal from "../signal.js";

describe("render-signal-element", () => {
  scoped("swaps DOM content when signal changes", () =>
    Effect.gen(function* () {
      const view = yield* Signal.make(<span data-testid="before">before</span>);
      const { getByTestId, queryByTestId } = yield* render(<div>{view}</div>);

      assert.strictEqual((yield* getByTestId("before")).textContent, "before");
      yield* Signal.set(view, <strong data-testid="after">after</strong>);
      yield* TestClock.adjust(20);

      assert.strictEqual((yield* getByTestId("after")).textContent, "after");
      assert.isTrue((yield* queryByTestId("before"))._tag === "None");
    }),
  );

  scoped("cleans current content on unmount", () =>
    Effect.gen(function* () {
      const scope = yield* Scope.make();
      const view = yield* Signal.make(<span id="signal-element-cleanup" />);

      yield* render(<div>{view}</div>).pipe(Scope.provide(scope));
      assert.isNotNull(document.querySelector("#signal-element-cleanup"));

      yield* Scope.close(scope, Exit.void);
      assert.isNull(document.querySelector("#signal-element-cleanup"));
    }),
  );
});
