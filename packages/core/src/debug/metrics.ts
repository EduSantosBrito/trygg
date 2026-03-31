/**
 * Framework counters, histograms, and export sinks.
 *
 * @remarks
 * Owner module for the `Metrics` topic. Use this module when you want the
 * framework's metric instruments or snapshots through a stable public surface.
 *
 * @see ./metrics.docs.md - Source-owned topic guide
 * @since 1.0.0
 * @module trygg/debug/metrics
 */
import { createConsola } from "consola";
import { Effect, Metric } from "effect";

const metricsLogger = createConsola({ defaults: { tag: "trygg" } });

// --- Naming Convention ---
// All metrics use `trygg.` prefix
// Categories: router, render, signal
// Format: trygg.<category>.<metric_name>

// --- Counters ---

/**
 * Counter for navigation events.
 * Incremented on each Router.navigate() call.
 *
 * @remarks
 * This counter tracks successful navigation attempts at the framework level.
 *
 * @example
 * ```ts
 * const counter = Metrics.navigationCounter
 * ```
 *
 * @category Metrics
 * @public
 * @since 1.0.0
 */
export const navigationCounter: Metric.Counter<number> = Metric.counter(
  "trygg.router.navigate.count",
  { description: "Total number of navigation events", incremental: true },
);

/**
 * Counter for route errors.
 * Incremented when a route render fails.
 *
 * @remarks
 * Use this instrument when exporting or inspecting framework route failures.
 *
 * @example
 * ```ts
 * const counter = Metrics.routeErrorCounter
 * ```
 *
 * @category Metrics
 * @public
 * @since 1.0.0
 */
export const routeErrorCounter: Metric.Counter<number> = Metric.counter(
  "trygg.router.error.count",
  { description: "Total number of route errors", incremental: true },
);

/**
 * Counter for signal updates.
 * Incremented on each Signal.set() or Signal.update() that changes value.
 *
 * @remarks
 * This instrument tracks state writes that produce an actual value change.
 *
 * @example
 * ```ts
 * const counter = Metrics.signalUpdateCounter
 * ```
 *
 * @category Metrics
 * @public
 * @since 1.0.0
 */
export const signalUpdateCounter: Metric.Counter<number> = Metric.counter(
  "trygg.signal.update.count",
  { description: "Total number of signal value changes", incremental: true },
);

/**
 * Counter for component renders.
 * Incremented on initial render and re-renders.
 *
 * @remarks
 * This tracks render throughput across initial mounts and later rerenders.
 *
 * @example
 * ```ts
 * const counter = Metrics.componentRenderCounter
 * ```
 *
 * @category Metrics
 * @public
 * @since 1.0.0
 */
export const componentRenderCounter: Metric.Counter<number> = Metric.counter(
  "trygg.render.component.count",
  { description: "Total number of component renders", incremental: true },
);

// --- Histograms ---

/**
 * Histogram boundaries for render duration (in milliseconds).
 * Buckets: 0, 1, 2, 5, 10, 25, 50, 100, 250, 500, 1000
 *
 * @remarks
 * `renderDurationHistogram` uses these boundaries so exported histograms stay
 * consistent across environments.
 *
 * @example
 * ```ts
 * const boundaries = Metrics.renderDurationBoundaries
 * ```
 *
 * @category Metrics
 * @public
 * @since 1.0.0
 */
export const renderDurationBoundaries: ReadonlyArray<number> = Metric.boundariesFromIterable([
  0, 1, 2, 5, 10, 25, 50, 100, 250, 500, 1000,
]);

/**
 * Histogram for component render duration.
 * Records how long each component render takes in milliseconds.
 *
 * @remarks
 * Use this instrument when exporting or inspecting framework render timing.
 *
 * @example
 * ```ts
 * const histogram = Metrics.renderDurationHistogram
 * ```
 *
 * @category Metrics
 * @public
 * @since 1.0.0
 */
export const renderDurationHistogram: Metric.Histogram<number> = Metric.histogram(
  "trygg.render.duration_ms",
  {
    boundaries: renderDurationBoundaries,
    description: "Distribution of component render durations in milliseconds",
  },
);

// --- Metric Recording API ---

/**
 * Increment the navigation counter.
 *
 * @remarks
 * This is the public recording helper used by framework code and tests.
 *
 * @example
 * ```ts
 * yield* Metrics.recordNavigation
 * ```
 *
 * @category Metrics
 * @public
 * @since 1.0.0
 */
export const recordNavigation: Effect.Effect<void> = Metric.update(navigationCounter, 1);

/**
 * Increment the route error counter.
 *
 * @remarks
 * Call this when route work fails and the framework-level error counter should
 * advance.
 *
 * @example
 * ```ts
 * yield* Metrics.recordRouteError
 * ```
 *
 * @category Metrics
 * @public
 * @since 1.0.0
 */
export const recordRouteError: Effect.Effect<void> = Metric.update(routeErrorCounter, 1);

/**
 * Increment the signal update counter.
 *
 * @remarks
 * Call this when a signal write changed the stored value.
 *
 * @example
 * ```ts
 * yield* Metrics.recordSignalUpdate
 * ```
 *
 * @category Metrics
 * @public
 * @since 1.0.0
 */
export const recordSignalUpdate: Effect.Effect<void> = Metric.update(signalUpdateCounter, 1);

/**
 * Increment the component render counter.
 *
 * @remarks
 * Call this when a component render cycle completes and should count toward the
 * public render metric.
 *
 * @example
 * ```ts
 * yield* Metrics.recordComponentRender
 * ```
 *
 * @category Metrics
 * @public
 * @since 1.0.0
 */
export const recordComponentRender: Effect.Effect<void> = Metric.update(componentRenderCounter, 1);

/**
 * Record a render duration in milliseconds.
 *
 * @remarks
 * This updates the shared render duration histogram with a measured latency.
 *
 * @example
 * ```ts
 * yield* Metrics.recordRenderDuration(12)
 * ```
 *
 * @category Metrics
 * @public
 * @since 1.0.0
 */
export const recordRenderDuration = (durationMs: number): Effect.Effect<void> =>
  Metric.update(renderDurationHistogram, durationMs);

// --- Snapshot API ---

/**
 * Metrics snapshot structure.
 * Contains current values for all tracked metrics.
 *
 * @remarks
 * Snapshots are the serializable shape handed to metrics sinks.
 *
 * @example
 * ```ts
 * const snapshot: Metrics.MetricsSnapshot = yield* Metrics.snapshot
 * ```
 *
 * @category Metrics
 * @public
 * @since 1.0.0
 */
export interface MetricsSnapshot {
  /** Total number of navigation events */
  readonly navigationCount: number;
  /** Total number of route errors */
  readonly routeErrorCount: number;
  /** Total number of signal value changes */
  readonly signalUpdateCount: number;
  /** Total number of component renders */
  readonly componentRenderCount: number;
  /** Render duration histogram state */
  readonly renderDurationHistogram: {
    readonly count: number;
    readonly min: number;
    readonly max: number;
    readonly sum: number;
    readonly buckets: ReadonlyArray<readonly [number, number]>;
  };
}

/**
 * Get current metrics snapshot.
 * Returns current values for all tracked metrics.
 *
 * @remarks
 * Use this when exporting or asserting framework metrics from Effects.
 *
 * @example
 * ```ts
 * const snapshot = yield* Metrics.snapshot
 * ```
 *
 * @category Metrics
 * @public
 * @since 1.0.0
 */
export const snapshot: Effect.Effect<MetricsSnapshot> = Effect.gen(function* () {
  const navState = yield* Metric.value(navigationCounter);
  const errorState = yield* Metric.value(routeErrorCounter);
  const signalState = yield* Metric.value(signalUpdateCounter);
  const renderState = yield* Metric.value(componentRenderCounter);
  const histState = yield* Metric.value(renderDurationHistogram);

  return {
    navigationCount: extractCounterValue(navState),
    routeErrorCount: extractCounterValue(errorState),
    signalUpdateCount: extractCounterValue(signalState),
    componentRenderCount: extractCounterValue(renderState),
    renderDurationHistogram: extractHistogramValue(histState),
  };
});

/**
 * Extract numeric value from counter state.
 */
const extractCounterValue = (state: Metric.CounterState<number>): number => {
  return state.count;
};

/**
 * Extract histogram values from histogram state.
 */
const extractHistogramValue = (
  state: Metric.HistogramState,
): MetricsSnapshot["renderDurationHistogram"] => {
  return {
    count: state.count,
    min: state.min,
    max: state.max,
    sum: state.sum,
    buckets: state.buckets,
  };
};

// --- Export Sink API ---

/**
 * Metrics sink interface.
 * Implement this to export metrics to external systems.
 *
 * @remarks
 * A sink consumes `MetricsSnapshot` values during explicit export operations.
 *
 * @example
 * ```ts
 * const sink: Metrics.MetricsSink = Metrics.createSink("capture", () => Effect.void)
 * ```
 *
 * @category Metrics
 * @public
 * @since 1.0.0
 */
export interface MetricsSink {
  /** Unique sink identifier */
  readonly name: string;

  /**
   * Export a metrics snapshot.
   * Called periodically or on-demand.
   */
  readonly export: (snapshot: MetricsSnapshot) => Effect.Effect<void>;
}

/**
 * Create a metrics sink.
 *
 * @remarks
 * Prefer this helper over hand-writing objects so sink construction stays terse
 * and aligned with the public `MetricsSink` shape.
 *
 * @example
 * ```ts
 * const sink = Metrics.createSink("capture", () => Effect.void)
 * ```
 *
 * @category Metrics
 * @public
 * @since 1.0.0
 */
export const createSink = (
  name: string,
  exportFn: (snapshot: MetricsSnapshot) => Effect.Effect<void>,
): MetricsSink => ({ name, export: exportFn });

/**
 * Registered metrics sinks.
 */
const _sinks: Map<string, MetricsSink> = new Map();

/**
 * Register a metrics sink.
 *
 * @remarks
 * Registered sinks receive snapshots when `exportToSinks` runs.
 *
 * @example
 * ```ts
 * Metrics.registerSink(Metrics.consoleSink)
 * ```
 *
 * @category Metrics
 * @public
 * @since 1.0.0
 */
export const registerSink = (sink: MetricsSink): void => {
  _sinks.set(sink.name, sink);
};

/**
 * Unregister a metrics sink by name.
 *
 * @remarks
 * Use the sink's `name` field to remove it from the global registry.
 *
 * @example
 * ```ts
 * Metrics.unregisterSink("console")
 * ```
 *
 * @category Metrics
 * @public
 * @since 1.0.0
 */
export const unregisterSink = (name: string): void => {
  _sinks.delete(name);
};

/**
 * Get all registered sink names.
 *
 * @remarks
 * Useful for tests and setup code that need to inspect or reset the sink
 * registry.
 *
 * @example
 * ```ts
 * const sinks = Metrics.getSinks()
 * ```
 *
 * @category Metrics
 * @public
 * @since 1.0.0
 */
export const getSinks = (): ReadonlyArray<string> => {
  return Array.from(_sinks.keys());
};

/**
 * Check if a sink is registered.
 *
 * @remarks
 * This is a convenience query over the global sink registry.
 *
 * @example
 * ```ts
 * const hasConsole = Metrics.hasSink("console")
 * ```
 *
 * @category Metrics
 * @public
 * @since 1.0.0
 */
export const hasSink = (name: string): boolean => {
  return _sinks.has(name);
};

/**
 * Export current metrics to all registered sinks.
 * Errors in individual sinks are caught and logged.
 *
 * @remarks
 * Sink failures do not stop later sinks from receiving the same snapshot.
 *
 * @example
 * ```ts
 * yield* Metrics.exportToSinks
 * ```
 *
 * @category Metrics
 * @public
 * @since 1.0.0
 */
export const exportToSinks: Effect.Effect<void> = Effect.gen(function* () {
  if (_sinks.size === 0) return;

  const currentSnapshot = yield* snapshot;

  for (const sink of _sinks.values()) {
    yield* sink.export(currentSnapshot).pipe(
      Effect.catchCause((cause) =>
        Effect.sync(() => {
          metricsLogger.error(`Metrics sink "${sink.name}" error:`, cause);
        }),
      ),
    );
  }
});

// --- Built-in Sinks ---

/**
 * Console sink - logs metrics snapshot to console.
 * Useful for development.
 *
 * @remarks
 * Register this sink when snapshots should be printed to the console in a
 * compact development-friendly shape.
 *
 * @example
 * ```ts
 * Metrics.registerSink(Metrics.consoleSink)
 * ```
 *
 * @category Metrics
 * @public
 * @since 1.0.0
 */
export const consoleSink: MetricsSink = createSink("console", (s) =>
  Effect.sync(() => {
    metricsLogger.withTag("metrics").log({
      navigation: s.navigationCount,
      errors: s.routeErrorCount,
      signals: s.signalUpdateCount,
      renders: s.componentRenderCount,
      renderDuration: {
        count: s.renderDurationHistogram.count,
        min: s.renderDurationHistogram.min,
        max: s.renderDurationHistogram.max,
        avg:
          s.renderDurationHistogram.count > 0
            ? s.renderDurationHistogram.sum / s.renderDurationHistogram.count
            : 0,
      },
    });
  }),
);

/**
 * Create a collector sink that stores snapshots in an array.
 * Useful for testing.
 *
 * @remarks
 * Prefer this in tests that need to capture exported snapshots for assertions.
 *
 * @example
 * ```ts
 * const sink = Metrics.createCollectorSink("capture", [])
 * ```
 *
 * @category Metrics
 * @public
 * @since 1.0.0
 */
export const createCollectorSink = (name: string, snapshots: MetricsSnapshot[]): MetricsSink =>
  createSink(name, (s) =>
    Effect.sync(() => {
      snapshots.push(s);
    }),
  );
