# Effect UI - Implementation Plan

## Current Status

- **65/65 tests passing** (including 22 router tests + 5 loading/error tests)
- **11 working examples as single routed app**
- **File-based routing** with type-safe navigation, layouts, loading/error states, guards
- **Router included by default** in `mount()`
- Run examples: `bun run examples`

---

## Next Priority: ManagedRuntime Architecture

### Problem Statement

Current implementation uses ad-hoc runtime capture (`Effect.runtime<never>()`) and passes `Runtime.Runtime<never>` through the render tree. This has issues:

1. **FiberRefs don't propagate** - Event handlers and re-renders run in new fibers without parent FiberRefs
2. **Memory leaks** - `Signal.derive` subscriptions never cleaned up
3. **Inconsistent patterns** - Mix of `Runtime.runFork/runSync` and `Effect.fork*` variants

### Solution: FiberRef-based Runner Access

Use a `CurrentRunner` FiberRef set via `Effect.locally` so all code within mount scope has access to the runner.

**Key Finding**: Child fibers inherit FiberRefs at fork time via `fiberRefs.forkAs()` in Effect's fiberRuntime.ts:2459. So `Effect.locally` works correctly - forked children get the FiberRef value.

### Architecture

```
mount()
  │
  ├─ Create ManagedRuntime from layers
  │
  └─ Effect.locally(render(...), CurrentRunner, runner)
       │
       ├─ All child effects have CurrentRunner FiberRef
       │
       ├─ Event handlers: yield* FiberRef.get(CurrentRunner) → runner.runFork
       │
       ├─ Re-renders: yield* FiberRef.get(CurrentRunner) → runner.runFork
       │
       └─ Signal.derive: yield* FiberRef.get(CurrentRunner) → runner.runSync
```

### Implementation Plan

#### Phase 1: Core Runtime Infrastructure

| Task | File | Description |
|------|------|-------------|
| 1.1 | `src/runtime.ts` (NEW) | Create `CurrentRunner` FiberRef, runner interface |
| 1.2 | `Renderer.ts` | Update `mount()` to create ManagedRuntime, use `Effect.locally` |
| 1.3 | `Renderer.ts` | Update `renderElement` to read runner from FiberRef |
| 1.4 | `Renderer.ts` | Update event handlers to use `runner.runFork` |
| 1.5 | `Renderer.ts` | Update re-render to use `runner.runFork` |

#### Phase 2: Memory Leak Fixes

| Task | File | Description |
|------|------|-------------|
| 2.1 | `Signal.ts` | Update `derive()` to use FiberRef runner |
| 2.2 | `Signal.ts` | Add `Effect.addFinalizer` for subscription cleanup |
| 2.3 | `RouterService.ts` | Add cleanup for popstate listener |

#### Phase 3: Testing Infrastructure

| Task | File | Description |
|------|------|-------------|
| 3.1 | `testing.ts` | Create isolated test ManagedRuntime |
| 3.2 | `testing.ts` | Set `CurrentRunner` FiberRef in test utilities |

### File Structure Change

```
src/
├── runtime.ts (NEW)      # CurrentRunner FiberRef, EffectRunner interface
├── Renderer.ts           # Uses runtime.ts
├── Signal.ts             # Uses runtime.ts for derive()
└── router/RouterService.ts # Uses runtime.ts for popstate
```

This avoids circular dependency: `runtime.ts` has no imports from other src files.

---

## Known Issues & Technical Debt

### FIXED: Route Signal Collision Bug (January 2026)

**Symptoms**: Signal updates fire but `listener_count: 0`. Signal IDs reused across routes with different types:
```
signal.update {signal_id: 'sig_5', prev_value: 'Jane Doe', value: false}  // Wrong type!
```

**Root Cause**: `Outlet.ts:renderComponent` was yielding route effects directly in Outlet's render phase. When Outlet re-renders after navigation, its `signalIndex` resets to 0 but signals array persists. New route's signals reuse same positions.

**Fix**: Wrap route components in `componentElement()` so each route gets its own isolated render phase:
```typescript
// Before (broken):
return component as Effect.Effect<Element, unknown, never>

// After (fixed):
return Effect.succeed(
  componentElement(() => component as Effect.Effect<Element, unknown, never>)
)
```

---

### HIGH PRIORITY: Memory Leaks

| Issue | Location | Fix |
|-------|----------|-----|
| `Signal.derive` leak | `Signal.ts:415-427` | Add `Effect.addFinalizer(unsubscribe)` |
| popstate listener leak | `RouterService.ts:213` | Add `removeEventListener` cleanup |
| Outlet module state | `Outlet.ts:22` | Convert `_currentOutletChild` to FiberRef |

### MEDIUM PRIORITY: Non-Effect Patterns

Found by codebase analysis - places using vanilla JS that could use Effect:

| Pattern | Location | Suggested Fix | Priority |
|---------|----------|---------------|----------|
| Mutable render state | `Renderer.ts:334-338` | Use `Ref` | Nice to have |
| Manual cleanup arrays | `Renderer.ts:169,183` | Use `Scope.addFinalizer` | Nice to have |
| Imperative loops | `Renderer.ts:298-302` | Use `Effect.forEach` | Should fix |
| Module-level debug state | `debug.ts:283-284` | Use `FiberRef` | Nice to have |

### LOW PRIORITY: Type Safety

| File | Issue | Status |
|------|-------|--------|
| `Component.ts` | Multiple `as` casts for layer inference | Documented, complex to fix |
| `Signal.ts` | `AnySignal` uses `any` | Acceptable (internal) |
| `RouterService.ts` | Params cast to caller type | Consider Schema validation |

---

## Key Decisions & Findings

### FiberRef Propagation (January 2026)

**Finding**: Effect's `fiberRefs.forkAs()` copies parent FiberRefs to child fibers at fork time.
- `Effect.locally(effect, ref, value)` sets FiberRef for duration of `effect`
- Child fibers forked within `effect` inherit the FiberRef value
- This enables FiberRef-based runner access without module-level state

### Sync Callbacks Design (Documented)

Signal listeners use sync callbacks (`Set<() => void>`) instead of Effect Streams because:
- Streams had fiber scheduling issues in tests
- Sync callbacks fire immediately, then schedule re-renders via `queueMicrotask`
- More reliable for fine-grained DOM updates

### Suspense Scope Bug Fix (January 2026)

Changed `Effect.forkScoped` to `Effect.forkDaemon` in Suspense handler because the parent re-render scope closes when re-render completes, interrupting the fiber before Deferred resolves.

### Router FiberRef Pattern

`CurrentRouter` is a FiberRef set during layer building. Works because:
1. `Router.browserLayer` sets the FiberRef
2. Fibers forked through ManagedRuntime inherit FiberRefs
3. `getRouter` reads via `FiberRef.get(CurrentRouter)`

---

## Development Roadmap

### Current Phase: Runtime Architecture Refactor

1. **ManagedRuntime + FiberRef** - Proper fiber management
2. **Memory leak fixes** - Signal.derive, popstate cleanup
3. **Effect idioms** - Replace imperative patterns

### Future Phases

| Phase | Goal | Status |
|-------|------|--------|
| Type Safety | Eliminate `as` casts in Component.ts | Planned |
| Data Layer | Query/mutation with caching (@effect/rpc) | Planned |
| Forms | Effect Schema validation | Planned |
| SSR | Server rendering + hydration | Future |

---

## File Structure

```
src/
├── index.ts             # Main exports
├── runtime.ts           # CurrentRunner FiberRef (NEW)
├── Element.ts           # Virtual DOM types
├── Signal.ts            # Reactive state
├── Renderer.ts          # DOM rendering + mount()
├── Component.ts         # Component.gen API
├── router/              # File-based routing
├── components/          # Suspense, ErrorBoundary, Portal
├── testing.ts           # Test utilities
├── debug.ts             # Observability events
└── vite-plugin.ts       # Vite integration

examples/                # Single routed app with all examples
tests/                   # 65 tests
```

---

## Completed Features

- ✅ Virtual DOM with `Data.TaggedEnum`
- ✅ Signal-based fine-grained reactivity
- ✅ Signal.each for efficient list rendering
- ✅ Component.gen API with layer prop inference
- ✅ Suspense, ErrorBoundary, Portal components
- ✅ File-based routing with type-safe params
- ✅ Layout support (`_layout.tsx`)
- ✅ Loading states (`_loading.tsx`)
- ✅ Error boundaries (`_error.tsx`)
- ✅ Route guards
- ✅ Router observability events
- ✅ create-effect-ui CLI
- ✅ DevMode debugging component
