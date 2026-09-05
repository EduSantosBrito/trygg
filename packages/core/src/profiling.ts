/**
 * Export bounded render-profiling sessions to an OTLP collector such as SigNoz.
 *
 * @remarks
 * Opt-in entrypoint: ordinary renderer imports do not load the OTLP exporter.
 * This is a diagnostic session, not continuous or durable telemetry. Durations
 * include suspension and scheduling; exported spans do not measure CPU self-time.
 *
 * @see ./profiling.docs.md - Configuration, privacy, lifecycle and measurement limits
 * @module trygg/profiling
 * @since 1.0.0
 */
import {
  Cause,
  ConfigProvider,
  Context,
  Data,
  Effect,
  Exit,
  Layer,
  Predicate,
  Schema,
  Tracer,
} from "effect";
import { HttpClient } from "effect/unstable/http";
import { OtlpExporter, OtlpSerialization, OtlpTracer } from "effect/unstable/observability";
import * as RenderProfiling from "./primitives/render-profiling.js";

/**
 * Configure one finite OTLP render-profiling session.
 *
 * @remarks
 * The URL is the complete HTTP(S) traces endpoint, without credentials, query or
 * fragment. Resource identifiers are explicitly exported; never put secrets in
 * them. Defaults: 10,000 admitted spans, batches of 512, a 1s export interval,
 * and a 3s shutdown timeout. The span budget never resets within a Layer lifetime.
 *
 * @example
 * ```ts
 * const options: ProfilingOptions = {
 *   url: "http://127.0.0.1:4318/v1/traces",
 *   serviceName: "trygg-render-profile",
 *   startPaused: true,
 * }
 * ```
 * @category Profiling
 * @public
 * @since 1.0.0
 */
export interface ProfilingOptions {
  readonly url: string;
  readonly serviceName: string;
  readonly serviceVersion?: string;
  readonly sessionId?: string;
  readonly maxSpans?: number;
  readonly maxBatchSize?: number;
  readonly exportIntervalMs?: number;
  readonly shutdownTimeoutMs?: number;
  readonly startPaused?: boolean;
}

/**
 * Inspect profiling admission without mistaking it for storage acknowledgment.
 *
 * @remarks
 * `recorded` counts ended spans handed to Effect's exporter, not spans indexed by
 * SigNoz. `dropped` counts budget rejections; `filtered` includes paused,
 * unsampled, unknown-name and closed-owner admissions. Snapshots are detached.
 *
 * @example
 * ```ts
 * const state = yield* (yield* Session).snapshot
 * yield* Effect.logInfo({ admitted: state.admitted, dropped: state.dropped })
 * ```
 * @category Profiling
 * @public
 * @since 1.0.0
 */
export interface ProfilingSnapshot {
  readonly active: boolean;
  readonly closed: boolean;
  readonly admitted: number;
  readonly recorded: number;
  readonly dropped: number;
  readonly filtered: number;
}

/**
 * Control a profiling window inside its owning Layer lifetime.
 *
 * @remarks
 * Start/stop affect new spans and never reset the budget. Already admitted spans
 * may end after stop, but not after owner closure. Flush is bounded best effort:
 * it inherits Effect's Flusher semantics and does not acknowledge indexing or
 * await exports already in flight. Scope closure performs the native final flush.
 *
 * @example
 * ```ts
 * const session = yield* Session
 * yield* session.start
 * // Execute and await the workload's workers here.
 * yield* session.stop
 * yield* session.flush
 * ```
 * @category Profiling
 * @public
 * @since 1.0.0
 */
export class Session extends Context.Service<
  Session,
  {
    readonly start: Effect.Effect<void>;
    readonly stop: Effect.Effect<void>;
    readonly flush: Effect.Effect<void>;
    readonly snapshot: Effect.Effect<ProfilingSnapshot>;
  }
>()("trygg/Profiling/Session") {}

/**
 * Report invalid profiling options without echoing endpoint credentials or data.
 *
 * @remarks
 * Configuration fails before exporter resources are acquired.
 *
 * @example
 * ```ts
 * const error = new ProfilingConfigError()
 * ```
 * @category Profiling
 * @public
 * @since 1.0.0
 */
export class ProfilingConfigError extends Schema.TaggedError<ProfilingConfigError>()(
  "ProfilingConfigError",
  {},
) {}

const identifier = Schema.String.check(Schema.isNonEmpty(), Schema.isMaxLength(128));
const positive = (max: number) => Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: max }));
const Options = Schema.Struct({
  url: Schema.URLFromString.check(
    Schema.makeFilter(
      (url) =>
        (url.protocol === "http:" || url.protocol === "https:") &&
        url.username === "" &&
        url.password === "" &&
        url.search === "" &&
        url.hash === "",
    ),
  ),
  serviceName: identifier,
  serviceVersion: Schema.optional(identifier),
  sessionId: Schema.optional(identifier),
  maxSpans: positive(1_000_000),
  maxBatchSize: positive(10_000),
  exportIntervalMs: positive(60_000),
  shutdownTimeoutMs: positive(60_000),
  startPaused: Schema.Boolean,
});

const decodeOptions = Schema.decodeUnknownEffect(Options);
const { Ended: ended } = Data.taggedEnum<Tracer.SpanStatus>();

interface State {
  active: boolean;
  closed: boolean;
  admitted: number;
  recorded: number;
  dropped: number;
  filtered: number;
}

// Preserve the outcome categories without exporting error messages, stacks,
// request/response values, annotations, or user-provided attribute objects.
const projectExit = (exit: Exit.Exit<unknown, unknown>): Exit.Exit<void, string> =>
  Exit.isSuccess(exit)
    ? Exit.void
    : Exit.failCause(
        Cause.fromReasons(
          exit.cause.reasons.map((reason) =>
            Cause.isFailReason(reason)
              ? Cause.makeFailReason("ProfiledFailure")
              : Cause.isDieReason(reason)
                ? Cause.makeDieReason("ProfiledDefect")
                : Cause.makeInterruptReason(),
          ),
        ),
      );

class ProfileSpan implements Tracer.Span {
  readonly _tag = "Span";
  status: Tracer.SpanStatus;
  constructor(
    readonly span: Tracer.Span,
    readonly state: State,
    readonly admitted: boolean,
  ) {
    this.status = span.status;
  }
  get name() {
    return this.span.name;
  }
  get spanId() {
    return this.span.spanId;
  }
  get traceId() {
    return this.span.traceId;
  }
  get parent() {
    return this.span.parent;
  }
  get annotations() {
    return this.span.annotations;
  }
  get attributes() {
    return this.span.attributes;
  }
  get links() {
    return this.span.links;
  }
  get sampled() {
    return this.span.sampled;
  }
  get kind() {
    return this.span.kind;
  }
  attribute(_key: string, _value: unknown): void {}
  event(_name: string, _time: bigint, _attributes?: Record<string, unknown>): void {}
  addLinks(_links: ReadonlyArray<Tracer.SpanLink>): void {}
  end(time: bigint, exit: Exit.Exit<unknown, unknown>): void {
    if (Predicate.isTagged(this.status, "Ended")) return;
    const safeExit = projectExit(exit);
    this.status = ended({
      startTime: this.status.startTime,
      endTime: time,
      exit: safeExit,
    });
    if (!this.admitted || this.state.closed) return;
    this.span.end(time, safeExit);
    this.state.recorded++;
  }
}

/**
 * Install an opt-in, bounded OTLP/HTTP JSON render profiler.
 *
 * @remarks
 * Supply an HttpClient at the composition root. The native Effect exporter owns
 * batching, retries and shutdown; at most `maxSpans` spans are admitted per build.
 * Only fixed framework span names are exported. Attributes, events, links and
 * error details are intentionally projected away. This replaces the tracer in
 * the provided subtree; it does not add a second exporter to an existing tracer.
 *
 * @example
 * ```ts
 * import { Layer } from "effect"
 * import { FetchHttpClient } from "effect/unstable/http"
 * import * as Profiling from "trygg/profiling"
 *
 * const profile = Profiling.layer({
 *   url: "http://127.0.0.1:4318/v1/traces",
 *   serviceName: "trygg-render-profile",
 * }).pipe(Layer.provide(FetchHttpClient.layer))
 * ```
 * @category Profiling
 * @public
 * @since 1.0.0
 */
export const layer = (
  options: ProfilingOptions,
): Layer.Layer<Session, ProfilingConfigError, HttpClient.HttpClient> =>
  Layer.effectContext(
    Effect.gen(function* () {
      const config = yield* decodeOptions({
        maxSpans: 10_000,
        maxBatchSize: 512,
        exportIntervalMs: 1_000,
        shutdownTimeoutMs: 3_000,
        startPaused: false,
        ...options,
      }).pipe(Effect.mapError(() => new ProfilingConfigError()));
      const state: State = {
        active: !config.startPaused,
        closed: false,
        admitted: 0,
        recorded: 0,
        dropped: 0,
        filtered: 0,
      };
      const exporter = yield* OtlpTracer.make({
        url: config.url.href,
        resource: {
          serviceName: config.serviceName,
          serviceVersion: config.serviceVersion,
          attributes:
            config.sessionId === undefined ? {} : { "trygg.profile.session": config.sessionId },
        },
        maxBatchSize: Math.min(config.maxSpans, config.maxBatchSize),
        exportInterval: config.exportIntervalMs,
        shutdownTimeout: config.shutdownTimeoutMs,
      }).pipe(Effect.provideService(ConfigProvider.ConfigProvider, ConfigProvider.fromUnknown({})));
      const flusher = yield* OtlpExporter.Flusher;
      yield* Effect.addFinalizer(() =>
        Effect.sync(() => {
          state.active = false;
          state.closed = true;
        }),
      );
      const tracer = Tracer.make({
        span(spanOptions) {
          let admitted = false;
          if (
            state.closed ||
            !state.active ||
            !spanOptions.sampled ||
            !RenderProfiling.names.has(spanOptions.name)
          )
            state.filtered++;
          else if (state.admitted >= config.maxSpans) state.dropped++;
          else {
            state.admitted++;
            admitted = true;
          }
          const safeOptions = {
            ...spanOptions,
            sampled: admitted,
            annotations: Context.empty(),
            links: [],
          };
          const span = admitted ? exporter.span(safeOptions) : new Tracer.NativeSpan(safeOptions);
          return new ProfileSpan(span, state, admitted);
        },
      });
      return Context.make(Session, {
        start: Effect.sync(() => {
          if (!state.closed) state.active = true;
        }),
        stop: Effect.sync(() => {
          state.active = false;
        }),
        flush: flusher.flush.pipe(Effect.timeoutOption(config.shutdownTimeoutMs), Effect.asVoid),
        snapshot: Effect.sync(() => ({ ...state })),
      }).pipe(Context.add(Tracer.Tracer, tracer), Context.add(RenderProfiling.Enabled, true));
    }),
  ).pipe(Layer.provide(OtlpSerialization.layerJson), Layer.provide(OtlpExporter.layerFlusher));
