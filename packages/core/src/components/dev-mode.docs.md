# DevMode

## When to use

Use `DevMode` in app shells, examples, or tests when you want debug logging enabled through the public component surface instead of calling debug helpers directly.

## Behavior

`DevMode` renders nothing. While mounted it enables debug logging, optionally narrows events with `filter`, and registers any custom plugins passed through props.

## Related exports

- `DevMode`
- `DevModeProps`
