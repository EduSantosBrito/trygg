# SafeUrl

Every URL-bearing prop you render is parsed with the WHATWG URL parser and checked against the policy for its concrete DOM sink. A value accepted for an image is not automatically accepted for navigation, form submission, or scripts.

```tsx
import { Component } from "trygg";

const ProfileLink = Component.gen(function* () {
  const href = "javascript:alert(1)"; // attacker-controlled string
  // The renderer validates href against the default allowlist and drops it.
  return <a href={href}>View profile</a>; // the href attribute is never set
});
```

## When to use

The renderer applies sink-specific policies to every URL prop exposed by `Element`: `href`, `src`, `action`, `formAction`, `data` on objects, `poster`, `cite`, `ping`, and every `srcSet` candidate. You do not reach for `SafeUrl` for the default protection.

Reach for the `SafeUrl` exports when you need to:

- Widen or narrow the allowlist for the whole app — provide `SafeUrl.SafeUrlConfig` as a Layer before the Mount boundary.
- Validate a URL yourself before storing or forwarding it, outside the renderer's URL-attribute path.

To allow an extra scheme, provide a `SafeUrlConfig` Layer:

```ts
import { Layer } from "effect";
import { SafeUrl } from "trygg";

const SafeUrlLayer = Layer.succeed(SafeUrl.SafeUrlConfig, {
  allowedSchemes: [...SafeUrl.DEFAULT_ALLOWED_SCHEMES, "myapp"],
});
```

## Behavior

The default capability list (`SafeUrl.DEFAULT_ALLOWED_SCHEMES`) covers `http`, `https`, `mailto`, `tel`, `sms`, `blob`, and `data`. Each sink narrows that list:

- Navigation accepts configured navigation schemes, but never `blob`, `data`, `javascript`, or `vbscript`.
- Forms and executable/resource loads accept only `http` and `https`.
- Image and media sources may accept `http`, `https`, `blob`, and `data`.
- `object[data]` and citation URLs are resources, so they accept only `http` and `https`.
- `video[poster]` is an image sink and may accept `blob` and `data`.
- `srcSet` and whitespace-separated `ping` lists are accepted only when every candidate passes that attribute's policy.

- Valid relative URLs and base-dependent references retain their original form.
- Self-contained absolute URLs are canonicalized and must use a scheme authorized for their sink.
- Empty strings are rejected.
- Ambiguous control characters and parser failures are rejected.

The renderer reads `SafeUrlConfig` from render context and falls back to `SafeUrl.defaultConfig` when no Layer is provided — that is why protection is on by default. When a rendered URL attribute fails the check, the renderer removes it and emits a trace event (`safeUrl.blocked`, surfaced in the Debug stream); it does not raise `UnsafeUrlError`. The same policy runs for static, Signal-backed, and Effect-backed props. To change the allowlist for rendered attributes, provide a `SafeUrlConfig` Layer before the Mount boundary.

`UnsafeUrlError` is surfaced only by the Effect APIs you call yourself. `SafeUrl.validate` requires `SafeUrlConfig` in context and fails with `UnsafeUrlError` (its `reason` is one of `invalid_url`, `unsafe_scheme`, `empty_url`). When you would rather skip an invalid URL than handle a failure, `SafeUrl.validateOption` yields `Option.none()` and `SafeUrl.isSafe` yields a boolean — neither fails. `SafeUrl.validateSync` checks against the default allowlist without reading context, for call sites that cannot run an Effect.

```ts
import { Effect, Option } from "effect";
import { SafeUrl } from "trygg";

const program = Effect.gen(function* () {
  yield* SafeUrl.validate("https://example.com"); // succeeds
  yield* SafeUrl.validate("javascript:alert(1)"); // fails with UnsafeUrlError
}).pipe(Effect.provide(SafeUrl.SafeUrlConfig.layer));

const allowedImage = SafeUrl.validateSyncForSink(
  "data:image/png;base64,iVBORw0KGgo=",
  "image",
  SafeUrl.defaultConfig,
); // Option.some
const blockedNavigation = SafeUrl.validateSync("data:text/html,x"); // Option.none
const skipped = Option.isNone(SafeUrl.validateSync("file:///etc/passwd")); // true
```

## Related exports

- `SafeUrl.validate`
- `SafeUrl.validateOption`
- `SafeUrl.isSafe`
- `SafeUrl.validateSync`
- `SafeUrl.validateSyncWithConfig`
- `SafeUrl.validateSyncForSink`
- `SafeUrl.allowedSchemesForSink`
- `SafeUrl.UrlSink`
- `SafeUrl.SafeUrlConfig`
- `SafeUrl.defaultConfig`
- `SafeUrl.DEFAULT_ALLOWED_SCHEMES`
- `UnsafeUrlError`

## Troubleshooting

- A URL-bearing prop is absent from the DOM: its URL failed parsing or its scheme is not allowed for that sink. Check the Debug stream for the `safeUrl.blocked` event; widening configuration never overrides a sink's hard safety boundary.
- `SafeUrl.validate` reports a missing `SafeUrlConfig`: it requires the service in context. Provide `SafeUrl.SafeUrlConfig.layer` (defaults) or your own `Layer.succeed(SafeUrl.SafeUrlConfig, …)`, or use `SafeUrl.validateSync` when you cannot run inside an Effect.
- A custom scheme works in `SafeUrl.validate` but not in rendered attributes: the renderer reads the allowlist from render context. Provide the `SafeUrlConfig` Layer before the Mount boundary, not only inside the validating Effect.
