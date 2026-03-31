# Link

## When to use

Use `Link` for client-side navigation when you want typed params, proper anchor semantics, and built-in prefetch triggers.

## Behavior

`Link` renders a real `<a>` element, computes the final href from params and query, intercepts ordinary clicks to call the router, and optionally prefetches route work on intent, viewport entry, or render.

## Related exports

- `Link`
- `LinkProps`
- `PrefetchStrategy`
