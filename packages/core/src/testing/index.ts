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
import { Cause, Duration, Effect, Layer, Option, Schedule, Schema, Scope } from "effect";
import { TestClock } from "effect/testing";
import { unsafeEraseR } from "../internal/unsafe.js";
import { Element, isElement } from "../primitives/element.js";
import { browserLayer, Renderer } from "../primitives/renderer.js";
import * as Trace from "../trace/index.js";

/**
 * The framework's internal flight recorder, re-exported for assertions.
 *
 * @remarks
 * Pair with {@link withRecording} (or {@link Trace.makeRecorder}) to capture the
 * ordered list of framework steps a test triggers, then assert on their names.
 *
 * @category Testing
 * @public
 * @since 1.0.0
 */
export { Trace };

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
export class ElementNotFoundError extends Schema.TaggedErrorClass<ElementNotFoundError>()(
  "ElementNotFoundError",
  {
    queryType: Schema.String,
    query: Schema.String,
  },
) {
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
        if (!(node instanceof HTMLElement)) return NodeFilter.FILTER_SKIP;
        if (node.children.length === 0) {
          return node.textContent?.trim() === text
            ? NodeFilter.FILTER_ACCEPT
            : NodeFilter.FILTER_SKIP;
        }
        for (const child of Array.from(node.childNodes)) {
          if (child.nodeType === Node.TEXT_NODE && child.textContent?.trim() === text) {
            return NodeFilter.FILTER_ACCEPT;
          }
        }
        return NodeFilter.FILTER_SKIP;
      },
    });
    const node = walker.nextNode();
    return node instanceof HTMLElement ? node : null;
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

  const getByText: (text: string) => Effect.Effect<HTMLElement, ElementNotFoundError> =
    Effect.fnUntraced(function* (text) {
      const result = yield* queryByText(text);
      if (Option.isNone(result)) {
        return yield* new ElementNotFoundError({ queryType: "text", query: text });
      }
      return result.value;
    });

  const getByTestId: (testId: string) => Effect.Effect<HTMLElement, ElementNotFoundError> =
    Effect.fnUntraced(function* (testId) {
      const result = yield* queryByTestId(testId);
      if (Option.isNone(result)) {
        return yield* new ElementNotFoundError({ queryType: "testId", query: testId });
      }
      return result.value;
    });

  const getByRole: (role: string) => Effect.Effect<HTMLElement, ElementNotFoundError> =
    Effect.fnUntraced(function* (role) {
      const result = yield* queryByRole(role);
      if (Option.isNone(result)) {
        return yield* new ElementNotFoundError({ queryType: "role", query: role });
      }
      return result.value;
    });

  const querySelector = <T extends HTMLElement = HTMLElement>(
    selector: string,
  ): Effect.Effect<T, ElementNotFoundError> =>
    Effect.sync(() => container.querySelector<T>(selector)).pipe(
      Effect.flatMap((result) =>
        result === null
          ? Effect.fail(new ElementNotFoundError({ queryType: "selector", query: selector }))
          : Effect.succeed(result),
      ),
    );

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

const flushDomMicrotask: Effect.Effect<void> = Effect.callback((resume) => {
  queueMicrotask(() => resume(Effect.void));
});

const flushInteractionEffects: Effect.Effect<void> = Effect.gen(function* () {
  yield* flushDomMicrotask;
  // In @effect/vitest, TestClock.adjust(0) is the deterministic scheduler drain:
  // Effect's TestClock first awaits a forked `Effect.yieldNow`, then runs due sleepers.
  yield* TestClock.adjust(0);
});

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
  }).pipe(Effect.andThen(flushInteractionEffects));

/**
 * Run `effect` with a fresh in-memory {@link Trace.Recorder} installed and the
 * minimum log level dropped to `Trace`, then resolve with the ordered list of
 * framework records it produced.
 *
 * @remarks
 * The recorder replaces the ambient logger set for this scope only, so
 * concurrent tests stay isolated — only work under this `withRecording` scope is
 * observed. For finer control (asserting names mid-scenario, reusing a recorder
 * across steps) build the recorder yourself with {@link Trace.makeRecorder} and
 * {@link Trace.record}.
 *
 * @example
 * ```tsx
 * const records = yield* withRecording(
 *   Effect.gen(function* () {
 *     const result = yield* render(<Counter />)
 *     yield* click(yield* result.getByText("Increment"))
 *   }),
 * )
 * expect(records.map((r) => r.name)).toEqual(["signal.set", "signalText.update"])
 * ```
 *
 * @category Testing
 * @public
 * @since 1.0.0
 */
export const withRecording = <A, E, R>(
  effect: Effect.Effect<A, E, R>,
): Effect.Effect<ReadonlyArray<Trace.TraceRecord>, E, R> =>
  Effect.suspend(() => {
    const recorder = Trace.makeRecorder();
    return Trace.record(effect, recorder).pipe(Effect.andThen(recorder.snapshot));
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
export class WaitForTimeoutError extends Schema.TaggedErrorClass<WaitForTimeoutError>()(
  "WaitForTimeoutError",
  {
    timeout: Schema.Number,
    lastError: Schema.Unknown,
  },
) {
  override get message() {
    return `waitFor timed out after ${this.timeout}ms: ${Cause.pretty(Cause.fail(this.lastError))}`;
  }
}

class WaitForAttemptError extends Schema.TaggedErrorClass<WaitForAttemptError>()(
  "WaitForAttemptError",
  {
    cause: Schema.Unknown,
  },
) {}

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
export const waitFor: <T>(
  fn: () => T,
  options?: { timeout?: number; interval?: number },
) => Effect.Effect<T, WaitForTimeoutError> = Effect.fn("waitFor")(function* <T>(
  fn: () => T,
  options: { timeout?: number; interval?: number } = {},
) {
  const { timeout = 1000, interval = 50 } = options;
  const maxRetries = Math.ceil(timeout / interval);

  // Track the last error for the timeout message
  let lastError: unknown = "Condition never checked";
  let result: Option.Option<T> = Option.none();

  // Try the function, storing result/error
  const attempt = Effect.try({
    try: fn,
    catch: (cause) => new WaitForAttemptError({ cause }),
  }).pipe(
    Effect.match({
      onFailure: (error) => {
        lastError = error.cause;
        result = Option.none();
        return false;
      },
      onSuccess: (value) => {
        result = Option.some(value);
        return true;
      },
    }),
  );

  // Schedule: retry at interval, max retries based on timeout
  const schedule = Schedule.both(
    Schedule.spaced(Duration.millis(interval)),
    Schedule.recurs(maxRetries),
  );

  // Run with retries until success or schedule exhausted
  yield* attempt.pipe(
    Effect.repeat({
      schedule,
      until: (success) => success,
    }),
    Effect.asVoid,
  );

  // Check final result
  if (Option.isSome(result)) {
    return result.value;
  }

  return yield* new WaitForTimeoutError({ timeout, lastError });
});

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
