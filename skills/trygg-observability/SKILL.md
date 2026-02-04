---
name: trygg-observability
description: trygg observability — DevMode component, wide debug events, console output, event filtering, debug plugins, trace correlation, metrics counters/histograms/sinks, and LLM test server. Use when enabling debug output, filtering events by category, understanding why a component re-rendered, diagnosing fine-grained reactivity, debugging navigation performance, checking Resource cache behavior, writing custom debug plugins, correlating traces across navigation flows, recording/exporting metrics, or setting up the HTTP debug server for LLM-driven testing.
---

# trygg Observability

Wide events approach to observability — one comprehensive event per operation.

## Decision Tree

```
What are you debugging?
|
+-- Enable debug output?
|   +-- Component: <DevMode /> (recommended)
|   +-- Filtered: <DevMode filter="signal" /> or filter={["signal", "render.component"]}
|   +-- Conditional: <DevMode enabled={import.meta.env.DEV} />
|   See: references/observability.md §Enabling Debug Output
|
+-- Why did component re-render?
|   +-- Look for render.component.rerender — trigger field shows cause
|   +-- accessed_signals shows subscription count
|   See: references/observability.md §Debugging Scenarios
|
+-- Is fine-grained reactivity working?
|   +-- Look for render.signaltext.update or render.signalelement.swap
|       WITHOUT render.component.rerender
|   See: references/observability.md §Debugging Scenarios
|
+-- UI not updating?
|   +-- Check signal.set fires, listener_count > 0
|   +-- Check signal.set.skipped (value unchanged)
|   +-- Check signal.listener.error (isolated failure)
|   See: references/observability.md §Debugging Scenarios
|
+-- Navigation slow?
|   +-- Check router.module.load.* duration_ms
|   +-- Check router.module.load.cache_hit (prefetch working?)
|   See: references/observability.md §Debugging Scenarios
|
+-- Custom plugin?
|   +-- Debug.createPlugin(name, handler)
|   +-- Debug.createCollectorPlugin(name, events[]) for testing
|   See: references/observability.md §Plugin System
|
+-- Metrics?
|   +-- Built-in: navigation, route error, signal update, component render counters
|   +-- Histogram: render duration
|   +-- Snapshot: Metrics.snapshot
|   +-- Sinks: Metrics.createSink, consoleSink, createCollectorSink
|   See: references/observability.md §Metrics
|
+-- LLM test server?
|   +-- Debug.serverLayer({ port: 4567 })
|   +-- HTTP endpoints: /health, /logs, /stats
|   +-- Query: level, eventType, traceId, after/before, limit
|   See: references/observability.md §LLM Test Observability
```

## Event Categories

| Category | Color | Prefix |
|----------|-------|--------|
| Render | Indigo | `render.*` |
| Signal | Green | `signal.*` |
| Resource | Amber | `resource.*` |
| Router | Purple | `router.*` |
| Trace | Pink | `trace.*` |
| API | Blue | `api.*` |

## Reference Files

| File | When to Read |
|------|-------------|
| [observability.md](references/observability.md) | Full event reference, plugins, metrics, debug server, debugging scenarios |
