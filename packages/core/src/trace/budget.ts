/**
 * Cost-budget analyzers for deterministic performance contracts.
 *
 * @remarks
 * Budget rules are pure structural-count checks over the trace recorder buffer.
 * They deliberately avoid wall-clock measurements: every metric is either an
 * event count or a numeric field already present in an event payload.
 *
 * @internal
 */
import { Data, Match } from "effect";
import type { TraceEventName } from "./catalog.js";
import type { Finding } from "./analyze.js";
import type { TraceRecord } from "./trace.js";

export type Band = Data.TaggedEnum<{
  readonly equals: { readonly n: number };
  readonly atMost: { readonly n: number };
  readonly between: { readonly lo: number; readonly hi: number };
  readonly payloadAtMost: { readonly field: string; readonly n: number };
  readonly linear: {
    readonly basis: "rows";
    readonly factor: number;
    readonly slack: number;
  };
}>;

export const Band = Data.taggedEnum<Band>();

type CountBand = Exclude<Band, Data.TaggedEnum.Value<Band, "payloadAtMost">>;

export interface BudgetRule {
  /** Stable identifier for this budget. */
  readonly rule: string;
  /** Human-readable scenario name this rule belongs to. */
  readonly scenario: string;
  /** Event or events that contribute to this budget. */
  readonly event: TraceEventName | ReadonlyArray<TraceEventName>;
  /** Optional action id; when present, only records from that action are counted. */
  readonly actionId?: string;
  /** Count or payload-value budget. */
  readonly band: Band;
}

export interface BudgetContext {
  readonly scenario: string;
  readonly rows: number;
}

export interface ShapePoint {
  readonly label: string;
  readonly rows: number;
  readonly count: number;
}

const eventMatches = (
  candidate: TraceEventName | ReadonlyArray<TraceEventName>,
  name: TraceEventName,
): boolean => (typeof candidate === "string" ? candidate === name : candidate.includes(name));

const matchingRecords = (
  records: ReadonlyArray<TraceRecord>,
  rule: BudgetRule,
): ReadonlyArray<{ readonly record: TraceRecord; readonly index: number }> =>
  records.flatMap((record, index) => {
    if (!eventMatches(rule.event, record.name)) return [];
    if (rule.actionId !== undefined && record.actionId !== rule.actionId) return [];
    return [{ record, index }];
  });

const observedText = (band: Band, observed: number): string =>
  Match.value(band).pipe(
    Match.tag("equals", ({ n }) => `expected exactly ${n}, observed ${observed}`),
    Match.tag("atMost", ({ n }) => `expected at most ${n}, observed ${observed}`),
    Match.tag("between", ({ lo, hi }) => `expected between ${lo} and ${hi}, observed ${observed}`),
    Match.tag(
      "linear",
      ({ factor, slack }) => `expected ${factor}×rows ± ${slack}, observed ${observed}`,
    ),
    Match.tag(
      "payloadAtMost",
      ({ field, n }) => `expected payload.${field} at most ${n}, observed ${observed}`,
    ),
    Match.exhaustive,
  );

const countFinding = (
  rule: BudgetRule,
  context: BudgetContext,
  observed: number,
  index: number,
): Finding => ({
  rule: rule.rule,
  message: `${rule.rule} failed for ${context.scenario}: ${observedText(rule.band, observed)}.`,
  index,
});

const countBandPasses = (band: CountBand, rows: number, count: number): boolean =>
  Match.value(band).pipe(
    Match.tag("equals", ({ n }) => count === n),
    Match.tag("atMost", ({ n }) => count <= n),
    Match.tag("between", ({ lo, hi }) => count >= lo && count <= hi),
    Match.tag("linear", ({ factor, slack }) => {
      const expected = rows * factor;
      return count >= expected - slack && count <= expected + slack;
    }),
    Match.exhaustive,
  );

const numericPayload = (record: TraceRecord, field: string): number | undefined => {
  const value = record.payload?.[field];
  return typeof value === "number" ? value : undefined;
};

export const evaluateBudgets = (
  records: ReadonlyArray<TraceRecord>,
  context: BudgetContext,
  rules: ReadonlyArray<BudgetRule>,
): ReadonlyArray<Finding> =>
  rules.flatMap((rule) => {
    const matches = matchingRecords(records, rule);
    const firstIndex = matches[0]?.index ?? -1;
    const band = rule.band;

    if (Band.$is("payloadAtMost")(band)) {
      if (matches.length === 0) {
        return [
          {
            rule: rule.rule,
            message: `${rule.rule} failed for ${context.scenario}: no matching ${String(
              rule.event,
            )} records were captured.`,
            index: -1,
          },
        ];
      }

      return matches.flatMap(({ record, index }) => {
        const observed = numericPayload(record, band.field);
        if (observed === undefined) {
          return [
            {
              rule: rule.rule,
              message: `${rule.rule} failed for ${context.scenario}: payload.${band.field} was not numeric on ${record.name}.`,
              index,
            },
          ];
        }
        return observed <= band.n ? [] : [countFinding(rule, context, observed, index)];
      });
    }

    const observed = matches.length;
    return countBandPasses(band, context.rows, observed)
      ? []
      : [countFinding(rule, context, observed, firstIndex)];
  });

export const assertShape = (
  rule: string,
  small: ShapePoint,
  large: ShapePoint,
  tolerance = 0.05,
): ReadonlyArray<Finding> => {
  const expected = large.rows / small.rows;

  if (small.count === 0) {
    return large.count === 0
      ? []
      : [
          {
            rule,
            message: `${rule} failed: ${small.label} observed 0 events but ${large.label} observed ${large.count}.`,
            index: -1,
          },
        ];
  }

  const observed = large.count / small.count;
  const allowedDelta = expected * tolerance;
  return Math.abs(observed - expected) <= allowedDelta
    ? []
    : [
        {
          rule,
          message: `${rule} failed: expected ~${expected}× growth from ${small.label} to ${large.label}, observed ${observed}×.`,
          index: -1,
        },
      ];
};
