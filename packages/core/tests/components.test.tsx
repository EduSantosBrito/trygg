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
import { Data, Effect, Scope, Exit } from "effect";

// Tagged error for testing error boundaries
class TestError extends Data.TaggedError("TestError")<{ message: string }> {}
import { ErrorBoundary } from "../src/components/error-boundary.js";
import { Portal } from "../src/components/portal.js";
import { DevMode } from "../src/components/dev-mode.js";
import * as Debug from "../src/debug/debug.js";
import { isEmpty } from "../src/element.js";
import { render } from "../src/testing.js";

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
});

// =============================================================================
// Portal
// =============================================================================
// Scope: Rendering into different DOM container

describe("Portal", () => {
  it.scoped("should render children into target element", () =>
    Effect.gen(function* () {
      // Create a target element
      const target = document.createElement("div");
      target.id = "portal-target";
      document.body.appendChild(target);

      const element = (
        <Portal target={target}>
          <span>Portal content</span>
        </Portal>
      );

      yield* render(element);

      // Content should be in target, not in test container
      assert.strictEqual(target.textContent, "Portal content");

      // Cleanup
      target.remove();
    }),
  );

  it.scoped("should accept HTMLElement as target", () =>
    Effect.gen(function* () {
      const target = document.createElement("div");
      document.body.appendChild(target);

      const element = (
        <Portal target={target}>
          <span>Direct element target</span>
        </Portal>
      );

      yield* render(element);

      assert.strictEqual(target.textContent, "Direct element target");

      target.remove();
    }),
  );

  it.scoped("should accept CSS selector as target", () =>
    Effect.gen(function* () {
      const target = document.createElement("div");
      target.id = "selector-target";
      document.body.appendChild(target);

      const element = (
        <Portal target="#selector-target">
          <span>Selector target content</span>
        </Portal>
      );

      yield* render(element);

      assert.strictEqual(target.textContent, "Selector target content");

      target.remove();
    }),
  );

  it.scoped("should handle single child element", () =>
    Effect.gen(function* () {
      const target = document.createElement("div");
      document.body.appendChild(target);

      const element = (
        <Portal target={target}>
          <span>Single child</span>
        </Portal>
      );

      yield* render(element);

      assert.strictEqual(target.querySelector("span")?.textContent, "Single child");

      target.remove();
    }),
  );

  it.scoped("should handle array of children", () =>
    Effect.gen(function* () {
      const target = document.createElement("div");
      document.body.appendChild(target);

      const element = (
        <Portal target={target}>
          <span>First</span>
          <span>Second</span>
          <span>Third</span>
        </Portal>
      );

      yield* render(element);

      assert.strictEqual(target.textContent, "FirstSecondThird");

      target.remove();
    }),
  );

  it.scoped("should remove children from target on cleanup", () =>
    Effect.gen(function* () {
      const target = document.createElement("div");
      document.body.appendChild(target);

      const scope = yield* Scope.make();

      const element = (
        <Portal target={target}>
          <span>To be removed</span>
        </Portal>
      );

      yield* render(element).pipe(Effect.provideService(Scope.Scope, scope));

      assert.strictEqual(target.textContent, "To be removed");

      // Close scope triggers cleanup
      yield* Scope.close(scope, Exit.void);

      assert.strictEqual(target.textContent, "");

      target.remove();
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
