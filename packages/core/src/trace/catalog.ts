/**
 * Trace event catalog — the single source of truth for Trygg's internal trace
 * vocabulary.
 *
 * @remarks
 * `trace` is Trygg's INTERNAL flight recorder. Every meaningful framework step
 * emits exactly one catalog event, in order, so the sequence of framework work
 * can be read back — by a human or an LLM — to debug behaviour, prove step
 * ordering, and reason about performance. It is no-op by default (see
 * {@link ./trace.ts}) and is not application telemetry.
 *
 * Each event carries:
 * - `family`: the subsystem it belongs to.
 * - `level`: how load-bearing it is. Each level maps to an Effect `LogLevel`
 *   (see {@link ./trace.ts}), so the running fiber's `MinimumLogLevel` decides
 *   whether the event is recorded — in dev *and* prod:
 *    - `semantic`  → `Info`. Defines framework correctness; ordering is asserted
 *                    by tests (`recorder.records()`).
 *    - `cost`      → `Debug`. Work/perf boundary (renders, signal reads/writes).
 *    - `diagnostic`→ `Warn`. Warnings, ignored errors, deduped/stale conditions.
 * - `logLevel` (optional): a reserved per-event override of the level→LogLevel
 *   mapping. Used to surface genuine unhandled errors at `Error` so a prod
 *   operator running at a high minimum level still sees them.
 * - `summary`: a one-line, source-owned explanation (doubles as docs).
 *
 * @internal
 */
import type * as LogLevel from "effect/LogLevel";

export type TraceLevel = "semantic" | "cost" | "diagnostic";

export type TraceFamily =
  | "contract"
  | "event"
  | "navigation"
  | "history"
  | "routing"
  | "activation"
  | "asyncLoader"
  | "provider"
  | "signal"
  | "render"
  | "component"
  | "dom"
  | "keyedList"
  | "resource"
  | "api"
  | "scroll"
  | "effect"
  | "unsafe";

export interface TraceMeta {
  readonly family: TraceFamily;
  readonly level: TraceLevel;
  /**
   * Reserved override of the {@link TraceLevel}→`LogLevel` mapping. Set to
   * `"Error"` on genuine unhandled errors so they survive a high prod minimum
   * log level. Omit to inherit the level's default mapping.
   */
  readonly logLevel?: LogLevel.Severity;
  readonly summary: string;
}

/**
 * Identity helper whose `const` type parameter narrows each entry's `family`
 * and `level` to their literals (so `metaOf` returns a precise {@link TraceMeta}
 * and `TraceEventName` is the exact union of keys) while still validating the
 * whole table against {@link TraceMeta}. Replaces an `as const satisfies` cast.
 */
const defineCatalog = <const T extends Record<string, TraceMeta>>(catalog: T): T => catalog;

/**
 * The catalog. Keys are the canonical event names; the `TraceEventName` union is
 * derived from these keys, so adding a name here is the only step needed to make
 * it emittable and type-checked at every call site.
 */
export const CATALOG = defineCatalog({
  // ── Contract harness (verifier-facing grouping) ───────────────────────────
  "contract.action.start": {
    family: "contract",
    level: "semantic",
    summary: "A named verifier action began.",
  },
  "contract.action.end": {
    family: "contract",
    level: "semantic",
    summary: "A named verifier action completed or failed.",
  },
  "contract.observation": {
    family: "contract",
    level: "semantic",
    summary: "A verifier recorded an explicit observation.",
  },
  "contract.firstDivergence": {
    family: "contract",
    level: "diagnostic",
    summary: "First point where observed order diverged from expectation.",
  },
  "debug.note": {
    family: "contract",
    level: "diagnostic",
    summary: "Free-form annotation in the trace stream.",
  },

  // ── DOM event seams ───────────────────────────────────────────────────────
  "event.preventDefault": {
    family: "event",
    level: "diagnostic",
    summary: "Framework called preventDefault on a DOM event.",
  },

  // ── Navigation (Router-owned state transitions) ───────────────────────────
  "router.navigate.request": {
    family: "navigation",
    level: "semantic",
    summary: "A navigation was requested before any history write or route commit.",
  },
  "router.navigate.commit": {
    family: "navigation",
    level: "semantic",
    summary: "A navigation committed to Router state.",
  },
  "router.navigate.stateApplied": {
    family: "navigation",
    level: "semantic",
    summary: "RouterService applied the navigation snapshot to Router state.",
  },
  "router.current.set": {
    family: "navigation",
    level: "semantic",
    summary: "Committed Current route snapshot was updated.",
  },
  "router.query.set": {
    family: "navigation",
    level: "semantic",
    summary: "Committed canonical query string changed.",
  },
  "history.push": {
    family: "history",
    level: "semantic",
    summary: "A history push entry was written.",
  },
  "history.replace": {
    family: "history",
    level: "semantic",
    summary: "A history replace entry was written.",
  },
  "history.back": { family: "history", level: "semantic", summary: "History traversed back." },
  "history.forward": {
    family: "history",
    level: "semantic",
    summary: "History traversed forward.",
  },

  // ── Routing diagnostics (matching, guards, modules, prefetch) ─────────────
  "router.link": { family: "routing", level: "cost", summary: "A Router.Link resolved its href." },
  "router.link.click": {
    family: "routing",
    level: "cost",
    summary: "A Router.Link intercepted a click.",
  },
  "router.match": {
    family: "routing",
    level: "cost",
    summary: "A path was matched against the routes manifest.",
  },
  "router.match.notfound": {
    family: "routing",
    level: "diagnostic",
    summary: "A path matched no route.",
  },
  "router.matcher.compile": {
    family: "routing",
    level: "cost",
    summary: "A route pattern matcher was compiled.",
  },
  "router.matcher.cached": {
    family: "routing",
    level: "cost",
    summary: "A compiled route matcher was reused from cache.",
  },
  "router.module.load.start": {
    family: "routing",
    level: "cost",
    summary: "A lazy route module began loading.",
  },
  "router.module.load.complete": {
    family: "routing",
    level: "cost",
    summary: "A lazy route module finished loading.",
  },
  "router.module.load.cache_hit": {
    family: "routing",
    level: "cost",
    summary: "A lazy route module was served from cache.",
  },
  "router.module.load.timeout": {
    family: "routing",
    level: "diagnostic",
    summary: "A lazy route module load timed out.",
  },
  "router.load.cancelled": {
    family: "routing",
    level: "diagnostic",
    summary: "An in-flight route load was cancelled by a newer navigation.",
  },
  "router.guard.start": {
    family: "routing",
    level: "cost",
    summary: "A route guard began evaluating.",
  },
  "router.guard.allow": {
    family: "routing",
    level: "semantic",
    summary: "A route guard allowed activation.",
  },
  "router.guard.redirect": {
    family: "routing",
    level: "semantic",
    summary: "A route guard redirected.",
  },
  "router.guard.skip": { family: "routing", level: "cost", summary: "A route guard was skipped." },
  "router.404.fallback": {
    family: "routing",
    level: "diagnostic",
    summary: "The not-found fallback route was selected.",
  },
  "router.404.render": {
    family: "routing",
    level: "cost",
    summary: "The not-found route rendered.",
  },
  "router.error": {
    family: "routing",
    level: "diagnostic",
    summary: "A Router-level error surfaced.",
  },
  "router.outlet.start": {
    family: "routing",
    level: "cost",
    summary: "An Outlet began a render pass.",
  },
  "router.outlet.matching": {
    family: "routing",
    level: "cost",
    summary: "An Outlet matched the active path.",
  },
  "router.outlet.nested": {
    family: "routing",
    level: "cost",
    summary: "An Outlet rendered a nested Outlet.",
  },
  "router.outlet.no_routes": {
    family: "routing",
    level: "diagnostic",
    summary: "An Outlet had no routes to render.",
  },
  "router.outlet.error": {
    family: "routing",
    level: "diagnostic",
    summary: "An Outlet render failed.",
  },
  "router.render.start": {
    family: "routing",
    level: "cost",
    summary: "Router-driven render started.",
  },
  "router.render.complete": {
    family: "routing",
    level: "cost",
    summary: "Router-driven render completed.",
  },
  "router.prefetch.trigger": {
    family: "routing",
    level: "cost",
    summary: "A prefetch was triggered (advisory; implies no route commit).",
  },
  "router.prefetch.start": {
    family: "routing",
    level: "cost",
    summary: "A prefetch began loading.",
  },
  "router.prefetch.complete": {
    family: "routing",
    level: "cost",
    summary: "A prefetch completed.",
  },
  "router.prefetch.error": {
    family: "routing",
    level: "diagnostic",
    summary: "A prefetch failed.",
  },
  "router.prefetch.no_match": {
    family: "routing",
    level: "diagnostic",
    summary: "A prefetch target matched no route.",
  },
  "router.prefetch.viewport": {
    family: "routing",
    level: "cost",
    summary: "A viewport prefetch heuristic fired.",
  },
  "router.scroll.save": {
    family: "routing",
    level: "cost",
    summary: "Scroll position was saved for restore.",
  },
  "router.scroll.save.error": {
    family: "routing",
    level: "diagnostic",
    summary: "Saving scroll position failed.",
  },
  "router.scroll.restore": {
    family: "routing",
    level: "cost",
    summary: "A saved scroll position was restored.",
  },
  "router.scroll.top": { family: "routing", level: "cost", summary: "Scroll was reset to top." },
  "router.popstate.added": {
    family: "routing",
    level: "cost",
    summary: "A popstate listener was added.",
  },
  "router.popstate.removed": {
    family: "routing",
    level: "cost",
    summary: "A popstate listener was removed.",
  },
  "router.popstate.error": {
    family: "routing",
    level: "diagnostic",
    summary: "A popstate handler errored.",
  },
  "router.viewport.observer.added": {
    family: "routing",
    level: "cost",
    summary: "A viewport IntersectionObserver was added.",
  },
  "router.viewport.observer.removed": {
    family: "routing",
    level: "cost",
    summary: "A viewport IntersectionObserver was removed.",
  },
  "router.viewport.observer.error": {
    family: "routing",
    level: "diagnostic",
    summary: "A viewport observer errored.",
  },
  "router.tracker.loading": {
    family: "routing",
    level: "cost",
    summary: "Navigation tracker entered loading.",
  },
  "router.tracker.ready": {
    family: "routing",
    level: "cost",
    summary: "Navigation tracker became ready.",
  },
  "router.tracker.refreshing": {
    family: "routing",
    level: "cost",
    summary: "Navigation tracker is refreshing.",
  },
  "router.tracker.error": {
    family: "routing",
    level: "diagnostic",
    summary: "Navigation tracker errored.",
  },
  "router.tracker.interrupt": {
    family: "routing",
    level: "cost",
    summary: "Navigation tracker was interrupted.",
  },

  // ── Route activation (Outlet ↔ RouteActivation) ───────────────────────────
  "outlet.process.start": {
    family: "activation",
    level: "semantic",
    summary: "An Outlet attempt to render the active route tree began.",
  },
  "outlet.process.commit": {
    family: "activation",
    level: "semantic",
    summary: "The selected activation became visible route content.",
  },
  "outlet.process.dropStale": {
    family: "activation",
    level: "semantic",
    summary: "A superseded activation was dropped before becoming visible.",
  },
  "outlet.lazyLeaf.load.start": {
    family: "activation",
    level: "semantic",
    summary: "A lazy leaf module began loading for an activation.",
  },
  "outlet.lazyLeaf.load.ready": {
    family: "activation",
    level: "semantic",
    summary: "A lazy leaf module became ready.",
  },
  "outlet.lazyLeaf.load.error": {
    family: "activation",
    level: "semantic",
    summary: "A lazy leaf module failed to load.",
  },
  "outlet.match.found": {
    family: "activation",
    level: "semantic",
    summary: "The Outlet matched a route for the active path.",
  },
  "outlet.match.notFound": {
    family: "activation",
    level: "semantic",
    summary: "The Outlet matched no route for the active path.",
  },
  "outlet.boundary.resolve": {
    family: "activation",
    level: "semantic",
    summary: "A boundary outcome (loading/error/notFound/redirect/...) was selected.",
  },
  "route.leaf.mount": { family: "activation", level: "semantic", summary: "A route leaf mounted." },
  "route.leaf.unmount": {
    family: "activation",
    level: "semantic",
    summary: "A route leaf unmounted during cleanup.",
  },
  "route.render.skipStale": {
    family: "activation",
    level: "semantic",
    summary: "A stale route render was skipped because a newer activation won.",
  },
  "route.layout.skipStale": {
    family: "activation",
    level: "semantic",
    summary: "A stale layout render was skipped because a newer activation won.",
  },
  "route.finalizer.run": {
    family: "activation",
    level: "semantic",
    summary: "A previous route tree finalizer ran after a safe replacement commit.",
  },

  // ── Async loaders (suspense-style tracking) ───────────────────────────────
  "asyncLoader.track": {
    family: "asyncLoader",
    level: "cost",
    summary: "An async loader began tracking a promise.",
  },
  "asyncLoader.dedup": {
    family: "asyncLoader",
    level: "cost",
    summary: "An async loader deduped a concurrent request.",
  },
  "asyncLoader.interrupt": {
    family: "asyncLoader",
    level: "cost",
    summary: "An async loader was interrupted.",
  },
  "asyncLoader.loading": {
    family: "asyncLoader",
    level: "cost",
    summary: "An async loader entered loading.",
  },
  "asyncLoader.refreshing": {
    family: "asyncLoader",
    level: "cost",
    summary: "An async loader is refreshing existing data.",
  },
  "asyncLoader.ready": {
    family: "asyncLoader",
    level: "cost",
    summary: "An async loader resolved.",
  },
  "asyncLoader.dropStale": {
    family: "asyncLoader",
    level: "cost",
    summary: "An async loader result was superseded before publication.",
  },
  "asyncLoader.error": {
    family: "asyncLoader",
    level: "diagnostic",
    summary: "An async loader rejected.",
  },

  // ── Provider scope lifecycle ──────────────────────────────────────────────
  "provider.acquire": {
    family: "provider",
    level: "semantic",
    summary: "A mounted provided Component created a provider scope.",
  },
  "provider.reuse": {
    family: "provider",
    level: "semantic",
    summary: "Provider identity was stable across rerender (no re-acquisition).",
  },
  "provider.failure": {
    family: "provider",
    level: "diagnostic",
    logLevel: "Error",
    summary: "Provider acquisition failed.",
  },
  "provider.replace": {
    family: "provider",
    level: "semantic",
    summary: "A provider scope is being replaced for identity/key change.",
  },
  "provider.finalize": {
    family: "provider",
    level: "semantic",
    summary: "A provider scope closed after unmount, replace, or failure.",
  },

  // ── Signal lifecycle & reactivity (hottest path) ──────────────────────────
  "signal.create": { family: "signal", level: "cost", summary: "A signal was created." },
  "signal.dispose": {
    family: "signal",
    level: "semantic",
    summary: "A scope-owned signal was disposed during reactivity cleanup.",
  },
  "signal.disposed_access": {
    family: "signal",
    level: "diagnostic",
    summary: "A disposed signal was read (last snapshot) or written (ignored).",
  },
  "signal.subscribe": {
    family: "signal",
    level: "cost",
    summary: "A listener subscribed to a signal.",
  },
  "signal.unsubscribe": {
    family: "signal",
    level: "cost",
    summary: "A listener unsubscribed from a signal.",
  },
  "signal.get": {
    family: "signal",
    level: "cost",
    summary: "A signal value was read with dependency tracking.",
  },
  "signal.get.phase": {
    family: "signal",
    level: "diagnostic",
    summary: "A signal read observed a notable tracking phase.",
  },
  "signal.peek": {
    family: "signal",
    level: "cost",
    summary: "A signal value was read without tracking.",
  },
  "signal.set": { family: "signal", level: "cost", summary: "A signal value was set." },
  "signal.set.skipped": {
    family: "signal",
    level: "diagnostic",
    summary: "A signal set was a no-op (equal value).",
  },
  "signal.update": {
    family: "signal",
    level: "cost",
    summary: "A signal value was updated via function.",
  },
  "signal.update.skipped": {
    family: "signal",
    level: "diagnostic",
    summary: "A signal update was a no-op (equal value).",
  },
  "signal.notify": { family: "signal", level: "cost", summary: "A signal notified its listeners." },
  "signal.listener.error": {
    family: "signal",
    level: "diagnostic",
    summary: "A signal listener threw and was isolated.",
  },
  "signal.derive.create": {
    family: "signal",
    level: "cost",
    summary: "A derived signal was created.",
  },
  "signal.derive.cleanup": {
    family: "signal",
    level: "cost",
    summary: "A derived signal was cleaned up.",
  },
  "signal.deriveAll.create": {
    family: "signal",
    level: "cost",
    summary: "A combined derived signal was created.",
  },
  "signal.deriveAll.cleanup": {
    family: "signal",
    level: "cost",
    summary: "A combined derived signal was cleaned up.",
  },

  // ── Render transaction (SignalElement no-blank swap) ──────────────────────
  "signalElement.create": {
    family: "render",
    level: "cost",
    summary: "A SignalElement reactive boundary was created.",
  },
  "signalElement.scope.start": {
    family: "render",
    level: "cost",
    summary: "A SignalElement render scope opened.",
  },
  "signalElement.scope.render": {
    family: "render",
    level: "cost",
    summary: "A SignalElement scope rendered its next content.",
  },
  "signalElement.scope.rendered": {
    family: "render",
    level: "cost",
    summary: "A SignalElement scope finished rendering its content.",
  },
  "signalElement.insert": {
    family: "render",
    level: "cost",
    summary: "A SignalElement inserted freshly rendered content.",
  },
  "signalElement.reconcile": {
    family: "render",
    level: "cost",
    summary: "A SignalElement reconciled against existing content.",
  },
  "signalElement.swap.start": {
    family: "render",
    level: "semantic",
    summary: "A SignalElement swap began.",
  },
  "signalElement.swap.render": {
    family: "render",
    level: "semantic",
    summary: "The next Element was rendered before removing the previous DOM (no-blank).",
  },
  "signalElement.swap.dropStale": {
    family: "render",
    level: "semantic",
    summary: "A rendered swap result was superseded and cleaned without becoming visible.",
  },
  "signalElement.swap.failBeforeCommit": {
    family: "render",
    level: "semantic",
    summary: "A swap failed before previous visible DOM was removed.",
  },
  "signalElement.swap.commit": {
    family: "render",
    level: "semantic",
    summary: "A swap committed; next content is visible.",
  },
  "signalElement.swap.error": {
    family: "render",
    level: "diagnostic",
    summary: "A SignalElement swap failed and was reported to the error handler (or ignored).",
  },
  "signalElement.superseded": {
    family: "render",
    level: "diagnostic",
    summary:
      "A SignalElement render was superseded by a newer latest-wins render and degraded without tearing down.",
  },
  "signalElement.cleanup": {
    family: "render",
    level: "cost",
    summary: "A SignalElement cleaned up after a safe commit or unmount.",
  },

  // ── Signal text bindings ──────────────────────────────────────────────────
  "signalText.initial": {
    family: "render",
    level: "cost",
    summary: "A reactive text node rendered initially.",
  },
  "signalText.update": {
    family: "render",
    level: "cost",
    summary: "A reactive text node updated.",
  },

  // ── Document render ───────────────────────────────────────────────────────
  "document.render": { family: "render", level: "cost", summary: "The document shell rendered." },
  "document.signal.initial": {
    family: "render",
    level: "cost",
    summary: "A reactive document binding rendered initially.",
  },
  "document.signal.update": {
    family: "render",
    level: "cost",
    summary: "A reactive document binding updated.",
  },

  // ── Render scheduling ─────────────────────────────────────────────────────
  "render.schedule": {
    family: "render",
    level: "cost",
    summary: "A reactive re-render was scheduled.",
  },

  // ── Component render lifecycle ────────────────────────────────────────────
  "component.render": {
    family: "component",
    level: "semantic",
    summary: "A Component produced an Element tree.",
  },
  "component.initial": {
    family: "component",
    level: "cost",
    summary: "A Component rendered for the first time.",
  },
  "component.rerender": { family: "component", level: "cost", summary: "A Component re-rendered." },
  "component.rerender.error": {
    family: "component",
    level: "diagnostic",
    summary: "A Component re-render threw.",
  },
  "component.superseded": {
    family: "component",
    level: "diagnostic",
    summary:
      "A Component re-render was superseded by a newer latest-wins render and preserved without tearing down.",
  },
  "component.cleanup": {
    family: "component",
    level: "cost",
    summary: "A Component was cleaned up.",
  },
  "component.error": {
    family: "component",
    level: "diagnostic",
    logLevel: "Error",
    summary: "A Component render threw.",
  },

  // ── Intrinsic & DOM ───────────────────────────────────────────────────────
  "intrinsic.render": {
    family: "dom",
    level: "cost",
    summary: "An intrinsic (host) element rendered.",
  },
  "intrinsic.cleanup.start": {
    family: "dom",
    level: "cost",
    summary: "Intrinsic element cleanup began.",
  },
  "intrinsic.cleanup.remove": {
    family: "dom",
    level: "cost",
    summary: "Intrinsic element cleanup removed nodes.",
  },
  "dom.create": { family: "dom", level: "cost", summary: "A DOM node was created." },
  "dom.remove": { family: "dom", level: "cost", summary: "A DOM node was removed." },
  "safeUrl.blocked": { family: "dom", level: "diagnostic", summary: "An unsafe URL was blocked." },

  // ── Keyed list reconciliation ─────────────────────────────────────────────
  "keyedList.state": {
    family: "keyedList",
    level: "cost",
    summary: "Keyed list computed its keyed state.",
  },
  "keyedList.update": {
    family: "keyedList",
    level: "cost",
    summary: "Keyed list applied an update.",
  },
  "keyedList.update.error": {
    family: "keyedList",
    level: "diagnostic",
    summary: "Keyed list update threw.",
  },
  "keyedList.reorder": {
    family: "keyedList",
    level: "cost",
    summary: "Keyed list reordered items.",
  },
  "keyedList.item.add": {
    family: "keyedList",
    level: "cost",
    summary: "Keyed list added an item.",
  },
  "keyedList.item.remove": {
    family: "keyedList",
    level: "cost",
    summary: "Keyed list removed an item.",
  },
  "keyedList.item.rerender": {
    family: "keyedList",
    level: "cost",
    summary: "Keyed list re-rendered an item.",
  },
  "keyedList.item.rerender.error": {
    family: "keyedList",
    level: "diagnostic",
    summary: "Keyed list item re-render threw.",
  },
  "keyedList.subscription.add": {
    family: "keyedList",
    level: "cost",
    summary: "Keyed list added an item subscription.",
  },
  "keyedList.subscription.remove": {
    family: "keyedList",
    level: "cost",
    summary: "Keyed list removed an item subscription.",
  },

  // ── Error boundary ────────────────────────────────────────────────────────
  "errorBoundary.initial": {
    family: "render",
    level: "cost",
    summary: "An error boundary rendered its children.",
  },
  "errorBoundary.caught": {
    family: "render",
    level: "diagnostic",
    summary: "An error boundary caught an error.",
  },
  "errorBoundary.fallback": {
    family: "render",
    level: "cost",
    summary: "An error boundary rendered its fallback.",
  },

  // ── Resource fetching ─────────────────────────────────────────────────────
  "resource.fetch.start": {
    family: "resource",
    level: "cost",
    summary: "A resource fetch was requested.",
  },
  "resource.fetch.starting": {
    family: "resource",
    level: "cost",
    summary: "A resource fetch is starting work.",
  },
  "resource.fetch.called": {
    family: "resource",
    level: "cost",
    summary: "A resource fetcher function was invoked.",
  },
  "resource.fetch.cached": {
    family: "resource",
    level: "cost",
    summary: "A resource fetch was served from cache.",
  },
  "resource.fetch.dedupe_wait": {
    family: "resource",
    level: "cost",
    summary: "A resource fetch awaited an in-flight request.",
  },
  "resource.fetch.fork_running": {
    family: "resource",
    level: "cost",
    summary: "A resource fetch forked a running request.",
  },
  "resource.fetch.success": {
    family: "resource",
    level: "cost",
    summary: "A resource fetch succeeded.",
  },
  "resource.fetch.set_success": {
    family: "resource",
    level: "cost",
    summary: "A resource stored a success value.",
  },
  "resource.fetch.error": {
    family: "resource",
    level: "diagnostic",
    summary: "A resource fetch failed.",
  },
  "resource.fetch.set_failure": {
    family: "resource",
    level: "diagnostic",
    summary: "A resource stored a failure.",
  },
  "resource.fetch.interrupted": {
    family: "resource",
    level: "cost",
    summary: "A resource fetch was interrupted.",
  },
  "resource.fetch.defect": {
    family: "resource",
    level: "diagnostic",
    logLevel: "Error",
    summary: "A resource fetch died with a defect.",
  },
  "resource.fetch.unhandled": {
    family: "resource",
    level: "diagnostic",
    logLevel: "Error",
    summary: "A resource fetch produced an unhandled outcome.",
  },
  "resource.fetch.complete": {
    family: "resource",
    level: "cost",
    summary: "A resource fetch finished.",
  },
  "resource.registry.create_entry": {
    family: "resource",
    level: "cost",
    summary: "A resource registry entry was created.",
  },
  "resource.registry.get_existing": {
    family: "resource",
    level: "cost",
    summary: "An existing resource registry entry was reused.",
  },

  // ── API handlers / middleware ─────────────────────────────────────────────
  "api.request.received": { family: "api", level: "cost", summary: "An API request was received." },
  "api.request.handler_available": {
    family: "api",
    level: "cost",
    summary: "A matching API handler was available.",
  },
  "api.request.handler_missing": {
    family: "api",
    level: "diagnostic",
    summary: "No API handler matched the request.",
  },
  "api.request.error": { family: "api", level: "diagnostic", summary: "An API request errored." },
  "api.handler.loading": {
    family: "api",
    level: "cost",
    summary: "An API handler module began loading.",
  },
  "api.handler.loaded": { family: "api", level: "cost", summary: "An API handler module loaded." },
  "api.handler.load_error": {
    family: "api",
    level: "diagnostic",
    summary: "An API handler module failed to load.",
  },
  "api.middleware.init": { family: "api", level: "cost", summary: "API middleware initialised." },
  "api.middleware.mounted": { family: "api", level: "cost", summary: "API middleware mounted." },
  "api.middleware.error": {
    family: "api",
    level: "diagnostic",
    summary: "API middleware errored.",
  },

  // ── Scroll ────────────────────────────────────────────────────────────────
  "scroll.apply": {
    family: "scroll",
    level: "semantic",
    summary: "A scroll strategy was applied after a route commit.",
  },

  // ── Effect lifecycle seams ────────────────────────────────────────────────
  "effect.fork.scoped": { family: "effect", level: "cost", summary: "A scoped fiber was forked." },
  "effect.fiber.interrupt": {
    family: "effect",
    level: "cost",
    summary: "A framework-owned fiber was interrupted.",
  },
  "effect.finalizer.register": {
    family: "effect",
    level: "cost",
    summary: "A framework finalizer was registered.",
  },
  "effect.finalizer.run": {
    family: "effect",
    level: "cost",
    summary: "A framework finalizer ran.",
  },
  "effect.scope.close": {
    family: "effect",
    level: "cost",
    summary: "A Trygg scope closed (provider/signal/component/portal/boundary).",
  },
  "effect.error.ignored": {
    family: "effect",
    level: "diagnostic",
    summary: "Cleanup intentionally narrowed or tolerated an error.",
  },

  // ── Unsafe internals ──────────────────────────────────────────────────────
  "unsafe.buildContext": {
    family: "unsafe",
    level: "diagnostic",
    summary: "An unsafe context build was performed.",
  },
  "unsafe.mergeLayers": {
    family: "unsafe",
    level: "diagnostic",
    summary: "An unsafe layer merge was performed.",
  },
});

export type TraceEventName = keyof typeof CATALOG;

/** Look up the catalog metadata for an event name. */
export const metaOf = (name: TraceEventName): TraceMeta => CATALOG[name];
