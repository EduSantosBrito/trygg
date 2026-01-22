/**
 * @since 1.0.0
 * Testing utilities for effect-ui
 *
 * Provides helpers for rendering and querying components in tests.
 * Works with @effect/vitest for Effect-based testing.
 */
import { Duration, Effect, Layer, Option, Schedule, Scope } from "effect";
import { Element, isElement } from "./element.js";
import { browserLayer, Renderer } from "./renderer.js";
import * as Router from "./router/index.js";

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
   * Get an element by its text content (exact match)
   */
  readonly getByText: (text: string) => HTMLElement;

  /**
   * Query for an element by its text content (returns null if not found)
   */
  readonly queryByText: (text: string) => HTMLElement | null;

  /**
   * Get an element by its test id (data-testid attribute)
   */
  readonly getByTestId: (testId: string) => HTMLElement;

  /**
   * Query for an element by its test id (returns null if not found)
   */
  readonly queryByTestId: (testId: string) => HTMLElement | null;

  /**
   * Get an element by its role attribute
   */
  readonly getByRole: (role: string) => HTMLElement;

  /**
   * Query for an element by its role (returns null if not found)
   */
  readonly queryByRole: (role: string) => HTMLElement | null;

  /**
   * Get an element by CSS selector
   */
  readonly querySelector: <T extends HTMLElement = HTMLElement>(selector: string) => T;

  /**
   * Query all elements matching a CSS selector
   */
  readonly querySelectorAll: <T extends HTMLElement = HTMLElement>(
    selector: string,
  ) => ReadonlyArray<T>;
}

/**
 * Error thrown when a query fails to find an element
 * @since 1.0.0
 */
export class ElementNotFoundError extends Error {
  readonly _tag = "ElementNotFoundError";

  constructor(
    readonly queryType: string,
    readonly query: string,
  ) {
    super(`Unable to find element by ${queryType}: "${query}"`);
    this.name = "ElementNotFoundError";
  }
}

/**
 * Create query helpers for a container element
 * @internal
 */
const createQueryHelpers = (container: HTMLElement): Omit<TestRenderResult, "container"> => {
  const getByText = (text: string): HTMLElement => {
    const result = queryByText(text);
    if (!result) {
      throw new ElementNotFoundError("text", text);
    }
    return result;
  };

  const queryByText = (text: string): HTMLElement | null => {
    // Walk the tree to find elements with matching text content
    const walker = document.createTreeWalker(container, NodeFilter.SHOW_ELEMENT, {
      acceptNode(node) {
        // Only accept leaf elements (no child elements, only text)
        const element = node as HTMLElement;
        if (element.children.length === 0) {
          return element.textContent?.trim() === text
            ? NodeFilter.FILTER_ACCEPT
            : NodeFilter.FILTER_SKIP;
        }
        // Check direct text content for elements with children
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

  const getByTestId = (testId: string): HTMLElement => {
    const result = queryByTestId(testId);
    if (!result) {
      throw new ElementNotFoundError("testId", testId);
    }
    return result;
  };

  const queryByTestId = (testId: string): HTMLElement | null => {
    return container.querySelector(`[data-testid="${testId}"]`);
  };

  const getByRole = (role: string): HTMLElement => {
    const result = queryByRole(role);
    if (!result) {
      throw new ElementNotFoundError("role", role);
    }
    return result;
  };

  const queryByRole = (role: string): HTMLElement | null => {
    // Check explicit role attribute
    const explicit = container.querySelector<HTMLElement>(`[role="${role}"]`);
    if (explicit) return explicit;

    // Check implicit roles for common elements
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

  const querySelector = <T extends HTMLElement = HTMLElement>(selector: string): T => {
    const result = container.querySelector<T>(selector);
    if (!result) {
      throw new ElementNotFoundError("selector", selector);
    }
    return result;
  };

  const querySelectorAll = <T extends HTMLElement = HTMLElement>(
    selector: string,
  ): ReadonlyArray<T> => {
    return Array.from(container.querySelectorAll<T>(selector));
  };

  return {
    getByText,
    queryByText,
    getByTestId,
    queryByTestId,
    getByRole,
    queryByRole,
    querySelector,
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
 * import { renderElement } from "effect-ui/testing"
 *
 * describe("MyComponent", () => {
 *   it.scoped("renders content", () =>
 *     Effect.gen(function* () {
 *       const { getByText } = yield* renderElement(<div>Hello</div>)
 *       expect(getByText("Hello")).toBeDefined()
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
 *     expect(getByText("Hello")).toBeDefined()
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
export class WaitForTimeoutError extends Error {
  readonly _tag = "WaitForTimeoutError";

  constructor(
    readonly timeout: number,
    readonly lastError: unknown,
  ) {
    const message = lastError instanceof Error ? lastError.message : String(lastError);
    super(`waitFor timed out after ${timeout}ms: ${message}`);
    this.name = "WaitForTimeoutError";
  }
}

/**
 * Wait for a condition to become true.
 *
 * Uses Effect primitives (Schedule) so it works with TestClock.
 * Call `TestClock.adjust` to advance time in tests.
 *
 * @example
 * ```ts
 * // In a test with TestClock:
 * const result = yield* waitFor(() => getByTestId("element"))
 * yield* TestClock.adjust(100) // Advance time to allow retries
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

    return yield* Effect.fail(new WaitForTimeoutError(timeout, lastError));
  });
};

/**
 * Input type for render - can be an Element or an Effect that produces an Element
 * @since 1.0.0
 */
export type RenderInput<E = never> = Element | Effect.Effect<Element, E, never>;

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
 *     expect(getByText("Hello")).toBeDefined()
 *   })
 * )
 *
 * // Render a component (Effect)
 * it.scoped("renders component", () =>
 *   Effect.gen(function* () {
 *     const { getByText } = yield* render(MyComponent)
 *     expect(getByText("Hello")).toBeDefined()
 *   })
 * )
 * ```
 *
 * @since 1.0.0
 */
export const render = <E>(
  input: RenderInput<E>,
): Effect.Effect<TestRenderResult, E | unknown, Scope.Scope> => {
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
