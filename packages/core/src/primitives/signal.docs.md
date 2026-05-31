# Signal

Hold reactive state and pass it straight into JSX so a value change updates only the bound DOM node, without re-running the Component.

```tsx
import { Component, Signal } from "trygg";

const Counter = Component.gen(function* () {
  const count = yield* Signal.make(0);

  return <button onClick={() => Signal.update(count, (n) => n + 1)}>Count: {count}</button>;
});
```

Clicking the button updates the text node in place. The generator body runs once; only the bound `{count}` node re-renders.

## When to use

Reach for `Signal` for local or module-level reactive state: counters, form fields, toggles, derived values, suspended views, and keyed lists. Pass the Signal directly to JSX whenever only a DOM value changes — this is the default and the cheapest path.

Step up to `Signal.get` only when the Component must *re-run* (for example, choosing a different subtree). For async, keyed, cacheable data, use `Resource` instead and read its state through the Signal it exposes.

## Behavior

`Signal.make(initial)` creates state owned by the surrounding scope — a Component instance, a Layer effect, or an explicit Effect scope — and disposes it when that scope closes. Inside a Component, signals are identified by creation position, so the same Signal is reused across re-runs.

There are two read modes:

- **Pass the Signal to JSX** (`{count}`): the renderer binds the individual text node or attribute to the Signal. On change, only that node updates and the Component does not re-run. This is fine-grained reactivity.
- **`Signal.get(signal)`**: returns the value *and* subscribes the current render, so the Component re-runs on change. Use it only for structural branching where the Element tree itself differs:

```tsx
const TogglePanel = Component.gen(function* () {
  const isOpen = yield* Signal.make(false);
  const label = yield* Signal.derive(isOpen, (v) => (v ? "Close" : "Open"));
  const open = yield* Signal.get(isOpen);

  return (
    <section>
      <button onClick={() => Signal.update(isOpen, (v) => !v)}>{label}</button>
      {open ? <PanelContent /> : null}
    </section>
  );
});
```

Note the derived `label` Signal passed directly into the button text (surgical text update) while `Signal.get(isOpen)` drives the `?` branch that swaps subtrees. Binding the raw `isOpen` Signal as `{isOpen ? …}` would not work — a Signal object is always truthy, so the ternary must run over the unwrapped value `open` that `Signal.get(isOpen)` returns.

Writes notify listeners. `Signal.set` and `Signal.update` are equality-checked first: writing an unchanged value is a no-op and notifies no one. `Signal.modify` reads, writes, and returns a derived result in one step and always notifies. `Signal.peek` reads the current value without subscribing, for snapshots in event handlers and service methods.

`Signal.derive(source, f)` produces a derived Signal that recomputes when its source changes, keeping the work out of JSX; `Signal.deriveAll([a, b], f)` derives from several sources. `Signal.each(source, render, { key })` renders a keyed list where items keep their Effect scope and nested signals across reorders. `Signal.selector(source, project)` is the single-subscription alternative to one derived Signal per row: a source change from `previous -> next` recomputes only the outputs registered under those two keys.

Sharp edges worth knowing before they bite:

- **A derived array of Elements needs a Fragment wrap.** `Signal.derive(sig, () => [<A />, <B />])` renders as `[object Object]`; wrap it: `Signal.derive(sig, () => <>{a}{b}</>)`.
- **Deriving a Component reads its props once.** `Signal.derive(sig, () => <Comp value={x} />)` captures props at derive time and will not track later changes. Pass the Signal *into* the Component, or resolve the value upfront, when it must stay reactive.
- **Disposed-signal access is a lifecycle edge, not a user error.** If a stale event handler, async callback, or service method touches a Signal after its owning scope closed, reads return the last snapshot and writes are no-ops. Trygg records a `signal.disposed_access` diagnostic — the read and write signatures stay clean on purpose.

For state shared across components, keep the raw Signal private inside a service and expose typed Effect methods that validate or transform before writing. This is a secondary pattern, not the headline — one minimal shape:

```tsx
import { Component, Signal } from "trygg";
import { Effect, Layer } from "effect";
import * as Context from "effect/Context";

class SearchStore extends Context.Service<
  SearchStore,
  {
    readonly query: Signal.Signal<string>;
    readonly setQuery: (raw: string) => Effect.Effect<void>;
  }
>()("example/SearchStore") {}

const SearchStoreLive = Layer.effect(
  SearchStore,
  Effect.gen(function* () {
    const query = yield* Signal.make("");
    return {
      query,
      setQuery: (raw) => Signal.set(query, raw.trim()),
    };
  }),
);
```

Components read `store.query` directly for fine-grained updates and call `store.setQuery` to write; the raw Signal is never written from outside.

## Related exports

- `Signal.make` — create reactive state owned by the surrounding scope
- `Signal.get` — read the value and subscribe the current render
- `Signal.peek` — read the current value without subscribing
- `Signal.set` — equality-checked write of a new value
- `Signal.update` — equality-checked write from the previous value
- `Signal.modify` — read, write, and return a result, always notifying
- `Signal.derive` — derive a Signal that recomputes when its source changes
- `Signal.deriveAll` — derive from several source Signals at once
- `Signal.selector` — single-subscription alternative to one derived Signal per row
- `Signal.each` — render a keyed list preserving per-item scope across reorders
- `Signal.suspend`

## Troubleshooting

- **The text shows `[object Object]`.** A `Signal.derive` is returning an array of Elements. Wrap the children in a Fragment: `<>{...}</>`.
- **A derived `<Comp />` never updates.** Deriving a Component reads its props once. Pass the Signal into the Component, or read the value with `Signal.peek` upfront.
- **A click updates the value but the screen does not change.** The branch you expected to swap is structural. Read it with `Signal.get` so the Component re-runs; pass the Signal directly only for leaf text and attributes.
- **An update silently does nothing.** Either the new value is equal to the current one (`Signal.set` and `Signal.update` are equality-checked) or the Signal's owner scope has closed — check for a `signal.disposed_access` diagnostic.