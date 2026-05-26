/**
 * ErrorBoundary Unit Tests
 *
 * ErrorBoundary provides functional composition for error handling.
 * Wraps components with error boundaries that catch errors and render fallback UIs.
 *
 * Test Categories:
 * - catch/catchAll: Basic error boundary wrapping
 * - .provide() preservation: Error boundary behavior after .provide() called
 * - Handler requirements: Service requirements propagation
 * - Builder validation: Invalid chain detection
 *
 * Goals: Reliability, stability
 * - Verify error boundaries catch errors
 * - Verify .provide() preserves boundary behavior
 * - Verify handler requirements are propagated
 */
import { assert, describe, it } from "@effect/vitest";
import { Cause, Data, Effect, Layer, Option } from "effect";
import * as Context from "effect/Context";
import * as Component from "../component.js";
import * as ErrorBoundary from "../error-boundary.js";
import * as Signal from "../signal.js";
import { render } from "../../testing/index.js";

// =============================================================================
// Test Errors
// =============================================================================

class TestError extends Data.TaggedError("TestError")<{}> {}
class NetworkError extends Data.TaggedError("NetworkError")<{}> {}

const catchAllView = (content: string, testId?: string) =>
  Component.gen(function* (_Props: Component.ComponentProps<{ cause: Cause.Cause<unknown> }>) {
    return testId === undefined ? <div>{content}</div> : <div data-testid={testId}>{content}</div>;
  });

// =============================================================================
// .provide() preservation
// =============================================================================

describe("ErrorBoundary .provide() preservation", () => {
  it.effect("provide preserves error boundary wrapper", () =>
    Effect.gen(function* () {
      const TestService = Context.Service<string>("TestService");
      const TestLayer = Layer.succeed(TestService, "provided-value");

      const FailingComponent = Component.gen(function* () {
        yield* new TestError();
        return <div>should not render</div>;
      });

      const SafeComponent = yield* ErrorBoundary.catch(FailingComponent).pipe(
        ErrorBoundary.catchAll(catchAllView("fallback")),
      );

      // Apply Component.provide() - this should NOT break the error boundary
      const ProvidedComponent = SafeComponent.pipe(Component.provide(TestLayer));
      const element = ProvidedComponent({});

      // Render and assert fallback shown, not crash
      const { getByText, queryByText } = yield* render(element);

      assert.isDefined(yield* getByText("fallback"));
      assert.isTrue(Option.isNone(yield* queryByText("should not render")));
    }),
  );

  it.effect("services provided via .provide() available inside wrapped tree", () =>
    Effect.gen(function* () {
      const TestService = Context.Service<string>("TestService");
      const TestLayer = Layer.succeed(TestService, "provided-value");

      const ServiceComponent = Component.gen(function* () {
        const value = yield* TestService;
        return <div data-testid="service-value">{value}</div>;
      });

      const SafeComponent = yield* ErrorBoundary.catch(ServiceComponent).pipe(
        ErrorBoundary.catchAll(catchAllView("error")),
      );

      const ProvidedComponent = SafeComponent.pipe(Component.provide(TestLayer));
      const element = ProvidedComponent({});

      const { getByTestId } = yield* render(element);

      assert.strictEqual((yield* getByTestId("service-value")).textContent, "provided-value");
    }),
  );

  it.effect("isEffectComponent remains true and error boundary works", () =>
    Effect.gen(function* () {
      const FailingComponent = Component.gen(function* () {
        yield* new TestError();
        return <div>test</div>;
      });

      const SafeComponent = yield* ErrorBoundary.catch(FailingComponent).pipe(
        ErrorBoundary.catchAll(catchAllView("fallback")),
      );

      // Verify it's an effect component
      assert.isTrue(Component.isEffectComponent(SafeComponent));

      // Actually render and verify error boundary works
      const { getByText } = yield* render(<SafeComponent />);
      assert.isDefined(yield* getByText("fallback"));
    }),
  );
});

// =============================================================================
// Handler requirements propagation
// =============================================================================

describe("ErrorBoundary handler requirements propagation", () => {
  it.effect("propagates handler service requirements", () =>
    Effect.gen(function* () {
      const ErrorTheme = Context.Service<string>("ErrorTheme");
      const ErrorThemeLayer = Layer.succeed(ErrorTheme, "error-theme");

      const RiskyComponent = Component.gen(function* () {
        yield* new NetworkError();
        return <div />;
      });

      const ThemedFallback = Component.gen(function* (
        Props: Component.ComponentProps<{ error: NetworkError }>,
      ) {
        yield* Props;
        const theme = yield* ErrorTheme;
        return <div className={theme}>error</div>;
      });

      const SafeComponent = yield* ErrorBoundary.catch(RiskyComponent).pipe(
        ErrorBoundary.on("NetworkError", ThemedFallback),
        ErrorBoundary.catchAll(catchAllView("generic")),
      );

      // Render with ErrorTheme provided - should work
      const ProvidedComponent = SafeComponent.pipe(Component.provide(ErrorThemeLayer));
      const element = ProvidedComponent({});

      const { getByText } = yield* render(element);

      assert.isDefined(yield* getByText("error"));
    }),
  );
});

// =============================================================================
// Basic functionality
// =============================================================================

describe("ErrorBoundary basic functionality", () => {
  it.effect("catchAll renders fallback on error", () =>
    Effect.gen(function* () {
      const FailingComponent = Component.gen(function* () {
        yield* new TestError();
        return <div>should not render</div>;
      });

      const SafeComponent = yield* ErrorBoundary.catch(FailingComponent).pipe(
        ErrorBoundary.catchAll(catchAllView("fallback")),
      );

      const { getByText } = yield* render(<SafeComponent />);

      assert.isDefined(yield* getByText("fallback"));
    }),
  );

  it.effect("on() handler matches specific error tags", () =>
    Effect.gen(function* () {
      const RiskyComponent = Component.gen(function* () {
        yield* new NetworkError();
        return <div>should not render</div>;
      });

      const NetworkErrorView = Component.gen(function* (
        Props: Component.ComponentProps<{ error: NetworkError }>,
      ) {
        yield* Props;
        return <div>network-error</div>;
      });

      const SafeComponent = yield* ErrorBoundary.catch(RiskyComponent).pipe(
        ErrorBoundary.on("NetworkError", NetworkErrorView),
        ErrorBoundary.catchAll(catchAllView("generic-error")),
      );

      const { getByText, queryByText } = yield* render(<SafeComponent />);

      assert.isDefined(yield* getByText("network-error"));
      assert.isTrue(Option.isNone(yield* queryByText("generic-error")));
    }),
  );

  it.effect("unwraps symbol-key props", () =>
    Effect.gen(function* () {
      const SymbolKey = Symbol.for("error-boundary-symbol");

      const SymbolComponent = Component.gen(function* (
        Props: Component.ComponentProps<{ [SymbolKey]: Signal.Signal<string> }>,
      ) {
        const props = yield* Props;
        const value = yield* Signal.get(props[SymbolKey]);
        return <div data-testid="symbol-prop">{value}</div>;
      });

      const valueSignal = Signal.makeSync("symbol-value");
      const SafeComponent = yield* ErrorBoundary.catch(SymbolComponent).pipe(
        ErrorBoundary.catchAll(catchAllView("fallback")),
      );

      const element = SafeComponent({ [SymbolKey]: valueSignal });
      const { getByTestId } = yield* render(element);
      const node = yield* getByTestId("symbol-prop");

      assert.strictEqual(node.textContent, "symbol-value");
    }),
  );

  it.effect("signal-typed props stay usable through boundaries", () =>
    Effect.gen(function* () {
      const SignalPropComponent = Component.gen(function* (
        Props: Component.ComponentProps<{ count: Signal.Signal<number> }>,
      ) {
        const { count } = yield* Props;
        const doubled = yield* Signal.derive(count, (n) => n * 2);
        return <div data-testid="doubled">{doubled}</div>;
      });

      const count = Signal.makeSync(3);
      const SafeComponent = yield* ErrorBoundary.catch(SignalPropComponent).pipe(
        ErrorBoundary.catchAll(catchAllView("fallback", "fallback")),
      );

      const element = SafeComponent({ count });
      const { getByTestId, queryByTestId } = yield* render(element);

      assert.strictEqual((yield* getByTestId("doubled")).textContent, "6");
      assert.isTrue(Option.isNone(yield* queryByTestId("fallback")));
    }),
  );
});

// =============================================================================
// Builder validation
// =============================================================================

describe("ErrorBoundary builder validation", () => {
  it.effect("calling catchAll independently on same builder succeeds (immutable)", () =>
    Effect.gen(function* () {
      const FailingComponent = Component.gen(function* () {
        yield* new TestError();
        return <div />;
      });

      const builder = ErrorBoundary.catch(FailingComponent);

      // Both calls succeed independently — immutable builder semantics
      const Safe1 = yield* builder.pipe(ErrorBoundary.catchAll(catchAllView("fallback1", "fb1")));
      const Safe2 = yield* builder.pipe(ErrorBoundary.catchAll(catchAllView("fallback2", "fb2")));

      assert.isTrue(Component.isEffectComponent(Safe1));
      assert.isTrue(Component.isEffectComponent(Safe2));

      // Verify they render distinct fallbacks
      const r1 = yield* render(<Safe1 />);
      assert.isDefined(yield* r1.getByTestId("fb1"));

      const r2 = yield* render(<Safe2 />);
      assert.isDefined(yield* r2.getByTestId("fb2"));
    }),
  );
});
