# Global storage

Most state belongs to one component and dies with it. Some does not: the active theme, the signed-in user, a shopping cart, a set of feature flags. When state has to outlive a single component or be read and written from across the tree, put it in a Service. The Service owns the Signals; components read them straight from JSX for fine-grained updates and call typed Effect methods to change them. You provide it once, near the root, and every descendant shares the one instance.

This is the dependency injection you already use for any Effect service. There is no new concept here — a Layer that happens to hold reactive state.

## A store is a Service that owns Signals

Here is a theme store. It keeps the current mode and its derived tokens in Signals, and exposes a single `toggle` method as the only way to change them:

```tsx
import { Effect, Layer } from "effect";
import * as Context from "effect/Context";
import { Signal } from "trygg";

type ThemeMode = "light" | "dark";

interface ThemeTokens {
  readonly background: string;
  readonly text: string;
}

const themeForMode = (mode: ThemeMode): ThemeTokens =>
  mode === "light"
    ? { background: "#ffffff", text: "#1a1a2e" }
    : { background: "#1a1a2e", text: "#eaeaea" };

class ThemeStore extends Context.Service<
  ThemeStore,
  {
    readonly mode: Signal.Signal<ThemeMode>;
    readonly tokens: Signal.Signal<ThemeTokens>;
    readonly toggle: () => Effect.Effect<void>;
  }
>()("app/ThemeStore") {}

const ThemeStoreLive = Layer.effect(
  ThemeStore,
  Effect.gen(function* () {
    const mode = yield* Signal.make<ThemeMode>("light");
    const tokens = yield* Signal.make(themeForMode("light"));

    return {
      mode,
      tokens,
      toggle: () =>
        Effect.gen(function* () {
          const next: ThemeMode = (yield* Signal.peek(mode)) === "light" ? "dark" : "light";
          yield* Signal.set(mode, next);
          yield* Signal.set(tokens, themeForMode(next));
        }),
    };
  }),
);
```

The interface exposes the Signals as readable values and `toggle` as the only writer. Callers never touch `Signal.set` — the store decides how a change happens, so an update can validate, derive, or log before it lands. `Signal.peek` reads the current mode inside the method without subscribing anything.

## Components read the Signals and call the methods

A consumer `yield*`s the store like any service, binds a Signal directly into JSX for a surgical update, and calls `toggle` from a handler:

```tsx
import { Component } from "trygg";

const ThemeToggle = Component.gen(function* () {
  const theme = yield* ThemeStore;

  return <button onClick={() => theme.toggle()}>Theme: {theme.mode}</button>;
});
```

Reading `theme.mode` in the markup binds that one text node; toggling updates it in place without re-running the component. Because the Signal is shared, a sibling that reads `theme.tokens` for its colors updates at the same moment, with no prop threading between them.

## Provide it once, near the root

Mount the store on a boundary that wraps everyone who needs it:

```tsx
const App = Component.gen(function* () {
  return <Shell />;
}).pipe(Component.provide(ThemeStoreLive));
```

`Component.provide` owns the Layer's scope: the Signals are created when the subtree mounts and disposed when it unmounts. The state persists across navigations for as long as that boundary stays mounted, and a missing `ThemeStoreLive` is a type error at the `mount` boundary rather than a runtime surprise.

## When a Service beats a module-level Signal

A bare `Signal.make` at module scope is fine for small, app-wide state with no real invariants. Reach for a Service when you want one of these:

- **Encapsulated writes.** The raw Signal stays private; every mutation goes through a method you control.
- **Testability.** Swap `ThemeStoreLive` for a fixture Layer in a test and the components under test never notice.
- **Scoped lifecycle.** The state lives and dies with the providing boundary instead of for the lifetime of the module.
- **Typed requirements.** A component that needs the store declares it in its type, so you cannot forget to provide it.
