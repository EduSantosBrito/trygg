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

## Wide Event Structure

Every event includes:

```typescript
interface DebugEvent {
  timestamp: string       // ISO timestamp
  event: string           // Event type (e.g., "signal.set")
  
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

## Integration with Effect

Debug events are emitted through Effect's logging system when available, enabling integration with:
- OpenTelemetry
- Custom log transports
- Test assertions on debug output

For advanced telemetry integration, see the Effect documentation on logging and tracing.
