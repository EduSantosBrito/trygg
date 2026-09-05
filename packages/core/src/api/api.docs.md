# API

Derive typed request, success, and error shapes straight from an Effect `HttpApi` definition, so components and Resources stay in sync with the server contract instead of restating it by hand.

```ts
import type { Handler } from "trygg/api";
import { HttpApiEndpoint } from "effect/unstable/httpapi";
import { Schema } from "effect";

// Illustrative: UserSchema, NotFoundError, and UserService are app-defined.
const endpoint = HttpApiEndpoint.get("getUser", "/api/users/:id", {
  params: { id: Schema.String },
  success: UserSchema,
  error: NotFoundError,
});

// request, the success value, and the failure channel are all inferred from `endpoint`.
const handler: Handler<typeof endpoint> = ({ params }) => UserService.findById(params.id);
```

## When to use

Reach for the `trygg/api` types when a route or handler module wants the exact decoded request, success, and error types from an Effect `HttpApi` endpoint or group without repeating the schema by hand.

- Use `Handler` to type a single endpoint's handler so a missing field or wrong return type fails in the type checker.
- Use `GroupHandlers` to type the whole handlers object for an `HttpApiGroup`, so a missing or misspelled endpoint name is a compile error.
- Use `Request`, `Success`, `Error`, `Path`, `UrlParams`, `Payload`, and `Headers` when a shared helper needs one slice of an endpoint's decoded shape.

These are type-level integration glue, not a runtime client. They carry no values and add nothing to the bundle. For the reactive fetching layer in a Component, reach for `Resource`; these types describe the contract that fetch is calling against.

## Behavior

### Handler

`Handler<E, R>` maps an `HttpApiEndpoint` to a function from its decoded request to an `Effect`. The request is `HttpApiEndpoint.Request<E>`, the success channel is the endpoint's success `Type`, and the error channel is the endpoint's error `Type`. `R` defaults to `never` and is the only configurable parameter, for handlers that yield Services.

### GroupHandlers

`GroupHandlers<G>` is the object whose keys are the endpoint names in an `HttpApiGroup` and whose values are the matching `Handler` for each. Because the key set is derived from the group, an extra, missing, or renamed handler does not type-check.

### Request slice types

Each slice type reads one part of the decoded endpoint. `Path`, `UrlParams`, `Payload`, and `Headers` resolve to `never` when the endpoint does not declare that field; `Request`, `Success`, and `Error` are always present:

- `Request<E>` — the full decoded request (path, query, payload, headers).
- `Success<E>` / `Error<E>` — the success and failure `Type`s.
- `Path<E>` — decoded path params, not raw URL segments.
- `UrlParams<E>` — decoded query-string shape.
- `Payload<E>` — decoded request body.
- `Headers<E>` — decoded headers, for typed auth or metadata.

### Type-only and namespace imports

The same symbols are reachable two ways: as type-only imports from the `trygg/api` entrypoint, or through the root `Api` namespace. The namespace form is a value re-export, so types are read as members.

```ts
import { Api } from "trygg";

const handler: Api.Handler<typeof endpoint> = ({ params }) => UserService.findById(params.id);
```

### Generated API client

When the Vite plugin is active and `app/api.ts` exports `const Api`, the `trygg/api` virtual module also surfaces runtime exports (`ApiClient`, `ApiClientLive`) generated from that definition. Those come from the plugin, not this module — the symbols documented here are the type surface.

## Related exports

- `Handler` — types one endpoint's handler from its decoded request
- `GroupHandlers` — types a whole `HttpApiGroup`'s handlers object
- `Request` — the full decoded request: path, query, payload, headers
- `Success` — the endpoint's success `Type`
- `Error` — the endpoint's failure `Type`
- `Path` — decoded path params, not raw URL segments
- `UrlParams` — decoded query-string shape
- `Payload` — decoded request body
- `Headers` — decoded headers, for typed auth or metadata

## Troubleshooting

- A slice type resolves to `never`: the endpoint does not declare that field. `Path`, `UrlParams`, `Payload`, and `Headers` return `never` when their schema is absent on the endpoint — add the schema to the endpoint definition or read a field the endpoint actually declares.
- `import { Handler } from "trygg/api"` errors at runtime or tree-shakes oddly: these are types, not values. Import them with `import type` so the reference is erased from the emitted bundle.
- `ApiClient` or `ApiClientLive` is missing from `trygg/api`: those runtime exports only exist when the Vite plugin is active and `app/api.ts` exports `const Api`. Without that export the plugin reports that `app/api.ts` must export `Api` for imports from `trygg/api`.
