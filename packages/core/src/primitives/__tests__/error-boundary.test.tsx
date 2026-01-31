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
import { render } from "../../testing/index.js";

// =============================================================================
// Test Errors
// =============================================================================

class TestError extends Data.TaggedError("TestError")<{}> {}
class NetworkError extends Data.TaggedError("NetworkError")<{}> {}

// =============================================================================
// PR1-D1: .provide() preservation
// =============================================================================

describe("ErrorBoundary .provide() preservation", () => {
  it.scoped("provide preserves error boundary wrapper", () =>
    Effect.gen(function* () {
      const TestService = Context.GenericTag<string>("TestService");
      const TestLayer = Layer.succeed(TestService, "provided-value");

      const FailingComponent = Component.gen(function* () {
        yield* Effect.fail(new TestError());
        return <div>should not render</div>;
      });

      const SafeComponent = yield* ErrorBoundary.catch(FailingComponent).catchAll(
        () => <div>fallback</div>,
      );

      // Apply .provide() - this should NOT break the error boundary
      const ProvidedComponent = SafeComponent.provide(TestLayer);
      const element = ProvidedComponent({});

      // Render and assert fallback shown, not crash
      const { container } = yield* render(element);

      assert.isTrue(container.innerHTML.includes("fallback"));
      assert.isFalse(container.innerHTML.includes("should not render"));
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

      const SafeComponent = yield* ErrorBoundary.catch(ServiceComponent).catchAll(
        () => <div>error</div>,
      );

      const ProvidedComponent = SafeComponent.provide(TestLayer);
      const element = ProvidedComponent({});

      const { getByTestId } = yield* render(element);

      assert.strictEqual((yield* getByTestId("service-value")).textContent, "provided-value");
    }),
  );

  it("Component.isEffectComponent(SafeComponent) remains true", () => {
    const FailingComponent = Component.gen(function* () {
      return <div>test</div>;
    });

    const effect = ErrorBoundary.catch(FailingComponent).catchAll(() => <div>fallback</div>);

    const result = Effect.runSync(Effect.scoped(effect));
    assert.isTrue(Component.isEffectComponent(result));
  });
});

// =============================================================================
// PR1-D2: Handler requirements propagation
// =============================================================================

describe("ErrorBoundary handler requirements propagation", () => {
  it.scoped("propagates handler service requirements", () =>
    Effect.gen(function* () {
      const ErrorTheme = Context.GenericTag<string>("ErrorTheme");
      const ErrorThemeLayer = Layer.succeed(ErrorTheme, "error-theme");

      const RiskyComponent = Component.gen(function* () {
        yield* Effect.fail(new NetworkError());
        return <div />;
      });

      const ThemedFallback = Component.gen(function* () {
        const theme = yield* ErrorTheme;
        return <div className={theme}>error</div>;
      });

      const SafeComponent = yield* ErrorBoundary.catch(RiskyComponent)
        .on("NetworkError", () => <ThemedFallback />)
        .catchAll(() => <div>generic</div>);

      // Render with ErrorTheme provided - should work
      const ProvidedComponent = SafeComponent.provide(ErrorThemeLayer);
      const element = ProvidedComponent({});

      const { container } = yield* render(element);

      assert.isTrue(container.innerHTML.includes("error"));
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
        yield* Effect.fail(new TestError());
        return <div>should not render</div>;
      });

      const SafeComponent = yield* ErrorBoundary.catch(FailingComponent).catchAll(
        () => <div>fallback</div>,
      );

      const { container } = yield* render(<SafeComponent />);

      assert.isTrue(container.innerHTML.includes("fallback"));
    }),
  );

  it.scoped("on() handler matches specific error tags", () =>
    Effect.gen(function* () {
      const RiskyComponent = Component.gen(function* () {
        yield* Effect.fail(new NetworkError());
        return <div>should not render</div>;
      });

      const SafeComponent = yield* ErrorBoundary.catch(RiskyComponent)
        .on("NetworkError", () => <div>network-error</div>)
        .catchAll(() => <div>generic-error</div>);

      const { container } = yield* render(<SafeComponent />);

      assert.isTrue(container.innerHTML.includes("network-error"));
      assert.isFalse(container.innerHTML.includes("generic-error"));
    }),
  );
});
