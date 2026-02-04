# Common Errors and Troubleshooting

## Quick Reference

| Error | Module | Cause |
|-------|--------|-------|
| `InvalidComponentError` | component | Plain function or raw Effect used as JSX component |
| `ComponentGenError` | component | `Component.gen` called with non-generator argument |

| `SignalInitError` | signal | `Signal.each` used before main `trygg` module imported |
| `PortalTargetNotFoundError` | portal | Portal target selector doesn't match any element |
| `ElementNotFoundError` | testing | Query method couldn't find matching element |
| `WaitForTimeoutError` | testing | `waitFor` assertion didn't pass within timeout |
| `UnsafeUrlError` | security | URL with blocked scheme (e.g. `javascript:`) |

---

## Error Details

### `InvalidComponentError` — plain function

**Cause:** Plain function used as JSX component instead of `Component.gen`
**Solution:** Wrap in `Component.gen`

```tsx
// WRONG
const Bad = () => <div>Hello</div>

// CORRECT
const Good = Component.gen(function* () {
  return <div>Hello</div>
})
```

### `InvalidComponentError` — raw Effect

**Cause:** `Effect<Element>` used directly as JSX element type
**Solution:** Wrap in `Component.gen`

```tsx
// WRONG
const bad = Effect.succeed(<div>Hello</div>)
return <bad />

// CORRECT
const Good = Component.gen(function* () {
  return <div>Hello</div>
})
```

### `SignalInitError` — "Signal.each is not initialized"

**Cause:** Importing from internal signal module instead of `trygg`
**Solution:** Import from `trygg`

```tsx
// WRONG
import * as Signal from "trygg/Signal"

// CORRECT
import { Signal } from "trygg"
```

### `PortalTargetNotFoundError`

**Cause:** CSS selector passed to `Portal.make` doesn't match any DOM element
**Solution:** Verify selector matches an existing element, or pass `HTMLElement` directly

### `ElementNotFoundError`

**Cause:** `getByText`, `getByTestId`, or `getByRole` couldn't find a matching element
**Solution:** Verify the element is rendered; use `waitFor` if it appears asynchronously

> Note: `ElementNotFoundError` is a plain Error subclass with a manual `_tag` field, not a `Data.TaggedError`. It works with try/catch but cannot be yielded directly.

### `WaitForTimeoutError`

**Cause:** Assertion inside `waitFor` didn't pass within the timeout period
**Solution:** Check that state updates are firing; increase timeout if async operation is slow

> Note: `WaitForTimeoutError` is a plain Error subclass with a manual `_tag` field, not a `Data.TaggedError`. It works with try/catch but cannot be yielded directly.

### `UnsafeUrlError`

**Cause:** `href` or `src` attribute contains a blocked scheme (e.g. `javascript:`)
**Solution:** Use allowed schemes (`http`, `https`, `mailto`, `tel`, `sms`, `blob`, `data`) or add custom schemes:

```tsx
import { SafeUrl } from "trygg"
SafeUrl.allowSchemes(["myapp", "web+myapp"])
```

---

## Anti-Patterns

### Using `as` or `!` type assertions

**Cause:** Bypasses type safety, hides potential null/undefined bugs
**Solution:** Use null checks, `Option`, or pattern matching

```tsx
// WRONG
const el = document.getElementById("root")!
const value = something as string

// CORRECT: null-guard
const el = document.getElementById("root")
if (el) mount(el, <App />)

// CORRECT: Option for nullable values
const value = Option.fromNullable(something)
```

### Using `new Error()` instead of `TaggedError`

**Cause:** Untyped errors can't be caught with `catchTag` and aren't yieldable
**Solution:** Use `Data.TaggedError`

```tsx
// WRONG
Effect.fail(new Error("not found"))
Effect.die(new Error("crash"))

// CORRECT
class NotFoundError extends Data.TaggedError("NotFoundError")<{
  readonly id: string
}> {}
yield* new NotFoundError({ id: "123" })
```

### Running Effects synchronously in handlers

**Cause:** Bypasses the runtime's scheduler and error handling
**Solution:** Return Effect thunk; renderer executes via `Runtime.runFork`

```tsx
// WRONG
<button onClick={() => { Effect.runSync(Signal.set(count, 0)) }}>

// CORRECT
<button onClick={() => Signal.set(count, 0)}>
```

### Forgetting `Signal.get` subscribes

**Cause:** Using `Signal.get` when fine-grained reactivity would suffice
**Solution:** Pass signal directly to JSX for fine-grained updates

```tsx
// Re-renders on EVERY count change:
const value = yield* Signal.get(count)
return <span>{value}</span>

// Runs once, only text node updates:
return <span>{count}</span>
```

### Floating Effects (no scope)

**Cause:** `Effect.runFork` without a scope means no cleanup on unmount
**Solution:** Fork into a scope

```tsx
// WRONG: fire-and-forget
Effect.runFork(someEffect)

// CORRECT: fork into scope
yield* Effect.forkIn(someEffect, scope)
```

---

## Troubleshooting

### Component doesn't update

1. Check if you're passing signal directly (fine-grained) vs using `Signal.get` (re-render)
2. `Signal.set`/`Signal.update` skip if value is unchanged (`Equal.equals`)
3. For objects/arrays, create new references: `[...list, item]` not `list.push(item)`

### "Cannot find module 'trygg'"

**Cause:** Missing dependency or Vite plugin not configured
**Solution:** Ensure `trygg` is in `dependencies` and the plugin is active:

```tsx
// vite.config.ts
import { trygg } from "trygg/vite-plugin"
export default defineConfig({ plugins: [trygg()] })
```

### Head elements not appearing

- Only hoistable tags are moved to `<head>`: `title`, `meta`, `link`, `style`, `script`, `base`
- Use `mode="static"` to keep a head element in-place: `<style mode="static">{css}</style>`
- Deepest component wins for singleton tags (title, base)

### ErrorBoundary not catching errors

- `ErrorBoundary.catch(Component)` returns an Effect — must `yield*` it
- `.on("Tag", Handler)` matches `Data.TaggedError` `_tag` field
- Use `.catchAll(fn)` or `.exhaustive()` to finalize the builder
- Builder is immutable — each `.on()`, `.catchAll()`, `.exhaustive()` creates independent state

---

## See Also

- [component-api.md](component-api.md) — Component.gen, .provide(), ErrorBoundary, Portal, Resource
- [signals-api.md](signals-api.md) — Signal.make, derive, each, subscribe
- [effect-patterns.md](effect-patterns.md) — Event handlers, services/layers, testing, routing
