import { assert, describe } from "@effect/vitest";
import { Effect } from "effect";
import { TestClock } from "effect/testing";
import { scoped } from "../../testing/effect-vitest.js";
import { render } from "../../testing/index.js";
import * as Signal from "../signal.js";

const measureErrorConstructions = <A, E, R>(
  effect: Effect.Effect<A, E, R>,
): Effect.Effect<{ readonly value: A; readonly count: number }, E, R> =>
  Effect.acquireUseRelease(
    Effect.sync(() => {
      const NativeError = globalThis.Error;
      let count = 0;

      function CountingError(message?: string): Error {
        count++;
        return new NativeError(message);
      }

      Object.setPrototypeOf(CountingError, NativeError);
      CountingError.prototype = NativeError.prototype;

      Object.defineProperty(globalThis, "Error", {
        value: CountingError,
        configurable: true,
        writable: true,
      });

      return {
        count: () => count,
        restore: () => {
          Object.defineProperty(globalThis, "Error", {
            value: NativeError,
            configurable: true,
            writable: true,
          });
        },
      };
    }),
    ({ count }) => effect.pipe(Effect.map((value) => ({ value, count: count() }))),
    ({ restore }) => Effect.sync(restore),
  );

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

  scoped("avoids per-intrinsic stack-capture work while rendering benchmark rows", () =>
    Effect.gen(function* () {
      // Test: should avoid per-intrinsic stack-capture work while rendering benchmark rows.
      // Scope: locks the RF-2 DOM render pass with a deterministic proxy for traced-span overhead.
      // Assertion: rendering a js-framework-benchmark-shaped table row performs only a small fixed number of Error stack captures.
      const row = (
        <table>
          <tbody>
            <tr>
              <td className="col-md-1">1</td>
              <td className="col-md-4">
                <a>pretty red table</a>
              </td>
              <td className="col-md-1">
                <a>
                  <span className="glyphicon glyphicon-remove" aria-hidden="true" />
                </a>
              </td>
              <td className="col-md-6" />
            </tr>
          </tbody>
        </table>
      );

      const { value, count } = yield* measureErrorConstructions(render(row));

      assert.strictEqual(value.container.querySelectorAll("tr").length, 1);
      assert.isAtMost(
        count,
        20,
        `expected benchmark row render to avoid stack captures, got ${count}`,
      );
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
