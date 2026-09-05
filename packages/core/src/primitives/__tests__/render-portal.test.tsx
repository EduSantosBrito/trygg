import { assert, describe } from "@effect/vitest";
import { Effect, Exit, Scope, Schema } from "effect";
import { scoped } from "../../testing/effect-vitest.js";
import { render } from "../../testing/index.js";
import * as Component from "../component.js";
import { Element } from "../element.js";

class PortalChildError extends Schema.TaggedError<PortalChildError>()("PortalChildError", {
  message: Schema.String,
}) {}

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

  scoped("should rollback staged children when a later portal child fails", () =>
    Effect.gen(function* () {
      // Scope: covers progressive portal construction before ownership is returned.
      // Assertion: target DOM is unchanged and every acquired child resource is finalized.
      const target = document.createElement("div");
      target.innerHTML = '<span data-testid="existing">existing</span>';
      document.body.appendChild(target);
      yield* Effect.addFinalizer(() => Effect.sync(() => target.remove()));
      let finalized = 0;

      const Acquired = Component.gen(function* () {
        yield* Effect.addFinalizer(() =>
          Effect.sync(() => {
            finalized++;
          }),
        );
        return <span data-testid="portal-acquired">new</span>;
      });
      const Failing = Component.gen(function* () {
        return yield* new PortalChildError({ message: "second child failed" });
      });

      const before = target.innerHTML;
      const exit = yield* Effect.exit(
        render(
          Element.Portal({
            target,
            children: [<Acquired />, <Failing />],
          }),
        ),
      );

      assert.isTrue(Exit.isFailure(exit));
      assert.strictEqual(target.innerHTML, before);
      assert.strictEqual(finalized, 1);
      assert.isNull(target.querySelector('[data-testid="portal-acquired"]'));
    }),
  );
});
