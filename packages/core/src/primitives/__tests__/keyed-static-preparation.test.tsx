import { assert, describe, vi } from "@effect/vitest";
import { Effect, Schema } from "effect";
import { scoped } from "../../testing/effect-vitest.js";
import { render } from "../../testing/index.js";
import * as Signal from "../signal.js";

class RowPreparationFailure extends Schema.TaggedError<RowPreparationFailure>()(
  "RowPreparationFailure",
  { id: Schema.Number },
) {}

describe("keyed static reconciliation preparation", () => {
  scoped("should acquire effectful props during preparation before a later keyed row fails", () =>
    Effect.gen(function* () {
      // Scope: same-structure props can introduce scoped Effects, which must run during preparation.
      // Assertion: a later failed row releases the earlier property acquisition and preserves committed DOM.
      const items = yield* Signal.make([
        { id: 1, effectful: false, fail: false },
        { id: 2, effectful: false, fail: false },
      ]);
      let evaluations = 0;
      let releases = 0;
      const title = Effect.gen(function* () {
        evaluations++;
        yield* Effect.addFinalizer(() =>
          Effect.sync(() => {
            releases++;
          }),
        );
        return "resolved";
      });
      const { container } = yield* render(
        <ul>
          {Signal.each(
            items,
            (row) =>
              Effect.gen(function* () {
                if (row.fail) return yield* new RowPreparationFailure({ id: row.id });
                return <li data-value={row.effectful ? title : "plain"}>row</li>;
              }),
            { key: (row) => row.id },
          )}
        </ul>,
      );
      const previous = Array.from(container.querySelectorAll("li"));
      yield* Signal.set(items, [
        { id: 1, effectful: true, fail: false },
        { id: 2, effectful: false, fail: true },
      ]);
      yield* Effect.yieldNow;
      assert.strictEqual(evaluations, 1);
      assert.strictEqual(releases, 1);
      assert.deepStrictEqual(Array.from(container.querySelectorAll("li")), previous);
      assert.strictEqual(previous[0]?.getAttribute("data-value"), "plain");
      yield* Signal.set(items, [
        { id: 1, effectful: true, fail: false },
        { id: 2, effectful: false, fail: false },
      ]);
      yield* Effect.yieldNow;
      assert.strictEqual(evaluations, 2);
      assert.strictEqual(container.querySelector("li")?.getAttribute("data-value"), "resolved");
      assert.notStrictEqual(container.querySelector("li"), previous[0]);
    }),
  );

  scoped("should repair properties after both native patch and rollback fail", () =>
    Effect.gen(function* () {
      // Scope: rollback can itself stop before restoring the first changed attribute.
      // Assertion: retrying the committed values repairs the retained node and removes attempted attributes.
      const items = yield* Signal.make([{ id: 1, label: "old", title: "old" }]);
      const { container } = yield* render(
        <ul>
          {Signal.each(
            items,
            (row) => (
              <li
                data-label={row.label}
                data-attempt={row.label === "new" ? "yes" : undefined}
                title={row.title}
              >
                {row.label}
              </li>
            ),
            { key: (row) => row.id },
          )}
        </ul>,
      );
      const node = container.querySelector("li");
      if (node === null) return assert.fail("Expected row");
      const originalSet = node.setAttribute.bind(node);
      const setter = vi.spyOn(node, "setAttribute").mockImplementation((name, value) => {
        if (name === "title" || (name === "data-label" && value === "old")) decodeURIComponent("%");
        originalSet(name, value);
      });
      const removeAttribute = node.removeAttribute.bind(node);
      const removal = vi.spyOn(node, "removeAttribute").mockImplementation((name) => {
        if (name === "data-attempt") decodeURIComponent("%");
        removeAttribute(name);
      });
      yield* Effect.addFinalizer(() =>
        Effect.sync(() => {
          setter.mockRestore();
          removal.mockRestore();
        }),
      );
      yield* Signal.set(items, [{ id: 1, label: "new", title: "new" }]);
      yield* Effect.yieldNow;
      assert.strictEqual(node.getAttribute("data-label"), "new");
      assert.strictEqual(node.getAttribute("data-attempt"), "yes");
      setter.mockRestore();
      removal.mockRestore();
      yield* Signal.set(items, [{ id: 1, label: "old", title: "old" }]);
      yield* Effect.yieldNow;
      assert.strictEqual(container.querySelector("li"), node);
      assert.strictEqual(node.getAttribute("data-label"), "old");
      assert.strictEqual(node.getAttribute("data-attempt"), null);
      assert.strictEqual(node.title, "old");
    }),
  );

  scoped("should release a nested subscription while native patch and rollback both fail", () =>
    Effect.gen(function* () {
      // Scope: a child acquires a subscription before failing; rollback fails during listener removal.
      // Assertion: removal releases the partial acquisition even though ancestor reconciliation never returned.
      const count = yield* Signal.make(0);
      const items = yield* Signal.make([{ id: 1, active: false }]);
      const { container } = yield* render(
        <ul>
          {Signal.each(
            items,
            (row) => (
              <li>
                <span
                  {...(row.active ? { onClick: () => Effect.void } : {})}
                  data-count={row.active ? count : 0}
                  title={row.active ? "blocked" : "old"}
                >
                  row
                </span>
              </li>
            ),
            { key: (row) => row.id },
          )}
        </ul>,
      );
      const node = container.querySelector("span");
      if (node === null) return assert.fail("Expected nested node");
      const originalSet = node.setAttribute.bind(node);
      const setter = vi.spyOn(node, "setAttribute").mockImplementation((name, value) => {
        if (name === "title" && value === "blocked") decodeURIComponent("%");
        originalSet(name, value);
      });
      const removal = vi.spyOn(node, "removeEventListener").mockImplementation(() => {
        decodeURIComponent("%");
      });
      yield* Effect.addFinalizer(() =>
        Effect.sync(() => {
          setter.mockRestore();
          removal.mockRestore();
        }),
      );
      yield* Signal.set(items, [{ id: 1, active: true }]);
      yield* Effect.yieldNow;
      yield* Signal.set(items, []);
      yield* Effect.yieldNow;
      assert.strictEqual(container.querySelector("li"), null);
      setter.mockRestore();
      removal.mockRestore();
      yield* Signal.set(count, 1);
      assert.strictEqual(node.getAttribute("data-count"), "0");
    }),
  );

  scoped(
    "should replace a structurally changed row while preserving its signal and releasing old DOM subscriptions",
    () =>
      Effect.gen(function* () {
        // Scope: incompatible static structure must take the full staging/replacement path.
        // Assertion: replacement preserves the keyed Signal, updates only the new node, and leaves siblings intact.
        const items = yield* Signal.make<ReadonlyArray<{ id: number; bold: boolean }>>([
          { id: 1, bold: false },
          { id: 2, bold: false },
        ]);
        const signals = new Map<number, Signal.Signal<number>>();
        const { container } = yield* render(
          <ul>
            {Signal.each(
              items,
              (row) =>
                Effect.gen(function* () {
                  const count = yield* Signal.make(0);
                  const previous = signals.get(row.id);
                  if (previous !== undefined) assert.strictEqual(count, previous);
                  signals.set(row.id, count);
                  return <li data-count={count}>{row.bold ? <b>bold</b> : <span>plain</span>}</li>;
                }),
              { key: (row) => row.id },
            )}
          </ul>,
        );
        const original = Array.from(container.querySelectorAll("li"));
        yield* Signal.update(items, (rows) =>
          rows.map((row) => (row.id === 1 ? { ...row, bold: true } : row)),
        );
        yield* Effect.yieldNow;
        const updated = Array.from(container.querySelectorAll("li"));
        assert.notStrictEqual(updated[0], original[0]);
        assert.strictEqual(updated[1], original[1]);
        assert.strictEqual(updated[0]?.textContent, "bold");
        const signal = signals.get(1);
        if (signal === undefined) return assert.fail("Expected row signal");
        yield* Signal.set(signal, 1);
        assert.strictEqual(updated[0]?.getAttribute("data-count"), "1");
        assert.strictEqual(original[0]?.getAttribute("data-count"), "0");
      }),
  );

  scoped(
    "should restore partially applied properties and earlier rows after native reconciliation failure",
    () =>
      Effect.gen(function* () {
        // Scope: the second live row rejects a property after another property and the first row were patched.
        // Assertion: rollback restores all old nodes, attributes, and text; a later update remains usable.
        const items = yield* Signal.make<
          ReadonlyArray<{ id: number; label: string; title: string }>
        >([
          { id: 1, label: "one", title: "first" },
          { id: 2, label: "two", title: "second" },
        ]);
        const { container } = yield* render(
          <ul>
            {Signal.each(
              items,
              (row) => (
                <li data-label={row.label} title={row.title}>
                  {row.label}
                </li>
              ),
              { key: (row) => row.id },
            )}
          </ul>,
        );
        const original = Array.from(container.querySelectorAll("li"));
        const second = original[1];
        if (second === undefined) return assert.fail("Expected second row");
        const setAttribute = second.setAttribute.bind(second);
        const setter = vi.spyOn(second, "setAttribute").mockImplementation((name, value) => {
          // Deliberately reject a host write after data-label has already changed.
          if (name === "title" && value === "blocked") decodeURIComponent("%");
          setAttribute(name, value);
        });
        yield* Effect.addFinalizer(() => Effect.sync(() => setter.mockRestore()));
        yield* Signal.set(items, [
          { id: 1, label: "new-one", title: "new-first" },
          { id: 2, label: "new-two", title: "blocked" },
        ]);
        yield* Effect.yieldNow;
        assert.deepStrictEqual(Array.from(container.querySelectorAll("li")), original);
        assert.strictEqual(container.textContent, "onetwo");
        assert.deepStrictEqual(
          original.map((node) => node.getAttribute("data-label")),
          ["one", "two"],
        );
        assert.deepStrictEqual(
          original.map((node) => node.title),
          ["first", "second"],
        );
        yield* Signal.set(items, [
          { id: 1, label: "next-one", title: "next-first" },
          { id: 2, label: "next-two", title: "next-second" },
        ]);
        yield* Effect.yieldNow;
        assert.strictEqual(container.textContent, "next-onenext-two");
      }),
  );

  scoped("should reuse DOM while executing every changed item and index render exactly once", () =>
    Effect.gen(function* () {
      // Scope: production Signal.each and static renderer handle removal, data change, and reordering.
      // Assertion: correct index/text and stable nodes require no provisional DOM construction.
      const initial = Array.from({ length: 5 }, (_, id) => ({ id, label: `row-${id}` }));
      const items = yield* Signal.make<ReadonlyArray<(typeof initial)[number]>>(initial);
      let calls = 0;
      const { container } = yield* render(
        <ul>
          {Signal.each(
            items,
            (row, index) =>
              Effect.sync(() => {
                calls++;
                return (
                  <li data-id={row.id}>
                    {row.label}:{index}
                  </li>
                );
              }),
            { key: (row) => row.id },
          )}
        </ul>,
      );
      const original = Array.from(container.querySelectorAll("li"));
      assert.strictEqual(calls, 5);
      const elements = vi.spyOn(document, "createElement");
      const texts = vi.spyOn(document, "createTextNode");
      const comments = vi.spyOn(document, "createComment");
      yield* Effect.addFinalizer(() =>
        Effect.sync(() => {
          elements.mockRestore();
          texts.mockRestore();
          comments.mockRestore();
        }),
      );

      const remaining = initial.filter((row) => row.id !== 1);
      yield* Signal.set(items, remaining);
      yield* Effect.yieldNow;
      assert.strictEqual(calls, 8);
      assert.deepStrictEqual(
        Array.from(container.querySelectorAll("li")),
        original.filter((_, index) => index !== 1),
      );
      assert.deepStrictEqual(
        Array.from(container.querySelectorAll("li"), (node) => node.textContent),
        ["row-0:0", "row-2:1", "row-3:2", "row-4:3"],
      );

      const changed = remaining.map((row) => (row.id === 2 ? { ...row, label: "changed" } : row));
      yield* Signal.set(items, changed);
      yield* Effect.yieldNow;
      assert.strictEqual(calls, 9);
      yield* Signal.set(items, changed.toReversed());
      yield* Effect.yieldNow;
      assert.strictEqual(calls, 13);
      assert.deepStrictEqual(
        Array.from(container.querySelectorAll("li"), (node) => node.textContent),
        ["row-4:0", "row-3:1", "changed:2", "row-0:3"],
      );
      assert.strictEqual(elements.mock.calls.length, 0);
      assert.strictEqual(texts.mock.calls.length, 0);
      assert.strictEqual(comments.mock.calls.length, 0);
    }),
  );

  scoped(
    "should release prepared acquisitions and preserve committed DOM when a later row fails",
    () =>
      Effect.gen(function* () {
        // Scope: a later failed row aborts the prepared static update before reconciliation starts.
        // Assertion: old nodes/text survive, new resources close, and a subsequent valid update succeeds.
        const items = yield* Signal.make<
          ReadonlyArray<{ id: number; label: string; fail?: boolean }>
        >([
          { id: 1, label: "one" },
          { id: 2, label: "two" },
        ]);
        const released: Array<string> = [];
        const { container } = yield* render(
          <ul>
            {Signal.each(
              items,
              (row) =>
                Effect.gen(function* () {
                  yield* Effect.addFinalizer(() =>
                    Effect.sync(() => {
                      released.push(row.label);
                    }),
                  );
                  if (row.fail) return yield* new RowPreparationFailure({ id: row.id });
                  return <li>{row.label}</li>;
                }),
              { key: (row) => row.id },
            )}
          </ul>,
        );
        const original = Array.from(container.querySelectorAll("li"));
        yield* Signal.set(items, [
          { id: 1, label: "new-one" },
          { id: 2, label: "failed-two", fail: true },
        ]);
        yield* Effect.yieldNow;
        assert.deepStrictEqual(Array.from(container.querySelectorAll("li")), original);
        assert.strictEqual(container.textContent, "onetwo");
        assert.sameMembers(released, ["new-one", "failed-two"]);
        yield* Signal.set(items, [
          { id: 1, label: "next-one" },
          { id: 2, label: "next-two" },
        ]);
        yield* Effect.yieldNow;
        assert.strictEqual(container.textContent, "next-onenext-two");
        assert.deepStrictEqual(Array.from(container.querySelectorAll("li")), original);
      }),
  );
});
