# API Naming

## Core Rules

- Prefer Effect v4 naming. Use `effect-glossary` skill as the primary reference
- Public domains should be PascalCase nouns and usually exported as namespace owners: `Signal`, `Resource`, `Route`, `Routes`, `Renderer`.
- Public operations should be lowerCamelCase and use Effect's common verb set: `make`, `empty`, `fromX`, `toX`, `isX`, `getX`, `map`, `flatMap`, `match`, `withX`, `provideX`, `runX`.
- Prefer namespace ownership over flat root exports. If an API belongs to `Route`, expose `Route.make`, not `routeMake`.
- Prefer `make` over `createX` for constructors and factories unless an external standard forces another name.
- Prefer small compositional names over descriptive sentence names. Avoid names like `buildPathWithParams` when a tighter owner + verb can express it.
- Use `isX` for public refinements and predicates.
- Use `fromX` / `toX` for public conversions.
- Use explicit variant suffixes when the variant meaning is real: `fooSync`, `fooEffect`, `fooOption`, `fooEither`, `fooScoped`, `fooWith`.
- Unsafe public APIs must be clearly marked `unsafeX`. Do not hide unsafe behavior behind neutral names.

## Public Shape

- Root exports should stay small and owner-oriented.
- Prefer `export * as X from "..."` for major domains.
- Avoid collision-driven public aliases like `routeMake`, `routesMake`, `routeProvide`.
- If two APIs collide, fix the ownership model first, not the exported name.

## Type Naming

- Types, services, classes, and tagged errors use PascalCase nouns: `RenderContext`, `RendererService`, `NavigationError`.
- Boolean or state variants should still read as domain nouns, not UI slang.
- Error names should be specific domain nouns ending in `Error` unless matching a stronger existing Effect convention.

## Trygg-Specific Guidance

- Existing owner namespaces like `Signal`, `Resource`, `Route`, and `Routes` are the right direction. Prefer adding APIs under them instead of adding more root functions.
- Router APIs should look like Effect module APIs: `Route.make`, `Route.redirect`, `Routes.make`.
- New public helpers should default to Effect vocabulary before introducing new verbs.
- Do not introduce React-style `useX` names for core runtime APIs.
- Keep JSX/runtime compatibility exports only where the platform requires them; do not use them as the naming model for the rest of the public API.

## Prefer / Avoid

- Prefer `make`, avoid `createX`.
- Prefer `Route.make`, avoid `routeMake`.
- Prefer `Routes.make`, avoid `routesMake`.
- Prefer `isSignal`, avoid `hasSignalShape`.
- Prefer `fromUrl`, `toUrl`, avoid `convertUrl`.
- Prefer `unsafeParse`, avoid `parse` when the API can throw or skip validation.
