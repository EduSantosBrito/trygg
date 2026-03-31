# jsx-runtime

## When to use

Use `trygg/jsx-runtime` indirectly through `jsxImportSource: "trygg"` when compiling production JSX with the automatic runtime.

## Behavior

The compiler lowers JSX syntax into `jsx` or `jsxs` calls. Those helpers normalize props, validate component types, and produce trygg `Element` values without pulling in React.

## Related exports

- `jsx`
- `jsxs`
- `Fragment`
- `JSXProps`
- `JSXElementType`
