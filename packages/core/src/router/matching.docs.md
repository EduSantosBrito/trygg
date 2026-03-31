# Route Matching

## When to use

Use the matching helpers when tests or advanced router integrations need to resolve route trees, inspect matches, collect middleware, or decode params and query outside the full outlet render path.

## Behavior

The matcher resolves nested route definitions into absolute patterns, prefers static segments over params and catch-alls, walks ancestors for middleware and boundary selection, and decodes params or query only after a route matches.

## Related exports

- `RouteMatcher`
- `resolveRoutes`
- `createMatcher`
- `collectRouteMiddleware`
- `decodeRouteParams`
- `decodeRouteQuery`
