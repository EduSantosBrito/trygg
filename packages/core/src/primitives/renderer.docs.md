# Renderer

Attach a trygg app to the DOM with the browser runtime, router layer, and resource registry already installed, so Signals, Resources, and routing work from the first frame.

```tsx
import { mount, Component } from "trygg";

const App = Component.gen(function* () {
  return <h1>Hello</h1>;
});

mount(document.getElementById("root")!, <App />);
```

## When to use

Most apps never call this surface: the Vite plugin generates the entry point and calls `mountDocument` for you, so you write Components and Routes and never touch the Mount boundary by hand.

Reach for it directly only when you own the runtime wiring:

- `mount` — attach an app to a container element for a custom entry point or a non-standard build.
- `mountDocument` — same, for a root layout that renders `<html>`, `<head>`, and `<body>` into the existing document instead of a container.
- `browserLayer`, `Renderer`, `renderDocument` — when you compose the runtime yourself (custom Layers, a non-browser `Renderer`, or manual scope management) instead of using the one-call helpers.

## Behavior

`mount` accepts an `Element` or an `Effect` that produces one. `mount(root, <App />)` passes an `Element` (JSX evaluates to one); the Effect form is an `Effect` that returns an `Element`, such as `mount(root, app.pipe(Effect.provide(layer)))` where `app` is an `Effect.gen`. It does not accept a bare Component value — a `Component` is callable JSX, neither an `Element` nor an `Effect`. `Component.provide(layer)` narrows a Component's requirements but still returns a `Component`, so render it with `<App />` before mounting.

`mount` is also the Mount boundary: the app must already have `R = never`. Children `yield*` the Services they need; a parent satisfies them with `Component.provide(layer)`; the fully-provided root is what you mount. If a requirement is still unsatisfied, TypeScript reports the missing Service before anything runs.

```tsx
import { Effect, Layer } from "effect";
import * as Context from "effect/Context";
import { mount, Component } from "trygg";

class Api extends Context.Service<Api, { readonly ping: Effect.Effect<string> }>()("example/Api") {}

const Header = Component.gen(function* () {
  const api = yield* Api;
  return <h1>{yield* api.ping}</h1>;
});

const App = Header.pipe(Component.provide(Layer.succeed(Api, { ping: Effect.succeed("ready") })));

mount(document.getElementById("root")!, <App />);
```

`mount` and `mountDocument` are fire-and-forget — they return `void`, dynamically import the browser runtime, and keep the app alive until the process is interrupted. They install `browserLayer`, the router layer, and the resource registry, so you do not provide those yourself. The renderer turns the `Element` tree into DOM and preserves the render scope, so event handlers and Signal subscriptions run in the same Effect context the Component was rendered in. Because setup happens inside that dynamic import, errors during runtime wiring surface asynchronously, not at the call site.

`mountDocument` differs from `mount` in one way: the root layout's `<html>`, `<head>`, and `<body>` map onto the existing document nodes instead of creating new elements, and it takes an optional `{ manifest }` to feed `Router.Outlet` without props.

`renderDocument` is the composable Effect form of `mountDocument`: it yields the `Renderer` service, so you provide `browserLayer` (and any other Layers) and manage the scope yourself.

`Renderer` is the service tag for the active renderer implementation; `browserLayer` is its DOM-backed implementation of the `RendererService` contract. Yield `Renderer` only when you need the low-level `mount` / `render` methods directly. `RenderContext`, `RenderResult`, and the internal `CurrentRenderContext` FiberRef are renderer-internal plumbing — you touch them when writing a custom `Renderer`, not in app code.

## Related exports

- `Renderer` — service tag for the active renderer implementation
- `RendererService` — the contract a renderer implementation satisfies
- `browserLayer` — the DOM-backed `Renderer` implementation
- `mount` — attach an app to a container element
- `mountDocument` — mount a root layout onto the existing document
- `renderDocument` — the composable Effect form of `mountDocument`
- `RenderContext` — renderer-internal plumbing for a custom Renderer
- `RenderResult` — renderer-internal mount result for a custom Renderer
- `CurrentRenderContext` — internal FiberRef tracking the active render context

## Troubleshooting

- Type error at the `mount` call, "Type 'X' is not assignable to ... never": the app still has unsatisfied Service requirements. Provide every Service with `Component.provide(layer)` (or `Effect.provide`) before the Mount boundary so `R = never`.
- `mount(root, App)` where `App` is a Component value: a provided Component (`Component.provide(...)`) is still a Component, not an `Element` or `Effect`. Render it with `<App />`, or pass an `Effect.gen` that returns an `Element`.
- `<html>`/`<head>`/`<body>` appearing duplicated or unstyled: use `mountDocument`, not `mount`, when the root layout owns the document shell — only `mountDocument` maps those tags onto the existing document nodes.