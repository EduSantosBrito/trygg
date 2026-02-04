# trygg

[![PR Check](https://github.com/EduSantosBrito/trygg/actions/workflows/pr.yml/badge.svg)](https://github.com/EduSantosBrito/trygg/actions/workflows/pr.yml)
[![npm](https://img.shields.io/npm/v/trygg)](https://www.npmjs.com/package/trygg)
[![Bundle Size](https://img.shields.io/bundlephobia/minzip/trygg)](https://bundlephobia.com/package/trygg)
![License: MIT](https://img.shields.io/badge/license-MIT-blue)

**Type-safe UI, from the ground up.**

An [Effect](https://effect.website)-native UI framework with JSX, fine-grained reactivity, and dependency injection built in — not bolted on. _trygg_ is Norwegian for "safe" / "secure."

> [!CAUTION]
> Pre-release software. Breaking changes are expected and welcomed when they improve the design.

**Using trygg?** See [`packages/core/README.md`](packages/core/README.md) for installation, API reference, and usage guide.

```tsx
// Components are Effects. Services are yielded. Layers are provided.
const Greeting = Component.gen(function* () {
  const theme = yield* Theme
  const name = yield* Signal.make("world")
  return <h1 style={{ color: theme.primary }}>Hello, {name}!</h1>
}).provide(themeLayer)
```

## Features

- **Effect-Native** — Components are Effects, side effects are explicit and type-tracked
- **Fine-Grained Reactivity** — Signals built on `SubscriptionRef`; DOM nodes update surgically, no VDOM diffing
- **Type-Safe** — Full TypeScript support, errors tracked at type level
- **Dependency Injection** — Services yielded in children, layers provided by parents; `R = never` at mount boundary
- **Testable** — Swap services with mock layers, predictable component behavior
- **No React Dependency** — Custom JSX runtime

## Packages

| Package | Description | npm |
|---------|-------------|-----|
| [`trygg`](packages/core) | Core framework — components, signals, renderer, router | [![npm](https://img.shields.io/npm/v/trygg)](https://www.npmjs.com/package/trygg) |
| [`create-trygg`](packages/cli) | Project scaffolding CLI (`bunx create-trygg my-app`) | [![npm](https://img.shields.io/npm/v/create-trygg)](https://www.npmjs.com/package/create-trygg) |

## Development

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

## Agent Skills

Install trygg skills for AI coding assistants:

```bash
npx skills add EduSantosBrito/trygg
```

| Skill | Use When |
|-------|----------|
| `use-trygg` | Writing components, signals, services, events, testing |
| `trygg-router` | Routes, params, middleware, layouts, prefetching, navigation |
| `trygg-architecture` | Debugging internals, renderer, element variants, design decisions |
| `trygg-observability` | Debug events, metrics, traces, DevMode, LLM test server |

## License

[MIT](LICENSE)
