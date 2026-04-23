# Signal

## When to use

Use `Signal` for local or module-level reactive state, derived values, conditional views, suspended views, and keyed list rendering. It is also the right primitive under shared services that coordinate state across multiple components.

## Behavior

`Signal` defaults to fine-grained DOM updates when you pass a signal directly to JSX. Call `Signal.get` only when the component itself must re-run. `Signal.makeSync` is for stable module-lifetime state; `Signal.make` is for scoped state created inside Effects and components.

Under the hood, each signal is backed by a `SubscriptionRef`. When you pass a signal to JSX, the renderer subscribes individual DOM nodes to that ref. When the signal changes, only the subscribed text nodes or attributes update — the component's `gen` function does not re-run. This is why structural branching requires `Signal.get`: it forces the component to re-execute so the conditional tree can be rebuilt, while leaf updates stay surgical and skip component re-execution entirely.

Use `Signal.get` for structural branching, but keep leaf updates signal-driven:

```tsx
const AuthStatus = Component.gen(function* () {
  const signedIn = yield* Signal.make(false)
  const label = yield* Signal.derive(signedIn, (value) =>
    value ? "Sign out" : "Sign in",
  )

  const showPrivateUi = yield* Signal.get(signedIn)

  return (
    <section>
      <button onClick={() => Signal.update(signedIn, (value) => !value)}>{label}</button>
      {showPrivateUi ? <Dashboard /> : <LoginPrompt />}
    </section>
  )
})
```

For conditional rendering with a boolean signal, use `Signal.get` when the branch changes component structure, and keep leaf content signal-driven:

```tsx
const TogglePanel = Component.gen(function* () {
  const isOpen = yield* Signal.make(false)
  const showPanel = yield* Signal.get(isOpen)

  return (
    <section>
      <button onClick={() => Signal.update(isOpen, (v) => !v)}>
        {isOpen ? "Close" : "Open"}
      </button>
      {showPanel ? <PanelContent /> : null}
    </section>
  )
})
```

Notice that `isOpen` is passed directly to JSX inside the button text for a surgical text update, while `Signal.get(isOpen)` is used for the structural `?` branch. Pass signals directly to JSX when only DOM content changes; call `Signal.get` only when the component must re-run for structural decisions.

For lists, `Signal.each` keeps item scopes keyed by identity, so reordering or replacing neighbors does not tear down unchanged rows:

```tsx
const TodoList = Component.gen(function* () {
  const items = yield* Signal.make<
    ReadonlyArray<{ readonly id: string; readonly text: string }>
  >([])

  return (
    <ul>
      {Signal.each(
        items,
        (item) => Effect.succeed(<TodoRow text={item.text} />),
        { key: (item) => item.id },
      )}
    </ul>
  )
})
```

There is no separate "signal middleware" primitive. The predictable cross-component pattern is to keep the raw signal private inside a service and expose typed Effect methods that intercept, transform, validate, log, or batch updates before writing. This gives you middleware behavior with full type safety:

```tsx
import { Effect, Layer, Schedule } from "effect"
import * as Context from "effect/Context"

const rawQuery = Signal.makeSync("")

class SearchStore extends Context.Service<
  SearchStore,
  {
    readonly query: Signal.Signal<string>
    readonly setQuery: (raw: string) => Effect.Effect<void>
  }
>("example/SearchStore") {}

const SearchStoreLive = Layer.succeed(SearchStore, {
  query: rawQuery,
  setQuery: (raw) =>
    Effect.gen(function* () {
      const next = raw.trim().replaceAll(/\s+/g, " ")
      yield* Signal.set(rawQuery, next)
      yield* Effect.log(`search.query:${next}`)
    }),
})

const SearchInput = Component.gen(function* () {
  const store = yield* SearchStore
  return (
    <input
      value={store.query}
      onInput={(event) =>
        event.target instanceof HTMLInputElement
          ? store.setQuery(event.target.value)
          : Effect.void
      }
    />
  )
})

const SearchBadge = Component.gen(function* () {
  const store = yield* SearchStore
  return <p>Query: {store.query}</p>
})
```

That pattern keeps update rules in one place, preserves type safety at the boundary, and lets multiple components share one signal without directly mutating it.

For cross-component interception, compose multiple middleware concerns in the service method:

```tsx
const rawCount = Signal.makeSync(0)

class CounterStore extends Context.Service<
  CounterStore,
  {
    readonly count: Signal.Signal<number>
    readonly increment: () => Effect.Effect<void>
    readonly decrement: () => Effect.Effect<void>
  }
>("example/CounterStore") {}

const CounterStoreLive = Layer.succeed(CounterStore, {
  count: rawCount,
  increment: () =>
    Effect.gen(function* () {
      const current = yield* Signal.get(rawCount)
      if (current >= 100) {
        yield* Effect.log("max reached")
        return
      }
      yield* Signal.update(rawCount, (n) => n + 1)
      yield* Effect.log(`incremented to ${current + 1}`)
    }),
  decrement: () =>
    Effect.gen(function* () {
      const current = yield* Signal.get(rawCount)
      if (current <= 0) {
        yield* Effect.log("min reached")
        return
      }
      yield* Signal.update(rawCount, (n) => n - 1)
    }),
})
```

For debouncing, use `Effect.sleep` inside the service method so callers fire immediately but only the last update wins:

```tsx
const DebouncedSearchStoreLive = Layer.succeed(SearchStore, {
  query: rawQuery,
  setQuery: (raw) =>
    Effect.gen(function* () {
      yield* Effect.sleep("200 millis")
      const next = raw.trim()
      yield* Signal.set(rawQuery, next)
      yield* Effect.log(`debounced:${next}`)
    }),
})
```

Because the raw signal is never exported, all mutations flow through the service boundary. Components read the signal directly for fine-grained updates, but write only through typed Effect methods. This makes interception, transformation, and cross-component coordination predictable and testable.

## Related exports

- `Signal.make`
- `Signal.makeSync`
- `Signal.get`
- `Signal.modify`
- `Signal.derive`
- `Signal.suspend`
- `Signal.each`
