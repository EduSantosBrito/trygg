import { assert, describe } from "@effect/vitest";
import { Effect, Scheduler, Scope } from "effect";
import { TestClock } from "effect/testing";
import * as Trace from "../../trace/index.js";
import { scoped } from "../../testing/effect-vitest.js";
import { render, type TestRenderResult } from "../../testing/index.js";
import type { Element } from "../element.js";
import * as Signal from "../signal.js";

interface Row {
  readonly id: number;
  readonly label: string;
}

interface ReactiveRow {
  readonly id: number;
  readonly label: Signal.Signal<string>;
}

interface CountingRenderResult {
  readonly result: TestRenderResult;
  readonly scheduledTasks: () => number;
}

// Contract A runs the literal js-framework-benchmark create-1k row count through
// the real table row subtree. Lowering MaxOpsBeforeYield makes any lost
// PreventSchedulerYield wiring show up immediately as deterministic scheduler
// task counts, not wall-clock timing.
const SCHEDULER_CREATE_ROWS: ReadonlyArray<number> = [1_000];
const SMALL_CREATE_ROWS = 100;
const LARGE_CREATE_ROWS = 500;
const YIELD_STRESS_MAX_OPS = 32;

const makeRows = (rows: number): ReadonlyArray<Row> =>
  Array.from({ length: rows }, (_, index) => {
    const id = index + 1;
    return { id, label: `row ${id}` };
  });

const makeReactiveRows = Effect.fn("PerfContracts.makeReactiveRows")(function* (rows: number) {
  const result: Array<ReactiveRow> = [];
  for (let index = 0; index < rows; index++) {
    const id = index + 1;
    const label = yield* Signal.make(`row ${id}`);
    result.push({ id, label });
  }
  return result;
});

const benchmarkRow = (row: Row): Element => (
  <tr data-id={String(row.id)}>
    <td className="col-md-1">{row.id}</td>
    <td className="col-md-4">
      <a>{row.label}</a>
    </td>
    <td className="col-md-1">
      <a>
        <span className="glyphicon glyphicon-remove" aria-hidden="true" />
      </a>
    </td>
    <td className="col-md-6" />
  </tr>
);

const benchmarkTable = (items: Signal.Signal<ReadonlyArray<Row>>): Element => (
  <table className="table table-hover table-striped test-data">
    <tbody>{Signal.each(items, benchmarkRow, { key: (row) => row.id })}</tbody>
  </table>
);

const reactiveBenchmarkRow = (row: ReactiveRow): Element => (
  <tr data-id={String(row.id)}>
    <td>{row.id}</td>
    <td>{row.label}</td>
  </tr>
);

const reactiveBenchmarkTable = (items: Signal.Signal<ReadonlyArray<ReactiveRow>>): Element => (
  <table className="table table-hover table-striped test-data">
    <tbody>{Signal.each(items, reactiveBenchmarkRow, { key: (row) => row.id })}</tbody>
  </table>
);

const makeCountingScheduler = (): {
  readonly scheduler: Scheduler.Scheduler;
  readonly scheduledTasks: () => number;
} => {
  let scheduledTasks = 0;
  const queue: Array<() => void> = [];
  let flushing = false;
  const flush = (): void => {
    if (flushing) return;
    flushing = true;
    while (queue.length > 0) {
      const task = queue.shift();
      if (task !== undefined) task();
    }
    flushing = false;
  };

  return {
    scheduler: {
      executionMode: "async",
      shouldYield: (fiber) => fiber.currentOpCount >= fiber.maxOpsBeforeYield,
      makeDispatcher: () => ({
        scheduleTask: (task) => {
          scheduledTasks++;
          queue.push(task);
          flush();
        },
        flush,
      }),
    },
    scheduledTasks: () => scheduledTasks,
  };
};

const renderWithCountingScheduler = Effect.fn("PerfContracts.renderWithCountingScheduler")(
  function* (element: Element) {
    const { scheduler, scheduledTasks } = makeCountingScheduler();
    const result = yield* render(element).pipe(
      Effect.provideService(Scheduler.Scheduler, scheduler),
      Effect.provideService(Scheduler.MaxOpsBeforeYield, YIELD_STRESS_MAX_OPS),
    );
    return { result, scheduledTasks } satisfies CountingRenderResult;
  },
);

const assertActionRecorded = (
  records: ReadonlyArray<Trace.TraceRecord>,
  actionId: string,
): void => {
  const found = records.some(
    (record) =>
      record.name === "contract.action.start" && record.payload?.["actionId"] === actionId,
  );
  assert.isTrue(found, `expected Trace.withAction to record ${actionId}`);
};

const countEvents = (
  records: ReadonlyArray<Trace.TraceRecord>,
  name: Trace.TraceEventName,
): number => records.filter((record) => record.name === name).length;

const renderedRowCount = (result: TestRenderResult): number | undefined =>
  result.container.querySelector("tbody")?.childElementCount;

const runCreateTrace = (
  rows: number,
): Effect.Effect<ReadonlyArray<Trace.TraceRecord>, unknown, Scope.Scope> => {
  const scenarioName = `create${rows}`;
  return Trace.runScenario({
    name: scenarioName,
    rows,
    run: Effect.gen(function* () {
      const items = yield* Signal.make<ReadonlyArray<Row>>([]);
      const result = yield* render(benchmarkTable(items));

      yield* Trace.withAction(
        scenarioName,
        { scenario: scenarioName, rows, operation: "create" },
        Signal.set(items, makeRows(rows)),
      );
      assert.strictEqual(renderedRowCount(result), rows);

      yield* TestClock.adjust(10);
      assert.strictEqual(renderedRowCount(result), rows);
    }),
  });
};

const createBudgets = (rows: number): ReadonlyArray<Trace.BudgetRule> => {
  const scenario = `create${rows}`;
  return [
    {
      rule: "create.itemAdds",
      scenario,
      event: "keyedList.item.add",
      actionId: scenario,
      band: Trace.Band.equals({ n: rows }),
    },
    {
      rule: "create.noReorderMoves",
      scenario,
      event: "keyedList.reorder",
      actionId: scenario,
      band: Trace.Band.payloadAtMost({ field: "moves", n: 0 }),
    },
  ];
};

const swapRows = (rows: ReadonlyArray<Row>): ReadonlyArray<Row> => {
  const leftIndex = 1;
  const rightIndex = rows.length - 2;
  const left = rows[leftIndex];
  const right = rows[rightIndex];
  if (left === undefined || right === undefined) return rows;

  const next = rows.slice();
  next[leftIndex] = right;
  next[rightIndex] = left;
  return next;
};

const runActionTrace = Effect.fn("PerfContracts.runActionTrace")(function* <E, R>(
  effect: (recorder: Trace.Recorder) => Effect.Effect<void, E, R>,
) {
  const recorder = Trace.makeRecorder();
  yield* Trace.record(effect(recorder), recorder);
  return yield* recorder.snapshot;
});

const runSwapTrace = (
  rows: number,
): Effect.Effect<ReadonlyArray<Trace.TraceRecord>, unknown, Scope.Scope> => {
  const scenarioName = `swap${rows}`;
  return runActionTrace((recorder) =>
    Effect.gen(function* () {
      const initialRows = makeRows(rows);
      const items = yield* Signal.make<ReadonlyArray<Row>>(initialRows);
      const result = yield* render(benchmarkTable(items));
      const { container } = result;
      assert.strictEqual(renderedRowCount(result), rows);

      recorder.clear();
      yield* Trace.withAction(
        scenarioName,
        { scenario: scenarioName, rows, operation: "swap" },
        Signal.set(items, swapRows(initialRows)),
      );
      yield* TestClock.adjust(10);

      const renderedIds = Array.from(container.querySelectorAll("tr")).map((row) =>
        row.getAttribute("data-id"),
      );
      assert.deepStrictEqual(renderedIds[1], String(rows - 1));
      assert.deepStrictEqual(renderedIds[rows - 2], "2");
    }),
  );
};

const runClearTrace = (
  rows: number,
): Effect.Effect<ReadonlyArray<Trace.TraceRecord>, unknown, Scope.Scope> => {
  const scenarioName = `clear${rows}`;
  return runActionTrace((recorder) =>
    Effect.gen(function* () {
      const items = yield* Signal.make<ReadonlyArray<Row>>(makeRows(rows));
      const result = yield* render(benchmarkTable(items));
      assert.strictEqual(renderedRowCount(result), rows);

      recorder.clear();
      yield* Trace.withAction(
        scenarioName,
        { scenario: scenarioName, rows, operation: "clear" },
        Signal.set(items, []),
      );
      assert.strictEqual(renderedRowCount(result), 0);
    }).pipe(Effect.provideService(Scheduler.PreventSchedulerYield, true)),
  );
};

const runSingleRowSignalUpdateTrace = (
  rows: number,
): Effect.Effect<ReadonlyArray<Trace.TraceRecord>, unknown, Scope.Scope> => {
  const scenarioName = `updateRowSignal${rows}`;
  return runActionTrace((recorder) =>
    Effect.gen(function* () {
      const rowValues = yield* makeReactiveRows(rows);
      const items = yield* Signal.make<ReadonlyArray<ReactiveRow>>(rowValues);
      const result = yield* render(reactiveBenchmarkTable(items));
      assert.strictEqual(renderedRowCount(result), rows);

      const target = rowValues[9];
      assert.isDefined(target);

      recorder.clear();
      yield* Trace.withAction(
        scenarioName,
        { scenario: scenarioName, rows, operation: "update-row-signal" },
        Signal.set(target.label, "updated"),
      );
      yield* TestClock.adjust(10);

      assert.strictEqual(
        result.container.querySelector('tr[data-id="10"] td:nth-child(2)')?.textContent,
        "updated",
      );
    }),
  );
};

describe("perf contracts", () => {
  scoped(
    "bulk create schedules no cooperative macrotasks through the public render path",
    () =>
      Effect.gen(function* () {
        // Test: should create keyed rows without cooperative scheduler macrotasks.
        // Scope: guards the rf2b js-framework-benchmark create path where an empty→populated
        // keyed list previously scheduled rows-relative setTimeout(0)-style yields.
        // Assertion: the injected scheduler observes at most a tiny constant of scheduled tasks,
        // even under a deliberately low max-op yield threshold, and the table is fully populated
        // synchronously after Signal.set returns.
        for (const rows of SCHEDULER_CREATE_ROWS) {
          const items = yield* Signal.make<ReadonlyArray<Row>>([]);
          const { result, scheduledTasks } = yield* renderWithCountingScheduler(
            benchmarkTable(items),
          );

          const beforeCreate = scheduledTasks();
          yield* Signal.set(items, makeRows(rows));
          const createScheduledTasks = scheduledTasks() - beforeCreate;

          assert.isAtMost(
            createScheduledTasks,
            2,
            `create${rows} should not schedule cooperative macrotasks`,
          );
          assert.strictEqual(renderedRowCount(result), rows);
        }
      }),
    60_000,
  );

  scoped(
    "bulk create emits one keyed-list add per row across two scales",
    () =>
      Effect.gen(function* () {
        // Test: should keep first-create structural work linear in rows.
        // Scope: guards the keyed-list item creation/fork seam with deterministic trace counts,
        // not wall-clock timing.
        // Assertion: each create action records exactly N keyedList.item.add events and the
        // larger/smaller count ratio follows the row-count ratio.
        const smallRows = SMALL_CREATE_ROWS;
        const largeRows = LARGE_CREATE_ROWS;
        const smallRecords = yield* runCreateTrace(smallRows);
        const largeRecords = yield* runCreateTrace(largeRows);

        assertActionRecorded(smallRecords, `create${SMALL_CREATE_ROWS}`);
        assertActionRecorded(largeRecords, `create${LARGE_CREATE_ROWS}`);

        const smallFindings = Trace.evaluateBudgets(
          smallRecords,
          { scenario: `create${SMALL_CREATE_ROWS}`, rows: smallRows },
          createBudgets(smallRows),
        );
        assert.deepStrictEqual(smallFindings, []);

        const largeFindings = Trace.evaluateBudgets(
          largeRecords,
          { scenario: `create${LARGE_CREATE_ROWS}`, rows: largeRows },
          createBudgets(largeRows),
        );
        assert.deepStrictEqual(largeFindings, []);

        const shapeFindings = Trace.assertShape(
          "create.itemAdds.shape",
          {
            label: `create${SMALL_CREATE_ROWS}`,
            rows: smallRows,
            count: countEvents(smallRecords, "keyedList.item.add"),
          },
          {
            label: `create${LARGE_CREATE_ROWS}`,
            rows: largeRows,
            count: countEvents(largeRecords, "keyedList.item.add"),
          },
        );
        assert.deepStrictEqual(shapeFindings, []);
      }),
    30_000,
  );

  scoped(
    "swap reorders with minimal moves and no add/remove churn",
    () =>
      Effect.gen(function* () {
        // Test: should swap two keyed rows without recreating rows.
        // Scope: guards the LIS reorder cost contract on a populated keyed table.
        // Assertion: the swap action records at most two moves and no add/remove events.
        const rows = SMALL_CREATE_ROWS;
        const records = yield* runSwapTrace(rows);
        assertActionRecorded(records, `swap${rows}`);

        const findings = Trace.evaluateBudgets(records, { scenario: `swap${rows}`, rows }, [
          {
            rule: "swap.minimalMoves",
            scenario: `swap${rows}`,
            event: "keyedList.reorder",
            actionId: `swap${rows}`,
            band: Trace.Band.payloadAtMost({ field: "moves", n: 2 }),
          },
          {
            rule: "swap.noAdds",
            scenario: `swap${rows}`,
            event: "keyedList.item.add",
            actionId: `swap${rows}`,
            band: Trace.Band.equals({ n: 0 }),
          },
          {
            rule: "swap.noRemoves",
            scenario: `swap${rows}`,
            event: "keyedList.item.remove",
            actionId: `swap${rows}`,
            band: Trace.Band.equals({ n: 0 }),
          },
        ]);
        assert.deepStrictEqual(findings, []);
      }),
    30_000,
  );

  scoped(
    "single-row signal update notifies only the row subscriber",
    () =>
      Effect.gen(function* () {
        // Test: should update one row-local signal without notifying the whole list.
        // Scope: guards fanout using the signal.notify listener_count payload.
        // Assertion: the updated signal has at most one listener and the keyed list does not
        // add or remove rows during the row-local update.
        const rows = SMALL_CREATE_ROWS;
        const records = yield* runSingleRowSignalUpdateTrace(rows);
        const scenario = `updateRowSignal${rows}`;
        assertActionRecorded(records, scenario);

        const findings = Trace.evaluateBudgets(records, { scenario, rows }, [
          {
            rule: "signalUpdate.rowFanout",
            scenario,
            event: "signal.notify",
            actionId: scenario,
            band: Trace.Band.payloadAtMost({ field: "listener_count", n: 1 }),
          },
          {
            rule: "signalUpdate.noAdds",
            scenario,
            event: "keyedList.item.add",
            actionId: scenario,
            band: Trace.Band.equals({ n: 0 }),
          },
          {
            rule: "signalUpdate.noRemoves",
            scenario,
            event: "keyedList.item.remove",
            actionId: scenario,
            band: Trace.Band.equals({ n: 0 }),
          },
        ]);
        assert.deepStrictEqual(findings, []);
      }),
    30_000,
  );

  scoped(
    "clear removes one keyed-list item per row across two scales",
    () =>
      Effect.gen(function* () {
        // Test: should clear a populated keyed table with one remove event per row.
        // Scope: guards cleanup churn as a structural count instead of a wall-clock budget.
        // Assertion: clear emits N item.remove events, emits no item.add events, and scales linearly.
        const smallRows = SMALL_CREATE_ROWS;
        const largeRows = LARGE_CREATE_ROWS;
        const smallRecords = yield* runClearTrace(smallRows);
        const largeRecords = yield* runClearTrace(largeRows);

        assertActionRecorded(smallRecords, `clear${smallRows}`);
        assertActionRecorded(largeRecords, `clear${largeRows}`);

        const smallFindings = Trace.evaluateBudgets(
          smallRecords,
          { scenario: `clear${smallRows}`, rows: smallRows },
          [
            {
              rule: "clear.itemRemoves",
              scenario: `clear${smallRows}`,
              event: "keyedList.item.remove",
              actionId: `clear${smallRows}`,
              band: Trace.Band.equals({ n: smallRows }),
            },
            {
              rule: "clear.noAdds",
              scenario: `clear${smallRows}`,
              event: "keyedList.item.add",
              actionId: `clear${smallRows}`,
              band: Trace.Band.equals({ n: 0 }),
            },
          ],
        );
        assert.deepStrictEqual(smallFindings, []);

        const largeFindings = Trace.evaluateBudgets(
          largeRecords,
          { scenario: `clear${largeRows}`, rows: largeRows },
          [
            {
              rule: "clear.itemRemoves",
              scenario: `clear${largeRows}`,
              event: "keyedList.item.remove",
              actionId: `clear${largeRows}`,
              band: Trace.Band.equals({ n: largeRows }),
            },
            {
              rule: "clear.noAdds",
              scenario: `clear${largeRows}`,
              event: "keyedList.item.add",
              actionId: `clear${largeRows}`,
              band: Trace.Band.equals({ n: 0 }),
            },
          ],
        );
        assert.deepStrictEqual(largeFindings, []);

        const shapeFindings = Trace.assertShape(
          "clear.itemRemoves.shape",
          {
            label: `clear${smallRows}`,
            rows: smallRows,
            count: countEvents(smallRecords, "keyedList.item.remove"),
          },
          {
            label: `clear${largeRows}`,
            rows: largeRows,
            count: countEvents(largeRecords, "keyedList.item.remove"),
          },
        );
        assert.deepStrictEqual(shapeFindings, []);
      }),
    30_000,
  );
});
