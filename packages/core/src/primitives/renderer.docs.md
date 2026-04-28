# Renderer

## When to use

Use `mount` for normal apps, `mountDocument` for root-layout ownership, and `Renderer` or `browserLayer` only when you need lower-level composition or custom runtime wiring.

## Behavior

The renderer turns `Element` trees into DOM, preserves render scope for event handlers and subscriptions, and installs the browser/runtime layers needed for signals, resources, and routing.

`mount` is also the service boundary: the app passed to it must already have `R = never`. In practice, children `yield*` services, parents satisfy them with `.provide(layer)`, and the final root effect is what you mount.

```tsx
import { Effect, Layer } from "effect";
import * as Context from "effect/Context";
import { Component } from "trygg";

class Api extends Context.Service<Api, { readonly ping: Effect.Effect<string> }>()("example/Api") {}

const Header = Component.gen(function* () {
  const api = yield* Api;
  return <h1>{yield* api.ping}</h1>;
});

const App = Header.provide(
  Layer.succeed(Api, {
    ping: Effect.succeed("ready"),
  }),
);
```

If a component still has unsatisfied requirements, that should be resolved before it crosses the mount boundary. The Vite plugin generates the entry point and calls `mountDocument` automatically — you do not call `mount` manually in normal apps. You only need `mount` or `mountDocument` directly when writing custom runtime wiring or non-standard build setups.

The mount boundary enforces `R = never` at the type level. If `App` still requires services, TypeScript will report the missing `Context.Tag` before the app runs.

## Related exports

- `Renderer`
- `RendererService`
- `browserLayer`
- `mount`
- `renderDocument`
- `mountDocument`
