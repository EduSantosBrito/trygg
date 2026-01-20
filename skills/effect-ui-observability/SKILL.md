---
name: effect-ui-observability
description: Debug events, tracing, and metrics for effect-ui applications. Use when debugging components, adding logging, tracking performance, or setting up monitoring.
license: MIT
metadata:
  author: effect-ui
  version: "1.0"
---

# effect-ui Observability

Debug events, tracing, and metrics.

## Quick Start

Add `<DevMode />` to see debug events:

```tsx
import { DevMode } from "effect-ui"

mount(container, <>
  {App}
  <DevMode />
</>)
```

## DevMode Options

```tsx
// Filter by category
<DevMode filter="signal" />

// Filter specific events
<DevMode filter={["signal.set", "render.component"]} />

// Conditional enable
<DevMode enabled={import.meta.env.DEV} />

// Custom plugins
<DevMode plugins={[Debug.consolePlugin, myPlugin]} />
```

## Debug Events

### Signal Events

| Event | Description |
|-------|-------------|
| `signal.create` | Signal created |
| `signal.get` | Signal read (subscribes) |
| `signal.set` | Value changed |
| `signal.set.skipped` | Set skipped (unchanged) |
| `signal.update` | Updated via function |

### Render Events

| Event | Description |
|-------|-------------|
| `render.component.initial` | First render |
| `render.component.rerender` | Re-render |
| `render.component.cleanup` | Unmounted |
| `render.signaltext.update` | Fine-grained text update |

## Plugin System

### Built-in Plugins

```ts
import * as Debug from "effect-ui/debug"

// Console output (default)
Debug.consolePlugin

// Collect events into array
const events: Debug.DebugEvent[] = []
Debug.createCollectorPlugin("my-collector", events)
```

### Custom Plugin

```ts
const remotePlugin = Debug.createPlugin("remote", (event) => {
  fetch("/api/logs", { method: "POST", body: JSON.stringify(event) })
})

<DevMode plugins={[Debug.consolePlugin, remotePlugin]} />
```

## Trace Correlation

Events within a navigation flow share a `traceId`:

```ts
{
  event: "router.navigate",
  traceId: "trace_42",
  from_path: "/home",
  to_path: "/users"
}
{
  event: "signal.set",
  traceId: "trace_42",  // Same trace
  signal_id: "sig_1"
}
```

### Manual Spans

```ts
import * as Debug from "effect-ui/debug"

const endSpan = Debug.startSpan("fetch-data", { url: "/api/users" })
await fetchData()
endSpan()

// Or with auto error handling
const result = Debug.withSpan("process", () => {
  return processData()
})
```

## Metrics

### Built-in Metrics

| Metric | Type |
|--------|------|
| `effectui.router.navigate.count` | Counter |
| `effectui.router.error.count` | Counter |
| `effectui.signal.update.count` | Counter |
| `effectui.render.component.count` | Counter |
| `effectui.render.duration_ms` | Histogram |

### Getting Metrics

```ts
import * as Metrics from "effect-ui/metrics"

const snap = yield* Metrics.snapshot

console.log({
  navigations: snap.navigationCount,
  errors: snap.routeErrorCount,
  signalUpdates: snap.signalUpdateCount,
  renders: snap.componentRenderCount
})
```

### Export to External Systems

```ts
const telemetrySink = Metrics.createSink("telemetry", (snapshot) =>
  Effect.promise(async () => {
    await fetch("/api/metrics", {
      method: "POST",
      body: JSON.stringify(snapshot)
    })
  })
)

Metrics.registerSink(telemetrySink)
yield* Metrics.exportToSinks
```

## Debugging Scenarios

### "Why did my component re-render?"
Look for `render.component.rerender`. Check `trigger` field.

### "Is fine-grained reactivity working?"
Look for `render.signaltext.update` WITHOUT `render.component.rerender`.

### "Why isn't my UI updating?"
1. Check `signal.set` events are firing
2. Check `listener_count` > 0
3. Check for `signal.set.skipped`

## Production Safety

- `<DevMode />` does nothing in production
- URL params/localStorage escape hatches disabled in production

## Escape Hatches (Dev Only)

```js
// URL parameter
http://localhost:5173/?effectui_debug

// localStorage
localStorage.setItem("effectui_debug", "true")
```
