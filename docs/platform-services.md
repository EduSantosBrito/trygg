# Platform Services

## 1. Motivations

effect-ui currently scatters native browser API calls across 135+ call sites in renderer, router, scroll-strategy, head, portal, debug, and testing modules. Each boundary between the browser's sync callback world and Effect requires `Runtime.runSync` or `Runtime.runFork` — these are placed ad-hoc wherever a popstate fires, an IntersectionObserver triggers, or a setTimeout expires.

Problems with the current approach:

- **Runtime.run\* leaks into consumer code.** The router builds its own `Runtime.runFork(runtime)(effect)` inside popstate handlers, idle callbacks, and observer entries. Consumers must understand *when* and *how* to bridge sync→Effect.
- **No error isolation.** DOM operations (`appendChild`, `scrollTo`, `sessionStorage.setItem`) are called raw. If they throw (quota exceeded, security restrictions, private browsing), the error is either swallowed via `try/catch` or crashes the fiber.
- **SSR is guarded per-call.** Every call site independently checks `typeof window !== "undefined"`. Miss one and SSR blows up.
- **Untestable without JSDOM.** There is no way to mock `document.createElement` or `sessionStorage` without loading a full DOM environment. Test layers can't substitute platform behavior.
- **No structural guarantee.** Nothing prevents a future contributor from calling `window.history.pushState` directly instead of going through the router. Platform access is ambient, not injected.

## 2. Benefits

| Before | After |
|--------|-------|
| `Runtime.runFork` in 4+ consumer files | `Runtime.runFork` in service implementations only — consumers see pure Effect APIs |
| `typeof window !== "undefined"` at 12+ call sites | SSR safety encoded in the service layer — browser layer assumes browser, test layer assumes nothing |
| Raw `try/catch` around `sessionStorage` | `StorageError` in the error channel — callers decide to retry, log, or propagate |
| JSDOM required for any component test | Provide `Platform.test` layer — pure in-memory, no global mocks |
| 135+ unstructured native API calls | Each call goes through a typed service — IDE autocomplete, grep-able, auditable |
| Event subscriptions manually cleaned up | Scope-managed — subscription removed when scope closes, no leak possible |

## 3. Single Responsibility

### Definition

A service has single responsibility when:

1. It can be described in one sentence without "and" or "or."
2. It has exactly one reason to be swapped for a different implementation.
3. Its test layer is trivially mockable (in-memory state, no real I/O).

### How to approach

Ask: "If I swap this for a test double, what behavior changes?"

- **Dom** — "safely interact with the document tree." Swap: in-memory node tree.
- **Storage** — "persist and retrieve string key-value pairs." Swap: `Map<string, string>`.
- **History** — "manage the navigation stack." Swap: in-memory array + index.
- **Scroll** — "control viewport scroll position." Swap: no-op or position tracker.
- **Location** — "read the current URL." Swap: hardcoded path.
- **EventTarget** — "subscribe to events with lifecycle." Swap: manual dispatch.
- **Observer** — "observe DOM visibility/mutations with lifecycle." Swap: manual trigger.
- **Idle** — "schedule work during idle periods." Swap: immediate execution.
- **Crypto** — "generate random identifiers." Swap: deterministic counter.

If two capabilities have different test doubles, they are different services.

## 4. Effect Context/Service Pattern

### How it works

Effect uses `Context.Tag` to define a typed slot in the dependency graph. Services are:
1. **Defined** as an interface + Tag (the "what")
2. **Provided** as a Layer (the "how")
3. **Consumed** via `yield*` (the "use")

The Tag acts as a type-safe key. The Layer provides the implementation. Consumers never import the implementation — only the Tag and interface.

### Boilerplate

```ts
import { Context, Data, Effect, Layer, Scope } from "effect"

// =============================================================================
// Error type
// =============================================================================

export class StorageError extends Data.TaggedError("StorageError")<{
  readonly operation: "get" | "set" | "remove"
  readonly key: string
  readonly cause: unknown
}> {}

// =============================================================================
// Service interface
// =============================================================================

export interface StorageService {
  readonly get: (key: string) => Effect.Effect<string | null, StorageError>
  readonly set: (key: string, value: string) => Effect.Effect<void, StorageError>
  readonly remove: (key: string) => Effect.Effect<void, StorageError>
}

// =============================================================================
// Tag
// =============================================================================

export class Storage extends Context.Tag("effect-ui/platform/Storage")<
  Storage,
  StorageService
>() {}

// =============================================================================
// Browser layer (real implementation)
// =============================================================================

export const browser: Layer.Layer<Storage> = Layer.succeed(
  Storage,
  Storage.of({
    get: (key) =>
      Effect.try({
        try: () => sessionStorage.getItem(key),
        catch: (cause) => new StorageError({ operation: "get", key, cause }),
      }),

    set: (key, value) =>
      Effect.try({
        try: () => { sessionStorage.setItem(key, value) },
        catch: (cause) => new StorageError({ operation: "set", key, cause }),
      }),

    remove: (key) =>
      Effect.try({
        try: () => { sessionStorage.removeItem(key) },
        catch: (cause) => new StorageError({ operation: "remove", key, cause }),
      }),
  })
)

// =============================================================================
// Test layer (in-memory implementation)
// =============================================================================

export const test: Layer.Layer<Storage> = Layer.effect(
  Storage,
  Effect.sync(() => {
    const store = new Map<string, string>()

    return Storage.of({
      get: (key) => Effect.succeed(store.get(key) ?? null),
      set: (key, value) => Effect.sync(() => { store.set(key, value) }),
      remove: (key) => Effect.sync(() => { store.delete(key) }),
    })
  })
)
```

### Consumer usage

```ts
import { Storage } from "./platform/storage.js"

const saveScrollPosition = (key: string, x: number, y: number) =>
  Effect.gen(function* () {
    const storage = yield* Storage
    yield* storage.set(`scroll:${key}`, JSON.stringify({ x, y }))
  })
```

### Test usage

```ts
import { it } from "@effect/vitest"
import { Storage } from "./platform/storage.js"

it.effect("saves scroll position", () =>
  Effect.gen(function* () {
    const storage = yield* Storage
    yield* saveScrollPosition("page-1", 0, 150)
    const result = yield* storage.get("scroll:page-1")
    expect(result).toBe(JSON.stringify({ x: 0, y: 150 }))
  }).pipe(Effect.provide(Storage.test))
)
```

## 5. Services

### 5.1 Dom

**Scope:** All document and element operations — creation, mutation, attributes, properties, queries.

**Methods:**

| Method | Signature | Wraps |
|--------|-----------|-------|
| `createElement` | `(tag: string) => Effect<HTMLElement>` | `document.createElement(tag)` |
| `createComment` | `(text: string) => Effect<Comment>` | `document.createComment(text)` |
| `createTextNode` | `(text: string) => Effect<Text>` | `document.createTextNode(text)` |
| `createFragment` | `() => Effect<DocumentFragment>` | `document.createDocumentFragment()` |
| `createTreeWalker` | `(root: Node, whatToShow: number) => Effect<TreeWalker>` | `document.createTreeWalker(root, whatToShow)` |
| `appendChild` | `(parent: Node, child: Node) => Effect<void>` | `parent.appendChild(child)` |
| `insertBefore` | `(parent: Node, node: Node, ref: Node \| null) => Effect<void>` | `parent.insertBefore(node, ref)` |
| `replaceChild` | `(parent: Node, newChild: Node, oldChild: Node) => Effect<void>` | `parent.replaceChild(newChild, oldChild)` |
| `remove` | `(node: Node) => Effect<void>` | `node.remove()` |
| `setAttribute` | `(el: Element, key: string, value: string) => Effect<void>` | `el.setAttribute(key, value)` |
| `removeAttribute` | `(el: Element, key: string) => Effect<void>` | `el.removeAttribute(key)` |
| `getAttribute` | `(el: Element, key: string) => Effect<string \| null>` | `el.getAttribute(key)` |
| `setProperty` | `(node: object, key: string, value: unknown) => Effect<void>` | `(node as any)[key] = value` |
| `assignStyle` | `(el: HTMLElement, styles: object) => Effect<void>` | `Object.assign(el.style, styles)` |
| `querySelector` | `(selector: string, root?: Node) => Effect<Element \| null>` | `(root ?? document).querySelector(selector)` |
| `querySelectorAll` | `(selector: string, root?: Node) => Effect<NodeListOf<Element>>` | `(root ?? document).querySelectorAll(selector)` |
| `getElementById` | `(id: string) => Effect<Element \| null>` | `document.getElementById(id)` |
| `head` | `Effect<HTMLHeadElement>` | `document.head` |
| `body` | `Effect<HTMLBodyElement>` | `document.body` |
| `documentElement` | `Effect<HTMLElement>` | `document.documentElement` |
| `activeElement` | `Effect<Element \| null>` | `document.activeElement` |
| `matches` | `(el: Element, selector: string) => Effect<boolean>` | `el.matches(selector)` |

**Test layer:** In-memory node-like objects (minimal shape needed by consumers). No real DOM.

**How to test:** Verify that rendering a component with the test Dom layer produces the expected node tree structure without JSDOM.

---

### 5.2 Location

**Scope:** Read current URL state.

**Methods:**

| Method | Signature | Wraps |
|--------|-----------|-------|
| `pathname` | `Effect<string>` | `window.location.pathname` |
| `search` | `Effect<string>` | `window.location.search` |
| `hash` | `Effect<string>` | `window.location.hash` |
| `href` | `Effect<string>` | `window.location.href` |
| `fullPath` | `Effect<string>` | `pathname + search + hash` |

**Test layer:** Returns configurable hardcoded values. Mutable ref for testing navigation.

**How to test:** Set initial path in test layer, verify router reads it correctly.

---

### 5.3 History

**Scope:** Manage the browser navigation stack.

**Methods:**

| Method | Signature | Wraps |
|--------|-----------|-------|
| `pushState` | `(state: unknown, url: string) => Effect<void>` | `window.history.pushState(state, "", url)` |
| `replaceState` | `(state: unknown, url: string) => Effect<void>` | `window.history.replaceState(state, "", url)` |
| `back` | `Effect<void>` | `window.history.back()` |
| `forward` | `Effect<void>` | `window.history.forward()` |
| `state` | `Effect<unknown>` | `window.history.state` |

**Test layer:** In-memory array + index. `pushState` appends, `back` decrements index, `state` reads current entry.

**How to test:** Push multiple entries, call back/forward, assert `state` and index match expectations.

---

### 5.4 Storage

**Scope:** Persist and retrieve string key-value pairs.

**Methods:**

| Method | Signature | Wraps |
|--------|-----------|-------|
| `get` | `(key: string) => Effect<string \| null, StorageError>` | `sessionStorage.getItem(key)` |
| `set` | `(key: string, value: string) => Effect<void, StorageError>` | `sessionStorage.setItem(key, value)` |
| `remove` | `(key: string) => Effect<void, StorageError>` | `sessionStorage.removeItem(key)` |

Two Tags: `SessionStorage`, `LocalStorage` — same interface, different browser backends.

**Test layer:** `Map<string, string>`. Can optionally simulate quota errors.

**How to test:** Set values, retrieve them, remove them. Test quota simulation throws `StorageError`.

---

### 5.5 Scroll

**Scope:** Control and read viewport scroll position.

**Methods:**

| Method | Signature | Wraps |
|--------|-----------|-------|
| `scrollTo` | `(x: number, y: number) => Effect<void>` | `window.scrollTo(x, y)` |
| `scrollIntoView` | `(element: Element) => Effect<void>` | `element.scrollIntoView()` |
| `getPosition` | `Effect<{ x: number; y: number }>` | `{ x: window.scrollX, y: window.scrollY }` |

**Test layer:** Mutable `{ x, y }` ref. `scrollTo` sets it. `getPosition` reads it. `scrollIntoView` is no-op.

**How to test:** Call `scrollTo(100, 200)`, assert `getPosition` returns `{ x: 100, y: 200 }`.

---

### 5.6 Crypto

**Scope:** Generate random identifiers.

**Methods:**

| Method | Signature | Wraps |
|--------|-----------|-------|
| `randomUUID` | `Effect<string>` | `crypto.randomUUID()` |
| `randomId` | `(length?: number) => Effect<string>` | `crypto.randomUUID().slice(0, length ?? 8)` |

**Test layer:** Deterministic counter: `"test-id-0"`, `"test-id-1"`, etc. Predictable in snapshots.

**How to test:** Call `randomId` twice, assert different values. With test layer, assert sequential IDs.

---

### 5.7 EventTarget

**Scope:** Subscribe to DOM events with automatic lifecycle management.

**Methods:**

| Method | Signature | Wraps |
|--------|-----------|-------|
| `on` | `(target: EventTarget, event: string, handler: (e: Event) => Effect<void>) => Effect<void, never, Scope>` | `addEventListener` + `removeEventListener` on scope close |

**Implementation detail:** Internally acquires a runtime, creates a sync listener that calls `Runtime.runFork(runtime)(handler(e))`, registers a finalizer that removes the listener.

**Test layer:** Stores registered handlers in a `Map<string, Array<handler>>`. Exposes `dispatch(event, data)` to manually trigger handlers in tests.

**How to test:**
```ts
const et = yield* EventTarget
const received: Array<string> = []
yield* et.on(target, "click", (e) => Effect.sync(() => { received.push("clicked") }))
yield* et.dispatch(target, "click", new Event("click"))  // test-only method
expect(received).toEqual(["clicked"])
```

---

### 5.8 Observer

**Scope:** Observe DOM visibility and mutations with lifecycle.

**Methods:**

| Method | Signature | Description |
|--------|-----------|-------------|
| `intersection` | `(options: IntersectionOptions) => Effect<IntersectionHandle, never, Scope>` | Creates managed IntersectionObserver. Auto-disconnects on scope close. |
| `mutation` | `(target: Node, options: MutationObserverInit, handler: (mutations: MutationRecord[]) => Effect<void>) => Effect<void, never, Scope>` | Creates managed MutationObserver. Auto-disconnects on scope close. |

**IntersectionHandle:**

| Method | Signature |
|--------|-----------|
| `observe` | `(el: Element) => Effect<void>` |
| `unobserve` | `(el: Element) => Effect<void>` |

**IntersectionOptions:**

```ts
interface IntersectionOptions {
  readonly threshold?: number
  readonly rootMargin?: string
  readonly onIntersect: (entry: IntersectionObserverEntry) => Effect<void>
}
```

**Test layer:** `observe` adds elements to a `Set`. Exposes `triggerIntersection(element)` to manually fire the handler.

**How to test:** Observe an element, trigger intersection manually, assert the handler ran (e.g., prefetch was called).

---

### 5.9 Idle

**Scope:** Schedule low-priority work during browser idle periods.

**Methods:**

| Method | Signature | Wraps |
|--------|-----------|-------|
| `request` | `(handler: () => Effect<void>, options?: { timeout?: number }) => Effect<void, never, Scope>` | `requestIdleCallback` + `cancelIdleCallback` on scope close |

**Implementation detail:** Internally acquires runtime, calls `requestIdleCallback(() => Runtime.runFork(runtime)(handler()))`, registers finalizer for `cancelIdleCallback`.

**Test layer:** Executes handler immediately (synchronously) — no idle scheduling in tests.

**How to test:** Call `request(handler)`. With test layer, handler executes immediately. Assert side effects happened.

---

### 5.10 Combined Layer

```ts
// platform/browser.ts
export const browser: Layer.Layer<
  Dom | Location | History | SessionStorage | LocalStorage | Scroll | Crypto | EventTarget | Observer | Idle
> = Layer.mergeAll(
  Dom.browser,
  Location.browser,
  History.browser,
  SessionStorage.browser,
  LocalStorage.browser,
  Scroll.browser,
  Crypto.browser,
  EventTarget.browser,
  Observer.browser,
  Idle.browser,
)

// platform/test.ts
export const test: Layer.Layer<...> = Layer.mergeAll(
  Dom.test,
  Location.test("/"),
  History.test,
  SessionStorage.test,
  LocalStorage.test,
  Scroll.test,
  Crypto.test,
  EventTarget.test,
  Observer.test,
  Idle.test,
)
```

## 6. Postponed Tasks

The following tasks from the Effect-first migration were deferred until platform services are in place. Each task will consume the services directly instead of doing manual Effect wrapping.

### 6.1 scroll-strategy.ts → consume Storage + Scroll services

**Current state:** `Effect.sync` blocks with raw `try/catch` around `sessionStorage` and `window.scrollTo`.

**What to do:**
- `saveScrollPosition` → `yield* storage.set(...)` (error in channel, no try/catch)
- `restoreScrollPosition` → `yield* storage.get(...)` + `yield* scroll.scrollTo(...)`
- `scrollToTop` → `yield* scroll.scrollTo(0, 0)`
- `scrollToHash` → `yield* dom.getElementById(id)` + `yield* scroll.scrollIntoView(el)`
- Remove all `typeof window === "undefined"` guards (SSR safety is in the service layer)
- Remove all `try/catch` (errors surface via `StorageError` in the effect channel)

---

### 6.2 applyPropValue → Effect + Dom service

**Current state:** Sync void function (`renderer.ts:155-220`) with raw DOM property/attribute manipulation and `console.warn` for unsafe URLs.

**What to do:**
- Convert `applyPropValue` to return `Effect<void>`
- Use `dom.setAttribute`, `dom.removeAttribute`, `dom.setProperty`, `dom.assignStyle`
- Replace `SafeUrl.validateSync(url)` with `yield* SafeUrl.validateOption(url)` (already created in Step 2)
- Replace `console.warn` with `yield* Debug.log` for unsafe URL warnings
- Update `applyProps` to `yield* applyPropValue(...)` for each prop

---

### 6.3 setupViewportPrefetch → Observer + Idle + Dom services

**Current state:** Single `Effect.sync` block (`router-service.ts:44-154`) containing raw IntersectionObserver, MutationObserver, requestIdleCallback, and `Runtime.runFork`.

**What to do:**
- Replace `new IntersectionObserver(...)` with `yield* observer.intersection({ onIntersect: ... })`
- Replace `new MutationObserver(...)` with `yield* observer.mutation(document.body, { childList: true, subtree: true }, handler)`
- Replace `requestIdleCallback(...)` with `yield* idle.request(...)`
- Replace `document.querySelectorAll(...)` with `yield* dom.querySelectorAll(...)`
- Remove the sync cleanup function return — scope finalizers handle everything
- Remove `Runtime.runFork(runtime)` — observer/idle services handle the bridging
- Change signature from `Effect<() => void>` to `Effect<void, never, Scope>`
- Remove `runtime` parameter (no longer needed)

---

### 6.4 Event handler scoping in renderer

**Current state:** `renderer.ts:240-243` — event handlers forked via `Runtime.runFork(runtime)(effect)` with no scope management. Fire-and-forget.

**What to do:**
- Use `EventTarget` service: `yield* eventTarget.on(node, eventName, handler)`
- The service forks into the current scope — when the component unmounts (scope closes), in-flight handler fibers are interrupted
- Remove raw `node.addEventListener` / `node.removeEventListener` calls
- Remove `Runtime.runFork(runtime)` from the event handler bridge
- This is effect-ui's structural advantage: handlers cannot outlive their component

---

### 6.5 Router back/forward → History service

**Current state:** `router-service.ts:580-590` — `Effect.sync(() => window.history.back())`.

**What to do:**
- Replace with `yield* history.back` and `yield* history.forward`
- These are now properly Effect-wrapped via the History service
- Change from `Effect.sync` to `Effect.gen` (to yield the service)

---

### 6.6 Router navigate → History + Location + Crypto services

**Current state:** `router-service.ts:540-555` — raw `window.history.pushState`, `crypto.randomUUID`, `window.location.hash`.

**What to do:**
- `crypto.randomUUID().slice(0, 8)` → `yield* crypto.randomId(8)`
- `window.history.pushState(...)` → `yield* history.pushState(state, fullPath)`
- `window.history.replaceState(...)` → `yield* history.replaceState(state, fullPath)`
- `window.location.hash` → `yield* location.hash`
- Remove `typeof crypto !== "undefined"` guard (service handles it)

---

### 6.7 Router initial state → Location + History services

**Current state:** `router-service.ts:421-437` — reads `window.location.*` and `window.history.state` directly.

**What to do:**
- `window.location.pathname + search + hash` → `yield* location.fullPath`
- `window.history.state` → `yield* history.state`
- `window.history.replaceState(...)` → `yield* history.replaceState(...)`
- Remove `typeof window !== "undefined"` guards

---

### 6.8 Router popstate → EventTarget service

**Current state:** `router-service.ts:467-505` — popstate handler uses `Runtime.runFork(runtime)(popstateEffect)` inside an `acquireRelease`.

**What to do:**
- Replace the entire `acquireRelease` + manual listener with `yield* eventTarget.on(window, "popstate", handler)`
- The EventTarget service manages the subscription lifecycle via Scope
- Remove `popstateEffect` closure and `popstateHandler` sync bridge
- Remove `Runtime.runFork(runtime)` — service handles the bridging
- The `runtime` variable may become unused (check after all conversions)

---

### 6.9 Link hover debounce → Effect.sleep + Fiber

**Current state:** `link.ts:197-210` — `setTimeout`/`clearTimeout` inside `Effect.fnUntraced` handlers, with `Runtime.runFork(runtime)` to trigger prefetch.

**What to do:**
- Replace setTimeout pattern with a forked fiber: `yield* Effect.fork(Effect.sleep(Duration.millis(50)).pipe(Effect.flatMap(() => triggerPrefetch)))`
- On mouse leave: `yield* Fiber.interrupt(hoverFiber)` (cancel pending prefetch)
- No `setTimeout`, no `clearTimeout`, no `Runtime.runFork` — pure Effect scheduling
- Fiber lifetime bounded by component scope (auto-interrupted on unmount)

---

### 6.10 api-middleware → Runtime.runFork + Effect.try

**Current state:** `api-middleware.ts:293` — `Runtime.runSync(runtime)(effect)` inside a Vite/Connect middleware callback.

**What to do:**
- Replace `Runtime.runSync` with `Runtime.runFork` (middleware callback is async-compatible)
- Wrap `currentState.handler.value(req, res)` in `Effect.try` with `ApiHandlerError`
- Add top-level `Effect.catchAllCause` to send 500 response for unexpected defects
- Note: This is a genuine boundary (Vite calls middleware synchronously). `Runtime.runFork` is correct here — we fork a fiber for request handling

---

### 6.11 debug.ts initFromEnvironment → Location + LocalStorage services

**Current state:** `debug/debug.ts:1043-1075` — fully sync function reading `window.location.href` and `localStorage` directly.

**What to do:**
- Convert to `Effect.gen(function* () { ... })`
- `new URL(window.location.href)` → `yield* location.href` + parse with Effect
- `localStorage.getItem("effectui_debug")` → `yield* localStorage.get("effectui_debug")`
- `localStorage.setItem("effectui_debug", ...)` → `yield* localStorage.set("effectui_debug", ...)`
- Called during layer construction (Debug layer depends on Location + LocalStorage)

---

### 6.12 head.ts DOM operations → Dom service

**Current state:** `head.ts:245-293` — raw `document.head.appendChild(node)`, `node.remove()` inside `Effect.gen` blocks.

**What to do:**
- `document.head.appendChild(node)` → `const headEl = yield* dom.head; yield* dom.appendChild(headEl, node)`
- `node.remove()` → `yield* dom.remove(node)`
- `prev.node.remove()` → `yield* dom.remove(prev.node)`

---

### 6.13 portal.ts DOM operations → Dom service

**Current state:** `portal.ts:116-133` — raw `document.createElement("div")`, `document.body.appendChild(container)`, `document.querySelector(target)`.

**What to do:**
- `document.createElement("div")` → `yield* dom.createElement("div")`
- `container.setAttribute(...)` → `yield* dom.setAttribute(container, ...)`
- `document.body.appendChild(container)` → `const body = yield* dom.body; yield* dom.appendChild(body, container)`
- `document.querySelector(target)` → `yield* dom.querySelector(target)`
- `container.remove()` → `yield* dom.remove(container)`

---

### 6.14 testing.ts DOM operations → Dom service

**Current state:** `testing.ts:97-248` — raw `document.createElement`, `container.setAttribute`, `document.body.appendChild`, `document.createTreeWalker`, `container.querySelector`.

**What to do:**
- Convert all raw DOM calls to use the Dom service
- `queryByText` and `queryByTestId` become Effect-returning functions
- Test helpers require `Dom` in their context (provided by the test setup layer)

---

### 6.15 Typecheck + update tests

**What to do:**
- Run `bun run typecheck` — resolve all errors
- Update `packages/core/tests/safe-url.test.ts`:
  - `validateSync` → `validateOption` (function was removed)
  - `validateOrThrow` → `validate` (function was removed)
  - `isSafe`, `allowSchemes`, `resetConfig` now return Effects — use `yield*`
- Update any router tests that depend on sync `parsePath`/`buildPath`
- Run full test suite — all tests pass
- Verify no `Runtime.runSync` or `Runtime.runFork` remains in consumer code (only in service implementations and the api-middleware boundary)
