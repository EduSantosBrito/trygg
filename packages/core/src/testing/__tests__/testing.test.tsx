/**
 * Tests for testing utilities
 * @module
 */
import { assert, describe, it } from "@effect/vitest";
import { scoped } from "../effect-vitest.js";
import { Cause, Effect, Exit, Fiber, Option, Predicate, Schema, Scope } from "effect";
import { TestClock } from "effect/testing";
import {
  click,
  ElementNotFoundError,
  render,
  renderElement,
  testLayer,
  type,
  waitFor,
  WaitForTimeoutError,
} from "../index.js";
import * as Signal from "../../primitives/signal.js";
import { Renderer } from "../../primitives/renderer.js";

class TestWaitForError extends Schema.TaggedErrorClass<TestWaitForError>()("TestWaitForError", {
  reason: Schema.String,
}) {}

const failWaitFor = (reason: string): never => assert.fail(reason);

const requireInputElement = (element: HTMLElement, testId: string): HTMLInputElement => {
  if (element instanceof HTMLInputElement) {
    return element;
  }
  return assert.fail(`Expected ${testId} to be an HTMLInputElement`);
};

const requireTextAreaElement = (element: HTMLElement, testId: string): HTMLTextAreaElement => {
  if (element instanceof HTMLTextAreaElement) {
    return element;
  }
  return assert.fail(`Expected ${testId} to be an HTMLTextAreaElement`);
};

describe("Testing Utilities", () => {
  // ─────────────────────────────────────────────────────────────────────────────
  // Scope: TestRenderResult interface
  // ─────────────────────────────────────────────────────────────────────────────
  describe("TestRenderResult", () => {
    scoped("should expose the container element", () =>
      Effect.gen(function* () {
        const result = yield* renderElement(<div>Hello</div>).pipe(Effect.provide(testLayer));

        assert.instanceOf(result.container, HTMLDivElement);
      }),
    );

    scoped("should set data-testid on container", () =>
      Effect.gen(function* () {
        const result = yield* renderElement(<div>Hello</div>).pipe(Effect.provide(testLayer));

        assert.strictEqual(result.container.getAttribute("data-testid"), "test-container");
      }),
    );
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // Scope: renderElement function
  // ─────────────────────────────────────────────────────────────────────────────
  describe("renderElement", () => {
    scoped("should render a simple element to the DOM", () =>
      Effect.gen(function* () {
        const result = yield* renderElement(<div>Hello</div>).pipe(Effect.provide(testLayer));

        assert.strictEqual(result.container.textContent, "Hello");
      }),
    );

    scoped("should render element with children", () =>
      Effect.gen(function* () {
        const result = yield* renderElement(
          <div>
            <span>Child 1</span>
            <span>Child 2</span>
          </div>,
        ).pipe(Effect.provide(testLayer));

        const spans = result.container.querySelectorAll("span");
        assert.strictEqual(spans.length, 2);
        assert.strictEqual(spans[0]?.textContent, "Child 1");
        assert.strictEqual(spans[1]?.textContent, "Child 2");
      }),
    );

    scoped("should render element with attributes", () =>
      Effect.gen(function* () {
        const result = yield* renderElement(<div className="test-class" id="test-id" />).pipe(
          Effect.provide(testLayer),
        );

        const div = result.container.querySelector("div");
        assert.strictEqual(div?.className, "test-class");
        assert.strictEqual(div?.id, "test-id");
      }),
    );

    scoped("should remove container when scope closes", () =>
      Effect.gen(function* () {
        const scope = yield* Scope.make();

        yield* renderElement(<div id="scoped-element">Content</div>).pipe(
          Effect.provide(testLayer),
          Scope.provide(scope),
        );

        const elementInDom = document.querySelector("#scoped-element");
        assert.isNotNull(elementInDom);

        yield* Scope.close(scope, Exit.void);

        const elementAfterClose = document.querySelector("#scoped-element");
        assert.isNull(elementAfterClose);
      }),
    );

    scoped("should require Renderer service", () =>
      Effect.gen(function* () {
        // This test verifies that renderElement requires Renderer service
        // We can verify this by checking the effect runs successfully WITH testLayer
        const result = yield* renderElement(<div>Hello</div>).pipe(Effect.provide(testLayer));
        assert.isNotNull(result.container);
        // Type system ensures Renderer is required - compile-time verification
      }),
    );

    scoped("should create separate containers for multiple renders", () =>
      Effect.gen(function* () {
        const result1 = yield* renderElement(<div id="el-1">First</div>).pipe(
          Effect.provide(testLayer),
        );
        const result2 = yield* renderElement(<div id="el-2">Second</div>).pipe(
          Effect.provide(testLayer),
        );

        assert.notStrictEqual(result1.container, result2.container);
        assert.strictEqual(result1.container.querySelector("#el-1")?.textContent, "First");
        assert.strictEqual(result2.container.querySelector("#el-2")?.textContent, "Second");
      }),
    );
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // Scope: render convenience function
  // ─────────────────────────────────────────────────────────────────────────────
  describe("render", () => {
    scoped("should render a static Element", () =>
      Effect.gen(function* () {
        const result = yield* render(<div>Static content</div>);

        assert.strictEqual(result.container.textContent, "Static content");
      }),
    );

    scoped("should render an Effect that produces Element", () =>
      Effect.gen(function* () {
        const componentEffect = Effect.succeed(<div>From Effect</div>);
        const result = yield* render(componentEffect);

        assert.strictEqual(result.container.textContent, "From Effect");
      }),
    );

    scoped("should wrap Effect in Component element", () =>
      Effect.gen(function* () {
        const componentEffect = Effect.gen(function* () {
          return <div className="component">Component content</div>;
        });
        const result = yield* render(componentEffect);

        assert.strictEqual(
          result.container.querySelector(".component")?.textContent,
          "Component content",
        );
      }),
    );

    scoped("should provide testLayer automatically", () =>
      Effect.gen(function* () {
        const result = yield* render(<div>Auto provided</div>);

        assert.strictEqual(result.container.textContent, "Auto provided");
      }),
    );

    scoped("should use scope from test context", () =>
      Effect.gen(function* () {
        yield* render(<div id="scope-test">Scoped</div>);

        const found = document.querySelector("#scope-test");
        assert.isNotNull(found);
      }),
    );

    scoped("should support reactive updates in components", () =>
      Effect.gen(function* () {
        const count = yield* Signal.make(0);

        const component = Effect.gen(function* () {
          const value = yield* Signal.get(count);
          return <div data-testid="counter">{String(value)}</div>;
        });

        const result = yield* render(component);

        assert.strictEqual((yield* result.getByTestId("counter")).textContent, "0");

        yield* Signal.set(count, 5);
        yield* TestClock.adjust(10);

        assert.strictEqual((yield* result.getByTestId("counter")).textContent, "5");
      }),
    );
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // Scope: getByText query
  // ─────────────────────────────────────────────────────────────────────────────
  describe("getByText", () => {
    scoped("should find element by exact text content", () =>
      Effect.gen(function* () {
        const result = yield* render(
          <div>
            <span>Hello World</span>
          </div>,
        );

        const found = yield* result.getByText("Hello World");
        assert.strictEqual(found.tagName, "SPAN");
      }),
    );

    scoped("should find leaf element with text", () =>
      Effect.gen(function* () {
        const result = yield* render(
          <div>
            <p>
              <span>Nested</span>
            </p>
          </div>,
        );

        const found = yield* result.getByText("Nested");
        assert.strictEqual(found.tagName, "SPAN");
      }),
    );

    scoped("should find element with direct text node among children", () =>
      Effect.gen(function* () {
        const result = yield* render(
          <div>
            <p>
              Direct text<span></span>
            </p>
          </div>,
        );

        const found = yield* result.getByText("Direct text");
        assert.strictEqual(found.tagName, "P");
      }),
    );

    scoped("should fail with ElementNotFoundError when text not found", () =>
      Effect.gen(function* () {
        const result = yield* render(<div>Existing</div>);

        const exit = yield* Effect.exit(result.getByText("Not found"));
        assert.isTrue(Exit.isFailure(exit));
      }),
    );

    scoped("should not match partial text", () =>
      Effect.gen(function* () {
        const result = yield* render(
          <div>
            <span>Hello World</span>
          </div>,
        );

        const exit = yield* Effect.exit(result.getByText("Hello"));
        assert.isTrue(Exit.isFailure(exit));
      }),
    );

    scoped("should trim whitespace when matching text", () =>
      Effect.gen(function* () {
        const result = yield* render(
          <div>
            <span> Trimmed </span>
          </div>,
        );

        const found = yield* result.getByText("Trimmed");
        assert.strictEqual(found.tagName, "SPAN");
      }),
    );
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // Scope: queryByText query
  // ─────────────────────────────────────────────────────────────────────────────
  describe("queryByText", () => {
    scoped("should return element when text found", () =>
      Effect.gen(function* () {
        const result = yield* render(
          <div>
            <span>Found</span>
          </div>,
        );

        const found = yield* result.queryByText("Found");
        assert.isTrue(Option.isSome(found));
        if (Option.isSome(found)) {
          assert.strictEqual(found.value.tagName, "SPAN");
        }
      }),
    );

    scoped("should return Option.none when text not found", () =>
      Effect.gen(function* () {
        const result = yield* render(<div>Existing</div>);

        const found = yield* result.queryByText("Missing");
        assert.isTrue(Option.isNone(found));
      }),
    );
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // Scope: getByTestId query
  // ─────────────────────────────────────────────────────────────────────────────
  describe("getByTestId", () => {
    scoped("should find element by data-testid attribute", () =>
      Effect.gen(function* () {
        const result = yield* render(
          <div>
            <button data-testid="submit-btn">Submit</button>
          </div>,
        );

        const found = yield* result.getByTestId("submit-btn");
        assert.strictEqual(found.tagName, "BUTTON");
        assert.strictEqual(found.textContent, "Submit");
      }),
    );

    scoped("should fail with ElementNotFoundError when testid not found", () =>
      Effect.gen(function* () {
        const result = yield* render(<div>No testid</div>);

        const exit = yield* Effect.exit(result.getByTestId("missing"));
        assert.isTrue(Exit.isFailure(exit));
      }),
    );

    scoped("should find nested elements by testid", () =>
      Effect.gen(function* () {
        const result = yield* render(
          <div>
            <div>
              <div>
                <span data-testid="nested">Deep</span>
              </div>
            </div>
          </div>,
        );

        const found = yield* result.getByTestId("nested");
        assert.strictEqual(found.tagName, "SPAN");
        assert.strictEqual(found.textContent, "Deep");
      }),
    );
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // Scope: queryByTestId query
  // ─────────────────────────────────────────────────────────────────────────────
  describe("queryByTestId", () => {
    scoped("should return element when testid found", () =>
      Effect.gen(function* () {
        const result = yield* render(
          <div>
            <span data-testid="target">Found</span>
          </div>,
        );

        const found = yield* result.queryByTestId("target");
        assert.isTrue(Option.isSome(found));
        if (Option.isSome(found)) {
          assert.strictEqual(found.value.tagName, "SPAN");
        }
      }),
    );

    scoped("should return Option.none when testid not found", () =>
      Effect.gen(function* () {
        const result = yield* render(<div>No testid</div>);

        const found = yield* result.queryByTestId("missing");
        assert.isTrue(Option.isNone(found));
      }),
    );
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // Scope: getByRole query
  // ─────────────────────────────────────────────────────────────────────────────
  describe("getByRole", () => {
    scoped("should find element by explicit role attribute", () =>
      Effect.gen(function* () {
        const result = yield* render(
          <div>
            <div role="dialog">Modal</div>
          </div>,
        );

        const found = yield* result.getByRole("dialog");
        assert.strictEqual(found.textContent, "Modal");
      }),
    );

    scoped("should find button by implicit role", () =>
      Effect.gen(function* () {
        const result = yield* render(
          <div>
            <button>Click</button>
          </div>,
        );

        const found = yield* result.getByRole("button");
        assert.strictEqual(found.tagName, "BUTTON");
      }),
    );

    scoped("should find anchor by implicit link role", () =>
      Effect.gen(function* () {
        const result = yield* render(
          <div>
            <a href="/test">Link</a>
          </div>,
        );

        const found = yield* result.getByRole("link");
        assert.strictEqual(found.tagName, "A");
      }),
    );

    scoped("should find input by implicit textbox role", () =>
      Effect.gen(function* () {
        const result = yield* render(
          <div>
            <input type="text" />
          </div>,
        );

        const found = yield* result.getByRole("textbox");
        assert.strictEqual(found.tagName, "INPUT");
      }),
    );

    scoped("should find headings by implicit heading role", () =>
      Effect.gen(function* () {
        const result = yield* render(
          <div>
            <h1>Title</h1>
          </div>,
        );

        const found = yield* result.getByRole("heading");
        assert.strictEqual(found.tagName, "H1");
      }),
    );

    scoped("should find nav by implicit navigation role", () =>
      Effect.gen(function* () {
        const result = yield* render(
          <div>
            <nav>Navigation</nav>
          </div>,
        );

        const found = yield* result.getByRole("navigation");
        assert.strictEqual(found.tagName, "NAV");
      }),
    );

    scoped("should find main by implicit main role", () =>
      Effect.gen(function* () {
        const result = yield* render(
          <div>
            <main>Main content</main>
          </div>,
        );

        const found = yield* result.getByRole("main");
        assert.strictEqual(found.tagName, "MAIN");
      }),
    );

    scoped("should find list by implicit list role", () =>
      Effect.gen(function* () {
        const result = yield* render(
          <div>
            <ul></ul>
          </div>,
        );

        const found = yield* result.getByRole("list");
        assert.strictEqual(found.tagName, "UL");
      }),
    );

    scoped("should find list item by implicit listitem role", () =>
      Effect.gen(function* () {
        const result = yield* render(
          <div>
            <li>Item</li>
          </div>,
        );

        const found = yield* result.getByRole("listitem");
        assert.strictEqual(found.tagName, "LI");
      }),
    );

    scoped("should find table by implicit table role", () =>
      Effect.gen(function* () {
        const result = yield* render(
          <div>
            <table></table>
          </div>,
        );

        const found = yield* result.getByRole("table");
        assert.strictEqual(found.tagName, "TABLE");
      }),
    );

    scoped("should fail with ElementNotFoundError when role not found", () =>
      Effect.gen(function* () {
        const result = yield* render(<div>No role</div>);

        const exit = yield* Effect.exit(result.getByRole("button"));
        assert.isTrue(Exit.isFailure(exit));
      }),
    );
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // Scope: queryByRole query
  // ─────────────────────────────────────────────────────────────────────────────
  describe("queryByRole", () => {
    scoped("should return element when role found", () =>
      Effect.gen(function* () {
        const result = yield* render(
          <div>
            <button>Click</button>
          </div>,
        );

        const found = yield* result.queryByRole("button");
        assert.isTrue(Option.isSome(found));
        if (Option.isSome(found)) {
          assert.strictEqual(found.value.tagName, "BUTTON");
        }
      }),
    );

    scoped("should return Option.none when role not found", () =>
      Effect.gen(function* () {
        const result = yield* render(<div>No role</div>);

        const found = yield* result.queryByRole("button");
        assert.isTrue(Option.isNone(found));
      }),
    );
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // Scope: querySelector
  // ─────────────────────────────────────────────────────────────────────────────
  describe("querySelector", () => {
    scoped("should find element by CSS selector", () =>
      Effect.gen(function* () {
        const result = yield* render(
          <div>
            <span>Target</span>
          </div>,
        );

        const found = yield* result.querySelector("span");
        assert.strictEqual(found.textContent, "Target");
      }),
    );

    scoped("should find element by class selector", () =>
      Effect.gen(function* () {
        const result = yield* render(
          <div>
            <span className="highlight">Styled</span>
          </div>,
        );

        const found = yield* result.querySelector(".highlight");
        assert.strictEqual(found.textContent, "Styled");
      }),
    );

    scoped("should find element by id selector", () =>
      Effect.gen(function* () {
        const result = yield* render(
          <div>
            <span id="unique">Unique</span>
          </div>,
        );

        const found = yield* result.querySelector("#unique");
        assert.strictEqual(found.textContent, "Unique");
      }),
    );

    scoped("should find element by attribute selector", () =>
      Effect.gen(function* () {
        const result = yield* render(
          <div>
            <input type="email" />
          </div>,
        );

        const found = yield* result.querySelector("[type='email']");
        assert.strictEqual(found.tagName, "INPUT");
      }),
    );

    scoped("should find element by descendant selector", () =>
      Effect.gen(function* () {
        const result = yield* render(
          <div className="parent">
            <div className="child">
              <span>Descendant</span>
            </div>
          </div>,
        );

        const found = yield* result.querySelector(".parent .child span");
        assert.strictEqual(found.textContent, "Descendant");
      }),
    );

    scoped("should fail with ElementNotFoundError when selector matches nothing", () =>
      Effect.gen(function* () {
        const result = yield* render(<div>Content</div>);

        const exit = yield* Effect.exit(result.querySelector(".missing"));
        assert.isTrue(Exit.isFailure(exit));
      }),
    );
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // Scope: querySelectorAll
  // ─────────────────────────────────────────────────────────────────────────────
  describe("querySelectorAll", () => {
    scoped("should return all matching elements", () =>
      Effect.gen(function* () {
        const result = yield* render(
          <div>
            <span className="item">1</span>
            <span className="item">2</span>
            <span className="item">3</span>
          </div>,
        );

        const found = yield* result.querySelectorAll(".item");
        assert.strictEqual(found.length, 3);
        assert.strictEqual(found[0]?.textContent, "1");
        assert.strictEqual(found[1]?.textContent, "2");
        assert.strictEqual(found[2]?.textContent, "3");
      }),
    );

    scoped("should return empty array when no matches", () =>
      Effect.gen(function* () {
        const result = yield* render(<div>Content</div>);

        const found = yield* result.querySelectorAll(".missing");
        assert.strictEqual(found.length, 0);
      }),
    );

    scoped("should return ReadonlyArray", () =>
      Effect.gen(function* () {
        const result = yield* render(
          <div>
            <span>1</span>
          </div>,
        );

        const found = yield* result.querySelectorAll("span");
        assert.isArray(found);
      }),
    );
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // Scope: ElementNotFoundError
  // ─────────────────────────────────────────────────────────────────────────────
  describe("ElementNotFoundError", () => {
    it("should store query type and value", () => {
      const error = new ElementNotFoundError({ queryType: "text", query: "Hello World" });

      assert.strictEqual(error.queryType, "text");
      assert.strictEqual(error.query, "Hello World");
    });

    it("should have _tag property for pattern matching", () => {
      const error = new ElementNotFoundError({ queryType: "testId", query: "my-button" });

      assert.isTrue(Predicate.isTagged("ElementNotFoundError")(error));
    });

    it("should have correct error name", () => {
      const error = new ElementNotFoundError({ queryType: "role", query: "button" });

      assert.strictEqual(error.name, "ElementNotFoundError");
    });
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // Scope: click utility
  // ─────────────────────────────────────────────────────────────────────────────
  describe("click", () => {
    scoped("should trigger click event on element", () =>
      Effect.gen(function* () {
        let clicked = false;
        const result = yield* render(
          <div>
            <button data-testid="btn">Click</button>
          </div>,
        );

        const button = yield* result.getByTestId("btn");
        button.addEventListener("click", () => {
          clicked = true;
        });

        yield* click(button);

        assert.isTrue(clicked);
      }),
    );

    scoped("should trigger onclick handler on button", () =>
      Effect.gen(function* () {
        let handlerCalled = false;

        const result = yield* render(
          <div>
            <button data-testid="btn">Click</button>
          </div>,
        );

        const button = yield* result.getByTestId("btn");
        button.onclick = () => {
          handlerCalled = true;
        };

        yield* click(button);

        assert.isTrue(handlerCalled);
      }),
    );

    scoped("should trigger click on anchor element", () =>
      Effect.gen(function* () {
        let clicked = false;

        const result = yield* render(
          <div>
            <a href="#" data-testid="link">
              Link
            </a>
          </div>,
        );

        const link = yield* result.getByTestId("link");
        link.addEventListener("click", (e: Event) => {
          e.preventDefault();
          clicked = true;
        });

        yield* click(link);

        assert.isTrue(clicked);
      }),
    );

    scoped("should return Effect<void>", () =>
      Effect.gen(function* () {
        const result = yield* render(
          <div>
            <button data-testid="btn">Click</button>
          </div>,
        );

        const button = yield* result.getByTestId("btn");
        const clickResult = yield* click(button);

        assert.isUndefined(clickResult);
      }),
    );
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // Scope: type utility
  // ─────────────────────────────────────────────────────────────────────────────
  describe("type", () => {
    scoped("should set input value", () =>
      Effect.gen(function* () {
        const result = yield* render(
          <div>
            <input type="text" data-testid="input" />
          </div>,
        );

        const input = requireInputElement(yield* result.getByTestId("input"), "input");

        yield* type(input, "Hello World");

        assert.strictEqual(input.value, "Hello World");
      }),
    );

    scoped("should dispatch input event", () =>
      Effect.gen(function* () {
        let inputEventFired = false;

        const result = yield* render(
          <div>
            <input type="text" data-testid="input" />
          </div>,
        );

        const input = requireInputElement(yield* result.getByTestId("input"), "input");
        input.addEventListener("input", () => {
          inputEventFired = true;
        });

        yield* type(input, "Test");

        assert.isTrue(inputEventFired);
      }),
    );

    scoped("should dispatch change event", () =>
      Effect.gen(function* () {
        let changeEventFired = false;

        const result = yield* render(
          <div>
            <input type="text" data-testid="input" />
          </div>,
        );

        const input = requireInputElement(yield* result.getByTestId("input"), "input");
        input.addEventListener("change", () => {
          changeEventFired = true;
        });

        yield* type(input, "Test");

        assert.isTrue(changeEventFired);
      }),
    );

    scoped("should work with HTMLInputElement", () =>
      Effect.gen(function* () {
        const result = yield* render(
          <div>
            <input type="text" data-testid="input" />
          </div>,
        );

        const input = requireInputElement(yield* result.getByTestId("input"), "input");

        yield* type(input, "Input value");

        assert.strictEqual(input.value, "Input value");
      }),
    );

    scoped("should work with HTMLTextAreaElement", () =>
      Effect.gen(function* () {
        const result = yield* render(
          <div>
            <textarea data-testid="textarea"></textarea>
          </div>,
        );

        const textarea = requireTextAreaElement(yield* result.getByTestId("textarea"), "textarea");

        yield* type(textarea, "Textarea value");

        assert.strictEqual(textarea.value, "Textarea value");
      }),
    );

    scoped("should return Effect<void>", () =>
      Effect.gen(function* () {
        const result = yield* render(
          <div>
            <input type="text" data-testid="input" />
          </div>,
        );

        const input = requireInputElement(yield* result.getByTestId("input"), "input");
        const typeResult = yield* type(input, "Test");

        assert.isUndefined(typeResult);
      }),
    );
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // Scope: waitFor utility
  // ─────────────────────────────────────────────────────────────────────────────
  describe("waitFor", () => {
    scoped("should return immediately if condition true", () =>
      Effect.gen(function* () {
        const result = yield* waitFor(() => 42);

        assert.strictEqual(result, 42);
      }),
    );

    scoped("should wait for condition to become true", () =>
      Effect.gen(function* () {
        let attempts = 0;

        // Fork waitFor so we can advance time
        const fiber = yield* Effect.forkChild(
          waitFor(
            () => {
              attempts++;
              if (attempts < 3) failWaitFor("Not ready");
              return "done";
            },
            { interval: 20 },
          ),
        );

        // Advance time to allow retries
        yield* TestClock.adjust(100);

        const result = yield* Fiber.join(fiber);
        assert.strictEqual(result, "done");
      }),
    );

    scoped("should fail with WaitForTimeoutError on timeout", () =>
      Effect.gen(function* () {
        // Fork waitFor so we can advance time
        const fiber = yield* Effect.forkChild(
          waitFor(
            () => {
              failWaitFor("Always fails");
            },
            { timeout: 100, interval: 20 },
          ),
        );

        // Advance time past timeout
        yield* TestClock.adjust(200);

        const exit = yield* Fiber.await(fiber);
        assert.isTrue(Exit.isFailure(exit));
      }),
    );

    scoped("should respect custom timeout by retrying appropriate number of times", () =>
      Effect.gen(function* () {
        let checkCount = 0;

        // Fork waitFor so we can advance time
        const fiber = yield* Effect.forkChild(
          waitFor(
            () => {
              checkCount++;
              failWaitFor("Fails");
            },
            { timeout: 200, interval: 50 },
          ),
        );

        // Advance time past timeout
        yield* TestClock.adjust(300);

        yield* Fiber.await(fiber);

        // With timeout=200 and interval=50, should retry ~4 times (200/50)
        assert.isAtLeast(checkCount, 3);
        assert.isAtMost(checkCount, 6);
      }),
    );

    scoped("should check at custom interval", () =>
      Effect.gen(function* () {
        let checkCount = 0;

        // Fork waitFor so we can advance time
        const fiber = yield* Effect.forkChild(
          waitFor(
            () => {
              checkCount++;
              if (checkCount < 5) failWaitFor("Not ready");
              return true;
            },
            { interval: 20 },
          ),
        );

        // Advance time to allow retries
        yield* TestClock.adjust(200);

        yield* Fiber.join(fiber);
        assert.isAtLeast(checkCount, 5);
      }),
    );

    scoped("should retry when function throws", () =>
      Effect.gen(function* () {
        let attempts = 0;

        // Fork waitFor so we can advance time
        const fiber = yield* Effect.forkChild(
          waitFor(() => {
            attempts++;
            if (attempts < 3) failWaitFor("Not ready");
            return "success";
          }),
        );

        // Advance time to allow retries
        yield* TestClock.adjust(200);

        const result = yield* Fiber.join(fiber);
        assert.strictEqual(result, "success");
        assert.strictEqual(attempts, 3);
      }),
    );

    scoped("should return value from successful function call", () =>
      Effect.gen(function* () {
        const result = yield* waitFor(() => ({ data: "test" }));

        assert.deepStrictEqual(result, { data: "test" });
      }),
    );

    scoped("should include last error in timeout error", () =>
      Effect.gen(function* () {
        // Fork waitFor so we can advance time
        const fiber = yield* Effect.forkChild(
          waitFor(
            () => {
              failWaitFor("Custom error message");
            },
            { timeout: 100 },
          ),
        );

        // Advance time past timeout
        yield* TestClock.adjust(200);

        const exit = yield* Fiber.await(fiber);

        if (Exit.isFailure(exit)) {
          const error = Cause.squash(exit.cause);
          if (error instanceof WaitForTimeoutError) {
            assert.include(Cause.pretty(Cause.fail(error)), "Custom error message");
          }
        }
      }),
    );
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // Scope: WaitForTimeoutError
  // ─────────────────────────────────────────────────────────────────────────────
  describe("WaitForTimeoutError", () => {
    it("should include timeout duration in message", () => {
      const error = new WaitForTimeoutError({
        timeout: 1000,
        lastError: new TestWaitForError({ reason: "last" }),
      });

      assert.include(Cause.pretty(Cause.fail(error)), "1000ms");
    });

    it("should have _tag property for pattern matching", () => {
      const error = new WaitForTimeoutError({
        timeout: 500,
        lastError: new TestWaitForError({ reason: "test" }),
      });

      assert.isTrue(Predicate.isTagged("WaitForTimeoutError")(error));
    });

    it("should store lastError property", () => {
      const lastError = new TestWaitForError({ reason: "test error" });
      const error = new WaitForTimeoutError({ timeout: 500, lastError });

      assert.strictEqual(error.lastError, lastError);
    });

    it("should store timeout property", () => {
      const error = new WaitForTimeoutError({
        timeout: 750,
        lastError: new TestWaitForError({ reason: "test" }),
      });

      assert.strictEqual(error.timeout, 750);
    });
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // Scope: testLayer
  // ─────────────────────────────────────────────────────────────────────────────
  describe("testLayer", () => {
    scoped("should provide Renderer service", () =>
      Effect.gen(function* () {
        const renderer = yield* Renderer;

        assert.isDefined(renderer);
        assert.isDefined(renderer.mount);
      }).pipe(Effect.provide(testLayer)),
    );

    scoped("should be the browserLayer", () =>
      Effect.gen(function* () {
        const result = yield* renderElement(<div>Browser layer</div>).pipe(
          Effect.provide(testLayer),
        );

        assert.strictEqual(result.container.textContent, "Browser layer");
      }),
    );
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // Scope: RenderInput type
  // ─────────────────────────────────────────────────────────────────────────────
  describe("RenderInput type", () => {
    scoped("should accept Element type", () =>
      Effect.gen(function* () {
        const result = yield* render(<div>Element</div>);

        assert.strictEqual(result.container.textContent, "Element");
      }),
    );

    scoped("should accept Effect<Element>", () =>
      Effect.gen(function* () {
        const effect = Effect.succeed(<div>Effect</div>);
        const result = yield* render(effect);

        assert.strictEqual(result.container.textContent, "Effect");
      }),
    );
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // Scope: Integration scenarios
  // ─────────────────────────────────────────────────────────────────────────────
  describe("Integration", () => {
    scoped("should support render -> query -> interact workflow", () =>
      Effect.gen(function* () {
        let value = 0;

        const result = yield* render(
          <div>
            <button data-testid="increment">Add</button>
            <span data-testid="display">0</span>
          </div>,
        );

        const button = yield* result.getByTestId("increment");
        const display = yield* result.getByTestId("display");

        button.addEventListener("click", () => {
          value++;
          display.textContent = String(value);
        });

        yield* click(button);
        yield* click(button);
        yield* click(button);

        assert.strictEqual(display.textContent, "3");
      }),
    );

    scoped("should support async state updates with waitFor", () =>
      Effect.gen(function* () {
        const result = yield* render(
          <div>
            <div data-testid="status">loading</div>
          </div>,
        );

        const status = yield* result.getByTestId("status");
        let checkCount = 0;

        // Fork waitFor and a delayed update
        const fiber = yield* Effect.forkChild(
          waitFor(() => {
            checkCount++;
            // Simulate: status becomes ready after a few checks
            if (checkCount >= 3) {
              status.textContent = "ready";
            }
            if (status.textContent !== "ready") failWaitFor("Not ready");
            return status.textContent;
          }),
        );

        // Advance time to allow retries
        yield* TestClock.adjust(200);

        const text = yield* Fiber.join(fiber);
        assert.strictEqual(text, "ready");
      }),
    );

    scoped("should support multiple query types on same render", () =>
      Effect.gen(function* () {
        const result = yield* render(
          <div>
            <button data-testid="btn" className="primary">
              Submit
            </button>
          </div>,
        );

        const byText = yield* result.getByText("Submit");
        const byTestId = yield* result.getByTestId("btn");
        const byRole = yield* result.getByRole("button");
        const bySelector = yield* result.querySelector(".primary");

        assert.strictEqual(byText, byTestId);
        assert.strictEqual(byTestId, byRole);
        assert.strictEqual(byRole, bySelector);
      }),
    );

    scoped("should isolate renders between tests", () =>
      Effect.gen(function* () {
        const result1 = yield* render(<div id="isolated-1">First</div>);
        const result2 = yield* render(<div id="isolated-2">Second</div>);

        assert.isNull(result1.container.querySelector("#isolated-2"));
        assert.isNull(result2.container.querySelector("#isolated-1"));
      }),
    );
  });
});
