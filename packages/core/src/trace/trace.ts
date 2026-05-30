/**
 * Trace core — Trygg's internal flight recorder.
 *
 * @remarks
 * `emit` is the single entry point for recording a framework step. It rides on
 * Effect's logging pipeline, so it works the same in dev and prod and is
 * configured by the running fiber's minimum log level:
 *
 * 1. Each catalog event maps to an Effect `LogLevel` (semantic → `Info`,
 *    cost → `Debug`, diagnostic → `Warn`; a per-event `logLevel` may override).
 * 2. `emit` compares that level against the fiber's
 *    {@link References.MinimumLogLevel}. When the event is below the threshold it
 *    returns the shared `Effect.void` singleton — the payload thunk is never
 *    evaluated and nothing is allocated.
 * 3. Otherwise it emits via {@link Effect.logWithLevel}. The event name is the
 *    log message; the payload and action id ride along as log annotations
 *    (`trygg.payload`, `trygg.actionId`).
 *
 * To observe events, install a {@link Logger} that recognises catalog names:
 * {@link makeRecorder} builds an in-memory recorder for tests, and
 * {@link module:trygg/debug} installs a colour console logger for humans. Both
 * are ordinary Effect loggers — there is no bespoke sink machinery.
 *
 * Records carry no timestamp by design: the flight recorder is about *order*,
 * not wall-clock, which keeps it allocation-light and deterministic for tests.
 *
 * @see ./catalog.ts - the event vocabulary
 * @internal
 */
import { Cause, Effect, Exit } from "effect";
import * as Logger from "effect/Logger";
import * as LogLevel from "effect/LogLevel";
import * as References from "effect/References";
import { CATALOG, type TraceEventName, type TraceLevel, type TraceMeta } from "./catalog.js";

export interface TraceRecord {
  readonly name: TraceEventName;
  readonly payload: Readonly<Record<string, unknown>> | undefined;
  readonly actionId: string | undefined;
}

export type TracePayload = () => Record<string, unknown>;

/** Log-annotation key under which {@link emit} stashes a built payload. */
const PAYLOAD_KEY = "trygg.payload";
/** Log-annotation key under which {@link withAction} stamps the current action id. */
const ACTION_KEY = "trygg.actionId";

const VOID: Effect.Effect<void> = Effect.void;

/** Default mapping from a catalog {@link TraceLevel} to an Effect `LogLevel`. */
const LEVEL_TO_LOG: Record<TraceLevel, LogLevel.Severity> = {
  semantic: "Info",
  cost: "Debug",
  diagnostic: "Warn",
};

/** The Effect log level an event emits at — its `logLevel` override or level default. */
const logLevelOf = (name: TraceEventName): LogLevel.Severity => {
  // Widen the precise per-entry literal to TraceMeta so the optional `logLevel`
  // override is visible on every catalog member.
  const meta: TraceMeta = CATALOG[name];
  return meta.logLevel ?? LEVEL_TO_LOG[meta.level];
};

/**
 * Record one framework step. Below the fiber's minimum log level this is a
 * zero-allocation no-op — neither the payload thunk nor any log work runs.
 */
export const emit = (name: TraceEventName, payload?: TracePayload): Effect.Effect<void> =>
  Effect.withFiber((fiber) => {
    const level = logLevelOf(name);
    if (LogLevel.isGreaterThan(fiber.getRef(References.MinimumLogLevel), level)) return VOID;
    const log = Effect.logWithLevel(level)(name);
    return payload === undefined ? log : Effect.annotateLogs(log, PAYLOAD_KEY, payload());
  });

/**
 * Group every event emitted by `effect` under a named action. Emits
 * `contract.action.start` / `contract.action.end` around it and stamps each
 * inner record's `actionId` via a log annotation.
 */
export const withAction: <A, E, R>(
  actionId: string,
  action: Record<string, unknown>,
  effect: Effect.Effect<A, E, R>,
) => Effect.Effect<A, E, R> = Effect.fnUntraced(function* <A, E, R>(
  actionId: string,
  action: Record<string, unknown>,
  effect: Effect.Effect<A, E, R>,
) {
  yield* emit("contract.action.start", () => ({ actionId, ...action }));

  const exit = yield* Effect.exit(Effect.annotateLogs(effect, ACTION_KEY, actionId));

  if (Exit.isSuccess(exit)) {
    yield* emit("contract.action.end", () => ({ actionId, status: "completed" }));
    return exit.value;
  }

  yield* emit("contract.action.end", () => ({
    actionId,
    status: "failed",
    cause: Cause.pretty(exit.cause),
  }));
  return yield* Effect.failCause(exit.cause);
});

// ── Recording ─────────────────────────────────────────────────────────────────

/**
 * An in-memory flight recorder: a {@link Logger} that buffers catalog events as
 * {@link TraceRecord}s, plus synchronous accessors for asserting on them.
 *
 * @category Recording
 * @since 1.0.0
 */
export interface Recorder {
  /** Install with {@link record} (or `Logger.layer([recorder.logger])`). */
  readonly logger: Logger.Logger<unknown, void>;
  /** Effectful detached copy of the buffer. */
  readonly snapshot: Effect.Effect<ReadonlyArray<TraceRecord>>;
  /** Synchronous live view of the buffer. */
  readonly records: () => ReadonlyArray<TraceRecord>;
  /** Reset the buffer. */
  readonly clear: () => void;
}

const isTraceEventName = (value: unknown): value is TraceEventName =>
  typeof value === "string" && Object.hasOwn(CATALOG, value);

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

/** The catalog name a log message carries, or `undefined` for non-trace logs. */
const traceNameOf = (message: unknown): TraceEventName | undefined => {
  const first = Array.isArray(message) ? message[0] : message;
  return isTraceEventName(first) ? first : undefined;
};

/**
 * Reconstruct a {@link TraceRecord} from a log's {@link Logger.Options}, or
 * `undefined` when the log is not a catalog event. The payload and action id are
 * read back from the log's annotations. Shared by {@link makeRecorder} and the
 * `Debug` console logger so both interpret the trace stream identically.
 *
 * @category Recording
 * @since 1.0.0
 */
export const recordOf = (options: Logger.Options<unknown>): TraceRecord | undefined => {
  const name = traceNameOf(options.message);
  if (name === undefined) return undefined;
  const annotations = options.fiber.getRef(References.CurrentLogAnnotations);
  const rawPayload = annotations[PAYLOAD_KEY];
  const rawAction = annotations[ACTION_KEY];
  return {
    name,
    payload: isRecord(rawPayload) ? rawPayload : undefined,
    actionId: typeof rawAction === "string" ? rawAction : undefined,
  };
};

/**
 * Build a {@link Recorder}. Its logger ignores non-trace logs and reconstructs a
 * {@link TraceRecord} for every catalog event, reading the payload/action id back
 * from the log's annotations.
 *
 * @example
 * ```ts
 * const recorder = Trace.makeRecorder()
 * yield* Trace.record(scenario, recorder)
 * expect(recorder.records().map((r) => r.name)).toEqual(["router.navigate.request", "render"])
 * ```
 *
 * @category Recording
 * @since 1.0.0
 */
export const makeRecorder = (): Recorder => {
  const buffer: Array<TraceRecord> = [];
  const logger = Logger.make<unknown, void>((options) => {
    const record = recordOf(options);
    if (record !== undefined) buffer.push(record);
  });
  return {
    logger,
    snapshot: Effect.sync(() => buffer.slice()),
    records: () => buffer,
    clear: () => {
      buffer.length = 0;
    },
  };
};

/**
 * Run `effect` with `recorder` as the only logger and the minimum log level
 * dropped to `Trace`, so every catalog event — including `cost` (`Debug`) — is
 * captured. Hermetic: the recorder replaces the ambient logger set, so
 * concurrent fibers outside this scope are unaffected.
 *
 * @category Recording
 * @since 1.0.0
 */
export const record = <A, E, R>(
  effect: Effect.Effect<A, E, R>,
  recorder: Recorder,
): Effect.Effect<A, E, R> =>
  effect.pipe(
    Effect.provide(Logger.layer([recorder.logger])),
    Effect.provideService(References.MinimumLogLevel, "Trace"),
  );
