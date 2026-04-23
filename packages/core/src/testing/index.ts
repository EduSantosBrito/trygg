/**
 * Testing utilities for the `trygg/testing` entrypoint.
 *
 * @remarks
 * Owner module for the browser-facing test helpers used in `@effect/vitest`
 * suites. These exports keep tests at the public DOM/query layer instead of
 * reaching into renderer internals.
 *
 * @see ./testing.docs.md - Source-owned topic guide
 * @since 1.0.0
 * @module trygg/testing
 */
import { Data, Duration, Effect, Layer, Option, Schedule, Scope } from "effect";
import { unsafeEraseR } from "../internal/unsafe.js";
import { Element, isElement } from "../primitives/element.js";
import { browserLayer, Renderer } from "../primitives/renderer.js";

/**
 * Query helpers returned by `render` and `renderElement`.
 *
 * @remarks
 * `TestRenderResult` keeps assertions focused on rendered DOM behavior while
 * still exposing the root container when lower-level inspection is needed.
 *
 * @example
 * ```tsx
 * const result = yield* render(<button>Save</button>)
 * const button = yield* result.getByText("Save")
 * ```
 *
 * @category Testing
 * @public
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
 * Error raised when a required query finds no matching element.
 *
 * @remarks
 * `ElementNotFoundError` is the failure channel for the `getBy*` helpers so
 * tests can pattern-match on a missing DOM node instead of parsing strings.
 *
 * @example
 * ```tsx
 * const result = yield* render(<div>Hello</div>)
 * const exit = yield* Effect.exit(result.getByText("Missing"))
 * ```
 *
 * @category Testing
 * @public
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
  const fromNullable = <A>(value: A | null | undefined): Option.Option<A> =>
    value === null || value === undefined ? Option.none() : Option.some(value);

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
    Effect.sync(() => fromNullable(findByText(text)));

  const queryByTestId = (testId: string): Effect.Effect<Option.Option<HTMLElement>> =>
    Effect.sync(() => fromNullable(findByTestId(testId)));

  const queryByRole = (role: string): Effect.Effect<Option.Option<HTMLElement>> =>
    Effect.sync(() => fromNullable(findByRole(role)));

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
    Effect.sync(() => fromNullable(container.querySelector<T>(selector)));

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
 * Render a raw `Element` into a disposable test container.
 *
 * @remarks
 * Use `renderElement` when a test already has an `Element` and wants explicit
 * control over when the renderer layer is provided.
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
 * @category Testing
 * @public
 * @since 1.0.0
 */
const renderElementImpl = Effect.fn("renderElement")(function* (element: Element) {
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
 * Render a raw `Element` into a disposable test container.
 *
 * @remarks
 * Use `renderElement` when a test already has an `Element` and wants explicit
 * control over when the renderer layer is provided.
 *
 * @example
 * ```tsx
 * const result = yield* renderElement(<div>Hello</div>).pipe(Effect.provide(testLayer))
 * const element = yield* result.getByText("Hello")
 * ```
 *
 * @category Testing
 * @public
 * @since 1.0.0
 */
export const renderElement: (
  element: Element,
) => Effect.Effect<TestRenderResult, unknown, Scope.Scope> = (element) =>
  unsafeEraseR(renderElementImpl(element));

/**
 * Test layer that provides the browser renderer.
 *
 * @remarks
 * `testLayer` is the minimal layer needed by `renderElement`. The higher-level
 * `render` helper provides it for you automatically.
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
 * @category Testing
 * @public
 * @since 1.0.0
 */
export const testLayer: Layer.Layer<Renderer> = browserLayer;

/**
 * Simulate a click event on an element.
 *
 * @remarks
 * `click` dispatches through the browser DOM so component event handlers run in
 * the same shape they would under a real user interaction.
 *
 * @example
 * ```tsx
 * const result = yield* render(<button>Save</button>)
 * yield* click(yield* result.getByText("Save"))
 * ```
 *
 * @category Testing
 * @public
 * @since 1.0.0
 */
export const click = (element: HTMLElement): Effect.Effect<void> =>
  Effect.sync(() => {
    element.click();
  });

/**
 * Simulate typing into an input or textarea.
 *
 * @remarks
 * `type` updates the element value and dispatches the matching `input` and
 * `change` events so controlled components observe the same sequence as in the
 * browser.
 *
 * @example
 * ```tsx
 * const result = yield* render(<input data-testid="name" />)
 * yield* type(yield* result.getByTestId("name"), "Ada")
 * ```
 *
 * @category Testing
 * @public
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
 * Error raised when `waitFor` exhausts its retry budget.
 *
 * @remarks
 * The error keeps the original timeout and last thrown failure so test output
 * still explains what never became true.
 *
 * @example
 * ```ts
 * const exit = yield* Effect.exit(waitFor(() => {
 *   throw new Error("still loading")
 * }, { timeout: 50, interval: 10 }))
 * ```
 *
 * @category Testing
 * @public
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
 * @remarks
 * `waitFor` uses Effect schedules instead of real timers, so it works with
 * `TestClock` and other deterministic test runtimes.
 *
 * @example
 * ```ts
 * // In a test with TestClock - fork first, then adjust time:
 * const fiber = yield* Effect.forkChild(waitFor(() => queryByTestId("element")))
 * yield* TestClock.adjust(1000)
 * const result = yield* Fiber.join(fiber)
 * ```
 *
 * @category Testing
 * @public
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
  const schedule = Schedule.both(
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
 * Input accepted by `render`.
 *
 * @remarks
 * `RenderInput` keeps the convenience helper flexible: callers can pass a ready
 * `Element` or a component Effect that resolves to one.
 *
 * @example
 * ```ts
 * const input: RenderInput = Effect.succeed(<div>Hello</div>)
 * ```
 *
 * @category Testing
 * @public
 * @since 1.0.0
 */
export type RenderInput = Element | Effect.Effect<Element, unknown, never>;

/**
 * Convenience renderer for tests.
 *
 * @remarks
 * `render` is the default testing entrypoint. It accepts either a static
 * element or a component Effect, provides `testLayer`, and reuses the scope
 * already managed by `it.scoped`.
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
 * @category Testing
 * @public
 * @since 1.0.0
 */
export const render = (
  input: RenderInput,
): Effect.Effect<TestRenderResult, unknown, Scope.Scope> => {
  // Check if input is an Element (has _tag property) or an Effect
  if (isElement(input)) {
    return unsafeEraseR(renderElement(input).pipe(Effect.provide(testLayer)));
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
      identity: render,
      inputs: undefined,
    });

    return yield* unsafeEraseR(
      renderElement(componentElement).pipe(Effect.provideService(Scope.Scope, scope)),
    );
  }).pipe(Effect.provide(testLayer), unsafeEraseR);
};
