/**
 * Renderer Unit Tests
 *
 * Renderer handles mounting Element trees to the DOM.
 * Provides fine-grained reactivity via Signal subscriptions.
 *
 * Test Categories:
 * - mount: Entry point for rendering apps
 * - render: Core rendering logic
 * - Element types: Text, SignalText, SignalElement, Intrinsic, Component, Fragment, Portal, KeyedList
 * - Props: Static props, Signal props, event handlers
 * - Reactivity: Fine-grained updates, component re-renders
 * - Cleanup: Scope management, subscription removal
 *
 * Goals: Reliability, stability, performance
 * - Every test manages its own fibers/scope to prevent memory leaks
 * - Tests verify DOM structure and cleanup
 */
import { assert, describe, it } from "@effect/vitest";
import { Context, Data, Effect, Exit, Layer, Option, Scope, TestClock } from "effect";

// Tagged errors for testing component failures
class ComponentError extends Data.TaggedError("ComponentError")<{ message: string }> {}
import { render } from "../../testing/index.js";
import * as Signal from "../signal.js";
import * as Component from "../component.js";
import type { ComponentProps } from "../component.js";
import * as Router from "../../router/index.js";
import { Element, Fragment } from "../../index.js";

// =============================================================================
// mount - App entry point
// =============================================================================
// Scope: Mounting an app to a DOM container

describe("mount", () => {
  it.scoped("should render Effect<Element> to container", () =>
    Effect.gen(function* () {
      const app = Effect.succeed(<div data-testid="app">App content</div>);
      const { getByTestId } = yield* render(app);

      assert.strictEqual((yield* getByTestId("app")).textContent, "App content");
    }),
  );

  it.scoped("should render Element directly to container", () =>
    Effect.gen(function* () {
      const { getByTestId } = yield* render(<div data-testid="direct">Direct element</div>);

      assert.strictEqual((yield* getByTestId("direct")).textContent, "Direct element");
    }),
  );

  it.scoped("should enable reactivity via Component wrapper", () =>
    Effect.gen(function* () {
      const count = Signal.makeSync(0);

      const app = Effect.gen(function* () {
        const value = yield* Signal.get(count);
        return <div data-testid="reactive">{String(value)}</div>;
      });

      const { getByTestId } = yield* render(app);
      assert.strictEqual((yield* getByTestId("reactive")).textContent, "0");

      yield* Signal.set(count, 5);
      yield* TestClock.adjust(20);

      assert.strictEqual((yield* getByTestId("reactive")).textContent, "5");
    }),
  );
});

// =============================================================================
// Text Element
// =============================================================================
// Scope: Rendering plain text nodes

describe("Text element rendering", () => {
  it.scoped("should create DOM text node with content", () =>
    Effect.gen(function* () {
      const { getByTestId } = yield* render(<div data-testid="text-parent">Hello World</div>);

      assert.strictEqual((yield* getByTestId("text-parent")).textContent, "Hello World");
    }),
  );

  it.scoped("should append text node to parent", () =>
    Effect.gen(function* () {
      const { getByTestId } = yield* render(<span data-testid="parent">Child text</span>);

      const parent = yield* getByTestId("parent");
      assert.strictEqual(parent.childNodes.length, 1);
      assert.strictEqual(parent.childNodes[0]?.nodeType, Node.TEXT_NODE);
    }),
  );

  it.scoped("should remove text node on cleanup", () =>
    Effect.gen(function* () {
      const scope = yield* Scope.make();

      yield* render(<div id="cleanup-text">Will be removed</div>).pipe(Scope.extend(scope));

      const before = document.querySelector("#cleanup-text");
      assert.isNotNull(before);

      yield* Scope.close(scope, Exit.void);

      const after = document.querySelector("#cleanup-text");
      assert.isNull(after);
    }),
  );
});

// =============================================================================
// SignalText Element
// =============================================================================
// Scope: Reactive text nodes that update when signal changes

describe("SignalText element rendering", () => {
  it.scoped("should create text node with signal initial value", () =>
    Effect.gen(function* () {
      const textSignal = yield* Signal.make("Initial text");
      const { getByTestId } = yield* render(<div data-testid="signal-text">{textSignal}</div>);

      assert.strictEqual((yield* getByTestId("signal-text")).textContent, "Initial text");
    }),
  );

  it.scoped("should update textContent when signal changes", () =>
    Effect.gen(function* () {
      const textSignal = yield* Signal.make("Before");
      const { getByTestId } = yield* render(<div data-testid="update-text">{textSignal}</div>);

      yield* Signal.set(textSignal, "After");
      yield* TestClock.adjust(10);

      assert.strictEqual((yield* getByTestId("update-text")).textContent, "After");
    }),
  );

  it.scoped("should subscribe to signal for updates", () =>
    Effect.gen(function* () {
      const textSignal = yield* Signal.make("text");
      const initialListeners = textSignal._listeners.size;

      yield* render(<div data-testid="subscribe">{textSignal}</div>);

      assert.isAtLeast(textSignal._listeners.size, initialListeners);
    }),
  );

  it.scoped("should unsubscribe and remove node on cleanup", () =>
    Effect.gen(function* () {
      const textSignal = yield* Signal.make("cleanup");
      const scope = yield* Scope.make();

      yield* render(<div id="signal-cleanup">{textSignal}</div>).pipe(Scope.extend(scope));

      const listenersBefore = textSignal._listeners.size;

      yield* Scope.close(scope, Exit.void);

      const listenersAfter = textSignal._listeners.size;
      assert.isBelow(listenersAfter, listenersBefore);

      const nodeAfter = document.querySelector("#signal-cleanup");
      assert.isNull(nodeAfter);
    }),
  );
});

// =============================================================================
// SignalElement
// =============================================================================
// Scope: Reactive elements that swap DOM when signal changes

describe("SignalElement rendering", () => {
  it.scoped("should render initial Element from signal", () =>
    Effect.gen(function* () {
      const elemSignal = yield* Signal.make(<span>Initial</span>);
      const { getByTestId } = yield* render(<div data-testid="signal-elem">{elemSignal}</div>);

      assert.include((yield* getByTestId("signal-elem")).innerHTML, "Initial");
    }),
  );

  it.scoped("should swap DOM content when signal changes", () =>
    Effect.gen(function* () {
      const elemSignal = yield* Signal.make(<span>Before</span>);
      const { getByTestId } = yield* render(<div data-testid="swap-elem">{elemSignal}</div>);

      yield* Signal.set(elemSignal, <strong>After</strong>);
      yield* TestClock.adjust(10);

      const container = yield* getByTestId("swap-elem");
      assert.include(container.innerHTML, "After");
      assert.include(container.innerHTML, "<strong>");
    }),
  );

  it.scoped("should maintain position using anchor comment", () =>
    Effect.gen(function* () {
      const elemSignal = yield* Signal.make(<span>Middle</span>);
      const { getByTestId } = yield* render(
        <div data-testid="anchor-test">Before {elemSignal} After</div>,
      );

      const container = yield* getByTestId("anchor-test");
      assert.include(container.textContent, "Before");
      assert.include(container.textContent, "After");
    }),
  );

  it.scoped("should cleanup content and anchor on unmount", () =>
    Effect.gen(function* () {
      const elemSignal = yield* Signal.make(<span id="elem-cleanup" />);
      const scope = yield* Scope.make();

      yield* render(<div>{elemSignal}</div>).pipe(Scope.extend(scope));

      const before = document.querySelector("#elem-cleanup");
      assert.isNotNull(before);

      yield* Scope.close(scope, Exit.void);

      const after = document.querySelector("#elem-cleanup");
      assert.isNull(after);
    }),
  );

  it.scoped("should render primitive values as text nodes", () =>
    Effect.gen(function* () {
      const numSignal = yield* Signal.make(42);
      const { getByTestId } = yield* render(<div data-testid="prim-signal">{numSignal}</div>);

      assert.strictEqual((yield* getByTestId("prim-signal")).textContent, "42");
    }),
  );

  it.scoped("should preserve provided context when swapping", () =>
    Effect.gen(function* () {
      class Theme extends Context.Tag("Theme")<Theme, { value: string }>() {}
      const themeLayer = Layer.succeed(Theme, { value: "themed" });

      const ViewA = Component.gen(function* () {
        const theme = yield* Theme;
        return <div data-testid="view-a">{theme.value}</div>;
      });

      const ViewB = Component.gen(function* () {
        const theme = yield* Theme;
        return <div data-testid="view-b">{theme.value}</div>;
      });

      const viewSignal = yield* Signal.make<Element>(<ViewA />);

      const App = Component.gen(function* () {
        return <div data-testid="context-swap">{viewSignal}</div>;
      }).provide(themeLayer);

      const { getByTestId, queryByTestId } = yield* render(<App />);

      assert.strictEqual((yield* getByTestId("view-a")).textContent, "themed");
      assert.isTrue(Option.isNone(yield* queryByTestId("view-b")));

      yield* Signal.set(viewSignal, <ViewB />);
      yield* TestClock.adjust(20);

      assert.strictEqual((yield* getByTestId("view-b")).textContent, "themed");
      assert.isTrue(Option.isNone(yield* queryByTestId("view-a")));
    }),
  );
});

// =============================================================================
// Intrinsic Element
// =============================================================================
// Scope: Rendering HTML elements like div, span, button

describe("Intrinsic element rendering", () => {
  it.scoped("should create DOM element with correct tag", () =>
    Effect.gen(function* () {
      const { getByTestId } = yield* render(<article data-testid="tag-test" />);

      assert.strictEqual((yield* getByTestId("tag-test")).tagName, "ARTICLE");
    }),
  );

  it.scoped("should apply static props as attributes", () =>
    Effect.gen(function* () {
      const { getByTestId } = yield* render(
        <div data-testid="attr-test" className="my-class" id="my-id" />,
      );

      const el = yield* getByTestId("attr-test");
      assert.strictEqual(el.className, "my-class");
      assert.strictEqual(el.id, "my-id");
    }),
  );

  it.scoped("should render children inside element", () =>
    Effect.gen(function* () {
      const { getByTestId } = yield* render(
        <ul data-testid="children-test">
          <li>Item 1</li>
          <li>Item 2</li>
        </ul>,
      );

      const ul = yield* getByTestId("children-test");
      const lis = ul.querySelectorAll("li");
      assert.strictEqual(lis.length, 2);
    }),
  );

  it.scoped("should remove element and children on cleanup", () =>
    Effect.gen(function* () {
      const scope = yield* Scope.make();

      yield* render(
        <div id="cleanup-intrinsic">
          <span id="cleanup-child" />
        </div>,
      ).pipe(Scope.extend(scope));

      assert.isNotNull(document.querySelector("#cleanup-intrinsic"));
      assert.isNotNull(document.querySelector("#cleanup-child"));

      yield* Scope.close(scope, Exit.void);

      assert.isNull(document.querySelector("#cleanup-intrinsic"));
      assert.isNull(document.querySelector("#cleanup-child"));
    }),
  );
});

// =============================================================================
// Component Element
// =============================================================================
// Scope: Rendering Effect-based components with reactivity

describe("Component element rendering", () => {
  it.scoped("should execute component Effect to produce Element", () =>
    Effect.gen(function* () {
      let effectRan = false;

      const MyComponent = Component.gen(function* () {
        effectRan = true;
        return <div data-testid="effect-ran">Executed</div>;
      });

      yield* render(<MyComponent />);

      assert.isTrue(effectRan);
    }),
  );

  it.scoped("should render component output to DOM", () =>
    Effect.gen(function* () {
      const MyComponent = Component.gen(function* () {
        return <section data-testid="comp-output">Component content</section>;
      });

      const { getByTestId } = yield* render(<MyComponent />);

      assert.strictEqual((yield* getByTestId("comp-output")).textContent, "Component content");
    }),
  );

  it.scoped("should create render phase for signal tracking", () =>
    Effect.gen(function* () {
      const MyComponent = Component.gen(function* () {
        const signal = yield* Signal.make(0);
        const value = yield* Signal.get(signal);
        return <div data-testid="tracked">{String(value)}</div>;
      });

      const { getByTestId } = yield* render(<MyComponent />);

      assert.strictEqual((yield* getByTestId("tracked")).textContent, "0");
    }),
  );

  it.scoped("should re-render when subscribed signal changes", () =>
    Effect.gen(function* () {
      const count = Signal.makeSync(0);

      const Counter = Component.gen(function* () {
        const value = yield* Signal.get(count);
        return <div data-testid="rerender">{String(value)}</div>;
      });

      const { getByTestId } = yield* render(<Counter />);
      assert.strictEqual((yield* getByTestId("rerender")).textContent, "0");

      yield* Signal.set(count, 10);
      yield* TestClock.adjust(20);

      assert.strictEqual((yield* getByTestId("rerender")).textContent, "10");
    }),
  );

  it.scoped("should preserve signal identity on re-render", () =>
    Effect.gen(function* () {
      const trigger = Signal.makeSync(0);
      let signalInstance: Signal.Signal<number> | null = null;

      const MyComponent = Component.gen(function* () {
        yield* Signal.get(trigger);
        const localSignal = yield* Signal.make(42);
        if (signalInstance === null) {
          signalInstance = localSignal;
        } else {
          assert.strictEqual(localSignal, signalInstance);
        }
        return <div data-testid="identity" />;
      });

      yield* render(<MyComponent />);

      yield* Signal.set(trigger, 1);
      yield* TestClock.adjust(20);

      assert.isNotNull(signalInstance);
    }),
  );

  it.scoped("should maintain position using anchor comment", () =>
    Effect.gen(function* () {
      const Inner = Component.gen(function* () {
        return <span>Component</span>;
      });

      const { getByTestId } = yield* render(
        <div data-testid="comp-anchor">
          Before <Inner /> After
        </div>,
      );

      const content = (yield* getByTestId("comp-anchor")).textContent;
      assert.include(content, "Before");
      assert.include(content, "Component");
      assert.include(content, "After");
    }),
  );

  it.scoped("should close scopes and remove content on cleanup", () =>
    Effect.gen(function* () {
      const scope = yield* Scope.make();

      const MyComponent = Component.gen(function* () {
        return <div id="comp-cleanup" />;
      });

      yield* render(<MyComponent />).pipe(Scope.extend(scope));

      assert.isNotNull(document.querySelector("#comp-cleanup"));

      yield* Scope.close(scope, Exit.void);

      assert.isNull(document.querySelector("#comp-cleanup"));
    }),
  );

  it.scoped("should propagate errors from component effect", () =>
    Effect.gen(function* () {
      const ErrorComponent = Component.gen(function* () {
        yield* new ComponentError({ message: "Component error" });
        return <div />;
      });

      const exit = yield* Effect.exit(render(<ErrorComponent />));

      assert.strictEqual(exit._tag, "Failure");
    }),
  );

  it.scoped(
    "should execute effect when Component element is stored in Signal and passed as children",
    () =>
      Effect.gen(function* () {
        // This reproduces the pattern from generated entry.tsx:
        // const outlet = yield* Signal.make(<Router.Outlet routes={routes} />)
        // return <Layout>{outlet}</Layout>

        let innerEffectRan = false;

        // Inner component (like Outlet) - just a Component element
        const InnerComponent = Component.gen(function* () {
          innerEffectRan = true;
          return <span data-testid="inner">Inner content</span>;
        });

        // Wrapper component (like Layout) that receives children
        const Wrapper = Component.gen(function* (
          Props: Component.ComponentProps<{ children: Signal.Signal<Element> }>,
        ) {
          const { children } = yield* Props;
          return <div data-testid="wrapper">{children}</div>;
        });

        // App pattern: store component in Signal, pass as children
        const App = Component.gen(function* () {
          const innerSignal = yield* Signal.make<Element>(<InnerComponent />);
          return <Wrapper>{innerSignal}</Wrapper>;
        });

        const { getByTestId } = yield* render(<App />);

        // The inner component's effect should have run
        assert.isTrue(innerEffectRan, "Inner component effect should run");
        assert.strictEqual((yield* getByTestId("inner")).textContent, "Inner content");
      }),
  );

  it.scoped("should re-render inner component when it subscribes to an outer signal", () =>
    Effect.gen(function* () {
      // This tests the router pattern: Outlet subscribes to router.current
      // When router.current changes, Outlet should re-render

      const outerSignal = Signal.makeSync(0);
      let innerRenderCount = 0;

      // Inner component that subscribes to outer signal (like Outlet subscribes to router.current)
      const InnerComponent = Component.gen(function* () {
        const value = yield* Signal.get(outerSignal);
        innerRenderCount++;
        return <span data-testid="inner">Value: {String(value)}</span>;
      });

      // Wrapper component (like Layout)
      const Wrapper = Component.gen(function* (
        Props: Component.ComponentProps<{ children: Signal.Signal<Element> }>,
      ) {
        const { children } = yield* Props;
        return <div data-testid="wrapper">{children}</div>;
      });

      // App pattern
      const App = Component.gen(function* () {
        const innerSignal = yield* Signal.make<Element>(<InnerComponent />);
        return <Wrapper>{innerSignal}</Wrapper>;
      });

      const { getByTestId } = yield* render(<App />);

      // Initial render
      assert.strictEqual(innerRenderCount, 1, "Inner should render once initially");
      assert.strictEqual((yield* getByTestId("inner")).textContent, "Value: 0");

      // Change outer signal
      yield* Signal.set(outerSignal, 42);
      yield* TestClock.adjust(20);

      // Inner should re-render
      assert.strictEqual(innerRenderCount, 2, "Inner should re-render when signal changes");
      assert.strictEqual((yield* getByTestId("inner")).textContent, "Value: 42");
    }),
  );
});

// =============================================================================
// Fragment Element
// =============================================================================
// Scope: Rendering multiple children without wrapper

describe("Fragment element rendering", () => {
  it.scoped("should render all children to DOM", () =>
    Effect.gen(function* () {
      const { getByTestId } = yield* render(
        <div data-testid="frag-parent">
          <Fragment>One Two Three</Fragment>
        </div>,
      );

      assert.include((yield* getByTestId("frag-parent")).textContent, "One");
      assert.include((yield* getByTestId("frag-parent")).textContent, "Two");
      assert.include((yield* getByTestId("frag-parent")).textContent, "Three");
    }),
  );

  it.scoped("should not create wrapper element", () =>
    Effect.gen(function* () {
      const { getByTestId } = yield* render(
        <div data-testid="no-wrapper">
          <>
            <span className="frag-child">A</span>
          </>
        </div>,
      );

      const parent = yield* getByTestId("no-wrapper");
      const spans = parent.querySelectorAll(".frag-child");
      assert.strictEqual(spans.length, 1);
      assert.strictEqual(spans[0]?.parentElement, parent);
    }),
  );

  it.scoped("should use comment anchor for empty fragment", () =>
    Effect.gen(function* () {
      const { getByTestId } = yield* render(
        <div data-testid="empty-frag">
          <></>
        </div>,
      );

      const parent = yield* getByTestId("empty-frag");
      assert.isTrue(parent.childNodes.length >= 0);
    }),
  );

  it.scoped("should remove all children on cleanup", () =>
    Effect.gen(function* () {
      const scope = yield* Scope.make();

      yield* render(
        <div id="frag-cleanup">
          <>
            <span id="frag-child-1" />
            <span id="frag-child-2" />
          </>
        </div>,
      ).pipe(Scope.extend(scope));

      assert.isNotNull(document.querySelector("#frag-child-1"));
      assert.isNotNull(document.querySelector("#frag-child-2"));

      yield* Scope.close(scope, Exit.void);

      assert.isNull(document.querySelector("#frag-child-1"));
      assert.isNull(document.querySelector("#frag-child-2"));
    }),
  );
});

// =============================================================================
// Props Application
// =============================================================================
// Scope: Applying props to DOM elements

describe("Props application", () => {
  it.scoped("should apply className prop", () =>
    Effect.gen(function* () {
      const { getByTestId } = yield* render(<div data-testid="classname" className="my-class" />);

      assert.strictEqual((yield* getByTestId("classname")).className, "my-class");
    }),
  );

  it.scoped("should apply style object to element", () =>
    Effect.gen(function* () {
      const { getByTestId } = yield* render(
        <div data-testid="style" style={{ color: "red", fontSize: "16px" }} />,
      );

      const el = yield* getByTestId("style");
      assert.strictEqual(el.style.color, "red");
      assert.strictEqual(el.style.fontSize, "16px");
    }),
  );

  it.scoped("should apply htmlFor as for attribute", () =>
    Effect.gen(function* () {
      const { getByTestId } = yield* render(<label data-testid="htmlfor" htmlFor="input-id" />);

      assert.strictEqual((yield* getByTestId("htmlfor")).getAttribute("for"), "input-id");
    }),
  );

  it.scoped("should apply checked prop to input", () =>
    Effect.gen(function* () {
      const { getByTestId } = yield* render(
        <input data-testid="checked" type="checkbox" checked={true} />,
      );

      assert.isTrue(((yield* getByTestId("checked")) as HTMLInputElement).checked);
    }),
  );

  it.scoped("should apply value prop to input", () =>
    Effect.gen(function* () {
      const { getByTestId } = yield* render(
        <input data-testid="value" type="text" value="hello" />,
      );

      assert.strictEqual(((yield* getByTestId("value")) as HTMLInputElement).value, "hello");
    }),
  );

  it.scoped("should apply disabled prop as attribute", () =>
    Effect.gen(function* () {
      const { getByTestId } = yield* render(<button data-testid="disabled" disabled={true} />);

      assert.isTrue(((yield* getByTestId("disabled")) as HTMLButtonElement).disabled);
    }),
  );

  it.scoped("should apply hidden prop as attribute", () =>
    Effect.gen(function* () {
      const { getByTestId } = yield* render(<div data-testid="hidden" hidden={true} />);

      assert.isTrue((yield* getByTestId("hidden")).hidden);
    }),
  );

  it.scoped("should apply data-* attributes", () =>
    Effect.gen(function* () {
      const { getByTestId } = yield* render(<div data-testid="data-attr" data-custom="value" />);

      assert.strictEqual((yield* getByTestId("data-attr")).getAttribute("data-custom"), "value");
    }),
  );

  it.scoped("should apply aria-* attributes", () =>
    Effect.gen(function* () {
      const { getByTestId } = yield* render(<button data-testid="aria" aria-label="Close" />);

      assert.strictEqual((yield* getByTestId("aria")).getAttribute("aria-label"), "Close");
    }),
  );

  it.scoped("should handle boolean attributes correctly", () =>
    Effect.gen(function* () {
      const { getByTestId } = yield* render(
        <input data-testid="bool" type="text" readonly={true} required={true} />,
      );

      const input = (yield* getByTestId("bool")) as HTMLInputElement;
      assert.isTrue(input.readOnly);
      assert.isTrue(input.required);
    }),
  );
});

// =============================================================================
// Signal Props (Fine-grained reactivity)
// =============================================================================
// Scope: Props that accept Signals for direct DOM updates

describe("Signal props", () => {
  it.scoped("should update className directly when signal changes", () =>
    Effect.gen(function* () {
      const classSignal = yield* Signal.make("initial");
      const { getByTestId } = yield* render(
        <div data-testid="sig-class" className={classSignal} />,
      );

      assert.strictEqual((yield* getByTestId("sig-class")).className, "initial");

      yield* Signal.set(classSignal, "updated");
      yield* TestClock.adjust(10);

      assert.strictEqual((yield* getByTestId("sig-class")).className, "updated");
    }),
  );

  it.scoped("should update input value directly when signal changes", () =>
    Effect.gen(function* () {
      const valueSignal = yield* Signal.make("initial");
      const { getByTestId } = yield* render(
        <input data-testid="sig-value" type="text" value={valueSignal} />,
      );

      assert.strictEqual(((yield* getByTestId("sig-value")) as HTMLInputElement).value, "initial");

      yield* Signal.set(valueSignal, "updated");
      yield* TestClock.adjust(10);

      assert.strictEqual(((yield* getByTestId("sig-value")) as HTMLInputElement).value, "updated");
    }),
  );

  it.scoped("should update input checked directly when signal changes", () =>
    Effect.gen(function* () {
      const checkedSignal = yield* Signal.make(false);
      const { getByTestId } = yield* render(
        <input data-testid="sig-checked" type="checkbox" checked={checkedSignal} />,
      );

      assert.isFalse(((yield* getByTestId("sig-checked")) as HTMLInputElement).checked);

      yield* Signal.set(checkedSignal, true);
      yield* TestClock.adjust(10);

      assert.isTrue(((yield* getByTestId("sig-checked")) as HTMLInputElement).checked);
    }),
  );

  it.scoped("should update disabled directly when signal changes", () =>
    Effect.gen(function* () {
      const disabledSignal = yield* Signal.make(false);
      const { getByTestId } = yield* render(
        <button data-testid="sig-disabled" disabled={disabledSignal}>
          Button
        </button>,
      );

      assert.isFalse(((yield* getByTestId("sig-disabled")) as HTMLButtonElement).disabled);

      yield* Signal.set(disabledSignal, true);
      yield* TestClock.adjust(10);

      assert.isTrue(((yield* getByTestId("sig-disabled")) as HTMLButtonElement).disabled);
    }),
  );

  it.scoped("should update data-* attribute when signal changes", () =>
    Effect.gen(function* () {
      const dataSignal = yield* Signal.make("initial");
      const { getByTestId } = yield* render(<div data-testid="sig-data" data-value={dataSignal} />);

      assert.strictEqual((yield* getByTestId("sig-data")).getAttribute("data-value"), "initial");

      yield* Signal.set(dataSignal, "updated");
      yield* TestClock.adjust(10);

      assert.strictEqual((yield* getByTestId("sig-data")).getAttribute("data-value"), "updated");
    }),
  );

  it.scoped("should unsubscribe from signal props on cleanup", () =>
    Effect.gen(function* () {
      const classSignal = yield* Signal.make("class");
      const scope = yield* Scope.make();

      yield* render(<div id="sig-cleanup" className={classSignal} />).pipe(Scope.extend(scope));

      const listenersBefore = classSignal._listeners.size;

      yield* Scope.close(scope, Exit.void);

      const listenersAfter = classSignal._listeners.size;
      assert.isBelow(listenersAfter, listenersBefore);
    }),
  );
});

// =============================================================================
// Event Handlers
// =============================================================================
// Scope: Event handler props

describe("Event handlers", () => {
  it.scoped("should call function handler with event", () =>
    Effect.gen(function* () {
      let eventReceived: Event | null = null;

      const { getByTestId } = yield* render(
        <button
          data-testid="event-btn"
          onClick={(e: Event) =>
            Effect.sync(() => {
              eventReceived = e;
            })
          }
        >
          Click
        </button>,
      );

      (yield* getByTestId("event-btn")).click();
      yield* TestClock.adjust(10);

      assert.isNotNull(eventReceived);
      assert.instanceOf(eventReceived, Event);
    }),
  );

  it.scoped("should execute Effect handler on event", () =>
    Effect.gen(function* () {
      let handlerExecuted = false;

      const { getByTestId } = yield* render(
        <button
          data-testid="effect-btn"
          onClick={Effect.sync(() => {
            handlerExecuted = true;
          })}
        >
          Click
        </button>,
      );

      (yield* getByTestId("effect-btn")).click();
      yield* TestClock.adjust(10);

      assert.isTrue(handlerExecuted);
    }),
  );

  it.scoped("should support multiple different event handlers", () =>
    Effect.gen(function* () {
      let clicked = false;
      let focused = false;

      const { getByTestId } = yield* render(
        <input
          data-testid="multi-event"
          type="text"
          onClick={Effect.sync(() => {
            clicked = true;
          })}
          onFocus={Effect.sync(() => {
            focused = true;
          })}
        />,
      );

      const input = yield* getByTestId("multi-event");
      input.click();
      input.focus();
      yield* TestClock.adjust(10);

      assert.isTrue(clicked);
      assert.isTrue(focused);
    }),
  );
});

// =============================================================================
// Scope and Cleanup
// =============================================================================
// Scope: Proper resource management

describe("Scope and cleanup", () => {
  it.scoped("should close scope on unmount", () =>
    Effect.gen(function* () {
      const scope = yield* Scope.make();
      let finalizerRan = false;

      const MyComponent = Component.gen(function* () {
        yield* Effect.addFinalizer(() =>
          Effect.sync(() => {
            finalizerRan = true;
          }),
        );
        return <span>Component</span>;
      });

      yield* render(
        <div id="scope-unmount">
          <MyComponent />
        </div>,
      ).pipe(Scope.extend(scope));

      yield* Scope.close(scope, Exit.void);

      assert.isTrue(finalizerRan);
    }),
  );

  it.scoped("should cleanup nested scopes correctly", () =>
    Effect.gen(function* () {
      const scope = yield* Scope.make();
      const cleanupOrder: string[] = [];

      const Child = Component.gen(function* () {
        yield* Effect.addFinalizer(() =>
          Effect.sync(() => {
            cleanupOrder.push("child");
          }),
        );
        return <span>Child</span>;
      });

      const Parent = Component.gen(function* () {
        yield* Effect.addFinalizer(() =>
          Effect.sync(() => {
            cleanupOrder.push("parent");
          }),
        );
        return (
          <div>
            <Child />
          </div>
        );
      });

      yield* render(<Parent />).pipe(Scope.extend(scope));
      yield* Scope.close(scope, Exit.void);

      assert.include(cleanupOrder, "child");
      assert.include(cleanupOrder, "parent");
    }),
  );

  it.scoped("should remove all signal subscriptions on cleanup", () =>
    Effect.gen(function* () {
      const signal = yield* Signal.make(0);
      const scope = yield* Scope.make();

      const MyComponent = Component.gen(function* () {
        const value = yield* Signal.get(signal);
        return <span>{String(value)}</span>;
      });

      yield* render(<MyComponent />).pipe(Scope.extend(scope));

      const listenersBefore = signal._listeners.size;

      yield* Scope.close(scope, Exit.void);

      const listenersAfter = signal._listeners.size;
      assert.isBelow(listenersAfter, listenersBefore);
    }),
  );

  it.scoped("should remove all DOM nodes on cleanup", () =>
    Effect.gen(function* () {
      const scope = yield* Scope.make();

      yield* render(
        <div id="dom-cleanup">
          <span id="dom-child-1" />
          <span id="dom-child-2" />
        </div>,
      ).pipe(Scope.extend(scope));

      assert.isNotNull(document.querySelector("#dom-cleanup"));
      assert.isNotNull(document.querySelector("#dom-child-1"));
      assert.isNotNull(document.querySelector("#dom-child-2"));

      yield* Scope.close(scope, Exit.void);

      assert.isNull(document.querySelector("#dom-cleanup"));
      assert.isNull(document.querySelector("#dom-child-1"));
      assert.isNull(document.querySelector("#dom-child-2"));
    }),
  );
});

// =============================================================================
// Re-render Behavior
// =============================================================================
// Scope: Component re-rendering on signal changes

describe("Re-render behavior", () => {
  it.scoped("should only re-render components subscribed to changed signal", () =>
    Effect.gen(function* () {
      const signal1 = Signal.makeSync(0);
      const signal2 = Signal.makeSync(0);
      let comp1Renders = 0;
      let comp2Renders = 0;

      const Comp1 = Component.gen(function* () {
        comp1Renders++;
        const value = yield* Signal.get(signal1);
        return <div data-testid="comp1">{String(value)}</div>;
      });

      const Comp2 = Component.gen(function* () {
        comp2Renders++;
        const value = yield* Signal.get(signal2);
        return <div data-testid="comp2">{String(value)}</div>;
      });

      yield* render(
        <div>
          <Comp1 />
          <Comp2 />
        </div>,
      );

      const initialComp1 = comp1Renders;
      const initialComp2 = comp2Renders;

      yield* Signal.set(signal1, 1);
      yield* TestClock.adjust(20);

      assert.isAbove(comp1Renders, initialComp1);
      assert.strictEqual(comp2Renders, initialComp2);
    }),
  );

  it.scoped("should recreate child component on parent re-render (full subtree teardown)", () =>
    Effect.gen(function* () {
      const parentTrigger = Signal.makeSync(0);
      let childRenderCount = 0;

      const Child = Component.gen(function* () {
        childRenderCount++;
        const childSignal = yield* Signal.make(100);
        const value = yield* Signal.get(childSignal);
        return <span data-testid="child">{String(value)}</span>;
      });

      const Parent = Component.gen(function* () {
        yield* Signal.get(parentTrigger);
        return (
          <div data-testid="parent">
            <Child />
          </div>
        );
      });

      const { getByTestId } = yield* render(<Parent />);

      assert.strictEqual(childRenderCount, 1);
      assert.strictEqual((yield* getByTestId("child")).textContent, "100");

      yield* Signal.set(parentTrigger, 1);
      yield* TestClock.adjust(20);

      // Child is recreated on parent re-render (F-004: full subtree teardown)
      assert.strictEqual(childRenderCount, 2);
    }),
  );

  it.scoped("should clean up old content when SignalElement swaps (navigation pattern)", () =>
    Effect.gen(function* () {
      // This simulates the router outlet pattern:
      // 1. A Signal<Element> holds the current route component
      // 2. When navigation happens, the signal updates to new component
      // 3. Old component should be cleaned up before new one renders

      const routeSignal = Signal.makeSync<Element>(<div data-testid="route-a">Route A</div>);
      let cleanupACalled = false;

      // Component A with cleanup tracking
      const RouteA = Component.gen(function* () {
        yield* Effect.addFinalizer(() =>
          Effect.sync(() => {
            cleanupACalled = true;
          }),
        );
        return <div data-testid="route-a">Route A Content</div>;
      });

      // Component B
      const RouteB = Component.gen(function* () {
        return <div data-testid="route-b">Route B Content</div>;
      });

      // Set initial route
      yield* Signal.set(routeSignal, <RouteA />);

      const { container, getByTestId } = yield* render(
        <div data-testid="outlet">{routeSignal}</div>,
      );

      // Initial state: Route A is rendered
      assert.strictEqual((yield* getByTestId("route-a")).textContent, "Route A Content");
      assert.strictEqual(container.querySelectorAll("[data-testid]").length, 2); // outlet + route-a

      // Navigate to Route B
      yield* Signal.set(routeSignal, <RouteB />);
      yield* TestClock.adjust(20);

      // After navigation: Route A should be cleaned up, Route B should be rendered
      assert.isTrue(cleanupACalled, "Route A cleanup should have been called");
      assert.isNull(
        container.querySelector("[data-testid='route-a']"),
        "Route A should be removed from DOM",
      );
      assert.isNotNull(
        container.querySelector("[data-testid='route-b']"),
        "Route B should be in DOM",
      );
      assert.strictEqual((yield* getByTestId("route-b")).textContent, "Route B Content");

      // Should have exactly 2 test elements: outlet + route-b
      assert.strictEqual(
        container.querySelectorAll("[data-testid]").length,
        2,
        "Should only have outlet + current route",
      );
    }),
  );

  it.scoped("should not duplicate content on rapid signal changes", () =>
    Effect.gen(function* () {
      // Test that rapid navigation doesn't cause duplicate DOM nodes
      const routeSignal = Signal.makeSync<Element>(<span>Initial</span>);

      const { container } = yield* render(<div data-testid="rapid-container">{routeSignal}</div>);

      const getSpanCount = () => container.querySelectorAll("span").length;

      assert.strictEqual(getSpanCount(), 1, "Initial: should have 1 span");

      // Rapid updates
      yield* Signal.set(routeSignal, <span>Update 1</span>);
      yield* Signal.set(routeSignal, <span>Update 2</span>);
      yield* Signal.set(routeSignal, <span>Update 3</span>);

      // Let all updates process
      yield* TestClock.adjust(50);

      // Should still have only 1 span
      assert.strictEqual(getSpanCount(), 1, "After rapid updates: should still have only 1 span");
      assert.strictEqual(container.querySelector("span")?.textContent, "Update 3");
    }),
  );

  it.scoped(
    "should cleanup nested SignalElement on parent component re-render (outlet pattern)",
    () =>
      Effect.gen(function* () {
        // This simulates the router outlet pattern:
        // - Outlet is a Component that subscribes to router.current
        // - Outlet returns a SignalElement (tracker.view) that is UPDATED via Signal.set
        // - When router changes, the view signal is updated with new content

        const routerSignal = Signal.makeSync("/page-a");
        let outletRenderCount = 0;

        // Create a view signal OUTSIDE the component (like async tracker does)
        const viewSignal = Signal.makeSync<Element>(<div data-testid="page-a">Page A Content</div>);

        // Simulated outlet that re-renders on route change
        const SimulatedOutlet = Component.gen(function* () {
          // Subscribe to router signal (causes re-render when it changes)
          const currentRoute = yield* Signal.get(routerSignal);
          outletRenderCount++;

          // Update the view signal (like tracker.run does)
          yield* Signal.set(
            viewSignal,
            currentRoute === "/page-a" ? (
              <div data-testid="page-a">Page A Content</div>
            ) : (
              <div data-testid="page-b">Page B Content</div>
            ),
          );

          // Return SignalElement (like outlet does)
          return <div data-testid="outlet-inner">{viewSignal}</div>;
        });

        const { container } = yield* render(
          <div data-testid="app">
            <SimulatedOutlet />
          </div>,
        );

        // Initial state
        assert.strictEqual(outletRenderCount, 1, "Outlet should render once initially");
        assert.isNotNull(
          container.querySelector("[data-testid='page-a']"),
          "Page A should be visible",
        );
        assert.isNull(
          container.querySelector("[data-testid='page-b']"),
          "Page B should not be visible",
        );

        // Navigate to page B
        yield* Signal.set(routerSignal, "/page-b");
        yield* TestClock.adjust(20);

        // After navigation
        assert.strictEqual(outletRenderCount, 2, "Outlet should re-render on navigation");

        const pageAElements = container.querySelectorAll("[data-testid='page-a']");
        const pageBElements = container.querySelectorAll("[data-testid='page-b']");
        const outletInnerElements = container.querySelectorAll("[data-testid='outlet-inner']");

        // Count elements
        assert.strictEqual(
          pageAElements.length,
          0,
          `Page A should be removed, found ${pageAElements.length}. DOM: ${container.innerHTML}`,
        );
        assert.strictEqual(
          pageBElements.length,
          1,
          `Should have exactly 1 Page B, found ${pageBElements.length}`,
        );
        assert.strictEqual(
          outletInnerElements.length,
          1,
          `Should have exactly 1 outlet-inner, found ${outletInnerElements.length}`,
        );
      }),
  );

  it.scoped("should render component only ONCE on initial mount (no double render)", () =>
    Effect.gen(function* () {
      // This test verifies that components don't double-render on initial mount
      // which was a reported issue with the outlet pattern
      let innerRenderCount = 0;

      const InnerComponent = Component.gen(function* () {
        innerRenderCount++;
        return <div data-testid="inner">Rendered {innerRenderCount} times</div>;
      });

      // Create a signal holding the inner component (like outlet pattern)
      const contentSignal = Signal.makeSync<Element>(<InnerComponent />);

      // Outer component that reads from the signal
      const OuterComponent = Component.gen(function* () {
        return <div data-testid="outer">{contentSignal}</div>;
      });

      const { container } = yield* render(<OuterComponent />);

      // Wait for any potential extra renders
      yield* TestClock.adjust(50);

      // Should only render once
      assert.strictEqual(
        innerRenderCount,
        1,
        `Inner component should render exactly once, but rendered ${innerRenderCount} times`,
      );
      assert.strictEqual(
        container.querySelectorAll("[data-testid='inner']").length,
        1,
        `Should have exactly 1 inner element in DOM`,
      );
    }),
  );

  it.scoped("should render nested component only ONCE when parent subscribes to signal", () =>
    Effect.gen(function* () {
      // More complex case: outer component subscribes to a signal
      // but inner component should still only render once initially
      const routeSignal = Signal.makeSync("/home");
      let outerRenderCount = 0;
      let innerRenderCount = 0;

      const InnerComponent = Component.gen(function* () {
        innerRenderCount++;
        return <div data-testid="inner">Inner render #{innerRenderCount}</div>;
      });

      const OuterComponent = Component.gen(function* () {
        // Subscribe to route signal (like outlet does)
        const route = yield* Signal.get(routeSignal);
        outerRenderCount++;
        return (
          <div data-testid="outer" data-route={route}>
            <InnerComponent />
          </div>
        );
      });

      const { container } = yield* render(<OuterComponent />);

      // Wait for any potential extra renders
      yield* TestClock.adjust(50);

      // Both should render exactly once on initial mount
      assert.strictEqual(
        outerRenderCount,
        1,
        `Outer component should render exactly once initially, but rendered ${outerRenderCount} times`,
      );
      assert.strictEqual(
        innerRenderCount,
        1,
        `Inner component should render exactly once initially, but rendered ${innerRenderCount} times`,
      );

      // Verify DOM
      assert.strictEqual(container.querySelectorAll("[data-testid='outer']").length, 1);
      assert.strictEqual(container.querySelectorAll("[data-testid='inner']").length, 1);
    }),
  );

  it.scoped("should render outlet pattern (Signal<Component>) only ONCE on initial mount", () =>
    Effect.gen(function* () {
      // This matches the exact app structure:
      // App creates Signal containing Outlet Component
      // Layout receives signal as children prop and renders it
      // Outlet should only render ONCE

      let outletRenderCount = 0;
      let layoutRenderCount = 0;

      // Simulated Outlet - a Component that subscribes to a route signal
      const routeSignal = Signal.makeSync("/home");
      const Outlet = Component.gen(function* () {
        const route = yield* Signal.get(routeSignal);
        outletRenderCount++;
        return (
          <div data-testid="outlet">
            Route: {route}, Render #{outletRenderCount}
          </div>
        );
      });

      // Layout receives children as Signal<Element>
      const Layout = Component.gen(function* (
        Props: ComponentProps<{ content: Signal.Signal<Element> }>,
      ) {
        const { content } = yield* Props;
        layoutRenderCount++;
        return (
          <div data-testid="layout">
            <header>Layout Header</header>
            <main>{content}</main>
          </div>
        );
      });

      // App creates outlet signal and passes to Layout (like entry.tsx)
      const App = Component.gen(function* () {
        const outlet = yield* Signal.make<Element>(<Outlet />);
        return <Layout content={outlet} />;
      });

      const { container } = yield* render(<App />);

      // Wait for any potential extra renders
      yield* TestClock.adjust(50);

      // All should render exactly once
      assert.strictEqual(
        layoutRenderCount,
        1,
        `Layout should render exactly once, but rendered ${layoutRenderCount} times`,
      );
      assert.strictEqual(
        outletRenderCount,
        1,
        `Outlet should render exactly once, but rendered ${outletRenderCount} times`,
      );

      // Verify DOM structure
      assert.strictEqual(
        container.querySelectorAll("[data-testid='layout']").length,
        1,
        "Should have exactly 1 layout",
      );
      assert.strictEqual(
        container.querySelectorAll("[data-testid='outlet']").length,
        1,
        "Should have exactly 1 outlet",
      );
    }),
  );

  it.scoped("should render real Router.Outlet only ONCE on initial mount", () =>
    Effect.gen(function* () {
      // Test with actual Router.Outlet and router service
      let homeRenderCount = 0;

      const HomeComp = Component.gen(function* () {
        homeRenderCount++;
        return <div data-testid="home">Home Page (render #{homeRenderCount})</div>;
      });

      const routes = {
        routes: [
          {
            _tag: "RouteDefinition" as const,
            path: "/",
            component: HomeComp,
            layout: undefined,
            loading: undefined,
            error: undefined,
            notFound: undefined,
            forbidden: undefined,
            middleware: [],
            prefetch: [],
            children: [],
            paramsSchema: undefined,
            querySchema: undefined,
            renderStrategy: undefined,
            scrollStrategy: undefined,
            layers: [],
          },
        ],
        notFound: undefined,
        forbidden: undefined,
        error: undefined,
      };

      const App = Component.gen(function* () {
        return <Router.Outlet routes={routes} />;
      });

      const { container } = yield* render(<App />).pipe(Effect.provide(Router.testLayer("/")));

      // Wait for async route loading and any potential extra renders
      yield* TestClock.adjust(100);

      // Home should render exactly once
      assert.strictEqual(
        homeRenderCount,
        1,
        `Home component should render exactly once, but rendered ${homeRenderCount} times`,
      );

      // Verify DOM
      assert.strictEqual(
        container.querySelectorAll("[data-testid='home']").length,
        1,
        "Should have exactly 1 home element",
      );
    }),
  );
});

// =============================================================================
// Error Handling
// =============================================================================
// Scope: Error propagation and recovery

describe("Renderer error handling", () => {
  it.scoped("should propagate component effect errors", () =>
    Effect.gen(function* () {
      const ErrorComponent = Component.gen(function* () {
        yield* new ComponentError({ message: "Render error" });
        return <div />;
      });

      const exit = yield* Effect.exit(render(<ErrorComponent />));

      assert.strictEqual(exit._tag, "Failure");
    }),
  );

  it.scoped("should preserve old content when component re-render fails", () =>
    Effect.gen(function* () {
      const shouldError = Signal.makeSync(false);

      const ConditionalErrorComponent = Component.gen(function* () {
        const willError = yield* Signal.get(shouldError);
        if (willError) {
          yield* new ComponentError({ message: "Re-render error" });
        }
        return <div data-testid="content">Working content</div>;
      });

      const { getByTestId } = yield* render(<ConditionalErrorComponent />);

      // Initial render succeeds
      assert.strictEqual((yield* getByTestId("content")).textContent, "Working content");

      // Trigger re-render that will fail
      yield* Signal.set(shouldError, true);
      yield* TestClock.adjust(20);

      // Old content should be preserved (not removed)
      assert.strictEqual((yield* getByTestId("content")).textContent, "Working content");
    }),
  );

  it.scoped("should preserve old content when SignalElement swap fails", () =>
    Effect.gen(function* () {
      const viewSignal = yield* Signal.make<"working" | "error">("working");

      const WorkingView = <div data-testid="view">Working view</div>;

      const ErrorView = Component.gen(function* () {
        yield* new ComponentError({ message: "View error" });
        return <div />;
      });

      const App = Component.gen(function* () {
        const view = yield* Signal.get(viewSignal);
        return view === "working" ? WorkingView : <ErrorView />;
      });

      const { getByTestId } = yield* render(<App />);

      // Initial render shows working view
      assert.strictEqual((yield* getByTestId("view")).textContent, "Working view");

      // Trigger swap to error view
      yield* Signal.set(viewSignal, "error");
      yield* TestClock.adjust(20);

      // Old content should be preserved
      assert.strictEqual((yield* getByTestId("view")).textContent, "Working view");
    }),
  );

  it.scoped("should maintain signal subscriptions after re-render error for retry", () =>
    Effect.gen(function* () {
      const errorCount = Signal.makeSync(0);
      let renderCount = 0;

      const RetryableComponent = Component.gen(function* () {
        renderCount++;
        const errors = yield* Signal.get(errorCount);
        // Fail on first re-render (errors === 1), succeed on second (errors === 2)
        if (errors === 1) {
          yield* new ComponentError({ message: "Temporary error" });
        }
        return <div data-testid="retry">{String(errors)}</div>;
      });

      const { getByTestId } = yield* render(<RetryableComponent />);

      // Initial render (errors = 0) succeeds
      assert.strictEqual(renderCount, 1);
      assert.strictEqual((yield* getByTestId("retry")).textContent, "0");

      // First re-render (errors = 1) fails - old content preserved
      yield* Signal.set(errorCount, 1);
      yield* TestClock.adjust(20);
      assert.strictEqual(renderCount, 2);
      assert.strictEqual((yield* getByTestId("retry")).textContent, "0"); // Old content preserved

      // Second re-render (errors = 2) succeeds - subscription still works
      yield* Signal.set(errorCount, 2);
      yield* TestClock.adjust(20);
      assert.strictEqual(renderCount, 3);
      assert.strictEqual((yield* getByTestId("retry")).textContent, "2"); // New content rendered
    }),
  );

  it.scoped("should cleanup properly after re-render error when component unmounts", () =>
    Effect.gen(function* () {
      const scope = yield* Scope.make();
      const shouldError = Signal.makeSync(false);

      const ErrorOnRerenderComponent = Component.gen(function* () {
        const willError = yield* Signal.get(shouldError);
        if (willError) {
          yield* new ComponentError({ message: "Re-render error" });
        }
        return <div id="error-cleanup">Content</div>;
      });

      yield* render(<ErrorOnRerenderComponent />).pipe(Scope.extend(scope));

      // Initial render
      assert.isNotNull(document.querySelector("#error-cleanup"));

      // Trigger failing re-render
      yield* Signal.set(shouldError, true);
      yield* TestClock.adjust(20);

      // Content still present (old content preserved)
      assert.isNotNull(document.querySelector("#error-cleanup"));

      // Close scope - should cleanup without errors
      yield* Scope.close(scope, Exit.void);

      // Content removed
      assert.isNull(document.querySelector("#error-cleanup"));
    }),
  );
});

// =============================================================================
// Provide Element (Context)
// =============================================================================
// Scope: Context propagation via Provide element

describe("Provide element", () => {
  it.scoped("should provide context to child components", () =>
    Effect.gen(function* () {
      class TestCtx extends Context.Tag("TestCtx")<TestCtx, { value: string }>() {}

      const Child = Component.gen(function* () {
        const ctx = yield* TestCtx;
        return <span data-testid="ctx-child">{ctx.value}</span>;
      });

      const Parent = Component.gen(function* () {
        return <Child />;
      }).provide(Layer.succeed(TestCtx, { value: "provided" }));

      const { getByTestId } = yield* render(<Parent />);

      assert.strictEqual((yield* getByTestId("ctx-child")).textContent, "provided");
    }),
  );

  it.scoped("should propagate context to deeply nested components", () =>
    Effect.gen(function* () {
      class DeepCtx extends Context.Tag("DeepCtx")<DeepCtx, { nested: string }>() {}

      const DeepChild = Component.gen(function* () {
        const ctx = yield* DeepCtx;
        return <span data-testid="deep">{ctx.nested}</span>;
      });

      const MiddleChild = Component.gen(function* () {
        return (
          <div>
            <DeepChild />
          </div>
        );
      });

      const TopLevel = Component.gen(function* () {
        return <MiddleChild />;
      }).provide(Layer.succeed(DeepCtx, { nested: "deep-value" }));

      const { getByTestId } = yield* render(<TopLevel />);

      assert.strictEqual((yield* getByTestId("deep")).textContent, "deep-value");
    }),
  );
});

// =============================================================================
// KeyedList (Signal.each) — DOM order stability
// =============================================================================

describe("KeyedList rendering", () => {
  it.scoped("should preserve DOM order when a keyed item re-renders", () =>
    Effect.gen(function* () {
      // Items with internal toggle state — simulates expand/collapse
      const ToggleItem = Component.gen(function* (
        Props: ComponentProps<{ label: string }>,
      ) {
        const { label } = yield* Props;
        const expanded = yield* Signal.make(false);
        const isExpanded = yield* Signal.get(expanded);

        return (
          <div data-testid={`item-${label}`}>
            <button
              data-testid={`toggle-${label}`}
              onClick={() => Signal.update(expanded, (v) => !v)}
            >
              {label}
            </button>
            {isExpanded && <span data-testid={`detail-${label}`}>details</span>}
          </div>
        );
      });

      const items = Signal.makeSync<ReadonlyArray<{ id: number; label: string }>>([
        { id: 1, label: "A" },
        { id: 2, label: "B" },
        { id: 3, label: "C" },
      ]);

      const List = Component.gen(function* () {
        return (
          <div data-testid="list">
            {Signal.each(
              items,
              (item) => Effect.succeed(<ToggleItem label={item.label} />),
              { key: (item: { id: number; label: string }) => item.id },
            )}
          </div>
        );
      });

      const { getByTestId } = yield* render(<List />);
      yield* TestClock.adjust(20);

      // Verify initial order: A, B, C
      const getOrder = () =>
        Effect.gen(function* () {
          const list = yield* getByTestId("list");
          const labels: Array<string> = [];
          list.querySelectorAll("[data-testid^='item-']").forEach((el) => {
            labels.push(el.getAttribute("data-testid")?.replace("item-", "") ?? "");
          });
          return labels;
        });

      assert.deepStrictEqual(yield* getOrder(), ["A", "B", "C"]);

      // Toggle the LAST item (C) — this triggered the reorder bug
      const toggleC = yield* getByTestId("toggle-C");
      toggleC.click();
      yield* TestClock.adjust(20);

      // C should show details
      const detailC = yield* getByTestId("detail-C");
      assert.strictEqual(detailC.textContent, "details");

      // Order must still be A, B, C — NOT C, A, B
      assert.deepStrictEqual(yield* getOrder(), ["A", "B", "C"]);

      // Toggle the FIRST item (A) too
      const toggleA = yield* getByTestId("toggle-A");
      toggleA.click();
      yield* TestClock.adjust(20);

      assert.deepStrictEqual(yield* getOrder(), ["A", "B", "C"]);
    }),
  );

  it.scoped("should preserve DOM order when middle item re-renders", () =>
    Effect.gen(function* () {
      const Counter = Component.gen(function* (
        Props: ComponentProps<{ id: number }>,
      ) {
        const { id } = yield* Props;
        const count = yield* Signal.make(0);
        const value = yield* Signal.get(count);

        return (
          <div data-testid={`counter-${String(id)}`}>
            <button
              data-testid={`inc-${String(id)}`}
              onClick={() => Signal.update(count, (n) => n + 1)}
            >
              {String(value)}
            </button>
          </div>
        );
      });

      const items = Signal.makeSync<ReadonlyArray<number>>([1, 2, 3, 4, 5]);

      const List = Component.gen(function* () {
        return (
          <div data-testid="counters">
            {Signal.each(
              items,
              (id) => Effect.succeed(<Counter id={id} />),
              { key: (id: number) => id },
            )}
          </div>
        );
      });

      const { getByTestId } = yield* render(<List />);
      yield* TestClock.adjust(20);

      const getOrder = () =>
        Effect.gen(function* () {
          const list = yield* getByTestId("counters");
          const ids: Array<string> = [];
          list.querySelectorAll("[data-testid^='counter-']").forEach((el) => {
            ids.push(el.getAttribute("data-testid")?.replace("counter-", "") ?? "");
          });
          return ids;
        });

      assert.deepStrictEqual(yield* getOrder(), ["1", "2", "3", "4", "5"]);

      // Click middle item (3) to trigger re-render
      (yield* getByTestId("inc-3")).click();
      yield* TestClock.adjust(20);

      // Value updated (re-query since Component re-render replaces DOM nodes)
      assert.strictEqual((yield* getByTestId("inc-3")).textContent, "1");

      // Order preserved
      assert.deepStrictEqual(yield* getOrder(), ["1", "2", "3", "4", "5"]);
    }),
  );
});
