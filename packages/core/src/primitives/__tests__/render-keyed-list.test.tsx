import { assert, describe } from "@effect/vitest";
import { Effect, Exit, Scope } from "effect";
import { TestClock } from "effect/testing";
import { scoped } from "../../testing/effect-vitest.js";
import { render } from "../../testing/index.js";
import { computeLIS } from "../render-keyed-list.js";
import * as Signal from "../signal.js";

describe("computeLIS", () => {
  scoped("returns input indices for the longest increasing subsequence", () =>
    Effect.sync(() => {
      assert.deepEqual(computeLIS([]), []);
      assert.deepEqual(computeLIS([0, 1, 2]), [0, 1, 2]);
      assert.deepEqual(computeLIS([2, 0, 1]), [1, 2]);
      assert.deepEqual(computeLIS([3, 1, 2, 0]), [1, 2]);
    }),
  );
});

describe("renderKeyedList", () => {
  scoped("renders empty lists and inserts at head, tail, and middle", () =>
    Effect.gen(function* () {
      const items = yield* Signal.make<ReadonlyArray<string>>([]);
      const { container } = yield* render(
        <div>
          {Signal.each(
            items,
            (item) => (
              <span data-id={item}>{item}</span>
            ),
            { key: (item) => item },
          )}
        </div>,
      );

      const ids = () =>
        Array.from(container.querySelectorAll("[data-id]")).map((el) => el.textContent);

      assert.deepEqual(ids(), []);

      yield* Signal.set(items, ["b"]);
      yield* TestClock.adjust(10);
      assert.deepEqual(ids(), ["b"]);

      yield* Signal.set(items, ["a", "b", "d"]);
      yield* TestClock.adjust(10);
      assert.deepEqual(ids(), ["a", "b", "d"]);

      yield* Signal.set(items, ["a", "b", "c", "d"]);
      yield* TestClock.adjust(10);
      assert.deepEqual(ids(), ["a", "b", "c", "d"]);
    }),
  );

  scoped("removes items and preserves key-based DOM identity on reorder", () =>
    Effect.gen(function* () {
      const items = yield* Signal.make<ReadonlyArray<string>>(["a", "b", "c", "d"]);
      const { container } = yield* render(
        <div>
          {Signal.each(
            items,
            (item) => (
              <span data-id={item}>{item}</span>
            ),
            { key: (item) => item },
          )}
        </div>,
      );

      const ids = () =>
        Array.from(container.querySelectorAll("[data-id]")).map((el) => el.getAttribute("data-id"));
      const originalC = container.querySelector('[data-id="c"]');

      yield* Signal.set(items, ["d", "b", "c", "a"]);
      yield* TestClock.adjust(10);

      assert.deepEqual(ids(), ["d", "b", "c", "a"]);
      assert.strictEqual(container.querySelector('[data-id="c"]'), originalC);

      yield* Signal.set(items, ["d", "c"]);
      yield* TestClock.adjust(10);

      assert.deepEqual(ids(), ["d", "c"]);
      assert.strictEqual(container.querySelector('[data-id="c"]'), originalC);
    }),
  );

  scoped("cleans source and item subscriptions on removal and unmount", () =>
    Effect.gen(function* () {
      const label = yield* Signal.make("A");
      const items = yield* Signal.make<ReadonlyArray<{ readonly id: string }>>([{ id: "a" }]);
      const scope = yield* Scope.make();

      yield* render(
        <div>
          {Signal.each(
            items,
            (item) =>
              Effect.gen(function* () {
                const value = yield* Signal.get(label);
                return <span data-id={item.id}>{value}</span>;
              }),
            { key: (item) => item.id },
          )}
        </div>,
      ).pipe(Scope.provide(scope));

      yield* TestClock.adjust(10);
      assert.isAbove(label._listeners.size, 0);
      assert.isAbove(items._listeners.size, 0);

      yield* Signal.set(items, []);
      yield* TestClock.adjust(10);
      assert.strictEqual(label._listeners.size, 0);

      yield* Scope.close(scope, Exit.void);
      assert.strictEqual(items._listeners.size, 0);
    }),
  );
});
