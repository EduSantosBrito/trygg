import { assert, describe } from "@effect/vitest";
import { Effect } from "effect";
import * as References from "effect/References";
import { scoped } from "../../testing/effect-vitest.js";
import { render } from "../../testing/index.js";
import * as Trace from "../../trace/index.js";
import * as Signal from "../signal.js";

describe("reconciliation operation events", () => {
  scoped("should count insertion and replacement in the published list event", () =>
    Effect.gen(function* () {
      // Scope: one publication can insert a row and replace a structurally incompatible row.
      // Assertion: the event reports committed work and distinguishes replacement from in-place reconciliation.
      const first = { id: 1, expanded: false };
      const second = { id: 2, expanded: false };
      const items = yield* Signal.make([first, second]);
      const { container } = yield* render(
        <ul>
          {Signal.each(
            items,
            (row) => (
              <li data-id={Effect.succeed(row.id)}>
                <span>{row.id}</span>
                {row.expanded ? <span>extra</span> : null}
              </li>
            ),
            { key: (row) => row.id },
          )}
        </ul>,
      );
      const before = Array.from(container.querySelectorAll("li"));
      const recorder = Trace.makeRecorder();
      yield* Trace.record(
        Signal.set(items, [{ id: 1, expanded: true }, second, { id: 3, expanded: false }]),
        recorder,
      );
      const published = recorder.records().filter((record) => record.name === "keyedList.reorder");
      assert.deepStrictEqual(
        published.map((record) => record.payload),
        [
          {
            total_items: 3,
            moves: 2,
            stable_nodes: 1,
            inserted: 1,
            removed: 0,
            reconciled: 0,
            replaced: 1,
          },
        ],
      );
      const after = Array.from(container.querySelectorAll("li"));
      assert.notStrictEqual(after[0], before[0]);
      assert.strictEqual(after[1], before[1]);
      assert.strictEqual(after.length, 3);
    }),
  );
  for (const size of [3, 12]) {
    for (const keyedChildren of [false, true]) {
      scoped(
        `should publish one operation event instead of child step events (${size} rows, keyed children: ${keyedChildren})`,
        () =>
          Effect.gen(function* () {
            // Scope: removing a row reconciles every surviving row whose index changed.
            // Assertion: default-level telemetry stays bounded, explains the committed work, and preserves DOM identity.
            const rows = Array.from({ length: size }, (_, index) => index);
            const items = yield* Signal.make(rows);
            const { container } = yield* render(
              <ul>
                {Signal.each(
                  items,
                  (row) => (
                    <li data-id={Effect.succeed(row)}>
                      <span {...(keyedChildren ? { key: "first" } : {})}>{row}</span>
                      <span>second</span>
                      <span>third</span>
                    </li>
                  ),
                  { key: (row) => row },
                )}
              </ul>,
            );
            const previous = Array.from(container.querySelectorAll("li"));
            const recorder = Trace.makeRecorder();
            yield* Trace.record(
              Signal.set(
                items,
                rows.filter((row) => row !== 1),
              ).pipe(Effect.provideService(References.MinimumLogLevel, "Info")),
              recorder,
            );
            const records = recorder.records();
            assert.deepStrictEqual(
              records.map((record) => record.name),
              ["keyedList.reorder"],
            );
            assert.deepStrictEqual(
              records
                .filter((record) => record.name === "keyedList.reorder")
                .map((record) => record.payload),
              [
                {
                  total_items: size - 1,
                  moves: 0,
                  stable_nodes: size - 1,
                  inserted: 0,
                  removed: 1,
                  reconciled: size - 2,
                  replaced: 0,
                },
              ],
            );
            assert.deepStrictEqual(
              Array.from(container.querySelectorAll("li")),
              previous.filter((_, index) => index !== 1),
            );
          }),
      );
    }
  }
});
