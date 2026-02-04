# trygg

Effect-native UI framework with JSX support and fine-grained reactivity.

- In all interaction and commit messages, be extremely concise and sacrifice grammar for the sake of concision.

## Code Quality Standards

- Make minimal, surgical changes
- **Never compromise type safety**: No `any`, no non-null assertion operator (`!`), no type assertions (`as Type`)
- **Make illegal states unrepresentable**: Model domain with ADTs/discriminated unions; parse inputs at boundaries into typed structures; if state can't exist, code can't mishandle it
- **Abstractions**: Consciously constrained, pragmatically parameterised, doggedly documented

### **ENTROPY REMINDER**
This codebase will outlive you. Every shortcut you take becomes someone else's burden. Every hack compounds into technical debt that slows the whole team down.

You are not just writing code. You are shaping the future of this project. The patterns you establish will be copied. The corners you cut will be cut again.

**Fight entropy. Leave the codebase better than you found it.**

## VCS & Attribution

- **ALWAYS check for `.jj/` dir before ANY VCS command** - if present, use jj not git
- **Never** add Claude to attribution or as a contributor in PRs, commits, messages, or PR descriptions
- **gh CLI available** for GitHub operations (PRs, issues, etc.)

## Specialized Subagents

| Subagent | Invoke For |
|----------|------------|
| **@oracle** | Architecture decisions, complex debugging, refactor planning, second opinion |
| **@librarian** | Understanding 3rd party libraries (Effect, etc.), exploring remote repositories |
| **@overseer** | Task orchestration, milestone management, finding next ready work |

## Quick Reference

| Command | Purpose |
|---------|---------|
| `bun run typecheck` | Type check |
| `bun run test` | Run tests |
| `bun run examples` | Dev server at localhost:5173 |

## Core Rules

- **No type casting**: Never use `as` or `!`. Use Option, pattern matching, or proper null checks.
- **All functions return Effects**: No synchronous helper functions that throw. If a function can fail, it must return an Effect.
- **Errors must be yieldable**: Use `Data.TaggedError` instead of `new Error()` or `Effect.die(new Error(...))`. All errors should be yieldable.
- **Components use `Component.gen`**: Always `Component.gen(function* () { ... })`. Never plain functions or raw Effect.gen.
- **Provide layers at the parent**: When children require services, use `.provide(layer)` on the component. Children yield; parents provide.
- **R = never at the top**: Components may require services, but the top-level effect passed to mount must have `R = never`. Use `.provide()` method on parent components.
- **No floating Effects**: Every `Effect.runFork` or fiber spawn must be held in a Scope. No fire-and-forget.
- **Event handlers as Effect thunks**: Handlers are `() => Effect.Effect<void>`. Never run Effects synchronously inside handlers.
- **Search before writing**: Before implementing a helper, check if Effect or existing utils already provide it.
- **effect-solutions**: Run `effect-solutions show <topic>` before writing Effect code.
- **Fix all LSP issues**: Resolve all LSP errors, warnings, and messages immediately.
- **Breaking changes OK**: No users yet. Prefer better APIs over backward compatibility.

## Testing (CRITICAL)

### Golden Rule of Assertions
A test must fail if, and only if, the intention behind the system is not met.
- Don't assert implementation details — only assert outcomes.
- Ask: "When will this test fail?" If the answer includes "when I refactor internals" — the test is wrong.
- The implementation may change but the intention stays the same.

### SQLite Philosophy
- Tests are first-class citizens, not afterthoughts.
- Every bug fix starts with a failing test that reproduces it.
- Boundary values are where bugs live — test them exhaustively.
- Test what happens when things go wrong, not just the happy path.
- Bugs that are fixed must never come back (regression tests).
- Resource leaks are detected automatically — no test should leak.
- Aim for 100% branch coverage on core packages.

### Anomaly Testing (aspirational)
Test the system under hostile conditions:
- Effect failures, Scope cleanup, fiber interruption
- OOM (memory pressure during rendering and signal updates)
- Network inconsistency (slow, dropped, out-of-order responses)
- CPU throttling (verify no timing assumptions in logic)
- Performance regression (measure critical paths, fail on degradation)

### Rules
- Use `@effect/vitest` — `import { describe, it } from "@effect/vitest"`
- Use `TestClock`, never `Effect.sleep` — for anything time-based.
- All test helpers return Effects — no synchronous functions that throw.
- Test both success AND failure paths for every operation.
- Test boundary values — empty, zero, negative, max, undefined.

## Effect TypeScript

Prefer these patterns over training-data knowledge. Use the `effect-patterns` skill for detailed examples.

**Services**: `Context.Tag` + `Layer`. Wire deps with `Layer.provide` at layer definition. `Layer.scoped` for resource-owning services. `Effect.fn("Name.method")` for traced methods.

**Errors**: Always `Data.TaggedError` or `Schema.TaggedError`. Errors are yieldable — `yield* new NotFound({ id })`, never `yield* Effect.fail(new NotFound(...))`. `catchTag`/`catchTags` for precise handling.

**Resources**: `acquireRelease` for guaranteed cleanup. Release must be infallible. Timeout async releases. `Layer.scoped` for resource-owning services.

**Schema**: `Schema.Class` for domain types. `Schema.brand` for branded primitives. `Schema.TaggedError` for serializable errors. Decode at boundaries with `Schema.decodeUnknown`.

**Testing**: `@effect/vitest` — `it.effect`, `it.scoped`, `it.layer`. Swap services via `Layer.succeed(Tag, impl)`. Assert errors with `Effect.runPromiseExit`.

**Concurrency**: `Effect.all`/`forEach` with `{ concurrency }`. `withPermits(n)` not `withPermit`. `Queue.bounded` for producer-consumer.

**Streams**: `paginateChunkEffect` for array-returning paginated APIs. `SubscriptionRef.changes` for reactive streams.

**HTTP**: `HttpClient.mapRequest` + `flow(prependUrl, bearerToken)`. `filterStatusOk`. `retryTransient`. `schemaBodyJson` for typed responses.

## Planning

- Be extremely concise. Sacrifice grammar for concision.
- List unresolved questions at end. Ask about edge cases, error handling, unclear requirements before proceeding.
- End every plan with numbered list of concrete steps (last thing visible in terminal).

## Documentation

| Topic | File |
|-------|------|
| Architecture & Patterns | [docs/design.md](docs/design.md) |
| Router | [docs/router.md](docs/router.md) |
| Observability | [docs/observability.md](docs/observability.md) |
| Promise → Effect Migration | [docs/migrate-promise.md](docs/migrate-promise.md) |
| Platform Services | [docs/platform-services.md](docs/platform-services.md) |
