---
name: effect-ui
description: Effect-native UI framework with JSX support and fine-grained reactivity. Use this skill to discover which specialized skill to load for components, routing, testing, or observability tasks.
license: MIT
metadata:
  author: effect-ui
  version: "1.0"
---

# effect-ui

Effect-native UI framework. This is the entry point skill — use it to find the right specialized skill for your task.

## When to Use Which Skill

| Task | Load This Skill |
|------|-----------------|
| Creating components, using Signals, dependency injection | [effect-ui-core](skills/effect-ui-core/SKILL.md) |
| File-based routing, navigation, guards, outlets | [effect-ui-router](skills/effect-ui-router/SKILL.md) |
| Writing tests, using test utilities | [effect-ui-testing](skills/effect-ui-testing/SKILL.md) |
| Debug events, metrics, DevMode | [effect-ui-observability](skills/effect-ui-observability/SKILL.md) |

## Key Concepts

1. **Use Component.gen** — Components use `Component.gen(function* (Props) { ... })` returning JSX, not `Effect.gen`
2. **R must be never** — Components must satisfy all dependencies before rendering. Use layer props for DI.
3. **Fine-grained reactivity** — Pass Signals directly to JSX for automatic updates without re-renders
4. **Signal.make vs Signal.get** — `make` creates (no subscription), `get` reads AND subscribes (triggers re-render)

## Quick Commands

| Command | Purpose |
|---------|---------|
| `bun run typecheck` | Type check |
| `bun run test` | Run tests |
| `bun run examples` | Dev server at localhost:5173 |

## Documentation

| Topic | File |
|-------|------|
| Architecture & Patterns | [docs/design.md](docs/design.md) |
| Router | [docs/router.md](docs/router.md) |
| Observability | [docs/observability.md](docs/observability.md) |
| Implementation Status | [docs/plan.md](docs/plan.md) |

## Getting Started

1. For component work: Load [effect-ui-core](skills/effect-ui-core/SKILL.md)
2. For routing work: Load [effect-ui-router](skills/effect-ui-router/SKILL.md)
3. For testing: Load [effect-ui-testing](skills/effect-ui-testing/SKILL.md)
4. For debugging: Load [effect-ui-observability](skills/effect-ui-observability/SKILL.md)
