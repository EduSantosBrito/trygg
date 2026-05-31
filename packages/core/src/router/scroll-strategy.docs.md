# ScrollStrategy

Control scroll position on navigation per route tree — restore on back/forward and reset on a new route by default, or opt a route out when the page should stay put.

```tsx
import { Route, ScrollStrategy } from "trygg/router";
import { SettingsLayout, SettingsTabs } from "./settings";

export const settingsRoute = Route.make("/settings")
  .layout(SettingsLayout)
  .children(Route.index(SettingsTabs))
  .pipe(Route.provide(ScrollStrategy.None));
```

## When to use

`ScrollStrategy.Auto` is the default the Outlet applies when a route tree does not override it, so you reach for `ScrollStrategy` only to change that default:

- Provide `ScrollStrategy.None` on routes where the page should not move when the path changes — in-place tab switches, modal routes layered over a page, or filter/sort URLs that update query params under the same scroll position.
- Provide `ScrollStrategy.Auto` to make the default behavior explicit on a route, for example next to a `RenderStrategy` override where you want the scroll intent documented in the same place.

A strategy is route-scoped: it applies to the Route it is provided on and the descendants it renders, so place `None` on the nearest parent of the route tree that should opt out.

## Behavior

`ScrollStrategy` is a `Context.Service` whose value is the pure-data `ScrollStrategyType` union (`{ _tag: "Auto" }` or `{ _tag: "None" }`). `ScrollStrategy.Auto` and `ScrollStrategy.None` are `Layer` values, attached to a Route through `Route.provide(...)`. The Outlet resolves the nearest provided strategy after route matching and dispatches on `_tag`:

- `Auto` — saves and restores scroll position per history entry via `sessionStorage`. A new forward navigation scrolls to the top, back/forward restores the position saved for that entry, and a hash navigation scrolls to the matching element.
- `None` — no scroll management; the document stays exactly where it was across the navigation.

`Route.provide` recognizes the specific exported layer instances (`ScrollStrategy.Auto`, `ScrollStrategy.None`) to store the value on the Route's scroll-strategy slot rather than its render-strategy slot. Because the same `provide` accepts both `RenderStrategy` and `ScrollStrategy` layers, you can pipe both onto one Route:

```tsx
Route.make("/settings")
  .component(SettingsPage)
  .pipe(Route.provide(RenderStrategy.Eager), Route.provide(ScrollStrategy.None));
```

Sharp edge: `Route.provide` is for route-local strategy layers only. Service data a Component needs belongs at the component lifecycle boundary via `Component.provide(layer)` — passing an application Layer to `Route.provide` will not satisfy it.

## Related exports

- `ScrollStrategy` — the Context.Service key carrying `.Auto` and `.None` Layers
- `ScrollStrategyType` — pure-data union backing the resolved strategy value
- `ScrollAuto`
- `ScrollNone`

## Troubleshooting

- Scroll jumps to the top on a tab or filter change: that route is using the default `Auto`. Provide `ScrollStrategy.None` on the nearest parent Route of the tree that should stay put.
- `ScrollStrategy.None` has no effect: confirm it is provided on the Route that owns the navigation. A strategy applies to its own Route and descendants, so providing it on a sibling or a child below the navigating Outlet will not change that Outlet's behavior.
