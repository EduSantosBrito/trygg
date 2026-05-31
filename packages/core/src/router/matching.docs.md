# Route Matching

Resolve a path to the Route that owns it, with raw params and the resolved chain the Outlet renders from — exposed for tests and advanced integrations.

```tsx
import { Effect, Option } from "effect";
import * as Router from "trygg/router";
import { HomePage, UserPage } from "./pages.js";

const manifest = Router.Routes.make()
  .add(Router.Route.make("/").component(HomePage))
  .add(Router.Route.make("/users/:id").component(UserPage)).manifest;

const program = Effect.gen(function* () {
  const matcher = yield* Router.createMatcher(manifest);
  const match = matcher.match("/users/42");
  if (Option.isSome(match)) {
    // match.value.route is the ResolvedRoute, match.value.params is { id: "42" }
    return match.value.params;
  }
  return undefined;
});
```

## When to use

Most apps never call this directly — the Outlet consumes a Routes manifest and the Current route and runs matching for you. Reach for these helpers only when you are:

- Writing tests that assert a path resolves to the expected Route or params.
- Building an advanced integration (a custom render surface, a prefetch probe) that needs the resolved match outside the normal Outlet render path.

Redirects, middleware, and Boundary surfaces are not declared here. They live on the Route builder — `routeRedirect`, `routeForbidden`, `.middleware()`, and the Boundary slots — and are covered on the Route Builder page. This module only resolves and matches; it does not decide policy.

## Behavior

- `resolveRoutes` flattens the nested route tree into absolute `ResolvedRoute` patterns, carrying each route's ancestors (root first, parent last). A route enters the flat list only if it has a component or is an index route.
- Matching prefers more specific patterns. Patterns with more segments sort first; among patterns of equal segment count, a per-segment score breaks the tie — static segments outrank params, params outrank required catch-alls, and those outrank wildcards. The matcher sorts compiled patterns once, then linear-scans for the first hit, returning `Option<RouteMatch>` with raw string params.
- Boundary resolution is nearest-wins: `resolveErrorBoundary`, `resolveNotFoundBoundary`, and `resolveForbiddenBoundary` walk leaf, then ancestors, then the root manifest surface, and return the first defined boundary. `resolveLoadingBoundary` walks leaf then ancestors only — there is no root loading surface — and returns the nearest loading component or `Option.none()`.
- Render and scroll strategy layers resolve the same way: `resolveRenderStrategy` and `resolveScrollStrategy` walk leaf then ancestors and return the nearest layer, or `undefined` for the default.
- Decode happens only after a route matches. `decodeRouteParams` and `decodeRouteQuery` run the route's schema against the raw match; with no schema, params pass through unchanged and query returns an empty object.
- `createMatcher` is the synchronous test helper — it resolves and compiles eagerly and exposes a plain `match` that returns `Option<RouteMatch>` directly. `RouteMatcher` is the same logic as an injectable Service: `RouteMatcher.make(manifest)` for production, `RouteMatcher.test(routes)` for tests, both returning a Layer whose error channel is `InvalidRoutePathPattern`.

## Related exports

- `RouteMatcher` — injectable Service wrapping the match logic as a Layer
- `resolveRoutes` — flattens the nested tree into absolute resolved patterns
- `createMatcher` — synchronous test helper exposing a plain `match`
- `decodeRouteParams` — runs the route's param schema against the raw match
- `decodeRouteQuery` — runs the route's query schema against the raw match
- `resolveErrorBoundary` — walks leaf to root for the nearest error boundary
