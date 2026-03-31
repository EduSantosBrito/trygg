# Debug

## When to use

Use `Debug` when you need direct control over debug event collection, plugins, spans, or trace propagation outside the `DevMode` convenience component.

## Behavior

`Debug` manages global debug enablement, filters emitted events, fans events out to plugins, and exposes helpers for attaching trace and span context to work done inside Effects.

## Related exports

- `Debug.enable`
- `Debug.log`
- `Debug.withSpan`
- `Debug.defaultLayer`
