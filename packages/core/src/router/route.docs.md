# Route Builder

## When to use

Use the route builder when you need to define path patterns, params, middleware, layouts, boundaries, or per-route render and scroll strategy layers.

## Behavior

Route builders are immutable. Each chained call returns a new definition, path and query schemas decode at match time, and middleware can short-circuit rendering with typed redirect or forbidden failures.

## Related exports

- `routeMake`
- `routeIndex`
- `routeProvide`
- `routeRedirect`
- `routeForbidden`
