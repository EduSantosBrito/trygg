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

## Project Structure

The CLI scaffolds this structure:

```
my-app/
├── app/
│   ├── layout.tsx      # Root layout with <Router.Outlet />
│   ├── routes.ts       # Route definitions
│   ├── api.ts          # API routes (optional)
│   └── pages/
│       └── home.tsx    # Page components
├── vite.config.ts      # Vite + trygg plugin
└── tsconfig.json
```

The Vite plugin generates the entry point — no manual mounting needed.

### Integration Entry Points

Canonical setup docs now live with the entrypoint owners:

- `trygg/config`: [`src/config.ts`](./src/config.ts), [`src/config.docs.md`](./src/config.docs.md)
- `trygg/vite-plugin`: [`src/vite/plugin.ts`](./src/vite/plugin.ts), [`src/vite/plugin.docs.md`](./src/vite/plugin.docs.md)
- `trygg/api`: [`src/api/types.ts`](./src/api/types.ts), [`src/api/api.docs.md`](./src/api/api.docs.md)
- `trygg/testing`: [`src/testing/index.ts`](./src/testing/index.ts), [`src/testing/testing.docs.md`](./src/testing/testing.docs.md)

### API Routes

Use `trygg/api` type utilities inside `app/api.ts`. The owner docs in [`src/api/types.ts`](./src/api/types.ts) and [`src/api/api.docs.md`](./src/api/api.docs.md) describe the contracts; this README just shows the wiring shape:

```ts
// app/api.ts
import { HttpApi, HttpApiEndpoint, HttpApiGroup, HttpApiBuilder } from "effect/unstable/httpapi";
import { Effect, Layer, Schema } from "effect";

const UserSchema = Schema.Struct({ id: Schema.String, name: Schema.String });

const Group = HttpApiGroup.make("users").add(
  HttpApiEndpoint.get("list", "/api/users", { success: Schema.Array(UserSchema) }),
);

export const Api = HttpApi.make("app").add(Group);

const HandlersLive = HttpApiBuilder.layer(Api).pipe(
  Layer.provide(
    HttpApiBuilder.group(Api, "users", (handlers) =>
      handlers.handle("list", () => Effect.succeed(users)),
    ),
  ),
);

export default HandlersLive;
```

The plugin serves API routes in dev and bundles them for production.

When `app/api.ts` exports `const Api`, the plugin also generates `ApiClient` and `ApiClientLive` from `trygg/api`. Import them explicitly and provide the layer where needed:

```ts
import { ApiClient, ApiClientLive } from "trygg/api";

const users = Resource.make(
  () =>
    Effect.gen(function* () {
      const client = yield* ApiClient;
      return yield* client.users.list();
    }),
  { key: "users.list" },
).provide(ApiClientLive);
```

## Core Concepts

### Components use Component.gen

`Component` is the canonical component surface. Start with the owner docs in [`src/primitives/component.ts`](./src/primitives/component.ts) and the longer guide in [`src/primitives/component.docs.md`](./src/primitives/component.docs.md).

```tsx
const Greeting = Component.gen(function* () {
  return <h1>Hello, world!</h1>;
});
```

### Signal for Reactive State

Canonical reactivity docs now live with the owner module: [`src/primitives/signal.ts`](./src/primitives/signal.ts) and [`src/primitives/signal.docs.md`](./src/primitives/signal.docs.md).

### Fine-Grained vs Re-render

Reactivity and rendering guidance is source-owned now:

- `Signal`: [`src/primitives/signal.ts`](./src/primitives/signal.ts), [`src/primitives/signal.docs.md`](./src/primitives/signal.docs.md)
- `Resource`: [`src/primitives/resource.ts`](./src/primitives/resource.ts), [`src/primitives/resource.docs.md`](./src/primitives/resource.docs.md)
- `cx`: [`src/primitives/cx.ts`](./src/primitives/cx.ts)
- `Element` / rendering: [`src/primitives/element.ts`](./src/primitives/element.ts), [`src/primitives/element.docs.md`](./src/primitives/element.docs.md), [`src/primitives/renderer.ts`](./src/primitives/renderer.ts), [`src/primitives/renderer.docs.md`](./src/primitives/renderer.docs.md)

### Supporting Surfaces

Supporting public docs are source-owned too:

- `DevMode`: [`src/components/dev-mode.ts`](./src/components/dev-mode.ts), [`src/components/dev-mode.docs.md`](./src/components/dev-mode.docs.md)
- `ErrorBoundary`: [`src/primitives/error-boundary.ts`](./src/primitives/error-boundary.ts), [`src/primitives/error-boundary.docs.md`](./src/primitives/error-boundary.docs.md)
- `Portal`: [`src/primitives/portal.ts`](./src/primitives/portal.ts), [`src/primitives/portal.docs.md`](./src/primitives/portal.docs.md)
- `Head`: [`src/primitives/head.ts`](./src/primitives/head.ts), [`src/primitives/head.docs.md`](./src/primitives/head.docs.md)
- `Debug`: [`src/debug/debug.ts`](./src/debug/debug.ts), [`src/debug/debug.docs.md`](./src/debug/debug.docs.md)
- `Metrics`: [`src/debug/metrics.ts`](./src/debug/metrics.ts), [`src/debug/metrics.docs.md`](./src/debug/metrics.docs.md)

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
```

### JSX Runtime Entry Points

JSX lowering details now live with the entrypoints themselves: [`src/jsx-runtime.ts`](./src/jsx-runtime.ts), [`src/jsx-runtime.docs.md`](./src/jsx-runtime.docs.md), [`src/jsx-dev-runtime.ts`](./src/jsx-dev-runtime.ts), and [`src/jsx-dev-runtime.docs.md`](./src/jsx-dev-runtime.docs.md).

## API Reference

### Core Exports

| Export                                | Description                                        |
| ------------------------------------- | -------------------------------------------------- |
| `Component.gen(fn)`                   | Create component with explicit DI                  |
| `Component.gen(fn).provide(layer)`    | Satisfy service requirements with a layer          |
| `Signal.make(initial)`                | Create reactive state                              |
| `Signal.get(signal)`                  | Read value and subscribe current render            |
| `Signal.peek(signal)`                 | Read value without subscribing current render      |
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
| `DevMode`                             | Enable debug output from JSX                       |
| `ErrorBoundary`                       | Match tagged render failures                       |
| `Portal`                              | Render into another DOM target                     |
| `Head`                                | Head hoisting and dedup helpers                    |
| `Debug`                               | Low-level debug events, plugins, spans             |
| `Metrics`                             | Low-level framework metrics and sinks              |

### Router Exports

| Export                          | Description                                |
| ------------------------------- | ------------------------------------------ |
| `Router.Link`                   | Navigation link component                  |
| `Router.isActive(path, exact?)` | Check if a path is currently active        |
| `Router.Outlet`                 | Renders matched route                      |
| `Router.browserLayer`           | Browser router layer (included by default) |
| `Router.testLayer(path)`        | In-memory router for testing               |

### Testing

Testing helpers now live with the entrypoint itself: [`src/testing/index.ts`](./src/testing/index.ts) and [`src/testing/testing.docs.md`](./src/testing/testing.docs.md).

## License

MIT
