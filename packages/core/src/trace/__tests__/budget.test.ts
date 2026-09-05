import { assert, describe, it } from "@effect/vitest";
import { Band, assertShape, evaluateBudgets } from "../budget.js";
import type { TraceRecord } from "../trace.js";

const swapRecords = [
  {
    name: "contract.action.start",
    payload: { actionId: "swap100", facts: { scenario: "swap100" } },
    actionId: undefined,
  },
  { name: "keyedList.item.add", payload: { key: 1 }, actionId: "swap100" },
  { name: "keyedList.item.add", payload: { key: 2 }, actionId: "swap100" },
  {
    name: "keyedList.reorder",
    payload: { total_items: 100, moves: 2, stable_nodes: 98 },
    actionId: "swap100",
  },
  {
    name: "contract.action.end",
    payload: { actionId: "swap100", status: "completed" },
    actionId: undefined,
  },
] satisfies ReadonlyArray<TraceRecord>;

describe("trace budget analyzer", () => {
  it("evaluates count and payload budgets as pure findings", () => {
    // Test: should evaluate matching trace records without throwing.
    // Scope: covers the pure analyzer layer used by perf-contract tests.
    // Assertion: passing budgets return no findings; violated budgets return readable findings.
    const passing = evaluateBudgets(swapRecords, { scenario: "swap100", rows: 100 }, [
      {
        rule: "swap.adds",
        scenario: "swap100",
        event: "keyedList.item.add",
        actionId: "swap100",
        band: Band.equals({ n: 2 }),
      },
      {
        rule: "swap.moves",
        scenario: "swap100",
        event: "keyedList.reorder",
        actionId: "swap100",
        band: Band.payloadAtMost({ field: "moves", n: 2 }),
      },
    ]);
    assert.deepStrictEqual(passing, []);

    const failing = evaluateBudgets(swapRecords, { scenario: "swap100", rows: 100 }, [
      {
        rule: "swap.moves",
        scenario: "swap100",
        event: "keyedList.reorder",
        actionId: "swap100",
        band: Band.payloadAtMost({ field: "moves", n: 1 }),
      },
    ]);
    assert.strictEqual(failing.length, 1);
    assert.strictEqual(failing[0]?.rule, "swap.moves");
  });

  it("reports two-point shape drift", () => {
    // Test: should compare structural counts across two row counts.
    // Scope: guards the asymptotic helper used for O(rows) contracts.
    // Assertion: a matching 5x count ratio passes; a mismatched ratio returns one finding.
    assert.deepStrictEqual(
      assertShape(
        "shape",
        { label: "small", rows: 100, count: 100 },
        { label: "large", rows: 500, count: 500 },
      ),
      [],
    );

    const findings = assertShape(
      "shape",
      { label: "small", rows: 100, count: 100 },
      { label: "large", rows: 500, count: 900 },
    );
    assert.strictEqual(findings.length, 1);
    assert.strictEqual(findings[0]?.rule, "shape");
  });
});
