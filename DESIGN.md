# Effect UI - Design Document

## 1. Overview

**effect-ui** is a UI framework built entirely on Effect, providing:

- **JSX as the authoring format** - Custom runtime, no React dependency
- **Components are Effects** - `Effect<Element, E, never>` with R=never constraint
- **Reactive state via Signal** - Built on SubscriptionRef, position-based identity like React hooks
- **Dependency injection via Effect.provide** - Use `Effect.provide(component, layer)` directly
- **Explicit side-effect handling** - Event handlers return Effects, executed by the renderer

### Core Principles

1. **Effect-Native**: Everything is an Effect. Use `Effect.provide` for DI, not special components.
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
    readonly effect: Effect.Effect<Element, unknown, never>
    readonly key: ElementKey | null
  }
  /** Fragment containing multiple children */
  Fragment: {
    readonly children: ReadonlyArray<Element>
  }
  /** Async boundary - shows fallback while waiting for Deferred */
  Suspense: {
    readonly deferred: Deferred.Deferred<Element, unknown>
    readonly fallback: Element
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

Enable debug logging by adding the `<DevMode />` component:

```tsx
import { mount, DevMode } from "effect-ui"

mount(container, <>
  <App />
  <DevMode />                     {/* Enable all logging */}
  <DevMode filter="signal" />     {/* Only signal events */}
</>)
```

Escape hatches (no code changes): `?effectui_debug` URL param or `localStorage.effectui_debug = "true"`.

See `OBSERVABILITY.md` for full event reference and debugging scenarios.

### 4.6 Signal.each for Lists (Implemented)

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

## 5. Dependency Injection

### 5.1 Core Principles

**Effect-native DI**: Use Effect's built-in context system. No special Provider components.

```tsx
const Header = Effect.gen(function* () {
  const theme = yield* Theme  // R = Theme
  return <header>{theme.title}</header>
})

// Provide layers to satisfy requirements
mount(
  container,
  App.pipe(Effect.provide(ThemeLayer))
)
```

### 5.2 Nested Layers

```tsx
const ThemedSection = Effect.provide(
  Effect.gen(function* () {
    const header = yield* Header
    return <section>{header}</section>
  }),
  DarkThemeLayer
)
```

---

## 6. Error Handling

### 6.1 Error Boundary

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

## 7. Testing

### 7.1 Test Utilities

```typescript
export const render = <E>(
  input: RenderInput<E>
): Effect.Effect<TestRenderResult, E | unknown, Scope.Scope>

export const click = (element: HTMLElement): Effect.Effect<void>
export const waitFor = <T>(fn: () => T): Effect.Effect<T, WaitForTimeoutError>
```

### 7.2 Test Example

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

## 8. Vite Integration

### 8.1 Vite Plugin

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

## 9. Example Application

```tsx
import { Effect } from "effect"
import { mount, Signal } from "effect-ui"

const Counter = Effect.gen(function* () {
  const [count, updateCount] = yield* Signal.makeUpdater(0)
  
  return (
    <div>
      <h1>Count: {count}</h1>
      <button onClick={() => updateCount(n => n - 1)}>-</button>
      <button onClick={() => updateCount(n => n + 1)}>+</button>
    </div>
  )
})

mount(document.getElementById("root")!, Counter)
```

---

## 10. Design Decisions Summary

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Component type | `Effect<Element, E, never>` | R=never enforced, use `yield*` to compose |
| Reactivity | `Signal` with sync callbacks | Effect-native, reliable in all environments |
| Signal API | `Signal.make()` returns Signal object | Fine-grained: pass to JSX, re-render: use `Signal.get()` |
| Subscription model | Only `Signal.get()` subscribes | Enables fine-grained updates without re-render |
| Signal props | `value={signal}` for inputs | Fine-grained DOM updates, no input focus loss |
| Async handling | `Deferred<Element, E>` | Fits Effect model, explicit Suspense boundaries |
| Rendering target | Browser DOM first | Start simple, add SSR later |
| Event handlers | Return `Effect` | Renderer handles execution via `Runtime.runFork` |
| DI pattern | `Effect.provide` directly | No Provider component, just use Effect |
| Entrypoint | `mount()` simple, `render()` composable | Easy start, flexible when needed |
| Scope lifecycle | `Effect.never` keeps scope open | Prevents cleanup from removing DOM |
