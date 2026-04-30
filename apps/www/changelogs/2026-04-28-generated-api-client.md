---
title: Generated API Client and Cloudflare Static SPA
version: "trygg@0.4.0-canary.0"
---

## Summary

This canary generates a typed same-origin API client from `app/api.ts` and adds an explicit Cloudflare Static SPA build target. It also moves URL safety configuration into Effect context so custom schemes stay fiber-scoped instead of process-global.

```ts
import { Effect } from "effect";
import { Resource } from "trygg";
import { ApiClient, ApiClientLive } from "trygg/api";

const incidents = Resource.make(
  () =>
    Effect.gen(function* () {
      const client = yield* ApiClient;
      return yield* client.incidents.list();
    }),
  { key: "incidents.list" },
).provide(ApiClientLive);
```

## Added

- `trygg/api` now provides generated `ApiClient`, `ApiClientLive`, and `Api` exports for apps that define `export const Api` in `app/api.ts`; see the [API guide](../../../packages/core/src/api/api.docs.md).
- `create-trygg` now writes `.trygg/api.d.ts` for API-backed templates so scaffolded apps typecheck generated `trygg/api` imports immediately.
- `trygg/config` now accepts `platform: "cloudflare"` with `output: "static"`, generating a public `dist/index.html` plus `.trygg/worker-entry.js` for Cloudflare `ASSETS` fallback; see the [config docs](../../../packages/core/src/config.docs.md).
- `SafeUrl.SafeUrlConfig`, `SafeUrl.defaultConfig`, and `SafeUrl.validateSyncWithConfig` now support scoped URL scheme allowlists for Effect code and synchronous renderer paths.

## Changed

- The incident template now uses the generated `ApiClient` service instead of handwritten client typing.
- The blank template now starts without `app/api.ts`, keeping no-API apps free of generated client declarations until an API is added.
- Breaking: `SafeUrl.validate`, `SafeUrl.validateOption`, and `SafeUrl.isSafe` now require `SafeUrlConfig`; provide `SafeUrl.SafeUrlConfig.layer` or a custom `SafeUrlConfig` layer when calling them directly.

## Removed

- Breaking: `SafeUrl.allowSchemes`, `SafeUrl.getConfig`, and `SafeUrl.resetConfig` were removed. Use `SafeUrl.SafeUrlConfig` for Effect-scoped validation or `SafeUrl.validateSyncWithConfig` for explicit synchronous validation.

## Fixed

- `trygg/api` imports now fail with a clear error when `app/api.ts` does not export `Api`.
- Dev API reloads now coalesce rapid `app/api.ts` changes and preserve follow-up reloads after a failed reload.
- Server builds and static API warnings now use the plugin-owned generated file paths consistently.
- Cloudflare Static SPA builds now reject `app/api.ts` instead of silently omitting API routes, and Cloudflare server output now fails with explicit unsupported-output guidance.
- Cloudflare Static SPA routing now asks `ASSETS` first, preserves generated asset `404`s, and falls back only `GET`/`HEAD` document requests to `/index.html`.

## Versions

- `trygg@0.4.0-canary.0` includes changes since `trygg@0.3.0-canary.0`.
