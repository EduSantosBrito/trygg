# Web Framework Review Plan

## Status: In Progress
**Last Updated:** 2026-01-20
**Reviewer:** OpenCode
**Framework:** effect-ui

---

## Summary

**Total Findings:** 11
**By Priority:** CRITICAL: 2 | HIGH: 4 | MEDIUM: 3 | LOW: 2
**By Category:** Performance: 5 | Security: 1 | Reliability: 2 | LLM: 2 | Tests: 1 | Other: 0

**Performance Verdict:** Below target; re-render and navigation paths exceed budgets
**Effect Utilization:** Partial; caching/concurrency/timeout/scope patterns underused

---

## Findings

### F-001: Sequential route module loading
**Category:** Performance
**Priority:** HIGH
**Status:** Solution Proposed ([Solution](solutions.md#f-001))

**Location:**
- File: `src/router/Outlet.ts`
- Lines: 306-324
- Function/Component: `loadAndRender`

**Problem:**
Route component and layout modules are loaded with sequential `Effect.promise` calls. Each nested layout waits for the previous module import to finish, creating a waterfall during navigation and delaying render.

**Current Behavior:**
Dynamic imports for leaf component, layout, and parent layouts run serially on every navigation.

**Expected Behavior:**
Module imports should be parallelized or prefetched so navigation is near-instant even with nested layouts.

**Impact:**
- Performance: Adds cumulative module-load latency per layout
- Users: Noticeable delay on rapid navigation
- Scale: Gets worse with deep layout nesting

**Evidence:**
`loadAndRender` loads component and layout modules sequentially via `Effect.promise`.

**Effect Pattern Suggestion:**
`Effect.all` with `concurrency` for parallel module loading

**Related Findings:** F-002, F-006

---

### F-002: Route loading fibers not scoped or interrupted
**Category:** Performance
**Priority:** CRITICAL
**Status:** Solution Proposed ([Solution](solutions.md#f-002))

**Location:**
- File: `src/router/Outlet.ts`
- Lines: 600-640
- Function/Component: `Outlet`

**Problem:**
Route loading for the loading fallback creates a new `Scope` and forks a fiber, but the scope is never closed and the fiber is never interrupted when navigation changes. Stale route loads continue in the background after the Outlet re-renders.

**Current Behavior:**
Each navigation starts a new forked load that outlives the current render and can continue after route changes.

**Expected Behavior:**
Route-loading work should be tied to the Outlet lifecycle and interrupted/closed on navigation or unmount.

**Impact:**
- Performance: Background work continues after navigation
- Users: Delayed or out-of-order rendering on rapid clicks
- Scale: Leaks fibers/scopes with repeated navigation

**Evidence:**
`Scope.make()` is used with `Effect.forkIn` and no `Scope.close` or fiber interruption is registered.

**Effect Pattern Suggestion:**
`Scope` + `Fiber.interrupt` (tie load fibers to lifecycle via `acquireRelease`)

**Related Findings:** F-001

---

### F-003: Signal notifications run sequentially
**Category:** Performance
**Priority:** HIGH
**Status:** Solution Proposed ([Solution](solutions.md#f-003))

**Location:**
- File: `src/Signal.ts`
- Lines: 86-95
- Function/Component: `notifyListeners`

**Problem:**
Signal updates iterate listeners in a synchronous loop and await each listener effect in order. With many subscribed components, re-render scheduling becomes serialized and blocks subsequent listeners.

**Current Behavior:**
`Signal.set`/`Signal.update` waits for each listener effect sequentially before moving to the next.

**Expected Behavior:**
Listener effects should run concurrently or be batched to avoid serialized re-render scheduling overhead.

**Impact:**
- Performance: Adds per-listener latency on every signal update
- Users: Slower UI response with many subscribers
- Scale: Degrades linearly with subscriber count

**Evidence:**
`notifyListeners` uses a `for ... of` loop with `yield* listener()` for each listener.

**Effect Pattern Suggestion:**
`Effect.forEach` with `concurrency` (or `Effect.all`)

**Related Findings:** F-004

---

### F-004: Full subtree teardown on component re-render
**Category:** Performance
**Priority:** CRITICAL
**Status:** Solution Proposed ([Solution](solutions.md#f-004))

**Location:**
- File: `src/Renderer.ts`
- Lines: 404-424
- Function/Component: `doRerender`

**Problem:**
The re-render path always cleans up the entire rendered subtree and re-renders from scratch. This bypasses any structural sharing or diffing and turns every subscribed signal change into full DOM teardown and rebuild.

**Current Behavior:**
Each signal-triggered re-render runs `currentResult.cleanup` and then calls `renderAndPosition` to recreate DOM nodes.

**Expected Behavior:**
Re-rendering should preserve and patch existing DOM where possible to keep updates under 1ms.

**Impact:**
- Performance: Adds ~3-6ms per re-render in hot paths
- Users: Noticeable lag on rapid interactions
- Scale: Cost grows with component depth and DOM size

**Evidence:**
`doRerender` explicitly cleans up the old render result before rendering a new tree.

**Effect Pattern Suggestion:**
`Effect.cached` for stable component outputs + fine-grained Signal updates to avoid full re-render

**Related Findings:** F-003

---

### F-005: Route matching recalculates depth per navigation
**Category:** Performance
**Priority:** MEDIUM
**Status:** Solution Proposed ([Solution](solutions.md#f-005))

**Location:**
- File: `src/router/matching.ts`
- Lines: 91-100
- Function/Component: `RouteMatcher.match`

**Problem:**
Every match sorts candidates and recomputes route depth by re-parsing ancestor patterns. This repeats work on each navigation and adds overhead proportional to route count and nesting depth.

**Current Behavior:**
`match` calls `parsePattern` inside the sort comparator for every navigation.

**Expected Behavior:**
Route depth/specificity should be precomputed once during matcher creation and reused per match.

**Impact:**
- Performance: Adds extra route matching cost on every navigation
- Users: Slower routing with large route trees
- Scale: Cost grows with route count and nesting

**Evidence:**
`match` uses `parsePattern` in the per-navigation sort comparator.

**Effect Pattern Suggestion:**
`Effect.cached` for compiled matcher metadata (depth/specificity)

**Related Findings:** F-001

---

### F-006: Route module loading has no timeout
**Category:** Reliability
**Priority:** HIGH
**Status:** Solution Proposed ([Solution](solutions.md#f-006))

**Location:**
- File: `src/router/Outlet.ts`
- Lines: 306-313
- Function/Component: `loadAndRender`

**Problem:**
Dynamic imports for route components (and guards/layouts) are awaited without any timeout. A stalled chunk load or hung promise leaves navigation stuck in a loading state indefinitely.

**Current Behavior:**
`Effect.promise` waits forever on module imports; failures only surface if the promise rejects.

**Expected Behavior:**
Route module loads should be bounded with timeouts and surface a controlled error when loading stalls.

**Impact:**
- Performance: Navigation can hang under slow or failed network conditions
- Users: Permanent loading state with no recovery path
- Scale: Increases support burden under flaky network conditions

**Evidence:**
`Effect.promise(() => match.route.component())` and related imports have no timeout or retry policy.

**Effect Pattern Suggestion:**
`Effect.timeout`

**Related Findings:** F-001, F-002

---

### F-007: Unsafe default allowlist includes data: URLs
**Category:** Security
**Priority:** HIGH
**Status:** Solution Proposed ([Solution](solutions.md#f-007))

**Location:**
- File: `src/SafeUrl.ts`
- Lines: 49-57
- Function/Component: `DEFAULT_ALLOWED_SCHEMES`

**Problem:**
The default SafeUrl allowlist includes the `data` scheme without MIME-type restrictions. `data:text/html` or `data:application/javascript` can be injected into `href`/`src`, enabling XSS in consumer apps that rely on the default configuration.

**Current Behavior:**
Any `data:` URL is considered safe by default.

**Expected Behavior:**
`data:` should be disallowed by default or restricted to safe MIME types (e.g., images) with explicit opt-in.

**Impact:**
- Security: Enables XSS via unsafe data URLs
- Users: Risk of script execution on click or load
- Scale: Affects all apps using default SafeUrl config

**Evidence:**
`DEFAULT_ALLOWED_SCHEMES` includes `"data"` with no additional validation.

**Effect Pattern Suggestion:**
None (validation policy change)

**Related Findings:** None

---

### F-008: Type casting violates project rules
**Category:** Reliability
**Priority:** MEDIUM
**Status:** Solution Proposed ([Solution](solutions.md#f-008))

**Location:**
- File: `src/Component.ts`
- Lines: 144-160
- Function/Component: `separateProps`

**Problem:**
Core component utilities rely on `as` casts (`regularProps as P` and other casts in the same module) despite the project rule forbidding type casting. This hides type mismatches and can mask unsafe layer/prop combinations at runtime.

**Current Behavior:**
Unsafe casts are used to coerce props and layers without compiler verification.

**Expected Behavior:**
Eliminate `as` casts and use safer runtime checks or type-level encodings that preserve correctness without bypassing the type system.

**Impact:**
- Reliability: Risk of runtime failures due to unsound typing
- Users: Harder to diagnose issues from misleading types
- Scale: Increases maintenance burden as APIs grow

**Evidence:**
`separateProps` and other utilities explicitly use `as` casts with "SAFE CAST" comments.

**Effect Pattern Suggestion:**
None (type-safety refactor)

**Related Findings:** None

---

### F-009: Missing root SKILL.md for agent discovery
**Category:** LLM
**Priority:** MEDIUM
**Status:** Solution Proposed ([Solution](solutions.md#f-009))

**Location:**
- File: Repository root (missing `SKILL.md`)
- Lines: N/A
- Function/Component: N/A

**Problem:**
Agent Skills spec expects a root `SKILL.md` for discovery. The repo only provides skill files under `skills/`, so agents have no single entry point and may fail to discover capabilities.

**Current Behavior:**
No root `SKILL.md`; only `skills/*/SKILL.md` exists.

**Expected Behavior:**
A root `SKILL.md` that indexes available skills and points to `skills/` references.

**Impact:**
- LLM: Lower discoverability and higher prompt cost
- Users: Agents may miss key framework capabilities
- Scale: Harder to automate multi-skill workflows

**Evidence:**
Repository root has no `SKILL.md`; `skills/effect-ui-*/SKILL.md` exists instead.

**Effect Pattern Suggestion:**
None (documentation addition)

**Related Findings:** F-010

---

### F-010: No llms.txt for LLM-friendly docs
**Category:** LLM
**Priority:** LOW
**Status:** Solution Proposed ([Solution](solutions.md#f-010))

**Location:**
- File: Repository root (missing `llms.txt`)
- Lines: N/A
- Function/Component: N/A

**Problem:**
There is no `llms.txt` document to provide a concise, LLM-friendly entry point into the framework documentation and capabilities.

**Current Behavior:**
LLMs must parse long-form docs and may miss key constraints or APIs.

**Expected Behavior:**
Provide a root `llms.txt` with a short index and pointers to detailed references.

**Impact:**
- LLM: Higher context usage and lower success rate
- Users: Agents require more prompts to orient
- Scale: Slower automation and higher token cost

**Evidence:**
No `llms.txt` found in the repository root.

**Effect Pattern Suggestion:**
None (documentation addition)

**Related Findings:** F-009

---


## Quick Wins (Implement First)

| ID | Title | Effort | Impact | Effect Pattern |
|----|-------|--------|--------|----------------|
| F-003 | Parallelize signal listeners | Low | High | Effect.forEach + concurrency |
| F-006 | Add timeouts to route imports | Low | High | Effect.timeout |
| F-005 | Precompute route depth | Low | Medium | Effect.cached |

---

## Effect Utilization Report

| Pattern | Currently Used? | Opportunities Found | Finding IDs |
|---------|-----------------|---------------------|-------------|
| Effect.cached | No | 1 | F-005 |
| Effect.all + concurrency | Yes (no concurrency) | 1 | F-001 |
| Stream | Yes (limited) | 0 | - |
| Fiber | Yes | 1 | F-002 |
| Layer/Scope | Yes | 1 | F-002 |
| Schedule | No | 0 | - |
| Effect.timeout | No | 1 | F-006 |
| Effect.forEach + concurrency | No | 1 | F-003 |

---

## Architecture Notes

- Rendering library: Custom JSX runtime with `Element` tagged enum
- Routing approach: File-based routes with trie matcher; `Router.Outlet` renders via dynamic imports
- Effect Runtime setup: `mount` uses `BrowserRuntime.runMain` with `Effect.scoped` and merged Renderer/Router layers
- Layer composition: `Component`/`Component.gen` merge service layers per component render
- Hot paths identified: `Renderer` component re-render, `Signal.notifyListeners`, `Outlet.loadAndRender`, `RouteMatcher.match`

---

## Out of Scope (Noted but not prioritized)

- SSR and server-side rendering pipeline
- API routes (tracked separately in `docs/future-solutions.md`)

---

## Session Log

### 2026-01-20 - Review Session
- Reviewed: docs, renderer, signal, router (service/outlet/matcher/link), SafeUrl
- Findings added: F-001 through F-011
- Areas remaining: None (initial review complete)

### 2026-01-20 - Solution Session
- Processed: F-002
- Decisions: cancel route loads on any navigation change; reuse in-flight load on identical match key; emit router.load.cancelled
- Next: F-004 deep dive and solution

### 2026-01-20 - Solution Session
- Processed: F-004
- Decisions: add RenderNode patching and keyed child reconciliation; keep fine-grained Signal updates
- Next: continue priority list

### 2026-01-20 - Solution Session
- Processed: F-007
- Decisions: align with URL-sanitizing frameworks by blocking data: by default; explicit allowSchemes opt-in
- Next: continue priority list

### 2026-01-20 - Solution Session
- Processed: F-001
- Decisions: parallel module evaluation; add memoized loaders, prefetch, concurrency cap=3, load timing events
- Next: continue priority list

### 2026-01-20 - Solution Session
- Processed: F-003
- Decisions: parallel listener execution; isolate and log listener failures; concurrency cap=3
- Next: continue priority list (F-006)

### 2026-01-20 - Solution Session
- Processed: F-006
- Decisions: 8s per module load timeout; retry with exponential backoff + jitter (max 2 retries) capped at 15s; typed RouteLoadTimeoutError; prefetch uses same policy
- Next: continue priority list

### 2026-01-20 - Solution Session
- Processed: F-005
- Decisions: precompute specificity at build time; manifest order sorted by specificity then path
- Next: continue priority list

### 2026-01-20 - Solution Session
- Processed: F-008
- Decisions: remove layer auto-injection; propagate context via renderer boundary; use Component.provide at parent; update docs/examples/tests
- Next: continue priority list

### 2026-01-20 - Solution Session
- Processed: F-009
- Decisions: add root SKILL.md as entry point and index for existing skills
- Next: continue priority list

### 2026-01-20 - Solution Session
- Processed: F-010
- Decisions: add llms.txt with rules, commands, skills, docs index
- Next: continue priority list

### 2026-01-22 - Migration Plan Session
- Created: [docs/migrate-promise.md](migrate-promise.md)
- Scope: Full Effect migration of vite-plugin.ts and api-middleware.ts
- Key findings: Logger.batched for non-blocking I/O; Vite load() hook is async
- Patterns: Yieldable errors (Data.TaggedError), FileSystem service, Ref for state
- Estimated effort: ~13 hours across 18 phases
- Next: Implementation
