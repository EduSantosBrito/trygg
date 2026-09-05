# Link

Navigate between routes with a real anchor element that does typed client-side navigation and warms the target route before the click.

```tsx
import * as Router from "trygg/router";

<Router.Link to="/about">About</Router.Link>;
```

## When to use

Reach for `Link` whenever a user-visible navigation target should be a real `<a>`: nav bars, in-content links, breadcrumbs. You get the href in the DOM for accessibility, SEO, and middle-click/open-in-new-tab, plus client-side navigation on a plain click.

The `to` prop autocompletes against your declared routes, and `params` is required only when the path has dynamic segments:

```tsx
// Static path - params not allowed
<Router.Link to="/about">About</Router.Link>

// Dynamic path - params required and type-checked
<Router.Link to="/users/:id" params={{ id: "123" }}>View user</Router.Link>

// Query string and history replace
<Router.Link to="/search" query={{ q: "effect" }} replace>Search</Router.Link>
```

When a route has a Schema transform, `params` and `query` use its encoded URL input. For example, `Schema.DateFromString` is read as a decoded `Date` through `Router.params`, but `Link` accepts the encoded date string. The Vite plugin rejects route schemas whose encoded fields cannot round-trip through the router's string transport.

When you need to navigate from inside an effect rather than from a click, call `Router.navigate` directly instead of rendering a `Link`.

## Behavior

`Link` resolves the final href from `to`, `params`, and `query`, then renders an `intrinsic("a", ...)` with that href. It intercepts a plain click, calls `event.preventDefault()`, and delegates to `Router.navigate`. Clicks with a modifier key (meta, ctrl, shift) fall through to the browser so open-in-new-tab still works. Expected navigation failures are handled and recorded in a trace event. Defects and interruption preserve their complete Cause for the event fiber's owner.

`Link` reads the `Router` service when it renders, so it only works inside a mounted router tree — the same context an `Outlet` runs in. `mount` wires that service for you; rendering a `Link` with no router in context fails to resolve `Router`.

The `prefetch` prop selects a `PrefetchStrategy` that decides when the Router warms the target route's work:

- `"intent"` (default): prefetch on hover after a 50ms debounce, or immediately on focus.
- `"viewport"`: prefetch when the link scrolls into view.
- `"render"`: prefetch as soon as the link mounts.
- `false`: never prefetch.

Prefetch fibers are forked into the component scope, so they are interrupted on unmount and never float. The Router does the actual fetching; `Link` only decides when.

`Link` does not track active state itself. Read a `Signal<boolean>` from `Router.isActive(path)` and derive string attributes for `aria-current` / `data-active`:

```tsx
import { Component, Signal } from "trygg";
import * as Router from "trygg/router";

const NavItem = Component.gen(function* () {
  const active = yield* Router.isActive("/users");
  const dataActive = yield* Signal.derive(active, (a) => (a ? "true" : ""));
  const ariaCurrent = yield* Signal.derive(active, (a) => (a ? "page" : ""));
  return (
    <Router.Link to="/users" data-active={dataActive} aria-current={ariaCurrent}>
      Users
    </Router.Link>
  );
});
```

`data-*` and `aria-*` props are forwarded to the underlying `<a>`; `data-trygg-*` keys are reserved for internal use and dropped.

## Related exports

- `Link` — anchor doing typed client-side navigation
- `LinkProps` — the `to`, `params`, `query`, and `prefetch` props type
- `PrefetchStrategy` — selects when the target route is warmed

## Troubleshooting

- TypeScript demands `params` on a static path, or rejects them: the `to` string is matched against your routes manifest, so `params` is required only for patterns with `:segments` and forbidden otherwise. Fix the `to` value rather than casting the props.
- Active styling never turns on: a boolean Signal cannot drive a string attribute. Derive the attribute value with `Signal.derive(active, (a) => (a ? "page" : ""))` and bind that, as shown above.
- Hover prefetch never fires: hover prefetch only runs under the default `prefetch="intent"`. With `prefetch={false}` no warming happens; with `"render"` it has already fired on mount.
