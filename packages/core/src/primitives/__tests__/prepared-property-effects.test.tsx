import { assert, describe, vi } from "@effect/vitest";
import { Context, Deferred, Effect, Exit, Fiber } from "effect";
import { scoped } from "../../testing/effect-vitest.js";
import { render } from "../../testing/index.js";
import { Element } from "../element.js";
import { unsafeWidenContext } from "../../internal/unsafe.js";
import * as Signal from "../signal.js";

describe("prepared property Effects", () => {
  scoped("should evaluate each property once when committing a prepared keyed row", () =>
    Effect.gen(function* () {
      // Scope: an existing effectful intrinsic is prepared off-DOM before in-place reconciliation.
      // Assertion: commit reuses acquired property values, preserves node identity, and releases every acquisition once.
      const evaluations: Array<string> = [];
      const releases: Array<string> = [];
      yield* Effect.scoped(
        Effect.gen(function* () {
          const items = yield* Signal.make([{ id: 1, label: "old" }]);
          const property = Effect.fnUntraced(function* (label: string) {
            evaluations.push(label);
            yield* Effect.addFinalizer(() =>
              Effect.sync(() => {
                releases.push(label);
              }),
            );
            return label;
          });
          const { container } = yield* render(
            <ul>
              {Signal.each(
                items,
                (row) => (
                  <li data-label={property(row.label)}>
                    <span data-label={property(`child:${row.label}`)}>row</span>
                  </li>
                ),
                { key: (row) => row.id },
              )}
            </ul>,
          );
          const row = container.querySelector("li");
          const child = container.querySelector("span");
          yield* Signal.set(items, [{ id: 1, label: "new" }]);
          assert.deepStrictEqual(evaluations, ["old", "child:old", "new", "child:new"]);
          assert.strictEqual(container.querySelector("li"), row);
          assert.strictEqual(container.querySelector("span"), child);
          assert.strictEqual(row?.getAttribute("data-label"), "new");
          assert.strictEqual(child?.getAttribute("data-label"), "child:new");
        }),
      );
      assert.deepStrictEqual([...releases].sort(), ["child:new", "child:old", "new", "old"]);
    }),
  );

  scoped(
    "should restore acquired values without rerunning Effects after a later native patch fails",
    () =>
      Effect.gen(function* () {
        // Scope: a later row fails after the first live row has already reconciled.
        // Assertion: rollback preserves node identity and old values without repeated acquisitions; retry succeeds.
        const evaluations: Array<string> = [];
        const items = yield* Signal.make([
          { id: 1, label: "old" },
          { id: 2, label: "old" },
        ]);
        const { container } = yield* render(
          <ul>
            {Signal.each(
              items,
              (row) => (
                <li
                  data-label={Effect.sync(() => {
                    evaluations.push(`${row.id}:${row.label}`);
                    return row.label;
                  })}
                >
                  {row.id}
                </li>
              ),
              { key: (row) => row.id },
            )}
          </ul>,
        );
        const rows = Array.from(container.querySelectorAll("li"));
        const second = rows[1];
        if (second === undefined) return assert.fail("Expected second row");
        const set = second.setAttribute.bind(second);
        const setter = vi.spyOn(second, "setAttribute").mockImplementation((name, value) => {
          if (value === "new") decodeURIComponent("%");
          set(name, value);
        });
        yield* Effect.addFinalizer(() => Effect.sync(() => setter.mockRestore()));
        yield* Signal.set(items, [
          { id: 1, label: "new" },
          { id: 2, label: "new" },
        ]);
        assert.deepStrictEqual(evaluations, ["1:old", "2:old", "1:new", "2:new"]);
        assert.deepStrictEqual(Array.from(container.querySelectorAll("li")), rows);
        assert.deepStrictEqual(
          rows.map((row) => row.getAttribute("data-label")),
          ["old", "old"],
        );
        setter.mockRestore();
        yield* Signal.set(items, [
          { id: 1, label: "retry" },
          { id: 2, label: "retry" },
        ]);
        assert.deepStrictEqual(evaluations, [
          "1:old",
          "2:old",
          "1:new",
          "2:new",
          "1:retry",
          "2:retry",
        ]);
        assert.deepStrictEqual(
          rows.map((row) => row.getAttribute("data-label")),
          ["retry", "retry"],
        );
      }),
  );

  scoped("should acquire a shared Effect once per property on each prepared update", () =>
    Effect.gen(function* () {
      // Scope: identical Effect objects can return different values for separate bindings and renders.
      // Assertion: preparation preserves per-property values even when the original props compare equal.
      let evaluations = 0;
      const property = Effect.sync(() => String(++evaluations));
      const items = yield* Signal.make([{ id: 1, revision: 0 }]);
      const { container } = yield* render(
        <ul>
          {Signal.each(
            items,
            () => (
              <li data-a={property} data-b={property}>
                row
              </li>
            ),
            { key: (row) => row.id },
          )}
        </ul>,
      );
      const row = container.querySelector("li");
      yield* Signal.set(items, [{ id: 1, revision: 1 }]);
      assert.strictEqual(evaluations, 4);
      assert.strictEqual(container.querySelector("li"), row);
      assert.strictEqual(row?.getAttribute("data-a"), "3");
      assert.strictEqual(row?.getAttribute("data-b"), "4");
    }),
  );

  scoped("should reuse an acquired Signal and release its live binding on removal", () =>
    Effect.gen(function* () {
      // Scope: an Effect property returns a distinct reactive source for each prepared render.
      // Assertion: the retained node follows the new source, ignores the old one, and unsubscribes on removal.
      const oldValue = yield* Signal.make("old");
      const newValue = yield* Signal.make("new");
      let evaluations = 0;
      const items = yield* Signal.make([{ id: 1, source: oldValue }]);
      const { container } = yield* render(
        <ul>
          {Signal.each(
            items,
            (item) => (
              <li
                data-value={Effect.sync(() => {
                  evaluations++;
                  return item.source;
                })}
              >
                row
              </li>
            ),
            { key: (item) => item.id },
          )}
        </ul>,
      );
      const row = container.querySelector("li");
      yield* Signal.set(items, [{ id: 1, source: newValue }]);
      assert.strictEqual(evaluations, 2);
      yield* Signal.set(oldValue, "stale");
      assert.strictEqual(row?.getAttribute("data-value"), "new");
      yield* Signal.set(newValue, "live");
      assert.strictEqual(row?.getAttribute("data-value"), "live");
      yield* Signal.set(items, []);
      yield* Signal.set(newValue, "removed");
      assert.strictEqual(row?.getAttribute("data-value"), "live");
    }),
  );

  scoped("should retain prepared values for keyed children after their order changes", () =>
    Effect.gen(function* () {
      // Scope: child snapshots follow the prepared order, independently of the old child slot indices.
      // Assertion: both keyed child nodes survive reordering and each new property executes once.
      const evaluations: Array<string> = [];
      const items = yield* Signal.make([{ id: 1, labels: ["a", "b"] }]);
      const { container } = yield* render(
        <ul>
          {Signal.each(
            items,
            (item) => (
              <li data-row={Effect.succeed("row")}>
                {item.labels.map((label) => (
                  <span
                    key={label}
                    data-value={Effect.sync(() => {
                      evaluations.push(label);
                      return label;
                    })}
                  >
                    {label}
                  </span>
                ))}
              </li>
            ),
            { key: (item) => item.id },
          )}
        </ul>,
      );
      const children = Array.from(container.querySelectorAll("span"));
      yield* Signal.set(items, [{ id: 1, labels: ["b", "a"] }]);
      assert.deepStrictEqual(evaluations, ["a", "b", "b", "a"]);
      assert.deepStrictEqual(Array.from(container.querySelectorAll("span")), [
        children[1],
        children[0],
      ]);
    }),
  );

  scoped("should reuse prepared property values when inserting a new keyed child", () =>
    Effect.gen(function* () {
      // Scope: a retained parent needs a new child slot after preparation already acquired that child's property.
      // Assertion: inserting the new child executes its Effect once and preserves the original sibling.
      const evaluations: Array<string> = [];
      const items = yield* Signal.make([{ id: 1, labels: ["a"] }]);
      const { container } = yield* render(
        <ul>
          {Signal.each(
            items,
            (item) => (
              <li>
                {item.labels.map((label) => (
                  <span
                    key={label}
                    data-value={Effect.sync(() => {
                      evaluations.push(label);
                      return label;
                    })}
                  >
                    {label}
                  </span>
                ))}
              </li>
            ),
            { key: (item) => item.id },
          )}
        </ul>,
      );
      const first = container.querySelector("span");
      yield* Signal.set(items, [{ id: 1, labels: ["a", "b"] }]);
      assert.deepStrictEqual(evaluations, ["a", "a", "b"]);
      assert.strictEqual(container.querySelector("span"), first);
      assert.deepStrictEqual(
        Array.from(container.querySelectorAll("span"), (node) => node.getAttribute("data-value")),
        ["a", "b"],
      );
    }),
  );

  scoped("should preserve undefined and nested Effect results without evaluating them again", () =>
    Effect.gen(function* () {
      // Scope: a prepared value can be undefined or itself an Effect; neither means a missing acquisition.
      // Assertion: outer properties execute once per render and an Effect returned as a value never executes.
      let outerEvaluations = 0;
      let innerEvaluations = 0;
      const inner = Effect.sync(() => {
        innerEvaluations++;
        return "inner";
      });
      const items = yield* Signal.make([{ id: 1, revision: 0 }]);
      const { container } = yield* render(
        <ul>
          {Signal.each(
            items,
            () => (
              <li
                data-absent={Effect.sync(() => {
                  outerEvaluations++;
                  return undefined;
                })}
                data-nested={Effect.sync(() => {
                  outerEvaluations++;
                  return inner;
                })}
              >
                row
              </li>
            ),
            { key: (item) => item.id },
          )}
        </ul>,
      );
      const row = container.querySelector("li");
      const initialNested = row?.getAttribute("data-nested");
      yield* Signal.set(items, [{ id: 1, revision: 1 }]);
      assert.strictEqual(outerEvaluations, 4);
      assert.strictEqual(innerEvaluations, 0);
      assert.strictEqual(row?.getAttribute("data-absent"), null);
      assert.strictEqual(row?.getAttribute("data-nested"), initialNested);
    }),
  );

  for (const wrapper of ["provider", "fragment"]) {
    scoped(`should retain prepared properties through a ${wrapper} boundary`, () =>
      Effect.gen(function* () {
        // Scope: wrapper results participate in keyed reconciliation and must forward property acquisitions.
        // Assertion: nested intrinsic Effects execute once per render with retained node identity.
        let evaluations = 0;
        const items = yield* Signal.make([{ id: 1, label: "old" }]);
        const { container } = yield* render(
          <ul>
            {Signal.each(
              items,
              (item) => {
                const child = (
                  <li
                    data-value={Effect.sync(() => {
                      evaluations++;
                      return item.label;
                    })}
                  >
                    row
                  </li>
                );
                return wrapper === "provider"
                  ? Element.Provide({ context: unsafeWidenContext(Context.empty()), child })
                  : Element.Fragment({ children: [child] });
              },
              { key: (item) => item.id },
            )}
          </ul>,
        );
        const row = container.querySelector("li");
        yield* Signal.set(items, [{ id: 1, label: "new" }]);
        assert.strictEqual(evaluations, 2);
        assert.strictEqual(container.querySelector("li"), row);
        assert.strictEqual(row?.getAttribute("data-value"), "new");
      }),
    );
  }

  scoped("should release prepared property resources while an update is interrupted", () =>
    Effect.gen(function* () {
      // Scope: a later property suspends after an earlier property acquires a scoped resource.
      // Assertion: interruption releases only the failed preparation and leaves the committed DOM usable for retry.
      const entered = yield* Deferred.make<Fiber.Fiber<unknown, unknown>>();
      const evaluations: Array<string> = [];
      const releases: Array<string> = [];
      const items = yield* Signal.make([{ id: 1, label: "old", pending: false }]);
      const { container } = yield* render(
        <ul>
          {Signal.each(
            items,
            (item) => (
              <li
                data-value={Effect.gen(function* () {
                  evaluations.push(item.label);
                  yield* Effect.addFinalizer(() =>
                    Effect.sync(() => {
                      releases.push(item.label);
                    }),
                  );
                  return item.label;
                })}
                data-pending={
                  item.pending
                    ? Effect.withFiber((fiber) =>
                        Deferred.succeed(entered, fiber).pipe(Effect.andThen(Effect.never)),
                      )
                    : Effect.void
                }
              >
                row
              </li>
            ),
            { key: (item) => item.id },
          )}
        </ul>,
      );
      const row = container.querySelector("li");
      yield* Signal.set(items, [{ id: 1, label: "pending", pending: true }]);
      const fiber = yield* Deferred.await(entered);
      yield* Fiber.interrupt(fiber);
      const exit = yield* Fiber.await(fiber);
      assert.isTrue(Exit.hasInterrupts(exit));
      assert.deepStrictEqual(evaluations, ["old", "pending"]);
      assert.deepStrictEqual(releases, ["pending"]);
      assert.strictEqual(container.querySelector("li"), row);
      assert.strictEqual(row?.getAttribute("data-value"), "old");
      yield* Signal.set(items, [{ id: 1, label: "retry", pending: false }]);
      assert.deepStrictEqual(evaluations, ["old", "pending", "retry"]);
      assert.strictEqual(row?.getAttribute("data-value"), "retry");
    }),
  );
});
