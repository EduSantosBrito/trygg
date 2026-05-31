# Thinking in trygg

trygg is built on the model you already use in Effect: a Component is an Effect that yields its props and services and produces an Element. Make a few shifts up front and the rest of the framework stops surprising you — state lives in Signals, the DOM updates in place, and lifecycle, errors, and services are the Effect concepts you already know rather than a separate component-layer vocabulary. This page lists the shifts worth making first.

## Components run once

`Component.gen(function* () { ... })` is the component's setup. The generator body is an Effect that runs one time when the component mounts, not on every state change. There is no virtual DOM and no re-render of the body — so this is where you create your Signals, derivations, and lifecycle effects.

```tsx
import { Component, Signal } from "trygg";

const Counter = Component.gen(function* () {
  const count = yield* Signal.make(0); // created once, at setup
  return <button onClick={() => Signal.update(count, (n) => n + 1)}>Count: {count}</button>;
});
```

Treat the body not as code that re-executes per frame, but as the place you wire up reactivity, then return the Element that describes the view.

## State is Signals, derived state is Signal.derive

`Signal.make(initial)` holds state. For computed values, `Signal.derive` (or `Signal.deriveAll` for multiple sources) recomputes when its source changes. There is no dependency array to keep in sync — the subscription is the source you passed.

```ts
const count = yield* Signal.make(0);
const doubled = yield* Signal.derive(count, (n) => n * 2);
```

Instead of `useMemo` with a manual dependency list, name the source signal and let the derivation track it. The derived signal is cleaned up with its owning scope.

## Reactivity is fine-grained

Where you read a Signal decides what updates. Pass a Signal straight into JSX and only that bound leaf — a text node or attribute — changes when it updates; nothing above it re-runs. A raw Signal object is always truthy, so a `{signal ? … : …}` ternary never toggles on its own — to branch the tree structurally, read the value with `Signal.get(signal)`, the opt-in escape hatch that subscribes the surrounding component so the body re-runs. You rarely need it.

```tsx
return <span>Count: {count}</span>; // only this text node updates
```

Instead of re-rendering a subtree to reflect new state, bind the Signal at the exact node that should change.

## Async data is Resource

For async reads, reach for `Resource` rather than firing a fetch inside an effect and tracking pending/error flags by hand. `Resource.fetch` returns a `Signal` of the state — `Pending`, `Success`, or `Failure` — and `Resource.match` renders each branch. The registry caches and deduplicates by key.

```tsx
const state = yield* Resource.fetch(usersResource);
return yield* Resource.match(state).pipe(
  Resource.on("Pending", () => <p>Loading…</p>),
  Resource.on("Success", ({ value }: { value: ReadonlyArray<string>; stale: boolean }) => (
    <ul>{value.map((name) => <li>{name}</li>)}</ul>
  )),
  Resource.on("Failure", ({ error }) => <p>{String(error)}</p>),
  Resource.exhaustive,
);
```

## Errors and services are typed and flow through Effect

A Component's failures and requirements live in its Effect type. A child `yield*`s a service; a parent provides it with `Component.provide(layer)`, which narrows the remaining `R`. By the `mount` boundary the root must reach `R = never` — a missing Layer is a type error pointing at the unsatisfied service. Typed failures are recovered at a boundary with `ErrorBoundary`, not swallowed mid-body.

Instead of context providers and thrown errors, provide a Layer to a subtree and let the error channel carry what can go wrong.

## Cleanup is scope-based

The component body runs inside an Effect scope, so cleanup is a finalizer, not a returned teardown function. Register it with `Effect.acquireRelease` or `Effect.addFinalizer` (both from `"effect"`) and it runs when the component unmounts. Signals and `Component.provide` layers are already tied to that scope.

```ts
import { Effect } from "effect";

yield* Effect.acquireRelease(
  Effect.sync(() => window.addEventListener("resize", onResize)),
  () => Effect.sync(() => window.removeEventListener("resize", onResize)),
);
```

Instead of returning a cleanup callback, acquire the resource in setup and let its finalizer run on unmount.
