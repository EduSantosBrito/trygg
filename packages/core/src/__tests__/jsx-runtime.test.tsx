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
import * as Component from "../primitives/component.js";
import { render } from "../testing/index.js";

describe("JSX component validation", () => {
  it.scoped("should reject direct Effect<Element> with InvalidComponentError", () =>
    Effect.gen(function* () {
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

  it.scoped("should reject plain function components", () =>
    Effect.gen(function* () {
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

  it.scoped("should accept Component.gen components", () =>
    Effect.gen(function* () {
      const ValidComponent = Component.gen(function* () {
        return <span data-testid="valid">Hello from Component.gen</span>;
      });

      const { getByTestId } = yield* render(<ValidComponent />);

      assert.strictEqual((yield* getByTestId("valid")).textContent, "Hello from Component.gen");
    }),
  );

  it.scoped("should accept Component.gen with props", () =>
    Effect.gen(function* () {
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

  it.scoped("should accept intrinsic HTML elements", () =>
    Effect.gen(function* () {
      const { getByTestId } = yield* render(<div data-testid="intrinsic" className="test" />);

      const element = yield* getByTestId("intrinsic");
      assert.strictEqual(element.tagName.toLowerCase(), "div");
      assert.strictEqual(element.className, "test");
    }),
  );
});
