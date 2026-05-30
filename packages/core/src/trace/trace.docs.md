# Trace

Trygg's internal flight recorder. `trace` records every meaningful framework step, in order, so the sequence of work can be read back — by a human or an LLM — to debug behaviour, prove step ordering, and reason about performance.

## When to use

`trace` is the framework's INTERNAL observability spine, not application telemetry. Framework internals emit one catalog event per meaningful step:

```ts
import * as Trace from "../trace/index.js";

yield * Trace.emit("router.navigate.request", () => ({ url }));
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

For human-facing console logging in an app, use the `debug` toolkit (see [debug.docs.md](../debug/debug.docs.md)) — `debug` is an Effect logger over the same trace stream, not a separate API. For aggregate counters and histograms, use [metrics](../debug/metrics.docs.md).

## Design

- **No-op and zero-allocation below the fiber's minimum log level.** `emit` returns the shared `Effect.void` singleton before evaluating the payload thunk when the catalog event is below `References.MinimumLogLevel`.
- **Order, not wall-clock.** Records carry no timestamp by design. The recorder is about _sequence_, which keeps it allocation-light and deterministic for tests.
- **Closed vocabulary.** Event names are the keys of `CATALOG` ([catalog.ts](./catalog.ts)). `TraceEventName` is derived from those keys, so every `emit` call site is typo-checked at compile time. Adding a name to the catalog is the only step needed to make it emittable.

## Enabling

Trace rides on Effect's logging pipeline. A record reaches observers when the running fiber's `References.MinimumLogLevel` allows that event's catalog level and an Effect `Logger` is installed in the context. There is no process-global trace flag or sink.

## Recording

- `Trace.emit(name, payload?)` — record one step. `name: TraceEventName`; `payload?: () => Record<string, unknown>`.
- `Trace.withAction(actionId, action, effect)` — group every event emitted by `effect` under a named action: emits `contract.action.start` / `contract.action.end` around it and stamps each record's `actionId`.
- `Trace.makeRecorder()` — build an in-memory recorder with a logger plus synchronous `records()` / `clear()` helpers.
- `Trace.record(effect, recorder)` — run `effect` with the recorder as the only logger and `MinimumLogLevel` lowered to `Trace`, keeping concurrent tests hermetic.

## Reporting

- `toJSON(records, options?)` — a stable, serializable `TimelineEntry[]` (order, name, family, level, summary, optional actionId/payload).
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

- `TraceRecord` — `{ name: TraceEventName; payload: Readonly<Record<string, unknown>> | undefined; actionId: string | undefined }`.
- `Recorder` — in-memory recorder contract for tests.
- `TraceEventName` — the closed union of catalog keys.
- `TraceLevel` — `"semantic" | "cost" | "diagnostic"`.
- `TraceFamily` — the family union (above).
- `metaOf(name)` — the `{ family, level, summary }` for an event name.
