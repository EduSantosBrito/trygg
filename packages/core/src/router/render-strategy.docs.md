# RenderStrategy

Keep a large route out of the first-load bundle by code-splitting it into a chunk that loads on navigation, or pin a small critical route into the main bundle so it is ready on first paint.

```tsx
import { Route, RenderStrategy } from "trygg/router";
import { HomePage } from "./pages/home.js";
import { ReportsPage } from "./pages/reports.js";

// Lazy is the default: the Vite plugin rewrites `.component(ReportsPage)`
// into `.component(() => import("./pages/reports.js"))` at build time.
const reports = Route.make("/reports").component(ReportsPage);

// Eager: stays a direct import, bundled into the main chunk, ready on first load.
const home = Route.make("/").component(HomePage).pipe(Route.provide(RenderStrategy.Eager));
```

## When to use

Reach for an explicit strategy when a route's loading cost matters for first paint:

- **Eager** for the small, always-needed routes — the landing page, the app shell, anything the first screen renders. It opts the route out of code splitting so its component ships in the main bundle and renders without a chunk fetch.
- **Lazy** is already the default, so you rarely write it by hand. Provide `RenderStrategy.Lazy` only to mark intent on a route a reader might otherwise expect to be eager, or to override an eager strategy inherited from a parent chain.

If a route is large and not on the critical path (a dashboard, a settings screen, an admin section), leave it on the default Lazy and it is split into its own chunk automatically.

## Behavior

A strategy is a `Layer<RenderStrategy>` attached to a route with `Route.provide(...)`. `RenderStrategy.Eager` and `RenderStrategy.Lazy` are the two singleton Layers; both resolve to a pure-data `RenderStrategyType` value (`{ _tag: "Eager" }` or `{ _tag: "Lazy" }`).

The strategy is read at two stages:

- **Build time (Vite plugin).** The plugin inspects the route chain. A Lazy leaf has its `.component(X)` rewritten to `.component(() => import("./X"))`, producing a separate chunk. An Eager route is skipped, so its component stays a direct import in the main bundle.
- **Runtime (Outlet).** The Outlet dispatches structurally on the `ComponentInput` it receives — a loader function (lazy) is awaited and resolved; a direct reference (eager) renders immediately. No service read is needed for the Eager/Lazy split.

When a lazy chunk fails to resolve — a network drop, a stale deploy, a parse error — `resolveComponent` raises a `RenderLoadError` carrying the underlying `cause`. How the Outlet handles it depends on the route tree: when the route or an ancestor has an error boundary (`.error(...)`), the loader is awaited and the failure renders through that boundary; with no boundary, the lazy leaf renders as a self-loading component so the failure stays contained in the route view rather than failing the Outlet. Either way, add `.error(...)` when you want a failed dynamic import to land on fallback UI instead of a blank view.

`Route.provide` is also where `ScrollStrategy` is attached, so the same call site configures both per-route strategies:

```tsx
import { Route, RenderStrategy, ScrollStrategy } from "trygg/router";
import { SettingsPage } from "./pages/settings.js";

Route.make("/settings")
  .component(SettingsPage)
  .pipe(Route.provide(RenderStrategy.Eager), Route.provide(ScrollStrategy.None));
```

The strategy union is open: `RenderStrategyType` is a `Data.TaggedEnum`, and future members (Server, Island, Static) can be added without changing how `Eager` and `Lazy` are applied today.

## Related exports

- `RenderStrategy` — the service key and value export; carries the `.Eager` and `.Lazy` singleton Layers you pass to `Route.provide`.
- `RenderLoadError` — the typed failure raised when a lazy chunk fails to load or decode.
- `RenderStrategyType` — the `Data.TaggedEnum` union (type export) backing the resolved strategy values.
- `Eager`, `Lazy` — type exports for the two members of `RenderStrategyType`.

## Troubleshooting

- **Expected a separate chunk but the component is in the main bundle.** The route resolved to Eager — either an explicit `Route.provide(RenderStrategy.Eager)` on the route or inherited from a parent chain. Remove the Eager provide to fall back to the default Lazy split.
- **A failed navigation shows a blank view instead of an error.** The lazy chunk raised a `RenderLoadError` and the route tree had no error boundary to catch it. Add `.error(SomeFallback)` to the route or an ancestor so the Outlet awaits the loader and renders the failure through that boundary.
- **The dynamic import never appears in the build output.** The Vite plugin only rewrites a Lazy _leaf_ `.component(...)`. Confirm the route is a leaf (it calls `.component`, not `.children`) and is not marked Eager.
