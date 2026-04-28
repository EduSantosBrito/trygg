---
title: Generated API Client
version: "trygg@0.4.0-canary.0"
---

## Summary

The Vite plugin now generates a typed same-origin API client from `app/api.ts` when the app exports `Api`.

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

## Changed

- The incident template now uses the generated `ApiClient` service instead of handwritten client typing.
- The blank template now starts without `app/api.ts`, keeping no-API apps free of generated client declarations until an API is added.

## Fixed

- `trygg/api` imports now fail with a clear error when `app/api.ts` does not export `Api`.
- Dev API reloads now coalesce rapid `app/api.ts` changes and preserve follow-up reloads after a failed reload.
- Server builds and static API warnings now use the plugin-owned generated file paths consistently.

## Versions

- `trygg@0.4.0-canary.0` includes the generated `trygg/api` Vite plugin changes since `trygg@0.3.0-canary.0`.
