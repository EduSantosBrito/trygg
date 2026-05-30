/**
 * Debug — the human-facing console sink for the Trace flight recorder.
 *
 * @remarks
 * Owner module for the `Debug` topic. Where {@link module:trygg/trace} is the
 * framework's internal, machine-assertable flight recorder, `Debug` turns those
 * events into colour-coded, human-readable console output. It is an ordinary
 * Effect {@link Logger} over the trace stream — there is no bespoke sink
 * machinery.
 *
 * - {@link consoleLogger} formats catalog events with `%c` category badges and
 *   passes other logs through plainly.
 * - {@link layer} builds a `Layer` you provide to a component subtree (via
 *   `Component.provide`) to install the console logger and tune the minimum log
 *   level, a name filter, and optional batching.
 *
 * The framework installs a console logger by default in the generated entry
 * module, so logging works in dev and prod with no application wiring; reach for
 * {@link layer} only to tune it.
 *
 * @see ./debug.docs.md - Source-owned topic guide
 * @since 1.0.0
 * @module trygg/debug/debug
 */
import { Effect, Schema } from "effect";
import type * as Duration from "effect/Duration";
import * as Layer from "effect/Layer";
import * as Logger from "effect/Logger";
import type * as LogLevel from "effect/LogLevel";
import * as References from "effect/References";
import * as Trace from "../trace/index.js";

// ── Console formatting ───────────────────────────────────────────────────────

/** Badge colors keyed by the event-name prefix (the segment before the first dot). */
const categoryColors: Record<string, { bg: string; fg: string }> = {
  render: { bg: "#818cf8", fg: "#1e1b4b" },
  document: { bg: "#818cf8", fg: "#1e1b4b" },
  signal: { bg: "#34d399", fg: "#022c22" },
  signalText: { bg: "#34d399", fg: "#022c22" },
  signalElement: { bg: "#34d399", fg: "#022c22" },
  resource: { bg: "#fbbf24", fg: "#451a03" },
  router: { bg: "#a78bfa", fg: "#2e1065" },
  route: { bg: "#a78bfa", fg: "#2e1065" },
  outlet: { bg: "#a78bfa", fg: "#2e1065" },
  history: { bg: "#a78bfa", fg: "#2e1065" },
  navigation: { bg: "#a78bfa", fg: "#2e1065" },
  scroll: { bg: "#a78bfa", fg: "#2e1065" },
  contract: { bg: "#f472b6", fg: "#500724" },
  event: { bg: "#f472b6", fg: "#500724" },
  api: { bg: "#60a5fa", fg: "#172554" },
  component: { bg: "#f59e0b", fg: "#451a03" },
  keyedList: { bg: "#2dd4bf", fg: "#042f2e" },
  asyncLoader: { bg: "#fb7185", fg: "#4c0519" },
};

const badgeStyle = (bg: string, fg: string): string =>
  `background:${bg};color:${fg};padding:1px 5px;border-radius:3px;font-weight:600;font-size:11px`;

const subtypeStyle = "color:#c4b5fd;font-weight:500";
const dimStyle = "color:#9ca3af;font-weight:400";
const resetStyle = "color:inherit;font-weight:400";

const safeSync = <A>(evaluate: () => A, fallback: A): A =>
  Effect.runSync(
    Effect.try({
      try: evaluate,
      catch: () => undefined,
    }).pipe(Effect.orElseSucceed(() => fallback)),
  );

// Circular/bigint-safe stringify. Display-only payload rendering must never make
// the framework fail, including hostile `toJSON` / stringification hooks.
const safeStringify = (value: unknown): string => {
  const seen = new WeakSet<object>();
  const json = safeSync(
    () =>
      JSON.stringify(value, (_key, val) => {
        if (typeof val === "bigint") return `${val}n`;
        if (typeof val === "object" && val !== null) {
          if (seen.has(val)) return "[Circular]";
          seen.add(val);
        }
        return val;
      }),
    undefined,
  );
  return json ?? "[Unserializable]";
};

const renderValue = (value: unknown): string => {
  if (typeof value === "string") return value;
  if (typeof value === "object" && value !== null) return safeStringify(value);
  return safeSync(() => String(value), "[Unserializable]");
};

const formatPayload = (payload: Readonly<Record<string, unknown>> | undefined): string => {
  if (payload === undefined) return "";
  const parts: Array<string> = [];
  for (const [key, value] of Object.entries(payload)) {
    if (value === undefined) continue;
    parts.push(`${key}:${renderValue(value)}`);
  }
  return parts.join("  ");
};

/** A console.log invocation: format string plus its `%c` style arguments. */
interface ConsoleLine {
  readonly text: string;
  readonly styles: ReadonlyArray<string>;
}

/** Format a catalog event with `%c` category badges. */
const formatTrace = (record: Trace.TraceRecord): ConsoleLine => {
  const dotIdx = record.name.indexOf(".");
  const category = dotIdx > 0 ? record.name.slice(0, dotIdx) : record.name;
  const subtype = dotIdx > 0 ? record.name.slice(dotIdx + 1) : "";

  const colors = categoryColors[category] ?? { bg: "#6b7280", fg: "#ffffff" };
  const details = formatPayload(record.payload);

  const parts = [`%ctrygg%c %c${category}%c ${subtype}`];
  const styles: Array<string> = [
    badgeStyle("#1e293b", "#94a3b8"),
    resetStyle,
    badgeStyle(colors.bg, colors.fg),
    subtypeStyle,
  ];

  if (details) {
    parts.push(`%c${details}`);
    styles.push(dimStyle);
  }
  parts.push("%c");
  styles.push(resetStyle);

  return { text: parts.join(" "), styles };
};

/** Format a non-trace log (a user `Effect.log`) plainly, tagged with its level. */
const formatPlain = (options: Logger.Options<unknown>): ConsoleLine => {
  const message = Array.isArray(options.message)
    ? options.message.map(renderValue).join(" ")
    : renderValue(options.message);
  return { text: `%c[${options.logLevel}]%c ${message}`, styles: [dimStyle, resetStyle] };
};

// ── Filtering ────────────────────────────────────────────────────────────────

/**
 * A name prefix — or list of prefixes — restricting which catalog events the
 * console logger displays.
 *
 * @remarks
 * A prefix matches an event whose name equals it or begins with `${prefix}.`,
 * so `"router"` matches `router.navigate.request` and `router.navigate.commit`.
 * Non-trace logs (a user `Effect.log`) are never filtered — only catalog events
 * are matched against the prefixes.
 *
 * @example
 * ```ts
 * Debug.layer({ filter: "signal" })             // one family
 * Debug.layer({ filter: ["signal", "render"] }) // several
 * ```
 *
 * @category Debugging
 * @public
 * @since 1.0.0
 */
export type DebugFilter = string | ReadonlyArray<string>;

const matchesFilter = (name: string, filter: DebugFilter): boolean => {
  const prefixes = typeof filter === "string" ? [filter] : filter;
  return prefixes.some((prefix) => name === prefix || name.startsWith(`${prefix}.`));
};

/**
 * Turn a log's options into a {@link ConsoleLine}, or `undefined` to skip it.
 * Non-trace logs always pass; catalog events pass only when they match `filter`.
 */
const formatLine = (
  options: Logger.Options<unknown>,
  filter: DebugFilter | undefined,
): ConsoleLine | undefined => {
  const record = Trace.recordOf(options);
  if (record === undefined) return formatPlain(options);
  if (filter !== undefined && !matchesFilter(record.name, filter)) return undefined;
  return formatTrace(record);
};

class ConsoleWriteError extends Schema.TaggedErrorClass<ConsoleWriteError>()("ConsoleWriteError", {
  cause: Schema.Unknown,
}) {}

const writeLine = (line: ConsoleLine | undefined): void => {
  if (line === undefined) return;
  Effect.runSyncExit(
    Effect.try({
      try: () => console.log(line.text, ...line.styles),
      catch: (cause) => new ConsoleWriteError({ cause }),
    }),
  );
};

// ── Loggers & layer ───────────────────────────────────────────────────────────

/**
 * A {@link Logger} that pretty-prints catalog events to the browser console with
 * `%c` category badges, passing other logs through plainly.
 *
 * @remarks
 * This is what the framework installs by default in the generated entry module
 * and what {@link layer} configures. It reconstructs each
 * {@link Trace.TraceRecord} from the log's annotations, colour-codes it by
 * event-name category, and renders the payload inline. Non-trace logs (a user
 * `Effect.log`) print plainly, tagged with their level.
 *
 * @example
 * ```ts
 * import * as Logger from "effect/Logger"
 *
 * effect.pipe(Effect.provide(Logger.layer([Debug.consoleLogger])))
 * ```
 *
 * @category Debugging
 * @public
 * @since 1.0.0
 */
export const consoleLogger: Logger.Logger<unknown, void> = Logger.make((options) =>
  writeLine(formatLine(options, undefined)),
);

/**
 * Options for {@link layer}.
 *
 * @remarks
 * Every field is optional: with no options, {@link layer} installs the console
 * logger and inherits the ambient minimum log level. `minLevel` tunes which
 * events are seen, `filter` restricts catalog output to named families, and
 * `batchWindow` coalesces writes over a time window.
 *
 * @example
 * ```ts
 * Debug.layer({ minLevel: "Trace", filter: "signal", batchWindow: "100 millis" })
 * ```
 *
 * @category Debugging
 * @public
 * @since 1.0.0
 */
export interface DebugOptions {
  /**
   * Minimum log level for the subtree. Lower it (e.g. `"Debug"` or `"Trace"`) to
   * see `cost` events; raise it to quieten output. Omit to inherit the ambient
   * minimum log level.
   */
  readonly minLevel?: LogLevel.Severity;
  /** Restrict console output to catalog events under these name prefixes. */
  readonly filter?: DebugFilter;
  /**
   * Batch console writes over this time window instead of writing each event
   * synchronously. Uses Effect's built-in {@link Logger.batched}.
   */
  readonly batchWindow?: Duration.Input;
}

/**
 * Build a `Layer` that installs the colour console logger and tunes debug
 * output. Provide it to a component subtree with `Component.provide`.
 *
 * @remarks
 * The returned layer removes Effect's default console logger, preserves ambient
 * loggers such as trace recorders/tracers, and adds the colour console logger.
 * When `minLevel` is set it also lowers the subtree's
 * {@link References.MinimumLogLevel} so lower-severity events become visible;
 * when `batchWindow` is set, writes are coalesced with {@link Logger.batched}
 * and flushed once per window.
 *
 * @example
 * ```tsx
 * export default Layout.pipe(
 *   Component.provide(Debug.layer({ minLevel: "Trace", filter: "signal" })),
 * )
 * ```
 *
 * @category Debugging
 * @public
 * @since 1.0.0
 */
export const layer = (options?: DebugOptions): Layer.Layer<never> => {
  const filter = options?.filter;
  const debugLogger =
    options?.batchWindow === undefined
      ? Effect.succeed(Logger.make((opts) => writeLine(formatLine(opts, filter))))
      : Logger.batched(
          Logger.make((opts: Logger.Options<unknown>) => formatLine(opts, filter)),
          {
            window: options.batchWindow,
            flush: (lines) =>
              Effect.sync(() => {
                for (const line of lines) writeLine(line);
              }),
          },
        );

  const loggerLayer = Layer.effect(
    Logger.CurrentLoggers,
    Effect.flatMap(debugLogger, (activeDebugLogger) =>
      Effect.withFiber((fiber) => {
        const current = fiber.getRef(Logger.CurrentLoggers);
        const next = new Set<Logger.Logger<unknown, unknown>>();
        for (const logger of current) {
          if (logger !== Logger.defaultLogger) next.add(logger);
        }
        next.add(activeDebugLogger);
        return Effect.succeed(next);
      }),
    ),
  );

  return options?.minLevel === undefined
    ? loggerLayer
    : Layer.merge(loggerLayer, Layer.succeed(References.MinimumLogLevel, options.minLevel));
};
