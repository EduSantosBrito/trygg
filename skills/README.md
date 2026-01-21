# effect-ui Agent Skills

Skills for LLM agents working with effect-ui. Follows the [skills.sh](https://skills.sh) format.

## Installation

```bash
npx skills add anomalyco/effect-ui
```

## Available Skills

| Skill | Description |
|-------|-------------|
| [effect-ui-core](./effect-ui-core/SKILL.md) | Components, Signals, fine-grained reactivity |
| [effect-ui-router](./effect-ui-router/SKILL.md) | File-based routing, navigation, guards |
| [effect-ui-testing](./effect-ui-testing/SKILL.md) | Testing with Effect Vitest |
| [effect-ui-observability](./effect-ui-observability/SKILL.md) | Debug events, tracing, metrics |

## Skill Format

Each skill follows the [skills.sh](https://skills.sh/docs) format:

```
skill-name/
├── SKILL.md          # Required: frontmatter + instructions
├── scripts/          # Optional: executable code
├── references/       # Optional: documentation loaded as needed
└── assets/           # Optional: files used in output
```

### SKILL.md Structure

```yaml
---
name: skill-name
description: What this skill does. Use when: (1) trigger condition, (2) another trigger...
---

# Skill Title

Instructions, examples, and reference material...
```

## Key Concepts

### Components are Effects

```tsx
const Counter = Effect.gen(function* () {
  const count = yield* Signal.make(0)
  return <button onClick={() => Signal.update(count, n => n + 1)}>Count: {count}</button>
})
```

### Fine-Grained Reactivity

- `Signal.make(initial)` - Creates signal (no subscription)
- `Signal.get(signal)` - Reads AND subscribes (triggers re-render)
- Pass signal directly to JSX for fine-grained DOM updates

### File-Based Routing

```
src/routes/
  index.tsx         -> /
  users/
    [id].tsx        -> /users/:id
    _layout.tsx     -> Layout wrapper
    _error.tsx      -> Error boundary
```

### Testing with Effect Vitest

```ts
import { it } from "@effect/vitest"

it.scoped("test name", () =>
  Effect.gen(function* () {
    const { getByTestId } = yield* render(Component)
    yield* click(getByTestId("button"))
    yield* waitFor(() => expect(...))
  })
)
```

## Framework Rules

1. **R must be never**: Components need `R = never`. Use `Component.provide` before JSX
2. **No type casting**: Use Option, pattern matching, or proper null checks
3. **Event handlers return Effects**: `onClick={() => Effect.log("clicked")}`
4. **Use Signal.get sparingly**: Only for conditional rendering that needs re-render

## Resources

- [Effect Documentation](https://effect.website)
- [skills.sh Documentation](https://skills.sh/docs)
