# API

## When to use

Use `trygg/api` when `app/api.ts` needs shared typing utilities for handlers, decoded requests, or schema-derived payload shapes.

## Behavior

These exports stay compile-time only. They project Effect HttpApi endpoint and group definitions into the request, success, error, and handler types your app code consumes.

## Related exports

- `Handler`
- `GroupHandlers`
- `Request`
- `Success`
- `Path`
