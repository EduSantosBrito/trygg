# Signal

## When to use

Use `Signal` for local or module-level reactive state, derived values, suspended views, and keyed list rendering.

## Behavior

`Signal` defaults to fine-grained DOM updates when you pass a signal directly to JSX. Call `Signal.get` only when the component itself must re-run. `Signal.makeSync` is for stable module-lifetime state; `Signal.make` is for scoped state created inside Effects and components.

## Related exports

- `Signal.make`
- `Signal.makeSync`
- `Signal.get`
- `Signal.derive`
- `Signal.suspend`
- `Signal.each`
