# trygg - Design Document

## 1. Overview

**trygg** is a UI framework built entirely on Effect, providing:

- **JSX as the authoring format** - Custom runtime, no React dependency
- **Components use Component.gen** - `Component.Type` with explicit props and DI; app entrypoint must have `R = never`
- **Reactive state via Signal** - Built on SubscriptionRef, position-based identity like React hooks
- **Dependency injection via .provide() method** - Use `.provide()` method on components
- **Explicit side-effect handling** - Event handlers return Effects, executed by the renderer

### Core Principles

1. **Effect-Native**: Everything is an Effect. Use `.provide()` method for DI, not special components.
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
    readonly onSwap: Effect.Effect<void> | undefined
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
export const jsx = <Props extends Record<string, unknown>>(
  type: JSXElementType<Props>,
  props: Props | null,
  key?: ElementKey
): ElementFor<Type>

export const jsxs = jsx
export const Fragment: Component.Type<{ children?: unknown }>
```

**Valid component types:**
- **String**: Intrinsic HTML elements (`<div>`, `<span>`, etc.)
- **Component.Type**: Components created with `Component.gen`

**Invalid component types** (fail with `InvalidComponentError`):
- Plain functions not wrapped in `Component.gen`
- Direct `Effect<Element>` values

Development mode (`jsx-dev-runtime.ts`) adds source location info for debugging.

---

## 3. Rendering

### 3.1 Renderer Service

```typescript
export class Renderer extends Context.Tag("@trygg/Renderer")<Renderer, RendererService>() {}

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

### 4.4 Fine-Grained Reactivity

**Key insight**: `Signal.make()` does NOT subscribe the component. Only `Signal.get()` subscribes.

```tsx
// Fine-grained: component runs ONCE, only text node updates
const Counter = Component.gen(function* () {
  const count = yield* Signal.make(0)
  return (
    <button onClick={() => Signal.update(count, n => n + 1)}>
      Count: {count}
    </button>
  )
})

// For conditional rendering, use Signal.derive (no component re-render):
const View = Component.gen(function* () {
  const editText = yield* Signal.make<Option<string>>(Option.none())
  const content = yield* Signal.derive(editText, (value) =>
    Option.isSome(value) ? <input /> : <span />
  )
  return <div>{content}</div>  // content is Signal<Element> -> SignalElement
})

// When you need full re-render (use sparingly):
const View = Component.gen(function* () {
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
const SuspendedProfile = yield* Signal.suspend(UserProfile, {
  Pending: (stale) => stale ?? <Spinner />,
  Failure: (cause, stale) => stale ?? <ErrorView cause={cause} />,
  Success: <UserProfile userId={userId} />
})

return <SuspendedProfile />
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

Components have a `.provide()` method for dependency injection:

```tsx
// Apply layers to satisfy component service requirements
const ThemedCard = Card.provide(themeLayer)

// Multiple layers via chaining
const FullyProvidedCard = Card
  .provide(themeLayer)
  .provide(loggerLayer)

// Multiple layers via array
const FullyProvidedCard = Card.provide([themeLayer, loggerLayer])
```

The `.provide()` method returns a new component with the layer applied. When rendered, it builds a context from the layer and provides it to the component's generator, satisfying service requirements.

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
| `meta[httpEquiv]` | `"meta:http-equiv:{value}"` | Deepest wins per value |
| `meta[charset]` | `"meta:charset"` (singleton) | Deepest wins |
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
import { Portal } from "trygg"

const Modal = Component.gen(function* () {
  const isOpen = yield* Signal.make(false)

  const PortalledDialog = yield* Portal.make(
    <div class="modal-overlay">
      <div class="modal">Content</div>
    </div>,
    { target: document.body }
  )

  return (
    <div>
      <button onClick={() => Signal.update(isOpen, v => !v)}>Toggle</button>
      <PortalledDialog visible={isOpen} />
    </div>
  )
})
```

`Portal.make(content, options?)` returns `Effect<Component.Type<PortalProps, never, Scope>, PortalTargetNotFoundError, Scope>`.
- Target: `HTMLElement`, CSS selector string, or omit for dynamic container on `document.body`
- Returned component accepts optional `visible` prop (`boolean | Signal<boolean>`)

---

## 8. Error Boundary

Chainable builder pattern for typed error handling:

```tsx
import { ErrorBoundary } from "trygg"

// With catchAll
const SafeComponent = yield* ErrorBoundary
  .catch(RiskyComponent)
  .on("NetworkError", NetworkErrorView)
  .on("ValidationError", ValidationErrorView)
  .catchAll((cause) => <GenericError cause={cause} />)

// Exhaustive (compile-time check — all error tags must be handled)
const SafeComponent = yield* ErrorBoundary
  .catch(RiskyComponent)
  .on("NetworkError", NetworkErrorView)
  .on("ValidationError", ValidationErrorView)
  .exhaustive()

return <SafeComponent userId={userId} />
```

`.on(tag, component)` takes a `Component.Type<{ error: E }>`. `.catchAll(handler)` takes `(cause: Cause<unknown>) => Element`. Props passed to the wrapped component can be `SignalOrValue<T>` (reactive).

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
// No params — returns Resource directly
const usersResource = Resource.make(
  () => fetchUsers(),
  { key: "users.list" }
)

// With params — returns factory function (params) => Resource
const getUser = Resource.make(
  (params: { id: string }) => fetchUser(params.id),
  { key: (params) => Resource.hash("user", params) }
)
// Usage: getUser({ id: "123" }) -> Resource with key "user:1234567"
```

### 10.2.1 Cache Key Generation

```typescript
// Resource.hash generates deterministic keys from prefix + params
Resource.hash("users.getUser", { id: "123" })
// => "users.getUser:1234567"
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
import type { Api } from "trygg"

// Extract handler type from endpoint
type Handler = Api.Handler<typeof endpoint>

// Extract handlers map from group
type Handlers = Api.GroupHandlers<typeof group>
```

### 11.3 Vite Plugin Integration

The plugin:
1. Requires `app/api.ts` to have a `default` export — a pre-composed `Layer<HttpApi.Api>`
2. Creates dev server middleware via SSR-loaded handler factory
3. Uses `Layer.isLayer` runtime check at module boundary (type params are phantom)

### 11.4 Client Usage

Users define `ApiClient` and `ApiClientLive` in `app/api.ts`:

```typescript
import { HttpApiClient, FetchHttpClient } from "@effect/platform"
import { Context, Effect, Layer } from "effect"

const _client = HttpApiClient.make(Api, { baseUrl: "" })
type ApiClientService = Effect.Effect.Success<typeof _client>

export class ApiClient extends Context.Tag("ApiClient")<ApiClient, ApiClientService>() {}
export const ApiClientLive = Layer.effect(ApiClient, _client.pipe(Effect.provide(FetchHttpClient.layer)))

// In components:
const client = yield* ApiClient
const users = yield* client.users.listUsers()
```

---

## 12. Vite Plugin

```typescript
// vite.config.ts
import { defineConfig } from "vite"
import { trygg } from "trygg/vite-plugin"

export default defineConfig({
  plugins: [trygg()]
})
```

### What it does:

1. **JSX Configuration**: `esbuild.jsx: "automatic"`, `jsxImportSource: "trygg"`
2. **Route type generation**: Parses `routes.ts`, generates `.trygg/routes.d.ts` with `RouteMap` augmentation
3. **Code splitting** (production): Transforms `.component(X)` to `.component(() => import("./X"))` for Lazy routes
4. **Entry generation**: Creates `.trygg/entry.tsx` with `mountDocument`
5. **HTML shell**: Generates `.trygg/index.html`
6. **API middleware**: Dev server serves API routes
7. **Dev server**: SPA fallback for client-side routing

---

## 13. Testing

```typescript
import { describe, it } from "@effect/vitest"
import { Effect } from "effect"
import { render, click, waitFor } from "trygg"

describe("Counter", () => {
  it.scoped("increments on click", () =>
    Effect.gen(function* () {
      const { getByTestId } = yield* render(<Counter />)
      const btn = yield* getByTestId("btn")
      expect(btn.textContent).toBe("0")
      yield* click(btn)
      yield* waitFor(() => {
        const el = document.querySelector("[data-testid='btn']")
        expect(el?.textContent).toBe("1")
      })
    })
  )
})
```

**Test utilities:**
- `render(element)` - Renders component/element, returns query helpers. Auto-provides `testLayer`.
- `renderElement(element)` - Renders raw Element
- `click(element)` - Simulates click event
- `typeInput(element, value)` - Simulates input
- `waitFor(fn)` - Polls until assertion passes
- `getByTestId(id)` - Returns `Effect<HTMLElement>` (effectful)
- `queryByText(text)` - Sync, returns `HTMLElement | null`
- `queryByTestId(id)` - Sync, returns `HTMLElement | null`
- `queryByRole(role)` - Sync, returns `HTMLElement | null`
- `querySelectorAll(selector)` - Sync, returns `NodeListOf<HTMLElement>`
- `testLayer` - Provides Renderer + test Router

---

## 14. Utilities

### cx (Class Names)

```typescript
import { cx } from "trygg"

const className = cx("base", isActive && "active", isDisabled && "disabled")
// "base active" or "base disabled" etc.
```

---

## 15. Design Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Component type | `Component.Type` via `Component.gen` | Tagged components, explicit props, R=never enforced |
| Reactivity | `Signal` on SubscriptionRef | Effect-native, fine-grained updates |
| Subscription | Only `Signal.get()` subscribes | Fine-grained by default, opt-in re-render |
| Conditional rendering | `Signal.derive` -> `SignalElement` | DOM swap without component re-render |
| List rendering | `Signal.each` with LIS reconciliation | Minimal DOM moves, stable scopes per key |
| Event handlers | Return `Effect` | Renderer handles execution via `Runtime.runFork` |
| DI pattern | `.provide(layer)` method | No Provider component, Effect-native |
| Head management | JSX hoisting to `document.head` | Stack-based dedup, scope-based cleanup |
| Rendering target | Browser DOM first | SSR planned via same Layer pattern |
| Entrypoint | `mount()` / `mountDocument()` | Simple start, document-level for full apps |

---

## See Also

- [use-trygg/references/component-api.md](../../use-trygg/references/component-api.md) — Component.gen usage, .provide(), Resource, Portal
- [use-trygg/references/signals-api.md](../../use-trygg/references/signals-api.md) — Signal API reference
- [trygg-router/references/router.md](../../trygg-router/references/router.md) — Router architecture, route matching, navigation
- [trygg-observability/references/observability.md](../../trygg-observability/references/observability.md) — Debug events, metrics, trace correlation
