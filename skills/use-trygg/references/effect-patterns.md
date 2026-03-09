# Effect Patterns in trygg

## Services and Layers

Define services with `ServiceMap.Service`, provide via `Layer`:

```tsx
import { Layer } from "effect"
import * as ServiceMap from "effect/ServiceMap"
import { Component } from "trygg"

// Define service
class Theme extends ServiceMap.Service<Theme, {
  readonly primary: string
  readonly background: string
}>()("Theme") {}

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
import { render, click, type, waitFor } from "trygg/testing"
```

### Render and Query

```tsx
it.scoped("renders content", () =>
  Effect.gen(function* () {
    const { getByText, getByTestId, getByRole, querySelector, queryByText } = yield* render(<MyComp />)

    // Query methods (return Effect — yield* to unwrap):
    const el = yield* getByText("Hello")          // exact text match
    const btn = yield* getByTestId("submit-btn")  // data-testid attribute
    const heading = yield* getByRole("heading")    // ARIA role (implicit for h1-h6)
    const input = yield* querySelector<HTMLInputElement>("input[type=email]")

    // Optional queries also return Effect
    const maybeGreeting = yield* queryByText("Welcome")
  })
)
```

### Interactions

```tsx
it.scoped("handles user interaction", () =>
  Effect.gen(function* () {
    const { getByTestId, getByText } = yield* render(<Counter />)

    yield* click(yield* getByTestId("increment"))
    yield* waitFor(() => {
      const el = document.querySelector("[data-testid='count']")
      expect(el?.textContent).toBe("1")
    })
  })
)
```

### Testing with Services

```tsx
it.scoped("renders with mock service", () =>
  Effect.gen(function* () {
    const mockTheme = Layer.succeed(Theme, { primary: "red", background: "#000" })
    const Comp = MyComponent.provide(mockTheme)
    const { getByText } = yield* render(<Comp />)
    yield* getByText("red")
  })
)
```

### Test Utilities

| Function | Signature | Description |
|----------|-----------|-------------|
| `render` | `(element) => Effect<TestRenderResult, _, Scope>` | Render and get query helpers; auto-provides `testLayer` |
| `renderElement` | `(element: Element) => Effect<TestRenderResult, _, Renderer \| Scope>` | Render raw Element (requires Renderer + Scope) |
| `click` | `(el: HTMLElement) => Effect<void>` | Simulate click |
| `type` | `(el, value: string) => Effect<void>` | Simulate typing (fires input+change) |
| `waitFor` | `(fn, opts?) => Effect<T, WaitForTimeoutError>` | Poll until assertion passes |
| `queryByText` | `(text: string) => Effect<Option.Option<HTMLElement>>` | Optional text lookup |
| `queryByTestId` | `(testId: string) => Effect<Option.Option<HTMLElement>>` | Optional test id lookup |
| `queryByRole` | `(role: string) => Effect<Option.Option<HTMLElement>>` | Optional role lookup |
| `querySelectorAll` | `(selector: string) => Effect<ReadonlyArray<HTMLElement>>` | Query all matching elements |
| `testLayer` | `Layer<Renderer>` | Provides browser renderer only |

> Note: import these helpers from `trygg/testing`. `render` auto-provides `testLayer`. No need to `.pipe(Effect.provide(testLayer))`.
> The `queryBy*` and `querySelectorAll` functions are methods on `TestRenderResult`, not standalone exports.

## Routing

### Route Definition (app/routes.ts)

```tsx
import { Route, Routes } from "trygg/router"

export const routes = Routes.make()
  .add(Route.make("/").component(() => import("./pages/home")))
  .add(Route.make("/users").component(() => import("./pages/users/list")))
  .add(Route.make("/users/:id").component(() => import("./pages/users/detail")))
  .add(
    Route.make("/settings")
      .layout(() => import("./pages/settings/layout"))
      .children(
        Route.index(() => import("./pages/settings/overview")),
        Route.make("/profile").component(() => import("./pages/settings/profile")),
      ),
  )
```

### Navigation

```tsx
import * as Router from "trygg/router"

const router = yield* Router.get
yield* router.navigate("/users/:id", { params: { id: "123" } })
yield* router.navigate("/login", { replace: true })

// Link component
<Router.Link to="/users">Users</Router.Link>
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

---

## See Also

- [component-api.md](component-api.md) — Component.gen, .provide(), Resource, ErrorBoundary, Portal
- [signals-api.md](signals-api.md) — Signal.make, derive, each, subscribe
- [common-errors.md](common-errors.md) — Error types, anti-patterns, troubleshooting
