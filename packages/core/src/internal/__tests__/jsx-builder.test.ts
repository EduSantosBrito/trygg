import { assert, describe, it } from "@effect/vitest";
import { Cause, Effect, Exit, Predicate } from "effect";

import * as Component from "../../primitives/component.js";
import { Element, getKey, text } from "../../primitives/element.js";
import { InvalidJsxComponentInput, JsxBuilder } from "../jsx-builder.js";

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

describe("JsxBuilder.build", () => {
  it.effect("should shape intrinsic props and normalize children while explicit key wins", () =>
    Effect.gen(function* () {
      // Test: should shape intrinsic props and normalize children while explicit key wins.
      // Scope: verifies the shared JSX builder handles the intrinsic happy path used by jsx/jsxs.
      // Assertion: removes JSX-only props, preserves the explicit key, and normalizes nested children.
      const element = yield* JsxBuilder.build(
        "div",
        {
          id: "root",
          key: "props-key",
          children: ["hello", null, ["world"]],
        },
        7,
      );

      assert.isTrue(Predicate.isTagged(element, "Intrinsic"));
      if (!Predicate.isTagged(element, "Intrinsic")) {
        return assert.fail("Expected Intrinsic element");
      }

      assert.strictEqual(element.tag, "div");
      assert.deepStrictEqual(element.props, { id: "root" });
      assert.strictEqual(element.key, 7);
      assert.strictEqual(element.children.length, 2);

      const [firstChild, secondChild] = element.children;
      assert.isTrue(Predicate.isTagged(firstChild, "Text"));
      assert.isTrue(Predicate.isTagged(secondChild, "Text"));

      if (!Predicate.isTagged(firstChild, "Text") || !Predicate.isTagged(secondChild, "Text")) {
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
      const element = yield* JsxBuilder.build(BuilderComponent, { message: "hello" }, 3);

      assert.isTrue(Predicate.isTagged(element, "Component"));
      if (!Predicate.isTagged(element, "Component")) {
        return assert.fail("Expected Component element");
      }

      assert.deepStrictEqual(element.inputs, { message: "hello" });
      assert.strictEqual(getKey(element), 3);
    }),
  );

  it.effect(
    "should preserve safe props and explicit key while malformed jsx-only props throw",
    () =>
      Effect.gen(function* () {
        // Test: should preserve safe props and explicit key while malformed jsx-only props throw.
        // Scope: guards the shared builder against hostile JavaScript prop objects without relying on the public sync runtime wrapper.
        // Assertion: keeps readable props, drops throwing children/key reads, and still returns a normal intrinsic element.
        const context = yield* Effect.context<never>();
        const element = yield* JsxBuilder.build(
          "div",
          {
            id: "root",
            get children() {
              return Effect.runSyncWith(context)(Effect.fail("boom-children"));
            },
            get key() {
              return Effect.runSyncWith(context)(Effect.fail("boom-key"));
            },
          },
          7,
        );

        assert.isTrue(Predicate.isTagged(element, "Intrinsic"));
        if (!Predicate.isTagged(element, "Intrinsic")) {
          return assert.fail("Expected Intrinsic element");
        }

        assert.deepStrictEqual(element.props, { id: "root" });
        assert.strictEqual(element.key, 7);
        assert.deepStrictEqual(element.children, []);
      }),
  );

  it.effect(
    "should fail with typed invalid-component error while building plain function inputs",
    () =>
      Effect.gen(function* () {
        // Test: should fail with typed invalid-component error while building plain function inputs.
        // Scope: verifies the shared builder classifies unsupported JSX component values internally instead of recovering at this layer.
        // Assertion: JsxBuilder.build fails with the internal invalid-component classification and preserves the plain-function reason.
        const Plain = () => Element.Intrinsic({ tag: "span", props: {}, children: [], key: null });

        const exit = yield* Effect.exit(JsxBuilder.build(Plain, {}, 5));

        if (Exit.isSuccess(exit)) {
          return assert.fail("Expected JsxBuilder.build to fail for plain functions");
        }

        const error = Cause.squash(exit.cause);
        if (!(error instanceof InvalidJsxComponentInput)) {
          return assert.fail("Expected typed invalid-component error");
        }

        assert.strictEqual(error.reason, "plain-function");
        assert.strictEqual(error.key, 5);
      }),
  );

  it.effect("should fail with typed invalid-component error while building raw Effect inputs", () =>
    Effect.gen(function* () {
      // Test: should fail with typed invalid-component error while building raw Effect inputs.
      // Scope: verifies the shared builder classifies raw Effect component values with the same internal contract used by the public runtime recovery.
      // Assertion: JsxBuilder.build fails with the internal invalid-component classification, preserves the effect reason, and keeps the resolved key.
      const directEffect = Effect.succeed(
        Element.Intrinsic({ tag: "span", props: {}, children: [], key: null }),
      );

      const exit = yield* Effect.exit(JsxBuilder.build(directEffect, {}, 8));

      if (Exit.isSuccess(exit)) {
        return assert.fail("Expected JsxBuilder.build to fail for raw Effect inputs");
      }

      const error = Cause.squash(exit.cause);
      if (!(error instanceof InvalidJsxComponentInput)) {
        return assert.fail("Expected typed invalid-component error");
      }

      assert.strictEqual(error.reason, "effect");
      assert.strictEqual(error.key, 8);
    }),
  );
});
