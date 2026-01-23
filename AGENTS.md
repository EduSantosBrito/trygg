# effect-ui

Effect-native UI framework with JSX support and fine-grained reactivity.

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
- **Provide layers at the parent**: When children require services, wrap return JSX in `Effect.gen(function* () { return <jsx/> }).pipe(Component.provide(layer))`. Children yield; parents provide.
- **R = never at the top**: Components may require services, but the top-level effect passed to mount must have `R = never`. Use `Component.provide` on parent effects.
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
