# Element

## When to use

Use `Element` types and constructors when you are building lower-level JSX helpers, renderer integrations, or APIs that need to accept trygg child values directly.

## Behavior

`Element` models JSX output as tagged data. Intrinsic tags, text, fragments, components, and reactive signal-backed nodes all normalize into this shape before the renderer mounts them.

## Related exports

- `Element`
- `ElementProps`
- `ElementChild`
- `ElementChildren`
- `EventHandler`
