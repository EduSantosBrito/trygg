# Portal

## When to use

Use `Portal` when UI should stay owned by the current component tree but render into a different DOM target such as a modal root or document body.

## Behavior

`Portal.make` returns a component that teleports its content into a resolved target. Portals can use a fixed element, a selector, or a dynamic container and can be toggled with the `visible` prop.

## Related exports

- `Portal.make`
- `PortalProps`
- `PortalOptions`
- `PortalTargetNotFoundError`
