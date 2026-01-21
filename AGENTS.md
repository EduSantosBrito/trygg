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
- **R = never at the top**: Components may require services, but the top-level effect passed to mount must have `R = never`. Use `Component.provide` on parent effects.
- **effect-solutions**: Run `effect-solutions show <topic>` before writing Effect code.
- **./effect/ is read-only**: Cloned Effect repo for reference. Never modify files in this directory.
- **Fix all LSP issues**: Resolve all LSP errors, warnings, and messages immediately.
- **Breaking changes OK**: No users yet. Prefer better APIs over backward compatibility.

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
| Implementation Status | [docs/plan.md](docs/plan.md) |
