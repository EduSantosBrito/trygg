# effect-ui

An Effect-native UI framework with JSX support.

## Project Overview

- **Goal**: Composable UI using Effect with clear side-effect tracking
- **No external frameworks**: Only Effect ecosystem
- **JSX**: Custom runtime in `src/jsx-runtime.ts`
- **State**: Uses `Signal` (built on SubscriptionRef) for reactive state
- **Testing**: Components testable via Layers

## Key Files

- `DESIGN.md` - Full architecture and design decisions
- `PLAN.md` - Implementation status and next steps
- `src/Element.ts` - Virtual DOM types
- `src/jsx-runtime.ts` - JSX transformation
- `src/Renderer.ts` - DOM rendering service + mount()
- `src/Signal.ts` - Reactive state primitive
- `src/Component.ts` - Component.gen API with auto layer inference
- `src/vite-plugin.ts` - Vite plugin for JSX config

<!-- effect-solutions:start -->
## Effect Best Practices

**IMPORTANT:** Always consult effect-solutions before writing Effect code.

1. Run `effect-solutions list` to see available guides
2. Run `effect-solutions show <topic>...` for relevant patterns (supports multiple topics)

Topics: quick-start, project-setup, tsconfig, basics, services-and-layers, data-modeling, error-handling, config, testing, cli.

Never guess at Effect patterns - check the guide first.
<!-- effect-solutions:end -->

## Code Rules

- **No type casting**: Never use `as` type assertions or `!` non-null assertions. Design types properly instead. Use Option, pattern matching, or proper null checks.
- **R = never constraint**: Component effects must have `R = never`. Use `Effect.provide` before JSX.
- **No Provider component**: Use `Effect.provide(component, layer)` directly.
- **yield* for composition**: Use `yield*` to sequence effects, not JSX embedding.
- **No backward compatibility**: This is a new framework. APIs can change freely to achieve the ideal design.
- **Fix all LSP errors**: LSP messages, warnings, and errors should always be fixed immediately.

## Reference Code

- **`./effect/`** - Local clone of Effect repo for reference only. DO NOT modify files in this directory.

## Architecture Decisions

### Simple Entrypoint with mount()

```tsx
import { Effect } from "effect"
import { mount, Signal } from "effect-ui"

const App = Effect.gen(function* () {
  const count = yield* Signal.make(0)
  return (
    <button onClick={() => Signal.update(count, n => n + 1)}>
      Count: {count}
    </button>
  )
})

// Simple - mount handles runMain, scoped, browserLayer
mount(document.getElementById("root")!, App)

// With custom layers
mount(container, App.pipe(Effect.provide(ThemeLayer)))
```

### Components are Effects with R = never

```tsx
// Component with requirements
const Button = Effect.gen(function* () {
  const theme = yield* Theme
  return <button style={{ color: theme.primary }}>Click</button>
})

// Must provide before using in mount
const App = Effect.provide(
  Effect.gen(function* () {
    const btn = yield* Button
    return <div>{btn}</div>
  }),
  ThemeLayer
)

mount(container, App)
```

### Signal API for Reactive State

```tsx
const Counter = Effect.gen(function* () {
  // Signal.make returns a Signal object (does NOT subscribe component)
  const count = yield* Signal.make(0)
  
  // Pass Signal directly to JSX - fine-grained updates!
  // Event handlers use Signal.set/update
  return (
    <button onClick={() => Signal.update(count, n => n + 1)}>
      Count: {count}
    </button>
  )
})
// Component runs ONCE. Only the text node updates when count changes.
```

### Fine-Grained Reactivity

```tsx
// Fine-grained (NO re-render): Pass signal directly to JSX
const email = yield* Signal.make("")
return <input value={email} />  // Updates input.value directly

// Triggers re-render: Read signal with Signal.get()
const items = yield* Signal.get(itemsSignal)  // Subscribes component
return items.map(item => <li>{item}</li>)  // Re-renders when items change
```

### Event Handlers Return Effects

```tsx
<button onClick={(e) => Effect.log("clicked")}>Click</button>
```

Event handlers are typed `(event: Event) => Effect<void, E, never>` and run via `Runtime.runFork`.

### Component.gen API for Typed Props

```tsx
import { Context, Effect, Layer } from "effect"
import { Component, mount } from "effect-ui"

class Theme extends Context.Tag("Theme")<Theme, { primary: string }>() {}

// With typed props - use curried syntax for full type inference
const Card = Component.gen<{ title: string }>()(Props => function* () {
  const { title } = yield* Props
  const theme = yield* Theme
  return <div style={{ color: theme.primary }}>{title}</div>
})

// Without props - just pass the generator directly
const ThemedCard = Component.gen(function* () {
  const theme = yield* Theme
  return <div>{theme.name}</div>
})

// TypeScript infers: { title: string, theme: Layer<Theme> }
const themeLayer = Layer.succeed(Theme, { primary: "blue" })
mount(container, <Card title="Hello" theme={themeLayer} />)
```

Service requirements automatically become layer props (e.g., `theme: Layer<Theme>`).

## Running Examples

```bash
bun run examples:install  # First time only
bun run examples          # Start Vite dev server at http://localhost:5173
```

## Working Approach

1. Check `PLAN.md` for current status and next steps
2. Check `DESIGN.md` for architecture decisions
3. Run `bun run typecheck` frequently
4. Run `bun run test` to verify changes
5. When context overflows, update PLAN.md with progress

## Key Implementation Details

### Why mount() uses Effect.never
The `render()` function uses `Effect.never` internally to keep the scope open. Without this, `Effect.scoped` would close immediately after mounting, triggering cleanup finalizers that remove the DOM content.

### Signal Subscriptions
Uses sync callbacks (`Signal._listeners`) instead of Stream-based subscriptions. Sync callbacks fire immediately when values change, then schedule re-renders via `queueMicrotask`. This is more reliable than Stream in both browser and test environments.
