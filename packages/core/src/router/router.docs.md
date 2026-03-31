# Router

## When to use

Use `trygg/router` when you want the supported routing surface from one entrypoint: route builders, navigation APIs, links, outlets, matching helpers, and strategy layers.

## Behavior

`trygg/router` is the public navigation facade. The `Route` and `Routes` namespaces keep the common builder flow discoverable, while the entrypoint re-exports the lower-level router, matching, params, and strategy symbols from their owner modules.

## Related exports

- `Route`
- `Routes`
- `Router`
- `Link`
- `Outlet`
- `RouteMatcher`
