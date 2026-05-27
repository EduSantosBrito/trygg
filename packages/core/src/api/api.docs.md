# API

## When to use

Use `trygg/api` when `app/api.ts` needs shared typing utilities for handlers, decoded requests, or schema-derived payload shapes.

When the Vite plugin is active and `app/api.ts` exports `Api`, `trygg/api` also becomes the import site for the generated `ApiClient` and `ApiClientLive`.

## Behavior

### Type utilities

These exports stay compile-time only. They project Effect HttpApi endpoint and group definitions into the request, success, error, and handler types your app code consumes.

### Generated API client

When `app/api.ts` exports `const Api`, the trygg Vite plugin generates a runtime module for `trygg/api` that re-exports:

- `ApiClient` - typed service tag for the API client
- `ApiClientLive` - layer that builds the client with `HttpApiClient.make(Api, { baseUrl: "" })`
- `Api` - the original API definition re-exported for convenience

The generated client uses same-origin `baseUrl: ""` by default. Provide `ApiClientLive` explicitly in consuming code rather than relying on hidden auto-provisioning:

```ts
import { ApiClient, ApiClientLive } from "trygg/api";

const UsersPage = Component.gen(function* () {
  const users = Resource.make(
    () =>
      Effect.gen(function* () {
        const client = yield* ApiClient;
        return yield* client.users.list();
      }),
    { key: "users.list" },
  );

  const state = yield* Resource.fetch(users);
  return <UserList state={state} />;
}).pipe(Component.provide(ApiClientLive));
```

### Required `export const Api`

The generated client depends on a single named export from `app/api.ts`:

```ts
// app/api.ts
export const Api = HttpApi.make("app").add(Group);

export default HttpApiBuilder.layer(Api).pipe(Layer.provide(HandlersLive));
```

If `trygg/api` is imported without a valid exported `Api`, the plugin will error with:

> app/api.ts must export Api for imports from trygg/api. Add `export const Api = ...` to app/api.ts.

### What's out of scope

Separate contract files and browser bundle optimization are intentionally out of scope for this feature. Contract and handler code live together in `app/api.ts`, and the generated client module is produced by the Vite plugin during dev/build rather than being pre-bundled.

## Related exports

- `Handler`
- `GroupHandlers`
- `Request`
- `Success`
- `Path`
