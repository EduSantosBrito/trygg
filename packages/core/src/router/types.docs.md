# Route Types

The type vocabulary that keeps paths, params, and navigation targets honest across the whole app, so a wrong path or a missing param is a compile error instead of a runtime 404.

These are type-level utilities — you wire them into your own types and props, not call them at runtime.

```ts
import type { ExtractRouteParams, RouteParamsFor, RouteParamsInputFor } from "trygg/router";

// Parse the `:param` segments of a path into a typed record.
type UserParams = ExtractRouteParams<"/users/:id">;
// { readonly id: string }

// RouteParamsFor prefers a generated RouteMap entry, then falls back to ExtractRouteParams.
type EditParams = RouteParamsFor<"/posts/:postId/edit">;
// { readonly postId: string }

// URL construction uses a separate input map derived from Schema.Encoded.
type EditInputs = RouteParamsInputFor<"/posts/:postId/edit">;

const params: UserParams = { id: "123" };
// const bad: UserParams = {};  // compile error: `id` is missing
```

## When to use

Reach for these types when you write something path-aware and want the path/param contract checked at compile time:

- Typing decoded values returned by `Router.params(path)` with `RouteParamsFor<Path>`.
- Typing values supplied to `Link`, `Router.navigate`, `Router.isActive`, or a URL builder with `RouteParamsInputFor<Path>`.
- Reading the param shape `Router.params(path)` returns for a given pattern.
- Constraining a prop to a real route with `RoutePath` and getting editor autocomplete for known paths.

You usually do not import these directly for normal navigation. `Link`, `Router.navigate`, and `Router.isActive` already apply the encoded input maps and require `params` when a literal path has dynamic segments. Reach for the raw types when you build your own path-aware utility.

## Behavior

The Vite plugin augments four empty interfaces via `declare module "trygg/router"` in generated `routes.d.ts`. `RouteMap` and `RouteQueryMap` hold decoded `Schema.Type` values. `RouteInputMap` and `RouteQueryInputMap` hold encoded values accepted while constructing a URL:

```ts
declare module "trygg/router" {
  interface RouteMap {
    "/": {};
    "/users/:id": { readonly id: number };
  }
  interface RouteInputMap {
    "/": {};
    "/users/:id": { readonly id: string };
  }
}
```

Once augmented, the types tighten:

- `RoutePath` is `keyof RouteMap | (string & Record<never, never>)`. The union gives autocomplete for known paths while still accepting arbitrary strings, so code keeps type-checking before a route map has been generated.
- `RouteParamsFor<Path>` returns decoded values from `RouteMap`; `RouteParamsInputFor<Path>` returns encoded URL inputs from `RouteInputMap`.
- `RouteQueryFor<Path>` and `RouteQueryInputFor<Path>` provide the same split for query schemas.
- `TypeSafeLinkProps<Path>`, `NavigateOptions<Path>`, and `IsActiveOptions<Path>` use the input maps. A `DateFromString` param is a `Date` when read from `Router.params`, but a `string` when passed to `Link`, `Router.navigate`, or `Router.isActive`.

Sharp edges:

- Schema-less decoded params are strings; their construction inputs may also be numbers because interpolation handles both.
- The fallback path inference only sees the literal you pass. A widened `string` collapses `RouteParamsFor<string>` to the empty record, so keep path arguments as string literals (or constrained generics) to preserve the param contract.
- Wildcard markers are stripped from names: `ExtractRouteParams<"/files/:path*">` yields `{ readonly path: string }`.
- Encoded path fields must be required strings so the matched raw URL can be decoded by the same Schema. Arrays, optional path fields, and non-string encodings fail route codegen with `PluginParseError` instead of generating an unusable navigation type.
- Encoded query fields must be strings or optional `undefined`; URL construction omits undefined values.

`buildPathWithParams` is the one runtime export here: a typed interpolator returning an `Effect` that fails with the path-pattern errors (`MissingRoutePathParam`, `UnusedRoutePathParam`, and friends) when params and pattern disagree.

## Related exports

- `RouteMap` — generated interface mapping each path to its params
- `RouteInputMap` — encoded path inputs used by URL construction
- `RouteQueryMap` / `RouteQueryInputMap` — decoded and encoded query maps
- `RoutePath` — union of declared paths plus arbitrary strings for autocomplete
- `RouteParamsFor` — param record from a path, preferring the generated map
- `RouteParamsInputFor` — encoded param inputs for `Link` and navigation
- `RouteQueryFor` / `RouteQueryInputFor` — decoded and encoded query values
- `ExtractRouteParams` — parses `:param` segments into a typed record
- `TypeSafeLinkProps` — makes `params` required only for dynamic paths
- `buildPathWithParams` — runtime interpolator failing on param/pattern mismatch
- `RouteParamsPatternMismatch` — typed failure for requesting params from a pattern outside the active route chain
- `NavigateOptions`
- `RouterService`

## Troubleshooting

- Symptom: `RouteParamsFor<Path>` resolves to `{}` for a path you know has params. Cause: `Path` widened to `string` (e.g. a non-`as const` variable). Fix: keep the path a string literal or constrain the generic with `<Path extends string>`.
- Symptom: `Link` reports `params` is missing on a static path, or rejects valid params. Cause: a stale or absent generated `routes.d.ts`, so `RouteMap` lacks that path. Fix: regenerate routes via the Vite plugin so the augmentation matches your route tree.
- Symptom: a param value is a `number` at the source but the type insists on `string`. Cause: `ExtractRouteParams` always yields `string`. Fix: decode through a route schema rather than expecting the raw param record to carry refined types.
