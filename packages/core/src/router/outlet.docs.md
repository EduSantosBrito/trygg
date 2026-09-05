# Outlet

Render the matched Route — and the Layouts that wrap it — at this exact point in your tree, so chrome like a sidebar or header stays mounted while the inner content swaps.

```tsx
import { Component } from "trygg";
import * as Router from "trygg/router";

const DashboardLayout = Component.gen(function* () {
  return (
    <div class="dashboard">
      <nav>Sidebar</nav>
      <main>
        <Router.Outlet />
      </main>
    </div>
  );
});

const Overview = Component.gen(function* () {
  return <h1>Overview</h1>;
});

const routes = Router.Routes.make().add(
  Router.Route.make("/dashboard").layout(DashboardLayout).children(Router.Route.index(Overview)),
);

const App = Component.gen(function* () {
  return <Router.Outlet routes={routes.manifest} />;
});
```

## When to use

Reach for `Outlet` in two places, both shown above:

- Once at the app root, passed the Routes manifest, to render whatever Route the Current route matches.
- Inside a Layout, with no props, to mark where that Layout's matched child Route renders. A Layout is just a Component that places `<Outlet />` around its own chrome; the Route declares it with `.layout(...)` over its `.children(...)`.

You do not call `Outlet` to read params or to navigate — that is the `Router` service and `Link`. `Outlet` only decides what renders, and where.

## Behavior

`Outlet` consumes the Routes manifest plus the Current route and renders the active Route tree at its position.

- Manifest resolution. The root `Outlet` takes the manifest from its `routes` prop. A nested `Outlet` omits the prop and renders the child content handed down from its parent Layout's match, so the Layout DOM around it stays mounted.
- Layout stacking. For a match, `Outlet` stacks the Route's Layout chain from root to leaf, each Layout's `<Outlet />` receiving the next inner Route as its child. The matched leaf Component lands in the innermost Layout's outlet.
- Reactive swaps. `Outlet` subscribes to the Current route and re-runs matching on navigation, swapping only the changed region — a sibling navigation under the same Layout updates the leaf in place rather than re-mounting the Layout. The outlet Component itself does not re-render on navigation.
- Activation ownership. Every versioned Current route claims a single-use activation. The latest claim owns loading, visible commits, and scroll; a newer claim interrupts ownership-gated predecessor work, including middleware, lazy loading, loading fallback, DOM swap, and scroll work.
- Bounded navigation identity. The built-in Outlet remembers the highest accepted navigation version, including when versions are skipped. It does not retain an ever-growing history of activation labels. Older versions cannot become current again.
- Ordered replacement. Matching and preparation may begin while superseded work finalizes, but a winning loading fallback or DOM swap waits for the predecessor activation chain to become quiescent. Cleanup finalizers from interrupted work therefore finish before the winner changes visible DOM.
- Stale suppression. Ownership is checked around asynchronous matching, middleware, loading, DOM, and scroll boundaries. Results from an older activation cannot display a stale fallback, replace the winner, apply stale scroll, or report a terminal commit.
- Exact DOM acknowledgement. Each mounted root view and persistent Layout child has its own swap request. Scroll runs only after the renderer acknowledges that exact requested Element was inserted for the owning activation; equal older DOM, another swap target, or a superseded request cannot release it. There is no timer fallback that can apply scroll before the replacement.
- Boundaries and strategy. On each activation `Outlet` runs route middleware, resolves the nearest loading, error, forbidden, and not-found Boundary, and applies the Route's render strategy. Its scroll strategy runs after the exact DOM acknowledgement and only while that activation remains current.

- Middleware outcomes. A typed redirect activates its destination, including redirect chains during initial rendering. A typed denial renders the forbidden Boundary. Other failures and defects reach the error Boundary with their complete Cause and runtime annotations; interruption propagates without rendering that fallback.

The lower-level `RouteActivation.make` capability also supports application-defined string IDs. Exact duplicate rejection for those arbitrary IDs retains the used labels for that coordinator's lifetime. Keep such a coordinator within the lifetime of the operation group it coordinates; the built-in Outlet uses the bounded navigation protocol instead.

Sharp edges: an empty or missing manifest renders the text `No routes configured`, and an unmatched path renders the nearest not-found Boundary (or `404 - Not Found` if none is declared). A predecessor finalizer that never completes also delays the winner's visible replacement; keep route and Component cleanup finite rather than bypassing finalization ordering.

## Related exports

- `Outlet` — renders the matched route and its layout chain
- `OutletProps` — the `routes` manifest prop type
- `Routes` — root builder producing the manifest Outlet consumes
- `Route` — declares the layout and children Outlet stacks
- `Router` — updates the current route Outlet matches against

## Troubleshooting

- Symptom: the Layout chrome re-mounts (state lost, scroll jumps) on every navigation between sibling pages. Cause: the sibling routes are not declared as `.children(...)` of the same `.layout(...)` parent, so each match rebuilds a fresh Layout frame. Fix: nest the pages under one parent Route that owns the Layout.
- Symptom: child content never appears inside a Layout. Cause: the Layout Component has no `<Router.Outlet />` in its returned Element, so there is no point to render the matched child. Fix: place a prop-less `<Router.Outlet />` where the nested Route should render.
- Symptom: root outlet renders `No routes configured`. Cause: the `routes` prop is undefined and no Routes manifest is present on context. Fix: pass `routes={routes.manifest}` to the top-level `Outlet`.
