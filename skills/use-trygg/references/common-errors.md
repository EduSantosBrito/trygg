# Common Errors and Troubleshooting

## Error Types in trygg

| Error | Module | Cause |
|-------|--------|-------|
| `InvalidComponentError` | component | Plain function or raw Effect used as JSX component |
| `ComponentGenError` | component | `Component.gen` called with non-generator argument |
| `MissingServiceError` | component | Component rendered without required service layer |
| `SignalInitError` | signal | `Signal.each` used before main `trygg` module imported |
| `PortalTargetNotFoundError` | portal | Portal target selector doesn't match any element |
| `ElementNotFoundError` | testing | Query method couldn't find matching element |
| `WaitForTimeoutError` | testing | `waitFor` assertion didn't pass within timeout |
| `BuilderError` | error-boundary | Duplicate handler, catchAll called twice, or on() after catchAll |
| `UnsafeUrlError` | security | URL with blocked scheme (e.g. `javascript:`) |

## Anti-Patterns

### Using plain functions as components

```tsx
// WRONG: plain function
const Bad = () => <div>Hello</div>
// -> InvalidComponentError { reason: "plain-function" }

// CORRECT: use Component.gen
const Good = Component.gen(function* () {
  return <div>Hello</div>
})
```

### Using raw Effect as JSX element type

```tsx
// WRONG: Effect as component type
const bad = Effect.succeed(<div>Hello</div>)
return <bad />
// -> InvalidComponentError { reason: "effect" }

// CORRECT: wrap in Component.gen
const Good = Component.gen(function* () {
  return <div>Hello</div>
})
```

### Using `as` or `!` type assertions

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

### Using new Error() instead of TaggedError

```tsx
// WRONG
Effect.fail(new Error("not found"))
Effect.die(new Error("crash"))

// CORRECT
class NotFoundError extends Data.TaggedError("NotFoundError")<{
  readonly id: string
}> {}
Effect.fail(new NotFoundError({ id: "123" }))
```

### Running Effects synchronously in handlers

```tsx
// WRONG: synchronous execution
<button onClick={() => { Effect.runSync(Signal.set(count, 0)) }}>

// CORRECT: return Effect thunk
<button onClick={() => Signal.set(count, 0)}>
```

### Forgetting Signal.get subscribes

```tsx
// This re-renders on EVERY count change:
const value = yield* Signal.get(count)
return <span>{value}</span>

// This runs once, only text node updates:
return <span>{count}</span>
```

### Floating Effects (no scope)

```tsx
// WRONG: fire-and-forget
Effect.runFork(someEffect)

// CORRECT: fork into scope
yield* Effect.forkIn(someEffect, scope)
```

### Missing .provide() at parent

```tsx
// WRONG: unresolved R at mount
const App = Component.gen(function* () {
  const theme = yield* Theme  // R = Theme, not satisfied!
  return <div>{theme.name}</div>
})
mount(root, <App />)
// -> MissingServiceError

// CORRECT: provide before mount
const App = Component.gen(function* () {
  const theme = yield* Theme
  return <div>{theme.name}</div>
}).provide(themeLayer)  // R = never
mount(root, <App />)
```

## Troubleshooting

### "Signal.each is not initialized"

Import from `trygg`, not from internal signal module:

```tsx
// WRONG
import * as Signal from "trygg/Signal"

// CORRECT
import { Signal } from "trygg"
```

### Component doesn't update

1. Check if you're passing signal directly (fine-grained) vs using `Signal.get` (re-render)
2. `Signal.set`/`Signal.update` skip if value is unchanged (`Equal.equals`)
3. For objects/arrays, create new references: `[...list, item]` not `list.push(item)`

### "Cannot find module 'trygg'"

Ensure `trygg` is in `dependencies` and the Vite plugin is configured:

```tsx
// vite.config.ts
import { trygg } from "trygg/vite-plugin"
export default defineConfig({ plugins: [trygg()] })
```

### Head elements not appearing

- Only hoistable tags are moved to `<head>`: `title`, `meta`, `link`, `style`, `script`, `base`
- Use `mode="static"` to keep a head element in-place: `<style mode="static">{css}</style>`
- Deepest component wins for singleton tags (title, base)

### URL blocked by SafeUrl

Default allowed schemes: `http`, `https`, `mailto`, `tel`, `sms`, `blob`, `data`.

Add custom schemes:

```tsx
import { SafeUrl } from "trygg"
SafeUrl.allowSchemes(["myapp", "web+myapp"])
```

### ErrorBoundary not catching errors

- `ErrorBoundary.catch(Component)` returns an Effect -- must `yield*` it
- `.on("Tag", Handler)` matches `Data.TaggedError` `_tag` field
- Use `.catchAll(fn)` or `.exhaustive()` to finalize the builder
- Cannot call `.on()` after `.catchAll()` (yields `BuilderError`)
