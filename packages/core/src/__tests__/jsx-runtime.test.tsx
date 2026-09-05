/* oxlint-disable effect/no-raw-throw, effect/no-built-in-error-constructor -- Hostile Proxy/getter regression tests require direct JavaScript throws. */
/**
 * JSX Runtime Component Validation Tests
 *
 * Tests for Component.gen enforcement:
 * - Reject untagged function component
 * - Reject direct Effect<Element> in JSX
 * - Accept Component.gen components
 */
import { assert, describe, it } from "@effect/vitest";
import { Cause, Effect, Exit, Predicate } from "effect";
import * as Context from "effect/Context";
import * as Component from "../primitives/component.js";
import { getKey } from "../primitives/element.js";
import { jsxDEV, jsxsDEV } from "../jsx-dev-runtime.js";
import { Fragment, jsx, jsxs } from "../jsx-runtime.js";
import { render } from "../testing/index.js";

const countErrorConstructions = (run: () => void): Effect.Effect<number> =>
  Effect.acquireUseRelease(
    Effect.sync(() => {
      const NativeError = globalThis.Error;
      let count = 0;

      function CountingError(message?: string): Error {
        count++;
        return new NativeError(message);
      }

      Object.setPrototypeOf(CountingError, NativeError);
      CountingError.prototype = NativeError.prototype;

      Object.defineProperty(globalThis, "Error", {
        value: CountingError,
        configurable: true,
        writable: true,
      });

      return {
        run: () => {
          run();
          return count;
        },
        restore: () => {
          Object.defineProperty(globalThis, "Error", {
            value: NativeError,
            configurable: true,
            writable: true,
          });
        },
      };
    }),
    (state) => Effect.sync(state.run),
    (state) => Effect.sync(state.restore),
  );

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
        return assert.fail("Expected failure but got success");
      }

      const error = Cause.squash(exit.cause);
      if (!(error instanceof Component.InvalidComponentError)) {
        return assert.fail(`Expected InvalidComponentError but got ${Cause.pretty(exit.cause)}`);
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
        return assert.fail("Expected failure but got success");
      }

      const error = Cause.squash(exit.cause);
      if (!(error instanceof Component.InvalidComponentError)) {
        return assert.fail(`Expected InvalidComponentError but got ${Cause.pretty(exit.cause)}`);
      }

      assert.strictEqual(error.reason, "plain-function");
    }),
  );

  it.effect(
    "should not throw while constructing invalid plain function components before render",
    () =>
      Effect.gen(function* () {
        // Test: should not throw while constructing invalid plain function components before render.
        // Scope: preserves the lazy invalid-component recovery boundary at jsx construction time.
        // Assertion: jsx construction returns an element shell immediately, and the InvalidComponentError still appears only during render.
        const Plain = () => <span data-testid="plain">Hello</span>;

        const construction = yield* Effect.exit(Effect.sync(() => <Plain />));

        if (Exit.isFailure(construction)) {
          return assert.fail(
            `Expected lazy invalid-component construction but got ${Cause.pretty(construction.cause)}`,
          );
        }

        const exit = yield* Effect.exit(render(construction.value));

        if (Exit.isSuccess(exit)) {
          return assert.fail("Expected failure but got success");
        }

        const error = Cause.squash(exit.cause);
        if (!(error instanceof Component.InvalidComponentError)) {
          return assert.fail(`Expected InvalidComponentError but got ${Cause.pretty(exit.cause)}`);
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
        return assert.fail("Expected failure but got success");
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
    const element = jsxs(
      "div",
      {
        id: "root",
        key: "props-key",
        children: ["hello", null, ["world"]],
      },
      9,
    );

    assert.isTrue(Predicate.isTagged(element, "Intrinsic"));
    if (!Predicate.isTagged(element, "Intrinsic")) {
      return assert.fail("Expected Intrinsic element");
    }

    assert.deepStrictEqual(element.props, { id: "root" });
    assert.strictEqual(element.key, 9);
    assert.strictEqual(element.children.length, 2);
  });

  it.effect("should avoid stack-capture work while constructing benchmark row JSX", () =>
    Effect.gen(function* () {
      // Test: should avoid stack-capture work while constructing benchmark row JSX.
      // Scope: locks the RF-2 hot JSX construction path with a deterministic proxy for traced-span overhead.
      // Assertion: building one js-framework-benchmark-shaped row performs at most a tiny number of Error stack captures.
      let rowTag = "";

      const captures = yield* countErrorConstructions(() => {
        const row = (
          <tr>
            <td className="col-md-1">1</td>
            <td className="col-md-4">
              <a>pretty red table</a>
            </td>
            <td className="col-md-1">
              <a>
                <span className="glyphicon glyphicon-remove" aria-hidden="true" />
              </a>
            </td>
            <td className="col-md-6" />
          </tr>
        );
        rowTag = row._tag;
      });

      assert.strictEqual(rowTag, "Intrinsic");
      assert.isAtMost(
        captures,
        2,
        `expected benchmark row JSX to avoid stack captures, got ${captures}`,
      );
    }),
  );

  it.effect("should align jsxDEV with jsx while hostile props abort construction", () =>
    Effect.gen(function* () {
      // Test: should align jsxDEV with jsx while hostile props abort construction.
      // Scope: verifies development and production JSX share the same hostile-props boundary.
      // Assertion: both entrypoints preserve the getter throw and neither returns a partial Fragment.
      const failure = new Error("boom-children");
      const malformedProps = new Proxy(
        {},
        {
          ownKeys() {
            return ["children"];
          },
          getOwnPropertyDescriptor(_target, property) {
            if (property === "children") {
              return {
                configurable: true,
                enumerable: true,
              };
            }

            return undefined;
          },
          get(_target, property) {
            if (property === "children") {
              throw failure;
            }

            return undefined;
          },
        },
      );

      const source = {
        fileName: "jsx-runtime.test.tsx",
        lineNumber: 1,
        columnNumber: 1,
      };

      const jsxExit = yield* Effect.exit(Effect.sync(() => jsx(Fragment, malformedProps)));
      if (Exit.isSuccess(jsxExit)) {
        return assert.fail("Expected jsx to reject hostile props");
      }

      const jsxDevExit = yield* Effect.exit(
        Effect.sync(() => jsxDEV(Fragment, malformedProps, undefined, false, source)),
      );
      if (Exit.isSuccess(jsxDevExit)) {
        return assert.fail("Expected jsxDEV to reject hostile props");
      }

      assert.strictEqual(Cause.squash(jsxExit.cause), failure);
      assert.strictEqual(Cause.squash(jsxDevExit.cause), failure);
    }),
  );

  it.effect("should not return a partial element while prop enumeration throws", () =>
    Effect.gen(function* () {
      // Test: should not return a partial element while prop enumeration throws.
      // Scope: regression coverage for hostile Proxy traps at the public sync JSX boundary.
      // Assertion: construction preserves the original throw instead of returning empty props.
      const failure = new Error("boom-own-keys");
      const malformedProps = new Proxy(
        {},
        {
          ownKeys() {
            throw failure;
          },
        },
      );

      const construction = yield* Effect.exit(Effect.sync(() => jsx("div", malformedProps, 13)));

      if (Exit.isSuccess(construction)) {
        return assert.fail("Expected malformed prop enumeration to fail construction");
      }

      assert.strictEqual(Cause.squash(construction.cause), failure);
    }),
  );

  it.effect("should preserve hostile enumeration defects through jsxs aliases", () =>
    Effect.gen(function* () {
      // Test: should preserve hostile enumeration defects through jsxs and jsxsDEV.
      // Scope: covers both static-children aliases at the public production/development boundaries.
      // Assertion: both aliases preserve the same defect and neither returns a partial Element.
      const failure = new Error("boom-jsxs-own-keys");
      const malformedProps = new Proxy(
        {},
        {
          ownKeys() {
            throw failure;
          },
        },
      );

      const jsxsExit = yield* Effect.exit(Effect.sync(() => jsxs("div", malformedProps)));
      const jsxsDevExit = yield* Effect.exit(
        Effect.sync(() => jsxsDEV("div", malformedProps, undefined, true)),
      );

      if (Exit.isSuccess(jsxsExit) || Exit.isSuccess(jsxsDevExit)) {
        return assert.fail("Expected both jsxs aliases to reject hostile enumeration");
      }
      assert.strictEqual(Cause.squash(jsxsExit.cause), failure);
      assert.strictEqual(Cause.squash(jsxsDevExit.cause), failure);
    }),
  );

  it.effect("should preserve hostile getter defects through jsxs aliases", () =>
    Effect.gen(function* () {
      // Test: should preserve hostile getter defects through jsxs and jsxsDEV.
      // Scope: covers a getter failure after an earlier prop has already been copied.
      // Assertion: both aliases abort construction instead of returning the readable prop subset.
      const failure = new Error("boom-jsxs-getter");
      const malformedProps = {
        id: "must-not-survive",
        get title() {
          throw failure;
        },
        children: ["child"],
      };

      const jsxsExit = yield* Effect.exit(Effect.sync(() => jsxs("div", malformedProps)));
      const jsxsDevExit = yield* Effect.exit(
        Effect.sync(() => jsxsDEV("div", malformedProps, undefined, true)),
      );

      if (Exit.isSuccess(jsxsExit) || Exit.isSuccess(jsxsDevExit)) {
        return assert.fail("Expected both jsxs aliases to reject hostile getters");
      }
      assert.strictEqual(Cause.squash(jsxsExit.cause), failure);
      assert.strictEqual(Cause.squash(jsxsDevExit.cause), failure);
    }),
  );

  it("should not require services while constructing valid effect components with jsx", () => {
    // Test: should not require services while constructing valid effect components with jsx.
    // Scope: verifies the public sync bridge builds the element shell without running component requirements eagerly.
    // Assertion: jsx returns a component element immediately and preserves the explicit key without service provision.
    class Theme extends Context.Service<Theme, { readonly value: string }>()(
      "jsx-runtime.test/Theme",
    ) {}

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
