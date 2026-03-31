# SafeUrl

## When to use

Use `SafeUrl` when a string can cross an untrusted boundary before it reaches DOM attributes like `href` or `src`.

## Behavior

Relative URLs pass without a scheme check. Absolute URLs must use an allowed scheme. Empty strings and blocked schemes fail with `UnsafeUrlError`.

## Related exports

- `SafeUrl.validate`
- `SafeUrl.validateSync`
- `SafeUrl.validateOption`
- `SafeUrl.isSafe`
- `SafeUrl.allowSchemes`
- `UnsafeUrlError`
