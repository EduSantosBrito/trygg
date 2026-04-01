# Element

## When to use

Use `Element` types and constructors when you are building lower-level JSX helpers, renderer integrations, or APIs that need to accept trygg child values directly.

## Behavior

`Element` models JSX output as tagged data. Intrinsic tags, text, fragments, components, and reactive signal-backed nodes all normalize into this shape before the renderer mounts them. Use `Element.fromEffect` and `Element.fail` when lower-level code needs to lift an `Effect` into a lazy component element. Use `Element.fromUnknown` and `Element.fromChildren` when lower-level code needs JSX child normalization without introducing an extra sync runtime boundary.

## Related exports

- `Element`
- `intrinsic`
- `fragment`
- `keyedList`
- `Element.fromEffect`
- `Element.fail`
- `Element.fromUnknown`
- `Element.fromChildren`
- `ElementProps`
- `ElementChild`
- `ElementChildren`
- `EventHandler`
