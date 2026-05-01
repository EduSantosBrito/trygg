![trygg: Effect-native UI](.github/assets/readme-header.png)

# trygg

[![PR Check](https://github.com/EduSantosBrito/trygg/actions/workflows/pr.yml/badge.svg)](https://github.com/EduSantosBrito/trygg/actions/workflows/pr.yml)
[![npm](https://img.shields.io/npm/v/trygg)](https://www.npmjs.com/package/trygg)
[![License](https://img.shields.io/npm/l/trygg)](LICENSE)
[![Discord](https://img.shields.io/badge/discord-join-5865F2?logo=discord&logoColor=white)](https://discord.gg/BRDc7xGb5D)

**Type-safe UI, from the ground up.**

An [Effect](https://effect.website)-native UI framework with JSX, fine-grained DOM updates, and dependency injection built into the component model. _trygg_ is Norwegian for "safe" / "secure."

> [!CAUTION]
> Pre-release software. APIs may change before the first stable release.

**Using trygg?** See [`packages/core/README.md`](packages/core/README.md) for installation, API reference, and usage guide.

## Quick Start

Current releases are canary-only while the API settles.

```bash
bunx create-trygg@canary my-app
cd my-app
bun install
bun run dev
```

```tsx
// Components are Effects. Services are yielded. Layers are provided.
const Greeting = Component.gen(function* () {
  const theme = yield* Theme
  const name = yield* Signal.make("world")
  return <h1 style={{ color: theme.primary }}>Hello, {name}!</h1>
}).provide(themeLayer)
```

## Features

- **Effect-native components**: services and failures are visible at compile time
- **Fine-grained reactivity**: signals update DOM nodes directly, with no virtual DOM dependency
- **Dependency injection**: layers make app dependencies explicit from component to mount boundary
- **Type-safe JSX**: component props, errors, and requirements stay tracked by TypeScript
- **Testable by design**: swap services with mock layers for predictable component behavior
- **Integrated UI stack**: JSX runtime, renderer, and router built for Effect

## Why trygg?

- Use Effect as the component runtime, not just an app service layer.
- Keep UI dependencies explicit without globals or context-only plumbing.
- Build reactive interfaces with typed services, typed failures, and direct DOM updates.

## Packages

| Package | Role | Install |
|---------|------|---------|
| [`trygg`](packages/core) | Core framework: components, signals, renderer, router | `bun add trygg@canary` |
| [`create-trygg`](packages/cli) | Project scaffolder | `bunx create-trygg@canary my-app` |

## Development

**Prerequisites:** [Node.js](https://nodejs.org) or [Bun](https://bun.sh)

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

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) for development setup, PR process, and code standards.

## Community

- [Discord](https://discord.gg/BRDc7xGb5D) for questions, discussion, and support
- [Issues](https://github.com/EduSantosBrito/trygg/issues) for bugs and tracked work
- [Code of Conduct](CODE_OF_CONDUCT.md) for community expectations

## License

[MIT](LICENSE)
