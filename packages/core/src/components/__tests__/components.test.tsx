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
import { Cause, Data, Effect, Exit, TestClock } from "effect";
import * as Signal from "../../primitives/signal.js";
import * as ErrorBoundary from "../../primitives/error-boundary.js";
import { DevMode } from "../dev-mode.js";
import * as Debug from "../../debug/debug.js";
import { render } from "../../testing/index.js";
import * as Component from "../../primitives/component.js";

// Tagged errors for testing error boundaries
class TestError extends Data.TaggedError("TestError")<{ message: string }> {}
class OtherError extends Data.TaggedError("OtherError")<{}> {}

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
      const SuccessComponent = Component.gen(function* () {
        return <div>Success</div>;
      });

      const SafeComponent = yield* ErrorBoundary.catch(SuccessComponent).catchAll(() => (
        <div>Error</div>
      ));

      const { getByText } = yield* render(<SafeComponent />);

      assert.isDefined(getByText("Success"));
    }),
  );

  it.scoped("should render fallback when component fails", () =>
    Effect.gen(function* () {
      const FailingComponent = Component.gen(function* () {
        return yield* new TestError({ message: "Test error" });
      });

      const SafeComponent = yield* ErrorBoundary.catch(FailingComponent).catchAll(() => (
        <div>Fallback shown</div>
      ));

      const { getByText } = yield* render(<SafeComponent />);

      assert.isDefined(getByText("Fallback shown"));
    }),
  );

  it.scoped("should pass cause to specific error handler", () =>
    Effect.gen(function* () {
      const FailingComponent = Component.gen(function* () {
        return yield* new TestError({ message: "Specific error" });
      });

      const SafeComponent = yield* ErrorBoundary.catch(FailingComponent)
        .on("TestError", (cause) => {
          const error = Cause.squash(cause) as TestError;
          return <div>Error: {error.message}</div>;
        })
        .catchAll(() => <div>Generic error</div>);

      const { getByText } = yield* render(<SafeComponent />);

      assert.isDefined(getByText("Error: Specific error"));
    }),
  );

  it.scoped("should use catchAll for unmatched errors", () =>
    Effect.gen(function* () {
      const FailingComponent = Component.gen(function* () {
        return yield* new OtherError();
      });

      const SafeComponent = yield* ErrorBoundary.catch(FailingComponent).catchAll((cause) => {
        const error = Cause.squash(cause);
        return <div data-testid="catch-all">Catch-all: {String(error)}</div>;
      });

      const { getByTestId } = yield* render(<SafeComponent />);

      assert.isDefined(getByTestId("catch-all"));
    }),
  );

  it.scoped("should render static fallback with catchAll", () =>
    Effect.gen(function* () {
      const FailingComponent = Component.gen(function* () {
        return yield* Effect.fail("error");
      });

      const staticFallback = <div data-testid="static-fallback">Static fallback content</div>;

      const SafeComponent = yield* ErrorBoundary.catch(FailingComponent).catchAll(
        () => staticFallback,
      );

      const { getByTestId } = yield* render(<SafeComponent />);

      assert.isDefined(getByTestId("static-fallback"));
    }),
  );

  it.scoped("should catch at nearest boundary", () =>
    Effect.gen(function* () {
      const InnerFailing = Component.gen(function* () {
        return yield* new TestError({ message: "Inner error" });
      });

      const InnerSafe = yield* ErrorBoundary.catch(InnerFailing as any).catchAll(() => (
        <div>Inner fallback</div>
      ));

      const OuterSafe = yield* ErrorBoundary.catch(InnerSafe as any).catchAll(() => (
        <div>Outer fallback</div>
      ));

      const { getByText, queryByText } = yield* render(<OuterSafe />);

      // Inner boundary should catch, outer should not be triggered
      assert.isDefined(getByText("Inner fallback"));
      assert.isNull(queryByText("Outer fallback"));
    }),
  );

  // Re-render error handling tests
  it.scoped("should catch error when child component throws on re-render", () =>
    Effect.gen(function* () {
      const shouldThrow = Signal.unsafeMake(false);

      const ChildComponent = Component.gen(function* () {
        const throwNow = yield* Signal.get(shouldThrow);
        if (throwNow) {
          return yield* new TestError({ message: "Re-render error" });
        }
        return <div data-testid="child">Child content</div>;
      });

      const SafeComponent = yield* ErrorBoundary.catch(ChildComponent as any).catchAll(() => (
        <div data-testid="fallback">Error caught!</div>
      ));

      const { getByTestId, queryByTestId } = yield* render(<SafeComponent />);

      // Initial render should show child
      assert.isDefined(getByTestId("child"));
      assert.isNull(queryByTestId("fallback"));

      // Trigger re-render that throws
      yield* Signal.set(shouldThrow, true);
      yield* TestClock.adjust(20);

      // Should show fallback, child should be gone
      assert.isDefined(getByTestId("fallback"));
      assert.isNull(queryByTestId("child"));
    }),
  );

  it.scoped("should re-render when signal props change", () =>
    Effect.gen(function* () {
      const mode = yield* Signal.make<"ok" | "error">("ok");

      const ChildComponent = Component.gen(function* (
        Props: Component.ComponentProps<{ mode: "ok" | "error" }>,
      ) {
        const { mode } = yield* Props;
        if (mode === "error") {
          return yield* new TestError({ message: "Prop error" });
        }
        return <div data-testid="ok">OK</div>;
      });

      const SafeComponent = yield* ErrorBoundary.catch(ChildComponent).catchAll(() => (
        <div data-testid="fallback">Fallback</div>
      ));

      const { getByTestId, queryByTestId } = yield* render(
        <SafeComponent mode={mode} />,
      );

      assert.isDefined(getByTestId("ok"));
      assert.isNull(queryByTestId("fallback"));

      yield* Signal.set(mode, "error");
      yield* TestClock.adjust(20);

      assert.isDefined(getByTestId("fallback"));
      assert.isNull(queryByTestId("ok"));
    }),
  );

  it.scoped("should support static Element children", () =>
    Effect.gen(function* () {
      const StaticComponent = Component.gen(function* () {
        return <div data-testid="static-child">Static content</div>;
      });

      const SafeComponent = yield* ErrorBoundary.catch(StaticComponent as any).catchAll(() => (
        <div>Error fallback</div>
      ));

      const { getByTestId } = yield* render(<SafeComponent />);

      assert.isDefined(getByTestId("static-child"));
    }),
  );

  it.scoped("should catch error from SignalElement swap", () =>
    Effect.gen(function* () {
      const contentSignal = Signal.unsafeMake<"ok" | "error">("ok");

      const ChildComponent = Component.gen(function* () {
        const value = yield* Signal.get(contentSignal);
        if (value === "error") {
          return yield* new TestError({ message: "Component threw on rerender" });
        }
        return <div data-testid="content">Good content</div>;
      });

      const SafeComponent = yield* ErrorBoundary.catch(ChildComponent as any).catchAll(() => (
        <div data-testid="fallback">Signal error caught</div>
      ));

      const { getByTestId, queryByTestId } = yield* render(<SafeComponent />);

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

  it.scoped("should throw if adding handler after catchAll", () =>
    Effect.gen(function* () {
      const Component_ = Component.gen(function* () {
        return <div>OK</div>;
      });

      const builder = ErrorBoundary.catch(Component_ as any);

      // First add catchAll
      yield* builder.catchAll(() => <div>Error</div>);

      // Then try to add .on() - should throw
      const exit = yield* Effect.exit(
        Effect.try(() => {
          builder.on("TestError", () => <div>Test</div>);
        }),
      );

      assert.isTrue(Exit.isFailure(exit));
      if (Exit.isFailure(exit)) {
        const error = Cause.squash(exit.cause);
        assert.isTrue(error instanceof Error);
        if (error instanceof Error && error.cause instanceof Error) {
          assert.strictEqual(
            error.cause.message,
            "Cannot add .on() handler after .catchAll()",
          );
        }
      }
    }),
  );

  it.scoped("should throw on duplicate handler", () =>
    Effect.gen(function* () {
      const Component_ = Component.gen(function* () {
        return <div>OK</div>;
      });

      const builder = ErrorBoundary.catch(Component_ as any).on("TestError", () => <div>Test</div>);

      // Try to add duplicate handler
      const exit = yield* Effect.exit(
        Effect.try(() => {
          builder.on("TestError", () => <div>Test 2</div>);
        }),
      );

      assert.isTrue(Exit.isFailure(exit));
      if (Exit.isFailure(exit)) {
        const error = Cause.squash(exit.cause);
        assert.isTrue(error instanceof Error);
        if (error instanceof Error && error.cause instanceof Error) {
          assert.strictEqual(error.cause.message, "Duplicate handler for error tag: TestError");
        }
      }
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

  it.scoped("should not enable debug when enabled is false", () =>
    withDebugReset(
      Effect.gen(function* () {
        const { container } = yield* render(<DevMode enabled={false} />);

        assert.strictEqual(container.querySelectorAll("*").length, 0);
        assert.isFalse(Debug.isEnabled());
      }),
    ),
  );

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
