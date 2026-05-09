import { assert, describe } from "@effect/vitest";
import { Effect, Exit, Scope } from "effect";
import { scoped } from "../../testing/effect-vitest.js";
import { render } from "../../testing/index.js";
import { Element } from "../element.js";

describe("render-portal", () => {
  scoped("renders children into target", () =>
    Effect.gen(function* () {
      const target = document.createElement("div");
      target.id = "portal-target";
      document.body.appendChild(target);
      yield* Effect.addFinalizer(() => Effect.sync(() => target.remove()));

      const { getByTestId } = yield* render(
        <div data-testid="host">
          {Element.Portal({ target, children: <span>teleported</span> })}
        </div>,
      );

      assert.strictEqual((yield* getByTestId("host")).textContent, "");
      assert.strictEqual(target.textContent, "teleported");
    }),
  );

  scoped("cleans target children and anchor", () =>
    Effect.gen(function* () {
      const scope = yield* Scope.make();
      const target = document.createElement("div");
      document.body.appendChild(target);

      yield* render(Element.Portal({ target, children: <span id="portal-cleanup" /> })).pipe(
        Scope.provide(scope),
      );

      assert.isNotNull(document.querySelector("#portal-cleanup"));
      yield* Scope.close(scope, Exit.void);
      assert.isNull(document.querySelector("#portal-cleanup"));
      target.remove();
    }),
  );
});
