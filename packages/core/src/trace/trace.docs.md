# Trace

Trygg's internal flight recorder. `trace` records every meaningful framework step, in order, so the sequence of work can be read back — by a human or an LLM — to debug behaviour, prove step ordering, and reason about performance.

## When to use

`trace` is the framework's INTERNAL observability spine, not application telemetry. Framework internals emit one catalog event per meaningful step:

```ts
import * as Trace from "../trace/index.js";

yield *
  Trace.emit("router.navigate.request", () => ({
    fromPath: "/account",
    toPath: "/settings",
    replace: false,
  }));
```

Tests assert the ordered sequence with a scoped recorder:

```ts
const recorder = Trace.makeRecorder();
yield * Trace.record(click(element), recorder);
expect(recorder.records().map((r) => r.name)).toEqual([
  "router.navigate.request",
  "signal.dispose",
  "signalElement.swap.commit",
]);
```

For human-facing console logging in an app, use the `debug` toolkit (see [debug.docs.md](../debug/debug.docs.md)) — `debug` is an Effect logger over the same trace stream, not a separate API. In Vite dev, the generated entry also forwards browser trace records to the dev server so they appear in terminal/server logs. For aggregate counters and histograms, use [metrics](../debug/metrics.docs.md).

## Design

- **No-op and zero-allocation below the fiber's minimum log level.** `emit` returns the shared `Effect.void` singleton before evaluating the payload thunk when the catalog event is below `References.MinimumLogLevel`.
- **Order, not wall-clock.** Records carry no timestamp by design. The recorder is about _sequence_, which keeps it allocation-light and deterministic for tests.
- **Closed vocabulary.** Event names are the keys of `CATALOG` ([catalog.ts](./catalog.ts)). `TraceEventName` is derived from those keys, so every `emit` call site is typo-checked at compile time. Events with facts also declare their schema in `payload.ts`.
- **Typed facts and unforgeable origin.** Payload schemas relate each event name to its required facts and reject missing, excess, accessor-backed, or incorrectly typed fields. Each emission carries an otherwise empty envelope whose exact object identity indexes a module-private `WeakMap` and the exact recorder/Debug reader set present at emission. Copied annotations cannot forge an event, mutate its decoded record, replay it twice to one reader, or inject it into a reader installed later.
- **Best-effort instrumentation.** Payload construction, validation, detachment, and logger defects are contained so observability cannot change a successful framework operation. Fiber interruption is never swallowed.
- **Opaque application values.** Signal values, Resource results/errors, route queries, post-swap results, component thunks, failure values, and other application-owned objects never enter a payload. Call sites record only `null` or the primitive `typeof` classification (`value_type`, `query_type`, `result_type`, `component_type`, `error_type`, or `cause_type`), which does not invoke Proxy traps, getters, or serialization hooks.
- **Schema before lossy JSON.** Enabled framework-owned payload containers first receive a bounded, descriptor-only snapshot. The snapshot may traverse through the 64-entry validation budget so Schema sees deep original values before the detached JSON applies its 8-level cutoff. Runtime Schema decoding checks selected data properties with excess-property errors before JSON conversion, so a wrong number, function, accessor, or extra field cannot become a valid marker string. Optional `undefined` remains `undefined` through validation and is omitted from the detached object. Oversized exact event shapes are rejected; an open `Schema.JsonObject` such as action facts retains a validated bounded prefix plus the truncation marker instead of losing the action start.
- **Bounded detached history.** Detachment has a global 64-entry budget, at most 8 container levels, and a 2,048-character string prefix. Wide objects enumerate own keys once, fetch descriptors only for the budget-selected prefix, and reserve the stable truncation marker inside that prefix; descriptor work does not scale with object width. Oversized arrays are represented as `["[Truncated:Entries]"]` without walking their holes; deep values use `"[Truncated:Depth]"`; long strings append `"[Truncated:String]"`; truncated objects add `"$trygg_truncated": "[Truncated:Entries]"`. Arrays within budget preserve own indexed slots and use `"[Undefined]"` for holes or explicit `undefined`. The stable fallback markers are `"[Accessor]"`, `"[Function]"`, `"[Symbol]"`, `"[Circular]"`, and `"[Unserializable]"`; BigInt uses its decimal spelling plus `n`, and non-finite numbers use their string spelling. Detachment never invokes `toJSON` or getters. Inherited properties, non-enumerable object fields, and symbol-keyed properties are omitted, and every accepted payload is deeply frozen before logging.

## Enabling

Trace rides on Effect's logging pipeline. A record reaches observers when the running fiber's `References.MinimumLogLevel` allows that event's catalog level and an Effect `Logger` is installed in the context. There is no process-global trace flag or sink.

## Recording

- `Trace.emit(name, payload?)` — record one step. Payload presence and shape are selected by `name` through `TraceEventPayload<Name>`.
- `Trace.withAction(actionId, facts, effect)` — group every event emitted by `effect` under a named action. The action ID is normalized once with the same 2,048-character prefix and `"[Truncated:String]"` marker used by payload strings; lifecycle payloads, inner records, and reports reuse that canonical value. The start payload keeps caller facts under `facts`; every start has one terminal status (`completed`, `failed`, or `interrupted`). Only an interrupt-only `Cause` is `interrupted`; Fail/Die mixed with Interrupt is `failed`. The wrapped effect's original `Exit` is preserved and its raw `Cause` is never serialized.
- `Trace.makeRecorder()` — build an in-memory recorder with a logger plus synchronous `records()` / `clear()` helpers.
- `Trace.record(effect, recorder)` — run `effect` with the recorder as the only logger and `MinimumLogLevel` lowered to `Trace`, keeping concurrent tests hermetic.

## Reporting

- `toJSON(records, options?)` — a frozen, JSON-safe `TimelineEntry[]` (order, name, family, level, summary, optional actionId/payload). It reuses each record's already detached and frozen payload instead of traversing live input again.
- `toMarkdown(records, options?)` — a compact ordered Markdown timeline annotated with each event's family, level, and one-line catalog summary.

## Analyzers

Analyzers explain _why a sequence is wrong_. Each is a pure scan over the ordered records encoding one documented ordering invariant; they return `Finding`s rather than throwing, so a report can list every violation at once.

- `analyze(records)` — run every built-in analyzer and collect findings.
- Built-ins: `navigateWithoutCurrentSet`, `swapRenderBeforeCommit`, `cleanupBeforeCommit`, `lazyLeafTerminates`.

## Levels

Every catalog event carries a `level` describing how load-bearing it is:

- `semantic` — defines framework correctness; ordering is asserted by tests via `Trace.record` + `recorder.records()`.
- `cost` — work/perf boundary (renders, signal reads/writes).
- `diagnostic` — warnings, ignored errors, deduped/stale conditions.

### List publication and internal reconciliation

`keyedList.reorder` is the semantic publication event for a structural list
update. It reports `total_items`, `moves`, `stable_nodes`, and counts of
`inserted`, `removed`, `reconciled`, and `replaced` rows. The additional counts
are optional when decoding older records; the current list owner emits them on
every publication. Publication means the new order and ownership are committed;
a later cleanup failure still has its own failure record.

Internal intrinsic children contribute one `render.child.reconcile` cost record
with `reconciled: boolean`. They do not start independent successful
`signalElement.swap.*` lifecycles. Failure facts still use
`signalElement.swap.failBeforeCommit` and retain the same typed failure, defect,
and interruption behavior. Top-level replacement/reconciliation operation events
and their ordering remain available.

## Event families

Events are grouped into stable families (`TraceFamily`). The catalog is the authoritative per-event registry — each entry owns a one-line `summary` that doubles as its documentation. The families:

| Family        | Scope                                                                                              |
| ------------- | -------------------------------------------------------------------------------------------------- |
| `contract`    | Verifier actions, observations, divergence markers, free-form notes.                               |
| `event`       | DOM event seams (e.g. `preventDefault`).                                                           |
| `navigation`  | Router-owned navigation state transitions (request → commit).                                      |
| `history`     | History intents: `push`, `replace`, `back`, `forward`.                                             |
| `routing`     | Router matching, guards, prefetch, module loading, scroll, outlet, render.                         |
| `activation`  | Outlet route-tree activation, lazy-leaf loading, stale-drop, leaf mount/unmount, finalizers.       |
| `asyncLoader` | Async loader lifecycle: track, loading, ready, refreshing, dedup, interrupt, error.                |
| `provider`    | Component-provided layer scopes: acquire, reuse, replace, finalize, failure.                       |
| `signal`      | Signal lifecycle and reactivity: create, get/peek, set/update, notify, subscribe, derive, dispose. |
| `render`      | SignalElement swap transactions and render scheduling.                                             |
| `component`   | Component render lifecycle: initial, render, rerender, cleanup, error, superseded.                 |
| `dom`         | DOM node creation and removal.                                                                     |
| `keyedList`   | Keyed-list reconciliation: add, remove, reorder, rerender, subscription churn.                     |
| `resource`    | Resource fetch lifecycle and the resource registry.                                                |
| `api`         | API request/handler/middleware lifecycle.                                                          |
| `scroll`      | Scroll-strategy application after route commit.                                                    |
| `effect`      | Trygg-owned Effect lifecycle seams: forks, finalizers, scope close, ignored errors.                |
| `unsafe`      | Unsafe build/merge boundaries.                                                                     |

### Key ordering guarantees

The invariants below are load-bearing across families; the analyzers enforce a subset directly.

1. **Navigation state publishes before service state-applied.** `router.navigate.request` precedes any history write or route-service commit. A successful navigation emits exactly one history intent (`history.push` / `history.replace` / `history.back` / `history.forward`), publishes the committed `router.current.set` / `router.query.set` state, then emits `router.navigate.commit` and `router.navigate.stateApplied` for the RouterService state update. DOM visibility is owned by `outlet.process.commit`, not by the RouterService state event.
2. **No-blank swaps.** Within one SignalElement swap, the next Element is rendered (`signalElement.swap.render`) before the swap commits (`signalElement.swap.commit`). `signalElement.swap.dropStale` means the result was superseded and must be cleaned without becoming visible; `signalElement.swap.failBeforeCommit` means rendering failed before any visible DOM was removed.
3. **Cleanup follows a safe commit.** `route.leaf.unmount` / `route.finalizer.run` for a previous route tree occur after the replacement `outlet.process.commit` that makes cleanup safe — never before the first commit. `route.render.skipStale` / `route.layout.skipStale` / `outlet.process.dropStale` mean a newer activation won, and happen before any stale visible commit.
4. **Lazy leaves terminate.** Each `outlet.lazyLeaf.load.start` reaches exactly one `outlet.lazyLeaf.load.ready` or `outlet.lazyLeaf.load.error`.
5. **Provider scopes are stable.** `provider.acquire` fires when a mounted provided Component creates a provider scope; `provider.reuse` on a stable rerender (not Layer re-acquisition); `provider.finalize` when the scope closes on unmount, replacement, or failure cleanup.

## Types

- `TraceRecord` — `{ name: TraceEventName; payload: Schema.JsonObject | undefined; actionId: string | undefined }`.
- `TraceEventPayload<Name>` — the schema-derived payload facts associated with one catalog event.
- `Recorder` — in-memory recorder contract for tests.
- `TraceEventName` — the closed union of catalog keys.
- `TraceLevel` — `"semantic" | "cost" | "diagnostic"`.
- `TraceFamily` — the family union (above).
- `metaOf(name)` — the `{ family, level, summary }` for an event name.
