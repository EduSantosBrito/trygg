import { assert, describe } from "@effect/vitest";
import { Context, Effect, Layer } from "effect";
import { scoped } from "../../testing/effect-vitest.js";
import { render } from "../../testing/index.js";
import * as Component from "../component.js";

describe("render-provide", () => {
  scoped("merges provided context for child components", () =>
    Effect.gen(function* () {
      class Label extends Context.Service<Label, { readonly value: string }>()("test/Label") {}

      const Child = Component.gen(function* () {
        const label = yield* Label;
        return <span data-testid="label">{label.value}</span>;
      });

      const Parent = Component.gen(function* () {
        return <Child />;
      }).pipe(Component.provide(Layer.succeed(Label, { value: "provided" })));

      const { getByTestId } = yield* render(<Parent />);

      assert.strictEqual((yield* getByTestId("label")).textContent, "provided");
    }),
  );
});
