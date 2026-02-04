# trygg - Observability

trygg follows the **wide events** approach to observability, inspired by [loggingsucks.com](https://loggingsucks.com/).

## Philosophy

> Instead of logging what your code is doing, log what happened to this operation.

Traditional logging scatters context across dozens of log lines. Wide events emit **one comprehensive, structured event per operation** with all the context you need for debugging.

## Enabling Debug Output

### Component-Based (Recommended)

```tsx
import { Component, mount, DevMode } from "trygg"

const App = Component.gen(function* () {
  // your app
})

mount(container, <>
  <App />
  <DevMode />
</>)
```

### Filtering Events

```tsx
<DevMode filter="signal" />
<DevMode filter={["signal", "render.component"]} />
```

### Conditional Enable

```tsx
<DevMode enabled={import.meta.env.DEV} />
```



---

## Event Reference

> **Implementation note:** Some events below are typed in the debug system but not yet emitted by any code path. These are marked with *(reserved)* and may be instrumented in future versions. Events without this marker are actively emitted.

### Signal Events

| Event | Description | Key Fields |
|-------|-------------|------------|
| `signal.create` | Signal created | `signal_id`, `value`, `component` |
| `signal.get` | Signal read (subscribes component) | `signal_id`, `trigger` |
| `signal.get.phase` | Signal get with render phase | `signal_id`, `has_phase` |
| `signal.set` | Signal value changed | `signal_id`, `prev_value`, `value`, `listener_count` |
| `signal.set.skipped` | Set skipped (value unchanged) | `signal_id`, `value`, `reason` |
| `signal.update` | Signal updated via function | `signal_id`, `prev_value`, `value`, `listener_count` |
| `signal.update.skipped` | Update skipped (value unchanged) | `signal_id`, `value`, `reason` |
| `signal.notify` | Listeners notified of change | `signal_id`, `listener_count` |
| `signal.listener.error` | Listener threw (isolated) | `signal_id`, `cause`, `listener_index` |
| `signal.subscribe` | Listener subscribed | `signal_id`, `listener_count` |
| `signal.unsubscribe` | Listener unsubscribed | `signal_id`, `listener_count` |
| `signal.derive.create` | Derived signal created | `signal_id`, `source_id`, `value` |
| `signal.derive.cleanup` | Derived signal cleaned up | `signal_id`, `source_id` |
| `signal.deriveAll.create` | Multi-source derived created | `signal_id`, `source_count`, `value` |
| `signal.deriveAll.cleanup` | Multi-source derived cleaned up | `signal_id`, `source_count` |

### Render Events

| Event | Description | Key Fields |
|-------|-------------|------------|
| `render.component.initial` | Component first render | `accessed_signals` |
| `render.component.rerender` | Component re-rendered | `trigger`, `accessed_signals` |
| `render.component.cleanup` | Component unmounted *(reserved)* | - |
| `render.component.error` | Component render failed *(reserved)* | `reason` |
| `render.component.rerender.error` | Re-render failed *(type exists but emitted as `render.component.rerender` with `trigger: "error"`)* | `reason` |
| `render.signaltext.initial` | Signal text node created | `signal_id`, `value` |
| `render.signaltext.update` | Signal text updated (fine-grained) | `signal_id`, `value` |
| `render.signalelement.initial` | Signal element created | `signal_id` |
| `render.signalelement.swap` | Signal element swapped | `signal_id` |
| `render.signalelement.swap.start` | Swap started | `signal_id` |
| `render.signalelement.swap.cleanup` | Old element cleaned up | `signal_id` |
| `render.signalelement.swap.render` | New element rendered | `signal_id` |
| `render.signalelement.swap.error` | Swap failed | `signal_id`, `error` |
| `render.signalelement.scope.start` | Scoped render started | `signal_id` |
| `render.signalelement.scope.render` | Scoped render executing | `signal_id` |
| `render.signalelement.scope.rendered` | Scoped render completed | `signal_id`, `fragment_children` |
| `render.signalelement.insert` | Element inserted into DOM | `signal_id`, `inserted_children` |
| `render.signalelement.cleanup` | Signal element cleaned up | `signal_id` |
| `render.intrinsic` | HTML element rendered | `element_tag` |
| `render.intrinsic.cleanup.start` | Intrinsic cleanup started *(reserved)* | `element_tag`, `child_count` |
| `render.intrinsic.cleanup.remove` | Intrinsic removed from DOM *(reserved)* | `element_tag`, `in_dom` |
| `render.document` | Document element mapped | `element_tag`, `target` |
| `render.schedule` | Re-render scheduled *(reserved)* | `is_rerendering`, `pending_rerender` |
| `render.errorboundary.initial` | Error boundary mounted | - |
| `render.errorboundary.caught` | Error boundary caught error | `reason` |
| `render.errorboundary.fallback` | Fallback rendered | - |

### Keyed List Events

| Event | Description | Key Fields |
|-------|-------------|------------|
| `render.keyedlist.update` | List reconciliation | `current_keys` |
| `render.keyedlist.item.add` | Item added | `key` |
| `render.keyedlist.item.remove` | Item removed | `key` |
| `render.keyedlist.item.rerender` | Item re-rendered | `key` |
| `render.keyedlist.subscription.add` | Item subscription added | `key`, `signal_id` |
| `render.keyedlist.subscription.remove` | Item subscription removed | `key`, `signal_id` |
| `render.keyedlist.reorder` | Items reordered (LIS) | `total_items`, `moves`, `stable_nodes` |

### Resource Events

| Event | Description | Key Fields |
|-------|-------------|------------|
| `resource.registry.get_existing` | Cache hit | `key` |
| `resource.registry.create_entry` | New cache entry | `key` |
| `resource.fetch.called` | Fetch initiated | `key` |
| `resource.fetch.dedupe_wait` | Waiting on in-flight fetch | `key` |
| `resource.fetch.cached` | Returning cached state | `key`, `state` |
| `resource.fetch.starting` | Starting new fetch | `key` |
| `resource.fetch.start` | Fetch effect executing | `key` |
| `resource.fetch.fork_running` | Fetch forked | `key` |
| `resource.fetch.success` | Fetch succeeded | `key`, `value_type`, `is_array`, `length` |
| `resource.fetch.error` | Fetch failed | `key`, `error`, `error_message` |
| `resource.fetch.set_success` | State set to Success | `key` |
| `resource.fetch.set_failure` | State set to Failure | `key`, `error` |
| `resource.fetch.complete` | Fetch cleanup done | `key` |
| `resource.fetch.defect` | Unexpected defect | `key`, `defect` |
| `resource.fetch.unhandled` | Unhandled cause | `key`, `error`, `error_message` |

### Router Events

| Event | Description | Key Fields |
|-------|-------------|------------|
| `router.navigate` | Navigation started | `from_path`, `to_path`, `replace` |
| `router.navigate.complete` | Navigation completed | `path` |
| `router.match` | Route matched *(reserved)* | `path`, `route_pattern`, `params` |
| `router.match.notfound` | No route matched *(reserved)* | `path` |
| `router.guard.start` | Guard check started *(reserved)* | `route_pattern`, `has_guard` |
| `router.guard.allow` | Guard allowed *(reserved)* | `route_pattern` |
| `router.guard.redirect` | Guard redirected *(reserved)* | `route_pattern`, `redirect_to` |
| `router.guard.skip` | Guard skipped *(reserved)* | `route_pattern`, `reason` |
| `router.render.start` | Route render started *(reserved)* | `route_pattern`, `params`, `has_layout` |
| `router.render.complete` | Route render completed *(reserved)* | `route_pattern`, `has_layout` |
| `router.link.click` | Link clicked | `to_path`, `replace`, `reason` |
| `router.error` | Route error caught *(reserved)* | `route_pattern`, `error` |
| `router.popstate.added` | Popstate listener added | - |
| `router.popstate.removed` | Popstate listener removed | - |
| `router.load.cancelled` | Stale route load cancelled *(reserved)* | `from_key`, `to_key` |
| `router.outlet.start` | Outlet initialized | `routes_count` |
| `router.outlet.nested` | Nested outlet detected | - |
| `router.outlet.no_routes` | No routes manifest | - |
| `router.outlet.matching` | Outlet matching path | `path` |
| `router.matcher.compile` | Trie compiled *(reserved)* | `route_count`, `is_recompile` |
| `router.matcher.cached` | Matcher from cache *(reserved)* | `route_count` |
| `router.404.render` | 404 component rendered *(reserved)* | `path`, `has_custom_404` |
| `router.404.fallback` | Default 404 shown *(reserved)* | `path`, `has_custom_404` |
| `router.tracker.interrupt` | Load interrupted *(reserved)* | - |
| `router.tracker.loading` | Loading state shown *(reserved)* | - |
| `router.tracker.refreshing` | Refreshing with stale *(reserved)* | - |
| `router.tracker.ready` | Route ready *(reserved)* | - |
| `router.tracker.error` | Tracker error *(reserved)* | - |
| `router.scroll.top` | Scrolled to top | - |
| `router.scroll.restore` | Scroll position restored | `key`, `x`, `y` |
| `router.scroll.save` | Scroll position saved | `key`, `x`, `y` |

### Module Loading Events

| Event | Description | Key Fields |
|-------|-------------|------------|
| `router.module.load.start` | Module load started *(reserved)* | `path`, `kind`, `is_prefetch`, `attempt` |
| `router.module.load.complete` | Module load completed *(reserved)* | `path`, `kind`, `duration_ms`, `is_prefetch`, `attempt` |
| `router.module.load.timeout` | Module load timed out *(reserved)* | `path`, `kind`, `timeout_ms`, `is_prefetch`, `attempt` |
| `router.module.load.cache_hit` | Module from cache *(reserved)* | `path`, `kind`, `is_prefetch` |
| `router.prefetch.start` | Prefetch started | `path` |
| `router.prefetch.complete` | Prefetch completed *(reserved)* | `path` |
| `router.prefetch.no_match` | Prefetch path unmatched *(reserved)* | `path` |
| `router.prefetch.viewport` | Viewport prefetch triggered | `path` |
| `router.viewport.observer.added` | Viewport observer setup | - |
| `router.viewport.observer.removed` | Viewport observer removed *(reserved)* | - |

Module kinds: `component`, `layout`, `guard`, `loading`, `error`, `not_found`

### API Events

| Event | Description | Key Fields |
|-------|-------------|------------|
| `api.middleware.init` | API middleware initializing | - |
| `api.middleware.mounted` | API middleware mounted | `routes_count` |
| `api.middleware.error` | API middleware error | `error` |
| `api.request.received` | API request received | `method`, `url` |
| `api.request.handler_available` | Handler found for request | `method`, `url` |
| `api.request.handler_missing` | No handler for request | `method`, `url` |
| `api.request.error` | Request handling error | `method`, `url`, `error` |
| `api.handler.loading` | Loading API handler module | - |
| `api.handler.loaded` | API handler module loaded | - |
| `api.handler.load_error` | Failed to load handler | `error` |

> **Note:** Many API events are typed but not yet emitted. Events marked without key fields may be reserved for future instrumentation.

### Trace Events

| Event | Description | Key Fields |
|-------|-------------|------------|
| `trace.span.start` | Span started | `name`, `attributes` |
| `trace.span.end` | Span completed | `name`, `status`, `error` |

---

## Wide Event Structure

Every event is a member of the `DebugEvent` discriminated union (not a loose interface). The `event` field is a string literal type, enabling precise pattern matching:

```typescript
interface DebugEvent {
  timestamp: string       // ISO timestamp
  event: string           // Event type
  duration_ms?: number    // Operation duration
  traceId?: string        // Navigation flow ID
  spanId?: string         // Current operation span
  parentSpanId?: string   // Parent span for nesting
  // ... event-specific fields
}
```

---

## Console Output

Events are color-coded by category:

- **Indigo** (`#818cf8`) - Render events (`render.*`)
- **Green** (`#34d399`) - Signal events (`signal.*`)
- **Amber** (`#fbbf24`) - Resource events (`resource.*`)
- **Purple** (`#a78bfa`) - Router events (`router.*`)
- **Pink** (`#f472b6`) - Trace events (`trace.*`)

---

## Debugging Scenarios

### "Why did my component re-render?"

Look for `render.component.rerender`. The `trigger` field shows what caused it. `accessed_signals` shows subscription count.

### "Is fine-grained reactivity working?"

Look for `render.signaltext.update` or `render.signalelement.swap` without `render.component.rerender`. If present, updates are fine-grained.

### "Why isn't my UI updating?"

1. Check `signal.set` events are firing
2. Check `listener_count` > 0
3. Check for `signal.set.skipped` (value unchanged)
4. Look for `signal.listener.error` (isolated failure)

### "Why is navigation slow?"

1. Check `router.module.load.start` / `router.module.load.complete` - look at `duration_ms`
2. Check for `router.module.load.timeout` (network issues)
3. Check for `router.module.load.cache_hit` (prefetch working?)
4. Check `router.prefetch.start` on hover/focus

### "Is Resource caching working?"

1. Look for `resource.fetch.cached` (cache hit)
2. Look for `resource.fetch.dedupe_wait` (concurrent dedup)
3. Check `resource.fetch.success` vs `resource.fetch.error`

### "One component stopped updating but others work"

Check `signal.listener.error`. Listeners run in parallel with error isolation - one failing listener doesn't affect others.

---

## Plugin System

### Built-in Plugins

```tsx
import * as Debug from "trygg/debug"

// Console (default when no plugins registered)
<DevMode plugins={[Debug.consolePlugin]} />

// Collector (for testing)
const events: Debug.DebugEvent[] = []
<DevMode plugins={[Debug.createCollectorPlugin("test", events)]} />
```

### Custom Plugins

```tsx
const remotePlugin = Debug.createPlugin("remote", (event) => {
  fetch("/api/logs", { method: "POST", body: JSON.stringify(event) })
})

<DevMode plugins={[Debug.consolePlugin, remotePlugin]} />
```

### Plugin API

```typescript
interface DebugPlugin {
  readonly name: string
  readonly handle: (event: DebugEvent) => void
}

Debug.createPlugin(name, handle): DebugPlugin
Debug.createCollectorPlugin(name, events[]): DebugPlugin
Debug.registerPlugin(plugin): void
Debug.unregisterPlugin(name): void
Debug.hasPlugin(name): boolean
Debug.getPlugins(): ReadonlyArray<string>
```

Plugin errors are isolated. If no plugins registered, `consolePlugin` is used as fallback.

---

## Trace Correlation

Events within a navigation flow share a `traceId`:

```typescript
// Router generates traceId on navigate
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
```

### Manual Spans

```typescript
// withSpan handles start/end + errors
yield* Debug.withSpan("process-data", myEffect, { step: "validation" })

// startSpan for manual control
const endSpan = yield* Debug.startSpan("fetch-data", { url: "/api" })
// ... do work ...
yield* endSpan()  // Logs trace.span.end
```

Spans nest: child spans reference parent via `parentSpanId`.

---

## Metrics

### Built-in Counters

| Metric | Name |
|--------|------|
| `navigationCounter` | `trygg.router.navigate.count` |
| `routeErrorCounter` | `trygg.router.error.count` |
| `signalUpdateCounter` | `trygg.signal.update.count` |
| `componentRenderCounter` | `trygg.render.component.count` |

### Built-in Histogram

| Metric | Name | Boundaries |
|--------|------|------------|
| `renderDurationHistogram` | `trygg.render.duration_ms` | 0, 1, 2, 5, 10, 25, 50, 100, 250, 500, 1000 |

### Recording

```typescript
import * as Metrics from "trygg/metrics"

yield* Metrics.recordNavigation
yield* Metrics.recordSignalUpdate
yield* Metrics.recordComponentRender
yield* Metrics.recordRenderDuration(3.5)
```

### Snapshot

```typescript
const snap = yield* Metrics.snapshot
// { navigationCount, routeErrorCount, signalUpdateCount,
//   componentRenderCount, renderDurationHistogram: { count, min, max, sum, buckets } }
```

### Sinks

```typescript
interface MetricsSink {
  readonly name: string
  readonly export: (snapshot: MetricsSnapshot) => Effect<void>
}

Metrics.createSink(name, exportFn): MetricsSink
Metrics.registerSink(sink): void
Metrics.unregisterSink(name): void
Metrics.exportToSinks: Effect<void>

// Built-in
Metrics.consoleSink           // Logs to console
Metrics.createCollectorSink(name, snapshots[])  // For testing
```

---

## Production Safety

- `<DevMode />` enables debug unconditionally when mounted (defaults `enabled={true}`)
- **Caller must gate**: `<DevMode enabled={import.meta.env.DEV} />` to disable in production
- No automatic environment detection — if you mount DevMode without `enabled={false}`, debug events fire in production
- DevMode properly cleans up on unmount: calls `Debug.disable()` and unregisters all plugins

---

## See Also

- [use-trygg/references/signals-api.md](../../use-trygg/references/signals-api.md) — Signal operations referenced in signal.* events
- [trygg-router/references/router.md](../../trygg-router/references/router.md) — Router internals referenced in router.* events
- [trygg-architecture/references/design.md](../../trygg-architecture/references/design.md) — Element types, Renderer pipeline
