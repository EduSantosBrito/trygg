/**
 * @since 1.0.0
 * Testing utilities for trygg
 *
 * Provides helpers for rendering and querying components in tests.
 * Works with @effect/vitest for Effect-based testing.
 */
import { Data, Duration, Effect, Layer, Option, Schedule, Scope } from "effect";
import { Element, isElement } from "../primitives/element.js";
import { browserLayer, Renderer } from "../primitives/renderer.js";
import * as Router from "../router/index.js";

/**
 * Result of rendering an element for testing
 * @since 1.0.0
 */
export interface TestRenderResult {
  /**
   * The container element that holds the rendered content
   */
  readonly container: HTMLElement;

  /**
   * Get an element by its text content (exact match). Fails if not found.
   */
  readonly getByText: (text: string) => Effect.Effect<HTMLElement, ElementNotFoundError>;

  /**
   * Query for an element by its text content. Returns Option.none if not found.
   */
  readonly queryByText: (text: string) => Effect.Effect<Option.Option<HTMLElement>>;

  /**
   * Get an element by its test id (data-testid attribute). Fails if not found.
   */
  readonly getByTestId: (testId: string) => Effect.Effect<HTMLElement, ElementNotFoundError>;

  /**
   * Query for an element by its test id. Returns Option.none if not found.
   */
  readonly queryByTestId: (testId: string) => Effect.Effect<Option.Option<HTMLElement>>;

  /**
   * Get an element by its role attribute. Fails if not found.
   */
  readonly getByRole: (role: string) => Effect.Effect<HTMLElement, ElementNotFoundError>;

  /**
   * Query for an element by its role. Returns Option.none if not found.
   */
  readonly queryByRole: (role: string) => Effect.Effect<Option.Option<HTMLElement>>;

  /**
   * Get an element by CSS selector. Fails if not found.
   */
  readonly querySelector: <T extends HTMLElement = HTMLElement>(
    selector: string,
  ) => Effect.Effect<T, ElementNotFoundError>;

  /**
   * Query for an element by CSS selector. Returns Option.none if not found.
   */
  readonly queryBySelector: <T extends HTMLElement = HTMLElement>(
    selector: string,
  ) => Effect.Effect<Option.Option<T>>;

  /**
   * Query all elements matching a CSS selector.
   */
  readonly querySelectorAll: <T extends HTMLElement = HTMLElement>(
    selector: string,
  ) => Effect.Effect<ReadonlyArray<T>>;
}

/**
 * Error thrown when a query fails to find an element
 * @since 1.0.0
 */
export class ElementNotFoundError extends Data.TaggedError("ElementNotFoundError")<{
  readonly queryType: string;
  readonly query: string;
}> {
  override get message() {
    return `Unable to find element by ${this.queryType}: "${this.query}"`;
  }
}

/**
 * Create query helpers for a container element
 * @internal
 */
const createQueryHelpers = (container: HTMLElement): Omit<TestRenderResult, "container"> => {
  // Internal sync helpers
  const findByText = (text: string): HTMLElement | null => {
    const walker = document.createTreeWalker(container, NodeFilter.SHOW_ELEMENT, {
      acceptNode(node) {
        const element = node as HTMLElement;
        if (element.children.length === 0) {
          return element.textContent?.trim() === text
            ? NodeFilter.FILTER_ACCEPT
            : NodeFilter.FILTER_SKIP;
        }
        for (const child of Array.from(element.childNodes)) {
          if (child.nodeType === Node.TEXT_NODE && child.textContent?.trim() === text) {
            return NodeFilter.FILTER_ACCEPT;
          }
        }
        return NodeFilter.FILTER_SKIP;
      },
    });
    const node = walker.nextNode();
    return node ? (node as HTMLElement) : null;
  };

  const findByTestId = (testId: string): HTMLElement | null =>
    container.querySelector(`[data-testid="${testId}"]`);

  const findByRole = (role: string): HTMLElement | null => {
    const explicit = container.querySelector<HTMLElement>(`[role="${role}"]`);
    if (explicit) return explicit;

    const implicitRoleMap: Record<string, string> = {
      button: "button",
      a: "link",
      input: "textbox",
      h1: "heading",
      h2: "heading",
      h3: "heading",
      h4: "heading",
      h5: "heading",
      h6: "heading",
      nav: "navigation",
      main: "main",
      header: "banner",
      footer: "contentinfo",
      aside: "complementary",
      article: "article",
      section: "region",
      form: "form",
      img: "img",
      ul: "list",
      ol: "list",
      li: "listitem",
      table: "table",
      tr: "row",
      td: "cell",
      th: "columnheader",
    };

    for (const [tag, implicitRole] of Object.entries(implicitRoleMap)) {
      if (implicitRole === role) {
        const element = container.querySelector<HTMLElement>(tag);
        if (element) return element;
      }
    }
    return null;
  };

  // Public Effect-returning functions
  const queryByText = (text: string): Effect.Effect<Option.Option<HTMLElement>> =>
    Effect.sync(() => Option.fromNullable(findByText(text)));

  const queryByTestId = (testId: string): Effect.Effect<Option.Option<HTMLElement>> =>
    Effect.sync(() => Option.fromNullable(findByTestId(testId)));

  const queryByRole = (role: string): Effect.Effect<Option.Option<HTMLElement>> =>
    Effect.sync(() => Option.fromNullable(findByRole(role)));

  const querySelectorAll = <T extends HTMLElement = HTMLElement>(
    selector: string,
  ): Effect.Effect<ReadonlyArray<T>> =>
    Effect.sync(() => Array.from(container.querySelectorAll<T>(selector)));

  const getByText = (text: string): Effect.Effect<HTMLElement, ElementNotFoundError> =>
    Effect.gen(function* () {
      const result = yield* queryByText(text);
      if (Option.isNone(result)) {
        return yield* new ElementNotFoundError({ queryType: "text", query: text });
      }
      return result.value;
    });

  const getByTestId = (testId: string): Effect.Effect<HTMLElement, ElementNotFoundError> =>
    Effect.gen(function* () {
      const result = yield* queryByTestId(testId);
      if (Option.isNone(result)) {
        return yield* new ElementNotFoundError({ queryType: "testId", query: testId });
      }
      return result.value;
    });

  const getByRole = (role: string): Effect.Effect<HTMLElement, ElementNotFoundError> =>
    Effect.gen(function* () {
      const result = yield* queryByRole(role);
      if (Option.isNone(result)) {
        return yield* new ElementNotFoundError({ queryType: "role", query: role });
      }
      return result.value;
    });

  const querySelector = <T extends HTMLElement = HTMLElement>(
    selector: string,
  ): Effect.Effect<T, ElementNotFoundError> =>
    Effect.gen(function* () {
      const result = container.querySelector<T>(selector);
      if (!result) {
        return yield* new ElementNotFoundError({ queryType: "selector", query: selector });
      }
      return result;
    });

  const queryBySelector = <T extends HTMLElement = HTMLElement>(
    selector: string,
  ): Effect.Effect<Option.Option<T>> =>
    Effect.sync(() => Option.fromNullable(container.querySelector<T>(selector)));

  return {
    getByText,
    queryByText,
    getByTestId,
    queryByTestId,
    getByRole,
    queryByRole,
    querySelector,
    queryBySelector,
    querySelectorAll,
  };
};

/**
 * Render an Element for testing
 *
 * Creates a container, renders the element into it, and returns query helpers.
 * The container is automatically cleaned up when the scope closes.
 *
 * @example
 * ```tsx
 * import { describe, it, expect } from "@effect/vitest"
 * import { Effect } from "effect"
 * import { renderElement } from "trygg/testing"
 *
 * describe("MyComponent", () => {
 *   it.scoped("renders content", () =>
 *     Effect.gen(function* () {
 *       const { getByText } = yield* renderElement(<div>Hello</div>)
 *       const el = yield* getByText("Hello")
 *       expect(el).toBeDefined()
 *     })
 *   )
 * })
 * ```
 *
 * @since 1.0.0
 */
export const renderElement = Effect.fn("renderElement")(function* (element: Element) {
  const renderer = yield* Renderer;

  // Create a container for the rendered element
  const container = document.createElement("div");
  container.setAttribute("data-testid", "test-container");
  document.body.appendChild(container);

  // Render the element
  yield* renderer.mount(container, element);

  // Clean up container when scope closes
  yield* Effect.addFinalizer(() =>
    Effect.sync(() => {
      container.remove();
    }),
  );

  return {
    container,
    ...createQueryHelpers(container),
  } satisfies TestRenderResult;
});

/**
 * Test layer that provides the browser renderer
 *
 * @example
 * ```tsx
 * it.scoped("renders", () =>
 *   Effect.gen(function* () {
 *     const { getByText } = yield* renderElement(<div>Hello</div>)
 *     const el = yield* getByText("Hello")
 *     expect(el).toBeDefined()
 *   }).pipe(Effect.provide(testLayer))
 * )
 * ```
 *
 * @since 1.0.0
 */
export const testLayer: Layer.Layer<Renderer> = Layer.provide(browserLayer, Router.testLayer());

/**
 * Simulate a click event on an element
 * @since 1.0.0
 */
export const click = (element: HTMLElement): Effect.Effect<void> =>
  Effect.sync(() => {
    element.click();
  });

/**
 * Simulate typing into an input element
 * @since 1.0.0
 */
export const type = (
  element: HTMLInputElement | HTMLTextAreaElement,
  value: string,
): Effect.Effect<void> =>
  Effect.sync(() => {
    element.value = value;
    element.dispatchEvent(new Event("input", { bubbles: true }));
    element.dispatchEvent(new Event("change", { bubbles: true }));
  });

/**
 * Error thrown when waitFor times out
 * @since 1.0.0
 */
export class WaitForTimeoutError extends Data.TaggedError("WaitForTimeoutError")<{
  readonly timeout: number;
  readonly lastError: unknown;
}> {
  override get message() {
    const errorMsg =
      this.lastError instanceof Error ? this.lastError.message : String(this.lastError);
    return `waitFor timed out after ${this.timeout}ms: ${errorMsg}`;
  }
}

/**
 * Wait for a condition to become true.
 *
 * Uses Effect primitives (Schedule) so it works with TestClock.
 * Must fork the waitFor call, then advance time, then join.
 *
 * @example
 * ```ts
 * // In a test with TestClock - fork first, then adjust time:
 * const fiber = yield* Effect.fork(waitFor(() => queryByTestId("element")))
 * yield* TestClock.adjust(1000)
 * const result = yield* Fiber.join(fiber)
 * ```
 *
 * @since 1.0.0
 */
export const waitFor = <T>(
  fn: () => T,
  options: { timeout?: number; interval?: number } = {},
): Effect.Effect<T, WaitForTimeoutError> => {
  const { timeout = 1000, interval = 50 } = options;
  const maxRetries = Math.ceil(timeout / interval);

  // Track the last error for the timeout message
  let lastError: unknown = new Error("Condition never checked");
  let result: Option.Option<T> = Option.none();

  // Try the function, storing result/error
  const attempt = Effect.sync(() => {
    try {
      const value = fn();
      result = Option.some(value);
      return true; // success
    } catch (e) {
      lastError = e;
      result = Option.none();
      return false; // keep retrying
    }
  });

  // Schedule: retry at interval, max retries based on timeout
  const schedule = Schedule.intersect(
    Schedule.spaced(Duration.millis(interval)),
    Schedule.recurs(maxRetries),
  );

  return Effect.gen(function* () {
    // Run with retries until success or schedule exhausted
    yield* attempt.pipe(
      Effect.repeat({
        schedule,
        until: (success) => success,
      }),
      Effect.ignore,
    );

    // Check final result
    if (Option.isSome(result)) {
      return result.value;
    }

    return yield* new WaitForTimeoutError({ timeout, lastError });
  });
};

/**
 * Input type for render - can be an Element or an Effect that produces an Element
 * @since 1.0.0
 */
export type RenderInput = Element | Effect.Effect<Element, unknown, never>;

/**
 * Convenience function to render and provide the test layer
 *
 * Accepts either a static Element or an Effect that produces an Element (component).
 * Effects are wrapped in a Component element to enable reactive re-rendering.
 * The Scope is provided by `it.scoped` from @effect/vitest.
 *
 * @example
 * ```tsx
 * // Render a static element
 * it.scoped("renders element", () =>
 *   Effect.gen(function* () {
 *     const { getByText } = yield* render(<div>Hello</div>)
 *     const el = yield* getByText("Hello")
 *     expect(el).toBeDefined()
 *   })
 * )
 *
 * // Render a component (Effect)
 * it.scoped("renders component", () =>
 *   Effect.gen(function* () {
 *     const { getByText } = yield* render(MyComponent)
 *     const el = yield* getByText("Hello")
 *     expect(el).toBeDefined()
 *   })
 * )
 * ```
 *
 * @since 1.0.0
 */
export const render = (
  input: RenderInput,
): Effect.Effect<TestRenderResult, unknown, Scope.Scope> => {
  // Check if input is an Element (has _tag property) or an Effect
  if (isElement(input)) {
    return renderElement(input).pipe(Effect.provide(testLayer));
  }

  // Input is an Effect<Element, E, never>
  // Wrap in Component for reactive re-rendering
  return Effect.gen(function* () {
    // Get the test's scope - this will be used for the component's lifecycle
    const scope = yield* Effect.scope;

    // Wrap in Component for reactive re-rendering
    const componentElement = Element.Component({
      run: () => input,
      key: null,
    });

    return yield* renderElement(componentElement).pipe(Effect.provideService(Scope.Scope, scope));
  }).pipe(Effect.provide(testLayer));
};
