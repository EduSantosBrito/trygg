# Testing

## When to use

Use `trygg/testing` when component tests need to render trygg elements, drive DOM events, and wait on reactive updates without leaving the Effect runtime.

## Behavior

`render` and `renderElement` return DOM-focused query helpers. Event helpers dispatch through the browser DOM, and `waitFor` uses Effect schedules so `TestClock` can drive async assertions deterministically.

## Related exports

- `render`
- `renderElement`
- `click`
- `type`
- `waitFor`
