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
 *    log message; a private, origin-marked envelope and the action id ride along
 *    as log annotations (`trygg.trace`, `trygg.actionId`).
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
import { Cause, Effect, Exit, Predicate, Schema } from "effect";
import * as Logger from "effect/Logger";
import * as LogLevel from "effect/LogLevel";
import * as References from "effect/References";
import { CATALOG, type TraceEventName, type TraceLevel, type TraceMeta } from "./catalog.js";
import { copyOwnDataObject, detachJsonObject, detachJsonString } from "./json.js";
import {
  decodeTracePayload,
  type TraceEventPayload,
  type TracePayloadEventName,
  traceEventRequiresPayload,
} from "./payload.js";

export { causeValueType, valueType } from "./payload.js";
export type { TraceEventPayload, TracePayloadEventName, TraceValueType } from "./payload.js";

export interface TraceRecord {
  readonly name: TraceEventName;
  readonly payload: Schema.JsonObject | undefined;
  readonly actionId: string | undefined;
}

type ExactPayload<Actual, Expected> = Expected extends unknown
  ? Actual extends Expected
    ? Actual & Readonly<Record<Exclude<keyof Actual, keyof Expected>, never>>
    : never
  : never;

export type TracePayload<
  Name extends TraceEventName,
  Actual extends TraceEventPayload<Name> = TraceEventPayload<Name>,
> = () => ExactPayload<Actual, TraceEventPayload<Name>>;

/** Private log annotation proving that a record originated in {@link emit}. */
const TRACE_KEY = "trygg.trace";
/** Log-annotation key under which {@link withAction} stamps the current action id. */
const ACTION_KEY = "trygg.actionId";

type TraceEnvelope = object;

interface TraceRecordReaderState {
  readonly seen: WeakSet<TraceEnvelope>;
}

interface TraceEnvelopeEntry {
  readonly readers: ReadonlySet<TraceRecordReaderState>;
  readonly record: TraceRecord;
}

const readerStateByLogger = new WeakMap<object, TraceRecordReaderState>();
const recordsByEnvelope = new WeakMap<TraceEnvelope, TraceEnvelopeEntry>();

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

const emitInternal = (
  name: TraceEventName,
  payload: (() => unknown) | undefined,
): Effect.Effect<void> =>
  Effect.withFiber((fiber) => {
    const level = logLevelOf(name);
    if (LogLevel.isGreaterThan(fiber.getRef(References.MinimumLogLevel), level)) return VOID;

    return Effect.sync(() => {
      const annotations = fiber.getRef(References.CurrentLogAnnotations);
      const annotatedAction = annotations[ACTION_KEY];
      const actionId = typeof annotatedAction === "string" ? annotatedAction : undefined;
      const readers = new Set<TraceRecordReaderState>();
      for (const logger of fiber.getRef(Logger.CurrentLoggers)) {
        const state = readerStateByLogger.get(logger);
        if (state !== undefined) readers.add(state);
      }

      if (payload === undefined) {
        if (traceEventRequiresPayload(name)) return undefined;
        const record = Object.freeze({
          name,
          payload: undefined,
          actionId,
        }) satisfies TraceRecord;
        const envelope: TraceEnvelope = Object.freeze({});
        recordsByEnvelope.set(envelope, { readers, record });
        return envelope;
      }

      const original = copyOwnDataObject(payload());
      if (original === undefined) return undefined;
      const decoded = decodeTracePayload(name, original);
      if (Exit.isFailure(decoded) || !Predicate.isObject(decoded.value)) return undefined;

      const record = Object.freeze({
        name,
        payload: detachJsonObject(decoded.value),
        actionId,
      }) satisfies TraceRecord;
      const envelope: TraceEnvelope = Object.freeze({});
      recordsByEnvelope.set(envelope, { readers, record });
      return envelope;
    }).pipe(
      Effect.flatMap((envelope) =>
        envelope === undefined
          ? VOID
          : Effect.annotateLogs(Effect.logWithLevel(level)(name), TRACE_KEY, envelope),
      ),
      Effect.catchCause((cause) => (Cause.hasInterrupts(cause) ? Effect.failCause(cause) : VOID)),
    );
  });

/**
 * Record one framework step. Below the fiber's minimum log level this is a
 * zero-allocation no-op — neither the payload thunk nor any log work runs.
 */
export function emit<Name extends TracePayloadEventName, Payload extends TraceEventPayload<Name>>(
  name: Name,
  payload: TracePayload<Name, Payload>,
): Effect.Effect<void>;
export function emit<
  Name extends Exclude<TraceEventName, TracePayloadEventName>,
  Payload extends TraceEventPayload<Name> = TraceEventPayload<Name>,
>(name: Name, payload?: TracePayload<Name, Payload>): Effect.Effect<void>;
export function emit(name: TraceEventName, payload?: () => unknown): Effect.Effect<void> {
  return emitInternal(name, payload);
}

/** Typed adapter for generic emit helpers whose event always has a payload. */
export const emitPayload = <
  Name extends TracePayloadEventName,
  Payload extends TraceEventPayload<Name>,
>(
  name: Name,
  payload: TracePayload<Name, Payload>,
): Effect.Effect<void> => emitInternal(name, payload);

/**
 * Group every event emitted by `effect` under a named action. Emits
 * `contract.action.start` / `contract.action.end` around it and stamps each
 * inner record's `actionId` via a log annotation. Oversized IDs are normalized
 * once before the lifecycle starts so every correlation surface uses one value.
 */
export const withAction: <A, E, R>(
  actionId: string,
  facts: Schema.JsonObject,
  effect: Effect.Effect<A, E, R>,
) => Effect.Effect<A, E, R> = Effect.fnUntraced(function* <A, E, R>(
  actionId: string,
  facts: Schema.JsonObject,
  effect: Effect.Effect<A, E, R>,
) {
  const canonicalActionId = detachJsonString(actionId);
  return yield* Effect.uninterruptibleMask((restore) =>
    Effect.gen(function* () {
      yield* emit("contract.action.start", () => ({ actionId: canonicalActionId, facts }));
      return yield* restore(Effect.annotateLogs(effect, ACTION_KEY, canonicalActionId)).pipe(
        Effect.onExit((exit) =>
          emit("contract.action.end", () => ({
            actionId: canonicalActionId,
            status: Exit.isSuccess(exit)
              ? "completed"
              : Cause.hasInterruptsOnly(exit.cause)
                ? "interrupted"
                : "failed",
          })),
        ),
      );
    }),
  );
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
  Predicate.isString(value) && Object.hasOwn(CATALOG, value);

/** The catalog name a log message carries, or `undefined` for non-trace logs. */
const traceNameOf = (message: unknown): TraceEventName | undefined => {
  const first = Array.isArray(message) ? message[0] : message;
  return isTraceEventName(first) ? first : undefined;
};

/** `null` is a replay; `undefined` is a non-Trace log. */
export type TraceReadResult = TraceRecord | null | undefined;

export interface TraceRecordReader {
  readonly register: <Message, Output>(
    logger: Logger.Logger<Message, Output>,
  ) => Logger.Logger<Message, Output>;
  readonly read: (options: Logger.Options<unknown>) => TraceReadResult;
}

/**
 * Build one identity-checking, replay-deduplicating Trace log reader.
 *
 * @internal
 */
export const makeRecordReader = (): TraceRecordReader => {
  const state: TraceRecordReaderState = { seen: new WeakSet<TraceEnvelope>() };
  return {
    register: (logger) => {
      readerStateByLogger.set(logger, state);
      return logger;
    },
    read: (options) => {
      const name = traceNameOf(options.message);
      if (name === undefined) return undefined;
      const annotations = options.fiber.getRef(References.CurrentLogAnnotations);
      const envelope = annotations[TRACE_KEY];
      if (!Predicate.isObject(envelope)) return undefined;
      const entry = recordsByEnvelope.get(envelope);
      if (entry === undefined || entry.record.name !== name) return undefined;
      if (!entry.readers.has(state) || state.seen.has(envelope)) return null;
      state.seen.add(envelope);
      return entry.record;
    },
  };
};

/**
 * Build a {@link Recorder}. Its logger ignores non-trace logs and resolves each
 * private envelope identity to the immutable {@link TraceRecord} created by
 * {@link emit}.
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
  const reader = makeRecordReader();
  const logger = reader.register(
    Logger.make<unknown, void>((options) => {
      const result = reader.read(options);
      if (result !== null && result !== undefined) buffer.push(result);
    }),
  );
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
