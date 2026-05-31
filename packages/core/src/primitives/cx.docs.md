# cx

Compose a class attribute from static tokens, conditionals, and Signals so that when a Signal changes only the class attribute re-binds — the Component never re-runs.

```tsx
import { Component, Signal, cx } from "trygg";

const Card = Component.gen(function* () {
  const isActive = yield* Signal.make(false);
  const activeClass = yield* Signal.derive(isActive, (on) => (on ? "active" : false));

  return (
    <div
      className={cx("card", activeClass)}
      onClick={() => Signal.update(isActive, (on) => !on)}
    >
      Toggle
    </div>
  );
});
```

## When to use

Reach for `cx` whenever a `className` mixes a static token with values that may be falsy or Signal-backed, and you want one helper to cover both static and reactive styling.

- Static styling: pass strings, `false`/`null`/`undefined` sentinels, and a conditional object map. `cx` resolves to a plain `string`.
- Reactive styling: pass a `Signal` as one of the arguments. `cx` resolves to a `Signal<string>`, and the renderer binds it so only the class attribute updates on change.

Skip `cx` when you have a single unconditional string literal — write it directly. Reach for `Signal.derive` (not the object map) when a class depends on a Signal, because the object map only accepts plain booleans.

## Behavior

`cx` returns an Effect, and the `className` prop accepts that Effect directly: write `className={cx(...)}` and the renderer resolves it for you — no `yield*` at the call site. Outside JSX you can `yield* cx(...)` to read the resolved value. `cx` accepts a spread of `ClassInput` values and filters falsy ones out:

- Strings are kept as-is.
- An object map (`Record<string, boolean | undefined>`) contributes each key whose value is truthy: `cx("nav", { active: true, disabled: false })` yields `"nav active"`.
- A `Signal` contributes only when its current value is a non-empty string. A `Signal<boolean>` of `true` adds nothing — model a conditional class as a `Signal<string | false>`, typically from `Signal.derive`.

The resolved shape depends on the inputs. With no Signal inputs, `cx` resolves the classes once and yields a plain `string`. With at least one Signal input, it yields a `Signal<string>`: it reads each Signal once via a non-reactive peek (so resolving the class string does not subscribe the surrounding Component), then subscribes internally and recomputes the output Signal when any input Signal changes.

Sharp edge — a Signal cannot live inside the object map. Object map values are typed `boolean | undefined`, so `cx("card", { active: someSignal })` will not type-check. Pass the Signal as its own argument instead: `cx("card", activeClass)` where `activeClass` is a `Signal<string | false>`.

Lifecycle — the internal subscriptions register against the current render scope (falling back to the ambient `Scope` when there is none) and are removed when that scope closes, so a `cx` result used in a mounted Element stops listening when its subtree unmounts.

## Related exports

- `cx` — compose a class attribute from tokens, conditionals, and Signals
- `ClassInput` — an accepted argument: string, object map, or Signal
- `ClassValue`

## Troubleshooting

- Class attribute never updates when a Signal changes: you likely passed the Signal inside the object map (where its value was treated as truthy once) or passed a `Signal<boolean>` (which contributes no class string). Pass the Signal as a top-level argument and derive it to a `Signal<string | false>`.
- `cx` resolves to a `string` when you expected a `Signal<string>`: none of the arguments were Signals. `cx` only upgrades to a reactive `Signal<string>` when at least one input is a Signal.