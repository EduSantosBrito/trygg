# Router Service

## When to use

Use the router service when components or effects need to read current navigation state, navigate programmatically, inspect params or query, or prefetch route work.

## Behavior

The router keeps current route state in signals, coordinates history and location updates through platform services, and relies on the outlet to register params, query, error, and prefetch context for the active match.

## Related exports

- `Router`
- `get`
- `navigate`
- `params`
- `query`
- `isActive`
- `prefetch`
- `browserLayer`
- `testLayer`
