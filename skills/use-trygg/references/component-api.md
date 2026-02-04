# Component API

## Component.gen

Create components using generator syntax. Two forms:

```tsx
// Without props
const Greeting = Component.gen(function* () {
  return <h1>Hello</h1>
})

// With props
const Card = Component.gen(function* (Props: ComponentProps<{ title: string; active: boolean }>) {
  const { title, active } = yield* Props
  return <div className={active ? "active" : ""}>{title}</div>
})
```

## Component.Type

Type signature: `Component.Type<Props, E, R>`

- `Props` -- component props (`never` if none)
- `E` -- error channel
- `R` -- service requirements (must be `never` at mount point)

```tsx
const Card: Component.Type<{ title: string }, never, Theme>
const Pure: Component.Type<never, never, never>
```

## Dependency Injection with .provide()

Components expose `.provide()` to satisfy service requirements:

```tsx
class Theme extends Context.Tag("Theme")<Theme, { primary: string }>() {}

const Card = Component.gen(function* () {
  const theme = yield* Theme
  return <div style={{ color: theme.primary }}>Themed</div>
})

// Single layer
const Themed = Card.provide(Layer.succeed(Theme, { primary: "blue" }))

// Multiple layers (chained)
const Full = Card.provide(themeLayer).provide(loggerLayer)

// Multiple layers (array)
const Full = Card.provide([themeLayer, loggerLayer])
```

Parent provides, child yields. The top-level component passed to `mount()` must have `R = never`.

### Dynamic provision (layer from state)

Call `.provide()` inside the render with a layer that depends on signal state:

```tsx
const ThemeSwitcher = Component.gen(function* () {
  const isDark = yield* Signal.make(false)
  const isDarkValue = yield* Signal.get(isDark)  // subscribes -- re-renders on toggle

  const currentTheme = isDarkValue ? DarkTheme : LightTheme
  const ProvidedCard = ThemedCard.provide(currentTheme)

  return (
    <div>
      <button onClick={() => Signal.update(isDark, v => !v)}>Toggle</button>
      <ProvidedCard />
    </div>
  )
})
```

When `isDark` changes, the component re-renders, `.provide()` applies the new layer, and children receive updated service values.

## mount / mountDocument

```tsx
import { mount, mountDocument } from "trygg"

// Simple mount to a container
const root = document.getElementById("root")
if (root) mount(root, <App />)

// Document-level mount (full-page apps with <html>, <head>, <body>)
mountDocument(<App />)
```

`mount` merges `browserLayer`, `Router.browserLayer`, `ResourceRegistryLive` automatically.

## Resource (Data Fetching)

### ResourceState

```typescript
type ResourceState<A, E> =
  | { _tag: "Pending" }
  | { _tag: "Success"; value: A; stale: boolean }
  | { _tag: "Failure"; error: E; staleValue: Option<A> }
```

### Creating Resources

```tsx
// No-param resource
const usersResource = Resource.make(
  () => Effect.gen(function* () {
    const c = yield* ApiClient
    return yield* c.users.listUsers()
  }),
  { key: "users.list" }
)

// Parameterized resource
const userResource = Resource.make(
  (params: { id: string }) => Effect.gen(function* () {
    const c = yield* ApiClient
    return yield* c.users.getUser({ path: params })
  }),
  { key: (params) => Resource.hash("users.getUser", params) }
)
```

### Fetching and Rendering

```tsx
const state = yield* Resource.fetch(usersResource)

return yield* Resource.match(state, {
  Pending: () => <Spinner />,
  Success: (users, stale) => <UserList users={users} opacity={stale ? 0.5 : 1} />,
  Failure: (error, staleValue) => <ErrorView error={error} />
})
```

### Cache Control

```tsx
Resource.invalidate(resource)  // Stale-while-revalidate
Resource.refresh(resource)     // Hard reload (shows Pending)
Resource.clear(resource)       // Remove from cache
```

## ErrorBoundary

Chainable builder pattern for typed error handling:

```tsx
// Define fallback as a component (can use services, signals, etc.)
const GenericError = Component.gen(function* (
  Props: ComponentProps<{ cause: Cause.Cause<unknown> }>
) {
  const { cause } = yield* Props
  return <div>Unexpected: {String(Cause.squash(cause))}</div>
})

// With catchAll -- returns Element (plain JSX or <Component />)
const Safe = yield* ErrorBoundary.catch(RiskyComponent)
  .on("NetworkError", NetworkErrorView)
  .on("ValidationError", ValidationErrorView)
  .catchAll((cause) => <GenericError cause={cause} />)

// Exhaustive (all error tags handled, no catchAll needed)
const Safe = yield* ErrorBoundary.catch(RiskyComponent)
  .on("NetworkError", NetworkErrorView)
  .on("ValidationError", ValidationErrorView)
  .exhaustive()

return <Safe userId={userId} />
```

`.on()` takes a `Component.Type` (called internally with `{ error }` props). `.catchAll()` takes a function returning `Element` -- can be plain JSX or component JSX.

## Portal

Render children into a different DOM container via `Portal.make()`:

```tsx
import { Portal } from "trygg"

const Modal = Component.gen(function* () {
  const isOpen = yield* Signal.make(false)

  const ModalPortal = yield* Portal.make(
    <div className="modal-overlay">
      <div className="modal">Content</div>
    </div>,
    { target: document.body }
  )

  return (
    <div>
      <button onClick={() => Signal.update(isOpen, v => !v)}>Toggle</button>
      <ModalPortal visible={isOpen} />
    </div>
  )
})
```

`Portal.make(content, options?)` returns `Effect<Component.Type<PortalProps, never, Scope>, PortalTargetNotFoundError, Scope>`. Options is optional (creates dynamic container on `document.body` if omitted). Target: `HTMLElement` or CSS selector string.

The `visible` prop accepts `boolean | Signal<boolean>` -- when false, portal content is unmounted.

## Head Management

Head elements in JSX are automatically hoisted to `document.head`:

```tsx
const Page = Component.gen(function* () {
  return <>
    <title>My Page</title>
    <meta name="description" content="Page description" />
    <link rel="stylesheet" href="/style.css" />
    <div>Content</div>
  </>
})
```

Hoistable tags: `title`, `meta`, `link`, `style`, `script`, `base`.

Dedup rules:
- `title` -- singleton, deepest component wins
- `base` -- singleton, deepest component wins
- `meta[name]` / `meta[property]` -- deepest wins per name
- `meta[httpEquiv]` -- deepest wins per value
- `meta[charset]` -- singleton
- `link`, `style`, `script` -- allow duplicates, cleanup on unmount

## cx (Class Names)

```tsx
import { cx } from "trygg"

// cx() returns an Effect — the renderer resolves it internally in JSX props
<div className={cx("base", isActive && "active", isDisabled && "disabled")} />

// With Signal inputs — returns Signal<string> for reactive class updates
const variant = yield* Signal.make("primary")
<button className={cx("btn", variant)} />
```

---

## See Also

- [signals-api.md](signals-api.md) — Signal.make, derive, each, subscribe (used in component bodies)
- [effect-patterns.md](effect-patterns.md) — Event handlers, services/layers, testing, routing
- [common-errors.md](common-errors.md) — InvalidComponentError, BuilderError, troubleshooting
