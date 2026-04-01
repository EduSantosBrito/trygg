/**
 * JSX Runtime Component Validation Tests
 *
 * Tests for Component.gen enforcement:
 * - Reject untagged function component
 * - Reject direct Effect<Element> in JSX
 * - Accept Component.gen components
 */
import { assert, describe, it } from "@effect/vitest";
import { Cause, Effect, Exit } from "effect";
import * as ServiceMap from "effect/ServiceMap";
import * as Component from "../primitives/component.js";
import { getKey } from "../primitives/element.js";
import { jsx, jsxs } from "../jsx-runtime.js";
import { render } from "../testing/index.js";

describe("JSX component validation", () => {
  it.effect("should reject direct Effect<Element> with InvalidComponentError", () =>
    Effect.gen(function* () {
      // Test: should reject direct Effect<Element> with InvalidComponentError while rendering invalid JSX components.
      // Scope: guards the lazy invalid-component path at the public runtime boundary.
      // Assertion: rendering fails with InvalidComponentError reason "effect" instead of succeeding.
      const directEffect = Effect.succeed(<span data-testid="direct">Hello</span>);
      const DirectEffect = directEffect;

      // @ts-expect-error invalid component type
      const element = <DirectEffect />;

      const exit = yield* Effect.exit(render(element));

      if (Exit.isSuccess(exit)) {
        throw new Error("Expected failure but got success");
      }

      const error = Cause.squash(exit.cause);
      if (!(error instanceof Component.InvalidComponentError)) {
        throw new Error(`Expected InvalidComponentError but got ${error}`);
      }

      assert.strictEqual(error.reason, "effect");
    }),
  );

  it.effect("should reject plain function components", () =>
    Effect.gen(function* () {
      // Test: should reject plain function components while rendering unsupported JSX component inputs.
      // Scope: ensures the runtime keeps plain functions outside the supported Component.gen model.
      // Assertion: rendering fails with InvalidComponentError reason "plain-function".
      const Plain = () => <span data-testid="plain">Hello</span>;

      const element = <Plain />;

      const exit = yield* Effect.exit(render(element));

      if (Exit.isSuccess(exit)) {
        throw new Error("Expected failure but got success");
      }

      const error = Cause.squash(exit.cause);
      if (!(error instanceof Component.InvalidComponentError)) {
        throw new Error(`Expected InvalidComponentError but got ${error}`);
      }

      assert.strictEqual(error.reason, "plain-function");
    }),
  );

  it.effect("should reject direct Effect children", () =>
    Effect.gen(function* () {
      // Test: should reject direct Effect children while rendering intrinsic JSX trees.
      // Scope: preserves the existing child-validation boundary alongside the shared builder rewrite.
      // Assertion: rendering fails instead of accepting raw Effect child values.
      const childEffect = Effect.succeed(<span data-testid="effect-child">Hello</span>);

      const exit = yield* Effect.exit(
        render(
          <div>
            {/* @ts-expect-error hard break: raw Effect children invalid */}
            {childEffect}
          </div>,
        ),
      );

      if (Exit.isSuccess(exit)) {
        throw new Error("Expected failure but got success");
      }
    }),
  );

  it.effect("should accept Component.gen components", () =>
    Effect.gen(function* () {
      // Test: should accept Component.gen components while rendering valid effect components.
      // Scope: verifies the public runtime still accepts supported component inputs after the builder rewrite.
      // Assertion: rendering succeeds and produces the expected DOM content.
      const ValidComponent = Component.gen(function* () {
        return <span data-testid="valid">Hello from Component.gen</span>;
      });

      const { getByTestId } = yield* render(<ValidComponent />);

      assert.strictEqual((yield* getByTestId("valid")).textContent, "Hello from Component.gen");
    }),
  );

  it.effect("should accept Component.gen with props", () =>
    Effect.gen(function* () {
      // Test: should accept Component.gen props while rendering valid effect components.
      // Scope: verifies props still flow through the public runtime unchanged.
      // Assertion: rendering succeeds and exposes the provided prop value in the DOM.
      const ComponentWithProps = Component.gen(function* (
        Props: Component.ComponentProps<{ message: string }>,
      ) {
        const { message } = yield* Props;
        return <span data-testid="message">{message}</span>;
      });

      const { getByTestId } = yield* render(<ComponentWithProps message="Hello with props" />);

      assert.strictEqual((yield* getByTestId("message")).textContent, "Hello with props");
    }),
  );

  it.effect("should accept intrinsic HTML elements", () =>
    Effect.gen(function* () {
      // Test: should accept intrinsic HTML elements while rendering public JSX entrypoints.
      // Scope: keeps the intrinsic happy path covered at the public runtime layer.
      // Assertion: rendering succeeds and preserves the expected DOM tag and props.
      const { getByTestId } = yield* render(<div data-testid="intrinsic" className="test" />);

      const element = yield* getByTestId("intrinsic");
      assert.strictEqual(element.tagName.toLowerCase(), "div");
      assert.strictEqual(element.className, "test");
    }),
  );

  it("should normalize static children and preserve explicit keys while using jsxs", () => {
    // Test: should normalize static children and preserve explicit keys while using jsxs.
    // Scope: verifies the multiple-children public entrypoint stays aligned with jsx through the shared builder.
    // Assertion: jsxs returns the same observable intrinsic shape, normalized children, and explicit key precedence.
    const element = jsxs("div", {
      id: "root",
      key: "props-key",
      children: ["hello", null, ["world"]],
    }, 9);

    assert.strictEqual(element._tag, "Intrinsic");
    if (element._tag !== "Intrinsic") {
      return assert.fail("Expected Intrinsic element");
    }

    assert.deepStrictEqual(element.props, { id: "root" });
    assert.strictEqual(element.key, 9);
    assert.strictEqual(element.children.length, 2);
  });

  it("should not require services while constructing valid effect components with jsx", () => {
    // Test: should not require services while constructing valid effect components with jsx.
    // Scope: verifies the public sync bridge builds the element shell without running component requirements eagerly.
    // Assertion: jsx returns a component element immediately and preserves the explicit key without service provision.
    class Theme extends ServiceMap.Service<Theme, { readonly value: string }>()("Theme") {}

    const NeedsTheme = Component.gen(function* (
      Props: Component.ComponentProps<{ readonly label: string }>,
    ) {
      const { label } = yield* Props;
      yield* Theme;
      return <span>{label}</span>;
    });

    const element = jsx(NeedsTheme, { label: "theme" }, 11);

    assert.strictEqual(element._tag, "Component");
    assert.strictEqual(getKey(element), 11);
  });
});
