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
import { Cause, Data, Effect, Option } from "effect";
import { TestClock } from "effect/testing";
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
        return yield* new TestError({ message: "Test error" });
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
        return yield* new TestError({ message: "Specific error" });
      });

      const TestErrorView = Component.gen(function* (
        Props: Component.ComponentProps<{ error: TestError }>,
      ) {
        const { error } = yield* Props;
        return <div>Error: {error.message}</div>;
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
        return yield* new TestError({ message: "Inner error" });
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
      const shouldThrow = Signal.makeSync(false);

      const ChildComponent = Component.gen(function* () {
        const throwNow = yield* Signal.get(shouldThrow);
        if (throwNow) {
          return yield* new TestError({ message: "Re-render error" });
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
          return yield* new TestError({ message: "Prop error" });
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
      const contentSignal = Signal.makeSync<"ok" | "error">("ok");

      const ChildComponent = Component.gen(function* () {
        const value = yield* Signal.get(contentSignal);
        if (value === "error") {
          return yield* new TestError({ message: "Component threw on rerender" });
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
        return yield* new TestError({ message: "fail" });
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

// =============================================================================
// DevMode
// =============================================================================
// Scope: Enabling debug observability

describe("DevMode", () => {
  it.effect("should enable debug logging on mount", () =>
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

  it.effect("should pass filter to Debug.enable", () =>
    withDebugReset(
      Effect.gen(function* () {
        yield* render(<DevMode filter="signal" />);

        const filter = Debug.getFilter();
        assert.deepStrictEqual(filter, ["signal"]);
      }),
    ),
  );

  it.effect("should support array of filters", () =>
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

  it.effect("should not enable debug when enabled is false", () =>
    withDebugReset(
      Effect.gen(function* () {
        const { container } = yield* render(<DevMode enabled={false} />);

        assert.strictEqual(container.querySelectorAll("*").length, 0);
        assert.isFalse(Debug.isEnabled());
      }),
    ),
  );

  it.effect("should register custom plugins", () =>
    withDebugReset(
      Effect.gen(function* () {
        const events: Debug.DebugEvent[] = [];
        const plugin = Debug.createCollectorPlugin("custom", events);

        yield* render(<DevMode plugins={[plugin]} />);

        assert.isTrue(Debug.hasPlugin("custom"));
      }),
    ),
  );

  it.effect("should register multiple plugins", () =>
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
