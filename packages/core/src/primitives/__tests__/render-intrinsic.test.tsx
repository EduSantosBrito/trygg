import { assert, describe } from "@effect/vitest";
import { Effect } from "effect";
import { TestClock } from "effect/testing";
import { scoped } from "../../testing/effect-vitest.js";
import { render } from "../../testing/index.js";
import * as Signal from "../signal.js";

describe("renderIntrinsic", () => {
  scoped("creates standard and void DOM elements", () =>
    Effect.gen(function* () {
      const { getByTestId } = yield* render(
        <section data-testid="standard">
          <input data-testid="void" disabled />
        </section>,
      );

      assert.strictEqual((yield* getByTestId("standard")).tagName, "SECTION");
      const input = yield* getByTestId("void");
      assert.strictEqual(input.tagName, "INPUT");
      assert.strictEqual(input.getAttribute("disabled"), "");
    }),
  );

  scoped("applies Signal-backed attributes", () =>
    Effect.gen(function* () {
      const label = yield* Signal.make("before");
      const { getByTestId } = yield* render(<div data-testid="signal-attr" className={label} />);

      const element = yield* getByTestId("signal-attr");
      assert.strictEqual(element.className, "before");

      yield* Signal.set(label, "after");
      yield* TestClock.adjust(10);

      assert.strictEqual(element.className, "after");
    }),
  );

  scoped("binds event handlers", () =>
    Effect.gen(function* () {
      const clicks = yield* Signal.make(0);
      const { getByTestId } = yield* render(
        <button
          data-testid="event-target"
          onClick={() => Signal.update(clicks, (count) => count + 1)}
        >
          click
        </button>,
      );

      (yield* getByTestId("event-target")).dispatchEvent(
        new MouseEvent("click", { bubbles: true }),
      );
      yield* TestClock.adjust(10);

      assert.strictEqual(yield* Signal.get(clicks), 1);
    }),
  );

  scoped("delegates head hoisting", () =>
    Effect.gen(function* () {
      document.head.querySelectorAll("title").forEach((node) => node.remove());

      yield* render(<title data-testid="hoisted-title">Hoisted</title>);

      const title = document.head.querySelector("title");
      assert.isNotNull(title);
      assert.strictEqual(title?.textContent, "Hoisted");
      assert.isNull(document.body.querySelector('title[data-testid="hoisted-title"]'));
    }),
  );

  scoped("strips mode before DOM attribute application", () =>
    Effect.gen(function* () {
      const { getByTestId } = yield* render(
        <style data-testid="static-style" mode="static">
          {"body { color: red; }"}
        </style>,
      );

      assert.isFalse((yield* getByTestId("static-style")).hasAttribute("mode"));
    }),
  );

  scoped("creates SVG elements with correct namespace", () =>
    Effect.gen(function* () {
      const { getByTestId } = yield* render(
        <svg data-testid="svg-root" viewBox="0 0 24 24" width="24" height="24">
          <circle data-testid="svg-circle" cx="12" cy="12" r="10" fill="red" />
        </svg>,
      );

      const svg = yield* getByTestId("svg-root");
      assert.strictEqual(svg.tagName, "svg");
      assert.strictEqual(svg.namespaceURI, "http://www.w3.org/2000/svg");
      assert.strictEqual(svg.getAttribute("viewBox"), "0 0 24 24");

      const circle = yield* getByTestId("svg-circle");
      assert.strictEqual(circle.tagName, "circle");
      assert.strictEqual(circle.namespaceURI, "http://www.w3.org/2000/svg");
      assert.strictEqual(circle.getAttribute("fill"), "red");
    }),
  );
});
