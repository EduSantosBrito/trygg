# Route Builder

Declare a route tree — typed path params, layouts, per-route boundaries, guards, and render/scroll strategies — through one immutable fluent builder, then hand its manifest to an `Outlet`.

```tsx
import { Component } from "trygg";
import { Route, Routes } from "trygg/router";
import * as Router from "trygg/router";

const UserProfile = Component.gen(function* () {
  const { id } = yield* Router.params("/users/:id");
  return <h1>User {id}</h1>;
});

export const routes = Routes.make().add(Route.make("/users/:id").component(UserProfile));
```

## When to use

Reach for `Route.make` whenever you declare a path that should match and render a component. Build the whole tree out of `Route.make` and `Route.index` nodes, then gather the top-level ones with `Routes.make().add(...)`. That produces a Routes collection; its `.manifest` is the Routes manifest the `Outlet` consumes.

- Use `Route.make(path)` for any concrete path pattern, static (`/about`) or dynamic (`/users/:id`).
- Use `Route.index(component)` inside `.children(...)` for the default leaf that matches a parent's exact path.
- Use `.layout(...)` plus `.children(...)` when several routes share a wrapper that renders an `Outlet` for the active child.

A Route is a definition, not the navigation state. The Router updates the Current route and the Outlet matches the Routes manifest to render the active Route — see the Router and Outlet guides for that half.

## Behavior

Builders are immutable: every chained call returns a new builder carrying the updated definition, so a route can be shared and extended without mutation. The full surface:

- `.component(c)` sets the leaf component. `.children(...routes)` declares nested routes instead. They are mutually exclusive — calling one types the other as `never`.
- `.layout(c)` sets a wrapper component that renders an `Outlet` for its children. `Route.index(component)` is the default child at the parent's exact path.
- `.params(schema)` and `.query(schema)` attach Schema-backed decoders. Param schema keys must exactly match the path's `:params` — a missing or extra key is a compile error, not a runtime surprise. Both decode at match time and fail with a typed `ParamsDecodeError` or `QueryDecodeError` on bad input.
- Boundary setters are `.loading`, `.error`, `.notFound`, and `.forbidden`, each taking a component. `.error(...)` covers the route and all descendants and satisfies the type-level error-coverage requirement; the others fill the matching Boundary surface for that subtree.
- `.middleware(effect)` adds a guard that runs before render, left-to-right; its service requirements accumulate into the builder's `R`. `.prefetch(fn)` adds best-effort effects that run in parallel.

A route component takes no params as props. Read them inside the component with `Router.params("/users/:id")`, which yields the typed param record from the active Outlet context.

Path params support `:id`, optional catch-all `:path*`, and required catch-all `:filepath+`. `ExtractParams` derives the param-name union from the path string and is what keeps `.params(...)` schemas aligned at compile time.

Guards short-circuit by failing the middleware Effect with a typed failure:

```tsx
import { Effect, Option } from "effect";
import { Route, routeRedirect } from "trygg/router";
import { getSession } from "./auth.js";
import { Dashboard } from "./pages.js";

const requireAuth = Effect.gen(function* () {
  if (Option.isNone(yield* getSession())) {
    return yield* routeRedirect("/login");
  }
});

export const dashboard = Route.make("/dashboard").middleware(requireAuth).component(Dashboard);
```

`routeRedirect(path, options?)` hands control back to the Router to navigate; `routeForbidden` stops rendering and resolves the nearest `.forbidden(...)` boundary. Both are also reachable as `Route.redirect` and `Route.forbidden`.

Per-route strategies are applied through `.pipe(Route.provide(layer))`, which recognizes the specific `RenderStrategy` and `ScrollStrategy` layer instances and stores each on its own slot:

```tsx
import { Route, RenderStrategy, ScrollStrategy } from "trygg/router";
import { SettingsPage } from "./pages/settings.js";

Route.make("/settings")
  .component(SettingsPage)
  .pipe(Route.provide(RenderStrategy.Eager), Route.provide(ScrollStrategy.None));
```

Sharp edge: `Route.provide` is for route-local strategy layers only. Service data a component needs goes at the component lifecycle boundary via `Component.provide(layer)` — passing an application Layer to `Route.provide` will not satisfy it.

## Related exports

- `make` — start a route for a concrete path pattern
- `index` — default child matching a parent's exact path
- `provide` — attach route-local render and scroll strategy layers
- `routeRedirect` — guard escape hatch handing control back to navigate
- `routeForbidden` — guard escape hatch resolving the nearest forbidden boundary
- `RouteBuilder` — immutable fluent builder type for a route
- `ExtractParams` — derives the param-name union from a path string

## Troubleshooting

- "Schema is missing path params" / "Schema has keys not in path params": the object passed to `.params(...)` does not match the path's `:params` exactly. Add the missing key or drop the extra one so the schema fields and the path params are the same set.
- `.component` (or `.children`) typed as `never`: the two are mutually exclusive. A builder with `.children(...)` cannot take `.component(...)` and vice versa — pick one per route.
- Route params arrive as `undefined` in props: route components do not receive params as props. Read them with `Router.params(path)` inside the component instead.
- A guard's redirect or forbidden does nothing: fail the chain with `return yield* routeRedirect("/login")` (or `return yield* routeForbidden`) from inside `.middleware(...)`. A plain navigation call or a returned value will not short-circuit it.