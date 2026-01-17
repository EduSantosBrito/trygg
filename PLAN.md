# Effect UI - Implementation Plan

## Current Status

- **38/38 tests passing**
- **6 working examples**: Counter, Todo (with Signal.each), Theme, Form, Error Boundary, Dashboard
- **All examples use Component.gen** API with automatic layer prop inference
- **create-effect-ui CLI** for scaffolding new projects
- Run examples: `bun run examples`

---

## Framework Analysis (January 2026)

### What the Framework Does Well

1. **Effect-native design**: Components are `Effect<Element, E, never>`, making side effects explicit
2. **Virtual DOM with TaggedEnum**: Clean element representation using `Data.taggedEnum`
3. **Fine-grained reactivity**: Signal-based updates that don't re-render entire components
4. **Type-safe dependency injection**: Uses Effect's Context system elegantly
5. **Custom JSX runtime**: Both production and dev runtimes with source mapping
6. **Observability infrastructure**: Wide events pattern for debugging (see OBSERVABILITY.md)

### Architecture Overview

```
┌─────────────────────────────────────────────────────────────┐
│                        Application                          │
├─────────────────────────────────────────────────────────────┤
│  Component.gen API     │  Signal API      │  JSX Runtime    │
│  - Typed props         │  - make/get/set  │  - jsx/jsxs     │
│  - Layer inference     │  - derive/each   │  - Fragment     │
├─────────────────────────────────────────────────────────────┤
│                     Element (Virtual DOM)                   │
│  Intrinsic │ Text │ SignalText │ Component │ Fragment │ ... │
├─────────────────────────────────────────────────────────────┤
│                        Renderer                             │
│  - mount()  │  - renderElement()  │  - Cleanup/Lifecycle    │
├─────────────────────────────────────────────────────────────┤
│                     Browser DOM                             │
└─────────────────────────────────────────────────────────────┘
```

---

## Known Issues & Technical Debt

### HIGH PRIORITY: Type Safety Violations

The `AGENTS.md` states "No type casting" but several files contain `as` casts that should be eliminated:

| File | Lines | Issue | Status |
|------|-------|-------|--------|
| `src/Component.ts` | 150 | Cast `regularProps as P` | **TODO** |
| `src/Component.ts` | 278 | Cast after Effect.provide | **TODO** |
| `src/Component.ts` | 286 | Cast after merging layers | **TODO** |
| `src/Component.ts` | 292 | Cast to `Effect<Element, E, never>` | **TODO** |
| `src/Component.ts` | 386, 390 | Cast in genNoProps | **TODO** |
| `src/Component.ts` | 448 | Cast in genWithProps | **TODO** |
| `src/Signal.ts` | 54-55 | `AnySignal` uses `any` | Acceptable (internal) |
| `src/Signal.ts` | 482-489 | `EachFn` uses `any` | Acceptable (internal) |

**Approach**: Redesign type utilities in Component.ts to eliminate unsafe casts. Since there are no users, we can change the API freely.

### MEDIUM PRIORITY: Memory Management

| Issue | Location | Description |
|-------|----------|-------------|
| `Signal.derive` leak | `src/Signal.ts:396` | Subscription never cleaned up - documented with "For now, derived signals live as long as the source" |
| Orphaned subscriptions | `src/Renderer.ts` | Race conditions possible during unmount if async operations in flight |

**Approach**: Add proper cleanup using Effect's `Scope.addFinalizer`. Add observability events for cleanup tracking.

### LOW PRIORITY: Code Quality

| Issue | Location | Description |
|-------|----------|-------------|
| Circular dependency | `src/Signal.ts:491-499` | `_setEachImpl` workaround for Signal.each |
| Large file | `src/Renderer.ts` (987 lines) | Could be split into smaller modules |
| Mutable state | `src/Renderer.ts:332-336` | Multiple `let` variables for render state |
| `Effect.never` workaround | `src/Renderer.ts:925` | Used to keep scope open |

---

## Observability Events Roadmap

Building on the existing wide events infrastructure (see OBSERVABILITY.md), additional events should be added for new features:

### Cleanup/Lifecycle Events (To Add)

| Event | Description | Key Fields |
|-------|-------------|------------|
| `signal.derive.subscribe` | Derived signal subscribed to source | `derived_id`, `source_id` |
| `signal.derive.cleanup` | Derived signal cleaned up | `derived_id`, `source_id` |
| `component.unmount.start` | Component unmount initiated | `component_id` |
| `component.unmount.complete` | Component fully cleaned up | `component_id`, `duration_ms` |
| `subscription.orphaned` | Detected orphaned subscription | `signal_id`, `component_id` |

### Router Events (For Router Implementation)

| Event | Description | Key Fields |
|-------|-------------|------------|
| `router.navigate` | Navigation triggered | `from`, `to`, `trigger` |
| `router.match` | Route matched | `path`, `pattern`, `params` |
| `router.guard.start` | Guard evaluation started | `guard_name` |
| `router.guard.allow` | Guard allowed navigation | `guard_name`, `duration_ms` |
| `router.guard.block` | Guard blocked navigation | `guard_name`, `reason` |
| `router.transition.start` | Route transition started | `from`, `to` |
| `router.transition.complete` | Route transition completed | `from`, `to`, `duration_ms` |

### Data Layer Events (For Data Implementation)

| Event | Description | Key Fields |
|-------|-------------|------------|
| `query.fetch.start` | Query fetch started | `key`, `is_refetch` |
| `query.fetch.success` | Query completed | `key`, `duration_ms`, `cache_hit` |
| `query.fetch.error` | Query failed | `key`, `error`, `retry_count` |
| `query.cache.hit` | Cache hit | `key`, `age_ms` |
| `query.cache.miss` | Cache miss | `key` |
| `query.cache.invalidate` | Cache invalidated | `key`, `reason` |
| `mutation.start` | Mutation started | `key` |
| `mutation.optimistic` | Optimistic update applied | `key`, `prev_value` |
| `mutation.success` | Mutation completed | `key`, `duration_ms` |
| `mutation.rollback` | Optimistic update rolled back | `key`, `error` |

### Form Events (Future)

| Event | Description | Key Fields |
|-------|-------------|------------|
| `form.field.change` | Field value changed | `form_id`, `field`, `value` |
| `form.field.blur` | Field lost focus | `form_id`, `field` |
| `form.validate` | Validation ran | `form_id`, `is_valid`, `errors` |
| `form.submit.start` | Submit initiated | `form_id` |
| `form.submit.success` | Submit completed | `form_id`, `duration_ms` |
| `form.submit.error` | Submit failed | `form_id`, `error` |

---

## Development Roadmap

### Guiding Principles

1. **Observability-first**: Add debug events for all new features before optimizing
2. **Type safety**: Eliminate `as` casts; design types to be sound
3. **No backward compatibility**: No users yet, so APIs can change freely
4. **Both scales**: Patterns that work for small apps but scale to large ones

### Phase 14: Type Safety Fixes (Current Priority)

**Goal**: Eliminate unsafe type casts in Component.ts

**Tasks**:
- [ ] Redesign `separateProps` to avoid cast to `P`
- [ ] Redesign layer merging to maintain type safety
- [ ] Fix `genNoProps` and `genWithProps` casts
- [ ] Add type-level tests to prevent regression
- [ ] Document any remaining casts with detailed justification

**Success Criteria**: `bun run typecheck` passes with no `as` casts in Component.ts (except justified internal uses)

### Phase 15: Memory Management Fixes

**Goal**: Fix memory leaks and add cleanup observability

**Tasks**:
- [ ] Fix `Signal.derive` subscription cleanup
- [ ] Add `signal.derive.subscribe` and `signal.derive.cleanup` events
- [ ] Add `component.unmount.start` and `component.unmount.complete` events
- [ ] Add memory leak tests
- [ ] Document cleanup patterns in DESIGN.md

### Phase 16: Client-Side Routing (In Progress - Other Agent)

**Goal**: Enable single-page applications with URL-based navigation

**Planned API**:
```tsx
import { Router, Route, Link, useParams } from "effect-ui/router"

const App = Effect.gen(function* () {
  return (
    <Router>
      <Route path="/" component={Home} />
      <Route path="/users/:id" component={UserDetail} />
      <Route path="*" component={NotFound} />
    </Router>
  )
})
```

**Features** (priority order):
1. Path matching with params (`/users/:id`)
2. Nested routes
3. `<Link>` component for navigation
4. `useParams()` and `useSearchParams()` hooks
5. Navigation guards (before/after hooks as Effects)
6. Route-based code splitting

**Status**: Being implemented by another agent

### Phase 17: API Routes (In Progress - Other Agent)

**Goal**: Effect-native API route definitions

**Planned API**:
```typescript
// src/routes/api/users/[id].ts
import { ApiRoute } from "effect-ui/api"
import { Schema } from "effect"

const UserParams = Schema.Struct({ id: Schema.String })

export const GET = ApiRoute.get(UserParams, (params) =>
  Effect.gen(function* () {
    const user = yield* UserService.findById(params.id)
    return { status: 200, body: user }
  })
)
```

**Status**: Being implemented by another agent

### Phase 18: Data Fetching Layer (In Progress - Other Agent)

**Goal**: Declarative data fetching with caching and mutations

**Planned API**:
```tsx
import { createQuery, createMutation } from "effect-ui/data"

const useUser = createQuery({
  key: (id: string) => ["user", id],
  fetch: (id) => UserApi.getById(id)
})

const UserDetail = Component.gen<{ id: string }>()(Props => function* () {
  const { id } = yield* Props
  const { data, isLoading, error } = yield* useUser(id)
  
  if (isLoading) return <div>Loading...</div>
  if (error) return <div>Error: {error.message}</div>
  return <div>{data.name}</div>
})
```

**Features**:
1. Query hooks with loading/error states
2. Mutations with optimistic updates
3. In-memory cache with TTL
4. Manual + automatic cache invalidation

**Status**: Being implemented by another agent

### Phase 19: Testing Infrastructure Expansion

**Goal**: Comprehensive test coverage and utilities

**Tasks**:
- [ ] Add memory leak tests
- [ ] Add stress tests for Signal subscriptions
- [ ] Expand query methods (`getByLabelText`, `getByPlaceholderText`)
- [ ] Add `userEvent` utilities (keyboard, drag/drop)
- [ ] Add `captureEvents()` for testing observability events
- [ ] Add router testing utilities (`renderWithRouter`)
- [ ] Add data layer testing utilities (`renderWithMockData`)

### Phase 20: Forms & Validation (Future)

**Goal**: Type-safe form management with Effect Schema validation

**Planned API**:
```tsx
import { createForm, Field } from "effect-ui/form"
import { Schema } from "effect"

const LoginSchema = Schema.Struct({
  email: Schema.String.pipe(Schema.pattern(/@/)),
  password: Schema.String.pipe(Schema.minLength(8))
})

const LoginForm = Component.gen(function* () {
  const form = yield* createForm({
    schema: LoginSchema,
    onSubmit: (values) => AuthService.login(values)
  })
  
  return (
    <form onSubmit={form.handleSubmit}>
      <Field form={form} name="email">
        {({ value, error, onChange }) => (
          <>
            <input value={value} onInput={onChange} />
            {error && <span>{error}</span>}
          </>
        )}
      </Field>
    </form>
  )
})
```

### Phase 21: SSR & Hydration (Future)

**Goal**: Server-side rendering with client hydration

**Prerequisites**: Routing and data layer must be stable

**Tasks**:
1. Server renderer (render to HTML string)
2. Hydration (attach to server-rendered HTML)
3. Streaming support
4. Data serialization for hydration

### Phase 22: Performance Optimization (Future)

**Goal**: Optimize rendering performance

**Prerequisites**: Observability events for performance measurement

**Tasks**:
1. Add performance-related observability events
2. Create benchmarks
3. Implement component memoization
4. Implement batched updates
5. Consider Virtual DOM diffing (if needed based on benchmarks)
6. Bundle size optimization

---

## Planned File Structure

```
src/
├── index.ts              # Main exports
├── Element.ts            # Virtual DOM
├── Signal.ts             # Reactivity
├── Renderer.ts           # DOM rendering
├── Component.ts          # Component API
├── router/               # Phase 16 (other agent)
│   ├── index.ts
│   ├── Router.ts
│   ├── Route.ts
│   ├── Link.ts
│   ├── hooks.ts          # useParams, useSearchParams
│   └── matcher.ts        # Path matching
├── data/                 # Phase 18 (other agent)
│   ├── index.ts
│   ├── Query.ts
│   ├── Mutation.ts
│   └── Cache.ts
├── api/                  # Phase 17 (other agent)
│   ├── index.ts
│   └── ApiRoute.ts
├── form/                 # Phase 20 (future)
│   ├── index.ts
│   ├── Form.ts
│   └── Field.ts
├── components/
│   ├── Suspense.ts
│   ├── ErrorBoundary.ts
│   └── Portal.ts
├── testing.ts
├── debug.ts
└── vite-plugin.ts

create-effect-ui/        # CLI for scaffolding
examples/                 # Working examples
tests/                    # Test suite
```

---

## Comparison with Mature Frameworks

| Feature | React | Vue | Svelte | effect-ui | Status |
|---------|-------|-----|--------|-----------|--------|
| Virtual DOM | Yes | Yes | No | Yes | ✅ Done |
| Fine-grained reactivity | No | Yes | Yes | Yes | ✅ Done |
| JSX | Yes | Optional | No | Yes | ✅ Done |
| TypeScript | Good | Good | Good | Excellent | ✅ Done |
| Dependency Injection | Context | Provide/Inject | Context | Effect Context | ✅ Done |
| Error Boundaries | Yes | Yes | Yes | Yes | ✅ Done |
| Suspense | Yes | Yes | Yes | Yes | ✅ Done |
| Portal | Yes | Teleport | Portal | Yes | ✅ Done |
| DevTools | Yes | Yes | Yes | Console | 🔄 Partial |
| Routing | React Router | Vue Router | SvelteKit | - | 🔄 In Progress |
| Data Fetching | React Query | - | - | - | 🔄 In Progress |
| SSR | Yes | Nuxt | SvelteKit | - | 📋 Planned |
| Forms | React Hook Form | VeeValidate | - | - | 📋 Planned |
| Animations | - | Built-in | Built-in | - | 📋 Future |
| Concurrent Mode | Yes | - | - | - | ❓ TBD |

---

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

## Completed (Phase 9.6: Component Thunk Refactor)

Refactored `Element.Component` to store a thunk instead of an effect:

```ts
readonly Component: {
  readonly run: () => Effect.Effect<Element, unknown, never>  // R must be never
  readonly key: ElementKey | null
}
```

- Element.Component now requires `R = never` - all requirements satisfied before creating Component
- Updated `componentElement` function signature to enforce `R = never`
- All internal components (ErrorBoundary, Suspense, DevMode) now wrap effects in thunks
- Fixed testing.ts to use `run:` property instead of `effect:`

## Completed (Phase 10: Component.gen API)

**Goal achieved**: JSX syntax like `<Card theme={themeLayer} title="Hello" />` with automatic type inference.

### Implementation

The `Component.gen` API in `src/Component.ts` provides:
- Cleaner syntax: `Component.gen<P>(Props => function* () { ... })`
- Typed props via Props Context.Tag with `yield* Props`
- Automatic layer prop inference from Effect requirements
- No explicit Effect.gen wrapper needed

```tsx
// With typed props
const Card = Component.gen<{ title: string }>(Props => function* () {
  const { title } = yield* Props
  const theme = yield* Theme
  return <div style={{ color: theme.primary }}>{title}</div>
})

// Without props
const ThemedCard = Component.gen(function* () {
  const theme = yield* Theme
  return <div>{theme.name}</div>
})

// TypeScript correctly infers: { title: string, theme: Layer<Theme> }
<Card title="Hello" theme={themeLayer} />
```

### Key Discovery: Context.TagClassShape

The type inference breakthrough came from using `Context.TagClassShape` instead of `Context.Tag`:

```typescript
// DOESN'T WORK: Effect's R type doesn't match Context.Tag pattern
type BadExtract<T> = T extends Context.Tag<any, infer S> ? S : never

// WORKS: TagClassShape correctly extracts from Tag class declarations
type GoodExtract<T> = T extends Context.TagClassShape<infer K, infer S> 
  ? { [Key in Uncapitalize<K>]: Layer.Layer<T> }
  : never
```

### Test Coverage

- `tests/component-api.test.tsx` - Type-level and runtime tests for Component API
- Compile-time verification that props include both regular props and layer props
- Runtime tests for rendering with layers, multiple layers, and no layers

## Completed (Phase 10.5: Component.gen Syntax)

Implemented `Component.gen` for cleaner component syntax:

```tsx
// Without props - just pass the generator directly
const ThemedCard = Component.gen(function* () {
  const theme = yield* Theme
  return <div style={{ color: theme.text }}>{theme.name}</div>
})
// TypeScript infers: { theme: Layer<Theme> }

// With props - use curried syntax for full type inference
const Card = Component.gen<{ title: string }>()(Props => function* () {
  const { title } = yield* Props
  const theme = yield* Theme
  return <div style={{ color: theme.primary }}>{title}</div>
})
// TypeScript infers: { title: string, theme: Layer<Theme> }
```

**Key implementation details:**
- Imports `YieldWrap` from `effect/Utils` for proper generator typing
- Two overloads: no-props (direct generator) and with-props (curried)
- Runtime detection of generator vs function via `isGeneratorFunction()`
- Full type inference for service requirements → layer props

## Completed (Phase 11: Quick Start CLI)

### create-effect-ui CLI (Implemented)

Scaffolds new effect-ui projects with a single command:

```bash
# Using bunx (recommended)
bunx create-effect-ui my-app

# Or using bun create
bun create effect-ui my-app

# Then
cd my-app
bun install
bun run dev
```

**Implementation**: `create-effect-ui/` directory contains:
- `index.ts` - CLI using `@effect/cli` (Command, Args, FileSystem)
- `template/` - Minimal starter with:
  - `package.json` - Dependencies (effect-ui, effect, vite)
  - `vite.config.ts` - Uses `effect-ui/vite-plugin`
  - `tsconfig.json` - JSX configured for effect-ui
  - `index.html` - Entry HTML with minimal styles
  - `src/main.tsx` - Counter example
  - `.gitignore` - Standard ignores

**Usage**: After `effect-ui` is published to npm, users can run `bun create effect-ui my-app` to scaffold a new project.

## Completed (Phase 11.5: Examples Update)

### All Examples Now Use Component.gen

Updated all examples to demonstrate the `Component.gen` API consistently:

| Example | Components Added | Services |
|---------|-----------------|----------|
| **Counter** | `CountDisplay`, `CounterButton` | Theme |
| **Todo** | `TodoInput`, `FilterButton` | TodoTheme |
| **Form** | `FormField`, `SuccessMessage` | FormTheme |
| **Error Boundary** | `NetworkErrorDisplay`, `ValidationErrorDisplay`, `UnknownErrorDisplay`, `SuccessDisplay`, `TriggerButton` | ErrorTheme |
| **Theme** | `ThemedCard`, `ThemedTitle` (already had) | Theme |
| **Dashboard** (NEW) | `StatCard`, `ActivityItem`, `ActionButton`, `Header`, `SectionTitle` | Theme, Analytics, Logger |

### New Dashboard Example

Comprehensive example demonstrating:
- Multiple services (Theme, Analytics, Logger)
- Components with 2+ service requirements
- Real-world UI patterns (stats cards, activity feed, action buttons)
- Theme switching (light/dark)
- Full-width layout with responsive grid

## Next Steps

### Phase 14: Type Safety Fixes (Current Priority)

Eliminate unsafe type casts in Component.ts. See "Known Issues & Technical Debt" section above for details.

**Tasks**:
- [ ] Redesign `separateProps` to avoid cast to `P`
- [ ] Redesign layer merging to maintain type safety
- [ ] Fix `genNoProps` and `genWithProps` casts
- [ ] Add type-level tests to prevent regression

### Phase 15: Memory Management Fixes

Fix memory leaks and add cleanup observability. See "Known Issues & Technical Debt" section above.

### Phases 16-18: Routing, API Routes, Data Layer

Being implemented by other agents. See "Development Roadmap" section above for planned APIs.

### Phase 12: Package Rename to `effect-dom` (Deferred)

Rename from `effect-ui` to `effect-dom` (available on npm). Deferred until core features stabilize.

**Tasks**:
- [ ] Update `package.json` name field
- [ ] Update `DESIGN.md` references
- [ ] Update `AGENTS.md` references
- [ ] Update `PLAN.md` references
- [ ] Update `create-effect-ui/` to `create-effect-dom/`
- [ ] Update CLI template references
- [ ] Update examples imports
- [ ] Update test imports if needed
- [ ] Rename project directory (optional)

## Completed (Phase 13: DX Improvements)

### README.md Rewrite
Complete documentation rewrite with:
- Quick start guide using `create-effect-ui` CLI
- Manual setup instructions (deps, vite, tsconfig)
- Core concepts (Signal, Components, Effects)
- Component.gen API documentation
- DevMode debugging guide
- API reference table

### Vite Plugin Improvements
Enhanced `src/vite-plugin.ts` with:
- `configResolved` hook for configuration validation
- Detection of React/Preact plugin conflicts
- Warnings for classic JSX mode (jsxFactory)
- Warnings for mismatched jsxImportSource
- Detection of React imports in user code
- Colored terminal output with `[effect-ui]` branding

### Security Fix
Fixed `src/debug.ts` URL params security issue:
- `initFromEnvironment()` now only works in development mode
- Checks `import.meta.env.DEV` and `NODE_ENV`
- Production builds ignore `?effectui_debug` URL params
- Updated OBSERVABILITY.md to document security behavior

### Error Messages
- Improved `Signal.each` error with import suggestion
- Clear guidance when module initialization order is wrong

### JSDoc Polish
- Enhanced module documentation in `src/index.ts`
- Added `@see` references to README.md, DESIGN.md, OBSERVABILITY.md
- Improved Component API documentation with examples

## Future Improvements

### Short-term (After Routing/Data Layer)
- [ ] Form management with Effect Schema validation (Phase 20)
- [ ] Expanded testing utilities (Phase 19)
- [ ] DevTools browser extension

### Medium-term
- [ ] SSR support (Phase 21)
- [ ] Hydration
- [ ] Streaming rendering
- [ ] Documentation site

### Long-term
- [ ] Performance optimization (Phase 22)
- [ ] Signal.derive optimizations (memoization)
- [ ] Computed signals with dependency tracking
- [ ] Performance benchmarks
- [ ] Animation primitives
- [ ] Concurrent rendering (TBD)

## Current File Structure

```
src/
├── index.ts             Main entry point & exports
├── Element.ts           Virtual DOM types (TaggedEnum)
├── Signal.ts            Reactive state (make/get/set/derive/each)
├── Renderer.ts          DOM rendering + mount() + reconciliation
├── Component.ts         Component.gen API with layer inference
├── jsx-runtime.ts       Production JSX transformation
├── jsx-dev-runtime.ts   Development JSX with source maps
├── jsx.d.ts             JSX TypeScript definitions
├── vite-plugin.ts       Vite configuration plugin
├── testing.ts           Test utilities (render, click, waitFor)
├── debug.ts             Wide event logging infrastructure
├── DevMode.ts           Debug mode component
├── AtomTracker.ts       Atom tracking (effect-atom integration)
├── components/
│   ├── Suspense.ts      Async boundary component
│   ├── ErrorBoundary.ts Error handling component
│   └── Portal.ts        Render to different container
├── hooks/
│   └── useAtom.ts       Atom hooks (effect-atom integration)

create-effect-ui/        CLI for scaffolding new projects
├── index.ts             CLI using @effect/cli
├── package.json         CLI package metadata
├── template/            Starter template files

examples/                6 working examples
├── counter/             Basic Signal state
├── todo/                Signal.each for lists
├── theme/               Context.Tag services
├── form/                Form validation
├── error-boundary/      Error handling
├── dashboard/           Multiple services

tests/                   38 tests
├── counter.test.tsx     Core functionality
├── component-api.test.tsx Component.gen types
├── keyed-list.test.tsx  Signal.each
├── rerender.test.tsx    Re-render mechanism
└── ...

effect/                  Local Effect repo (reference only, DO NOT MODIFY)
```

### Planned Additions (See Development Roadmap)

```
src/
├── router/              Phase 16 - Client-side routing
├── data/                Phase 18 - Data fetching layer
├── api/                 Phase 17 - API routes
├── form/                Phase 20 - Form management
```
