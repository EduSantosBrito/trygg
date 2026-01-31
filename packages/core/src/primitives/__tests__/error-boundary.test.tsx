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
import { Context, Data, Effect, Layer } from "effect";
import * as Component from "../component.js";
import * as ErrorBoundary from "../error-boundary.js";
import * as Signal from "../signal.js";
import { render } from "../../testing/index.js";

// =============================================================================
// Test Errors
// =============================================================================

class TestError extends Data.TaggedError("TestError")<{}> {}
class NetworkError extends Data.TaggedError("NetworkError")<{}> {}

// =============================================================================
// .provide() preservation
// =============================================================================

describe("ErrorBoundary .provide() preservation", () => {
  it.scoped("provide preserves error boundary wrapper", () =>
    Effect.gen(function* () {
      const TestService = Context.GenericTag<string>("TestService");
      const TestLayer = Layer.succeed(TestService, "provided-value");

      const FailingComponent = Component.gen(function* () {
        yield* new TestError();
        return <div>should not render</div>;
      });

      const builder = yield* ErrorBoundary.catch(FailingComponent);
      const SafeComponent = yield* builder.catchAll(() => Effect.succeed(<div>fallback</div>));

      // Apply .provide() - this should NOT break the error boundary
      const ProvidedComponent = SafeComponent.provide(TestLayer);
      const element = ProvidedComponent({});

      // Render and assert fallback shown, not crash
      const { getByText, queryByText } = yield* render(element);

      assert.isDefined(yield* getByText("fallback"));
      assert.isNull(queryByText("should not render"));
    }),
  );

  it.scoped("services provided via .provide() available inside wrapped tree", () =>
    Effect.gen(function* () {
      const TestService = Context.GenericTag<string>("TestService");
      const TestLayer = Layer.succeed(TestService, "provided-value");

      const ServiceComponent = Component.gen(function* () {
        const value = yield* TestService;
        return <div data-testid="service-value">{value}</div>;
      });

      const builder = yield* ErrorBoundary.catch(ServiceComponent);
      const SafeComponent = yield* builder.catchAll(() => Effect.succeed(<div>error</div>));

      const ProvidedComponent = SafeComponent.provide(TestLayer);
      const element = ProvidedComponent({});

      const { getByTestId } = yield* render(element);

      assert.strictEqual((yield* getByTestId("service-value")).textContent, "provided-value");
    }),
  );

  it.scoped("isEffectComponent remains true and error boundary works", () =>
    Effect.gen(function* () {
      const FailingComponent = Component.gen(function* () {
        yield* new TestError();
        return <div>test</div>;
      });

      const builder = yield* ErrorBoundary.catch(FailingComponent);
      const SafeComponent = yield* builder.catchAll(() => Effect.succeed(<div>fallback</div>));

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
  it.scoped("propagates handler service requirements", () =>
    Effect.gen(function* () {
      const ErrorTheme = Context.GenericTag<string>("ErrorTheme");
      const ErrorThemeLayer = Layer.succeed(ErrorTheme, "error-theme");

      const RiskyComponent = Component.gen(function* () {
        yield* new NetworkError();
        return <div />;
      });

      const builder = yield* ErrorBoundary.catch(RiskyComponent);
      const withHandler = yield* builder.on("NetworkError", () =>
        Effect.gen(function* () {
          const theme = yield* ErrorTheme;
          return <div className={theme}>error</div>;
        }),
      );
      const SafeComponent = yield* withHandler.catchAll(() => Effect.succeed(<div>generic</div>));

      // Render with ErrorTheme provided - should work
      const ProvidedComponent = SafeComponent.provide(ErrorThemeLayer);
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
  it.scoped("catchAll renders fallback on error", () =>
    Effect.gen(function* () {
      const FailingComponent = Component.gen(function* () {
        yield* new TestError();
        return <div>should not render</div>;
      });

      const builder = yield* ErrorBoundary.catch(FailingComponent);
      const SafeComponent = yield* builder.catchAll(() => Effect.succeed(<div>fallback</div>));

      const { getByText } = yield* render(<SafeComponent />);

      assert.isDefined(yield* getByText("fallback"));
    }),
  );

  it.scoped("on() handler matches specific error tags", () =>
    Effect.gen(function* () {
      const RiskyComponent = Component.gen(function* () {
        yield* new NetworkError();
        return <div>should not render</div>;
      });

      const builder = yield* ErrorBoundary.catch(RiskyComponent);
      const withHandler = yield* builder.on("NetworkError", () =>
        Effect.succeed(<div>network-error</div>),
      );
      const SafeComponent = yield* withHandler.catchAll(() =>
        Effect.succeed(<div>generic-error</div>),
      );

      const { getByText, queryByText } = yield* render(<SafeComponent />);

      assert.isDefined(yield* getByText("network-error"));
      assert.isNull(queryByText("generic-error"));
    }),
  );

  it.scoped("unwraps symbol-key props", () =>
    Effect.gen(function* () {
      const SymbolKey = Symbol.for("error-boundary-symbol");

      const SymbolComponent = Component.gen(function* (
        Props: Component.ComponentProps<{ [SymbolKey]: string }>,
      ) {
        const props = yield* Props;
        return <div data-testid="symbol-prop">{props[SymbolKey]}</div>;
      });

      const valueSignal = Signal.unsafeMake("symbol-value");
      const builder = yield* ErrorBoundary.catch(SymbolComponent);
      const SafeComponent = yield* builder.catchAll(() => Effect.succeed(<div>fallback</div>));

      const element = SafeComponent({ [SymbolKey]: valueSignal });
      const { getByTestId } = yield* render(element);
      const node = yield* getByTestId("symbol-prop");

      assert.strictEqual(node.textContent, "symbol-value");
    }),
  );
});
