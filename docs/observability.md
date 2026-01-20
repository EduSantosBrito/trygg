# Effect UI - Observability

effect-ui follows the **wide events** approach to observability, inspired by [loggingsucks.com](https://loggingsucks.com/).

## Philosophy

> Instead of logging what your code is doing, log what happened to this operation.

Traditional logging scatters context across dozens of log lines. Wide events emit **one comprehensive, structured event per operation** with all the context you need for debugging.

When something goes wrong, you don't grep through scattered logs. You query structured data:
- "Show me all signal updates in the Counter component"
- "Show me all re-renders triggered by sig_3"
- "Show me all skipped updates (unchanged values)"

## Enabling Debug Output

### Component-Based (Recommended)

Add the `<DevMode />` component to your app:

```tsx
import { Effect } from "effect"
import { mount, DevMode } from "effect-ui"

const App = Effect.gen(function* () {
  // your app
})

mount(container, <>
  {App}
  <DevMode />
</>)
```

That's it. Debug events will appear in your browser console.

### Filtering Events

```tsx
// Only signal events
<DevMode filter="signal" />

// Only specific events
<DevMode filter={["signal.set", "render.component"]} />

// Multiple categories
<DevMode filter={["signal", "render.component"]} />
```

### Conditional Enable

```tsx
// Only in development
<DevMode enabled={import.meta.env.DEV} />
```

### Escape Hatches (Development Only)

For quick debugging during development without modifying code:

```js
// URL parameter (development only)
http://localhost:5173/?effectui_debug
http://localhost:5173/?effectui_debug=signal

// localStorage (development only, persists across reloads)
localStorage.setItem("effectui_debug", "true")
localStorage.setItem("effectui_debug", "signal,render")

// To disable
localStorage.removeItem("effectui_debug")
```

**Security Note**: These escape hatches only work in development mode (`import.meta.env.DEV === true` or `NODE_ENV === "development"`). In production builds, they are disabled for security. Debug output could expose internal state and component hierarchy.

## Event Reference

### Signal Events

| Event | Description | Key Fields |
|-------|-------------|------------|
| `signal.create` | Signal created | `signal_id`, `value`, `component` |
| `signal.get` | Signal read (subscribes component) | `signal_id`, `trigger` |
| `signal.set` | Signal value changed | `signal_id`, `prev_value`, `value`, `listener_count` |
| `signal.set.skipped` | Set skipped (value unchanged) | `signal_id`, `value`, `reason` |
| `signal.update` | Signal updated via function | `signal_id`, `prev_value`, `value`, `listener_count` |
| `signal.update.skipped` | Update skipped (value unchanged) | `signal_id`, `value`, `reason` |
| `signal.notify` | Listeners notified of change | `signal_id`, `listener_count` |
| `signal.listener.error` | Listener threw an error (isolated) | `signal_id`, `cause`, `listener_index` |
| `signal.subscribe` | Listener subscribed | `signal_id`, `listener_count` |
| `signal.unsubscribe` | Listener unsubscribed | `signal_id`, `listener_count` |

### Render Events

| Event | Description | Key Fields |
|-------|-------------|------------|
| `render.component.initial` | Component first render | `accessed_signals` |
| `render.component.rerender` | Component re-rendered | `trigger`, `accessed_signals` |
| `render.component.cleanup` | Component unmounted | - |
| `render.signaltext.initial` | Signal text node created | `signal_id`, `value` |
| `render.signaltext.update` | Signal text node updated (fine-grained) | `signal_id`, `value` |
| `render.intrinsic` | HTML element rendered | `element_tag` |
| `render.schedule` | Re-render scheduled | `is_rerendering`, `pending_rerender` |

### Router Events

| Event | Description | Key Fields |
|-------|-------------|------------|
| `router.navigate` | Navigation started | `from_path`, `to_path`, `replace` |
| `router.navigate.complete` | Navigation completed | `path` |
| `router.match` | Route matched | `path`, `route_pattern`, `params` |
| `router.match.notfound` | No route matched | `path` |
| `router.guard.start` | Guard check started | `route_pattern`, `has_guard` |
| `router.guard.allow` | Guard allowed navigation | `route_pattern` |
| `router.guard.redirect` | Guard redirected | `route_pattern`, `redirect_to` |
| `router.render.start` | Route render started | `route_pattern`, `params`, `has_layout` |
| `router.render.complete` | Route render completed | `route_pattern`, `has_layout` |
| `router.error` | Route error caught | `route_pattern`, `error` |
| `router.load.cancelled` | Stale route load cancelled | `from_key`, `to_key` |

### Module Loading Events

| Event | Description | Key Fields |
|-------|-------------|------------|
| `router.module.load.start` | Module load started | `path`, `kind`, `is_prefetch`, `attempt` |
| `router.module.load.complete` | Module load completed | `path`, `kind`, `duration_ms`, `is_prefetch`, `attempt` |
| `router.module.load.timeout` | Module load timed out (will retry) | `path`, `kind`, `timeout_ms`, `is_prefetch`, `attempt` |
| `router.module.load.cache_hit` | Module served from cache | `path`, `kind`, `is_prefetch` |
| `router.prefetch.start` | Prefetch started | `path`, `route_pattern`, `module_count` |
| `router.prefetch.complete` | Prefetch completed | `path` |
| `router.prefetch.no_match` | Prefetch path didn't match any route | `path` |

**Module kinds:** `component`, `layout`, `guard`, `loading`, `error`, `not_found`

### Trace Events

| Event | Description | Key Fields |
|-------|-------------|------------|
| `trace.span.start` | Span started | `name`, `attributes` |
| `trace.span.end` | Span completed | `name`, `status`, `error` |

## Wide Event Structure

Every event includes:

```typescript
interface DebugEvent {
  timestamp: string       // ISO timestamp
  event: string           // Event type (e.g., "signal.set")
  
  // Trace context (for correlating events across navigation flows)
  traceId?: string        // Navigation flow ID (e.g., "trace_1")
  spanId?: string         // Current operation span (e.g., "span_1")
  parentSpanId?: string   // Parent span for nesting
  
  // Signal context (when applicable)
  signal_id?: string      // Unique signal identifier (e.g., "sig_1")
  value?: unknown         // Current value
  prev_value?: unknown    // Previous value (for updates)
  listener_count?: number // Number of active listeners
  
  // Render context (when applicable)
  component?: string      // Component identifier
  element_tag?: string    // HTML tag name
  accessed_signals?: number // Signals accessed during render
  
  // Debugging context
  trigger?: string        // What triggered this event
  reason?: string         // Why something was skipped
  duration_ms?: number    // Operation duration
}
```

## Console Output

Events are color-coded by category:

- **Purple** - Signal events (`signal.*`)
- **Red** - Component renders (`render.component.*`)
- **Green** - Fine-grained updates (`render.signaltext.*`)
- **Blue** - Intrinsic elements (`render.intrinsic`)
- **Orange** - Scheduling (`render.schedule`)

Example output:

```
[effectui] signal.create       {signal_id: "sig_1", value: 0, component: "new"}
[effectui] render.component.initial {accessed_signals: 0}
[effectui] signal.set          {signal_id: "sig_1", prev_value: 0, value: 1, listener_count: 1}
[effectui] render.signaltext.update {signal_id: "sig_1", value: 1}
```

## Debugging Scenarios

### "Why did my component re-render?"

Look for `render.component.rerender` events. The `trigger` field tells you what caused it, and `accessed_signals` shows how many signals the component is subscribed to.

### "Is my signal causing unnecessary re-renders?"

Look for `signal.set.skipped` or `signal.update.skipped` events. These show when effect-ui's equality check prevented an update. If you see the same value being set repeatedly, optimize your code to avoid redundant updates.

### "Is fine-grained reactivity working?"

Look for `render.signaltext.update` events without corresponding `render.component.rerender` events. If you see text updates without re-renders, fine-grained reactivity is working correctly.

### "Why isn't my UI updating?"

1. Check if `signal.set` events are firing
2. Check if `listener_count` > 0 (someone is subscribed)
3. Check if `signal.set.skipped` is firing (value unchanged)
4. Look for `render.signaltext.update` or `render.component.rerender`

### "Why is navigation slow?"

1. Check `router.module.load.start` and `router.module.load.complete` events
2. Look at `duration_ms` - are modules loading slowly?
3. Check for `router.module.load.timeout` events (network issues)
4. Check for `router.module.load.cache_hit` - if missing, modules aren't being cached
5. Ensure prefetch is working: check for `router.prefetch.start` on hover/focus

### "Is prefetch working?"

1. Hover over a Link and look for `router.prefetch.start`
2. Check `router.module.load.start` events with `is_prefetch: true`
3. On navigation, look for `router.module.load.cache_hit` - prefetched modules hit cache
4. If `router.prefetch.no_match` appears, the prefetch path doesn't match any route

### "Why did one component stop updating but others work?"

Check for `signal.listener.error` events. When a listener (component subscription) throws an error, the error is isolated and logged rather than crashing the entire update. The failing component won't update, but other components continue working.

```typescript
// Example error event
{
  event: "signal.listener.error",
  signal_id: "sig_1",
  cause: "Error: Component threw during re-render",
  listener_index: 2  // Third listener (0-indexed)
}
```

Signal listeners run in parallel with error isolation:
- All listeners start simultaneously for better performance
- One failing listener doesn't block or crash others
- Errors are captured and logged for debugging

## Production Safety

- `<DevMode />` checks `import.meta.env.DEV` and does nothing in production
- URL params and localStorage escape hatches are disabled in production
- Debug output is never emitted in production builds
- To debug a production issue, use `<DevMode enabled={true} />` explicitly (not recommended)

## Best Practices

1. **Keep DevMode in development only** - Use `<DevMode enabled={import.meta.env.DEV} />` to be explicit
2. **Use filters for noisy apps** - Large apps generate many events; filter to what you're debugging
3. **Check skipped events** - They reveal optimization opportunities
4. **Watch listener counts** - Unexpected counts may indicate subscription leaks

## Debug Layers

Debug sinks are configured via Effect Layers, enabling composable observability configurations.

### Default Layer

The default layer registers the console plugin for development:

```typescript
import { Effect } from "effect"
import * as Debug from "effect-ui/debug"

// Explicitly provide console output
Effect.runPromise(
  myEffect.pipe(Effect.provide(Debug.defaultLayer))
)
```

### Server Layer

For LLM observability, use `Debug.serverLayer()` to start TestServer and capture events:

```typescript
import { Effect } from "effect"
import * as Debug from "effect-ui/debug"
import { TestServer } from "effect-ui"

const program = Effect.gen(function* () {
  const server = yield* TestServer
  console.log(`Server running at ${server.url}`)
  
  // Debug.log calls are now captured by TestServer
  Debug.enable()
  yield* Debug.log({ event: "signal.set", signal_id: "sig_1", prev_value: 0, value: 1, listener_count: 1 })
  
  // Query captured events
  const errors = yield* server.query({ level: "error" })
})

Effect.runPromise(
  Effect.scoped(program.pipe(Effect.provide(Debug.serverLayer({ port: 4567 }))))
)
```

### Server Layer Configuration

```typescript
Debug.serverLayer({
  port: 4567,                              // HTTP server port (default: 4567)
  dbPath: ":memory:",                      // SQLite path (default: in-memory)
  connectionInfoPath: ".effect/server.json" // Connection info file
})
```

## Plugin System

Debug events are dispatched through a plugin system, allowing multiple outputs to receive the same structured events.

### Built-in Plugins

**Console Plugin** - The default output when no custom plugins are registered:

```tsx
import * as Debug from "effect-ui/debug"

// Explicitly use the console plugin
<DevMode plugins={[Debug.consolePlugin]} />
```

**Collector Plugin** - Useful for testing or building custom processors:

```tsx
const events: Debug.DebugEvent[] = []
const collector = Debug.createCollectorPlugin("my-collector", events)

<DevMode plugins={[collector]} />

// Later: inspect collected events
console.log(events)
```

### Creating Custom Plugins

```tsx
import * as Debug from "effect-ui/debug"

// Create a plugin that sends events to a remote server
const remotePlugin = Debug.createPlugin("remote", (event) => {
  fetch("/api/logs", {
    method: "POST",
    body: JSON.stringify(event)
  })
})

// Use multiple plugins together
<DevMode plugins={[Debug.consolePlugin, remotePlugin]} />
```

### Plugin API

```typescript
// Plugin interface
interface DebugPlugin {
  readonly name: string
  readonly handle: (event: DebugEvent) => void
}

// Create a plugin
Debug.createPlugin(name: string, handle: (event: DebugEvent) => void): DebugPlugin

// Create a collector plugin
Debug.createCollectorPlugin(name: string, events: DebugEvent[]): DebugPlugin

// Manual plugin registration (advanced)
Debug.registerPlugin(plugin: DebugPlugin): void
Debug.unregisterPlugin(name: string): void
Debug.hasPlugin(name: string): boolean
Debug.getPlugins(): ReadonlyArray<string>
```

### Plugin Behavior

- **Fan-out dispatch**: All registered plugins receive every event that passes the filter
- **Error isolation**: One plugin throwing doesn't affect other plugins
- **Default fallback**: When no plugins are registered, the console plugin is used automatically

## Integration with Effect

Debug events are emitted through Effect's logging system when available, enabling integration with:
- OpenTelemetry
- Custom log transports
- Test assertions on debug output

For advanced telemetry integration, see the Effect documentation on logging and tracing.

## Trace Correlation

Events within a navigation flow share a `traceId`, making it easy to correlate related operations. Each `Router.navigate()` call generates a new trace ID that propagates through all subsequent events.

### Trace IDs

```typescript
// Events share the same traceId within a navigation flow
{
  event: "router.navigate",
  traceId: "trace_42",
  from_path: "/home",
  to_path: "/users"
}
{
  event: "router.match",
  traceId: "trace_42",  // Same trace
  path: "/users",
  route_pattern: "/users"
}
{
  event: "signal.set",
  traceId: "trace_42",  // Same trace
  signal_id: "sig_1",
  value: "users"
}
```

### Manual Spans

For custom operations, you can create spans that track start/end with error handling:

```typescript
import * as Debug from "effect-ui/debug"

// Simple span
const endSpan = Debug.startSpan("fetch-data", { url: "/api/users" })
try {
  await fetchData()
  endSpan() // Logs span.end with status: "ok"
} catch (e) {
  // Manual error handling needed
}

// withSpan automatically handles errors
const result = Debug.withSpan("process-data", () => {
  // If this throws, span ends with status: "error"
  return processData()
}, { step: "validation" })
```

### Span Nesting

Spans can be nested to track hierarchical operations:

```typescript
const endOuter = Debug.startSpan("render")
  // Events here have parentSpanId pointing to outer span
  const endInner = Debug.startSpan("layout")
    // Events here have parentSpanId pointing to inner span
  endInner()
endOuter()
```

### Trace Events

| Event | Description | Key Fields |
|-------|-------------|------------|
| `trace.span.start` | Span started | `name`, `attributes` |
| `trace.span.end` | Span completed | `name`, `status`, `error` |

### Debugging with Traces

Filter events by traceId to see everything related to a specific navigation:

```typescript
const events: Debug.DebugEvent[] = []
Debug.registerPlugin(Debug.createCollectorPlugin("collector", events))

// After navigation...
const traceId = "trace_42"
const relatedEvents = events.filter(e => e.traceId === traceId)
```

### Best Practices

1. **Don't create traces manually** - The router creates them automatically on navigate
2. **Use spans for custom operations** - `withSpan` or `startSpan` for operations you want to track
3. **Include attributes** - Add context to spans via the attributes parameter
4. **Query by traceId** - Use plugins to collect and filter events by trace

## Metrics

effect-ui provides Effect Metrics counters and histograms for tracking navigation, rendering, and signal updates.

### Built-in Metrics

| Metric | Type | Description |
|--------|------|-------------|
| `effectui.router.navigate.count` | Counter | Total navigation events |
| `effectui.router.error.count` | Counter | Total route errors |
| `effectui.signal.update.count` | Counter | Total signal value changes |
| `effectui.render.component.count` | Counter | Total component renders |
| `effectui.render.duration_ms` | Histogram | Distribution of render times in ms |

### Getting Metrics Snapshot

```typescript
import * as Metrics from "effect-ui/metrics"
import { Effect } from "effect"

const app = Effect.gen(function* () {
  // ... your app logic ...
  
  // Get current metrics snapshot
  const snap = yield* Metrics.snapshot
  
  console.log({
    navigations: snap.navigationCount,
    errors: snap.routeErrorCount,
    signalUpdates: snap.signalUpdateCount,
    renders: snap.componentRenderCount,
    renderStats: {
      count: snap.renderDurationHistogram.count,
      min: snap.renderDurationHistogram.min,
      max: snap.renderDurationHistogram.max,
      avg: snap.renderDurationHistogram.count > 0 
        ? snap.renderDurationHistogram.sum / snap.renderDurationHistogram.count 
        : 0
    }
  })
})
```

### Exporting Metrics

Metrics can be exported to external systems using sinks:

```typescript
import * as Metrics from "effect-ui/metrics"
import { Effect } from "effect"

// Create a custom sink that sends metrics to your telemetry provider
const telemetrySink = Metrics.createSink("telemetry", (snapshot) =>
  Effect.promise(async () => {
    await fetch("/api/metrics", {
      method: "POST",
      body: JSON.stringify({
        navigation_count: snapshot.navigationCount,
        error_count: snapshot.routeErrorCount,
        signal_count: snapshot.signalUpdateCount,
        render_count: snapshot.componentRenderCount,
        render_p50: snapshot.renderDurationHistogram.buckets[5]?.[1] ?? 0
      })
    })
  })
)

// Register the sink
Metrics.registerSink(telemetrySink)

// Export current metrics to all sinks
yield* Metrics.exportToSinks
```

### Built-in Sinks

**Console Sink** - Logs metrics to console (useful for development):

```typescript
Metrics.registerSink(Metrics.consoleSink)
yield* Metrics.exportToSinks
// Output: [effectui metrics] { navigation: 5, errors: 0, signals: 23, renders: 8, ... }
```

**Collector Sink** - Collects snapshots into an array (useful for testing):

```typescript
const snapshots: Metrics.MetricsSnapshot[] = []
Metrics.registerSink(Metrics.createCollectorSink("test", snapshots))

// After some time...
yield* Metrics.exportToSinks

console.log(snapshots[0]?.navigationCount)
```

### Sink API

```typescript
// Sink interface
interface MetricsSink {
  readonly name: string
  readonly export: (snapshot: MetricsSnapshot) => Effect.Effect<void>
}

// Create a sink
Metrics.createSink(name: string, exportFn: (snapshot) => Effect<void>): MetricsSink

// Register/unregister sinks
Metrics.registerSink(sink: MetricsSink): void
Metrics.unregisterSink(name: string): void
Metrics.hasSink(name: string): boolean
Metrics.getSinks(): ReadonlyArray<string>

// Export to all registered sinks
Metrics.exportToSinks: Effect<void>
```

### Metrics Snapshot Structure

```typescript
interface MetricsSnapshot {
  readonly navigationCount: number
  readonly routeErrorCount: number
  readonly signalUpdateCount: number
  readonly componentRenderCount: number
  readonly renderDurationHistogram: {
    readonly count: number
    readonly min: number
    readonly max: number
    readonly sum: number
    readonly buckets: ReadonlyArray<readonly [number, number]>
  }
}
```

### Best Practices

1. **Export periodically** - Set up an interval to export metrics regularly
2. **Use collector sink in tests** - Verify metrics are recorded correctly
3. **Handle sink errors gracefully** - Sinks errors are caught and logged, not thrown
4. **Filter by histogram buckets** - Use bucket values for percentile analysis

## LLM Test Observability

Tests can opt-in to `Debug.serverLayer` for LLM-queryable debug events via HTTP.

### Usage

```typescript
import { describe, it } from "@effect/vitest"
import { Effect, Layer } from "effect"
import * as Debug from "effect-ui/debug"
import { testLayer, renderElement } from "effect-ui/testing"

// Layer with server for this test file
const layer = Layer.mergeAll(testLayer, Debug.serverLayer({ port: 4567 }))

describe("Counter", () => {
  it.scoped("increments on click", () =>
    Effect.gen(function* () {
      Debug.enable()
      const { getByText } = yield* renderElement(<Counter />)
      getByText("Increment").click()
    }).pipe(Effect.provide(layer))
  )
})
```

### LLM Workflow

1. Run test: `bun test tests/counter.test.ts`
2. Query errors: `curl http://localhost:4567/logs?level=error`
3. Query by event type: `curl http://localhost:4567/logs?eventType=signal`
4. Get stats: `curl http://localhost:4567/stats`

### HTTP Endpoints

| Endpoint | Description |
|----------|-------------|
| `GET /` | API documentation (llms.txt) |
| `GET /health` | Health check |
| `GET /logs` | Query events with filters |
| `GET /stats` | Event counts by level |

### Query Parameters for /logs

- `level`: "debug" | "info" | "warn" | "error"
- `eventType`: prefix match (e.g., "router" matches "router.navigate")
- `traceId`: correlation ID
- `after`: ISO timestamp lower bound
- `before`: ISO timestamp upper bound
- `limit`: max results (default: 1000)
