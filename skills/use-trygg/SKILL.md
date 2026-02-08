---
name: use-trygg
description: Build UI components with trygg, an Effect-native JSX framework with fine-grained reactivity. Use when writing trygg components with Component.gen, managing reactive state with Signal, providing services via .provide(layer), handling events as Effect thunks, rendering lists with Signal.each, fetching data with Resource, catching errors with ErrorBoundary, or testing components with @effect/vitest. Also use when configuring trygg's Vite plugin, debugging rendering issues, understanding fine-grained vs re-render reactivity, or structuring a trygg application with routing, head management, and portals.
license: MIT
metadata:
  author: EduSantosBrito
  version: "0.1.0-canary.1"
---

# trygg

Effect-native UI framework. JSX components via `Component.gen`, reactive state via `Signal`, DI via `.provide(layer)`.

## Decision Tree

Use this to determine the right pattern for your task:

```
What are you building?
|
+-- Component?
|   +-- Has props? -> Component.gen(function* (Props: ComponentProps<{...}>) { ... })
|   +-- No props?  -> Component.gen(function* () { ... })
|   +-- Needs services? -> yield* ServiceTag, parent calls .provide(layer)
|   See: references/component-api.md
|
+-- State management?
|   +-- Local state? -> yield* Signal.make(initial)
|   +-- Global/module-level? -> Signal.makeSync(initial)
|   +-- Computed value? -> yield* Signal.derive(source, fn)
|   +-- Multiple sources? -> yield* Signal.deriveAll([a, b], fn)
|   +-- Fine-grained DOM? -> Pass signal directly to JSX: {count}
|   +-- Full re-render? -> yield* Signal.get(signal) (subscribes component)
|   See: references/signals-api.md
|
+-- Event handling?
|   +-- Simple action? -> onClick={() => Signal.update(count, n => n + 1)}
|   +-- Multi-step? -> onClick={() => Effect.gen(function* () { ... })}
|   +-- Read DOM? -> Use Effect.sync to extract value, then flatMap
|   See: references/effect-patterns.md
|
+-- Data fetching?
|   +-- Static key? -> Resource.make(fetchFn, { key: "name" })
|   +-- Parameterized? -> Resource.make(fn, { key: p => Resource.hash("name", p) })
|   +-- Render states? -> Resource.match(state, { Pending, Success, Failure })
|   See: references/component-api.md
|
+-- List rendering?
|   +-- Always use Signal.each for lists -> Signal.each(signal, renderFn, { key: item => item.id })
|   +-- .map() works but loses stable per-item scopes -- prefer Signal.each
|   See: references/signals-api.md
|
+-- Error handling?
|   +-- Typed errors? -> ErrorBoundary.catch(Comp).on("Tag", Handler).catchAll(fn)
|   +-- Exhaustive? -> .on("A", A).on("B", B).exhaustive()
|   See: references/common-errors.md
|
+-- Testing?
|   +-- Render component? -> yield* testRender(<Comp />)  (auto-provides testLayer)
|   +-- Simulate click? -> yield* click(element)
|   +-- Assert async? -> yield* waitFor(() => expect(...))
|   See: references/effect-patterns.md
```

## Quick Start

Typical setup uses the Vite plugin -- no manual mount needed:

```tsx
// vite.config.ts
import { defineConfig } from "vite"
import { trygg } from "trygg/vite-plugin"

export default defineConfig({ plugins: [trygg()] })
```

```tsx
// app/pages/home.tsx
import { Component, Signal } from "trygg"

const HomePage = Component.gen(function* () {
  const count = yield* Signal.make(0)
  return (
    <button onClick={() => Signal.update(count, n => n + 1)}>
      Count: {count}
    </button>
  )
})

export default HomePage
```

The Vite plugin auto-generates the entry, handles `mountDocument`, routing, and code splitting.

## Core Rules

1. **Components use `Component.gen`** -- never plain functions or raw `Effect.gen`
2. **Event handlers are `() => Effect<void>` or plain `Effect<void>`** -- the renderer accepts both; never run Effects synchronously
3. **No type casts** -- no `as`, no `!`, use `Option` and pattern matching
4. **Errors are `Data.TaggedError`** -- never `new Error()` or `Effect.die`
5. **R = never at top** -- `mount()` requires no unresolved service requirements
6. **No floating Effects** -- every `Effect.runFork` held in a Scope
7. **Signal.make does not subscribe** -- only `Signal.get` subscribes to changes

## Global State Pattern (Recommended)

For global state, use service-wrapped signals with a stable layer:

```tsx
import { Context, Effect, Layer, Option } from "effect"
import { Signal } from "trygg"

type User = { id: string }

interface AuthService {
  readonly currentUser: Signal.Signal<Option.Option<User>>
  readonly setUser: (user: User) => Effect.Effect<void>
  readonly clearUser: Effect.Effect<void>
}

class Auth extends Context.Tag("Auth")<Auth, AuthService>() {}

const currentUser = Signal.makeSync<Option.Option<User>>(Option.none())

const AuthLive: AuthService = {
  currentUser,
  setUser: (user) => Signal.set(currentUser, Option.some(user)),
  clearUser: Signal.set(currentUser, Option.none()),
}

export const AuthLayer = Layer.succeed(Auth, AuthLive)
```

Why this pattern:
- `Signal.makeSync` creates one module-lifetime signal
- `Context.Tag` keeps components dependent on contract, not implementation
- `Layer.succeed` provides a stable service reference (no signal re-creation)

Anti-pattern (causes state loss):

```tsx
// Avoid for stateful services
const AuthLayer = Layer.effect(
  Auth,
  Effect.gen(function* () {
    const currentUser = yield* Signal.make<Option.Option<User>>(Option.none())
    return {
      currentUser,
      setUser: (user: User) => Signal.set(currentUser, Option.some(user)),
      clearUser: Signal.set(currentUser, Option.none()),
    }
  }),
)
```

The renderer rebuilds layers on each render (no cross-render memoization).
For stateful services, `Layer.effect`/`Layer.sync` will re-run and recreate signals.
Use `Signal.makeSync` + `Layer.succeed` instead.

## Component with Props and DI

```tsx
import { Context, Layer } from "effect"
import { Component, Signal, type ComponentProps } from "trygg"

class Theme extends Context.Tag("Theme")<Theme, { primary: string }>() {}

const Card = Component.gen(function* (Props: ComponentProps<{ title: string }>) {
  const { title } = yield* Props
  const theme = yield* Theme
  return <div style={{ color: theme.primary }}>{title}</div>
})

// Static provision
const App = Component.gen(function* () {
  return <Card title="Hello" />
}).provide(Layer.succeed(Theme, { primary: "blue" }))

// Dynamic provision: layer depends on component state
const ThemeSwitcher = Component.gen(function* () {
  const isDark = yield* Signal.make(false)
  const isDarkValue = yield* Signal.get(isDark)
  const currentTheme = isDarkValue ? DarkTheme : LightTheme
  const ProvidedCard = Card.provide(currentTheme)
  return <ProvidedCard title="Dynamic" />
})
```

## Fine-Grained vs Re-Render Reactivity

```tsx
// FINE-GRAINED (preferred): component runs once, only text node updates
const Fine = Component.gen(function* () {
  const count = yield* Signal.make(0)
  return <span>{count}</span>  // Signal passed directly -- no re-render
})

// RE-RENDER: component re-runs when signal changes
const Rerender = Component.gen(function* () {
  const count = yield* Signal.make(0)
  const value = yield* Signal.get(count)  // subscribes!
  return value > 10 ? <Big /> : <Small />
})

// DERIVED (fine-grained conditional): no re-render, DOM swaps
const Derived = Component.gen(function* () {
  const count = yield* Signal.make(0)
  const view = yield* Signal.derive(count, n => n > 10 ? <Big /> : <Small />)
  return <div>{view}</div>  // Signal<Element> -> SignalElement
})
```

## Event Handlers

```tsx
// Simple: return an Effect thunk
const increment = () => Signal.update(count, n => n + 1)

// Multi-step: use Effect.gen
const submit = () => Effect.gen(function* () {
  const text = (yield* Signal.get(inputValue)).trim()
  if (text === "") return
  yield* Signal.update(todos, list => [...list, { id: nextId, text }])
  yield* Signal.set(inputValue, "")
})

// Reading DOM values: Effect.sync to extract, then flatMap
const onInput = (e: Event) =>
  Effect.sync(() => {
    const target = e.target
    return target instanceof HTMLInputElement ? target.value : ""
  }).pipe(Effect.flatMap(v => Signal.set(inputValue, v)))
```

## Testing

```tsx
import { describe, it } from "@effect/vitest"
import { Effect } from "effect"
import { testRender, click, waitFor } from "trygg"

describe("Counter", () => {
  it.scoped("increments", () =>
    Effect.gen(function* () {
      const { getByText } = yield* testRender(<Counter />)
      yield* click(yield* getByText("0"))
      yield* waitFor(() => {
        const el = document.querySelector("button")
        expect(el?.textContent).toContain("1")
      })
    })
  )
})
```

## Reference Files

| File | When to Read |
|------|-------------|
| [component-api.md](references/component-api.md) | Creating components, props, DI, Resource, Portal, Head |
| [signals-api.md](references/signals-api.md) | Signal operations, derive, each, suspend, reactivity |
| [effect-patterns.md](references/effect-patterns.md) | Event handlers, services, layers, testing, routing |
| [common-errors.md](references/common-errors.md) | Debugging errors, anti-patterns, troubleshooting |
