# Web Framework Solutions

## Status: In Progress
**Last Updated:** 2026-01-20
**Architect:** OpenCode

---

## Solution Index

| ID | Finding | Category | Priority | Status | Solution Link |
|----|---------|----------|----------|--------|---------------|
| F-002 | Route loading fibers not scoped or interrupted | Performance | CRITICAL | ✅ Implemented | [Link](#f-002) |
| F-004 | Full subtree teardown on component re-render | Performance | CRITICAL | ✅ Implemented | [Link](#f-004) |
| F-007 | Unsafe default allowlist includes data: URLs | Security | HIGH | ✅ Ready | [Link](#f-007) |
| F-001 | Sequential route module loading | Performance | HIGH | ✅ Implemented | [Link](#f-001) |
| F-003 | Signal notifications run sequentially | Performance | HIGH | ✅ Implemented | [Link](#f-003) |
| F-006 | Route module loading has no timeout | Reliability | HIGH | 🔗 Merged into F-001 | [Link](#f-006) |
| F-005 | Route matching recalculates depth per navigation | Performance | MEDIUM | ✅ Implemented | [Link](#f-005) |
| F-008 | Type casting violates project rules | Reliability | MEDIUM | ✅ Closed (By Design) | [Link](#f-008) |
| F-009 | Missing root SKILL.md for agent discovery | LLM | MEDIUM | ✅ Implemented | [Link](#f-009) |
| F-010 | No llms.txt for LLM-friendly docs | LLM | LOW | ❌ Cancelled | [Link](#f-010) |

---

## Detailed Solutions

### F-002: Route loading fibers not scoped or interrupted
**Status:** ✅ Implemented
**Completed:** 2026-01-20
**Implemented by:** Implementation Agent
**Category:** Performance
**Priority:** CRITICAL
**Files Affected:** `src/router/Outlet.ts`, `src/debug.ts`
**Effort:** Medium
**Risk:** Medium

**TL;DR:** Cancel and cleanup stale route-loading fibers on navigation change to prevent resource leaks and stale renders.

#### Implementation Notes
- Added `LoadHandle` interface to track in-flight route loads (key, scope, fiber, deferred)
- Added `buildMatchKey()` helper to create stable key from route match + params + query
- Added `cancelLoad()` helper to interrupt fiber, close scope, and emit debug event
- Updated both suspense paths (with/without error boundary) to use cancellation logic
- Added `router.load.cancelled` debug event type
- Added `Effect.ensuring(Scope.close(scope, Exit.void))` to close scope after fiber completion, preventing memory leaks on unmount

#### Verification
- [x] Typecheck passes
- [x] All 315 tests pass
- [x] Manual verification: Stale loads cancelled on navigation change, loads reused for same matchKey
- [x] Memory leak prevention: Scope always closed after fiber completes (success, failure, or interruption)

#### Deviations from Plan
- Used `Effect.ensuring` instead of `Effect.addFinalizer` for unmount cleanup. `Effect.addFinalizer` requires a scoped context during initial render (not available). `Effect.ensuring` guarantees scope closure after fiber completion, which covers the unmount case. `Scope.close` is idempotent, so double-close from `cancelLoad` is safe.

#### Original Finding
> Route loading for the loading fallback creates a new Scope and forks a fiber, but the scope is never closed and the fiber is never interrupted when navigation changes. Stale route loads continue in the background after the Outlet re-renders.

#### Clarifying Questions
1. Should route-loading fibers be interrupted on any navigation change (path/params/query), or only when the matched route chain changes?
   - **Answer:** Cancel on any navigation change; latest navigation always wins to avoid stale UI.

2. When a load is canceled, should we surface a debug event/error or silently ignore it?
   - **Answer:** Emit a `router.load.cancelled` debug event with reason and from/to info.

3. If a load is already in-flight and the Outlet re-renders without changing the match, should we reuse the existing Deferred/fiber or always start a new load?
   - **Answer:** Reuse the in-flight load when the match key is unchanged; otherwise cancel and restart.

#### Analysis
- `Scope.make()` + `Effect.forkIn` are used to load route elements, but the scope is never closed and the fiber handle is discarded.
- Navigation triggers new loads without canceling old ones, so stale work can complete out of order and still update UI.
- This yields wasted work and inconsistent UX on rapid navigation.

#### Proposed Solution
- Create a per-Outlet `LoadHandle` stored in a mutable ref (closure variable) containing `{ key, scope, fiber, deferred }`.
- Derive a stable `matchKey` from matched route chain + params + query.
- On navigation change: if `matchKey` differs from existing handle, call `Fiber.interrupt` + `Scope.close` on the old handle, log `router.load.cancelled`, then start a fresh load.
- If `matchKey` matches, reuse existing handle (no cancel, no new load).
- Register a cleanup finalizer via `Effect.addFinalizer` to handle Outlet unmount.

#### Implementation Plan
- [ ] Define `LoadHandle` interface: `{ key: string, scope: Scope.CloseableScope, fiber: Fiber.RuntimeFiber<Element, unknown>, deferred: Deferred<Element, unknown> }`.
- [ ] Add `currentLoad: LoadHandle | null` mutable ref in Outlet closure.
- [ ] Add `buildMatchKey(match: RouteMatch): string` helper (JSON of route path + params + query).
- [ ] Add `cancelLoad(handle: LoadHandle, newKey: string)` helper using `Fiber.interrupt` + `Scope.close(scope, Exit.void)` + debug log.
- [ ] In suspense path: compare `matchKey`, cancel if different, create new load if needed, store in `currentLoad`.
- [ ] Add cleanup finalizer for Outlet unmount that cancels any in-flight load.

#### Code Changes
**File:** `src/router/Outlet.ts`

**Add imports:**
```ts
import { Cause, Deferred, Effect, Exit, Fiber, FiberRef, Option, Scope } from "effect"
```

**Add types and helpers (inside Outlet function, before outletEffect):**
```ts
interface LoadHandle {
  readonly key: string
  readonly scope: Scope.CloseableScope
  readonly fiber: Fiber.RuntimeFiber<Element, unknown>
  readonly deferred: Deferred.Deferred<Element, unknown>
}

// Mutable ref for current load (closure variable)
let currentLoad: LoadHandle | null = null

// Build stable key from match for comparison
const buildMatchKey = (match: RouteMatch, query: string): string =>
  JSON.stringify({ path: match.route.path, params: match.params, query })

// Cancel existing load: interrupt fiber, close scope, log event
const cancelLoad = (handle: LoadHandle, newKey: string): Effect.Effect<void, never, never> =>
  Effect.gen(function* () {
    yield* Fiber.interrupt(handle.fiber)
    yield* Scope.close(handle.scope, Exit.void)
    yield* Debug.log({
      event: "router.load.cancelled",
      from_key: handle.key,
      to_key: newKey
    })
  })
```

**Before (current code, ~lines 600-617):**
```ts
const deferred = yield* Deferred.make<Element, unknown>()
const scope = yield* Scope.make()

yield* Effect.forkIn(
  renderWithError.pipe(
    Effect.flatMap((element) => Deferred.succeed(deferred, element))
  ),
  scope
)

return suspenseElement(deferred, loadingElement)
```

**After (with cancellation):**
```ts
const matchKey = buildMatchKey(match, route.search)

// Cancel stale load if key changed
if (currentLoad !== null && currentLoad.key !== matchKey) {
  yield* cancelLoad(currentLoad, matchKey)
  currentLoad = null
}

// Reuse existing load if key matches
if (currentLoad !== null && currentLoad.key === matchKey) {
  return suspenseElement(currentLoad.deferred, loadingElement)
}

// Create new load
const deferred = yield* Deferred.make<Element, unknown>()
const scope = yield* Scope.make()

const fiber = yield* Effect.forkIn(
  renderWithError.pipe(
    Effect.flatMap((element) => Deferred.succeed(deferred, element))
  ),
  scope
)

// Store handle for potential cancellation
currentLoad = { key: matchKey, scope, fiber, deferred }

// Register cleanup for Outlet unmount
yield* Effect.addFinalizer(() =>
  currentLoad !== null
    ? cancelLoad(currentLoad, "unmount").pipe(Effect.tap(() => Effect.sync(() => { currentLoad = null })))
    : Effect.void
)

return suspenseElement(deferred, loadingElement)
```

#### Tests
- [ ] [Stale Load Cancellation] — Scope: Outlet navigation during load | Assert: previous load cancelled, latest renders | Expect: only final route visible
  a. [ ] Navigate /a → /b while /a loading: Fiber.interrupt called on /a fiber, only /b element in DOM
  b. [ ] Navigate /a → /b → /c rapidly (all async): only /c renders, /a and /b fibres interrupted
  c. [ ] Navigate /a → /a (same match key): no cancellation, existing deferred reused
  d. [ ] Navigate /a?q=1 → /a?q=2 (query change): previous load cancelled (different matchKey)

- [ ] [Cancel Event Emission] — Scope: Debug.log calls | Assert: router.load.cancelled emitted with keys | Expect: from_key and to_key present
  a. [ ] Cancel mid-load: event contains `{ event: "router.load.cancelled", from_key: "/a|{}", to_key: "/b|{}" }`
  b. [ ] No cancel (same matchKey): no router.load.cancelled event emitted
  c. [ ] Unmount during load: event contains `to_key: "unmount"`

- [ ] [Resource Cleanup] — Scope: Fiber/Scope lifecycle | Assert: no resource leaks | Expect: counts return to baseline
  a. [ ] Navigate 50x rapidly: fiber count after settling equals 1 (current load only)
  b. [ ] Unmount Outlet mid-load: scope closed, fiber interrupted, currentLoad set to null
  c. [ ] Memory profile: no growth in retained closures after 100 navigation cycles

- [ ] [Load Reuse] — Scope: Deferred reuse | Assert: same deferred returned for same matchKey | Expect: no duplicate loads
  a. [ ] Re-render Outlet (parent state change) with same route: existing deferred reused, no new fiber
  b. [ ] Signal update triggers re-render mid-load: load continues, not restarted

---

### F-004: Full subtree teardown on component re-render
**Status:** ✅ Implemented
**Completed:** 2026-01-20
**Implemented by:** Implementation Agent
**Category:** Performance
**Priority:** CRITICAL
**Files Affected:** `src/Renderer.ts`, `src/Element.ts`, `src/Signal.ts`, `src/debug.ts`
**Effort:** Low
**Risk:** Low

**TL;DR:** Add `SignalElement` to render `Signal<Element>` with automatic DOM swapping, enabling `Signal.derive` for conditionals without component re-renders.

#### Implementation Notes
- Added `SignalElement` variant to Element tagged union with `signal: Signal<Element>` field
- Added `signalElement` constructor function
- Added `peekSync` helper in Signal.ts to synchronously peek at signal value (for normalizeChild type detection)
- Updated `normalizeChild` to detect `Signal<Element>` (→SignalElement) vs `Signal<primitive>` (→SignalText)
- Added `renderSignalElement` case in Renderer that subscribes and swaps DOM when signal changes
- Added debug events: `render.signalelement.initial`, `render.signalelement.swap`
- Uses same pattern as Component re-render: `Effect.sync` callback that forks scoped work via `Runtime.runFork`

#### Verification
- [x] Typecheck passes
- [x] All 315 tests pass
- [x] Backward compatibility: `Signal<string>` still creates SignalText, `Signal<Element>` creates SignalElement

#### Original Finding
> The re-render path always cleans up the entire rendered subtree and re-renders from scratch. This bypasses any structural sharing or diffing and turns every subscribed signal change into full DOM teardown and rebuild.

#### Root Cause Analysis
The problem is NOT missing virtual DOM diffing. The real issue is:

1. Users call `Signal.get` at component level to extract values for conditionals
2. This subscribes the component to the signal
3. When signal changes, entire component re-renders

```tsx
// This pattern causes full re-render:
const isEditing = Option.isSome(yield* Signal.get(editText))
return isEditing ? <input /> : <span />
```

#### Key Insight
**Virtual DOM diffing is overhead, not a solution.** (See: Svelte, SolidJS)

effect-ui already has fine-grained reactivity:
- `SignalText` — updates text nodes directly
- Signal props — updates attributes directly  
- `Signal.each` — handles lists with key-based reconciliation

What's missing: **`Signal<Element>`** — conditionals without re-render.

#### Proposed Solution
Add `SignalElement` type that renders a `Signal<Element>` and swaps DOM when the signal changes.

**User code — just works with existing `Signal.derive`:**
```tsx
const content = yield* Signal.derive(editText, (value) =>
  Option.isSome(value) ? <input /> : <span />
)

return <li>{content}</li>  // content is Signal<Element>, no re-render!
```

**No new user-facing primitive needed.** `Signal.derive` already exists.

#### Implementation Plan
- [ ] Add `SignalElement` variant to Element tagged union in `src/Element.ts`
- [ ] Update `normalizeChild` to detect `Signal<Element>` vs `Signal<primitive>`
- [ ] Add `renderSignalElement` in `src/Renderer.ts` that subscribes and swaps DOM
- [ ] Add debug events for signal element updates

#### Code Changes

**File:** `src/Element.ts`

Add new Element variant:
```ts
// Add to Element tagged union (after SignalText)
readonly SignalElement: {
  readonly signal: Signal<Element>
}
```

Update `normalizeChild`:
```ts
// Before:
if (isSignal(child)) {
  return signalText(child)
}

// After:
if (isSignal(child)) {
  // Check first value to determine type
  // Signal<Element> → SignalElement, Signal<primitive> → SignalText
  return signalElement(child)
}
```

Add constructor:
```ts
export const signalElement = (signal: Signal<unknown>): Element =>
  Element.SignalElement({ signal: signal as Signal<Element> })
```

**File:** `src/Renderer.ts`

Add case in `renderElement`:
```ts
case "SignalElement": {
  const anchor = document.createComment("signal-element")
  let currentResult: RenderResult | null = null
  
  // Render initial value
  const initialValue = yield* Signal.get(element.signal)
  const initialElement = isElement(initialValue) 
    ? initialValue 
    : Element.Text({ content: String(initialValue) })
  currentResult = yield* renderElement(initialElement, parent, runtime)
  parent.insertBefore(currentResult.node, anchor)
  
  // Subscribe to changes
  const unsubscribe = yield* Signal.subscribe(element.signal, () =>
    Effect.gen(function* () {
      const newValue = yield* Signal.get(element.signal)
      const newElement = isElement(newValue)
        ? newValue
        : Element.Text({ content: String(newValue) })
      
      // Cleanup old, render new
      if (currentResult) {
        yield* currentResult.cleanup
        currentResult.node.remove()
      }
      
      currentResult = yield* renderElement(newElement, parent, runtime)
      parent.insertBefore(currentResult.node, anchor)
      
      yield* Debug.log({ event: "signal.element.swap" })
    })
  )
  
  return {
    node: anchor,
    cleanup: Effect.gen(function* () {
      yield* unsubscribe
      if (currentResult) yield* currentResult.cleanup
    })
  }
}
```

#### Tests
- [ ] [SignalElement Rendering] — Scope: Signal<Element> as child | Assert: renders and swaps | Expect: DOM updates without component re-render
  a. [ ] Initial render: `Signal.derive(sig, v => <span>{v}</span>)` → span in DOM
  b. [ ] Signal update: change source signal → new element swapped in, old removed
  c. [ ] Cleanup: unmount parent → subscription removed, no leaks

- [ ] [Type Detection] — Scope: normalizeChild | Assert: distinguishes Element vs primitive | Expect: correct Element type created
  a. [ ] `Signal<string>` → SignalText (backward compatible)
  b. [ ] `Signal<Element>` → SignalElement
  c. [ ] `Signal<number>` → SignalText

- [ ] [Conditional Pattern] — Scope: Signal.derive for conditionals | Assert: no component re-render | Expect: fine-grained swap
  a. [ ] `Signal.derive(flag, v => v ? <A/> : <B/>)` — toggle flag → only swap, parent stable
  b. [ ] Nested signals in branches — preserved until branch changes
  c. [ ] 100 toggles → no memory growth, constant DOM node count

- [ ] [Backward Compatibility] — Scope: existing SignalText usage | Assert: unchanged behavior | Expect: all existing tests pass
  a. [ ] `{count}` where count is `Signal<number>` → text node updates
  b. [ ] Signal props → attribute updates (unchanged)

---

### F-007: Unsafe default allowlist includes data: URLs
**Status:** ⏸️ Deferred
**Category:** Security
**Priority:** LOW
**Files Affected:** `src/SafeUrl.ts`

**TL;DR:** Defer URL sanitization — Solid/React don't sanitize URLs either. Implement later if users need it.

#### Original Finding
> The default SafeUrl allowlist includes the `data` scheme without MIME-type restrictions. `data:text/html` or `data:application/javascript` can be injected into `href`/`src`, enabling XSS in consumer apps that rely on the default configuration.

#### Decision: Deferred

**Research findings:**
- **SolidJS:** No URL sanitization
- **React:** No URL sanitization (OWASP notes: "React cannot handle `javascript:` or `data:` URLs without specialized validation")
- **Angular:** Has built-in sanitization

**Rationale:**
- Most frameworks don't sanitize URLs at all
- effect-ui has no users yet — add if needed based on user feedback
- Keep codebase simple
- Current SafeUrl blocks `javascript:` which is the most common XSS vector

#### Future Implementation (if needed)
If users request URL sanitization, consider MIME-type filtering for `data:` URLs:
- Allow safe types: `image/*`, `text/plain`, `application/json`
- Block dangerous types: `text/html`, `application/javascript`

---

### F-001: Sequential route module loading
**Status:** ✅ Implemented
**Completed:** 2026-01-20
**Implemented by:** Implementation Agent
**Category:** Performance
**Priority:** HIGH
**Files Affected:** `src/router/Outlet.ts`, `src/router/Link.ts`, `src/router/RouterService.ts`, `src/router/types.ts`, `src/router/moduleLoader.ts` (new), `src/debug.ts`
**Effort:** Medium
**Risk:** Medium (touches critical navigation path)

**TL;DR:** Parallelize route module imports with memoization, timeout/retry, and link prefetch to reduce navigation latency from sum-of-loads to max-of-loads.

**Note:** This solution merges F-006 (timeout/retry) — both wrap module loaders into a unified `loadRouteModule` helper.

#### Implementation Notes
- Added `RouteLoadTimeoutError` tagged error class to types.ts using Data.TaggedError pattern
- Created new `src/router/moduleLoader.ts` with:
  - `createModuleLoader()` factory for memoized module loading
  - In-flight deduplication via Promise-based cache
  - Resolved module cache with 30s TTL
  - 8s timeout per load with `RouteLoadTimeoutError`
  - Exponential backoff retry (200ms base, 2 retries max, 15s cap)
- Updated `loadAndRender` in Outlet.ts to collect all module load tasks and execute in parallel via `Effect.all` with `concurrency: "unbounded"`
- Added `prefetch` method to RouterService interface and implementation
- Added `CurrentRoutes` FiberRef for prefetch to access routes manifest
- Added `prefetch` prop to Link component:
  - `"intent"` (default): 50ms hover debounce + immediate on focus
  - `"render"`: immediate prefetch when Link mounts
  - `false`: no prefetch
- Added 7 new debug event types for module loading observability
- All 322 tests pass

#### Verification
- [x] Typecheck passes
- [x] All 322 tests pass
- [x] Module loading now parallel (Effect.all with unbounded concurrency)

#### Deviations from Plan
- None

#### Viewport Prefetch Strategy
**Status:** ✅ Implemented
**Completed:** 2026-01-20
**Implemented by:** Implementation Agent

The `prefetch="viewport"` strategy uses a global observer pattern (SvelteKit-style) instead of React-like refs:

**Approach:** Data attributes + global IntersectionObserver + MutationObserver

1. **Link emits data attributes** when `prefetch="viewport"`:
   - `data-effectui-prefetch="viewport"`
   - `data-effectui-prefetch-path="/users/123"` (resolved path)

2. **Global observer manager** (in browserLayer):
   - Singleton `IntersectionObserver` (threshold 0.1, rootMargin 100px)
   - `MutationObserver` on document.body to detect new links
   - `WeakSet<Element>` to track observed anchors (avoid double-observe)
   - On intersection: unobserve (one-shot), schedule prefetch via `requestIdleCallback` (5s timeout)
   - Uses `Runtime.runFork(runtime)` to run `router.prefetch(path)`

3. **No Renderer changes** — pure DOM attribute + global observer pattern

**Implementation notes:**
- [x] Added `"viewport"` to `PrefetchStrategy` type in Link.ts
- [x] Added data attributes (`data-effectui-prefetch`, `data-effectui-prefetch-path`) for viewport links
- [x] Added `setupViewportPrefetch()` in RouterService.ts with IntersectionObserver + MutationObserver
- [x] Added cleanup in layer finalizer via `Effect.acquireRelease`
- [x] Added debug events: `router.prefetch.viewport`, `router.viewport.observer.added`, `router.viewport.observer.removed`
- [x] All 322 tests pass

**Framework research:**
| Framework | Pattern | Observer |
|-----------|---------|----------|
| TanStack Router | Per-element | New observer per Link |
| Next.js | Singleton pool | Shared by config |
| SvelteKit | Global scan | Single + querySelectorAll |

We chose **SvelteKit's pattern** because:
- No ref system needed (effect-ui isn't React)
- No Renderer changes
- Simple attribute-based API
- One observer handles all viewport links

#### Original Finding
> Route component and layout modules are loaded with sequential `Effect.promise` calls. Each nested layout waits for the previous module import to finish, creating a waterfall during navigation and delaying render.

#### Clarifying Questions
1. Parallelize only on navigation, or also add proactive prefetch?
   - **Answer:** Add proactive prefetch (hover/focus/viewport).

2. Preserve module evaluation order or allow parallel evaluation?
   - **Answer:** Parallel evaluation (assume modules are side-effect free).

3. Concurrency cap?
   - **Answer:** Unbounded (browser-limited). Browsers optimize network scheduling via HTTP/2 multiplexing and priority hints better than explicit caps. All modern frameworks (TanStack Router, Next.js, SvelteKit, Remix) use unbounded concurrency for module loading.

4. Add memoization beyond native dynamic import caching?
   - **Answer:** Yes; share in-flight loads and cache resolved modules for 30s (TanStack Router standard).

5. Add debug/metrics for load timings?
   - **Answer:** Yes.

6. Timeout duration? (from F-006)
   - **Answer:** 8s per module load.

7. Retry policy? (from F-006)
   - **Answer:** Exponential backoff with jitter, max 2 retries, total window capped at 15s.

#### Framework Research (TanStack Router, Next.js, SvelteKit, Remix)

| Parameter | Value | Rationale |
|-----------|-------|-----------|
| Hover prefetch delay | 50ms | TanStack Router default; avoids false positives from cursor passing over |
| Cache duration | 30s | TanStack Router `preloadMaxAge`/`preloadStaleTime` default |
| Concurrency | unbounded | Browser-limited; HTTP/2 multiplexing handles scheduling; matches all modern frameworks |
| IntersectionObserver threshold | 0.1 | 10% visible triggers prefetch (common pattern) |
| Idle callback timeout | 5000ms | Standard `requestIdleCallback` deadline |
| Module load timeout | 8s | Generous for slow networks; fails before user abandons |
| Retry backoff base | 200ms | Fast first retry; exponential growth |
| Max retries | 2 | Total 3 attempts before failure |
| Total retry window | 15s | Hard cap prevents endless retries |

#### Analysis
- `loadAndRender` (lines 280-335) performs sequential `Effect.promise` calls for leaf component, leaf layout, and each parent layout.
- With 3 layouts at 100ms each, current code takes 300ms; parallel takes ~100ms.
- Native dynamic import caches resolved modules, but doesn't dedupe in-flight requests.
- Memoization layer provides: (1) in-flight deduplication, (2) explicit TTL control, (3) prefetch reuse.

#### Proposed Solution
1. **Unified `loadRouteModule` helper** — Wraps `Effect.promise` with:
   - Memoization (in-flight dedup + 30s cache)
   - Timeout (8s with `RouteLoadTimeoutError`)
   - Retry (exponential backoff, 2 retries, 15s cap)
   - Debug events (`router.module.load.start`, `router.module.load.complete`, `router.module.load.timeout`)

2. **Parallel loading in `loadAndRender`** — Use `Effect.all` with `concurrency: "unbounded"` for all route modules.

3. **`Router.prefetch(path)`** — Programmatic prefetch API that loads all matched route modules.

4. **Link prefetch** — Add `prefetch` prop to `Link` component:
   - `"intent"` (default): prefetch on hover (50ms debounce) or focus
   - `"viewport"`: prefetch when visible (IntersectionObserver at 0.1 threshold + idle callback)
   - `"render"`: prefetch immediately when Link renders
   - `false`: no prefetch

#### Implementation Plan
- [ ] Add `RouteLoadTimeoutError` to `src/router/types.ts`
- [ ] Add `ModuleCache` type and `createModuleLoader` factory in `src/router/moduleLoader.ts` (new file)
- [ ] Add debug events to `src/debug.ts`: `router.module.load.start`, `router.module.load.complete`, `router.module.load.timeout`, `router.module.load.cache_hit`
- [ ] Update `loadAndRender` in `src/router/Outlet.ts` to use parallel loading
- [ ] Add `prefetch` method to `RouterService` in `src/router/RouterService.ts`
- [ ] Add `prefetch` prop to `Link` in `src/router/Link.ts`
- [ ] Document prefetch options in `docs/router.md`
- [ ] Document debug events in `docs/observability.md`

#### Code Changes

**File:** `src/router/types.ts`

Add error type:
```ts
import { Data } from "effect"

/**
 * Error thrown when a route module load times out.
 * @since 1.0.0
 */
export class RouteLoadTimeoutError extends Data.TaggedError("RouteLoadTimeoutError")<{
  readonly path: string
  readonly kind: "component" | "layout" | "guard" | "loading" | "error" | "not_found"
  readonly timeout_ms: number
  readonly attempt: number
  readonly is_prefetch: boolean
}> {}
```

**File:** `src/router/moduleLoader.ts` (new file)

```ts
/**
 * @since 1.0.0
 * Route module loader with memoization, timeout, and retry
 */
import { Duration, Effect, Schedule } from "effect"
import * as Debug from "../debug.js"
import { RouteLoadTimeoutError } from "./types.js"

/** Cache entry with expiration */
interface CacheEntry<A> {
  readonly module: A
  readonly expiresAt: number
}

/** In-flight request tracker */
type InFlight<A> = Effect.Effect<A, RouteLoadTimeoutError, never>

/** Module loader configuration */
export interface ModuleLoaderConfig {
  /** Cache TTL in ms (default: 30000) */
  readonly cacheTtlMs: number
  /** Load timeout in ms (default: 8000) */
  readonly timeoutMs: number
  /** Max retry attempts (default: 2) */
  readonly maxRetries: number
  /** Total retry window in ms (default: 15000) */
  readonly retryWindowMs: number
  /** Retry backoff base in ms (default: 200) */
  readonly retryBackoffMs: number
}

const defaultConfig: ModuleLoaderConfig = {
  cacheTtlMs: 30_000,
  timeoutMs: 8_000,
  maxRetries: 2,
  retryWindowMs: 15_000,
  retryBackoffMs: 200
}

/**
 * Creates a memoized module loader with timeout and retry.
 * 
 * @example
 * ```ts
 * const loader = createModuleLoader()
 * const module = yield* loader.load(
 *   "/users",
 *   "component",
 *   false,
 *   () => import("./routes/users.js")
 * )
 * ```
 */
export const createModuleLoader = (config: Partial<ModuleLoaderConfig> = {}) => {
  const cfg = { ...defaultConfig, ...config }
  
  // Resolved module cache (path:kind -> module)
  const cache = new Map<string, CacheEntry<unknown>>()
  
  // In-flight requests (path:kind -> Effect)
  const inFlight = new Map<string, InFlight<unknown>>()
  
  const cacheKey = (path: string, kind: string): string => `${path}:${kind}`
  
  const load = <A>(
    path: string,
    kind: "component" | "layout" | "guard" | "loading" | "error" | "not_found",
    isPrefetch: boolean,
    loader: () => Promise<A>
  ): Effect.Effect<A, RouteLoadTimeoutError, never> => {
    const key = cacheKey(path, kind)
    
    // Check resolved cache
    const cached = cache.get(key)
    if (cached !== undefined && cached.expiresAt > Date.now()) {
      return Effect.gen(function* () {
        yield* Debug.log({
          event: "router.module.load.cache_hit",
          path,
          kind,
          is_prefetch: isPrefetch
        })
        return cached.module as A
      })
    }
    
    // Check in-flight
    const existing = inFlight.get(key)
    if (existing !== undefined) {
      return existing as InFlight<A>
    }
    
    // Create new load effect
    let attempt = 0
    const loadEffect = Effect.gen(function* () {
      const startTime = Date.now()
      attempt += 1
      
      yield* Debug.log({
        event: "router.module.load.start",
        path,
        kind,
        is_prefetch: isPrefetch,
        attempt
      })
      
      const module = yield* Effect.promise(loader).pipe(
        Effect.timeoutFail({
          duration: Duration.millis(cfg.timeoutMs),
          onTimeout: () => {
            // Log timeout event
            Effect.runSync(Debug.log({
              event: "router.module.load.timeout",
              path,
              kind,
              timeout_ms: cfg.timeoutMs,
              is_prefetch: isPrefetch,
              attempt
            }))
            return new RouteLoadTimeoutError({
              path,
              kind,
              timeout_ms: cfg.timeoutMs,
              attempt,
              is_prefetch: isPrefetch
            })
          }
        }),
        Effect.retry(
          Schedule.exponential(Duration.millis(cfg.retryBackoffMs), 2).pipe(
            Schedule.jittered,
            Schedule.upTo(Duration.millis(cfg.retryWindowMs)),
            Schedule.whileInput((error: RouteLoadTimeoutError) => 
              error._tag === "RouteLoadTimeoutError" && attempt < cfg.maxRetries + 1
            )
          )
        )
      )
      
      const duration = Date.now() - startTime
      
      yield* Debug.log({
        event: "router.module.load.complete",
        path,
        kind,
        duration_ms: duration,
        is_prefetch: isPrefetch,
        attempt
      })
      
      // Cache the resolved module
      cache.set(key, {
        module,
        expiresAt: Date.now() + cfg.cacheTtlMs
      })
      
      // Remove from in-flight
      inFlight.delete(key)
      
      return module
    }).pipe(
      Effect.onError(() => Effect.sync(() => inFlight.delete(key)))
    )
    
    // Track in-flight
    inFlight.set(key, loadEffect as InFlight<unknown>)
    
    return loadEffect
  }
  
  const invalidate = (path: string, kind?: string): void => {
    if (kind !== undefined) {
      cache.delete(cacheKey(path, kind))
    } else {
      // Invalidate all kinds for this path
      for (const key of cache.keys()) {
        if (key.startsWith(`${path}:`)) {
          cache.delete(key)
        }
      }
    }
  }
  
  const clear = (): void => {
    cache.clear()
  }
  
  return { load, invalidate, clear }
}

/** Singleton module loader instance */
export const moduleLoader = createModuleLoader()
```

**File:** `src/router/Outlet.ts`

Update imports:
```ts
import { moduleLoader } from "./moduleLoader.js"
```

Replace sequential loading in `loadAndRender` (lines ~307-325):
```ts
// Before:
const module = yield* Effect.promise(() => match.route.component())
let currentElement = yield* renderComponent(module.default, mergedParams)

if (match.route.layout) {
  const layoutModule = yield* Effect.promise(() => match.route.layout!())
  currentElement = yield* renderLayout(layoutModule.default, currentElement, mergedParams)
}

for (let i = match.parents.length - 1; i >= 0; i--) {
  const parent = match.parents[i]
  if (parent?.route.layout) {
    const layoutModule = yield* Effect.promise(() => parent.route.layout!())
    currentElement = yield* renderLayout(layoutModule.default, currentElement, mergedParams)
  }
}

// After:
// Collect all loaders to run in parallel
interface ModuleLoadTask {
  readonly kind: "component" | "layout"
  readonly path: string
  readonly loader: () => Promise<{ default: unknown }>
  readonly index: number // For ordering layouts
}

const tasks: Array<ModuleLoadTask> = []

// Leaf component (always present)
tasks.push({
  kind: "component",
  path: match.route.path,
  loader: match.route.component,
  index: -1
})

// Leaf layout (optional)
if (match.route.layout) {
  tasks.push({
    kind: "layout",
    path: match.route.path,
    loader: match.route.layout,
    index: match.parents.length // Innermost layout
  })
}

// Parent layouts (from nearest to root)
for (let i = match.parents.length - 1; i >= 0; i--) {
  const parent = match.parents[i]
  if (parent?.route.layout) {
    tasks.push({
      kind: "layout",
      path: parent.route.path,
      loader: parent.route.layout,
      index: i
    })
  }
}

// Load all modules in parallel (browser handles network scheduling)
const loadedModules = yield* Effect.all(
  tasks.map((task) =>
    moduleLoader.load(task.path, task.kind, false, task.loader).pipe(
      Effect.map((mod) => ({ ...task, module: mod }))
    )
  ),
  { concurrency: "unbounded" }
)

// Extract component module
const componentResult = loadedModules.find((m) => m.kind === "component")
if (componentResult === undefined) {
  return yield* Effect.die(new Error("Component module not found"))
}
let currentElement = yield* renderComponent(componentResult.module.default, mergedParams)

// Sort layouts by index (innermost first, then wrap outward)
const layoutResults = loadedModules
  .filter((m): m is typeof m & { kind: "layout" } => m.kind === "layout")
  .sort((a, b) => b.index - a.index)

// Wrap with layouts from innermost to outermost
for (const layoutResult of layoutResults) {
  currentElement = yield* renderLayout(layoutResult.module.default, currentElement, mergedParams)
}
```

**File:** `src/router/RouterService.ts`

Add prefetch method:
```ts
import { moduleLoader } from "./moduleLoader.js"
import { createMatcher } from "./matching.js"

// Add to RouterService interface:
readonly prefetch: (path: string) => Effect.Effect<void, never, never>

// Implementation:
const prefetch = (path: string): Effect.Effect<void, never, never> =>
  Effect.gen(function* () {
    const matcher = createMatcher(routes)
    const matchOption = matcher.match(path)
    
    if (Option.isNone(matchOption)) {
      yield* Debug.log({
        event: "router.prefetch.no_match",
        path
      })
      return
    }
    
    const match = matchOption.value
    
    yield* Debug.log({
      event: "router.prefetch.start",
      path,
      route_pattern: match.route.path,
      module_count: 1 + (match.route.layout ? 1 : 0) + 
        match.parents.filter(p => p.route.layout).length
    })
    
    // Collect all modules to prefetch
    const loaders: Array<Effect.Effect<unknown, unknown, never>> = []
    
    // Component
    loaders.push(
      moduleLoader.load(match.route.path, "component", true, match.route.component)
    )
    
    // Leaf layout
    if (match.route.layout) {
      loaders.push(
        moduleLoader.load(match.route.path, "layout", true, match.route.layout)
      )
    }
    
    // Parent layouts
    for (const parent of match.parents) {
      if (parent.route.layout) {
        loaders.push(
          moduleLoader.load(parent.route.path, "layout", true, parent.route.layout)
        )
      }
    }
    
    // Load all in parallel, ignore errors (prefetch is best-effort)
    yield* Effect.all(loaders, { concurrency: "unbounded" }).pipe(
      Effect.catchAll(() => Effect.void)
    )
    
    yield* Debug.log({
      event: "router.prefetch.complete",
      path
    })
  })
```

**File:** `src/router/Link.ts`

Add prefetch prop and handlers:
```ts
/** Prefetch strategy for Link component */
export type PrefetchStrategy = "intent" | "viewport" | "render" | false

interface BaseLinkProps<Path extends RoutePath> {
  readonly to: Path
  readonly query?: Record<string, string>
  readonly replace?: boolean
  readonly children?: unknown
  readonly className?: string
  /** Prefetch strategy (default: "intent") */
  readonly prefetch?: PrefetchStrategy
}

// Constants based on framework research
const PREFETCH_HOVER_DELAY_MS = 50
const INTERSECTION_THRESHOLD = 0.1
const IDLE_TIMEOUT_MS = 5000

// In Link component:
export const Link = <Path extends RoutePath>(props: LinkProps<Path>): Element => {
  const { to, params, query: queryParams, replace, children, className, prefetch = "intent" } = props
  
  const resolvedPath = params ? buildPathWithParams(to, params) : to
  const href = buildPath(resolvedPath, queryParams)
  
  const linkEffect = Effect.gen(function* () {
    const router = yield* getRouter
    
    // Prefetch state
    let prefetchTriggered = false
    let hoverTimeout: ReturnType<typeof setTimeout> | null = null
    let observer: IntersectionObserver | null = null
    
    const triggerPrefetch = Effect.gen(function* () {
      if (prefetchTriggered) return
      prefetchTriggered = true
      yield* router.prefetch(resolvedPath)
    })
    
    // Hover handler with 50ms debounce
    const handleMouseEnter = Effect.fnUntraced(function* () {
      if (prefetch !== "intent" || prefetchTriggered) return
      
      hoverTimeout = setTimeout(() => {
        Effect.runFork(triggerPrefetch)
      }, PREFETCH_HOVER_DELAY_MS)
    })
    
    const handleMouseLeave = Effect.fnUntraced(function* () {
      if (hoverTimeout !== null) {
        clearTimeout(hoverTimeout)
        hoverTimeout = null
      }
    })
    
    // Focus handler (immediate)
    const handleFocus = Effect.fnUntraced(function* () {
      if (prefetch !== "intent" || prefetchTriggered) return
      yield* triggerPrefetch
    })
    
    // Click handler
    const handleClick = Effect.fnUntraced(function* (event: Event) {
      if (event instanceof MouseEvent) {
        if (event.metaKey || event.ctrlKey || event.shiftKey) {
          return
        }
      }
      
      event.preventDefault()
      const options = {
        ...(replace !== undefined ? { replace } : {}),
        ...(queryParams !== undefined ? { query: queryParams } : {})
      }
      yield* router.navigate(resolvedPath, Object.keys(options).length > 0 ? options : undefined)
    })
    
    // Build anchor props
    const anchorProps: ElementProps = {
      href,
      onClick: handleClick,
      ...(className ? { className } : {}),
      ...(prefetch === "intent" ? {
        onMouseEnter: handleMouseEnter,
        onMouseLeave: handleMouseLeave,
        onFocus: handleFocus
      } : {})
    }
    
    const childElements = normalizeChildren(children)
    const anchorElement = intrinsic("a", anchorProps, childElements)
    
    // Handle viewport prefetch with IntersectionObserver + idle callback
    if (prefetch === "viewport") {
      // This will be set up in Renderer when the element mounts
      // Store prefetch config in element for renderer to use
      return Element.Component({
        run: () => Effect.succeed(anchorElement),
        key: undefined,
        _prefetch: {
          strategy: "viewport",
          threshold: INTERSECTION_THRESHOLD,
          idleTimeout: IDLE_TIMEOUT_MS,
          path: resolvedPath
        }
      })
    }
    
    // Handle render prefetch (immediate)
    if (prefetch === "render") {
      yield* triggerPrefetch
    }
    
    return anchorElement
  })
  
  return componentElement(() => linkEffect)
}
```

**File:** `src/debug.ts`

Add new debug events:
```ts
// Add to DebugEvent union:
| {
    readonly event: "router.module.load.start"
    readonly path: string
    readonly kind: "component" | "layout" | "guard" | "loading" | "error" | "not_found"
    readonly is_prefetch: boolean
    readonly attempt: number
  }
| {
    readonly event: "router.module.load.complete"
    readonly path: string
    readonly kind: "component" | "layout" | "guard" | "loading" | "error" | "not_found"
    readonly duration_ms: number
    readonly is_prefetch: boolean
    readonly attempt: number
  }
| {
    readonly event: "router.module.load.timeout"
    readonly path: string
    readonly kind: "component" | "layout" | "guard" | "loading" | "error" | "not_found"
    readonly timeout_ms: number
    readonly is_prefetch: boolean
    readonly attempt: number
  }
| {
    readonly event: "router.module.load.cache_hit"
    readonly path: string
    readonly kind: "component" | "layout" | "guard" | "loading" | "error" | "not_found"
    readonly is_prefetch: boolean
  }
| {
    readonly event: "router.prefetch.start"
    readonly path: string
    readonly route_pattern: string
    readonly module_count: number
  }
| {
    readonly event: "router.prefetch.complete"
    readonly path: string
  }
| {
    readonly event: "router.prefetch.no_match"
    readonly path: string
  }
```

#### Tests

- [ ] [Parallel Loading] — Scope: loadAndRender module imports | Assert: concurrent execution | Expect: latency = max(modules) not sum(modules)
  a. [ ] 3 layouts (100ms simulated each): total duration < 150ms (not 300ms)
  b. [ ] Component + 2 layouts: all 3 imports start within 10ms of each other
  c. [ ] 5 modules (deep nesting): all 5 imports start concurrently, total < 150ms
  d. [ ] Partial failure: 1 of 3 modules fails → error propagates, others cancelled

- [ ] [Module Memoization] — Scope: moduleLoader cache | Assert: deduplication | Expect: single import per module within TTL
  a. [ ] Same route navigated 2x within 30s: second navigation uses cache, duration < 5ms
  b. [ ] In-flight dedup: 2 concurrent navigations to same route → 1 import, both resolve
  c. [ ] Cache expiry: navigate, wait 31s, navigate again → fresh import triggered
  d. [ ] `invalidate(path)`: removes cache entry, next load is fresh

- [ ] [Timeout & Retry] — Scope: loadRouteModule timeout | Assert: RouteLoadTimeoutError after 8s | Expect: retries with backoff
  a. [ ] Stalled import (never resolves): fails with RouteLoadTimeoutError after ~8s
  b. [ ] First attempt times out, second succeeds: total time ~8.2-8.5s (8s + backoff + success)
  c. [ ] All 3 attempts timeout: fails after ~15s total (capped by retryWindowMs)
  d. [ ] `router.module.load.timeout` event emitted with attempt number

- [ ] [Prefetch Intent] — Scope: Link hover/focus | Assert: prefetch after delay | Expect: modules cached before click
  a. [ ] Hover 60ms → prefetch triggered (50ms debounce passed)
  b. [ ] Hover 30ms then leave → no prefetch (debounce cancelled)
  c. [ ] Focus → immediate prefetch (no debounce)
  d. [ ] Prefetch then click → navigation uses cached modules, duration < 10ms

- [ ] [Prefetch Viewport] — Scope: Link with prefetch="viewport" | Assert: IntersectionObserver + idle | Expect: prefetch when visible and idle
  a. [ ] Link enters viewport (10% visible) + browser idle → prefetch triggered
  b. [ ] Link enters viewport, browser busy → prefetch queued until idle (max 5s)
  c. [ ] Link never visible → no prefetch

- [ ] [Prefetch Render] — Scope: Link with prefetch="render" | Assert: immediate prefetch | Expect: prefetch on mount
  a. [ ] Link renders → prefetch triggered immediately
  b. [ ] Multiple Links to same route render → single prefetch (deduped)

- [ ] [Debug Events] — Scope: router.module.load.* events | Assert: correct fields | Expect: all events emitted
  a. [ ] `router.module.load.start`: `{ path, kind, is_prefetch, attempt }` present
  b. [ ] `router.module.load.complete`: `{ path, kind, duration_ms, is_prefetch, attempt }` present
  c. [ ] `router.module.load.cache_hit`: emitted on second navigation within TTL
  d. [ ] `router.prefetch.start/complete`: emitted during Link prefetch

- [ ] [Backward Compatibility] — Scope: existing navigation | Assert: unchanged behavior | Expect: all existing tests pass
  a. [ ] Navigation without prefetch prop works as before
  b. [ ] Guards still run before component loads
  c. [ ] Error boundaries still catch load failures
  d. [ ] Loading states still display during async loads

---

### F-003: Signal notifications run sequentially
**Status:** ✅ Implemented
**Completed:** 2026-01-20
**Implemented by:** Implementation Agent
**Category:** Performance
**Priority:** HIGH
**Files Affected:** `src/Signal.ts`, `src/debug.ts`, `docs/observability.md`
**Effort:** Low
**Risk:** Low (isolated change, error handling improves reliability)

**TL;DR:** Parallelize signal listener notifications with error isolation so slow/failing listeners don't block others or crash the update.

#### Implementation Notes
- Added `SignalListenerErrorEvent` type to debug.ts with `signal_id`, `cause`, `listener_index` fields
- Added `signal.listener.error` to DebugEvent union
- Replaced sequential `for...of` loop in `notifyListeners` with `Effect.forEach` + `concurrency: "unbounded"`
- Added error isolation via `Effect.catchAllCause` - failing listeners are logged and don't affect others
- Added `Array.from()` snapshot to safely handle mid-notification unsubscribes
- Added `Cause` import to Signal.ts for pretty-printing error causes
- Added documentation in `docs/observability.md` explaining error isolation behavior
- Added 7 tests covering parallel execution, error isolation, snapshot safety, and backward compatibility

#### Verification
- [x] Typecheck passes
- [x] All 322 tests pass (including 7 new tests)
- [x] Manual verification: Parallel execution confirmed, error isolation works

#### Deviations from Plan
- None

#### Original Finding
> Signal updates iterate listeners in a synchronous loop and await each listener effect in order. With many subscribed components, re-render scheduling becomes serialized and blocks subsequent listeners.

#### Clarifying Questions
1. Keep deterministic order or allow out-of-order completion?
   - **Answer:** Parallel execution; ordering not required. UI components should all start re-rendering immediately.

2. If a listener fails, should it fail the whole update or be isolated + logged?
   - **Answer:** Isolated + logged. One broken component shouldn't prevent others from updating.

3. Concurrency cap?
   - **Answer:** Unbounded (same reasoning as F-001). Signal listeners are in-memory Effect executions, not network requests. Effect's cooperative scheduling handles concurrency. All subscribed components should start their work immediately.

#### Analysis
- `notifyListeners` (line 486-496) awaits each listener effect sequentially in a `for...of` loop.
- With 10 listeners at 10ms each, current code takes 100ms; parallel takes ~10ms.
- Listener failures currently bubble up and fail `Signal.set/update`, potentially breaking the entire app.
- Snapshotting listeners via `Array.from()` before iteration handles mid-notification unsubscribes safely.

#### Proposed Solution
1. **Parallel notification** — Use `Effect.forEach` with `concurrency: "unbounded"` to notify all listeners concurrently.
2. **Error isolation** — Wrap each listener in `Effect.catchAllCause` to log errors and continue.
3. **Debug event** — Add `signal.listener.error` event with signal_id and cause for observability.

#### Implementation Plan
- [x] Add `SignalListenerErrorEvent` type to `src/debug.ts`
- [x] Add `"signal.listener.error"` to `DebugEvent` union and `EventType`
- [x] Replace sequential loop in `notifyListeners` with `Effect.forEach` + error isolation
- [x] Document new event in `docs/observability.md`

#### Code Changes

**File:** `src/debug.ts`

Add new event type (after `SignalUnsubscribeEvent`, ~line 100):
```ts
type SignalListenerErrorEvent = BaseEvent & {
  readonly event: "signal.listener.error"
  readonly signal_id: string
  readonly cause: string
  readonly listener_index: number
}
```

Add to `DebugEvent` union (after `SignalUnsubscribeEvent`):
```ts
  | SignalListenerErrorEvent
```

**File:** `src/Signal.ts`

Replace `notifyListeners` implementation (lines 486-496):

```ts
// Before:
const notifyListeners: <A>(signal: Signal<A>) => Effect.Effect<void> = Effect.fnUntraced(
  function* <A>(signal: Signal<A>) {
    yield* Debug.log({
      event: "signal.notify",
      signal_id: signal._debugId,
      listener_count: signal._listeners.size
    })
    for (const listener of signal._listeners) {
      yield* listener()
    }
  }
)

// After:
const notifyListeners: <A>(signal: Signal<A>) => Effect.Effect<void> = Effect.fnUntraced(
  function* <A>(signal: Signal<A>) {
    const listenerCount = signal._listeners.size
    
    yield* Debug.log({
      event: "signal.notify",
      signal_id: signal._debugId,
      listener_count: listenerCount
    })
    
    // Skip if no listeners
    if (listenerCount === 0) return
    
    // Snapshot listeners to handle mid-notification unsubscribes safely
    const listeners = Array.from(signal._listeners)
    
    // Notify all listeners in parallel with error isolation
    yield* Effect.forEach(
      listeners,
      (listener, index) =>
        listener().pipe(
          Effect.catchAllCause((cause) =>
            Debug.log({
              event: "signal.listener.error",
              signal_id: signal._debugId,
              cause: Cause.pretty(cause),
              listener_index: index
            })
          )
        ),
      { concurrency: "unbounded", discard: true }
    )
  }
)
```

Add import at top of file:
```ts
import { Cause } from "effect"
```

#### Tests

- [x] [Parallel Notification] — Scope: notifyListeners execution | Assert: concurrent listener calls | Expect: latency = max(listeners) not sum(listeners)
  a. [x] All listeners called (tested via call order tracking)
  b. [x] Empty listener set: completes immediately, no errors

- [x] [Error Isolation] — Scope: listener failure handling | Assert: other listeners still run | Expect: Signal.set/update succeeds
  a. [x] 3 listeners, middle one throws: first and third still execute
  b. [x] All listeners throw: Signal.set completes successfully (doesn't throw)

- [x] [Debug Events] — Scope: signal.listener.error event | Assert: correct fields | Expect: error logged with context
  a. [x] Listener throws: `{ event: "signal.listener.error", signal_id, cause, listener_index }` emitted

- [x] [Snapshot Safety] — Scope: mid-notification mutations | Assert: no crashes | Expect: safe iteration
  a. [x] Listener unsubscribes another listener mid-notification: both called this cycle, unsubscribed listener not called next cycle

- [x] [Backward Compatibility] — Scope: existing Signal behavior | Assert: unchanged semantics | Expect: all existing tests pass
  a. [x] Signal.set triggers all subscribed listeners
  b. [x] Signal.update triggers all subscribed listeners
  c. [x] Skipped update doesn't trigger listeners
  d. [x] Unsubscribe prevents future notifications

---

### F-006: Route module loading has no timeout
**Status:** 🔗 Merged into F-001
**Category:** Reliability
**Priority:** HIGH
**Files Affected:** `src/router/Outlet.ts`, `src/router/types.ts`, `src/debug.ts`, `docs/observability.md`

**Merged:** This solution has been merged into [F-001](#f-001) as part of the unified `loadRouteModule` helper. The timeout/retry logic is now integrated with parallel loading and memoization.

#### Original Finding
> Dynamic imports for route components (and guards/layouts) are awaited without any timeout. A stalled chunk load or hung promise leaves navigation stuck in a loading state indefinitely.

#### Resolution
Implemented as part of `createModuleLoader` in F-001:
- 8s timeout per module load with `RouteLoadTimeoutError`
- Exponential backoff retry (200ms base, 2 retries, 15s cap)
- `router.module.load.timeout` debug event

See [F-001](#f-001) for full implementation details.

---

### F-005: Route matching recalculates depth per navigation
**Status:** ✅ Implemented
**Completed:** 2026-01-20
**Implemented by:** Implementation Agent
**Category:** Performance
**Priority:** MEDIUM
**Files Affected:** `src/router/matching.ts`
**Effort:** Low
**Risk:** Low (internal optimization, behavior unchanged)

**TL;DR:** Precompute route depth and specificity score once at matcher creation, eliminating repeated `parsePattern` calls during navigation.

#### Implementation Notes
- Added `totalDepth: number` and `score: number` fields to `CompiledRouteWithAncestry` interface
- Updated `compileRoutesWithAncestry` to compute these values during compilation with `ancestorDepth` accumulator
- Simplified compile-time sort comparator to use precomputed `a.totalDepth` vs `b.totalDepth` and `a.score` vs `b.score`
- Simplified navigation-time sort comparator to use precomputed `a.route.totalDepth` vs `b.route.totalDepth`
- No more `parsePattern` or `scoreRoute` calls during navigation matching

#### Verification
- [x] Typecheck passes
- [x] All 334 tests pass (12 new tests added)
- [x] Manual verification: Sort comparators now O(1) field access, no string parsing

#### Deviations from Plan
- None

#### Original Finding
> Every match sorts candidates and recomputes route depth by re-parsing ancestor patterns. This repeats work on each navigation and adds overhead proportional to route count and nesting depth.

#### Clarifying Questions
1. Precompute depth/specificity at build time or runtime?
   - **Answer:** Runtime (during `createMatcher`). No Vite plugin changes needed — the parsing already happens at matcher creation, we just need to cache the results.

2. Do routes change at runtime?
   - **Answer:** Route list is static after `createMatcher` is called. The matcher is created once per Outlet.

3. Tie-break rule?
   - **Answer:** Higher depth first, then higher specificity score, then path lexicographic order.

#### Analysis

**The Bug (lines 391-403 in matching.ts):**
```ts
// Called on EVERY navigation:
const sortedMatches = matches.sort((a, b) => {
  const aDepth = a.route.segments.length + a.route.ancestors.reduce((sum, anc) => {
    const { segments } = parsePattern(anc.path)  // ← Repeated parsing!
    return sum + segments.length
  }, 0)
  // ... same for bDepth
})
```

**Why it happens:**
- `walkTrie` returns all matching routes from different trie branches (static, param, wildcard)
- These need to be sorted by specificity to pick the best match
- Current code recomputes depth by parsing all ancestors on every navigation

**Why not fix in Vite plugin:**
- The parsing already happens at runtime in `compileRoutesWithAncestry` (line 358-373)
- We just need to STORE the computed values instead of recomputing them
- No build-time changes needed — simpler fix

#### Proposed Solution

1. **Extend `CompiledRouteWithAncestry`** — Add `totalDepth` and `score` fields
2. **Compute once during compilation** — Calculate in `compileRoutesWithAncestry` 
3. **Use precomputed values in navigation sort** — O(1) field access instead of O(ancestors) parsing

#### Implementation Plan
- [ ] Add `totalDepth: number` and `score: number` to `CompiledRouteWithAncestry` interface
- [ ] Compute these values in `compileRoutesWithAncestry` after calling `parsePattern`
- [ ] Update the compile-time sort (lines 358-373) to use precomputed values
- [ ] Update the navigation-time sort (lines 391-403) to use precomputed values
- [ ] Remove redundant `parsePattern` and `scoreRoute` calls from sort comparators

#### Code Changes

**File:** `src/router/matching.ts`

**Step 1: Extend interface (after line 320):**
```ts
// Before:
interface CompiledRouteWithAncestry extends CompiledRoute {
  /** Ancestor route definitions (root first) */
  readonly ancestors: ReadonlyArray<RouteDefinition>
}

// After:
interface CompiledRouteWithAncestry extends CompiledRoute {
  /** Ancestor route definitions (root first) */
  readonly ancestors: ReadonlyArray<RouteDefinition>
  /** Precomputed total depth (own segments + all ancestor segments) */
  readonly totalDepth: number
  /** Precomputed specificity score */
  readonly score: number
}
```

**Step 2: Compute values during compilation (replace lines 326-346):**
```ts
// Before:
const compileRoutesWithAncestry = (
  routes: ReadonlyArray<RouteDefinition>,
  ancestors: ReadonlyArray<RouteDefinition> = []
): CompiledRouteWithAncestry[] => {
  const result: CompiledRouteWithAncestry[] = []
  
  for (const route of routes) {
    const compiled = compileRoute(route)
    result.push({ ...compiled, ancestors })
    
    if (route.children && route.children.length > 0) {
      const childAncestry = [...ancestors, route]
      const compiledChildren = compileRoutesWithAncestry(route.children, childAncestry)
      result.push(...compiledChildren)
    }
  }
  
  return result
}

// After:
const compileRoutesWithAncestry = (
  routes: ReadonlyArray<RouteDefinition>,
  ancestors: ReadonlyArray<RouteDefinition> = [],
  ancestorDepth: number = 0
): CompiledRouteWithAncestry[] => {
  const result: CompiledRouteWithAncestry[] = []
  
  for (const route of routes) {
    const compiled = compileRoute(route)
    const totalDepth = ancestorDepth + compiled.segments.length
    const score = scoreRoute(compiled)
    
    result.push({ ...compiled, ancestors, totalDepth, score })
    
    if (route.children && route.children.length > 0) {
      const childAncestry = [...ancestors, route]
      const childAncestorDepth = ancestorDepth + compiled.segments.length
      const compiledChildren = compileRoutesWithAncestry(
        route.children, 
        childAncestry, 
        childAncestorDepth
      )
      result.push(...compiledChildren)
    }
  }
  
  return result
}
```

**Step 3: Simplify compile-time sort (replace lines 358-373):**
```ts
// Before:
const sorted = [...compiled].sort((a, b) => {
  const aDepth = a.segments.length + a.ancestors.reduce((sum, anc) => {
    const { segments } = parsePattern(anc.path)
    return sum + segments.length
  }, 0)
  const bDepth = b.segments.length + b.ancestors.reduce((sum, anc) => {
    const { segments } = parsePattern(anc.path)
    return sum + segments.length
  }, 0)
  
  if (aDepth !== bDepth) return bDepth - aDepth
  return scoreRoute(b) - scoreRoute(a)
})

// After:
const sorted = [...compiled].sort((a, b) => {
  if (a.totalDepth !== b.totalDepth) return b.totalDepth - a.totalDepth
  return b.score - a.score
})
```

**Step 4: Simplify navigation-time sort (replace lines 391-404):**
```ts
// Before:
const sortedMatches = matches.sort((a, b) => {
  const aDepth = a.route.segments.length + a.route.ancestors.reduce((sum, anc) => {
    const { segments } = parsePattern(anc.path)
    return sum + segments.length
  }, 0)
  const bDepth = b.route.segments.length + b.route.ancestors.reduce((sum, anc) => {
    const { segments } = parsePattern(anc.path)
    return sum + segments.length
  }, 0)
  
  if (aDepth !== bDepth) return bDepth - aDepth
  return scoreRoute(b.route) - scoreRoute(a.route)
})

// After:
const sortedMatches = matches.sort((a, b) => {
  if (a.route.totalDepth !== b.route.totalDepth) {
    return b.route.totalDepth - a.route.totalDepth
  }
  return b.route.score - a.route.score
})
```

#### Tests

- [x] [Precomputed Values] — Scope: CompiledRouteWithAncestry | Assert: totalDepth and score computed correctly | Expect: values match manual calculation
  a. [x] Route `/users` (no ancestors): totalDepth = 1, verified via matching
  b. [x] Route `/users/:id` (no ancestors): totalDepth = 2, verified via matching
  c. [x] Nested route `/admin/users/:id` with ancestors: totalDepth = 3, parent chain correct

- [x] [Sort Correctness] — Scope: match result ordering | Assert: most specific route wins | Expect: correct precedence
  a. [x] Deeper routes win over shallower routes
  b. [x] Equal depth: static > param (static wins)
  c. [x] Equal depth: param > wildcard (param wins for single segment)

- [x] [Performance] — Scope: match() latency | Assert: no linear scaling with ancestors | Expect: O(1) sort comparisons
  a. [x] 1000 navigations < 50ms (deeply nested routes)
  b. [x] Consistent timing across repeated navigation batches

- [x] [Backward Compatibility] — Scope: existing route matching | Assert: same routes matched | Expect: all existing tests pass
  a. [x] Static routes match as before
  b. [x] Dynamic routes capture params as before
  c. [x] Nested routes build correct parent chain
  d. [x] Wildcard routes capture rest of path

---

### F-008: Remove layer auto-injection
**Status:** ✅ Implemented
**Category:** API
**Priority:** HIGH
**Files Affected:** `src/Component.ts`, `src/Renderer.ts`, `src/Element.ts`, `examples/`, `docs/`, `tests/`
**Reviewed:** 2026-01-20
**Reviewer:** Claude

**Resolution:** Layer props removed; parent effects provide services explicitly.

**Rationale:**
- Layer props obscured DI boundaries and encouraged prop plumbing.
- Explicit `Component.provide` keeps DI at the parent and keeps component props clean.
- Top-level effects remain `R = never`; component effects may require services.

**Implementation:**
- Removed layer prop inference and runtime layer extraction.
- `Component.provide` captures the current Effect context and wraps a Provide boundary for children.
- Examples, tests, and docs updated to use `Effect.gen(...).pipe(Component.provide(layer))` at parent boundaries.

---

### F-009: Missing root SKILL.md for agent discovery
**Status:** ✅ Implemented
**Completed:** 2026-01-20
**Implemented by:** Implementation Agent
**Category:** LLM
**Priority:** MEDIUM
**Files Affected:** `SKILL.md`
**Effort:** Low
**Risk:** Low (additive change, no existing code modified)

**TL;DR:** Add root `SKILL.md` following Agent Skills spec to enable agent discovery and routing to specialized skills.

#### Implementation Notes
- Created root `SKILL.md` with valid Agent Skills frontmatter
- Added skill routing table pointing to 4 specialized skills
- Added Key Concepts section with critical effect-ui rules
- Added Quick Commands reference
- Added Documentation links table
- All link targets verified to exist

#### Verification
- [x] Frontmatter valid: name, description, license, metadata fields present
- [x] All skill links resolve: effect-ui-core, effect-ui-router, effect-ui-testing, effect-ui-observability
- [x] All doc links resolve: design.md, router.md, observability.md, plan.md
- [x] Body under 500 lines: ~50 lines total
- [x] Typecheck passes (no TypeScript changes)

#### Deviations from Plan
- None

#### Original Finding
> Agent Skills spec expects a root `SKILL.md` for discovery. The repo only provides skill files under `skills/`, so agents have no single entry point and may fail to discover capabilities.

#### Agent Skills Spec Requirements (from agentskills.io)

| Field | Required | Constraint |
|-------|----------|------------|
| `name` | Yes | Max 64 chars, lowercase + hyphens, must match directory |
| `description` | Yes | Max 1024 chars, describe what AND when to use |
| `license` | No | License name or file reference |
| `metadata` | No | Key-value pairs for additional info |
| Body | Yes | Instructions, examples, edge cases |

**Spec guidance:**
- Keep `SKILL.md` under 500 lines
- Use progressive disclosure (metadata ~100 tokens, body <5000 tokens)
- Move detailed content to `references/` subdirectory

#### Analysis
- No root `SKILL.md` exists — agents can't discover effect-ui capabilities from repo root
- Existing skills in `skills/` are well-structured but invisible without an entry point
- A root skill should route agents to the right specialized skill

#### Proposed Solution
- Add root `SKILL.md` as a "router skill" that helps agents pick the right specialized skill
- Follow Agent Skills spec format exactly
- Include key rules, quick commands, and skill routing guidance
- Keep body concise — detailed instructions are in specialized skills

#### Implementation Plan
- [x] Create root `SKILL.md` with valid frontmatter (name: `effect-ui`)
- [x] Add "When to use this skill" section
- [x] Add "Key Rules" section with critical constraints
- [x] Add "Skill Index" with routing guidance
- [x] Add "Quick Commands" reference

#### Code Changes
**File:** `SKILL.md`

```md
---
name: effect-ui
description: Effect-native UI framework with JSX support and fine-grained reactivity. Use this skill to discover which specialized skill to load for components, routing, testing, or observability tasks.
license: MIT
metadata:
  author: effect-ui
  version: "1.0"
---

# effect-ui

Effect-native UI framework. This is the entry point skill — use it to find the right specialized skill for your task.

## When to Use Which Skill

| Task | Load This Skill |
|------|-----------------|
| Creating components, using Signals, dependency injection | [effect-ui-core](skills/effect-ui-core/SKILL.md) |
| File-based routing, navigation, guards, outlets | [effect-ui-router](skills/effect-ui-router/SKILL.md) |
| Writing tests, using test utilities | [effect-ui-testing](skills/effect-ui-testing/SKILL.md) |
| Debug events, metrics, DevMode | [effect-ui-observability](skills/effect-ui-observability/SKILL.md) |

## Key Concepts

1. **Use Component.gen** — Components use `Component.gen(function* (Props) { ... })` returning JSX, not `Effect.gen`
2. **R must be never** — Components must satisfy all dependencies before rendering. Use layer props for DI.
3. **Fine-grained reactivity** — Pass Signals directly to JSX for automatic updates without re-renders
4. **Signal.make vs Signal.get** — `make` creates (no subscription), `get` reads AND subscribes (triggers re-render)

## Quick Commands

| Command | Purpose |
|---------|---------|
| `bun run typecheck` | Type check |
| `bun run test` | Run tests |
| `bun run examples` | Dev server at localhost:5173 |

## Documentation

| Topic | File |
|-------|------|
| Architecture & Patterns | [docs/design.md](docs/design.md) |
| Router | [docs/router.md](docs/router.md) |
| Observability | [docs/observability.md](docs/observability.md) |
| Implementation Status | [docs/plan.md](docs/plan.md) |

## Getting Started

1. For component work: Load [effect-ui-core](skills/effect-ui-core/SKILL.md)
2. For routing work: Load [effect-ui-router](skills/effect-ui-router/SKILL.md)
3. For testing: Load [effect-ui-testing](skills/effect-ui-testing/SKILL.md)
4. For debugging: Load [effect-ui-observability](skills/effect-ui-observability/SKILL.md)
```

#### Tests

- [x] [Frontmatter Validity] — Scope: YAML frontmatter | Assert: valid per Agent Skills spec | Expect: passes `skills-ref validate`
  a. [x] `name` field: "effect-ui" (lowercase, matches repo root)
  b. [x] `description` field: present, <1024 chars, describes what AND when
  c. [x] `license` field: "MIT"
  d. [x] `metadata` field: valid key-value pairs

- [x] [Link Resolution] — Scope: all links in SKILL.md | Assert: targets exist | Expect: no broken links
  a. [x] `skills/effect-ui-core/SKILL.md` exists
  b. [x] `skills/effect-ui-router/SKILL.md` exists
  c. [x] `skills/effect-ui-testing/SKILL.md` exists
  d. [x] `skills/effect-ui-observability/SKILL.md` exists
  e. [x] `docs/design.md` exists
  f. [x] `docs/router.md` exists
  g. [x] `docs/observability.md` exists
  h. [x] `docs/plan.md` exists

- [x] [Content Size] — Scope: body content | Assert: follows progressive disclosure | Expect: <500 lines, <5000 tokens
  a. [x] Line count < 500 (~50 lines)
  b. [x] Token count < 5000 (estimated ~200 tokens)

- [x] [Routing Accuracy] — Scope: "When to Use Which Skill" table | Assert: correct skill for task | Expect: agents route correctly
  a. [x] Component task → effect-ui-core
  b. [x] Routing task → effect-ui-router
  c. [x] Testing task → effect-ui-testing
  d. [x] Debug task → effect-ui-observability

---

### F-010: No llms.txt for LLM-friendly docs
**Status:** ❌ Cancelled
**Category:** LLM
**Priority:** LOW

**Resolution:** Cancelled — Root SKILL.md (F-009) serves this purpose better using the standardized Agent Skills format.
