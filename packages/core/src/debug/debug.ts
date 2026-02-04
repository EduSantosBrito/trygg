/**
 * @since 1.0.0
 * Debug logging for trygg
 *
 * Uses wide event pattern - one structured log per operation with full context.
 * Enable by adding <DevMode /> component to your app.
 *
 * @example
 * ```tsx
 * import { mount, DevMode } from "trygg"
 *
 * mount(container, <>
 *   {App}
 *   <DevMode />
 * </>)
 * ```
 */

import { Effect, FiberRef, GlobalValue, Layer } from "effect";

/** Base fields for all events */
interface BaseEvent {
  readonly timestamp: string;
  readonly duration_ms?: number;
  /** Trace ID for correlating events across a navigation flow */
  readonly traceId?: string;
  /** Span ID for tracking nested operations within a trace */
  readonly spanId?: string;
  /** Parent span ID for building span hierarchies */
  readonly parentSpanId?: string;
}

/** Signal events */
type SignalCreateEvent = BaseEvent & {
  readonly event: "signal.create";
  readonly signal_id: string;
  readonly value: unknown;
  readonly component: string;
};

type SignalGetEvent = BaseEvent & {
  readonly event: "signal.get";
  readonly signal_id: string;
  readonly trigger: string;
};

type SignalGetPhaseEvent = BaseEvent & {
  readonly event: "signal.get.phase";
  readonly signal_id: string;
  readonly has_phase: boolean;
};

type SignalSetEvent = BaseEvent & {
  readonly event: "signal.set";
  readonly signal_id: string;
  readonly prev_value: unknown;
  readonly value: unknown;
  readonly listener_count: number;
};

type SignalSetSkippedEvent = BaseEvent & {
  readonly event: "signal.set.skipped";
  readonly signal_id: string;
  readonly value: unknown;
  readonly reason: string;
};

type SignalUpdateEvent = BaseEvent & {
  readonly event: "signal.update";
  readonly signal_id: string;
  readonly prev_value: unknown;
  readonly value: unknown;
  readonly listener_count: number;
};

type SignalUpdateSkippedEvent = BaseEvent & {
  readonly event: "signal.update.skipped";
  readonly signal_id: string;
  readonly value: unknown;
  readonly reason: string;
};

type SignalNotifyEvent = BaseEvent & {
  readonly event: "signal.notify";
  readonly signal_id: string;
  readonly listener_count: number;
};

type SignalSubscribeEvent = BaseEvent & {
  readonly event: "signal.subscribe";
  readonly signal_id: string;
  readonly listener_count: number;
};

type SignalUnsubscribeEvent = BaseEvent & {
  readonly event: "signal.unsubscribe";
  readonly signal_id: string;
  readonly listener_count: number;
};

/** F-003: Signal listener error event for error isolation */
type SignalListenerErrorEvent = BaseEvent & {
  readonly event: "signal.listener.error";
  readonly signal_id: string;
  readonly cause: string;
  readonly listener_index: number;
};

type SignalDeriveCreateEvent = BaseEvent & {
  readonly event: "signal.derive.create";
  readonly signal_id: string;
  readonly source_id: string;
  readonly value: unknown;
};

type SignalDeriveCleanupEvent = BaseEvent & {
  readonly event: "signal.derive.cleanup";
  readonly signal_id: string;
  readonly source_id: string;
};

type SignalDeriveAllCreateEvent = BaseEvent & {
  readonly event: "signal.deriveAll.create";
  readonly signal_id: string;
  readonly source_count: number;
  readonly value: unknown;
};

type SignalDeriveAllCleanupEvent = BaseEvent & {
  readonly event: "signal.deriveAll.cleanup";
  readonly signal_id: string;
  readonly source_count: number;
};

/** Render events */
type RenderComponentInitialEvent = BaseEvent & {
  readonly event: "render.component.initial";
  readonly accessed_signals: number;
};

type RenderComponentRerenderEvent = BaseEvent & {
  readonly event: "render.component.rerender";
  readonly trigger: string;
  readonly accessed_signals: number;
};

type RenderComponentCleanupEvent = BaseEvent & {
  readonly event: "render.component.cleanup";
};

type RenderComponentErrorEvent = BaseEvent & {
  readonly event: "render.component.error";
  readonly reason: string;
};

type RenderComponentRerenderErrorEvent = BaseEvent & {
  readonly event: "render.component.rerender.error";
  readonly reason: string;
};

type RenderSignalTextInitialEvent = BaseEvent & {
  readonly event: "render.signaltext.initial";
  readonly signal_id: string;
  readonly value: unknown;
};

type RenderSignalTextUpdateEvent = BaseEvent & {
  readonly event: "render.signaltext.update";
  readonly signal_id: string;
  readonly value: unknown;
};

type RenderSignalElementInitialEvent = BaseEvent & {
  readonly event: "render.signalelement.initial";
  readonly signal_id: string;
};

type RenderSignalElementSwapEvent = BaseEvent & {
  readonly event: "render.signalelement.swap";
  readonly signal_id: string;
};

type RenderSignalElementSwapStartEvent = BaseEvent & {
  readonly event: "render.signalelement.swap.start";
  readonly signal_id: string;
};

type RenderSignalElementSwapCleanupEvent = BaseEvent & {
  readonly event: "render.signalelement.swap.cleanup";
  readonly signal_id: string;
};

type RenderSignalElementSwapRenderEvent = BaseEvent & {
  readonly event: "render.signalelement.swap.render";
  readonly signal_id: string;
};

type RenderSignalElementSwapErrorEvent = BaseEvent & {
  readonly event: "render.signalelement.swap.error";
  readonly signal_id: string;
  readonly error: string;
};

type RenderSignalElementScopeStartEvent = BaseEvent & {
  readonly event: "render.signalelement.scope.start";
  readonly signal_id: string;
};

type RenderSignalElementScopeRenderEvent = BaseEvent & {
  readonly event: "render.signalelement.scope.render";
  readonly signal_id: string;
};

type RenderSignalElementScopeRenderedEvent = BaseEvent & {
  readonly event: "render.signalelement.scope.rendered";
  readonly signal_id: string;
  readonly fragment_children: number;
};

type RenderSignalElementInsertEvent = BaseEvent & {
  readonly event: "render.signalelement.insert";
  readonly signal_id: string;
  readonly inserted_children: number;
  readonly anchor_in_dom: boolean;
  readonly parent_in_dom: boolean;
};

type RenderSignalElementCleanupEvent = BaseEvent & {
  readonly event: "render.signalelement.cleanup";
  readonly signal_id: string;
};

type RenderIntrinsicEvent = BaseEvent & {
  readonly event: "render.intrinsic";
  readonly element_tag: string;
};

type RenderIntrinsicCleanupStartEvent = BaseEvent & {
  readonly event: "render.intrinsic.cleanup.start";
  readonly element_tag: string;
  readonly child_count: number;
};

type RenderIntrinsicCleanupRemoveEvent = BaseEvent & {
  readonly event: "render.intrinsic.cleanup.remove";
  readonly element_tag: string;
  readonly in_dom: boolean;
};

type RenderDocumentEvent = BaseEvent & {
  readonly event: "render.document";
  readonly element_tag: string;
  readonly target: string;
};

type RenderScheduleEvent = BaseEvent & {
  readonly event: "render.schedule";
  readonly is_rerendering: boolean;
  readonly pending_rerender: boolean;
};

type RenderKeyedListUpdateEvent = BaseEvent & {
  readonly event: "render.keyedlist.update";
  readonly current_keys: number;
};

type RenderKeyedListItemAddEvent = BaseEvent & {
  readonly event: "render.keyedlist.item.add";
  readonly key: string | number;
};

type RenderKeyedListItemRemoveEvent = BaseEvent & {
  readonly event: "render.keyedlist.item.remove";
  readonly key: string | number;
};

type RenderKeyedListItemRerenderEvent = BaseEvent & {
  readonly event: "render.keyedlist.item.rerender";
  readonly key: string | number;
};

type RenderKeyedListSubscriptionAddEvent = BaseEvent & {
  readonly event: "render.keyedlist.subscription.add";
  readonly key: string | number;
  readonly signal_id: string;
};

type RenderKeyedListSubscriptionRemoveEvent = BaseEvent & {
  readonly event: "render.keyedlist.subscription.remove";
  readonly key: string | number;
  readonly signal_id: string;
};

type RenderKeyedListReorderEvent = BaseEvent & {
  readonly event: "render.keyedlist.reorder";
  readonly total_items: number;
  readonly moves: number;
  readonly stable_nodes: number;
};

/** Error boundary events */
type RenderErrorBoundaryInitialEvent = BaseEvent & {
  readonly event: "render.errorboundary.initial";
};

type RenderErrorBoundaryCaughtEvent = BaseEvent & {
  readonly event: "render.errorboundary.caught";
  readonly reason: string;
};

type RenderErrorBoundaryFallbackEvent = BaseEvent & {
  readonly event: "render.errorboundary.fallback";
};

/** Resource events */
type ResourceRegistryGetExistingEvent = BaseEvent & {
  readonly event: "resource.registry.get_existing";
  readonly key: string;
};

type ResourceRegistryCreateEntryEvent = BaseEvent & {
  readonly event: "resource.registry.create_entry";
  readonly key: string;
};

type ResourceFetchCalledEvent = BaseEvent & {
  readonly event: "resource.fetch.called";
  readonly key: string;
};

type ResourceFetchDedupeWaitEvent = BaseEvent & {
  readonly event: "resource.fetch.dedupe_wait";
  readonly key: string;
};

type ResourceFetchCachedEvent = BaseEvent & {
  readonly event: "resource.fetch.cached";
  readonly key: string;
  readonly state: string;
};

type ResourceFetchStartingEvent = BaseEvent & {
  readonly event: "resource.fetch.starting";
  readonly key: string;
};

type ResourceFetchStartEvent = BaseEvent & {
  readonly event: "resource.fetch.start";
  readonly key: string;
};

type ResourceFetchForkRunningEvent = BaseEvent & {
  readonly event: "resource.fetch.fork_running";
  readonly key: string;
};

type ResourceFetchSuccessEvent = BaseEvent & {
  readonly event: "resource.fetch.success";
  readonly key: string;
  readonly value_type: string;
  readonly is_array: boolean;
  readonly length?: number;
};

type ResourceFetchErrorEvent = BaseEvent & {
  readonly event: "resource.fetch.error";
  readonly key: string;
  readonly error: unknown;
  readonly error_message: string;
};

type ResourceFetchSetSuccessEvent = BaseEvent & {
  readonly event: "resource.fetch.set_success";
  readonly key: string;
};

type ResourceFetchSetFailureEvent = BaseEvent & {
  readonly event: "resource.fetch.set_failure";
  readonly key: string;
  readonly error: string;
};

type ResourceFetchCompleteEvent = BaseEvent & {
  readonly event: "resource.fetch.complete";
  readonly key: string;
};

type ResourceFetchDefectEvent = BaseEvent & {
  readonly event: "resource.fetch.defect";
  readonly key: string;
  readonly defect: string;
};

type ResourceFetchUnhandledEvent = BaseEvent & {
  readonly event: "resource.fetch.unhandled";
  readonly key: string;
  readonly cause: string;
};

/** API middleware events */
type ApiMiddlewareInitEvent = BaseEvent & {
  readonly event: "api.middleware.init";
};

type ApiMiddlewareMountedEvent = BaseEvent & {
  readonly event: "api.middleware.mounted";
  readonly platform: string;
};

type ApiMiddlewareErrorEvent = BaseEvent & {
  readonly event: "api.middleware.error";
  readonly reason: string;
};

type ApiRequestReceivedEvent = BaseEvent & {
  readonly event: "api.request.received";
  readonly method: string;
  readonly url: string;
};

type ApiRequestHandlerAvailableEvent = BaseEvent & {
  readonly event: "api.request.handler_available";
  readonly url: string;
};

type ApiRequestHandlerMissingEvent = BaseEvent & {
  readonly event: "api.request.handler_missing";
  readonly url: string;
  readonly last_error?: string;
};

type ApiRequestErrorEvent = BaseEvent & {
  readonly event: "api.request.error";
  readonly url: string;
  readonly error: string;
};

type ApiHandlerLoadingEvent = BaseEvent & {
  readonly event: "api.handler.loading";
  readonly module_path: string;
};

type ApiHandlerLoadedEvent = BaseEvent & {
  readonly event: "api.handler.loaded";
  readonly module_path: string;
  readonly exports: ReadonlyArray<string>;
};

type ApiHandlerLoadErrorEvent = BaseEvent & {
  readonly event: "api.handler.load_error";
  readonly module_path: string;
  readonly error: string;
};

/** Router events */
type RouterNavigateEvent = BaseEvent & {
  readonly event: "router.navigate";
  readonly from_path: string;
  readonly to_path: string;
  readonly replace?: boolean;
};

type RouterNavigateCompleteEvent = BaseEvent & {
  readonly event: "router.navigate.complete";
  readonly path: string;
};

type RouterMatchEvent = BaseEvent & {
  readonly event: "router.match";
  readonly path: string;
  readonly route_pattern: string;
  readonly params: Record<string, string>;
};

type RouterMatchNotFoundEvent = BaseEvent & {
  readonly event: "router.match.notfound";
  readonly path: string;
};

type RouterGuardStartEvent = BaseEvent & {
  readonly event: "router.guard.start";
  readonly route_pattern: string;
  readonly has_guard: boolean;
};

type RouterGuardAllowEvent = BaseEvent & {
  readonly event: "router.guard.allow";
  readonly route_pattern: string;
};

type RouterGuardRedirectEvent = BaseEvent & {
  readonly event: "router.guard.redirect";
  readonly route_pattern: string;
  readonly redirect_to: string;
};

type RouterGuardSkipEvent = BaseEvent & {
  readonly event: "router.guard.skip";
  readonly route_pattern: string;
  readonly reason: string;
};

type RouterRenderStartEvent = BaseEvent & {
  readonly event: "router.render.start";
  readonly route_pattern: string;
  readonly params: Record<string, string>;
  readonly has_guard: boolean;
  readonly has_layout: boolean;
};

type RouterRenderCompleteEvent = BaseEvent & {
  readonly event: "router.render.complete";
  readonly route_pattern: string;
  readonly has_layout: boolean;
};

type RouterLinkClickEvent = BaseEvent & {
  readonly event: "router.link.click";
  readonly to_path: string;
  readonly replace?: boolean;
  readonly reason?: string;
};

type RouterErrorEvent = BaseEvent & {
  readonly event: "router.error";
  readonly route_pattern: string;
  readonly error: string;
};

type RouterPopstateAddedEvent = BaseEvent & {
  readonly event: "router.popstate.added";
};

type RouterPopstateRemovedEvent = BaseEvent & {
  readonly event: "router.popstate.removed";
};

type RouterMatcherCompileEvent = BaseEvent & {
  readonly event: "router.matcher.compile";
  readonly route_count: number;
  readonly is_recompile: boolean;
};

type RouterMatcherCachedEvent = BaseEvent & {
  readonly event: "router.matcher.cached";
  readonly route_count: number;
};

type Router404RenderEvent = BaseEvent & {
  readonly event: "router.404.render";
  readonly path: string;
  readonly has_custom_404: boolean;
};

type Router404FallbackEvent = BaseEvent & {
  readonly event: "router.404.fallback";
  readonly path: string;
  readonly has_custom_404: boolean;
};

/** F-002: Route load cancellation event */
type RouterLoadCancelledEvent = BaseEvent & {
  readonly event: "router.load.cancelled";
  readonly from_key: string;
  readonly to_key: string;
};

/** F-001: Module loading events for parallel loading with memoization */
type RouterModuleLoadStartEvent = BaseEvent & {
  readonly event: "router.module.load.start";
  readonly path: string;
  readonly kind: "component" | "layout" | "guard" | "loading" | "error" | "not_found";
  readonly is_prefetch: boolean;
  readonly attempt: number;
};

type RouterModuleLoadCompleteEvent = BaseEvent & {
  readonly event: "router.module.load.complete";
  readonly path: string;
  readonly kind: "component" | "layout" | "guard" | "loading" | "error" | "not_found";
  readonly duration_ms: number;
  readonly is_prefetch: boolean;
  readonly attempt: number;
};

type RouterModuleLoadTimeoutEvent = BaseEvent & {
  readonly event: "router.module.load.timeout";
  readonly path: string;
  readonly kind: "component" | "layout" | "guard" | "loading" | "error" | "not_found";
  readonly timeout_ms: number;
  readonly is_prefetch: boolean;
  readonly attempt: number;
};

type RouterModuleLoadCacheHitEvent = BaseEvent & {
  readonly event: "router.module.load.cache_hit";
  readonly path: string;
  readonly kind: "component" | "layout" | "guard" | "loading" | "error" | "not_found";
  readonly is_prefetch: boolean;
};

type RouterPrefetchStartEvent = BaseEvent & {
  readonly event: "router.prefetch.start";
  readonly path: string;
  readonly route_pattern: string;
  readonly module_count: number;
};

type RouterPrefetchCompleteEvent = BaseEvent & {
  readonly event: "router.prefetch.complete";
  readonly path: string;
};

type RouterPrefetchNoMatchEvent = BaseEvent & {
  readonly event: "router.prefetch.no_match";
  readonly path: string;
};

/** F-001: Viewport prefetch trigger event */
type RouterPrefetchViewportEvent = BaseEvent & {
  readonly event: "router.prefetch.viewport";
  readonly path: string;
};

/** F-001: Viewport observer lifecycle events */
type RouterViewportObserverAddedEvent = BaseEvent & {
  readonly event: "router.viewport.observer.added";
};

type RouterViewportObserverRemovedEvent = BaseEvent & {
  readonly event: "router.viewport.observer.removed";
};

type RouterOutletStartEvent = BaseEvent & {
  readonly event: "router.outlet.start";
  readonly routes_count: number;
};

type RouterOutletNestedEvent = BaseEvent & {
  readonly event: "router.outlet.nested";
};

type RouterOutletNoRoutesEvent = BaseEvent & {
  readonly event: "router.outlet.no_routes";
};

type RouterOutletMatchingEvent = BaseEvent & {
  readonly event: "router.outlet.matching";
  readonly path: string;
};

/** Router async tracker events for debugging navigation */
type RouterTrackerInterruptEvent = BaseEvent & {
  readonly event: "router.tracker.interrupt";
};

type RouterTrackerLoadingEvent = BaseEvent & {
  readonly event: "router.tracker.loading";
};

type RouterTrackerRefreshingEvent = BaseEvent & {
  readonly event: "router.tracker.refreshing";
};

type RouterTrackerReadyEvent = BaseEvent & {
  readonly event: "router.tracker.ready";
};

type RouterTrackerErrorEvent = BaseEvent & {
  readonly event: "router.tracker.error";
};

/** Trace events for correlation and span tracking */
type TraceSpanStartEvent = BaseEvent & {
  readonly event: "trace.span.start";
  readonly name: string;
  readonly attributes?: Record<string, unknown>;
};

type TraceSpanEndEvent = BaseEvent & {
  readonly event: "trace.span.end";
  readonly name: string;
  readonly status: "ok" | "error";
  readonly error?: string;
};

/** Router scroll events */
type RouterScrollTopEvent = BaseEvent & {
  readonly event: "router.scroll.top";
};

type RouterScrollRestoreEvent = BaseEvent & {
  readonly event: "router.scroll.restore";
  readonly key: string;
  readonly x: number;
  readonly y: number;
};

type RouterScrollSaveEvent = BaseEvent & {
  readonly event: "router.scroll.save";
  readonly key: string;
  readonly x: number;
  readonly y: number;
};

/** Router outlet error — processRoute catchAllCause */
type RouterOutletErrorEvent = BaseEvent & {
  readonly event: "router.outlet.error";
  readonly error: string;
};

/** Unsafe quarantine events — observability for type-boundary crossings */
type UnsafeMergeLayersEvent = BaseEvent & {
  readonly event: "unsafe.mergeLayers";
  readonly layer_count: number;
};

type UnsafeBuildContextEvent = BaseEvent & {
  readonly event: "unsafe.buildContext";
  readonly layer_count: number;
};

/** All debug events as discriminated union */
export type DebugEvent =
  // Signal events
  | SignalCreateEvent
  | SignalGetEvent
  | SignalGetPhaseEvent
  | SignalSetEvent
  | SignalSetSkippedEvent
  | SignalUpdateEvent
  | SignalUpdateSkippedEvent
  | SignalNotifyEvent
  | SignalSubscribeEvent
  | SignalUnsubscribeEvent
  | SignalListenerErrorEvent
  | SignalDeriveCreateEvent
  | SignalDeriveCleanupEvent
  | SignalDeriveAllCreateEvent
  | SignalDeriveAllCleanupEvent
  // Render events
  | RenderComponentInitialEvent
  | RenderComponentRerenderEvent
  | RenderComponentCleanupEvent
  | RenderComponentErrorEvent
  | RenderComponentRerenderErrorEvent
  | RenderSignalTextInitialEvent
  | RenderSignalTextUpdateEvent
  | RenderSignalElementInitialEvent
  | RenderSignalElementSwapEvent
  | RenderSignalElementSwapStartEvent
  | RenderSignalElementSwapCleanupEvent
  | RenderSignalElementSwapRenderEvent
  | RenderSignalElementSwapErrorEvent
  | RenderSignalElementScopeStartEvent
  | RenderSignalElementScopeRenderEvent
  | RenderSignalElementScopeRenderedEvent
  | RenderSignalElementInsertEvent
  | RenderSignalElementCleanupEvent
  | RenderIntrinsicEvent
  | RenderIntrinsicCleanupStartEvent
  | RenderIntrinsicCleanupRemoveEvent
  | RenderDocumentEvent
  | RenderScheduleEvent
  | RenderKeyedListUpdateEvent
  | RenderKeyedListItemAddEvent
  | RenderKeyedListItemRemoveEvent
  | RenderKeyedListItemRerenderEvent
  | RenderKeyedListSubscriptionAddEvent
  | RenderKeyedListSubscriptionRemoveEvent
  | RenderKeyedListReorderEvent
  // Error boundary events
  | RenderErrorBoundaryInitialEvent
  | RenderErrorBoundaryCaughtEvent
  | RenderErrorBoundaryFallbackEvent
  // Resource events
  | ResourceRegistryGetExistingEvent
  | ResourceRegistryCreateEntryEvent
  | ResourceFetchCalledEvent
  | ResourceFetchDedupeWaitEvent
  | ResourceFetchCachedEvent
  | ResourceFetchStartingEvent
  | ResourceFetchStartEvent
  | ResourceFetchForkRunningEvent
  | ResourceFetchSuccessEvent
  | ResourceFetchErrorEvent
  | ResourceFetchSetSuccessEvent
  | ResourceFetchSetFailureEvent
  | ResourceFetchCompleteEvent
  | ResourceFetchDefectEvent
  | ResourceFetchUnhandledEvent
  // API middleware events
  | ApiMiddlewareInitEvent
  | ApiMiddlewareMountedEvent
  | ApiMiddlewareErrorEvent
  | ApiRequestReceivedEvent
  | ApiRequestHandlerAvailableEvent
  | ApiRequestHandlerMissingEvent
  | ApiRequestErrorEvent
  | ApiHandlerLoadingEvent
  | ApiHandlerLoadedEvent
  | ApiHandlerLoadErrorEvent
  // Router events
  | RouterNavigateEvent
  | RouterNavigateCompleteEvent
  | RouterMatchEvent
  | RouterMatchNotFoundEvent
  | RouterGuardStartEvent
  | RouterGuardAllowEvent
  | RouterGuardRedirectEvent
  | RouterGuardSkipEvent
  | RouterRenderStartEvent
  | RouterRenderCompleteEvent
  | RouterLinkClickEvent
  | RouterErrorEvent
  | RouterPopstateAddedEvent
  | RouterPopstateRemovedEvent
  | RouterMatcherCompileEvent
  | RouterMatcherCachedEvent
  | Router404RenderEvent
  | Router404FallbackEvent
  | RouterLoadCancelledEvent
  | RouterModuleLoadStartEvent
  | RouterModuleLoadCompleteEvent
  | RouterModuleLoadTimeoutEvent
  | RouterModuleLoadCacheHitEvent
  | RouterPrefetchStartEvent
  | RouterPrefetchCompleteEvent
  | RouterPrefetchNoMatchEvent
  | RouterPrefetchViewportEvent
  | RouterViewportObserverAddedEvent
  | RouterViewportObserverRemovedEvent
  | RouterTrackerInterruptEvent
  | RouterTrackerLoadingEvent
  | RouterTrackerRefreshingEvent
  | RouterTrackerReadyEvent
  | RouterTrackerErrorEvent
  | RouterOutletStartEvent
  | RouterOutletNestedEvent
  | RouterOutletNoRoutesEvent
  | RouterOutletMatchingEvent
  | RouterOutletErrorEvent
  // Scroll events
  | RouterScrollTopEvent
  | RouterScrollRestoreEvent
  | RouterScrollSaveEvent
  // Trace events
  | TraceSpanStartEvent
  | TraceSpanEndEvent
  // Unsafe quarantine events
  | UnsafeMergeLayersEvent
  | UnsafeBuildContextEvent;

/** Extract event type from DebugEvent */
export type EventType = DebugEvent["event"];

/**
 * Loose input type for log function.
 * Accepts any event with optional fields - the discriminated union above
 * documents the expected shape for each event type.
 */
export type LogInput = {
  readonly event: EventType;
  readonly duration_ms?: number;
  // Allow any additional fields
  readonly [key: string]: unknown;
};

/** Trace context structure */
export interface TraceContext {
  readonly traceId?: string;
  readonly spanId?: string;
  readonly parentSpanId?: string;
}

// --- Plugin System ---

/**
 * Debug plugin interface.
 * Plugins receive structured events and can output them to any destination.
 * @since 1.0.0
 */
export interface DebugPlugin {
  /** Unique plugin identifier */
  readonly name: string;

  /**
   * Handle a debug event.
   * Called for each event that passes the current filter.
   * Errors thrown here are caught and logged to console.error
   * to prevent one plugin from breaking others.
   */
  readonly handle: (event: DebugEvent) => void;
}

/**
 * Create a debug plugin.
 * Helper function for constructing type-safe plugins.
 * @since 1.0.0
 */
export const createPlugin = (name: string, handle: (event: DebugEvent) => void): DebugPlugin => ({
  name,
  handle,
});

// --- Internal State ---

let _enabled = false;
let _filter: Set<string> | null = null;
const _plugins: Map<string, DebugPlugin> = new Map();

// --- Signal ID Generation ---

/** Generate unique signal ID for tracking */
let signalCounter = 0;
export const nextSignalId = (): string => `sig_${++signalCounter}`;

/** Store signal IDs on signal objects */
const signalIds = new WeakMap<object, string>();

export const getSignalId = (signal: object): string => {
  let id = signalIds.get(signal);
  if (id === undefined) {
    id = nextSignalId();
    signalIds.set(signal, id);
  }
  return id;
};

// --- Trace ID Generation ---

/** Generate unique trace ID for correlating events across a navigation flow */
let traceCounter = 0;
export const nextTraceId = (): string => `trace_${++traceCounter}`;

/** Generate unique span ID for tracking nested operations */
let spanCounter = 0;
export const nextSpanId = (): string => `span_${++spanCounter}`;

// --- Trace Context FiberRefs ---

/**
 * FiberRef for current trace ID.
 * Set by router on navigate, propagated through Effect context.
 * Uses GlobalValue to ensure single instance even with module duplication.
 * @since 1.0.0
 */
export const CurrentTraceId: FiberRef.FiberRef<string | undefined> = GlobalValue.globalValue(
  Symbol.for("trygg/Debug/CurrentTraceId"),
  () => FiberRef.unsafeMake<string | undefined>(undefined),
);

/**
 * FiberRef for current span ID.
 * Set by startSpan, propagated through Effect context.
 * Uses GlobalValue to ensure single instance even with module duplication.
 * @since 1.0.0
 */
export const CurrentSpanId: FiberRef.FiberRef<string | undefined> = GlobalValue.globalValue(
  Symbol.for("trygg/Debug/CurrentSpanId"),
  () => FiberRef.unsafeMake<string | undefined>(undefined),
);

/**
 * FiberRef for parent span ID.
 * Used for building span hierarchies.
 * Uses GlobalValue to ensure single instance even with module duplication.
 * @since 1.0.0
 */
export const CurrentParentSpanId: FiberRef.FiberRef<string | undefined> = GlobalValue.globalValue(
  Symbol.for("trygg/Debug/CurrentParentSpanId"),
  () => FiberRef.unsafeMake<string | undefined>(undefined),
);

/**
 * Get current trace context from FiberRefs.
 * Effect-based - reads from fiber-local state.
 * @since 1.0.0
 */
export const getTraceContext: Effect.Effect<TraceContext> = Effect.gen(function* () {
  const traceId = yield* FiberRef.get(CurrentTraceId);
  const spanId = yield* FiberRef.get(CurrentSpanId);
  const parentSpanId = yield* FiberRef.get(CurrentParentSpanId);

  return {
    ...(traceId !== undefined ? { traceId } : {}),
    ...(spanId !== undefined ? { spanId } : {}),
    ...(parentSpanId !== undefined ? { parentSpanId } : {}),
  };
});

/**
 * Set the current trace ID.
 * Called by router on navigate to start a new trace.
 * @since 1.0.0
 */
export const setTraceId = (traceId: string): Effect.Effect<void> =>
  FiberRef.set(CurrentTraceId, traceId);

/**
 * Clear the current trace context.
 * @since 1.0.0
 */
export const clearTraceContext: Effect.Effect<void> = Effect.gen(function* () {
  yield* FiberRef.set(CurrentTraceId, undefined);
  yield* FiberRef.set(CurrentSpanId, undefined);
  yield* FiberRef.set(CurrentParentSpanId, undefined);
});

// --- Enable/Disable API ---

/**
 * Enable debug logging.
 * Called internally by DevMode component.
 *
 * @param filter - Optional filter for event types
 *   - undefined: log all events
 *   - string: log events matching prefix (e.g., "signal" matches "signal.set")
 *   - string[]: log events matching any prefix
 */
export const enable = (filter?: string | ReadonlyArray<string>): void => {
  _enabled = true;
  if (filter === undefined) {
    _filter = null;
  } else if (typeof filter === "string") {
    _filter = new Set([filter]);
  } else {
    _filter = new Set(filter);
  }
};

/**
 * Disable debug logging.
 * Called internally by DevMode component cleanup.
 */
export const disable = (): void => {
  _enabled = false;
  _filter = null;
};

/**
 * Check if debug logging is enabled.
 */
export const isEnabled = (): boolean => _enabled;

/**
 * Get current filter configuration.
 */
export const getFilter = (): ReadonlyArray<string> | null => {
  return _filter !== null ? Array.from(_filter) : null;
};

// --- Plugin Registration ---

/**
 * Register a debug plugin.
 * Plugins receive all events that pass the current filter.
 * Multiple plugins can be registered; each receives events independently.
 * @since 1.0.0
 */
export const registerPlugin = (plugin: DebugPlugin): void => {
  _plugins.set(plugin.name, plugin);
};

/**
 * Unregister a debug plugin by name.
 * @since 1.0.0
 */
export const unregisterPlugin = (name: string): void => {
  _plugins.delete(name);
};

/**
 * Get all registered plugin names.
 * @since 1.0.0
 */
export const getPlugins = (): ReadonlyArray<string> => {
  return Array.from(_plugins.keys());
};

/**
 * Check if a plugin is registered.
 * @since 1.0.0
 */
export const hasPlugin = (name: string): boolean => {
  return _plugins.has(name);
};

// --- Environment Detection ---

// --- Logging ---

/**
 * Check if an event should be logged based on current filter.
 */
const shouldLog = (event: EventType): boolean => {
  if (!_enabled) return false;
  if (_filter === null) return true;

  // Check if event matches any filter prefix
  for (const prefix of _filter) {
    if (event === prefix || event.startsWith(prefix + ".")) {
      return true;
    }
  }
  return false;
};

// --- Console Formatting ---

const categoryColors: Record<string, { bg: string; fg: string }> = {
  render: { bg: "#818cf8", fg: "#1e1b4b" },
  signal: { bg: "#34d399", fg: "#022c22" },
  resource: { bg: "#fbbf24", fg: "#451a03" },
  router: { bg: "#a78bfa", fg: "#2e1065" },
  trace: { bg: "#f472b6", fg: "#500724" },
  api: { bg: "#60a5fa", fg: "#172554" },
};

const badgeStyle = (bg: string, fg: string) =>
  `background:${bg};color:${fg};padding:1px 5px;border-radius:3px;font-weight:600;font-size:11px`;

const subtypeStyle = "color:#c4b5fd;font-weight:500";
const dimStyle = "color:#9ca3af;font-weight:400";
const durationStyle = "color:#67e8f9;font-weight:400";
const resetStyle = "color:inherit;font-weight:400";

const formatDetails = (event: DebugEvent): string => {
  const parts: Array<string> = [];
  const e: Record<string, unknown> = { ...event };

  if ("element_tag" in e) parts.push(`<${e.element_tag}>`);
  if ("signal_id" in e) parts.push(`${e.signal_id}`);
  if ("key" in e) parts.push(`key:${e.key}`);
  if ("accessed_signals" in e) parts.push(`signals:${e.accessed_signals}`);
  if ("listener_count" in e) parts.push(`listeners:${e.listener_count}`);
  if ("from_path" in e && "to_path" in e) parts.push(`${e.from_path} → ${e.to_path}`);
  else if ("path" in e) parts.push(`${e.path}`);
  if ("route_pattern" in e) parts.push(`${e.route_pattern}`);
  if ("trigger" in e) parts.push(`trigger:${e.trigger}`);
  if ("reason" in e) parts.push(`${e.reason}`);
  if ("value" in e) parts.push(`val:${JSON.stringify(e.value)}`);
  if ("error_message" in e) parts.push(`err:${e.error_message}`);

  return parts.length > 0 ? parts.join("  ") : "";
};

const formatEvent = (event: DebugEvent): void => {
  const dotIdx = event.event.indexOf(".");
  const category = dotIdx > 0 ? event.event.slice(0, dotIdx) : event.event;
  const subtype = dotIdx > 0 ? event.event.slice(dotIdx + 1) : "";

  const colors = categoryColors[category] ?? { bg: "#6b7280", fg: "#ffffff" };
  const details = formatDetails(event);
  const duration = event.duration_ms !== undefined ? `${event.duration_ms.toFixed(2)}ms` : "";

  const parts = [`%ctrygg%c %c${category}%c ${subtype}`];
  const styles: Array<string> = [
    badgeStyle("#1e293b", "#94a3b8"),
    resetStyle,
    badgeStyle(colors.bg, colors.fg),
    subtypeStyle,
  ];

  if (details) {
    parts.push(`%c${details}`);
    styles.push(dimStyle);
  }
  if (duration) {
    parts.push(`%c${duration}`);
    styles.push(durationStyle);
  }
  // Reset at end
  parts.push("%c");
  styles.push(resetStyle);

  // Pass DOM element as trailing arg so browsers show it on hover
  const e: Record<string, unknown> = { ...event };
  if (e.element instanceof Element) {
    console.log(parts.join(" "), ...styles, e.element);
  } else {
    console.log(parts.join(" "), ...styles);
  }
};

// --- Built-in Plugins ---

/**
 * Console plugin - outputs events with color-coded category badges.
 * Uses %c CSS styling for compact, readable output.
 * This is the default plugin used when no custom plugins are registered.
 * @since 1.0.0
 */
export const consolePlugin: DebugPlugin = createPlugin("console", formatEvent);

/**
 * Create a custom plugin that collects events into an array.
 * Useful for testing or building custom event processors.
 * @since 1.0.0
 */
export const createCollectorPlugin = (name: string, events: DebugEvent[]): DebugPlugin =>
  createPlugin(name, (event) => {
    events.push(event);
  });

/**
 * Internal: dispatch event to plugins (sync operation).
 */
const dispatchToPlugins = (fullEvent: DebugEvent): void => {
  if (_plugins.size > 0) {
    for (const plugin of _plugins.values()) {
      try {
        plugin.handle(fullEvent);
      } catch (error) {
        // Isolate plugin errors - one failing plugin shouldn't break others
        console.error(`[trygg] Plugin "${plugin.name}" error:`, error);
      }
    }
  } else {
    // Default: use console plugin when no plugins registered
    consolePlugin.handle(fullEvent);
  }
};

/**
 * Log a wide event (Effect-based).
 * Reads trace context from FiberRefs and dispatches to plugins.
 * No-op if debug is disabled or event is filtered out.
 * @since 1.0.0
 */
export const log: (event: LogInput) => Effect.Effect<void> = Effect.fnUntraced(function* (
  event: LogInput,
) {
  if (!shouldLog(event.event)) return;

  // Read trace context from FiberRefs
  const traceContext = yield* getTraceContext;

  const fullEvent = {
    timestamp: new Date().toISOString(),
    ...traceContext,
    ...event,
  } as DebugEvent;

  dispatchToPlugins(fullEvent);
});

/**
 * Start a new span within the current trace.
 * Returns an Effect that yields a function to end the span.
 * @since 1.0.0
 */
export const startSpan: (
  name: string,
  attributes?: Record<string, unknown>,
) => Effect.Effect<Effect.Effect<void>> = Effect.fnUntraced(function* (
  name: string,
  attributes?: Record<string, unknown>,
) {
  const newSpanId = nextSpanId();
  const previousSpanId = yield* FiberRef.get(CurrentSpanId);
  const previousParentSpanId = yield* FiberRef.get(CurrentParentSpanId);

  // Set new span as current, with previous span as parent
  yield* FiberRef.set(CurrentParentSpanId, previousSpanId);
  yield* FiberRef.set(CurrentSpanId, newSpanId);

  yield* log({
    event: "trace.span.start",
    name,
    ...(attributes !== undefined ? { attributes } : {}),
  });

  // Return Effect to end span (intentionally returns Effect for later execution)
  return yield* Effect.succeed(
    Effect.all(
      [
        log({ event: "trace.span.end", name, status: "ok" }),
        FiberRef.set(CurrentSpanId, previousSpanId),
        FiberRef.set(CurrentParentSpanId, previousParentSpanId),
      ],
      { discard: true },
    ),
  );
});

/**
 * Run an effect within a span.
 * Automatically ends the span when the effect completes or fails.
 * @since 1.0.0
 */
export const withSpan = <A, E, R>(
  name: string,
  effect: Effect.Effect<A, E, R>,
  attributes?: Record<string, unknown>,
): Effect.Effect<A, E, R> =>
  Effect.gen(function* () {
    const newSpanId = nextSpanId();
    const previousSpanId = yield* FiberRef.get(CurrentSpanId);
    const previousParentSpanId = yield* FiberRef.get(CurrentParentSpanId);

    // Set new span as current
    yield* FiberRef.set(CurrentParentSpanId, previousSpanId);
    yield* FiberRef.set(CurrentSpanId, newSpanId);

    yield* log({
      event: "trace.span.start",
      name,
      ...(attributes !== undefined ? { attributes } : {}),
    });

    return yield* effect.pipe(
      Effect.tapBoth({
        onSuccess: () =>
          log({
            event: "trace.span.end",
            name,
            status: "ok",
          }),
        onFailure: (error) =>
          log({
            event: "trace.span.end",
            name,
            status: "error",
            error: String(error),
          }),
      }),
      Effect.ensuring(
        Effect.all(
          [
            FiberRef.set(CurrentSpanId, previousSpanId),
            FiberRef.set(CurrentParentSpanId, previousParentSpanId),
          ],
          { discard: true },
        ),
      ),
    );
  });

/**
 * Measure duration of an effect and log it.
 * No-op if debug is disabled or event is filtered out.
 * @since 1.0.0
 */
export const measure = <A, E, R>(
  event: LogInput,
  effect: Effect.Effect<A, E, R>,
): Effect.Effect<A, E, R> =>
  Effect.gen(function* () {
    if (!shouldLog(event.event)) {
      return yield* effect;
    }

    const start = performance.now();
    const result = yield* effect;
    const duration_ms = performance.now() - start;

    yield* log({ ...event, duration_ms });
    return result;
  });

// --- Layers ---

/**
 * Default debug layer that registers the console plugin.
 *
 * This is the standard sink for development - events are logged to the
 * browser console with color coding by event category.
 *
 * Use this layer explicitly when you want console output:
 * ```typescript
 * Effect.provide(myEffect, Debug.defaultLayer)
 * ```
 *
 * @since 1.0.0
 */
export const defaultLayer: Layer.Layer<never> = Layer.scopedDiscard(
  Effect.gen(function* () {
    registerPlugin(consolePlugin);

    yield* Effect.addFinalizer(() =>
      Effect.sync(() => {
        unregisterPlugin(consolePlugin.name);
      }),
    );
  }),
);
