# Route Types

The type vocabulary that keeps paths, params, and navigation targets honest across the whole app, so a wrong path or a missing param is a compile error instead of a runtime 404.

These are type-level utilities — you wire them into your own types and props, not call them at runtime.

```ts
import type { ExtractRouteParams, RouteParamsFor } from "trygg/router";

// Parse the `:param` segments of a path into a typed record.
type UserParams = ExtractRouteParams<"/users/:id">;
// { readonly id: string }

// RouteParamsFor prefers a generated RouteMap entry, then falls back to ExtractRouteParams.
type EditParams = RouteParamsFor<"/posts/:postId/edit">;
// { readonly postId: string }

const params: UserParams = { id: "123" };
// const bad: UserParams = {};  // compile error: `id` is missing
```

## When to use

Reach for these types when you write something path-aware and want the path/param contract checked at compile time:

- Typing a helper that takes a route path and its params (`RouteParamsFor<Path>` derives the param record from the path string).
- Reading the param shape `Router.params(path)` returns for a given pattern.
- Constraining a prop to a real route with `RoutePath` and getting editor autocomplete for known paths.

You usually do not import these directly for normal navigation. `Link` already applies them — it requires `params` only when the path has dynamic segments, typed against the pattern. `Router.navigate` is looser: its `path` is a plain `string` and `options.params` is an untyped `Record<string, string | number>`, so it does no path/param checking. Reach for the raw types when you build your own path-aware utility.

## Behavior

`RouteMap` is an empty interface that the Vite plugin augments via `declare module "trygg/router"` in a generated `routes.d.ts`. Each entry maps a concrete path to its param record:

```ts
declare module "trygg/router" {
  interface RouteMap {
    "/": {};
    "/users/:id": { readonly id: string };
  }
}
```

Once augmented, the types tighten:

- `RoutePath` is `keyof RouteMap | (string & Record<never, never>)`. The union gives autocomplete for known paths while still accepting arbitrary strings, so code keeps type-checking before a route map has been generated.
- `RouteParamsFor<Path>` returns `RouteMap[Path]` when the path is a known key, otherwise it parses the literal with `ExtractRouteParams`. With a generated map you get the exact declared param record; without one you get the segments inferred from `:param` syntax.
- `TypeSafeLinkProps<Path>` makes `params` required when `RouteParamsFor<Path>` has keys and `params?: never` when the path is static — the same conditional that shapes `LinkProps`.

Sharp edges:

- `ExtractRouteParams` types every param as `string`. It reflects the URL segment, not a decoded value — refine with route schemas if you need numbers or branded ids.
- The fallback path inference only sees the literal you pass. A widened `string` collapses `RouteParamsFor<string>` to the empty record, so keep path arguments as string literals (or constrained generics) to preserve the param contract.
- Wildcard markers are stripped from names: `ExtractRouteParams<"/files/:path*">` yields `{ readonly path: string }`.

`buildPathWithParams` is the one runtime export here: a typed interpolator returning an `Effect` that fails with the path-pattern errors (`MissingRoutePathParam`, `UnusedRoutePathParam`, and friends) when params and pattern disagree.

## Related exports

- `RouteMap` — generated interface mapping each path to its params
- `RoutePath` — union of declared paths plus arbitrary strings for autocomplete
- `RouteParamsFor` — param record from a path, preferring the generated map
- `ExtractRouteParams` — parses `:param` segments into a typed record
- `TypeSafeLinkProps` — makes `params` required only for dynamic paths
- `buildPathWithParams` — runtime interpolator failing on param/pattern mismatch
- `NavigateOptions`
- `RouterService`

## Troubleshooting

- Symptom: `RouteParamsFor<Path>` resolves to `{}` for a path you know has params. Cause: `Path` widened to `string` (e.g. a non-`as const` variable). Fix: keep the path a string literal or constrain the generic with `<Path extends string>`.
- Symptom: `Link` reports `params` is missing on a static path, or rejects valid params. Cause: a stale or absent generated `routes.d.ts`, so `RouteMap` lacks that path. Fix: regenerate routes via the Vite plugin so the augmentation matches your route tree.
- Symptom: a param value is a `number` at the source but the type insists on `string`. Cause: `ExtractRouteParams` always yields `string`. Fix: decode through a route schema rather than expecting the raw param record to carry refined types.