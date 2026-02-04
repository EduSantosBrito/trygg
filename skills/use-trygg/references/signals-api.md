# Signals API

## Core Operations

| Function | Signature | Description |
|----------|-----------|-------------|
| `make` | `<A>(initial: A) => Effect<Signal<A>>` | Create signal. Position-tracked in components (like React hooks). |
| `get` | `<A>(signal: Signal<A>) => Effect<A>` | Read value. **Subscribes component to changes** (triggers re-render). |
| `set` | `<A>(signal: Signal<A>, value: A) => Effect<void>` | Set value. Skips if unchanged (uses `Equal.equals`). |
| `update` | `<A>(signal: Signal<A>, f: (a: A) => A) => Effect<void>` | Update via function. Skips if unchanged. |
| `modify` | `<A, B>(signal: Signal<A>, f: (a: A) => readonly [B, A]) => Effect<B>` | Modify and return a result. |

## Fine-Grained Reactivity

**Key rule**: `Signal.make()` does NOT subscribe the component. Only `Signal.get()` subscribes.

```tsx
// FINE-GRAINED: component runs once, only text node updates on change
const Counter = Component.gen(function* () {
  const count = yield* Signal.make(0)
  return <span>Count: {count}</span>  // pass signal directly
})

// RE-RENDER: component re-runs on every change (use sparingly)
const View = Component.gen(function* () {
  const mode = yield* Signal.make<"edit" | "view">("view")
  const modeValue = yield* Signal.get(mode)  // subscribes!
  return modeValue === "edit" ? <Editor /> : <Display />
})
```

### Signal Props

Props accept signals for fine-grained DOM attribute updates:

```tsx
const email = yield* Signal.make("")
const isValid = yield* Signal.derive(email, v => v.includes("@"))

return <input value={email} disabled={isValid} />
// Both value and disabled update without re-rendering the component
```

## Derived Signals

### derive -- single source

```tsx
const count = yield* Signal.make(0)
const doubled = yield* Signal.derive(count, n => n * 2)
// doubled updates eagerly when count changes
```

### deriveAll -- multiple sources (up to 6)

```tsx
const count = yield* Signal.make(0)
const name = yield* Signal.make("hello")

const label = yield* Signal.deriveAll(
  [count, name],
  (c, n) => `${n}: ${c}`
  //  ^number ^string -- fully inferred
)
```

### Derived Signal for Conditional Rendering

Use `Signal.derive` returning an `Element` for fine-grained DOM swaps without re-render:

```tsx
const editText = yield* Signal.make<Option<string>>(Option.none())
const content = yield* Signal.derive(editText, value =>
  Option.isSome(value) ? <input /> : <span>Display</span>
)
return <div>{content}</div>  // Signal<Element> -> SignalElement (DOM swap, no re-render)
```

### Explicit Scope

Derived signals auto-cleanup when the component scope closes. For long-lived signals:

```tsx
const scope = yield* Scope.make()
const doubled = yield* Signal.derive(count, n => n * 2, { scope })
// Later: yield* Scope.close(scope, Exit.void)
```

## Signal.each -- Keyed List Rendering

Efficient list rendering with stable scopes per key:

```tsx
const todos = yield* Signal.make<ReadonlyArray<Todo>>([])

const listElement = Signal.each(
  todos,
  (todo) => Effect.gen(function* () {
    // This signal is stable per todo.id -- preserved across list updates
    const editing = yield* Signal.make(false)
    return (
      <li>
        <span>{todo.text}</span>
        {editing ? <input /> : null}
      </li>
    )
  }),
  { key: (todo) => todo.id }
)

return <ul>{listElement}</ul>
```

Key properties:
- Each item gets a stable Effect scope
- Nested signals persist across list updates (same key = same scope)
- Uses LIS-based reconciliation for minimal DOM moves
- Key function: `(item: T, index: number) => string | number`

## Signal.suspend -- Async Component Suspension

Track async state with Pending/Success/Failure views:

```tsx
const UserProfile = Component.gen(function* (Props: ComponentProps<{ userId: Signal<number> }>) {
  const { userId } = yield* Props
  const id = yield* Signal.get(userId)
  const user = yield* fetchUser(id)
  return <UserCard user={user} />
})

const SuspendedProfile = yield* Signal.suspend(UserProfile, {
  Pending: (stale) => stale ?? <Spinner />,
  Failure: (cause, stale) => stale ?? <ErrorView cause={cause} />,
  Success: <UserProfile userId={userId} />
})

return <SuspendedProfile />
```

- `Pending` -- shown during async work. Receives stale element if dep-key previously rendered.
- `Failure` -- shown on error. Receives Cause and optional stale element.
- `Success` -- the component to render (JSX element).
- Caches results by dependency key (signals read via `Signal.get`).

## Signal.subscribe

Low-level subscription API. Returns an unsubscribe Effect:

```tsx
const unsubscribe = yield* Signal.subscribe(count, () =>
  Effect.log("count changed")
)
// Later: yield* unsubscribe
```

Listeners run in parallel with error isolation. Failing listeners don't crash others.
