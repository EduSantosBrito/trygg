# Renderer

## When to use

Use `mount` for normal apps, `mountDocument` for root-layout ownership, and `Renderer` or `browserLayer` only when you need lower-level composition.

## Behavior

The renderer turns `Element` trees into DOM, preserves render scope for event handlers and subscriptions, and installs the browser/runtime layers needed for signals, resources, and routing.

## Related exports

- `Renderer`
- `RendererService`
- `browserLayer`
- `mount`
- `renderDocument`
- `mountDocument`
