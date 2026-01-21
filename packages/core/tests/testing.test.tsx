/**
 * Tests for testing utilities
 * @module
 */
import { assert, describe, it } from "@effect/vitest";
import { Effect, Exit, Scope, TestClock } from "effect";
import {
  click,
  ElementNotFoundError,
  render,
  renderElement,
  testLayer,
  type,
  waitFor,
  WaitForTimeoutError,
} from "../src/testing.js";
import * as Signal from "../src/signal.js";
import { Renderer } from "../src/renderer.js";

describe("Testing Utilities", () => {
  // ─────────────────────────────────────────────────────────────────────────────
  // Scope: TestRenderResult interface
  // ─────────────────────────────────────────────────────────────────────────────
  describe("TestRenderResult", () => {
    it.scoped("should expose the container element", () =>
      Effect.gen(function* () {
        const result = yield* renderElement(<div>Hello</div>).pipe(Effect.provide(testLayer));

        assert.instanceOf(result.container, HTMLDivElement);
      }),
    );

    it.scoped("should set data-testid on container", () =>
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
    it.scoped("should render a simple element to the DOM", () =>
      Effect.gen(function* () {
        const result = yield* renderElement(<div>Hello</div>).pipe(Effect.provide(testLayer));

        assert.strictEqual(result.container.textContent, "Hello");
      }),
    );

    it.scoped("should render element with children", () =>
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

    it.scoped("should render element with attributes", () =>
      Effect.gen(function* () {
        const result = yield* renderElement(<div className="test-class" id="test-id" />).pipe(
          Effect.provide(testLayer),
        );

        const div = result.container.querySelector("div");
        assert.strictEqual(div?.className, "test-class");
        assert.strictEqual(div?.id, "test-id");
      }),
    );

    it.scoped("should remove container when scope closes", () =>
      Effect.gen(function* () {
        const scope = yield* Scope.make();

        yield* renderElement(<div id="scoped-element">Content</div>).pipe(
          Effect.provide(testLayer),
          Scope.extend(scope),
        );

        const elementInDom = document.querySelector("#scoped-element");
        assert.isNotNull(elementInDom);

        yield* Scope.close(scope, Exit.void);

        const elementAfterClose = document.querySelector("#scoped-element");
        assert.isNull(elementAfterClose);
      }),
    );

    it.scoped("should require Renderer service", () =>
      Effect.gen(function* () {
        // This test verifies that renderElement requires Renderer service
        // We can verify this by checking the effect runs successfully WITH testLayer
        const result = yield* renderElement(<div>Hello</div>).pipe(Effect.provide(testLayer));
        assert.isNotNull(result.container);
        // Type system ensures Renderer is required - compile-time verification
      }),
    );

    it.scoped("should create separate containers for multiple renders", () =>
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
    it.scoped("should render a static Element", () =>
      Effect.gen(function* () {
        const result = yield* render(<div>Static content</div>);

        assert.strictEqual(result.container.textContent, "Static content");
      }),
    );

    it.scoped("should render an Effect that produces Element", () =>
      Effect.gen(function* () {
        const componentEffect = Effect.succeed(<div>From Effect</div>);
        const result = yield* render(componentEffect);

        assert.strictEqual(result.container.textContent, "From Effect");
      }),
    );

    it.scoped("should wrap Effect in Component element", () =>
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

    it.scoped("should provide testLayer automatically", () =>
      Effect.gen(function* () {
        const result = yield* render(<div>Auto provided</div>);

        assert.strictEqual(result.container.textContent, "Auto provided");
      }),
    );

    it.scoped("should use scope from test context", () =>
      Effect.gen(function* () {
        yield* render(<div id="scope-test">Scoped</div>);

        const found = document.querySelector("#scope-test");
        assert.isNotNull(found);
      }),
    );

    it.scoped("should support reactive updates in components", () =>
      Effect.gen(function* () {
        const count = Signal.unsafeMake(0);

        const component = Effect.gen(function* () {
          const value = yield* Signal.get(count);
          return <div data-testid="counter">{String(value)}</div>;
        });

        const result = yield* render(component);

        assert.strictEqual(result.getByTestId("counter").textContent, "0");

        yield* Signal.set(count, 5);
        yield* TestClock.adjust(10);

        assert.strictEqual(result.getByTestId("counter").textContent, "5");
      }),
    );
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // Scope: getByText query
  // ─────────────────────────────────────────────────────────────────────────────
  describe("getByText", () => {
    it.scoped("should find element by exact text content", () =>
      Effect.gen(function* () {
        const result = yield* render(
          <div>
            <span>Hello World</span>
          </div>,
        );

        const found = result.getByText("Hello World");
        assert.strictEqual(found.tagName, "SPAN");
      }),
    );

    it.scoped("should find leaf element with text", () =>
      Effect.gen(function* () {
        const result = yield* render(
          <div>
            <p>
              <span>Nested</span>
            </p>
          </div>,
        );

        const found = result.getByText("Nested");
        assert.strictEqual(found.tagName, "SPAN");
      }),
    );

    it.scoped("should find element with direct text node among children", () =>
      Effect.gen(function* () {
        const result = yield* render(
          <div>
            <p>
              Direct text<span></span>
            </p>
          </div>,
        );

        const found = result.getByText("Direct text");
        assert.strictEqual(found.tagName, "P");
      }),
    );

    it.scoped("should throw ElementNotFoundError when text not found", () =>
      Effect.gen(function* () {
        const result = yield* render(<div>Existing</div>);

        assert.throws(() => result.getByText("Not found"), ElementNotFoundError);
      }),
    );

    it.scoped("should not match partial text", () =>
      Effect.gen(function* () {
        const result = yield* render(
          <div>
            <span>Hello World</span>
          </div>,
        );

        assert.throws(() => result.getByText("Hello"), ElementNotFoundError);
      }),
    );

    it.scoped("should trim whitespace when matching text", () =>
      Effect.gen(function* () {
        const result = yield* render(
          <div>
            <span> Trimmed </span>
          </div>,
        );

        const found = result.getByText("Trimmed");
        assert.strictEqual(found.tagName, "SPAN");
      }),
    );
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // Scope: queryByText query
  // ─────────────────────────────────────────────────────────────────────────────
  describe("queryByText", () => {
    it.scoped("should return element when text found", () =>
      Effect.gen(function* () {
        const result = yield* render(
          <div>
            <span>Found</span>
          </div>,
        );

        const found = result.queryByText("Found");
        assert.isNotNull(found);
        assert.strictEqual(found?.tagName, "SPAN");
      }),
    );

    it.scoped("should return null when text not found", () =>
      Effect.gen(function* () {
        const result = yield* render(<div>Existing</div>);

        const found = result.queryByText("Missing");
        assert.isNull(found);
      }),
    );
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // Scope: getByTestId query
  // ─────────────────────────────────────────────────────────────────────────────
  describe("getByTestId", () => {
    it.scoped("should find element by data-testid attribute", () =>
      Effect.gen(function* () {
        const result = yield* render(
          <div>
            <button data-testid="submit-btn">Submit</button>
          </div>,
        );

        const found = result.getByTestId("submit-btn");
        assert.strictEqual(found.tagName, "BUTTON");
        assert.strictEqual(found.textContent, "Submit");
      }),
    );

    it.scoped("should throw ElementNotFoundError when testid not found", () =>
      Effect.gen(function* () {
        const result = yield* render(<div>No testid</div>);

        assert.throws(() => result.getByTestId("missing"), ElementNotFoundError);
      }),
    );

    it.scoped("should find nested elements by testid", () =>
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

        const found = result.getByTestId("nested");
        assert.strictEqual(found.tagName, "SPAN");
        assert.strictEqual(found.textContent, "Deep");
      }),
    );
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // Scope: queryByTestId query
  // ─────────────────────────────────────────────────────────────────────────────
  describe("queryByTestId", () => {
    it.scoped("should return element when testid found", () =>
      Effect.gen(function* () {
        const result = yield* render(
          <div>
            <span data-testid="target">Found</span>
          </div>,
        );

        const found = result.queryByTestId("target");
        assert.isNotNull(found);
        assert.strictEqual(found?.tagName, "SPAN");
      }),
    );

    it.scoped("should return null when testid not found", () =>
      Effect.gen(function* () {
        const result = yield* render(<div>No testid</div>);

        const found = result.queryByTestId("missing");
        assert.isNull(found);
      }),
    );
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // Scope: getByRole query
  // ─────────────────────────────────────────────────────────────────────────────
  describe("getByRole", () => {
    it.scoped("should find element by explicit role attribute", () =>
      Effect.gen(function* () {
        const result = yield* render(
          <div>
            <div role="dialog">Modal</div>
          </div>,
        );

        const found = result.getByRole("dialog");
        assert.strictEqual(found.textContent, "Modal");
      }),
    );

    it.scoped("should find button by implicit role", () =>
      Effect.gen(function* () {
        const result = yield* render(
          <div>
            <button>Click</button>
          </div>,
        );

        const found = result.getByRole("button");
        assert.strictEqual(found.tagName, "BUTTON");
      }),
    );

    it.scoped("should find anchor by implicit link role", () =>
      Effect.gen(function* () {
        const result = yield* render(
          <div>
            <a href="/test">Link</a>
          </div>,
        );

        const found = result.getByRole("link");
        assert.strictEqual(found.tagName, "A");
      }),
    );

    it.scoped("should find input by implicit textbox role", () =>
      Effect.gen(function* () {
        const result = yield* render(
          <div>
            <input type="text" />
          </div>,
        );

        const found = result.getByRole("textbox");
        assert.strictEqual(found.tagName, "INPUT");
      }),
    );

    it.scoped("should find headings by implicit heading role", () =>
      Effect.gen(function* () {
        const result = yield* render(
          <div>
            <h1>Title</h1>
          </div>,
        );

        const found = result.getByRole("heading");
        assert.strictEqual(found.tagName, "H1");
      }),
    );

    it.scoped("should find nav by implicit navigation role", () =>
      Effect.gen(function* () {
        const result = yield* render(
          <div>
            <nav>Navigation</nav>
          </div>,
        );

        const found = result.getByRole("navigation");
        assert.strictEqual(found.tagName, "NAV");
      }),
    );

    it.scoped("should find main by implicit main role", () =>
      Effect.gen(function* () {
        const result = yield* render(
          <div>
            <main>Main content</main>
          </div>,
        );

        const found = result.getByRole("main");
        assert.strictEqual(found.tagName, "MAIN");
      }),
    );

    it.scoped("should find list by implicit list role", () =>
      Effect.gen(function* () {
        const result = yield* render(
          <div>
            <ul></ul>
          </div>,
        );

        const found = result.getByRole("list");
        assert.strictEqual(found.tagName, "UL");
      }),
    );

    it.scoped("should find list item by implicit listitem role", () =>
      Effect.gen(function* () {
        const result = yield* render(
          <div>
            <li>Item</li>
          </div>,
        );

        const found = result.getByRole("listitem");
        assert.strictEqual(found.tagName, "LI");
      }),
    );

    it.scoped("should find table by implicit table role", () =>
      Effect.gen(function* () {
        const result = yield* render(
          <div>
            <table></table>
          </div>,
        );

        const found = result.getByRole("table");
        assert.strictEqual(found.tagName, "TABLE");
      }),
    );

    it.scoped("should throw ElementNotFoundError when role not found", () =>
      Effect.gen(function* () {
        const result = yield* render(<div>No role</div>);

        assert.throws(() => result.getByRole("button"), ElementNotFoundError);
      }),
    );
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // Scope: queryByRole query
  // ─────────────────────────────────────────────────────────────────────────────
  describe("queryByRole", () => {
    it.scoped("should return element when role found", () =>
      Effect.gen(function* () {
        const result = yield* render(
          <div>
            <button>Click</button>
          </div>,
        );

        const found = result.queryByRole("button");
        assert.isNotNull(found);
        assert.strictEqual(found?.tagName, "BUTTON");
      }),
    );

    it.scoped("should return null when role not found", () =>
      Effect.gen(function* () {
        const result = yield* render(<div>No role</div>);

        const found = result.queryByRole("button");
        assert.isNull(found);
      }),
    );
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // Scope: querySelector
  // ─────────────────────────────────────────────────────────────────────────────
  describe("querySelector", () => {
    it.scoped("should find element by CSS selector", () =>
      Effect.gen(function* () {
        const result = yield* render(
          <div>
            <span>Target</span>
          </div>,
        );

        const found = result.querySelector("span");
        assert.strictEqual(found.textContent, "Target");
      }),
    );

    it.scoped("should find element by class selector", () =>
      Effect.gen(function* () {
        const result = yield* render(
          <div>
            <span className="highlight">Styled</span>
          </div>,
        );

        const found = result.querySelector(".highlight");
        assert.strictEqual(found.textContent, "Styled");
      }),
    );

    it.scoped("should find element by id selector", () =>
      Effect.gen(function* () {
        const result = yield* render(
          <div>
            <span id="unique">Unique</span>
          </div>,
        );

        const found = result.querySelector("#unique");
        assert.strictEqual(found.textContent, "Unique");
      }),
    );

    it.scoped("should find element by attribute selector", () =>
      Effect.gen(function* () {
        const result = yield* render(
          <div>
            <input type="email" />
          </div>,
        );

        const found = result.querySelector("[type='email']");
        assert.strictEqual(found.tagName, "INPUT");
      }),
    );

    it.scoped("should find element by descendant selector", () =>
      Effect.gen(function* () {
        const result = yield* render(
          <div className="parent">
            <div className="child">
              <span>Descendant</span>
            </div>
          </div>,
        );

        const found = result.querySelector(".parent .child span");
        assert.strictEqual(found.textContent, "Descendant");
      }),
    );

    it.scoped("should throw ElementNotFoundError when selector matches nothing", () =>
      Effect.gen(function* () {
        const result = yield* render(<div>Content</div>);

        assert.throws(() => result.querySelector(".missing"), ElementNotFoundError);
      }),
    );
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // Scope: querySelectorAll
  // ─────────────────────────────────────────────────────────────────────────────
  describe("querySelectorAll", () => {
    it.scoped("should return all matching elements", () =>
      Effect.gen(function* () {
        const result = yield* render(
          <div>
            <span className="item">1</span>
            <span className="item">2</span>
            <span className="item">3</span>
          </div>,
        );

        const found = result.querySelectorAll(".item");
        assert.strictEqual(found.length, 3);
        assert.strictEqual(found[0]?.textContent, "1");
        assert.strictEqual(found[1]?.textContent, "2");
        assert.strictEqual(found[2]?.textContent, "3");
      }),
    );

    it.scoped("should return empty array when no matches", () =>
      Effect.gen(function* () {
        const result = yield* render(<div>Content</div>);

        const found = result.querySelectorAll(".missing");
        assert.strictEqual(found.length, 0);
      }),
    );

    it.scoped("should return ReadonlyArray", () =>
      Effect.gen(function* () {
        const result = yield* render(
          <div>
            <span>1</span>
          </div>,
        );

        const found = result.querySelectorAll("span");
        assert.isArray(found);
      }),
    );
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // Scope: ElementNotFoundError
  // ─────────────────────────────────────────────────────────────────────────────
  describe("ElementNotFoundError", () => {
    it("should include query type and value in message", () => {
      const error = new ElementNotFoundError("text", "Hello World");

      assert.include(error.message, "text");
      assert.include(error.message, "Hello World");
    });

    it("should have _tag property for pattern matching", () => {
      const error = new ElementNotFoundError("testId", "my-button");

      assert.strictEqual(error._tag, "ElementNotFoundError");
    });

    it("should have correct error name", () => {
      const error = new ElementNotFoundError("role", "button");

      assert.strictEqual(error.name, "ElementNotFoundError");
    });
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // Scope: click utility
  // ─────────────────────────────────────────────────────────────────────────────
  describe("click", () => {
    it.scoped("should trigger click event on element", () =>
      Effect.gen(function* () {
        let clicked = false;
        const result = yield* render(
          <div>
            <button data-testid="btn">Click</button>
          </div>,
        );

        const button = result.getByTestId("btn");
        button.addEventListener("click", () => {
          clicked = true;
        });

        yield* click(button);

        assert.isTrue(clicked);
      }),
    );

    it.scoped("should trigger onclick handler on button", () =>
      Effect.gen(function* () {
        let handlerCalled = false;

        const result = yield* render(
          <div>
            <button data-testid="btn">Click</button>
          </div>,
        );

        const button = result.getByTestId("btn");
        button.onclick = () => {
          handlerCalled = true;
        };

        yield* click(button);

        assert.isTrue(handlerCalled);
      }),
    );

    it.scoped("should trigger click on anchor element", () =>
      Effect.gen(function* () {
        let clicked = false;

        const result = yield* render(
          <div>
            <a href="#" data-testid="link">
              Link
            </a>
          </div>,
        );

        const link = result.getByTestId("link");
        link.addEventListener("click", (e) => {
          e.preventDefault();
          clicked = true;
        });

        yield* click(link);

        assert.isTrue(clicked);
      }),
    );

    it.scoped("should return Effect<void>", () =>
      Effect.gen(function* () {
        const result = yield* render(
          <div>
            <button data-testid="btn">Click</button>
          </div>,
        );

        const button = result.getByTestId("btn");
        const clickResult = yield* click(button);

        assert.isUndefined(clickResult);
      }),
    );
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // Scope: type utility
  // ─────────────────────────────────────────────────────────────────────────────
  describe("type", () => {
    it.scoped("should set input value", () =>
      Effect.gen(function* () {
        const result = yield* render(
          <div>
            <input type="text" data-testid="input" />
          </div>,
        );

        const input = result.getByTestId("input") as HTMLInputElement;

        yield* type(input, "Hello World");

        assert.strictEqual(input.value, "Hello World");
      }),
    );

    it.scoped("should dispatch input event", () =>
      Effect.gen(function* () {
        let inputEventFired = false;

        const result = yield* render(
          <div>
            <input type="text" data-testid="input" />
          </div>,
        );

        const input = result.getByTestId("input") as HTMLInputElement;
        input.addEventListener("input", () => {
          inputEventFired = true;
        });

        yield* type(input, "Test");

        assert.isTrue(inputEventFired);
      }),
    );

    it.scoped("should dispatch change event", () =>
      Effect.gen(function* () {
        let changeEventFired = false;

        const result = yield* render(
          <div>
            <input type="text" data-testid="input" />
          </div>,
        );

        const input = result.getByTestId("input") as HTMLInputElement;
        input.addEventListener("change", () => {
          changeEventFired = true;
        });

        yield* type(input, "Test");

        assert.isTrue(changeEventFired);
      }),
    );

    it.scoped("should work with HTMLInputElement", () =>
      Effect.gen(function* () {
        const result = yield* render(
          <div>
            <input type="text" data-testid="input" />
          </div>,
        );

        const input = result.getByTestId("input") as HTMLInputElement;

        yield* type(input, "Input value");

        assert.strictEqual(input.value, "Input value");
      }),
    );

    it.scoped("should work with HTMLTextAreaElement", () =>
      Effect.gen(function* () {
        const result = yield* render(
          <div>
            <textarea data-testid="textarea"></textarea>
          </div>,
        );

        const textarea = result.getByTestId("textarea") as HTMLTextAreaElement;

        yield* type(textarea, "Textarea value");

        assert.strictEqual(textarea.value, "Textarea value");
      }),
    );

    it.scoped("should return Effect<void>", () =>
      Effect.gen(function* () {
        const result = yield* render(
          <div>
            <input type="text" data-testid="input" />
          </div>,
        );

        const input = result.getByTestId("input") as HTMLInputElement;
        const typeResult = yield* type(input, "Test");

        assert.isUndefined(typeResult);
      }),
    );
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // Scope: waitFor utility
  // ─────────────────────────────────────────────────────────────────────────────
  describe("waitFor", () => {
    it.scoped("should return immediately if condition true", () =>
      Effect.gen(function* () {
        const result = yield* waitFor(() => 42);

        assert.strictEqual(result, 42);
      }),
    );

    it.scoped("should wait for condition to become true", () =>
      Effect.gen(function* () {
        let value = false;
        setTimeout(() => {
          value = true;
        }, 50);

        const result = yield* waitFor(() => {
          if (!value) throw new Error("Not ready");
          return "done";
        });

        assert.strictEqual(result, "done");
      }),
    );

    it.scoped("should fail with WaitForTimeoutError on timeout", () =>
      Effect.gen(function* () {
        const exit = yield* Effect.exit(
          waitFor(
            () => {
              throw new Error("Always fails");
            },
            { timeout: 100, interval: 20 },
          ),
        );

        assert.isTrue(exit._tag === "Failure");
      }),
    );

    it.scoped("should respect custom timeout option", () =>
      Effect.gen(function* () {
        const start = Date.now();

        yield* Effect.exit(
          waitFor(
            () => {
              throw new Error("Fails");
            },
            { timeout: 200 },
          ),
        );

        const elapsed = Date.now() - start;
        assert.isAtLeast(elapsed, 150);
      }),
    );

    it.scoped("should check at custom interval", () =>
      Effect.gen(function* () {
        let checkCount = 0;
        let ready = false;

        setTimeout(() => {
          ready = true;
        }, 100);

        yield* waitFor(
          () => {
            checkCount++;
            if (!ready) throw new Error("Not ready");
            return true;
          },
          { interval: 20 },
        );

        assert.isAtLeast(checkCount, 2);
      }),
    );

    it.scoped("should retry when function throws", () =>
      Effect.gen(function* () {
        let attempts = 0;

        const result = yield* waitFor(() => {
          attempts++;
          if (attempts < 3) throw new Error("Not ready");
          return "success";
        });

        assert.strictEqual(result, "success");
        assert.strictEqual(attempts, 3);
      }),
    );

    it.scoped("should return value from successful function call", () =>
      Effect.gen(function* () {
        const result = yield* waitFor(() => ({ data: "test" }));

        assert.deepStrictEqual(result, { data: "test" });
      }),
    );

    it.scoped("should include last error in timeout error", () =>
      Effect.gen(function* () {
        const exit = yield* Effect.exit(
          waitFor(
            () => {
              throw new Error("Custom error message");
            },
            { timeout: 100 },
          ),
        );

        if (exit._tag === "Failure") {
          const error = exit.cause._tag === "Fail" ? exit.cause.error : null;
          if (error instanceof WaitForTimeoutError) {
            assert.include(error.message, "Custom error message");
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
      const error = new WaitForTimeoutError(1000, new Error("last"));

      assert.include(error.message, "1000ms");
    });

    it("should have _tag property for pattern matching", () => {
      const error = new WaitForTimeoutError(500, new Error("test"));

      assert.strictEqual(error._tag, "WaitForTimeoutError");
    });

    it("should store lastError property", () => {
      const lastError = new Error("test error");
      const error = new WaitForTimeoutError(500, lastError);

      assert.strictEqual(error.lastError, lastError);
    });

    it("should store timeout property", () => {
      const error = new WaitForTimeoutError(750, new Error("test"));

      assert.strictEqual(error.timeout, 750);
    });
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // Scope: testLayer
  // ─────────────────────────────────────────────────────────────────────────────
  describe("testLayer", () => {
    it.scoped("should provide Renderer service", () =>
      Effect.gen(function* () {
        const renderer = yield* Renderer;

        assert.isDefined(renderer);
        assert.isDefined(renderer.mount);
      }).pipe(Effect.provide(testLayer)),
    );

    it.scoped("should be the browserLayer", () =>
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
    it.scoped("should accept Element type", () =>
      Effect.gen(function* () {
        const result = yield* render(<div>Element</div>);

        assert.strictEqual(result.container.textContent, "Element");
      }),
    );

    it.scoped("should accept Effect<Element>", () =>
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
    it.scoped("should support render -> query -> interact workflow", () =>
      Effect.gen(function* () {
        let value = 0;

        const result = yield* render(
          <div>
            <button data-testid="increment">Add</button>
            <span data-testid="display">0</span>
          </div>,
        );

        const button = result.getByTestId("increment");
        const display = result.getByTestId("display");

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

    it.scoped("should support async state updates with waitFor", () =>
      Effect.gen(function* () {
        const result = yield* render(
          <div>
            <div data-testid="status">loading</div>
          </div>,
        );

        const status = result.getByTestId("status");

        setTimeout(() => {
          status.textContent = "ready";
        }, 50);

        yield* waitFor(() => {
          if (status.textContent !== "ready") throw new Error("Not ready");
          return status.textContent;
        });

        assert.strictEqual(status.textContent, "ready");
      }),
    );

    it.scoped("should support multiple query types on same render", () =>
      Effect.gen(function* () {
        const result = yield* render(
          <div>
            <button data-testid="btn" className="primary">
              Submit
            </button>
          </div>,
        );

        const byText = result.getByText("Submit");
        const byTestId = result.getByTestId("btn");
        const byRole = result.getByRole("button");
        const bySelector = result.querySelector(".primary");

        assert.strictEqual(byText, byTestId);
        assert.strictEqual(byTestId, byRole);
        assert.strictEqual(byRole, bySelector);
      }),
    );

    it.scoped("should isolate renders between tests", () =>
      Effect.gen(function* () {
        const result1 = yield* render(<div id="isolated-1">First</div>);
        const result2 = yield* render(<div id="isolated-2">Second</div>);

        assert.isNull(result1.container.querySelector("#isolated-2"));
        assert.isNull(result2.container.querySelector("#isolated-1"));
      }),
    );
  });
});
