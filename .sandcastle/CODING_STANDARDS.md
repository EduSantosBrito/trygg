# Coding Standards

<!-- Enforced by the reviewer agent during code review.
     Source of truth: AGENTS.md, docs/agents/*.md, CONTRIBUTING.md, UBIQUITOUS_LANGUAGE.md -->

## Style

### Type Safety

- **No `any`** — ever.
- **No `!`** — non-null assertion operator forbidden.
- **No `as Type`** — type assertions forbidden.
- Use `Option`, pattern matching, or proper null checks.
- Make illegal states unrepresentable: prefer ADTs/discriminated unions.
- Parse inputs at boundaries into typed structures.
- All interface and tuple properties use `readonly`.

### Naming

- Namespace owners use PascalCase: `Signal`, `Resource`, `Route`, `Routes`, `Debug`, `Renderer`.
- Public operations use camelCase with Effect vocabulary: `make`, `get`, `set`, `update`, `isX`, `fromX`, `toX`.
- Prefer `make` over `createX` for constructors/factories.
- Prefer namespace ownership: `Route.make`, not `routeMake`.
- Unsafe APIs must be prefixed `unsafeX`.
- Errors are PascalCase nouns ending in `Error`: `InvalidComponentError`, `NavigationError`.
- Use `Data.TaggedError` or `Schema.TaggedError` for domain errors.
- Do not introduce React-style `useX` names for core runtime APIs.

### Exports

- Root exports stay small and owner-oriented.
- Prefer `export * as X from "..."` for major domains.
- Avoid collision-driven public aliases.

### Documentation

- Every public export must have `@public` or `@internal` tag, plus `@remarks`.
- Module files open with a `@module` doc block describing ownership.
- Source-owned `*.docs.md` sidecar guides for major topics.
- TSDoc on exports describes purpose, not implementation.

### Effect-Specific

- Prefer Effect v4 APIs (`effect@4.0.0-beta.51`).
- Use `effect-glossary` skill as the primary Effect reference — bundled docs over `node_modules`.
- Stable imports: `import { X } from "effect"`.
- Testing imports: `import { X } from "effect/testing"`.
- Unstable imports: `import { X } from "effect/unstable/..."` (usable but beta-volatile).
- `Effect.fn("Module.method")` for traced named functions.
- Services: `Context.Service` with `Layer`; `Layer.scoped` for resource-owning services.
- Resources: `Effect.acquireRelease` or `Layer.scoped` for lifecycle management.
- Concurrency: `Effect.all` / `Effect.forEach` with `{ concurrency }`.
- No floating `Effect.runFork` — hold fibers in `Scope`.
- If code can fail, return an `Effect`; do not throw from synchronous helpers.

### Observability

- Follow the wide-event model: structured events, never free-form strings.
- Event names follow `domain.phase` pattern: `signal.create`, `router.navigate.complete`.
- Include enough fields to explain the operation in one record.
- `Debug.log` is the main entry point; emits through `DebugEvent` union.
- `DevMode` enables debug logging without rendering UI.

## Testing

### Location & Naming

- Tests co-located in `__tests__/` subdirectories alongside source.
- File naming: `*.test.ts` for pure TS, `*.test.tsx` for tests using JSX.

### Framework & Style

- Use `@effect/vitest`: `import { describe, it, assert } from "@effect/vitest"`.
- `it.effect` for tests returning an `Effect`.
- `scoped` helper (from `testing/effect-vitest.ts`) wraps `Effect.scoped` for tests needing `Scope`.
- All test helpers return `Effect`s.
- Use `TestClock` for time-based tests, never `Effect.sleep`.

### Test Structure

Every test includes these 3 parts in code or adjacent comments:
- **Test**: `should X do <not> Y while Z`
- **Scope**: why this case matters and what boundary it covers
- **Assertion**: the acceptance criteria and expected observable outcome

### Golden Rule

A test must fail if, and only if, the intended behavior is broken. Assert outcomes and externally visible behavior, not implementation details.

### Required Coverage

- Both success and failure paths.
- Boundary values: empty, zero, one, negative, max, `undefined` where relevant.
- For resourceful/concurrent code: interruption, cleanup, failure paths.
- For parser-like code: malformed input coverage.
- No test should leak resources.

## Architecture

### Component Model

- Components use `Component.gen(function* () { ... })`.
- Children yield services (`yield* SomeService`); parents provide layers (`.provide(layer)`).
- Top-level component passed to mount must have `R = never` (all services provided).
- Event handlers are effect thunks: `() => Effect.Effect<void>`.
- A Component produces an Element tree.

### Services & Dependency Injection

- Dependencies are `Context.Service` classes.
- Providers are `Layer` compositions.
- Use `Layer.scoped` for services that own resources.
- A Layer satisfies Service requirements before or at the Mount boundary.

### Signals

- `Signal.make` for component-local or scoped state.
- `Signal.makeSync` for module-lifetime state backing stable services.
- Pass signals directly to JSX for fine-grained DOM updates.
- Call `Signal.get` when a component must re-run on changes.

### Design Principles

- Keep abstractions constrained. Extract only when reuse or clarity clearly improves.
- Search existing repo utilities and Effect APIs before adding new helpers.
- Make minimal, surgical changes. Do not refactor unrelated code.
- Breaking changes are acceptable when they improve the API.
- Fight entropy. Leave the codebase better than you found it.
