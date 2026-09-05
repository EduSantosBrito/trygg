# Router

Wire an app's whole navigation surface from one import: declare routes, render an Outlet where pages go, and link between them with the `Route` and `Routes` builders.

```tsx
import { mount, Component } from "trygg";
import { Route, Routes } from "trygg/router";
import * as Router from "trygg/router";

const Home = Component.gen(function* () {
  return <h1>Home</h1>;
});

const About = Component.gen(function* () {
  return <h1>About</h1>;
});

const routes = Routes.make()
  .add(Route.make("/").component(Home))
  .add(Route.make("/about").component(About));

const App = Component.gen(function* () {
  return (
    <div>
      <nav>
        <Router.Link to="/">Home</Router.Link>
        <Router.Link to="/about">About</Router.Link>
      </nav>
      <Router.Outlet routes={routes.manifest} />
    </div>
  );
});

const root = document.getElementById("root");
if (root !== null) {
  mount(root, <App />);
}
```

## When to use

Reach for `trygg/router` whenever an app has more than one page. It is the single entrypoint for the routing surface: route builders, the navigation service, links, outlets, matching helpers, and strategy layers all re-export from here, so application code imports navigation from one place.

This page is the map, not the manual. Each piece has its own guide:

- Build a route and attach its component, schemas, boundaries, and strategies: Route Builder.
- Navigate, read params and query, and check active state from Effect code: Router Service.
- Render a real anchor that performs client-side navigation: Link.
- Match the current path and render the active route tree: Outlet.

## Behavior

Two namespaces front the flow most application code touches:

- `Route` groups the fluent route-definition entrypoints: `Route.make(path)`, `Route.index(component)`, and `Route.provide(strategy)`, plus the `Route.redirect` / `Route.forbidden` middleware escape hatches. Read active navigation through `Router.currentRoute`.
- `Routes` exposes `Routes.make()`, the root builder that gathers top-level routes and root boundaries into a Routes manifest.

A Routes collection produces exactly one Routes manifest. You pass that manifest to `Outlet` as `routes={routes.manifest}`; the Outlet matches it against the current route and renders the active Route. The Router service never renders a page itself — it updates the current route, and the Outlet does the matching. Keep that split in mind: navigation and rendering are separate concerns wired through the same manifest.

`Route.make` accepts a path pattern (`/about`, `/users/:id`, `/docs/:path*`). Param names extracted from the pattern are checked against any `.params(...)` schema at the type level, so a schema that misses or adds a key fails to compile. A route only joins a collection through `.add(...)` once its middleware requirements are `R = never` — every service a `.middleware(...)` guard needs must already be satisfied within that guard's own Effect. Apply route-scoped strategy layers with `Route.provide(...)` and component-scoped layers with `Component.provide(...)`; component requirements live on the component, not on the route's `R`.

The barrel also re-exports lower-level symbols — matching helpers, path-pattern compilation, navigation core, render and scroll strategies — for tooling and advanced wiring. Most apps never touch them; start from the four guides above and drop down only when you need to.

## Related exports

- `Route` — fluent route-definition entrypoints and middleware escape hatches
- `Routes` — root builder gathering top-level routes into a manifest
- `Router` — navigation service updating the current route
- `Link` — real anchor performing client-side navigation
- `Outlet` — matches the manifest and renders the active route

## Troubleshooting

- Outlet renders nothing: confirm you passed `routes={routes.manifest}` (the finalized manifest), not the Routes collection itself, and that a route's pattern actually matches the current path.
- `.add(route)` does not type-check: a `.middleware(...)` guard still carries unsatisfied service requirements, so the builder's `R` is not `never`. Satisfy those services inside the guard's own Effect before adding the route. (Component services go through `Component.provide(layer)` and never affect the builder's `R`; `Route.provide(layer)` only attaches render/scroll strategies.)
- `Router.navigate`, `Router.isActive`, or `Router.currentRoute` reports a missing `Router` service: the code ran outside a mounted app. `mount` wires `Router.browserLayer` for you; in tests, provide `Router.testLayer(initialPath)` yourself.
