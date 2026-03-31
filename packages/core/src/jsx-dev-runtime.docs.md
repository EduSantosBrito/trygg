# jsx-dev-runtime

## When to use

Use `trygg/jsx-dev-runtime` indirectly in development builds when your JSX compiler wants source-location aware runtime calls.

## Behavior

`jsxDEV` and `jsxsDEV` accept the extra development-only compiler arguments, then delegate to the production runtime semantics so dev and prod JSX produce the same `Element` shapes.

## Related exports

- `jsxDEV`
- `jsxsDEV`
