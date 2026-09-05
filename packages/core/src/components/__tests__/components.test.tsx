/**
 * Built-in Components Unit Tests
 *
 * Tests for the ErrorBoundary component.
 *
 * Goals: Reliability, stability
 * - Verify error handling works correctly
 */
import { assert, describe, it } from "@effect/vitest";
import { Cause, Effect, Option, Schema } from "effect";
import { TestClock } from "effect/testing";
import * as Signal from "../../primitives/signal.js";
import * as ErrorBoundary from "../../primitives/error-boundary.js";
import { render } from "../../testing/index.js";
import * as Component from "../../primitives/component.js";

// Tagged errors for testing error boundaries
class TestError extends Schema.TaggedError<TestError>()("TestError", {
  detail: Schema.String,
}) {}
class OtherError extends Schema.TaggedError<OtherError>()("OtherError", {}) {}

const catchAllView = (render_: (cause: Cause.Cause<unknown>) => JSX.Element) =>
  Component.gen(function* (Props: Component.ComponentProps<{ cause: Cause.Cause<unknown> }>) {
    const { cause } = yield* Props;
    return render_(cause);
  });

// =============================================================================
// ErrorBoundary
// =============================================================================
// Scope: Catching errors from child components

describe("ErrorBoundary", () => {
  it.effect("should render children when no error occurs", () =>
    Effect.gen(function* () {
      const SuccessComponent = Component.gen(function* () {
        return <div>Success</div>;
      });

      const SafeComponent = yield* ErrorBoundary.catch(SuccessComponent).pipe(
        ErrorBoundary.catchAll(catchAllView(() => <div>Error</div>)),
      );

      const { getByText } = yield* render(<SafeComponent />);

      assert.isDefined(yield* getByText("Success"));
    }),
  );

  it.effect("should render fallback when component fails", () =>
    Effect.gen(function* () {
      const FailingComponent = Component.gen(function* () {
        return yield* new TestError({ detail: "Test error" });
      });

      const SafeComponent = yield* ErrorBoundary.catch(FailingComponent).pipe(
        ErrorBoundary.catchAll(catchAllView(() => <div>Fallback shown</div>)),
      );

      const { getByText } = yield* render(<SafeComponent />);

      assert.isDefined(yield* getByText("Fallback shown"));
    }),
  );

  it.effect("should pass cause to specific error handler", () =>
    Effect.gen(function* () {
      const FailingComponent = Component.gen(function* () {
        return yield* new TestError({ detail: "Specific error" });
      });

      const TestErrorView = Component.gen(function* (
        Props: Component.ComponentProps<{ error: TestError }>,
      ) {
        const { error } = yield* Props;
        return <div>Error: {error.detail}</div>;
      });

      const SafeComponent = yield* ErrorBoundary.catch(FailingComponent).pipe(
        ErrorBoundary.on("TestError", TestErrorView),
        ErrorBoundary.catchAll(catchAllView(() => <div>Generic error</div>)),
      );

      const { getByText } = yield* render(<SafeComponent />);

      assert.isDefined(yield* getByText("Error: Specific error"));
    }),
  );

  it.effect("should use catchAll for unmatched errors", () =>
    Effect.gen(function* () {
      const FailingComponent = Component.gen(function* () {
        return yield* new OtherError();
      });

      const SafeComponent = yield* ErrorBoundary.catch(FailingComponent).pipe(
        ErrorBoundary.catchAll(
          catchAllView((cause) => (
            <div data-testid="catch-all">Catch-all: {String(Cause.squash(cause))}</div>
          )),
        ),
      );

      const { getByTestId } = yield* render(<SafeComponent />);

      assert.isDefined(yield* getByTestId("catch-all"));
    }),
  );

  it.effect("should render static fallback with catchAll", () =>
    Effect.gen(function* () {
      const FailingComponent = Component.gen(function* () {
        return yield* Effect.fail("error");
      });

      const staticFallback = <div data-testid="static-fallback">Static fallback content</div>;

      const SafeComponent = yield* ErrorBoundary.catch(FailingComponent).pipe(
        ErrorBoundary.catchAll(catchAllView(() => staticFallback)),
      );

      const { getByTestId } = yield* render(<SafeComponent />);

      assert.isDefined(yield* getByTestId("static-fallback"));
    }),
  );

  it.effect("should catch at nearest boundary", () =>
    Effect.gen(function* () {
      const InnerFailing = Component.gen(function* () {
        return yield* new TestError({ detail: "Inner error" });
      });

      const InnerSafe = yield* ErrorBoundary.catch(InnerFailing).pipe(
        ErrorBoundary.catchAll(catchAllView(() => <div>Inner fallback</div>)),
      );

      const OuterSafe = yield* ErrorBoundary.catch(InnerSafe).pipe(
        ErrorBoundary.catchAll(catchAllView(() => <div>Outer fallback</div>)),
      );

      const { getByText, queryByText } = yield* render(<OuterSafe />);

      // Inner boundary should catch, outer should not be triggered
      assert.isDefined(yield* getByText("Inner fallback"));
      assert.isTrue(Option.isNone(yield* queryByText("Outer fallback")));
    }),
  );

  // Re-render error handling tests
  it.effect("should catch error when child component throws on re-render", () =>
    Effect.gen(function* () {
      const shouldThrow = yield* Signal.make(false);

      const ChildComponent = Component.gen(function* () {
        const throwNow = yield* Signal.get(shouldThrow);
        if (throwNow) {
          return yield* new TestError({ detail: "Re-render error" });
        }
        return <div data-testid="child">Child content</div>;
      });

      const SafeComponent = yield* ErrorBoundary.catch(ChildComponent).pipe(
        ErrorBoundary.catchAll(catchAllView(() => <div data-testid="fallback">Error caught!</div>)),
      );

      const { getByTestId, queryByTestId } = yield* render(<SafeComponent />);

      // Initial render should show child
      assert.isDefined(yield* getByTestId("child"));
      assert.isTrue(Option.isNone(yield* queryByTestId("fallback")));

      // Trigger re-render that throws
      yield* Signal.set(shouldThrow, true);
      yield* TestClock.adjust(20);

      // Should show fallback, child should be gone
      assert.isDefined(yield* getByTestId("fallback"));
      assert.isTrue(Option.isNone(yield* queryByTestId("child")));
    }),
  );

  it.effect("should re-render when signal props change", () =>
    Effect.gen(function* () {
      const mode = yield* Signal.make<"ok" | "error">("ok");

      const ChildComponent = Component.gen(function* (
        Props: Component.ComponentProps<{ mode: Signal.Signal<"ok" | "error"> }>,
      ) {
        const { mode } = yield* Props;
        const currentMode = yield* Signal.get(mode);
        if (currentMode === "error") {
          return yield* new TestError({ detail: "Prop error" });
        }
        return <div data-testid="ok">OK</div>;
      });

      const SafeComponent = yield* ErrorBoundary.catch(ChildComponent).pipe(
        ErrorBoundary.catchAll(catchAllView(() => <div data-testid="fallback">Fallback</div>)),
      );

      const { getByTestId, queryByTestId } = yield* render(<SafeComponent mode={mode} />);

      assert.isDefined(yield* getByTestId("ok"));
      assert.isTrue(Option.isNone(yield* queryByTestId("fallback")));

      yield* Signal.set(mode, "error");
      yield* TestClock.adjust(20);

      assert.isDefined(yield* getByTestId("fallback"));
      assert.isTrue(Option.isNone(yield* queryByTestId("ok")));
    }),
  );

  it.effect("should support static Element children", () =>
    Effect.gen(function* () {
      const StaticComponent = Component.gen(function* () {
        return <div data-testid="static-child">Static content</div>;
      });

      const SafeComponent = yield* ErrorBoundary.catch(StaticComponent).pipe(
        ErrorBoundary.catchAll(catchAllView(() => <div>Error fallback</div>)),
      );

      const { getByTestId } = yield* render(<SafeComponent />);

      assert.isDefined(yield* getByTestId("static-child"));
    }),
  );

  it.effect("should catch error from SignalElement swap", () =>
    Effect.gen(function* () {
      const contentSignal = yield* Signal.make<"ok" | "error">("ok");

      const ChildComponent = Component.gen(function* () {
        const value = yield* Signal.get(contentSignal);
        if (value === "error") {
          return yield* new TestError({ detail: "Component threw on rerender" });
        }
        return <div data-testid="content">Good content</div>;
      });

      const SafeComponent = yield* ErrorBoundary.catch(ChildComponent).pipe(
        ErrorBoundary.catchAll(
          catchAllView(() => <div data-testid="fallback">Signal error caught</div>),
        ),
      );

      const { getByTestId, queryByTestId } = yield* render(<SafeComponent />);

      // Initial render
      assert.isDefined(yield* getByTestId("content"));
      assert.isTrue(Option.isNone(yield* queryByTestId("fallback")));

      // Trigger error via signal change - component will re-render and throw
      yield* Signal.set(contentSignal, "error");
      yield* TestClock.adjust(20);

      // Should catch error and show fallback
      assert.isDefined(yield* getByTestId("fallback"));
      assert.isTrue(Option.isNone(yield* queryByTestId("content")));
    }),
  );

  it.effect("on() after catchAll on same builder succeeds (immutable state)", () =>
    Effect.gen(function* () {
      const Component_ = Component.gen(function* () {
        return yield* new TestError({ detail: "fail" });
      });

      const builder = ErrorBoundary.catch(Component_);

      const TestErrorView = Component.gen(function* (
        Props: Component.ComponentProps<{ error: TestError }>,
      ) {
        yield* Props;
        return <div>Test</div>;
      });

      // Builder is immutable — catchAll doesn't mutate original builder
      yield* builder.pipe(ErrorBoundary.catchAll(catchAllView(() => <div>Error</div>)));

      // .on() after catchAll on the same builder still works (independent state)
      const safe = yield* builder.pipe(
        ErrorBoundary.on("TestError", TestErrorView),
        ErrorBoundary.catchAll(catchAllView(() => <div>Fallback</div>)),
      );

      assert.isTrue(Component.isEffectComponent(safe));
    }),
  );

  // duplicate-handler is now a compile error via Exclude<ErrorTags<E>, HandledTags>
  // — .on("TestError", v1).on("TestError", v2) won't typecheck
});
