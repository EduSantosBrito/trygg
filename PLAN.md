# Effect UI - Implementation Plan

## Current Status

- **30/30 tests passing**
- **5 working examples**: Counter, Todo (with Signal.each), Theme, Form, Error Boundary
- Run examples: `bun run examples`

## Completed (Phases 1-8)

Core framework is functional:
- Virtual DOM with `Data.TaggedEnum` (Element.ts)
- Custom JSX runtime with R=never constraint
- DOM rendering with `mount()` and `render()`
- Signal-based reactivity with fine-grained updates
- **Signal.each for efficient list rendering** with stable scopes per key
- Components: Suspense, ErrorBoundary, Portal
- Testing utilities, Vite plugin

## Key Learnings

### Fine-Grained Reactivity Model

```tsx
const Counter = Effect.gen(function* () {
  const count = yield* Signal.make(0)  // Does NOT subscribe component
  
  // Pass Signal directly = fine-grained updates (no re-render)
  return (
    <button onClick={() => Signal.update(count, n => n + 1)}>
      Count: {count}
    </button>
  )
})
// Component runs ONCE. Only the text node updates.
```

**Rules:**
- `Signal.make()` creates signal, does NOT subscribe
- `Signal.get()` reads value AND subscribes component to re-render
- Pass Signal to JSX = fine-grained DOM updates
- Read with `Signal.get()` = component re-renders on change

### Equality Checks Prevent Spurious Re-renders

`Signal.set/update` use `Equal.equals` to skip notification when value unchanged:
```tsx
yield* Signal.set(error, Option.none())  // Skipped if already none
yield* Signal.update(count, n => n)      // No-op, no notification
```

### Input Focus Fix

Skip setting `value` on focused inputs - DOM is source of truth while typing. Signal catches up on blur.

### Sync Callbacks, Not Streams

`SubscriptionRef.changes` Stream had fiber scheduling issues in tests. Using sync callbacks (`Signal._listeners`) that fire immediately, then schedule re-renders via `queueMicrotask`.

### mount() Uses Effect.never

Keeps scope open. Without this, `Effect.scoped` closes immediately after mounting, running cleanup finalizers.

## Completed Features

### Signal.each for Lists (Implemented)

Efficient list rendering with stable scopes per key:

```tsx
const TodoList = Effect.gen(function* () {
  const todos = yield* Signal.make<ReadonlyArray<Todo>>([])
  
  const listElement = Signal.each(
    todos,
    (todo) => Effect.gen(function* () {
      // Nested signal - stable per todo.id!
      // Persists when other todos are added/removed
      const editing = yield* Signal.make(false)
      const isEditing = yield* Signal.get(editing)
      
      return (
        <li key={todo.id}>
          {isEditing ? <input value={todo.text} /> : <span>{todo.text}</span>}
          <button onClick={() => Signal.update(editing, e => !e)}>Edit</button>
        </li>
      )
    }),
    { key: (todo) => todo.id }
  )
  
  return <ul>{listElement}</ul>
})
```

**Key features:**
- Stable scopes per key - nested signals preserved across list updates
- Only creates/destroys scopes when items are added/removed
- Items maintain their local state when other items change
- Efficient DOM updates via keyed reconciliation

## Completed (Phase 9: Effect Embedding)

### Direct Effect Embedding (Complete)

Components are just `Effect.gen(...)` - embed directly in JSX with `{Component}`.

```tsx
import { Effect } from "effect"
import { mount, Signal, DevMode } from "effect-ui"

const Counter = Effect.gen(function* () {
  const count = yield* Signal.make(0)
  return (
    <button onClick={() => Signal.update(count, n => n + 1)}>
      Count: {count}
    </button>
  )
})

// Embed Effect directly in JSX
mount(container, <>
  {Counter}
  <DevMode />
</>)
```

**Completed**:
- [x] `normalizeChild()` handles Effects directly
- [x] JSX runtime wraps Effects as Component elements
- [x] All examples use simple `Effect.gen(...)` pattern

## Completed (Phase 9.5: Re-render Bug Fix)

The component re-render mechanism was investigated and fixed:

### Bug: Component Re-render Failed Inside Fragments

**Root cause**: When a Component was rendered inside a Fragment, the `parent` parameter was a `DocumentFragment`. After appending, the DocumentFragment became empty but the closure still referenced it. On re-render, `insertBefore(node, anchor)` failed because `anchor` had moved to the real parent.

**Fix**: Use `anchor.parentNode` instead of the captured `parent` in `renderAndPosition`. The anchor's current parent is always the correct insertion point.

```typescript
// Before (broken):
const result = yield* renderElement(childElement, componentParent, runtime)
componentParent.insertBefore(result.node, anchor)

// After (fixed):
const actualParent = anchor.parentNode
const result = yield* renderElement(childElement, actualParent, runtime)
actualParent.insertBefore(result.node, anchor)
```

### Verification

- **`Signal.get()` correctly subscribes components**: `FiberRef.get(CurrentRenderPhase)` returns the phase context during component execution
- **`has_phase: true`** confirmed in debug output
- **`accessed_signals: 1`** correctly shows signals are being tracked
- **Full re-render cycle works**: signal change → notify → schedule → re-render

### Test Coverage Added

- `tests/rerender.test.tsx` - Tests basic component re-render with Signal.get
- `tests/theme-rerender.test.tsx` - Tests the theme switching pattern with Effect.provide
- `tests/browser-structure.test.tsx` - Tests Components inside Fragments (the actual bug)
- `tests/debug-order.test.tsx` - Tests debug logging captures initial render

## Next Steps

### Phase 10: Quick Start & DX (Planned)

**Problem**: Too many manual setup steps.

**Tasks**:
- [ ] `create-effect-ui` CLI - `bun create effect-ui my-app`
- [ ] Minimal starter template
- [ ] Improve vite-plugin error messages
- [ ] Quick start documentation

### Future
- [ ] SSR support
- [ ] DevTools integration
- [ ] Documentation site
- [ ] Signal.derive optimizations (memoization)
- [ ] Computed signals with dependency tracking

## File Structure

```
src/
├── Element.ts           Virtual DOM types (including KeyedList)
├── jsx-runtime.ts       JSX transformation
├── jsx-dev-runtime.ts   Development JSX
├── jsx.d.ts             JSX type definitions
├── Renderer.ts          DOM rendering + mount() + KeyedList reconciliation
├── Signal.ts            Reactive state + Signal.each
├── vite-plugin.ts       Vite plugin
├── index.ts             Main entry
├── testing.ts           Test utilities
├── debug.ts             Debug logging
├── DevMode.ts           Debug mode component
├── components/
│   ├── Suspense.ts
│   ├── ErrorBoundary.ts
│   └── Portal.ts

examples/                5 working examples
tests/                   30 tests (including keyed-list, re-render, and browser-structure tests)
```
