# Routes

Declare your whole app's routable surface in one place, so the root `Outlet` has a single Routes manifest to render and any unsatisfied route requirement is a compile error before it ships.

```tsx
import { Component } from "trygg";
import { Route, Routes } from "trygg/router";
import * as Router from "trygg/router";

const Home = Component.gen(function* () {
  return <h1>Home</h1>;
});

export const routes = Routes.make().add(Route.make("/").component(Home));

const App = Component.gen(function* () {
  return <Router.Outlet routes={routes.manifest} />;
});
```

## When to use

Reach for `Routes.make()` once per app, where every top-level Route is declared and ready to render. Build each path with `Route.make(...)` (see the Route Builder guide), then `.add(...)` the top-level ones into the collection. The collection's `.manifest` is the Routes manifest you hand to the root `Outlet`.

- Use it for the root of the route tree. Nested routes are declared with `.children(...)` on a parent Route, not added here.
- Use the root boundary setters when you want one fallback to cover any path that no closer Boundary handles.
- You do not add a Route mid-render. `Routes.make()` describes the static shape of the app; the Router updates the Current route and the `Outlet` matches the manifest at runtime.

## Behavior

`Routes.make()` returns an immutable Routes collection. Every chained call returns a new collection carrying the updated manifest, so a base collection can be shared and extended without mutation.

- `.add(route)` appends a Route definition. The Route must have `R = never` — the builder's `R` tracks the service requirements of its `.middleware(...)` guards, and every one must be satisfied inside the guard's own Effect before it joins the root manifest. A Route with unsatisfied middleware requirements is a compile error here, not a runtime surprise.
- `.notFound(component)` sets the root not-found surface, `.forbidden(component)` the root forbidden surface, and `.error(component)` the root error Boundary. Each covers any matched path that declares no matching Boundary closer to the leaf.
- `.manifest` is the finalized Routes manifest: the declared route definitions plus the root boundary slots. It is what `Outlet` consumes, either through its `routes` prop or, for nested outlets, through context. The Outlet's matcher normalizes the nested tree into absolute patterns at match time — `.manifest` itself just holds the routes you added, unflattened.

Sharp edge: the root `Outlet` needs `routes={routes.manifest}` — the bare collection is not a manifest. Passing the collection itself, or a falsy value, makes the outlet render `No routes configured`.

## Related exports

- `Routes` — root builder for the app's routable surface
- `RoutesCollection` — immutable collection carrying the finalized manifest
- `Route` — builds each path added into the collection
- `Outlet` — consumes the manifest to render matches

## Troubleshooting

- `.add(...)` rejects a Route with a type error mentioning `R`: a `.middleware(...)` guard on the Route still carries unsatisfied service requirements. Satisfy those services inside the guard's Effect so the builder's `R` is `never` before adding it. (`Route.provide` only attaches strategy layers; component services use `Component.provide` and do not affect `R`.)
- Root outlet renders `No routes configured`: you passed the collection instead of its manifest. Pass `routes={routes.manifest}`.
- A not-found or error fallback never shows: a closer Boundary on a matched Route handles it first. Root `.notFound`, `.forbidden`, and `.error` only cover paths that declare no matching Boundary nearer the leaf.
