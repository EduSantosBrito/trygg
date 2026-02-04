# trygg

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
bun add trygg effect @effect/platform @effect/platform-browser
```

### 2. Configure Vite

```ts
// vite.config.ts
import { defineConfig } from "vite";
import { trygg } from "trygg/vite-plugin";

export default defineConfig({
  plugins: [trygg()],
});
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
import { Component, mount, Signal } from "trygg";

const Counter = Component.gen(function* () {
  const count = yield* Signal.make(0);

  return <button onClick={() => Signal.update(count, (n) => n + 1)}>Count: {count}</button>;
});

const root = document.getElementById("root");
if (root) mount(root, <Counter />);
```

## Core Concepts

### Components use Component.gen

Components are created with `Component.gen` and return JSX:

```tsx
const Greeting = Component.gen(function* () {
  return <h1>Hello, world!</h1>;
});
```

### Signal for Reactive State

`Signal` provides fine-grained reactivity without re-rendering entire components:

```tsx
const Counter = Component.gen(function* () {
  const count = yield* Signal.make(0);

  return <button onClick={() => Signal.update(count, (n) => n + 1)}>Count: {count}</button>;
});
// Component runs ONCE. Only the text node updates when count changes.
```

### Fine-Grained vs Re-render

**Fine-grained (no re-render)** - Pass signal directly to JSX:

```tsx
const email = yield * Signal.make("");
return <input value={email} />; // Updates input.value directly
```

**Re-render** - Read signal with `Signal.get()`:

```tsx
const items = yield * Signal.get(itemsSignal); // Subscribes component
return items.map((item) => <li>{item}</li>); // Re-renders when items change
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
import { Context, Effect, Layer } from "effect";
import { Component } from "trygg";

// Define a service
class Theme extends Context.Tag("Theme")<Theme, { primary: string }>() {}

// Component uses the service
const Header = Component.gen(function* () {
  const theme = yield* Theme;
  return <h1 style={{ color: theme.primary }}>Welcome</h1>;
});

// Provide the layer
const themeLayer = Layer.succeed(Theme, { primary: "blue" });

const App = Component.gen(function* () {
  return <Header />;
}).provide(themeLayer);

mount(container, <App />);
```

## API Reference

### Core Exports

| Export                                | Description                                        |
| ------------------------------------- | -------------------------------------------------- |
| `mount(container, app)`               | Mount an app to the DOM                            |
| `mount(container, app, layer)`        | Mount with custom layers merged with defaults      |
| `Component.gen(fn)`                   | Create component with explicit DI                  |
| `Component.gen(fn).provide(layer)`    | Satisfy service requirements with a layer          |
| `Signal.make(initial)`                | Create reactive state                              |
| `Signal.get(signal)`                  | Read value and subscribe to changes                |
| `Signal.set(signal, value)`           | Set signal value                                   |
| `Signal.update(signal, fn)`           | Update signal with function                        |
| `Signal.derive(source, fn)`           | Computed signal from a source                      |
| `Signal.deriveAll(sources, fn)`       | Computed signal from multiple sources              |
| `Signal.each(source, fn, opts)`       | Efficient list rendering                           |
| `Signal.suspend(component, handlers)` | Async component suspension                         |
| `Resource.make(fn, opts)`             | Data fetching with cache and dedup                 |
| `Resource.fetch(resource)`            | Fetch and return `ResourceState`                   |
| `Resource.match(state, handlers)`     | Pattern-match on `Pending` / `Success` / `Failure` |
| `Resource.invalidate(key)`            | Stale-while-revalidate a cached resource           |
| `Resource.refresh(key)`               | Force re-fetch a cached resource                   |
| `DevMode`                             | Debug event viewer                                 |
| `ErrorBoundary`                       | Error handling component                           |
| `Portal`                              | Render to different container                      |

### Router Exports

| Export                          | Description                                |
| ------------------------------- | ------------------------------------------ |
| `Router.Link`                   | Navigation link component                  |
| `Router.isActive(path, exact?)` | Check if a path is currently active        |
| `Router.Outlet`                 | Renders matched route                      |
| `Router.browserLayer`           | Browser router layer (included by default) |
| `Router.testLayer(path)`        | In-memory router for testing               |

## License

MIT
