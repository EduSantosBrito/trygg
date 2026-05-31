# How trygg works

Once you see the pipeline, trygg's update behavior stops being surprising: state changes touch only the DOM nodes that depend on them, in the order you wrote them. There are no dependency arrays to keep in sync, no memo wrappers to add when a render gets expensive, and no re-run of your component to reason about. This page traces the path from JSX to live DOM so you know exactly what runs, and when.

## JSX lowers to an Element tree

JSX in trygg does not produce DOM and does not call your component on every change. It builds a plain description — an `Element`, a tagged value with variants like `Intrinsic`, `Text`, `Component`, `Fragment`, and `SignalElement`. A `<div>` is an `Intrinsic` Element carrying its props and children; a `<Counter />` is a `Component` Element wrapping the setup effect that produces its subtree.

This is a description, not a render. Nothing is on screen yet, and nothing has run.

## The Renderer mounts the tree to DOM

`mount` walks the Element tree once and creates real DOM nodes. It takes an Element or an Effect that yields one — typically your root JSX — not a bare Component. It installs the browser runtime itself, so you call it directly; there is no Layer to provide and no runtime to fork.

```tsx
import { mount } from "trygg";

const root = document.getElementById("root");
if (root) {
  mount(root, <App />);
}
```

The tree you mount must have `R = never`: every Service the tree needs is provided by a Layer before this boundary. Provide a Layer to a subtree with `Component.provide`.

```tsx
import { Component } from "trygg";

// `App` and `ThemeStoreLive` are your own definitions; this shows only the call shape.
const Provided = App.pipe(Component.provide(ThemeStoreLive));
```

## Component.gen is setup that runs once

A `Component.gen` body is an Effect. The Renderer runs it one time as setup — to create local state, read props, and return the Element it renders. It does not run again when state changes.

```tsx
import { Component, Signal } from "trygg";

const Counter = Component.gen(function* () {
  const count = yield* Signal.make(0);
  return <button onClick={() => Signal.update(count, (n) => n + 1)}>Count: {count}</button>;
});
```

`Signal.make(0)` runs once. The `{count}` in JSX is a binding, not a snapshot.

## Signal updates patch the exact node

Passing a Signal into JSX binds that node to the signal's listeners. When you `Signal.set` or `Signal.update`, trygg writes the new value straight to the bound text node or attribute — no tree diff, no component re-run. `Signal.update(count, (n) => n + 1)` rewrites one text node and stops.

Reading with `yield* Signal.get(count)` is the opt-in escape hatch: it subscribes the surrounding component so it re-runs on change. Most code never needs it — pass the Signal to JSX and let the node update itself.

## Why this is the payoff

- **Predictable updates.** A change touches the nodes bound to that Signal and nothing else, so what re-runs is what you wired.
- **No dependency arrays.** Subscriptions come from where a Signal is actually used, not a hand-maintained list.
- **No memoization ceremony.** The body runs once, so there is no per-render work to cache against.

See the Signals page for derived state and keyed lists, and the Components page for props and Service requirements.
