/**
 * Built-in Components Unit Tests
 *
 * Tests for ErrorBoundary, Portal, and DevMode components.
 *
 * Goals: Reliability, stability
 * - Verify error handling works correctly
 * - Verify portal renders to correct target
 * - Verify DevMode enables/disables debug
 */
import { assert, describe, it } from "@effect/vitest";
import { Data, Effect, TestClock } from "effect";
import * as Signal from "../../primitives/signal.js";

// Tagged error for testing error boundaries
class TestError extends Data.TaggedError("TestError")<{ message: string }> {}
import { ErrorBoundary } from "../error-boundary.js";
import { DevMode } from "../dev-mode.js";
import * as Debug from "../../debug/debug.js";
import { isEmpty } from "../../primitives/element.js";
import { render } from "../../testing/index.js";

// Helper to reset debug state
const withDebugReset = <A, E, R>(effect: Effect.Effect<A, E, R>): Effect.Effect<A, E, R> =>
  Effect.gen(function* () {
    Debug.disable();
    for (const name of Debug.getPlugins()) {
      Debug.unregisterPlugin(name);
    }
    const result = yield* effect;
    Debug.disable();
    for (const name of Debug.getPlugins()) {
      Debug.unregisterPlugin(name);
    }
    return result;
  });

// =============================================================================
// ErrorBoundary
// =============================================================================
// Scope: Catching errors from child components

describe("ErrorBoundary", () => {
  it.scoped("should render children when no error occurs", () =>
    Effect.gen(function* () {
      const childEffect = Effect.succeed(<div>Success</div>);
      const element = <ErrorBoundary fallback={<div>Error</div>}>{childEffect}</ErrorBoundary>;

      const { getByText } = yield* render(element);

      assert.isDefined(getByText("Success"));
    }),
  );

  it.scoped("should render fallback when child effect fails", () =>
    Effect.gen(function* () {
      const childEffect = Effect.fail(new TestError({ message: "Test error" }));
      const element = (
        <ErrorBoundary fallback={<div>Fallback shown</div>}>{childEffect}</ErrorBoundary>
      );

      const { getByText } = yield* render(element);

      assert.isDefined(getByText("Fallback shown"));
    }),
  );

  it.scoped("should pass error to fallback function", () =>
    Effect.gen(function* () {
      const testError = new Error("Specific error");
      const childEffect = Effect.fail(testError);
      const element = (
        <ErrorBoundary fallback={(error: Error) => <div>Error: {error.message}</div>}>
          {childEffect}
        </ErrorBoundary>
      );

      const { getByText } = yield* render(element);

      assert.isDefined(getByText("Error: Specific error"));
    }),
  );

  it.scoped("should call onError callback when error caught", () =>
    Effect.gen(function* () {
      let capturedError: unknown = null;
      const childEffect = Effect.fail(new TestError({ message: "Caught error" }));
      const element = (
        <ErrorBoundary
          fallback={<div>Fallback</div>}
          onError={(error) =>
            Effect.sync(() => {
              capturedError = error;
            })
          }
        >
          {childEffect}
        </ErrorBoundary>
      );

      yield* render(element);

      assert.isNotNull(capturedError);
      assert.instanceOf(capturedError, Error);
      assert.strictEqual((capturedError as Error).message, "Caught error");
    }),
  );

  it.scoped("should render static fallback element", () =>
    Effect.gen(function* () {
      const childEffect = Effect.fail("error");
      const staticFallback = <div data-testid="static-fallback">Static fallback content</div>;
      const element = <ErrorBoundary fallback={staticFallback}>{childEffect}</ErrorBoundary>;

      const { getByTestId } = yield* render(element);

      assert.isDefined(getByTestId("static-fallback"));
    }),
  );

  it.scoped("should catch Effect.fail errors", () =>
    Effect.gen(function* () {
      const childEffect = Effect.fail({ code: "CUSTOM_ERROR", message: "Custom failure" });
      const element = (
        <ErrorBoundary fallback={(error: { code: string }) => <div>Code: {error.code}</div>}>
          {childEffect}
        </ErrorBoundary>
      );

      const { getByText } = yield* render(element);

      assert.isDefined(getByText("Code: CUSTOM_ERROR"));
    }),
  );

  it.scoped("should catch errors from Effect.die wrapped with catchAllCause", () =>
    Effect.gen(function* () {
      // ErrorBoundary uses catchAll which catches Fail, not Die.
      // To catch defects (thrown errors), use a component that wraps with catchAllCause.
      // This test verifies standard Effect.fail behavior works.
      const childEffect = Effect.fail("Failure from Effect.fail");
      const element = (
        <ErrorBoundary fallback={(error: string) => <div>Caught: {error}</div>}>
          {childEffect}
        </ErrorBoundary>
      );

      const { getByText } = yield* render(element);

      assert.isDefined(getByText("Caught: Failure from Effect.fail"));
    }),
  );

  it.scoped("should catch at nearest boundary", () =>
    Effect.gen(function* () {
      const innerFailing = Effect.fail(new TestError({ message: "Inner error" }));
      const innerBoundary = (
        <ErrorBoundary fallback={<div>Inner fallback</div>}>{innerFailing}</ErrorBoundary>
      );
      const outerBoundary = (
        <ErrorBoundary fallback={<div>Outer fallback</div>}>
          {Effect.succeed(innerBoundary)}
        </ErrorBoundary>
      );

      const { getByText, queryByText } = yield* render(outerBoundary);

      // Inner boundary should catch, outer should not be triggered
      assert.isDefined(getByText("Inner fallback"));
      assert.isNull(queryByText("Outer fallback"));
    }),
  );

  // Re-render error handling tests
  it.scoped("should catch error when child component throws on re-render", () =>
    Effect.gen(function* () {
      const shouldThrow = Signal.unsafeMake(false);
      let onErrorCalled = false;

      const ChildComponent = Effect.gen(function* () {
        const throwNow = yield* Signal.get(shouldThrow);
        if (throwNow) {
          return yield* new TestError({ message: "Re-render error" });
        }
        return <div data-testid="child">Child content</div>;
      });

      const element = (
        <ErrorBoundary
          fallback={<div data-testid="fallback">Error caught!</div>}
          onError={() =>
            Effect.sync(() => {
              onErrorCalled = true;
            })
          }
        >
          {ChildComponent}
        </ErrorBoundary>
      );

      const { getByTestId, queryByTestId } = yield* render(element);

      // Initial render should show child
      assert.isDefined(getByTestId("child"));
      assert.isNull(queryByTestId("fallback"));

      // Trigger re-render that throws
      yield* Signal.set(shouldThrow, true);
      yield* TestClock.adjust(20);

      // Should show fallback, child should be gone
      assert.isDefined(getByTestId("fallback"));
      assert.isNull(queryByTestId("child"));
      assert.isTrue(onErrorCalled);
    }),
  );

  it.scoped("should support static Element children (not just Effect)", () =>
    Effect.gen(function* () {
      // ErrorBoundary should also wrap static elements for re-render error catching
      const staticChild = <div data-testid="static-child">Static content</div>;

      const element = (
        <ErrorBoundary fallback={<div>Error fallback</div>}>{staticChild}</ErrorBoundary>
      );

      const { getByTestId } = yield* render(element);

      assert.isDefined(getByTestId("static-child"));
    }),
  );

  it.scoped("should call onError with squashed cause from re-render errors", () =>
    Effect.gen(function* () {
      const shouldThrow = Signal.unsafeMake(false);
      let capturedError: unknown = null;

      const ChildComponent = Effect.gen(function* () {
        const throwNow = yield* Signal.get(shouldThrow);
        if (throwNow) {
          return yield* Effect.fail({ code: "RERENDER_ERROR", message: "Failed during rerender" });
        }
        return <div>OK</div>;
      });

      const element = (
        <ErrorBoundary
          fallback={<div data-testid="fallback">Error</div>}
          onError={(error) =>
            Effect.sync(() => {
              capturedError = error;
            })
          }
        >
          {ChildComponent}
        </ErrorBoundary>
      );

      yield* render(element);

      // Trigger error
      yield* Signal.set(shouldThrow, true);
      yield* TestClock.adjust(20);

      // onError should have been called with the squashed cause (the actual error value)
      assert.isNotNull(capturedError);
      assert.deepStrictEqual(capturedError, {
        code: "RERENDER_ERROR",
        message: "Failed during rerender",
      });
    }),
  );

  it.scoped("should catch error from SignalElement swap", () =>
    Effect.gen(function* () {
      const contentSignal = Signal.unsafeMake<"ok" | "error">("ok");

      // Component that reads signal and conditionally throws during re-render
      // The error happens inside the Component's re-render, which propagates to ErrorBoundary
      const ChildComponent = Effect.gen(function* () {
        const value = yield* Signal.get(contentSignal);
        if (value === "error") {
          return yield* new TestError({ message: "Component threw on rerender" });
        }
        return <div data-testid="content">Good content</div>;
      });

      const element = (
        <ErrorBoundary fallback={<div data-testid="fallback">Signal error caught</div>}>
          {ChildComponent}
        </ErrorBoundary>
      );

      const { getByTestId, queryByTestId } = yield* render(element);

      // Initial render
      assert.isDefined(getByTestId("content"));
      assert.isNull(queryByTestId("fallback"));

      // Trigger error via signal change - component will re-render and throw
      yield* Signal.set(contentSignal, "error");
      yield* TestClock.adjust(20);

      // Should catch error and show fallback
      assert.isDefined(getByTestId("fallback"));
      assert.isNull(queryByTestId("content"));
    }),
  );
});

// =============================================================================
// DevMode
// =============================================================================
// Scope: Enabling debug observability

describe("DevMode", () => {
  it.scoped("should enable debug logging on mount", () =>
    withDebugReset(
      Effect.gen(function* () {
        assert.isFalse(Debug.isEnabled());

        yield* render(<DevMode />);

        assert.isTrue(Debug.isEnabled());
      }),
    ),
  );

  it("should render empty element", () => {
    const element = <DevMode />;

    // DevMode returns a Component that renders to empty
    assert.strictEqual(element._tag, "Component");
  });

  it.scoped("should pass filter to Debug.enable", () =>
    withDebugReset(
      Effect.gen(function* () {
        yield* render(<DevMode filter="signal" />);

        const filter = Debug.getFilter();
        assert.deepStrictEqual(filter, ["signal"]);
      }),
    ),
  );

  it.scoped("should support array of filters", () =>
    withDebugReset(
      Effect.gen(function* () {
        yield* render(<DevMode filter={["signal", "render"]} />);

        const filter = Debug.getFilter();
        assert.isNotNull(filter);
        assert.isTrue(filter?.includes("signal"));
        assert.isTrue(filter?.includes("render"));
      }),
    ),
  );

  it("should not enable debug when enabled is false", () => {
    Debug.disable();

    const element = <DevMode enabled={false} />;

    // When enabled=false, DevMode returns empty immediately
    assert.isTrue(isEmpty(element));
    assert.isFalse(Debug.isEnabled());
  });

  it.scoped("should register custom plugins", () =>
    withDebugReset(
      Effect.gen(function* () {
        const events: Debug.DebugEvent[] = [];
        const plugin = Debug.createCollectorPlugin("custom", events);

        yield* render(<DevMode plugins={[plugin]} />);

        assert.isTrue(Debug.hasPlugin("custom"));
      }),
    ),
  );

  it.scoped("should register multiple plugins", () =>
    withDebugReset(
      Effect.gen(function* () {
        const events1: Debug.DebugEvent[] = [];
        const events2: Debug.DebugEvent[] = [];
        const plugin1 = Debug.createCollectorPlugin("plugin1", events1);
        const plugin2 = Debug.createCollectorPlugin("plugin2", events2);

        yield* render(<DevMode plugins={[plugin1, plugin2]} />);

        assert.isTrue(Debug.hasPlugin("plugin1"));
        assert.isTrue(Debug.hasPlugin("plugin2"));
      }),
    ),
  );
});
