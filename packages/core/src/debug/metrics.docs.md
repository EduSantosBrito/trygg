# Metrics

## When to use

Use `Metrics` when you want the framework's counters and render timing histogram through a stable public surface, or when exporting snapshots to custom sinks.

## Behavior

`Metrics` exposes named counters and histograms, recording helpers, snapshot access, and sink registration helpers for piping framework metrics into logs or external collectors.

## Related exports

- `Metrics.snapshot`
- `Metrics.exportToSinks`
- `Metrics.consoleSink`
- `Metrics.createCollectorSink`
