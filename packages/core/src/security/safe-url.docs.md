# SafeUrl

Every `href` and `src` you render is checked against a scheme allowlist on its own, so a `javascript:` or `data:` URL is dropped before it reaches the DOM with no wiring on your part — `SafeUrl` is how you read or widen that policy.

```tsx
import { Component } from "trygg";

const ProfileLink = Component.gen(function* () {
  const href = "javascript:alert(1)"; // attacker-controlled string
  // The renderer validates href against the default allowlist and drops it.
  return <a href={href}>View profile</a>; // the href attribute is never set
});
```

## When to use

The renderer applies the allowlist to every `href` and `src` attribute with no setup, so you do not reach for `SafeUrl` for the default protection.

Reach for the `SafeUrl` exports when you need to:

- Widen or narrow the allowlist for the whole app — provide `SafeUrl.SafeUrlConfig` as a Layer before the Mount boundary.
- Validate a URL yourself before storing or forwarding it, outside the `href`/`src` render path.

To allow an extra scheme, provide a `SafeUrlConfig` Layer:

```ts
import { Layer } from "effect";
import { SafeUrl } from "trygg";

const SafeUrlLayer = Layer.succeed(SafeUrl.SafeUrlConfig, {
  allowedSchemes: [...SafeUrl.DEFAULT_ALLOWED_SCHEMES, "myapp"],
});
```

## Behavior

The default allowlist (`SafeUrl.DEFAULT_ALLOWED_SCHEMES`) covers `http`, `https`, `mailto`, `tel`, `sms`, `blob`, and `data`.

- Relative URLs (no scheme) always pass.
- Absolute URLs must use an allowed scheme.
- Empty strings are rejected.

The renderer reads `SafeUrlConfig` from render context and falls back to `SafeUrl.defaultConfig` when no Layer is provided — that is why protection is on by default. When a rendered `href`/`src` fails the check, the renderer drops the attribute and emits a trace event (`safeUrl.blocked`, surfaced in the Debug stream); it does not raise `UnsafeUrlError`. To change the allowlist for rendered attributes, provide a `SafeUrlConfig` Layer before the Mount boundary.

`UnsafeUrlError` is surfaced only by the Effect APIs you call yourself. `SafeUrl.validate` requires `SafeUrlConfig` in context and fails with `UnsafeUrlError` (its `reason` is one of `invalid_url`, `unsafe_scheme`, `empty_url`). When you would rather skip an invalid URL than handle a failure, `SafeUrl.validateOption` yields `Option.none()` and `SafeUrl.isSafe` yields a boolean — neither fails. `SafeUrl.validateSync` checks against the default allowlist without reading context, for call sites that cannot run an Effect.

```ts
import { Effect, Option } from "effect";
import { SafeUrl } from "trygg";

const program = Effect.gen(function* () {
  yield* SafeUrl.validate("https://example.com"); // succeeds
  yield* SafeUrl.validate("javascript:alert(1)"); // fails with UnsafeUrlError
}).pipe(Effect.provide(SafeUrl.SafeUrlConfig.layer));

const allowed = SafeUrl.validateSync("data:text/html,x"); // Option.some, allowed by default
const skipped = Option.isNone(SafeUrl.validateSync("file:///etc/passwd")); // true
```

## Related exports

- `SafeUrl.validate`
- `SafeUrl.validateOption`
- `SafeUrl.isSafe`
- `SafeUrl.validateSync`
- `SafeUrl.validateSyncWithConfig`
- `SafeUrl.SafeUrlConfig`
- `SafeUrl.defaultConfig`
- `SafeUrl.DEFAULT_ALLOWED_SCHEMES`
- `UnsafeUrlError`

## Troubleshooting

- A link or image silently has no `href`/`src`: its scheme is not on the allowlist, so the renderer dropped it. Check the Debug stream for the `safeUrl.blocked` event, and add the scheme via a `SafeUrl.SafeUrlConfig` Layer if it is intended.
- `SafeUrl.validate` reports a missing `SafeUrlConfig`: it requires the service in context. Provide `SafeUrl.SafeUrlConfig.layer` (defaults) or your own `Layer.succeed(SafeUrl.SafeUrlConfig, …)`, or use `SafeUrl.validateSync` when you cannot run inside an Effect.
- A custom scheme works in `SafeUrl.validate` but not in rendered attributes: the renderer reads the allowlist from render context. Provide the `SafeUrlConfig` Layer before the Mount boundary, not only inside the validating Effect.
