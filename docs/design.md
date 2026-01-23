# Effect UI - Design Document

## 1. Overview

**effect-ui** is a UI framework built entirely on Effect, providing:

- **JSX as the authoring format** - Custom runtime, no React dependency
- **Components are Effects** - `Effect<Element, E, R>`; app entrypoint must have `R = never`
- **Reactive state via Signal** - Built on SubscriptionRef, position-based identity like React hooks
- **Dependency injection via Component.provide** - Use `Component.provide(layer)` on parent effects
- **Explicit side-effect handling** - Event handlers return Effects, executed by the renderer

### Core Principles

1. **Effect-Native**: Everything is an Effect. Use `Component.provide` for DI, not special components.
2. **Type-Safe**: Errors tracked at type level. R=never enforced - no type casts.
3. **Testable**: Components can be rendered with test layers in isolation.
4. **Explicit**: Side effects are visible in the type signature.

---

## 2. Core Types

### 2.1 Element

The virtual DOM representation, modeled as a `Data.TaggedEnum` with 10 variants:

```typescript
export type Element = Data.TaggedEnum<{
  /** Intrinsic HTML element like <div>, <span> */
  Intrinsic: {
    readonly tag: string
    readonly props: ElementProps
    readonly children: ReadonlyArray<Element>
    readonly key: ElementKey | null
  }
  /** Static text node */
  Text: {
    readonly content: string
  }
  /** Reactive text node - updates textContent when signal changes */
  SignalText: {
    readonly signal: Signal<unknown>
  }
  /** Reactive element - swaps DOM nodes when signal changes */
  SignalElement: {
    readonly signal: Signal<Element>
  }
  /** Context boundary - provides captured context to child (internal) */
  Provide: {
    readonly context: Context.Context<unknown>
    readonly child: Element
  }
  /** Effect-based component thunk */
  Component: {
    readonly run: () => Effect.Effect<Element, unknown, unknown>
    readonly key: ElementKey | null
  }
  /** Fragment containing multiple children */
  Fragment: {
    readonly children: ReadonlyArray<Element>
  }
  /** Renders children into a different DOM container */
  Portal: {
    readonly target: HTMLElement | string
    readonly children: ReadonlyArray<Element>
  }
  /** Efficient keyed list rendering with stable scopes per key */
  KeyedList: {
    readonly source: Signal<ReadonlyArray<unknown>>
    readonly renderFn: (item: unknown, index: number) => Effect<Element>
    readonly keyFn: (item: unknown, index: number) => string | number
  }
  /** Catches child render errors, swaps to fallback (internal) */
  ErrorBoundaryElement: {
    readonly child: Element
    readonly fallback: Element | ((cause: Cause<unknown>) => Element)
    readonly onError: ((cause: Cause<unknown>) => Effect<void>) | null
  }
}>
```

### 2.2 Supporting Types

```typescript
type ElementKey = string | number
type EventHandler<A, E, R> = ((event: Event) => Effect<A, E, R>) | Effect<A, E, R>
type MaybeSignal<T> = T | Signal<T>
type ElementChild = Element | AnySignal | string | number | boolean | null | undefined
type ElementChildren = ElementChild | ReadonlyArray<ElementChild>
```

### 2.3 JSX Runtime

TypeScript compiles JSX to function calls. We provide a custom runtime:

```typescript
// src/jsx-runtime.ts
export const jsx = <Props extends JSXProps>(
  type: JSXElementType<Props>,
  props: Props | null,
  key?: ElementKey
): Element

export const jsxs = jsx
export const Fragment = (props: { children?: unknown }): Element
```

Development mode (`jsx-dev-runtime.ts`) adds source location info for debugging.

---

## 3. Rendering

### 3.1 Renderer Service

```typescript
export class Renderer extends Context.Tag("@effect-ui/Renderer")<Renderer, RendererService>() {}

export interface RendererService {
  readonly mount: (container: HTMLElement, element: Element) => Effect<void, unknown, Scope.Scope>
  readonly render: (element: Element, parent: Node) => Effect<RenderResult, unknown, Scope.Scope>
}
```

### 3.2 mount() - Simple Entrypoint

```typescript
export const mount = <E>(
  container: HTMLElement,
  app: Effect<Element, E, never> | Element,
): void
```

Merges `browserLayer`, `Router.browserLayer`, `ResourceRegistryLive`. Dynamically imports `@effect/platform-browser/BrowserRuntime`.

### 3.3 mountDocument() - Document-Level Mounting

```typescript
export const mountDocument = <E>(
  app: Effect<Element, E, never> | Element,
  options?: { readonly manifest?: Router.RoutesManifest },
): void
```

Like `mount` but enables document-level rendering where `<html>`, `<head>`, `<body>` map to existing DOM nodes instead of creating new ones. Used by the generated entry module.

### 3.4 render() - Composable Effect

```typescript
export const render = Effect.fn("render")(function* <E>(
  container: HTMLElement,
  app: Effect<Element, E, never>,
) {
  const renderer = yield* Renderer
  yield* renderer.mount(container, Element.Component({ run: () => app, key: null }))
  return yield* Effect.never  // Keep scope open
})
```

### 3.5 Event Handling

Event handlers return Effects, executed by the runtime:

```typescript
node.addEventListener(eventName, (event) => {
  const effect = handler(event)
  Runtime.runFork(runtime)(effect)
})
```

Handlers can be functions `(event) => Effect<void>` or bare Effects `Effect<void>`.

### 3.6 Element Rendering

The renderer handles all 10 variants:

- **Text**: `document.createTextNode(content)`
- **SignalText**: Creates text node, subscribes to signal, updates `textContent` on change
- **SignalElement**: Anchor comment, renders initial, subscribes for DOM swaps with version tracking
- **Provide**: Passes context to child render
- **Intrinsic**: Creates DOM element, applies props (SafeUrl for href/src, Signal subscriptions), handles head hoisting, renders children
- **Component**: Creates render phase, executes Effect, subscribes to accessed signals, schedules re-renders via `queueMicrotask`
- **Fragment**: Renders children into `DocumentFragment`
- **Portal**: Resolves target, renders children there
- **KeyedList**: Full keyed reconciliation with LIS (Longest Increasing Subsequence) for minimal DOM moves
- **ErrorBoundaryElement**: Wraps child with error handler, swaps to fallback on error

---

## 4. Reactivity with Signal

### 4.1 Signal Interface

```typescript
export interface Signal<A> {
  readonly _tag: "Signal"
  readonly _ref: SubscriptionRef.SubscriptionRef<A>
  readonly _listeners: Set<SignalListener>
  readonly _debugId: string
}
```

### 4.2 Core API

| Function | Signature | Description |
|----------|-----------|-------------|
| `make` | `<A>(initial: A) => Effect<Signal<A>>` | Create signal. Position-tracked in components. |
| `unsafeMake` | `<A>(initial: A) => Signal<A>` | Create synchronously (global/module-level). |
| `get` | `<A>(signal: Signal<A>) => Effect<A>` | Read value. **Subscribes component to changes.** |
| `set` | `<A>(signal: Signal<A>, value: A) => Effect<void>` | Set value, notify listeners. Skips if unchanged. |
| `update` | `<A>(signal: Signal<A>, f: (a: A) => A) => Effect<void>` | Update via function. Skips if unchanged. |
| `modify` | `<A, B>(signal: Signal<A>, f: (a: A) => readonly [B, A]) => Effect<B>` | Modify and return result. |

### 4.3 Derived Signals

| Function | Signature | Description |
|----------|-----------|-------------|
| `derive` | `<A, B>(source: Signal<A>, f: (a: A) => B) => Effect<Signal<B>, never, Scope>` | Derived signal. Updates eagerly on source change. |
| `deriveAll` | `(sources: [...Signals], f: (...values) => R) => Effect<Signal<R>, never, Scope>` | Derive from multiple sources (up to 6). |
| `chain` | `<A, B>(source: Signal<A>, f: (a: A) => Effect<Signal<B>>) => Effect<Signal<B>, never, Scope>` | Signal flatMap. Switches to new inner signal on change. |

### 4.4 Fine-Grained Reactivity

**Key insight**: `Signal.make()` does NOT subscribe the component. Only `Signal.get()` subscribes.

```tsx
// Fine-grained: component runs ONCE, only text node updates
const Counter = Effect.gen(function* () {
  const count = yield* Signal.make(0)
  return (
    <button onClick={() => Signal.update(count, n => n + 1)}>
      Count: {count}
    </button>
  )
})

// For conditional rendering, use Signal.derive (no component re-render):
const View = Effect.gen(function* () {
  const editText = yield* Signal.make<Option<string>>(Option.none())
  const content = yield* Signal.derive(editText, (value) =>
    Option.isSome(value) ? <input /> : <span />
  )
  return <div>{content}</div>  // content is Signal<Element> -> SignalElement
})

// When you need full re-render (use sparingly):
const View = Effect.gen(function* () {
  const submitted = yield* Signal.make(false)
  const submittedValue = yield* Signal.get(submitted)  // Subscribes!
  return submittedValue ? <Success /> : <Form />
})
```

### 4.5 Signal Props

Props accept Signals for fine-grained DOM updates without re-render:

```tsx
const email = yield* Signal.make("")
const isValid = yield* Signal.make(false)

return <input value={email} disabled={isValid} className={className} />
```

### 4.6 Signal.each for Lists

Efficient keyed list rendering with stable scopes per key:

```tsx
const todos = yield* Signal.make<ReadonlyArray<Todo>>([])

const listElement = Signal.each(
  todos,
  (todo) => Effect.gen(function* () {
    const editing = yield* Signal.make(false)
    return <li>{todo.text}</li>
  }),
  { key: (todo) => todo.id }
)

return <ul>{listElement}</ul>
```

Each item gets a stable scope. Nested signals persist across list updates. Uses LIS-based reconciliation for minimal DOM moves.

### 4.7 Signal.suspend

Component suspension with async state management:

```tsx
const SuspendedView = yield* Signal.suspend(
  MyAsyncComponent,
  {
    Pending: <Spinner />,
    Failure: (cause, stale) => <ErrorView cause={cause} />,
    Success: <div />,  // replaced by component output
  }
)

return <SuspendedView />
```

### 4.8 Listener Behavior

- Listeners run in parallel with unbounded concurrency (`Effect.forEach`)
- Failing listeners are isolated (logged, don't crash other listeners)
- Mid-notification unsubscribes are safe (snapshot before iteration)

---

## 5. Component.gen API

### 5.1 Usage

```tsx
// With props
const Card = Component.gen(function* (Props: ComponentProps<{ title: string }>) {
  const { title } = yield* Props
  const theme = yield* Theme
  return <div style={{ color: theme.primary }}>{title}</div>
})

// Without props
const ThemedCard = Component.gen(function* () {
  const theme = yield* Theme
  return <div>{theme.name}</div>
})
```

### 5.2 Component.Type

```typescript
// Accessed as Component.Type<Props, E, R>
interface ComponentType<Props = never, _E = never, _R = never> {
  readonly _tag: "EffectComponent"
  (props: [Props] extends [never] ? {} : Props): Element
}

// Examples:
const ThemedCard: Component.Type<never, never, Theme>        // needs Theme service
const Card: Component.Type<{ title: string }, never, Theme>  // props + service
const Pure: Component.Type<{ title: string }, never, never>  // no requirements
```

### 5.3 Component.provide

```tsx
// Apply layers to satisfy child service requirements
Effect.gen(function* () {
  return <Card title="Hello" />
}).pipe(Component.provide(themeLayer))

// Multiple layers
Component.provide(Layer.mergeAll(themeLayer, loggerLayer))
```

Captures the current context and wraps the child Element in a `Provide` node.

---

## 6. Head Management

### 6.1 Hoistable Tags

Components render head elements directly in JSX. The renderer detects these and mounts them to `document.head`:

```tsx
const AboutPage = Component.gen(function* () {
  return <>
    <title>About Us</title>
    <meta name="description" content="Learn about our team" />
    <link rel="canonical" href="/about" />
    <div>Content</div>
  </>
})
```

Hoistable tags: `title`, `meta`, `link`, `style`, `script`, `base`.

### 6.2 Deduplication

| Tag | Key | Behavior |
|-----|-----|----------|
| `title` | `"title"` (singleton) | Deepest component wins, restores on unmount |
| `meta[name]` | `"meta:name:{name}"` | Deepest wins per name |
| `meta[property]` | `"meta:property:{property}"` | Deepest wins (Open Graph) |
| `base` | `"base"` (singleton) | Deepest wins |
| `link`, `style`, `script` | None | Allow duplicates, cleanup on unmount |

### 6.3 The `mode` Prop

```tsx
<title>Hoisted to head</title>           // default: mode="hoisted"
<style mode="static">{`.x{}`}</style>    // stays in-place in parent
```

### 6.4 Reactive Head

Signals work naturally:

```tsx
<title>{() => `Dashboard (${count.get()})`}</title>
```

### 6.5 Document-Level Elements

When using `mountDocument`, `<html>`, `<head>`, `<body>` map to existing DOM nodes:

```tsx
const RootLayout = Component.gen(function* () {
  return (
    <html lang="en">
      <head><meta charset="UTF-8" /></head>
      <body class="antialiased">
        <Router.Outlet />
      </body>
    </html>
  )
})
```

---

## 7. Portal

```tsx
import { Portal } from "effect-ui"

const Modal = Component.gen(function* () {
  return (
    <Portal target={document.body}>
      <div class="modal-overlay">
        <div class="modal">Content</div>
      </div>
    </Portal>
  )
})
```

Target can be an `HTMLElement` or a CSS selector string.

---

## 8. Error Boundary

```tsx
import { ErrorBoundary } from "effect-ui"

<ErrorBoundary
  fallback={(cause) => <div>Error: {Cause.squash(cause)}</div>}
  onError={(cause) => Effect.log("Error caught", cause)}
>
  <RiskyComponent />
</ErrorBoundary>
```

---

## 9. Security

### 9.1 URL Validation

`href` and `src` attributes are validated at render time. Dangerous schemes like `javascript:` are blocked.

**Default allowed schemes:** `http`, `https`, `mailto`, `tel`, `sms`, `blob`, `data`

```tsx
// Blocked - console warning emitted
<a href="javascript:alert(1)">Click me</a>

// Adding custom schemes
SafeUrl.allowSchemes(["myapp", "web+myapp"])
```

**Validation API:**

```typescript
SafeUrl.validate(url: string): Effect<string, UnsafeUrlError>
SafeUrl.validateOption(url: string): Effect<Option<string>>
SafeUrl.validateSync(url: string): Option<string>
SafeUrl.isSafe(url: string): Effect<boolean>
```

### 9.2 Content Security

No `dangerouslySetInnerHTML` equivalent. Text content is always escaped.

---

## 10. Resource (Data Fetching)

### 10.1 ResourceState

```typescript
type ResourceState<A, E> =
  | { _tag: "Pending" }
  | { _tag: "Success"; value: A; stale: boolean }
  | { _tag: "Failure"; error: E; staleValue: Option<A> }
```

### 10.2 Creating Resources

```typescript
// Simple
const userResource = Resource.make({
  key: "user:123",
  fetch: fetchUser("123")
})

// Parameterized endpoint (auto-generates cache key)
const getUser = Resource.endpoint("user", (id: string) =>
  Effect.gen(function* () { /* fetch */ })
)
// Usage: getUser("123") -> Resource with key "user:\"123\""

// No-param endpoint
const config = Resource.endpointNoParams("app-config", fetchConfig)
```

### 10.3 Fetching and Rendering

```typescript
const state = yield* Resource.fetch(userResource)

return yield* Resource.match(state, {
  Pending: () => <Spinner />,
  Success: (user, stale) => <UserCard user={user} opacity={stale ? 0.5 : 1} />,
  Failure: (error, staleValue) => <ErrorView error={error} />
})
```

### 10.4 Cache Control

```typescript
Resource.invalidate(resource)  // Stale-while-revalidate (shows stale, refetches in background)
Resource.refresh(resource)     // Hard reload (shows Pending, refetches)
Resource.clear(resource)       // Remove from cache
```

### 10.5 Deduplication

Concurrent `Resource.fetch` calls for the same key return the same Signal. In-flight fetches are shared via Deferred.

---

## 11. API Routes

### 11.1 Overview

API routes are defined in a single `app/api.ts` file exporting an `HttpApi` definition and handler layer:

```typescript
// app/api.ts
import { HttpApi, HttpApiBuilder, HttpApiEndpoint, HttpApiGroup } from "@effect/platform"
import { Schema, Layer } from "effect"

const users = HttpApiGroup.make("users")
  .add(HttpApiEndpoint.get("listUsers", "/api/users").addSuccess(Schema.Array(UserSchema)))
  .add(HttpApiEndpoint.post("createUser", "/api/users").setPayload(CreateUser).addSuccess(UserSchema))

export const api = HttpApi.make("app").add(users)

export const ApiLive = HttpApiBuilder.group(api, "users", (handlers) =>
  handlers
    .handle("listUsers", () => UserService.list())
    .handle("createUser", ({ payload }) => UserService.create(payload))
).pipe(Layer.provide(UserServiceLive))
```

### 11.2 Type Utilities

```typescript
import type { Api } from "effect-ui"

// Extract handler type from endpoint
type Handler = Api.Handler<typeof endpoint>

// Extract handlers map from group
type Handlers = Api.GroupHandlers<typeof group>
```

### 11.3 Vite Plugin Integration

The plugin:
1. Validates `app/api.ts` exports (`api`/`Api` and `ApiLive`)
2. Generates `.effect-ui/api.d.ts` type declarations
3. Resolves `virtual:effect-ui/client` virtual module
4. Creates dev server middleware using `HttpApiBuilder.toWebHandler`

### 11.4 Client Usage

```typescript
import { api } from "virtual:effect-ui/client"
import { HttpApiClient } from "@effect/platform"

const client = yield* HttpApiClient.make(api, { baseUrl: "/api" })
const users = yield* client.users.listUsers()
```

---

## 12. Vite Plugin

```typescript
// vite.config.ts
import { defineConfig } from "vite"
import effectUI from "effect-ui/vite-plugin"

export default defineConfig({
  plugins: [effectUI({ routes: "./app/routes.ts" })]
})
```

### What it does:

1. **JSX Configuration**: `esbuild.jsx: "automatic"`, `jsxImportSource: "effect-ui"`
2. **Route type generation**: Parses `routes.ts`, generates `.effect-ui/routes.d.ts` with `RouteMap` augmentation
3. **Code splitting** (production): Transforms `.component(X)` to `.component(() => import("./X"))` for Lazy routes
4. **Entry generation**: Creates `.effect-ui/entry.tsx` with `mountDocument`
5. **HTML shell**: Generates `.effect-ui/index.html`
6. **API middleware**: Dev server serves API routes
7. **Dev server**: SPA fallback for client-side routing

---

## 13. Testing

```typescript
import { describe, it } from "@effect/vitest"
import { Effect } from "effect"
import { testRender, click, waitFor, testLayer } from "effect-ui"

describe("Counter", () => {
  it.scoped("increments on click", () =>
    Effect.gen(function* () {
      const { getByTestId } = yield* testRender(Counter)
      expect(getByTestId("btn").textContent).toBe("0")
      yield* click(getByTestId("btn"))
      yield* waitFor(() => expect(getByTestId("btn").textContent).toBe("1"))
    }).pipe(Effect.provide(testLayer))
  )
})
```

**Test utilities:**
- `testRender(component)` - Renders component, returns query helpers
- `renderElement(element)` - Renders raw Element
- `click(element)` - Simulates click event
- `typeInput(element, value)` - Simulates input
- `waitFor(fn)` - Polls until assertion passes
- `testLayer` - Provides Renderer + test Router

---

## 14. Utilities

### cx (Class Names)

```typescript
import { cx } from "effect-ui"

const className = cx("base", isActive && "active", isDisabled && "disabled")
// "base active" or "base disabled" etc.
```

---

## 15. Design Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Component type | `Effect<Element, E, never>` | R=never enforced, use `yield*` to compose |
| Reactivity | `Signal` on SubscriptionRef | Effect-native, fine-grained updates |
| Subscription | Only `Signal.get()` subscribes | Fine-grained by default, opt-in re-render |
| Conditional rendering | `Signal.derive` -> `SignalElement` | DOM swap without component re-render |
| List rendering | `Signal.each` with LIS reconciliation | Minimal DOM moves, stable scopes per key |
| Event handlers | Return `Effect` | Renderer handles execution via `Runtime.runFork` |
| DI pattern | `Component.provide(layer)` | No Provider component, Effect-native |
| Head management | JSX hoisting to `document.head` | Stack-based dedup, scope-based cleanup |
| Rendering target | Browser DOM first | SSR planned via same Layer pattern |
| Entrypoint | `mount()` / `mountDocument()` | Simple start, document-level for full apps |
