/**
 * Trace report rendering — turn a flight-recorder buffer into something a human
 * or an LLM can read.
 *
 * @remarks
 * `toJSON` produces a stable, serializable timeline. `toMarkdown` produces a
 * compact ordered timeline annotated with each event's family, level, and
 * one-line summary from the {@link ./catalog.ts | catalog}. Neither mutates
 * input; both are pure given a record array. Recorder payloads are already
 * detached and frozen, so reports reuse them rather than traversing live values.
 *
 * @internal
 */
import { Option, type Schema } from "effect";
import { CATALOG, type TraceLevel } from "./catalog.js";
import type { TraceRecord } from "./trace.js";

export interface TimelineEntry {
  readonly order: number;
  readonly name: string;
  readonly family: string;
  readonly level: TraceLevel;
  readonly summary: string;
  readonly actionId?: string;
  readonly payload?: Schema.JsonObject;
}

export interface ReportOptions {
  /** Restrict to one or more levels. */
  readonly level?: TraceLevel | ReadonlyArray<TraceLevel>;
}

const levelMatches = (
  level: TraceLevel,
  filter: TraceLevel | ReadonlyArray<TraceLevel> | undefined,
): boolean => {
  if (filter === undefined) return true;
  return Array.isArray(filter) ? filter.includes(level) : filter === level;
};

const select = (
  records: ReadonlyArray<TraceRecord>,
  options: ReportOptions | undefined,
): ReadonlyArray<TraceRecord> =>
  options?.level === undefined
    ? records
    : records.filter((record) => levelMatches(CATALOG[record.name].level, options.level));

/** Project records into a serializable timeline. */
export const toJSON = (
  records: ReadonlyArray<TraceRecord>,
  options?: ReportOptions,
): ReadonlyArray<TimelineEntry> => {
  const timeline = select(records, options).map((record, index) => {
    const meta = CATALOG[record.name];
    const base: TimelineEntry = {
      order: index + 1,
      name: record.name,
      family: meta.family,
      level: meta.level,
      summary: meta.summary,
    };
    const withAction =
      record.actionId === undefined ? base : { ...base, actionId: record.actionId };
    return Object.freeze(
      record.payload === undefined ? withAction : { ...withAction, payload: record.payload },
    );
  });
  return Object.freeze(timeline);
};

const stringifyJson = Option.liftThrowable((value: Schema.Json): string | undefined =>
  JSON.stringify(value),
);

const safeStringify = (value: Schema.Json): string =>
  Option.getOrElse(stringifyJson(value), () => "null") ?? "null";

const compactPayload = (payload: Schema.JsonObject | undefined): string => {
  if (payload === undefined) return "";
  if (Object.keys(payload).length === 0) return "";
  return ` ${safeStringify(payload)}`;
};

const LEVEL_MARK: Record<TraceLevel, string> = {
  semantic: "◆",
  cost: "•",
  diagnostic: "⚠",
};

/**
 * Render a compact ordered Markdown timeline.
 *
 * @example
 * ```text
 * # Trace (3 events)
 *
 * 1. ◆ `router.navigate.request` · navigation — A navigation was requested… {"url":"/a"}
 * 2. • `signal.create` · signal — A signal was created.
 * 3. ◆ `signalElement.swap.commit` · render — A swap committed; next content is visible.
 * ```
 */
export const toMarkdown = (
  records: ReadonlyArray<TraceRecord>,
  options?: ReportOptions,
): string => {
  const selected = select(records, options);
  const lines: Array<string> = [`# Trace (${selected.length} events)`, ""];
  selected.forEach((record, index) => {
    const meta = CATALOG[record.name];
    const action = record.actionId === undefined ? "" : ` @${record.actionId}`;
    lines.push(
      `${index + 1}. ${LEVEL_MARK[meta.level]} \`${record.name}\` · ${meta.family}${action} — ${meta.summary}${compactPayload(record.payload)}`,
    );
  });
  return lines.join("\n");
};
