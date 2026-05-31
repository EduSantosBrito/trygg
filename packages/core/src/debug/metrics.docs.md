# Metrics

Read framework throughput and render timing from one metric snapshot — render, navigation, signal-write, and provider counts plus render-duration distribution — without adding any instrumentation of your own.

```ts
import { Effect } from "effect";
import { Metrics } from "trygg";

const program = Effect.gen(function* () {
  const snap = yield* Metrics.snapshot;
  yield* Effect.log(`renders=${snap.componentRenderCount} navigations=${snap.navigationCount}`);
  yield* Effect.log(`render max=${snap.renderDurationHistogram.max}ms`);
});
```

## When to use

Reach for `Metrics` when you want aggregate framework counts and the render-duration distribution: how many renders, navigations, signal writes, and provider acquisitions have happened, and how long renders take.

- Use `Metrics.snapshot` to read current values inside an Effect, for assertions or a custom export.
- Use the sink helpers (`Metrics.registerSink`, `Metrics.exportToSinks`) to push snapshots to the console or an external collector on your own schedule.
- The exported instruments (`Metrics.componentRenderCounter`, `Metrics.renderDurationHistogram`, and the rest) are ordinary Effect `Metric` values, so you can read them with `Metric.value` alongside your app's own metrics instead of going through `snapshot`.

For per-event, human-readable output of the same lifecycle steps, use `Debug`. `Metrics` and `Debug` are complementary views of the same framework activity: aggregate numbers, and a readable per-event stream.

## Behavior

All instruments are created at module load with the `trygg.` prefix, grouped by category (`router`, `render`, `signal`, `provider`):

- Counters: `navigationCounter`, `routeErrorCounter`, `signalUpdateCounter`, `disposedSignalAccessCounter`, `providerAcquisitionCounter`, `providerFinalizationCounter`, `componentRenderCounter`.
- Histograms: `renderDurationHistogram`, `providerAcquisitionDurationHistogram`, `providerFinalizationDurationHistogram`, all using `renderDurationBoundaries` (0, 1, 2, 5, 10, 25, 50, 100, 250, 500, 1000 ms).

Framework internals advance these through the recording helpers (`recordNavigation`, `recordComponentRender`, `recordRenderDuration(ms)`, and so on); each is an `Effect`, and the duration recorders take a millisecond number. The signal update counter only advances on a write that changes the stored value; the disposed-access counter advances when code reads or writes a Signal after its owner is disposed.

`Metrics.snapshot` is an `Effect<MetricsSnapshot>` that reads every instrument via `Metric.value` and flattens it: counters become plain numbers (`componentRenderCount`, `navigationCount`, and the rest) and histograms become `{ count, min, max, sum, buckets }`, where `buckets` is a `ReadonlyArray<readonly [number, number]>` of boundary/cumulative-count pairs. There is no average field; compute it as `sum / count` and guard against `count === 0`.

Counters are cumulative and never reset within a process, so snapshots reflect totals since module load, not a window. For an exported view, implement `MetricsSink` (or use `Metrics.createSink` / `Metrics.createCollectorSink`), register it, and call `Metrics.exportToSinks`; sink failures are caught and logged so one failing sink does not block the others, and `exportToSinks` is a no-op when no sink is registered. The sink registry is module-global, so register and unregister around tests with `Metrics.unregisterSink` to avoid cross-test leakage.

## Related exports

- `Metrics.snapshot` — read all instrument values as one flattened object
- `Metrics.MetricsSnapshot` — the flattened counters-and-histograms shape `snapshot` resolves to
- `Metrics.exportToSinks` — push a snapshot to every registered sink
- `Metrics.registerSink` — add a sink to the module-global registry
- `Metrics.createSink` — build a `MetricsSink` for exporting snapshots
- `Metrics.createCollectorSink` — sink collecting snapshots into a fresh array
- `Metrics.consoleSink` — sink that writes snapshots to the console
- `Metrics.componentRenderCounter` — Effect `Metric` counting component renders
- `Metrics.renderDurationHistogram` — Effect `Metric` histogram of render durations

## Troubleshooting

- Snapshot counts look too high: counters are cumulative for the process lifetime, not per-render or per-window. Take two snapshots and subtract to measure a span.
- Histogram has no `avg`: `MetricsSnapshot` exposes `count`, `min`, `max`, `sum`, and `buckets` only. Derive the average from `sum / count`, returning 0 when `count` is 0.
- A registered sink throws and nothing surfaces: `exportToSinks` catches each sink's cause and logs it under the sink's `name`, then continues to the next sink; check the logged error rather than expecting `exportToSinks` to fail.
- Tests see metrics from other tests: the sink registry and counters are module-global. Use `Metrics.createCollectorSink` with a fresh array, register it for the test, and `Metrics.unregisterSink` after.