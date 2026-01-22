/**
 * @since 1.0.0
 * Metrics for effect-ui observability
 *
 * Provides counters and histograms for tracking navigation, rendering, and signal updates.
 * Uses Effect Metrics with a prefix `effectui.` for all metric names.
 *
 * @example
 * ```tsx
 * import * as Metrics from "effect-ui/metrics"
 * import { Effect } from "effect"
 *
 * // Get current metrics snapshot
 * const snapshot = yield* Metrics.snapshot
 * console.log(snapshot.navigationCount)
 *
 * // Use with a Layer to export metrics
 * const MyApp = pipe(
 *   app,
 *   Effect.provide(Metrics.layer)
 * )
 * ```
 */
import { createConsola } from "consola";
import { Effect, Metric, MetricBoundaries, MetricState } from "effect";

const metricsLogger = createConsola({ defaults: { tag: "effectui" } });

// --- Naming Convention ---
// All metrics use `effectui.` prefix
// Categories: router, render, signal
// Format: effectui.<category>.<metric_name>

// --- Counters ---

/**
 * Counter for navigation events.
 * Incremented on each Router.navigate() call.
 * @since 1.0.0
 */
export const navigationCounter: Metric.Metric.Counter<number> = Metric.counter(
  "effectui.router.navigate.count",
  { description: "Total number of navigation events", incremental: true },
);

/**
 * Counter for route errors.
 * Incremented when a route render fails.
 * @since 1.0.0
 */
export const routeErrorCounter: Metric.Metric.Counter<number> = Metric.counter(
  "effectui.router.error.count",
  { description: "Total number of route errors", incremental: true },
);

/**
 * Counter for signal updates.
 * Incremented on each Signal.set() or Signal.update() that changes value.
 * @since 1.0.0
 */
export const signalUpdateCounter: Metric.Metric.Counter<number> = Metric.counter(
  "effectui.signal.update.count",
  { description: "Total number of signal value changes", incremental: true },
);

/**
 * Counter for component renders.
 * Incremented on initial render and re-renders.
 * @since 1.0.0
 */
export const componentRenderCounter: Metric.Metric.Counter<number> = Metric.counter(
  "effectui.render.component.count",
  { description: "Total number of component renders", incremental: true },
);

// --- Histograms ---

/**
 * Histogram boundaries for render duration (in milliseconds).
 * Buckets: 0, 1, 2, 5, 10, 25, 50, 100, 250, 500, 1000
 * @since 1.0.0
 */
export const renderDurationBoundaries: MetricBoundaries.MetricBoundaries =
  MetricBoundaries.fromIterable([0, 1, 2, 5, 10, 25, 50, 100, 250, 500, 1000]);

/**
 * Histogram for component render duration.
 * Records how long each component render takes in milliseconds.
 * @since 1.0.0
 */
export const renderDurationHistogram: Metric.Metric.Histogram<number> = Metric.histogram(
  "effectui.render.duration_ms",
  renderDurationBoundaries,
  "Distribution of component render durations in milliseconds",
);

// --- Metric Recording API ---

/**
 * Increment the navigation counter.
 * @since 1.0.0
 */
export const recordNavigation: Effect.Effect<void> = Metric.increment(navigationCounter);

/**
 * Increment the route error counter.
 * @since 1.0.0
 */
export const recordRouteError: Effect.Effect<void> = Metric.increment(routeErrorCounter);

/**
 * Increment the signal update counter.
 * @since 1.0.0
 */
export const recordSignalUpdate: Effect.Effect<void> = Metric.increment(signalUpdateCounter);

/**
 * Increment the component render counter.
 * @since 1.0.0
 */
export const recordComponentRender: Effect.Effect<void> = Metric.increment(componentRenderCounter);

/**
 * Record a render duration in milliseconds.
 * @since 1.0.0
 */
export const recordRenderDuration = (durationMs: number): Effect.Effect<void> =>
  Effect.sync(() => {
    renderDurationHistogram.unsafeUpdate(durationMs, []);
  });

// --- Snapshot API ---

/**
 * Metrics snapshot structure.
 * Contains current values for all tracked metrics.
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
const extractCounterValue = (state: MetricState.MetricState.Counter<number>): number => {
  return state.count;
};

/**
 * Extract histogram values from histogram state.
 */
const extractHistogramValue = (
  state: MetricState.MetricState.Histogram,
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
 * @since 1.0.0
 */
export const registerSink = (sink: MetricsSink): void => {
  _sinks.set(sink.name, sink);
};

/**
 * Unregister a metrics sink by name.
 * @since 1.0.0
 */
export const unregisterSink = (name: string): void => {
  _sinks.delete(name);
};

/**
 * Get all registered sink names.
 * @since 1.0.0
 */
export const getSinks = (): ReadonlyArray<string> => {
  return Array.from(_sinks.keys());
};

/**
 * Check if a sink is registered.
 * @since 1.0.0
 */
export const hasSink = (name: string): boolean => {
  return _sinks.has(name);
};

/**
 * Export current metrics to all registered sinks.
 * Errors in individual sinks are caught and logged.
 * @since 1.0.0
 */
export const exportToSinks: Effect.Effect<void> = Effect.gen(function* () {
  if (_sinks.size === 0) return;

  const currentSnapshot = yield* snapshot;

  for (const sink of _sinks.values()) {
    yield* sink.export(currentSnapshot).pipe(
      Effect.catchAllCause((cause) =>
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
 * @since 1.0.0
 */
export const createCollectorSink = (name: string, snapshots: MetricsSnapshot[]): MetricsSink =>
  createSink(name, (s) =>
    Effect.sync(() => {
      snapshots.push(s);
    }),
  );
