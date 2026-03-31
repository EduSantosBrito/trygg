# Component

## When to use

Use `Component` when you want a JSX component with explicit Effect requirements and parent-provided services.

## Behavior

`Component.gen` runs once per component instance, yields props and services through Effect, and hands fine-grained updates off to `Signal` and the renderer instead of re-running the whole component body for every DOM change.

## Related exports

- `Component`
- `ComponentProps`
- `isEffectComponent`
