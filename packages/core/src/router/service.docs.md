# Router Service

Drive navigation and read live route state from inside Effect-aware UI code, the same way you read any other Service.

```tsx
import { Component, Signal } from "trygg";
import * as Router from "trygg/router";

const Nav = Component.gen(function* () {
  const router = yield* Router.get;
  const path = yield* Signal.derive(router.current, (route) => route.path);
  return (
    <nav>
      <span>At {path}</span>
      <button onClick={() => router.navigate("/users/:id", { params: { id: 123 } })}>
        Go to user 123
      </button>
    </nav>
  );
});
```

## When to use

Reach for `Router` when a Component or Effect needs to move between routes or read the Current route reactively, not just respond to a clicked anchor.

- Programmatic navigation after an action: yield `Router.get` and call `navigate`, `back`, or `forward`, or use the module-level `navigate`, `back`, and `forward` Effects directly.
- Reactive route-aware UI: derive from `current` (the `Signal<Route>`) so only the bound nodes update on navigation.
- Active-link styling without a component re-render: `isActive` returns a `Signal<boolean>` you pass straight to JSX.

For declarative navigation in markup, prefer the `Link` component over wiring `navigate` by hand. For the matched route's decoded data, read `params` and `query` rather than parsing `current.path` yourself.

## Behavior

`Router` is a Context.Service tag. Yield `Router.get` for the service implementation, or call the module-level helper Effects (`navigate`, `current`, `params`, and friends) that yield it for you. Both forms require a router Layer in context: `mount` wires `Router.browserLayer` for you in real apps, so you do not provide it by hand; in unit tests, provide `Router.testLayer(initialPath)` yourself.

- `current` is the reactive `Signal<Route>` for the Current route; `currentRoute` is the one-step snapshot for code that only needs the latest value.
- `navigate(path, options)` interpolates `options.params`, serializes query, writes history, and saves scroll context before the Outlet processes the match. It fails with `NavigationError`. `back` and `forward` delegate to history and can also fail with `NavigationError`.
- `params(path)` and `query(path)` read the decoded params and query the Outlet placed in router context for the active match. The `path` argument exists only for type inference; it is not used at runtime, so the values reflect whatever route is currently matched.
- `querySignal` exposes the raw `URLSearchParams` Signal for low-level inspection; `query(path)` returns the schema-decoded object instead.
- `isActive(path, options)` derives a `Signal<boolean>` from `current`. Keep it as a Signal in JSX for fine-grained updates; calling `Signal.get` on it subscribes the surrounding Component to every route change.
- `prefetch(path)` is best-effort and only does real work once an Outlet has mounted to register the resolver; failures are swallowed.
- `currentError` succeeds only while an error Boundary is rendering for the active route. Outside one it fails with `CurrentErrorOutsideBoundaryError`.

`Router` updates the Current route; it does not render pages. The Outlet matches the Routes manifest against the Current route to render the active Route and its Layout.

## Related exports

- `Router` — the Context.Service tag for navigation state
- `get` — yields the router service implementation
- `navigate` — interpolates params, writes history, triggers the match
- `back` — delegates a backward step to history
- `forward` — delegates a forward step to history
- `current` — reactive `Signal<Route>` for the current route
- `currentRoute` — one-step snapshot of the current route
- `query` — schema-decoded query object for the active match
- `querySignal` — raw `URLSearchParams` Signal for low-level inspection
- `params` — decoded params for the active match
- `isActive` — derives a `Signal<boolean>` for active-link styling
- `prefetch` — best-effort warming once an Outlet has mounted
- `currentError` — succeeds only inside an active error Boundary
- `browserLayer` — router Layer `mount` wires for real apps
- `testLayer` — router Layer you provide in unit tests

## Troubleshooting

- Navigation does nothing and the Effect fails to resolve `Router`: the code ran outside a mounted app, so no router Layer is in context. Run it through `mount` (which wires `Router.browserLayer`), or provide `Router.testLayer(initialPath)` in tests.
- `params` or `query` returns an empty object: the Outlet has not registered context for a matched route yet, or the surrounding Effect runs outside the active route. Read these from inside a route component.
- An active-link binding only updates after a full re-render: you called `Signal.get` on the `isActive` result. Pass the `Signal<boolean>` (or a `Signal.derive` of it) to JSX instead.
- `currentError` fails with `CurrentErrorOutsideBoundaryError`: it was read outside a route's `.error` Boundary. Only call it inside an error boundary component.