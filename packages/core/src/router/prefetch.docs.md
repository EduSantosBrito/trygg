# Route Prefetch

Warm a route's lazy component and declared prefetch effects before the click, so the destination is ready to render on navigation instead of blocking on a cold load.

```tsx
import { Component } from "trygg";
import { Effect } from "effect";
import { Route, Routes } from "trygg/router";
import * as Router from "trygg/router";

const loadUsers = () => Effect.succeed(undefined);

const UsersList = Component.gen(function* () {
  return <h1>Users</h1>;
});

export const routes = Routes.make().add(
  Route.make("/users").prefetch(() => loadUsers()).component(UsersList),
);

// The Link warms that route before the click; "intent" is the default.
const ToUsers = <Router.Link to="/users" prefetch="intent">View users</Router.Link>;
```

## When to use

Reach for prefetch when a destination has a lazy component or async data and you want the click to feel immediate. The common path is declarative: declare `.prefetch(fn)` on the `Route`, then let a `Link` decide when to warm it through its `prefetch` strategy. The Router resolves the target route, runs its prefetch effects, and warms its lazy component while the user is still deciding.

Call `Router.prefetch(path)` directly when you trigger warming from inside an effect rather than from a `Link` — for example, a custom navigation surface that decides on its own when a destination becomes likely.

Reach lower, to `runPrefetch`, only when you own an `Outlet`-level surface and already hold the matched route's prefetch callbacks and context, and need to execute them yourself.

Skip prefetch for routes that are cheap, already loaded, or behind side effects you do not want to run speculatively — set `prefetch={false}` on the `Link`.

## Behavior

A `Route`'s `.prefetch(fn)` registers one callback; multiple calls accumulate and all run in parallel. Each callback receives the matched route context and returns an `Effect`. The context is typed as `unknown`, so narrow it before reading `params` or `query`:

```ts
import { Effect } from "effect";

const loadUser = (ctx: unknown) => {
  const { params } = ctx as { params: { id: string } };
  return Effect.succeed(params.id);
};
```

`runPrefetch(prefetchFns, ctx)` is the low-level executor. It calls every callback with `ctx`, runs the resulting effects with unbounded concurrency, and returns an `Effect<void>`; when `prefetchFns` is empty it returns `Effect.void`. Prefetch is best-effort: a failing callback is caught, logged as a `"Prefetch failed"` warning with the error annotated, and converted to void, so a broken prefetch never blocks or fails navigation.

The `Link` `prefetch` prop is a `PrefetchStrategy` that decides when warming happens:

- `"intent"` (default): on hover after a 50ms debounce, or immediately on focus.
- `"viewport"`: when the link scrolls into view.
- `"render"`: as soon as the link mounts.
- `false`: never prefetch.

Prefetch fibers are forked into the component scope, so they are interrupted on unmount and never float. The `Link` only decides when; the Router runs `Router.prefetch(path)` and warms the lazy component for routes whose `RenderStrategy` loads on demand. `Router.prefetch(path)` is best-effort and a no-op until an `Outlet` has mounted and registered its prefetch resolver — calls made before then are silently dropped rather than queued.

Because prefetch is speculative, treat each callback as idempotent and side-effect-light. Errors are swallowed by design — if you need a hard guarantee that data is present, load it inside the route component, not only in prefetch.

## Related exports

- `runPrefetch` — low-level executor running prefetch callbacks in parallel
- `Route` — declares `.prefetch(fn)` callbacks on a route
- `Router` — runs `Router.prefetch(path)` and warms the lazy component
- `Link` — decides when warming happens via its strategy
- `PrefetchStrategy` — the `Link` prop choosing when to warm
- `RenderStrategy` — marks which routes load their component on demand

## Troubleshooting

- Hover prefetch never fires: it only runs under the default `prefetch="intent"`. With `prefetch={false}` no warming happens; with `"render"` it already fired on mount.
- A prefetch error is silently dropped: that is intended. `runPrefetch` catches each callback, logs a `"Prefetch failed"` warning with the error annotated, and continues. Move any must-succeed load into the route component.
- Prefetch runs too eagerly or too often: `"render"` warms every mounted `Link` immediately, and `"intent"` re-arms on each hover. Pick `"viewport"` or `false` for off-screen or low-value targets so you do not run speculative effects you will not use.