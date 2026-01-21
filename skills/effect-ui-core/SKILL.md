---
name: effect-ui-core
description: Build Effect-native UI components with fine-grained reactivity using Signals. Use when: (1) Creating new components with Effect.gen, (2) Managing state with Signal.make/get/set/update, (3) Rendering lists with Signal.each, (4) Handling DOM events that return Effects, (5) Using dependency injection with Context.Tag and Layer, (6) Managing async state with Signal.resource/ErrorBoundary, (7) Providing layers via Component.provide.
---

# effect-ui Core Components

Build Effect-native UI components with fine-grained reactivity.

## Key Rules

1. **Components are Effects**: Use `Effect.gen(function* () { ... })` returning JSX
2. **R must be never**: Components must have `R = never`. Use `Component.provide` before JSX
3. **No type casting**: Never use `as` or `!`. Use Option, pattern matching, or proper null checks
4. **Signal.make vs Signal.get**:
   - `Signal.make(initial)` creates a signal (does NOT subscribe)
   - `Signal.get(signal)` reads value AND subscribes component (triggers re-render)
   - Pass signal directly to JSX for fine-grained updates (no re-render)

## Component Patterns

### Basic Component

```tsx
import { Effect } from "effect"
import { Signal } from "effect-ui"

const Counter = Effect.gen(function* () {
  const count = yield* Signal.make(0)
  
  return (
    <button onClick={() => Signal.update(count, n => n + 1)}>
      Count: {count}
    </button>
  )
})
// Component runs ONCE. Only the text node updates.
```

### Fine-Grained vs Re-render

**Fine-grained (no re-render)** - pass signal directly:
```tsx
const email = yield* Signal.make("")
return <input value={email} onInput={e => Signal.set(email, e.target.value)} />
```

**Re-render** - use Signal.get():
```tsx
const items = yield* Signal.get(itemsSignal)  // Subscribes!
return items.map(item => <li>{item}</li>)     // Re-renders when items change
```

### List Rendering with Signal.each

```tsx
const TodoList = Effect.gen(function* () {
  const todos = yield* Signal.make<Todo[]>([])
  
  const listElement = Signal.each(
    todos,
    (todo) => Effect.gen(function* () {
      const editing = yield* Signal.make(false)
      return <li>{todo.text}</li>
    }),
    { key: (todo) => todo.id }
  )
  
  return <ul>{listElement}</ul>
})
```

### Dependency Injection

```tsx
import { Context, Effect, Layer } from "effect"
import { Component } from "effect-ui"

class Theme extends Context.Tag("Theme")<Theme, { primary: string }>() {}

const Header = Effect.gen(function* () {
  const theme = yield* Theme
  return <h1 style={{ color: theme.primary }}>Welcome</h1>
})

const themeLayer = Layer.succeed(Theme, { primary: "blue" })
mount(container, Header.pipe(Component.provide(themeLayer)))
```

### Component.gen for Typed Props

```tsx
import { Component, type ComponentProps } from "effect-ui"

const Card = Component.gen(function* (Props: ComponentProps<{ title: string }>) {
  const { title } = yield* Props
  const theme = yield* Theme
  return <div style={{ color: theme.primary }}>{title}</div>
})
// Props inferred: { title: string }

<Card title="Hello" theme={themeLayer} />
```

### Event Handlers

Event handlers return Effects:

```tsx
<button onClick={() => Effect.log("clicked!")}>Click</button>
<button onClick={() => Signal.update(count, n => n + 1)}>+1</button>
```

### Error Boundary

```tsx
import { ErrorBoundary } from "effect-ui"

<ErrorBoundary
  fallback={(error) => <div>Error: {String(error)}</div>}
  onError={(error) => Effect.log("caught", error)}
>
  {RiskyComponent}
</ErrorBoundary>
```

### Signal.resource for Async

```tsx
import { Signal } from "effect-ui"

const data = yield* Signal.resource(fetchStuff)
const view = yield* Signal.derive(data.state, (state) =>
  state._tag === "Loading" ? <div>Loading...</div> : <AsyncComponent value={state.value} />
)

return <>{view}</>
```

## API Reference

| API | Description |
|-----|-------------|
| `mount(container, app)` | Mount app to DOM |
| `Signal.make(initial)` | Create signal |
| `Signal.get(signal)` | Read + subscribe |
| `Signal.set(signal, value)` | Set value |
| `Signal.update(signal, fn)` | Update with function |
| `Signal.each(source, fn, opts)` | List rendering |
| `Component.gen(fn)` | Auto layer injection |
| `DevMode` | Debug events |
| `Signal.resource(effect)` | Async state with refresh |
| `ErrorBoundary` | Error handling |
| `Portal` | Render elsewhere |

## Common Mistakes

### Wrong: Using Signal.get for input value
```tsx
// BAD - re-renders on every keystroke
const email = yield* Signal.get(emailSignal)
return <input value={email} />
```

### Right: Pass signal directly
```tsx
// GOOD - fine-grained update
const email = yield* Signal.make("")
return <input value={email} />
```

### Wrong: Type casting
```tsx
// BAD
const user = result as User
```

### Right: Use Option/pattern matching
```tsx
// GOOD
const user = yield* Effect.map(result, Option.getOrThrow)
```
