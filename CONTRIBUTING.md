# Contributing to trygg

Pre-release software. Breaking changes welcomed when they improve the design.

## Development Setup

**Prerequisites:** [Bun](https://bun.sh) >= 1.x

```bash
git clone https://github.com/EduSantosBrito/trygg.git
cd trygg
bun install
bun run check          # lint + format + typecheck + effect:check
```

| Command | Purpose |
|---------|---------|
| `bun run check` | All checks (lint, format, typecheck, effect:check) |
| `bun run typecheck` | Type-check the workspace |
| `bun run test` | Run tests |
| `bun run build` | Build `packages/core` |
| `bun run examples` | Dev server at `localhost:5173` |
| `bun run lint` | Lint with oxlint |

## Pull Request Process

1. **Fork & branch** — Create feature branch from `main`
2. **Make changes** — Small, focused commits
3. **Run checks** — `bun run check && bun run test` must pass
4. **Open PR** — Clear title, describe what/why

PRs require:
- All CI checks passing
- No type errors (`bun run typecheck`)
- No lint errors (`bun run lint`)
- Tests for new functionality

## Code Standards

### Type Safety

- **No `any`** — Ever
- **No `!`** — Non-null assertion operator forbidden
- **No `as Type`** — Type assertions forbidden
- Use `Option`, pattern matching, or proper null checks

### Effect Patterns

- **Components use `Component.gen`** — Always `Component.gen(function* () { ... })`
- **Errors are yieldable** — Use `Data.TaggedError`, yield directly: `yield* new NotFound({ id })`
- **Provide layers at parent** — Children yield services, parents provide layers
- **R = never at mount** — Top-level component must have all services provided
- **No floating Effects** — Every fiber spawn held in a Scope

### Design Principles

- **Make illegal states unrepresentable** — Model domain with ADTs/discriminated unions
- **Minimal, surgical changes** — Don't refactor unrelated code
- **Fight entropy** — Leave codebase better than you found it

## Testing

### Philosophy

- Tests are first-class citizens
- Every bug fix starts with a failing test
- Test both success AND failure paths
- Test boundary values (empty, zero, negative, max)

### Rules

- Use `@effect/vitest` — `import { describe, it } from "@effect/vitest"`
- Use `TestClock` for time-based tests, never `Effect.sleep`
- All test helpers return Effects
- Swap services with mock layers for isolation

### Golden Rule

> A test must fail if, and only if, the intention behind the system is not met.

Don't assert implementation details — only outcomes.

## Questions?

Open an issue or start a discussion.
