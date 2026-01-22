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

The virtual DOM representation, modeled as a `Data.TaggedEnum`:

```typescript
// src/Element.ts
import { Data, Effect } from "effect"

export type Element = Data.TaggedEnum<{
  /** Intrinsic HTML element like <div>, <span> */
  Intrinsic: {
    readonly tag: string
    readonly props: ElementProps
    readonly children: ReadonlyArray<Element>
    readonly key: ElementKey | null
  }
  /** Text node */
  Text: {
    readonly content: string
  }
  /** Effect that produces an Element - R must be never */
  Component: {
    readonly run: () => Effect.Effect<Element, unknown, never>
    readonly key: ElementKey | null
  }
  /** Fragment containing multiple children */
  Fragment: {
    readonly children: ReadonlyArray<Element>
  }
  /** Portal - renders into a different DOM container */
  Portal: {
    readonly target: HTMLElement | string
    readonly children: ReadonlyArray<Element>
  }
}>

export const Element = Data.taggedEnum<Element>()
```

### 2.2 JSX Runtime

TypeScript compiles JSX to function calls. We provide a custom runtime:

```typescript
// src/jsx-runtime.ts
export const jsx = <Props extends JSXProps>(
  type: JSXElementType<Props>,
  props: Props | null,
  key?: ElementKey
): Element => {
  // Handle intrinsic elements (strings) and component functions
}

export const jsxs = jsx // Same implementation for static children
export const Fragment = (props: { children?: unknown }): Element
```

### 2.3 JSX Dev Runtime

Development mode provides source location info for debugging:

```typescript
// src/jsx-dev-runtime.ts
export const jsxDEV = <Props extends JSXProps>(
  type: JSXElementType<Props>,
  props: Props | null,
  key?: ElementKey,
  isStaticChildren?: boolean,
  source?: { fileName: string; lineNumber: number; columnNumber: number },
  self?: unknown
): Element
```

---

## 3. Rendering

### 3.1 Renderer Service

The `Renderer` is a Context.Tag service that handles DOM operations:

```typescript
// src/Renderer.ts
export class Renderer extends Context.Tag("@effect-ui/Renderer")<
  Renderer,
  RendererService
>() {}

export interface RendererService {
  readonly mount: (
    container: HTMLElement,
    element: Element
  ) => Effect.Effect<void, unknown, Scope.Scope>
  
  readonly render: (
    element: Element,
    parent: Node
  ) => Effect.Effect<RenderResult, unknown, Scope.Scope>
}
```

### 3.2 mount() - Simple Entrypoint

The `mount` function handles all runtime setup:

```typescript
export const mount = <E>(
  container: HTMLElement,
  app: Effect.Effect<Element, E, never>
): void => {
  import("@effect/platform-browser/BrowserRuntime").then(({ runMain }) => {
    runMain(
      render(container, app).pipe(
        Effect.scoped,
        Effect.provide(browserLayer)
      )
    )
  })
}
```

### 3.3 render() - Composable Effect

For custom layer composition, use `render` directly:

```typescript
export const render = Effect.fn("render")(function* <E>(
  container: HTMLElement,
  app: Effect.Effect<Element, E, never>
) {
  const renderer = yield* Renderer
  const componentElement = Element.Component({ effect: app, key: null })
  yield* renderer.mount(container, componentElement)
  return yield* Effect.never  // Keep scope open
})
```

### 3.4 Event Handling

Event handlers return Effects, executed by the runtime:

```typescript
if (key.startsWith("on") && isEventHandler(value)) {
  const eventName = key.slice(2).toLowerCase()
  node.addEventListener(eventName, (event) => {
    const effect = value(event)
    Runtime.runFork(runtime)(effect)
  })
}
```

---

## 4. Reactivity with Signal

### 4.1 Signal - Effect-Native Reactive State

Signal is built on Effect's `SubscriptionRef` with sync callback subscriptions:

```typescript
// src/Signal.ts
export interface Signal<A> {
  readonly _tag: "Signal"
  readonly _ref: SubscriptionRef.SubscriptionRef<A>
  readonly _listeners: Set<SignalListener>  // Sync callbacks
  readonly _debugId: string  // For debug tracing
}

// Create a signal (does NOT subscribe component)
export const make: <A>(initial: A) => Effect.Effect<Signal<A>>

// Read value AND subscribe component to changes
export const get: <A>(signal: Signal<A>) => Effect.Effect<A>

// Write value and notify listeners
export const set: <A>(signal: Signal<A>, value: A) => Effect.Effect<void>

// Update value with function and notify listeners
export const update: <A>(signal: Signal<A>, f: (a: A) => A) => Effect.Effect<void>

// Subscribe to changes (sync callback)
export const subscribe: <A>(signal: Signal<A>, listener: () => void) => () => void
```

### 4.2 Fine-Grained Reactivity (Implemented)

**Key insight**: `Signal.make()` does NOT subscribe the component. Only `Signal.get()` subscribes.

**Fine-grained updates (no re-render):**
```tsx
const Counter = Effect.gen(function* () {
  const count = yield* Signal.make(0)  // Returns Signal (no subscription)
  
  // Pass Signal directly to JSX - fine-grained updates!
  return (
    <button onClick={() => Signal.update(count, n => n + 1)}>
      Count: {count}
    </button>
  )
})
// Component runs ONCE. Only the text node updates when count changes.
```

**For inputs:**
```tsx
const Form = Effect.gen(function* () {
  const email = yield* Signal.make("")  // Don't use Signal.get!
  return <input value={email} onInput={...} />  // Fine-grained - no re-render on typing
})
```

**When you need re-render (conditional rendering):**
```tsx
const View = Effect.gen(function* () {
  const submitted = yield* Signal.make(false)
  const submittedValue = yield* Signal.get(submitted)  // Subscribes component!
  
  return submittedValue ? <Success /> : <Form />  // Re-renders when submitted changes
})
```

### 4.3 RenderPhase Context

The Renderer manages signal identity across re-renders using position-based tracking:

```typescript
export interface RenderPhase {
  readonly signalIndex: Ref.Ref<number>
  readonly signals: Ref.Ref<Array<Signal<unknown>>>
  readonly accessed: Set<Signal<unknown>>  // Only signals read with Signal.get()
}

export const CurrentRenderPhase: FiberRef.FiberRef<RenderPhase | null>
```

### 4.4 Signal Props

Props like `value`, `checked`, `disabled`, `className` accept Signals for fine-grained updates:

```tsx
const email = yield* Signal.make("")
const isValid = yield* Signal.make(false)

return (
  <input 
    value={email}           // Signal<string> - updates input.value directly
    disabled={isValid}      // Signal<boolean> - updates disabled directly
    className={className}   // Signal<string> - updates class directly
  />
)
```

### 4.5 Debug Logging

See [observability.md](observability.md) for debug events and `<DevMode />` usage.

### 4.6 data-* and aria-* attributes

Intrinsic elements accept `data-*` and `aria-*` attributes. Values can be static primitives or Signals for fine-grained updates.

```tsx
const status = yield* Signal.make("ready")
return <button data-status={status} aria-live="polite">Run</button>
```

### 4.7 Signal.each for Lists (Implemented)

Efficient list rendering with stable scopes per key:

```tsx
const TodoList = Effect.gen(function* () {
  const todos = yield* Signal.make<ReadonlyArray<Todo>>([])
  
  // Signal.each returns a KeyedList element
  const listElement = Signal.each(
    todos,
    (todo) => Effect.gen(function* () {
      // Nested signal - stable per todo.id!
      // Persists when other todos are added/removed
      const editing = yield* Signal.make(false)
      const isEditing = yield* Signal.get(editing)
      
      return (
        <li key={todo.id}>
          {isEditing ? <input value={todo.text} /> : <span>{todo.text}</span>}
          <button onClick={() => Signal.update(editing, e => !e)}>Edit</button>
        </li>
      )
    }),
    { key: (todo) => todo.id }
  )
  
  return <ul>{listElement}</ul>
})
```

**Key features:**
- Each item gets a stable Effect scope identified by its key
- Nested `Signal.make()` calls return the same signal across list updates
- When items are added/removed, only affected scopes are created/destroyed
- Items maintain their local state (like edit mode) when other items change
- Efficient DOM updates via keyed reconciliation

---

## 5. Component.gen API

### 5.1 Typed Components with Explicit DI

The `Component.gen` API enables JSX components with typed props and explicit dependency injection:

```tsx
import { Context, Effect, Layer } from "effect"
import { Component, mount, type ComponentProps } from "effect-ui"

// Define a service
class Theme extends Context.Tag("Theme")<Theme, { primary: string }>() {}

// With typed props - pass the generator directly
const Card = Component.gen(function* (Props: ComponentProps<{ title: string }>) {
  const { title } = yield* Props
  const theme = yield* Theme
  return <div style={{ color: theme.primary }}>{title}</div>
})

// Without props - just pass the generator directly
const ThemedCard = Component.gen(function* () {
  const theme = yield* Theme
  return <div>{theme.name}</div>
})

const themeLayer = Layer.succeed(Theme, { primary: "blue" })
mount(
  container,
  Effect.gen(function* () {
    return <Card title="Hello" />
  }).pipe(Component.provide(themeLayer))
)
```

### 5.2 How It Works

1. **Props as Context.Tag**: Regular props are wrapped in a `PropsMarker` Context.Tag
2. **yield* Props**: Access props consistently with services using generator syntax
3. **Parent DI**: Provide layers in a parent effect using `Component.provide`

### 5.3 Multiple Services

```tsx
const Dashboard = Component.gen(function* (Props: ComponentProps<{ userId: string }>) {
  const { userId } = yield* Props
  const theme = yield* Theme
  const logger = yield* Logger
  return <div>...</div>
})

Effect.gen(function* () {
  return <Dashboard userId="123" />
}).pipe(Component.provide(Layer.mergeAll(themeLayer, loggerLayer)))
```

### 5.4 No Service Requirements

```tsx
const SimpleCard = Component.gen(function* (Props: ComponentProps<{ message: string }>) {
  const { message } = yield* Props
  return <div>{message}</div>
})

// Inferred props: { message: string }
<SimpleCard message="Hello" />
```

---

## 6. Dependency Injection

### 6.1 Core Principles

**Effect-native DI**: Use Effect's built-in context system. No special Provider components.

```tsx
const Header = Component.gen(function* () {
  const theme = yield* Theme  // R = Theme
  return <header>{theme.title}</header>
})

// Provide layers to satisfy requirements
mount(
  container,
  Effect.gen(function* () {
    return <Header />
  }).pipe(Component.provide(ThemeLayer))
)
```

### 6.2 Nested Layers

```tsx
const ThemedSection = Effect.gen(function* () {
  return <Header />
}).pipe(Component.provide(DarkThemeLayer))
```

---

## 7. Error Handling

### 7.1 Error Boundary

```typescript
export const ErrorBoundary = <E>(props: ErrorBoundaryProps<E>): Element => {
  const effect = Effect.gen(function* () {
    return yield* props.children.pipe(
      Effect.catchAll((error: E) =>
        Effect.gen(function* () {
          if (props.onError) yield* props.onError(error)
          return typeof props.fallback === "function" 
            ? props.fallback(error) 
            : props.fallback
        })
      )
    )
  })
  return component(effect)
}
```

---

## 8. Testing

### 8.1 Test Utilities

```typescript
export const render = <E>(
  input: RenderInput<E>
): Effect.Effect<TestRenderResult, E | unknown, Scope.Scope>

export const click = (element: HTMLElement): Effect.Effect<void>
export const waitFor = <T>(fn: () => T): Effect.Effect<T, WaitForTimeoutError>
```

### 8.2 Test Example

```typescript
describe("Counter", () => {
  it.scoped("increments on click", () =>
    Effect.gen(function* () {
      const { getByTestId } = yield* render(Counter)
      
      expect(getByTestId("btn").textContent).toBe("0")
      yield* click(getByTestId("btn"))
      yield* waitFor(() => expect(getByTestId("btn").textContent).toBe("1"))
    })
  )
})
```

---

## 9. Vite Integration

### 9.1 Vite Plugin

```typescript
// vite.config.ts
import { defineConfig } from "vite"
import effectUI from "effect-ui/vite-plugin"

export default defineConfig({
  plugins: [effectUI()]
})
```

The plugin configures:
- `esbuild.jsx: "automatic"`
- `esbuild.jsxImportSource: "effect-ui"`

---

## 10. Example Application

```tsx
import { Effect } from "effect"
import { mount, Signal } from "effect-ui"

const Counter = Effect.gen(function* () {
  const count = yield* Signal.make(0)
  
  return (
    <div>
      <h1>Count: {count}</h1>
      <button onClick={() => Signal.update(count, n => n - 1)}>-</button>
      <button onClick={() => Signal.update(count, n => n + 1)}>+</button>
    </div>
  )
})

mount(document.getElementById("root")!, Counter)
```

---

## 11. Design Decisions Summary

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Component type | `Effect<Element, E, never>` | R=never enforced, use `yield*` to compose |
| Reactivity | `Signal` with sync callbacks | Effect-native, reliable in all environments |
| Signal API | `Signal.make()` returns Signal object | Fine-grained: pass to JSX, re-render: use `Signal.get()` |
| Subscription model | Only `Signal.get()` subscribes | Enables fine-grained updates without re-render |
| Signal props | `value={signal}` for inputs | Fine-grained DOM updates, no input focus loss |
| Async handling | `Signal.resource` + `ResourceState` | Effect-native async state with Exit/Cause |
| Rendering target | Browser DOM first | Start simple, add SSR later |
| Event handlers | Return `Effect` | Renderer handles execution via `Runtime.runFork` |
| DI pattern | `Component.provide` | No Provider component, just use Component |
| Component API | `Component.gen` with props inference | Clean syntax, typed props + explicit DI |
| Entrypoint | `mount()` simple, `render()` composable | Easy start, flexible when needed |
| Scope lifecycle | `Effect.never` keeps scope open | Prevents cleanup from removing DOM |

---

## 12. Security

### 12.1 URL Validation for href/src

effect-ui validates `href` and `src` attributes at render time to prevent XSS attacks via dangerous URL schemes like `javascript:`.

**Default allowed schemes** (based on WHATWG URL Standard and IANA registry):
- `http`, `https` - Standard web protocols
- `mailto` - Email links
- `tel`, `sms` - Phone/SMS links
- `blob` - Blob URLs for local file references
- `data` - Data URLs for embedded content

**Unsafe URLs are blocked:**
```tsx
// This href will NOT be rendered - a console warning is emitted
<a href="javascript:alert(1)">Click me</a>

// This src will NOT be rendered
<img src="javascript:doSomething()" />
```

**Adding custom schemes:**
```tsx
import { SafeUrl } from "effect-ui"

// Add app-specific deep links
SafeUrl.allowSchemes(["myapp", "web+myapp"])

// Now these are valid:
<a href="myapp://settings">Settings</a>
<a href="web+myapp://page">Open in App</a>
```

**Validation API:**
```tsx
import { SafeUrl, UnsafeUrlError } from "effect-ui"
import { Effect, Exit } from "effect"

// Effect-based validation
const result = await Effect.runPromiseExit(
  SafeUrl.validate("javascript:alert(1)")
)
// Exit.isFailure(result) === true
// Error: UnsafeUrlError with scheme="javascript"

// Sync validation
if (SafeUrl.isSafe(userUrl)) {
  // URL is safe
}

// Option-based
const validated = SafeUrl.validateSync(userUrl)
// Option.none() if unsafe
```

**Standards references:**
- [WHATWG URL Standard](https://url.spec.whatwg.org/)
- [IANA URI Schemes Registry](https://www.iana.org/assignments/uri-schemes/)

### 12.2 Content Security

**Untrusted HTML**: effect-ui does not have a `dangerouslySetInnerHTML` equivalent. Text content is always escaped when rendered.

**User input**: Always validate user-provided URLs before using them in `href` or `src`:
```tsx
const UserLink = Effect.gen(function* (props: { url: string }) {
  // Validate before rendering
  const safeUrl = yield* SafeUrl.validate(props.url)
  return <a href={safeUrl}>Link</a>
}).pipe(
  Effect.catchTag("UnsafeUrlError", (error) =>
    Effect.succeed(<span>Invalid URL: {error.scheme}</span>)
  )
)
```

---

## 13. API Routes

effect-ui provides file-based API route discovery with Effect HttpApi integration.

### 13.1 Overview

API routes use the `app/api/` directory convention (like Next.js). Two file types are supported:

| File | Export | Contains | When to Use |
|------|--------|----------|-------------|
| `route.ts` | `endpoint` + `handler` | Single `HttpApiEndpoint` | One HTTP method on this path |
| `group.ts` | `group` + `handlers` | `HttpApiGroup` | Multiple HTTP methods on this path |

### 13.2 Configuration

Enable API routes by specifying the `app` option:

```typescript
// vite.config.ts
import { defineConfig } from "vite"
import effectUI from "effect-ui/vite-plugin"

export default defineConfig({
  plugins: [effectUI({ app: "./app" })]
})
```

The plugin generates:
- `virtual:effect-ui-api` - Composed HttpApi and handler layers
- `api-routes.d.ts` - Type declarations for the virtual module

### 13.3 Type Utilities

The `Api` namespace provides type utilities for compile-time validation:

```typescript
import { HttpApiEndpoint, HttpApiGroup } from "@effect/platform"
import type { Api } from "effect-ui"

// Single endpoint
export const endpoint = HttpApiEndpoint.get("getUser", "/api/users/:id")
  .setPath(Schema.Struct({ id: Schema.String }))
  .addSuccess(UserSchema)

export const handler: Api.Handler<typeof endpoint> = ({ path }) =>
  UserService.findById(path.id)

// Group with multiple endpoints
export const group = HttpApiGroup.make("users")
  .add(HttpApiEndpoint.get("listUsers", "/api/users"))
  .add(HttpApiEndpoint.post("createUser", "/api/users").setPayload(CreateUser))

export const handlers: Api.GroupHandlers<typeof group> = {
  listUsers: () => UserService.list(),
  createUser: ({ payload }) => UserService.create(payload)
}
```

### 13.4 File Convention

**Single endpoint (`app/api/users/[id]/route.ts`):**
```typescript
import { HttpApiEndpoint } from "@effect/platform"
import { Schema } from "effect"
import type { Api } from "effect-ui"

// Path must match filesystem: app/api/users/[id] -> /api/users/:id
export const endpoint = HttpApiEndpoint.get("getUser", "/api/users/:id")
  .setPath(Schema.Struct({ id: Schema.String }))
  .addSuccess(UserSchema)

export const handler: Api.Handler<typeof endpoint> = ({ path }) =>
  UserService.findById(path.id)
```

**Multiple methods (`app/api/users/group.ts`):**
```typescript
import { HttpApiEndpoint, HttpApiGroup } from "@effect/platform"
import type { Api } from "effect-ui"

const list = HttpApiEndpoint.get("listUsers", "/api/users")
  .addSuccess(Schema.Array(UserSchema))

const create = HttpApiEndpoint.post("createUser", "/api/users")
  .setPayload(CreateUserSchema)
  .addSuccess(UserSchema)

export const group = HttpApiGroup.make("users")
  .add(list)
  .add(create)

export const handlers: Api.GroupHandlers<typeof group> = {
  listUsers: () => UserService.list(),
  createUser: ({ payload }) => UserService.create(payload)
}
```

### 13.5 Services Layer

Provide service implementations via `app/services.ts`:

```typescript
// app/services.ts
import { Layer } from "effect"
import { UserRepositoryLive, AuthServiceLive } from "@/lib/services/index.js"

export const services = Layer.mergeAll(
  UserRepositoryLive,
  AuthServiceLive
)
```

### 13.6 Build-Time Validation

The plugin validates API routes at build time:

1. **Conflict detection**: Same path cannot have both `route.ts` and `group.ts`
2. **Export validation**: Files must export expected types
3. **Path matching**: Endpoint paths must match filesystem location

### 13.7 Client Usage

Use Effect's `HttpApiClient` with the generated api:

```typescript
import { api } from "virtual:effect-ui-api"
import { HttpApiClient } from "@effect/platform"

const client = yield* HttpApiClient.make(api, { baseUrl: "/api" })
const user = yield* client.users.getUser({ path: { id: "123" } })
```

### 13.8 Path Parameter Rules

| Filesystem | Derived Path | Schema Requirement |
|------------|--------------|-------------------|
| `[id]/route.ts` | `/:id` | `{ id: Schema.String }` |
| `[...rest]/route.ts` | `/*` | `{ rest: Schema.String }` |
| `users/route.ts` | `/users` | (none) |

---

## 14. Resource (Data Fetching)

The `Resource` module provides cached, deduplicated data fetching with stale-while-revalidate support.

### 14.1 ResourceState

A tagged enum representing the state of a resource fetch:

```typescript
type ResourceState<A, E> =
  | { _tag: "Pending" }
  | { _tag: "Success"; value: A; stale: boolean }
  | { _tag: "Failure"; error: E; staleValue: Option<A> }
```

**State constructors:**
- `Resource.Pending<A, E>()` - Initial/loading state
- `Resource.Success<A, E>(value, stale)` - Fetch succeeded
- `Resource.Failure<A, E>(error, staleValue)` - Fetch failed (may include previous value)

**Type guards:**
- `Resource.isPending(state)` / `Resource.isSuccess(state)` / `Resource.isFailure(state)`

### 14.2 Resource.make

Create a resource descriptor:

```typescript
const userResource = Resource.make({
  key: "user:123",           // Unique cache key
  fetch: fetchUser("123")    // Effect<User, UserNotFound, never>
})
```

**Key rules:**
- Keys must be unique across the app
- Use descriptive keys: `"user:123"`, `"posts:page:2"`, `"search:react"`
- Resources with the same key share state

### 14.3 Resource.fetch

Fetch a resource, returning a reactive `Signal<ResourceState<A, E>>`:

```typescript
const UserProfile = Effect.gen(function* () {
  const state = yield* Resource.fetch(userResource)
  // state: Signal<ResourceState<User, UserNotFound>>
  
  return yield* Resource.match(state, {
    Pending: () => <Spinner />,
    Success: (user, stale) => <UserCard user={user} />,
    Failure: (error, staleValue) => <ErrorView error={error} />
  })
})
```

**Behavior:**
- Returns cached state if available
- Deduplicates concurrent fetches (same key = same signal)
- Forked execution - returns immediately with Pending state

### 14.4 Resource.match

Pattern match on resource state with fine-grained reactivity:

```typescript
return yield* Resource.match(state, {
  Pending: () => <Spinner />,
  Success: (user, stale) => (
    <div style={{ opacity: stale ? 0.5 : 1 }}>
      <h1>{user.name}</h1>
    </div>
  ),
  Failure: (error, staleValue) =>
    Option.match(staleValue, {
      onNone: () => <ErrorView error={error} />,
      onSome: (user) => (
        <>
          <ErrorBanner error={error} />
          <StaleUserCard user={user} />
        </>
      )
    })
})
```

**How it works:**
- Uses `Signal.derive` internally for fine-grained updates
- Returns `Element.SignalElement` - component renders once, DOM updates when state changes

### 14.5 Resource.invalidate

Trigger background refetch with stale-while-revalidate:

```typescript
<button onClick={() => Resource.invalidate(userResource)}>
  Refresh
</button>
```

**Behavior:**
1. Marks current Success state as `stale: true`
2. Shows stale UI immediately (no loading spinner)
3. Triggers background refetch
4. Updates to fresh data when complete
5. On failure, preserves stale value in `Failure.staleValue`

### 14.6 Resource.refresh

Force immediate refetch with loading state:

```typescript
<button onClick={() => Resource.refresh(userResource)}>
  Reload
</button>
```

**Behavior:**
1. Transitions to `Pending` immediately
2. Shows loading UI
3. Triggers new fetch
4. Updates to Success or Failure

### 14.7 Resource.clear

Remove resource from cache:

```typescript
yield* Resource.clear(userResource)
// Next fetch will start fresh
```

### 14.8 State Transitions

```
Initial fetch:
  (no entry) → Pending → Success | Failure(staleValue: None)

invalidate (stale-while-revalidate):
  Success(value) → Success(value, stale=true) → Success(newValue) | Failure(staleValue: Some(value))

refresh (hard reload):
  Success | Failure → Pending → Success | Failure(staleValue: None)
```

### 14.9 ResourceRegistry

Resources are cached in `ResourceRegistry`, provided automatically by `mount()`.

For testing, provide the layer explicitly:

```typescript
it.scoped("should fetch user", () =>
  Effect.gen(function* () {
    const state = yield* Resource.fetch(userResource)
    yield* TestClock.adjust(0)
    // ...
  }).pipe(Effect.provide(Resource.ResourceRegistryLive))
)
```

### 14.10 Complete Example

```typescript
import { Effect, Option } from "effect"
import { Resource } from "effect-ui"
import { HttpApiClient } from "@effect/platform"
import { api } from "virtual:effect-ui-api"

// Define resource
const userResource = (id: string) => Resource.make({
  key: `user:${id}`,
  fetch: Effect.gen(function* () {
    const client = yield* HttpApiClient.make(api)
    return yield* client.users.getUser({ path: { id } })
  })
})

// Component
const UserProfile = Effect.gen(function* () {
  const { id } = yield* params("/users/:id")
  const state = yield* Resource.fetch(userResource(id))

  return yield* Resource.match(state, {
    Pending: () => <UserSkeleton />,
    
    Success: (user, stale) => (
      <article style={{ opacity: stale ? 0.7 : 1 }}>
        <h1>{user.name}</h1>
        <p>{user.email}</p>
        <button onClick={() => Resource.invalidate(userResource(id))}>
          {stale ? "Refreshing..." : "Refresh"}
        </button>
      </article>
    ),
    
    Failure: (error, staleUser) => (
      <div>
        <ErrorBanner error={error} />
        {Option.match(staleUser, {
          onNone: () => (
            <button onClick={() => Resource.refresh(userResource(id))}>
              Try Again
            </button>
          ),
          onSome: (user) => <StaleUserCard user={user} />
        })}
      </div>
    )
  })
})
```
