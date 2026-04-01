import { assert, describe, it } from "@effect/vitest";
import { Effect } from "effect";

import * as Component from "../../primitives/component.js";
import { Element, getKey, text } from "../../primitives/element.js";
import { buildJsx } from "../jsx-builder.js";

const BuilderComponent = Component.gen(function* (
  Props: Component.ComponentProps<{ readonly message: string }>,
) {
  const { message } = yield* Props;
  return Element.Intrinsic({
    tag: "span",
    props: {},
    children: [text(message)],
    key: null,
  });
});

describe("buildJsx", () => {
  it.effect("should shape intrinsic props and normalize children while explicit key wins", () =>
    Effect.gen(function* () {
      // Test: should shape intrinsic props and normalize children while explicit key wins.
      // Scope: verifies the shared JSX builder handles the intrinsic happy path used by jsx/jsxs.
      // Assertion: removes JSX-only props, preserves the explicit key, and normalizes nested children.
      const element = yield* buildJsx("div", {
        id: "root",
        key: "props-key",
        children: ["hello", null, ["world"]],
      }, 7);

      assert.strictEqual(element._tag, "Intrinsic");
      if (element._tag !== "Intrinsic") {
        return assert.fail("Expected Intrinsic element");
      }

      assert.strictEqual(element.tag, "div");
      assert.deepStrictEqual(element.props, { id: "root" });
      assert.strictEqual(element.key, 7);
      assert.strictEqual(element.children.length, 2);

      const [firstChild, secondChild] = element.children;
      assert.strictEqual(firstChild?._tag, "Text");
      assert.strictEqual(secondChild?._tag, "Text");

      if (firstChild?._tag !== "Text" || secondChild?._tag !== "Text") {
        return assert.fail("Expected text children");
      }

      assert.strictEqual(firstChild.content, "hello");
      assert.strictEqual(secondChild.content, "world");
    }),
  );

  it.effect("should preserve component props and key while building a valid effect component", () =>
    Effect.gen(function* () {
      // Test: should preserve component props and key while building a valid effect component.
      // Scope: verifies the shared builder covers the component happy path in addition to intrinsic elements.
      // Assertion: returns a component element shell, keeps the provided props, and preserves the explicit key.
      const element = yield* buildJsx(BuilderComponent, { message: "hello" }, 3);

      assert.strictEqual(element._tag, "Component");
      if (element._tag !== "Component") {
        return assert.fail("Expected Component element");
      }

      assert.deepStrictEqual(element.inputs, { message: "hello" });
      assert.strictEqual(getKey(element), 3);
    }),
  );
});
