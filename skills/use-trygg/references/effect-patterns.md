# Effect Patterns in trygg

## Services and Layers

Define services with `Context.Tag`, provide via `Layer`:

```tsx
import { Context, Layer } from "effect"
import { Component } from "trygg"

// Define service
class Theme extends Context.Tag("Theme")<Theme, {
  readonly primary: string
  readonly background: string
}>() {}

// Create layer
const themeLayer = Layer.succeed(Theme, { primary: "blue", background: "#fff" })

// Component yields service
const Card = Component.gen(function* () {
  const theme = yield* Theme
  return <div style={{ background: theme.background }}>Themed</div>
})

// Parent provides layer
const App = Component.gen(function* () {
  return <Card />
}).provide(themeLayer)
```

## Event Handlers

Handlers are `() => Effect<void>` or `(event: Event) => Effect<void>`:

```tsx
// Simple thunk
<button onClick={() => Signal.update(count, n => n + 1)}>+</button>

// Multi-step with Effect.gen
const submit = () => Effect.gen(function* () {
  const text = (yield* Signal.get(inputValue)).trim()
  if (text === "") return
  yield* Signal.update(items, list => [...list, text])
  yield* Signal.set(inputValue, "")
})

// Reading DOM values
const onInput = (e: Event) =>
  Effect.sync(() => {
    const target = e.target
    return target instanceof HTMLInputElement ? target.value : ""
  }).pipe(Effect.flatMap(v => Signal.set(inputValue, v)))

// Keyboard events
const onKeyDown = (e: Event) =>
  Effect.gen(function* () {
    if (e instanceof KeyboardEvent) {
      if (e.key === "Enter") yield* submitForm()
      if (e.key === "Escape") yield* cancelEdit()
    }
  })
```

## Error Types

Always use `Data.TaggedError`:

```tsx
import { Data } from "effect"

class NetworkError extends Data.TaggedError("NetworkError")<{
  readonly url: string
  readonly status: number
}> {}

class ValidationError extends Data.TaggedError("ValidationError")<{
  readonly field: string
  readonly message: string
}> {}

// Yield errors in Effects
const fetchUser = (id: string) => Effect.gen(function* () {
  // ... on failure:
  return yield* new NetworkError({ url: `/users/${id}`, status: 404 })
})
```

## Testing

### Setup

```tsx
import { describe, it } from "@effect/vitest"
import { Effect } from "effect"
import { testRender, click, typeInput, waitFor, testLayer } from "trygg"
```

### Render and Query

```tsx
it.scoped("renders content", () =>
  Effect.gen(function* () {
    const { getByText, getByTestId, getByRole, querySelector } = yield* testRender(<MyComp />)

    // Query methods:
    const el = yield* getByText("Hello")          // exact text match
    const btn = yield* getByTestId("submit-btn")  // data-testid attribute
    const heading = yield* getByRole("heading")    // ARIA role (implicit for h1-h6)
    const input = yield* querySelector<HTMLInputElement>("input[type=email]")
  }).pipe(Effect.provide(testLayer))
)
```

### Interactions

```tsx
it.scoped("handles user interaction", () =>
  Effect.gen(function* () {
    const { getByTestId, getByText } = yield* testRender(<Counter />)

    yield* click(yield* getByTestId("increment"))
    yield* waitFor(() => {
      const el = document.querySelector("[data-testid='count']")
      expect(el?.textContent).toBe("1")
    })
  }).pipe(Effect.provide(testLayer))
)
```

### Testing with Services

```tsx
it.scoped("renders with mock service", () =>
  Effect.gen(function* () {
    const mockTheme = Layer.succeed(Theme, { primary: "red", background: "#000" })
    const Comp = MyComponent.provide(mockTheme)
    const { getByText } = yield* testRender(<Comp />)
    yield* getByText("red")
  }).pipe(Effect.provide(testLayer))
)
```

### Test Utilities

| Function | Signature | Description |
|----------|-----------|-------------|
| `testRender` | `(element) => Effect<TestRenderResult, _, Scope>` | Render and get query helpers |
| `renderElement` | `(element: Element) => Effect<TestRenderResult>` | Render raw Element |
| `click` | `(el: HTMLElement) => Effect<void>` | Simulate click |
| `typeInput` | `(el, value: string) => Effect<void>` | Simulate typing (fires input+change) |
| `waitFor` | `(fn, opts?) => Effect<T, WaitForTimeoutError>` | Poll until assertion passes |
| `testLayer` | `Layer<Renderer>` | Provides Renderer + test Router |

## Routing

### Route Definition (app/routes.ts)

```tsx
import { Router } from "trygg/router"

export default Router.routes([
  Router.route("/", () => import("./pages/home")),
  Router.route("/users", () => import("./pages/users/list")),
  Router.route("/users/:id", () => import("./pages/users/detail")),
  Router.layout("/settings", () => import("./pages/settings/layout"), [
    Router.route("/settings", () => import("./pages/settings/overview")),
    Router.route("/settings/profile", () => import("./pages/settings/profile")),
  ]),
])
```

### Navigation

```tsx
import { Router } from "trygg/router"

const nav = yield* Router.Navigation
yield* nav.push("/users/123")
yield* nav.replace("/login")

// Link component
<Router.Link href="/users">Users</Router.Link>
```

### Outlet

```tsx
// In layout components, render child routes:
const Layout = Component.gen(function* () {
  return (
    <div>
      <nav>...</nav>
      <main><Router.Outlet /></main>
    </div>
  )
})
```

## Vite Plugin

```tsx
// vite.config.ts
import { defineConfig } from "vite"
import { trygg } from "trygg/vite-plugin"

export default defineConfig({
  plugins: [trygg()]
})
```

Handles: JSX config, route type generation, code splitting, entry generation, API middleware, SPA fallback.
