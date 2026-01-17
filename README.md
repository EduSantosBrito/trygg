# effect-ui

An Effect-native UI framework with JSX support.

Build composable, type-safe UIs using [Effect](https://effect.website) with fine-grained reactivity and explicit side-effect handling.

## Features

- **Effect-Native** - Components are Effects, side effects are explicit
- **Fine-Grained Reactivity** - Signal-based state with surgical DOM updates
- **Type-Safe** - Full TypeScript support, errors tracked at type level
- **No Virtual DOM Diffing** - Direct DOM updates via Signal subscriptions
- **Testable** - Components can be tested with mock layers
- **JSX** - Custom runtime, no React dependency

## Quick Start

Create a new project with the CLI:

```bash
bunx create-effect-ui my-app
cd my-app
bun install
bun run dev
```

Open http://localhost:5173 in your browser.

## Manual Setup

### 1. Install dependencies

```bash
bun add effect-ui effect @effect/platform-browser
```

### 2. Configure Vite

```ts
// vite.config.ts
import { defineConfig } from "vite"
import effectUI from "effect-ui/vite-plugin"

export default defineConfig({
  plugins: [effectUI()]
})
```

### 3. Configure TypeScript

```json
// tsconfig.json
{
  "compilerOptions": {
    "jsx": "react-jsx",
    "jsxImportSource": "effect-ui",
    "moduleResolution": "bundler",
    "strict": true
  }
}
```

### 4. Create your app

```tsx
// src/main.tsx
import { Effect } from "effect"
import { mount, Signal } from "effect-ui"

const Counter = Effect.gen(function* () {
  const count = yield* Signal.make(0)
  
  return (
    <button onClick={() => Signal.update(count, n => n + 1)}>
      Count: {count}
    </button>
  )
})

mount(document.getElementById("root")!, Counter)
```

## Core Concepts

### Components are Effects

Components are regular `Effect.gen` functions that return JSX:

```tsx
const Greeting = Effect.gen(function* () {
  return <h1>Hello, world!</h1>
})
```

### Signal for Reactive State

`Signal` provides fine-grained reactivity without re-rendering entire components:

```tsx
const Counter = Effect.gen(function* () {
  // Create a signal (does NOT subscribe component to changes)
  const count = yield* Signal.make(0)
  
  // Pass signal directly to JSX - only the text node updates!
  return (
    <button onClick={() => Signal.update(count, n => n + 1)}>
      Count: {count}
    </button>
  )
})
// Component runs ONCE. Only the text node updates when count changes.
```

### Fine-Grained vs Re-render

**Fine-grained (no re-render)** - Pass signal directly to JSX:
```tsx
const email = yield* Signal.make("")
return <input value={email} />  // Updates input.value directly
```

**Re-render** - Read signal with `Signal.get()`:
```tsx
const items = yield* Signal.get(itemsSignal)  // Subscribes component
return items.map(item => <li>{item}</li>)     // Re-renders when items change
```

### Event Handlers Return Effects

Event handlers are typed to return Effects:

```tsx
<button onClick={() => Effect.log("clicked!")}>Click me</button>

<button onClick={() => Signal.update(count, n => n + 1)}>+1</button>
```

### Dependency Injection

Use Effect's built-in context system. No Provider components needed:

```tsx
import { Context, Layer } from "effect"

// Define a service
class Theme extends Context.Tag("Theme")<Theme, { primary: string }>() {}

// Component uses the service
const Header = Effect.gen(function* () {
  const theme = yield* Theme
  return <h1 style={{ color: theme.primary }}>Welcome</h1>
})

// Provide the layer
const themeLayer = Layer.succeed(Theme, { primary: "blue" })
mount(container, Header.pipe(Effect.provide(themeLayer)))
```

## Component.gen API

For typed props and automatic layer injection, use `Component.gen`:

```tsx
import { Component } from "effect-ui"

// Without props
const ThemedCard = Component.gen(function* () {
  const theme = yield* Theme
  return <div style={{ color: theme.primary }}>Card</div>
})
// Props inferred: { theme: Layer<Theme> }

// With props (curried syntax)
const Card = Component.gen<{ title: string }>()(Props => function* () {
  const { title } = yield* Props
  const theme = yield* Theme
  return <div style={{ color: theme.primary }}>{title}</div>
})
// Props inferred: { title: string, theme: Layer<Theme> }

// Usage - service requirements become layer props
<Card title="Hello" theme={themeLayer} />
```

## Debugging

Add `<DevMode />` to see debug events in your console:

```tsx
import { DevMode } from "effect-ui"

mount(container, <>
  {App}
  <DevMode />
</>)
```

Filter events:
```tsx
<DevMode filter="signal" />           // Only signal events
<DevMode filter={["signal.set"]} />   // Specific events
```

See [OBSERVABILITY.md](./OBSERVABILITY.md) for the full event reference.

## Examples

Run the examples locally:

```bash
bun run examples:install  # First time only
bun run examples          # Start at http://localhost:5173
```

Examples include:
- **Counter** - Basic state with Signal
- **Todo** - List operations with `Signal.each`
- **Theme** - Dependency injection with layers
- **Form** - Input handling, validation
- **Error Boundary** - Error handling patterns
- **Dashboard** - Multiple services, real-world patterns

## API Reference

See [DESIGN.md](./DESIGN.md) for detailed architecture documentation.

### Core Exports

| Export | Description |
|--------|-------------|
| `mount(container, app)` | Mount an app to the DOM |
| `Signal.make(initial)` | Create reactive state |
| `Signal.get(signal)` | Read value and subscribe to changes |
| `Signal.set(signal, value)` | Set signal value |
| `Signal.update(signal, fn)` | Update signal with function |
| `Signal.each(source, fn, opts)` | Efficient list rendering |
| `Component.gen(fn)` | Create component with auto layer injection |
| `DevMode` | Debug event viewer |
| `Suspense` | Async boundary component |
| `ErrorBoundary` | Error handling component |
| `Portal` | Render to different container |

## License

MIT
