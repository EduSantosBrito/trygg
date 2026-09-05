/**
 * Trygg's internal flight recorder.
 *
 * @remarks
 * `trace` records every meaningful framework step, in order, so the sequence of
 * work can be read back to debug behaviour, prove step ordering, and reason
 * about performance. Events ride on Effect's logging pipeline: each is below the
 * fiber's minimum log level by default, so `emit` is a zero-allocation no-op
 * until a logger observes it.
 *
 * Internals import this as `import * as Trace from "../trace/index.js"` and call
 * `Trace.emit("event.name", () => payload)`. Tests reach the same surface via
 * `trygg/testing` (or {@link makeRecorder} + {@link record}) and assert order
 * with `recorder.records().map((r) => r.name)`.
 *
 * @internal
 */
export * from "./catalog.js";
export { causeValueType, valueType } from "./payload.js";
export * from "./trace.js";
export * from "./report.js";
export * from "./analyze.js";
export * from "./budget.js";
export * from "./scenarios.js";
