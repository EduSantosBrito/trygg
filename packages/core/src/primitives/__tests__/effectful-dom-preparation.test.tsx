import { assert, describe, vi } from "@effect/vitest";
import { Deferred, Effect, Fiber, Schema } from "effect";
import { scoped } from "../../testing/effect-vitest.js";
import { Element } from "../element.js";
import { render } from "../../testing/index.js";
import * as Signal from "../signal.js";

class PreparationFailure extends Schema.TaggedError<PreparationFailure>()(
  "PreparationFailure",
  {},
) {}

describe("effectful DOM preparation", () => {
  for (const keyed of [false, true]) {
    for (const operation of ["update", "remove"]) {
      scoped(
        `should acquire compatible row properties without provisional DOM during ${operation} (keyed children: ${keyed})`,
        () =>
          Effect.gen(function* () {
            // Scope: compatible nested intrinsic rows still execute their Effects when inputs or indices change.
            // Assertion: retained rows update in place with one acquisition per property and no new native nodes.
            const evaluations: Array<string> = [];
            const items = yield* Signal.make([
              { id: 1, label: "old" },
              { id: 2, label: "old" },
            ]);
            const property = Effect.fnUntraced(function* (value: string) {
              evaluations.push(value);
              return value;
            });
            const { container } = yield* render(
              <ul>
                {Signal.each(
                  items,
                  (item, index) => (
                    <li data-value={property(`${item.id}:${item.label}`)}>
                      <span
                        {...(keyed ? { key: "label" } : {})}
                        data-index={property(String(index))}
                      >
                        {item.label}
                      </span>
                    </li>
                  ),
                  { key: (item) => item.id },
                )}
              </ul>,
            );
            const rows = Array.from(container.querySelectorAll("li"));
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
            evaluations.length = 0;
            yield* Signal.set(
              items,
              operation === "update"
                ? [
                    { id: 1, label: "new" },
                    { id: 2, label: "new" },
                  ]
                : [{ id: 2, label: "old" }],
            );
            assert.deepStrictEqual(
              evaluations,
              operation === "update" ? ["1:new", "0", "2:new", "1"] : ["2:old", "0"],
            );
            assert.deepStrictEqual(
              Array.from(container.querySelectorAll("li")),
              operation === "update" ? rows : [rows[1]],
            );
            assert.strictEqual(container.querySelector("span")?.getAttribute("data-index"), "0");
            assert.strictEqual(
              container.querySelector("span")?.textContent,
              operation === "update" ? "new" : "old",
            );
            assert.strictEqual(elements.mock.calls.length, 0);
            assert.strictEqual(texts.mock.calls.length, 0);
            assert.strictEqual(comments.mock.calls.length, 0);
          }),
      );
    }
  }

  for (const failure of ["typed", "interrupt"]) {
    scoped(`should release prepared values without touching DOM after ${failure} failure`, () =>
      Effect.gen(function* () {
        // Scope: a later property fails or suspends after an earlier property acquires a resource.
        // Assertion: failed preparation releases that resource, preserves committed DOM, and creates no native elements.
        const entered = yield* Deferred.make<Fiber.Fiber<unknown, unknown>>();
        const released: Array<string> = [];
        const items = yield* Signal.make([{ id: 1, label: "old" }]);
        const { container } = yield* render(
          <ul>
            {Signal.each(
              items,
              (item) => (
                <li
                  data-value={Effect.gen(function* () {
                    yield* Effect.addFinalizer(() =>
                      Effect.sync(() => {
                        released.push(item.label);
                      }),
                    );
                    return item.label;
                  })}
                  data-failure={
                    item.label === "old"
                      ? Effect.void
                      : failure === "typed"
                        ? new PreparationFailure()
                        : Effect.withFiber((fiber) =>
                            Deferred.succeed(entered, fiber).pipe(Effect.andThen(Effect.never)),
                          )
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
        const elements = vi.spyOn(document, "createElement");
        yield* Effect.addFinalizer(() => Effect.sync(() => elements.mockRestore()));
        yield* Signal.set(items, [{ id: 1, label: "new" }]);
        if (failure === "interrupt") {
          const fiber = yield* Deferred.await(entered);
          yield* Fiber.interrupt(fiber);
        }
        assert.deepStrictEqual(released, ["new"]);
        assert.strictEqual(container.querySelector("li"), row);
        assert.strictEqual(row?.getAttribute("data-value"), "old");
        assert.strictEqual(elements.mock.calls.length, 0);
      }),
    );
  }

  scoped(
    "should build a replacement without repeating properties when structure is incompatible",
    () =>
      Effect.gen(function* () {
        // Scope: a child tag change must decline preparation before acquiring any property Effects.
        // Assertion: replacement runs each property once, preserves the sibling, and releases every acquisition once.
        const evaluations: Array<string> = [];
        const releases: Array<string> = [];
        yield* Effect.scoped(
          Effect.gen(function* () {
            const items = yield* Signal.make([
              { id: 1, bold: false },
              { id: 2, bold: false },
            ]);
            const { container } = yield* render(
              <ul>
                {Signal.each(
                  items,
                  (item) => (
                    <li
                      data-value={Effect.gen(function* () {
                        const label = `${item.id}:${item.bold}`;
                        evaluations.push(label);
                        yield* Effect.addFinalizer(() =>
                          Effect.sync(() => {
                            releases.push(label);
                          }),
                        );
                        return label;
                      })}
                    >
                      {item.bold ? <b>bold</b> : <span>plain</span>}
                    </li>
                  ),
                  { key: (item) => item.id },
                )}
              </ul>,
            );
            const rows = Array.from(container.querySelectorAll("li"));
            yield* Signal.update(items, (rows) =>
              rows.map((row) => (row.id === 1 ? { ...row, bold: true } : row)),
            );
            const next = Array.from(container.querySelectorAll("li"));
            assert.notStrictEqual(next[0], rows[0]);
            assert.strictEqual(next[1], rows[1]);
            assert.strictEqual(next[0]?.getAttribute("data-value"), "1:true");
            assert.strictEqual(next[0]?.textContent, "bold");
            assert.deepStrictEqual(evaluations, ["1:false", "2:false", "1:true"]);
          }),
        );
        assert.deepStrictEqual([...releases].sort(), ["1:false", "1:true", "2:false"]);
      }),
  );

  scoped("should evaluate parent Effects before child property getters during preparation", () =>
    Effect.gen(function* () {
      // Scope: inspecting compatibility must not invoke child accessors before their parent's property Effects.
      // Assertion: the first observable property action remains the parent acquisition, with the new child value rendered.
      let label = "old";
      const observations: Array<string> = [];
      const items = yield* Signal.make([{ id: 1, label: "old" }]);
      const { container } = yield* render(
        <ul>
          {Signal.each(
            items,
            (item) => {
              const child = Element.Intrinsic({
                tag: "span",
                key: null,
                children: [],
                props: {
                  get "data-value"() {
                    observations.push(`child:${label}`);
                    return item.label;
                  },
                },
              });
              return (
                <li
                  data-value={Effect.sync(() => {
                    observations.push(`parent:${item.label}`);
                    label = item.label;
                    return label;
                  })}
                >
                  {child}
                </li>
              );
            },
            { key: (item) => item.id },
          )}
        </ul>,
      );
      observations.length = 0;
      yield* Signal.set(items, [{ id: 1, label: "new" }]);
      assert.strictEqual(observations[0], "parent:new");
      assert.strictEqual(container.querySelector("span")?.getAttribute("data-value"), "new");
    }),
  );

  for (const nested of [false, true]) {
    for (const effectful of [false, true]) {
      scoped(
        `should preserve host value conversion before child Effects (effectful: ${effectful}, nested: ${nested})`,
        () =>
          Effect.gen(function* () {
            // Scope: converting a property value can affect the state read by a subsequent child Effect.
            // Assertion: unsupported host conversions fall back before child acquisition, without repeating the parent Effect.
            let label = "old";
            let acquisitions = 0;
            const items = yield* Signal.make([{ id: 1, label: "old" }]);
            const { container } = yield* render(
              <ul>
                {Signal.each(
                  items,
                  (item) => {
                    const value = {
                      toString() {
                        label = item.label;
                        return label;
                      },
                    };
                    return (
                      <li
                        data-force={Effect.sync(() => {
                          acquisitions++;
                          return "row";
                        })}
                        data-value={nested ? undefined : effectful ? Effect.succeed(value) : value}
                      >
                        {nested ? (
                          <span data-value={effectful ? Effect.succeed(value) : value}>
                            <b data-observed={Effect.sync(() => label)}>row</b>
                          </span>
                        ) : (
                          <span data-observed={Effect.sync(() => label)}>row</span>
                        )}
                      </li>
                    );
                  },
                  { key: (item) => item.id },
                )}
              </ul>,
            );
            yield* Signal.set(items, [{ id: 1, label: "new" }]);
            assert.strictEqual(acquisitions, 2);
            assert.strictEqual(
              container.querySelector("[data-observed]")?.getAttribute("data-observed"),
              "new",
            );
          }),
      );
    }
  }
});
