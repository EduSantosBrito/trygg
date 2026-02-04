# trygg

[![PR Check](https://github.com/EduSantosBrito/trygg/actions/workflows/pr.yml/badge.svg)](https://github.com/EduSantosBrito/trygg/actions/workflows/pr.yml)

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
bunx create-trygg my-app
cd my-app
bun install
bun run dev
```

Open http://localhost:5173 in your browser.

## Manual Setup

### 1. Install dependencies

```bash
bun add trygg effect @effect/platform-browser
```

### 2. Configure Vite

```ts
// vite.config.ts
import { defineConfig } from "vite"
import { trygg } from "trygg/vite-plugin"

export default defineConfig({
  plugins: [trygg()]
})
```

### 3. Configure TypeScript

```json
// tsconfig.json
{
  "compilerOptions": {
    "jsx": "react-jsx",
    "jsxImportSource": "trygg",
    "moduleResolution": "bundler",
    "strict": true
  }
}
```

### 4. Create your app

```tsx
// src/main.tsx
import { Component, mount, Signal } from "trygg"

const Counter = Component.gen(function* () {
  const count = yield* Signal.make(0)

  return (
    <button onClick={() => Signal.update(count, n => n + 1)}>
      Count: {count}
    </button>
  )
})

mount(document.getElementById("root")!, <Counter />)
```

## Core Concepts

### Components use Component.gen

Components are created with `Component.gen` and return JSX:

```tsx
const Greeting = Component.gen(function* () {
  return <h1>Hello, world!</h1>
})
```

### Signal for Reactive State

`Signal` provides fine-grained reactivity without re-rendering entire components:

```tsx
const Counter = Component.gen(function* () {
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

Use Effect's built-in context system. Provide layers in parent effects:

```tsx
import { Context, Effect, Layer } from "effect"
import { Component } from "trygg"

// Define a service
class Theme extends Context.Tag("Theme")<Theme, { primary: string }>() {}

// Component uses the service
const Header = Component.gen(function* () {
  const theme = yield* Theme
  return <h1 style={{ color: theme.primary }}>Welcome</h1>
})

// Provide the layer
const themeLayer = Layer.succeed(Theme, { primary: "blue" })

const App = Component.gen(function* () {
  return <Header />
}).provide(themeLayer)

mount(container, <App />)
```

## Component.gen API

For typed props and explicit DI, use `Component.gen`:

```tsx
import { Effect } from "effect"
import { Component, type ComponentProps } from "trygg"

// Without props
const ThemedCard = Component.gen(function* () {
  const theme = yield* Theme
  return <div style={{ color: theme.primary }}>Card</div>
})

// With props (direct syntax)
const Card = Component.gen(function* (Props: ComponentProps<{ title: string }>) {
  const { title } = yield* Props
  const theme = yield* Theme
  return <div style={{ color: theme.primary }}>{title}</div>
})

// Provide the layer to the component
const App = Component.gen(function* () {
  return <Card title="Hello" />
}).provide(themeLayer)
```

## Debugging

Add `<DevMode />` to see debug events in your console:

```tsx
import { DevMode } from "trygg"

mount(container, <>
  <App />
  <DevMode />
</>)
```

Filter events:
```tsx
<DevMode filter="signal" />           // Only signal events
<DevMode filter={["signal.set"]} />   // Specific events
```

See [OBSERVABILITY.md](./OBSERVABILITY.md) for the full event reference.

## Agent Skills

trygg provides [Agent Skills](https://agentskills.io/) for LLM agents:

- **trygg-core** - Components, Signals, reactivity
- **trygg-router** - File-based routing, navigation
- **trygg-testing** - Testing with Effect Vitest
- **trygg-observability** - Debug events, tracing, metrics

Skills are discovered automatically by compatible agents. See [skills/README.md](./skills/README.md) for details.

## Examples

Run the examples locally:

```bash
bun run examples:install  # First time only
bun run examples          # Start at http://localhost:5173
```

Examples include:
- **Counter** - Basic state with Signal
- **Todo** - List operations with `Signal.each`
- **Theme** - Dependency injection with .provide() method
- **Form** - Input handling, validation
- **Error Boundary** - Error handling patterns
- **Dashboard** - Multiple services, real-world patterns

## Routing

trygg includes file-based routing out of the box:

```tsx
import { Component, mount } from "trygg"
import * as Router from "trygg/router"
import { routes } from "virtual:trygg-routes"

const App = Component.gen(function* () {
  return (
    <div>
      <nav>
        <Router.Link to="/">Home</Router.Link>
        <Router.Link to="/users">Users</Router.Link>
      </nav>
      <Router.Outlet routes={routes} />
    </div>
  )
})

// Router is included by default!
mount(document.getElementById("root")!, <App />)
```

See the examples for routing patterns including layouts, params, and guards.

## API Reference

See [DESIGN.md](./DESIGN.md) for detailed architecture documentation.

### Core Exports

| Export | Description |
|--------|-------------|
| `mount(container, app)` | Mount an app to the DOM, returns `MountHandle` |
| `mount(container, app, layer)` | Mount with custom layers merged with defaults |
| `Signal.make(initial)` | Create reactive state |
| `Signal.get(signal)` | Read value and subscribe to changes |
| `Signal.set(signal, value)` | Set signal value |
| `Signal.update(signal, fn)` | Update signal with function |
| `Signal.resource(effect)` | Async state with Exit/Cause and auto refresh |
| `Signal.each(source, fn, opts)` | Efficient list rendering |
| `Component.gen(fn)` | Create component with explicit DI |
| `DevMode` | Debug event viewer |
| `ErrorBoundary` | Error handling component |
| `Portal` | Render to different container |

### MountHandle

`mount()` returns a handle for cleanup:

```tsx
const handle = mount(container, App)

// Later, to unmount and clean up:
await handle.dispose()
```

### Router Exports

| Export | Description |
|--------|-------------|
| `Router.Link` | Navigation link component |
| `Router.isActive(path, exact?)` | Check if a path is currently active |
| `Router.Outlet` | Renders matched route |
| `Router.browserLayer` | Browser router layer (included by default) |
| `Router.testLayer(path)` | In-memory router for testing |

**Note:** `NavLink` is deprecated. Use `Link` with `Router.isActive()` for active state styling.

## License

MIT
