# ErrorBoundary

## When to use

Use `ErrorBoundary` when a component can fail with tagged errors and you want fallback rendering to stay explicit in the component tree.

## Behavior

`ErrorBoundary.catch` starts a matcher around a component, `on` handles specific tagged failures, and `catchAll` or `exhaustive` finishes the matcher into a safe component surface.

## Related exports

- `ErrorBoundary.catch`
- `ErrorBoundary.on`
- `ErrorBoundary.catchAll`
- `ErrorBoundary.exhaustive`
