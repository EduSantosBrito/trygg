/**
 * Structured debug events, plugins, and tracing helpers.
 *
 * @remarks
 * Owner module for the `Debug` topic. Use this module when the app needs direct
 * control over debug enablement, event plugins, or trace/span context beyond
 * the higher-level `DevMode` component.
 *
 * @see ./debug.docs.md - Source-owned topic guide
 * @since 1.0.0
 * @module trygg/debug/debug
 */

import { Effect, Layer, Context } from "effect";
import { getFiberRef, setFiberRef } from "../internal/fiber-ref.js";

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

type RenderDocumentSignalInitialEvent = BaseEvent & {
  readonly event: "render.document.signal.initial";
  readonly signal_id: string;
  readonly value: unknown;
};

type RenderDocumentSignalUpdateEvent = BaseEvent & {
  readonly event: "render.document.signal.update";
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

type RenderKeyedListItemRerenderErrorEvent = BaseEvent & {
  readonly event: "render.keyedlist.item.rerender.error";
  readonly key: string | number;
  readonly reason: string;
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

type RenderKeyedListUpdateErrorEvent = BaseEvent & {
  readonly event: "render.keyedlist.update.error";
  readonly reason: string;
};

type RenderKeyedListStateEvent = BaseEvent & {
  readonly event: "render.keyedlist.state";
  readonly phase: "start" | "computed" | "after-reorder" | "committed";
  readonly key_order: ReadonlyArray<string | number>;
  readonly new_keys?: ReadonlyArray<string | number>;
  readonly move_count?: number;
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

type ResourceFetchInterruptedEvent = BaseEvent & {
  readonly event: "resource.fetch.interrupted";
  readonly key: string;
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

type RouterPrefetchTriggerEvent = BaseEvent & {
  readonly event: "router.prefetch.trigger";
  readonly path: string;
  readonly trigger: "render" | "intent_hover" | "intent_focus" | "viewport";
};

type RouterPrefetchErrorEvent = BaseEvent & {
  readonly event: "router.prefetch.error";
  readonly path: string;
  readonly phase: "resolver" | "viewport";
  readonly error_message: string;
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
  readonly phase?: string;
  readonly path?: string;
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

/**
 * All structured debug events emitted by the framework.
 *
 * @remarks
 * Use this union when consuming debug output in custom plugins or test helpers.
 *
 * @example
 * ```ts
 * const events: Array<Debug.DebugEvent> = []
 * ```
 *
 * @category Debugging
 * @public
 */
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
  | RenderDocumentSignalInitialEvent
  | RenderDocumentSignalUpdateEvent
  | RenderScheduleEvent
  | RenderKeyedListUpdateEvent
  | RenderKeyedListItemAddEvent
  | RenderKeyedListItemRemoveEvent
  | RenderKeyedListItemRerenderEvent
  | RenderKeyedListItemRerenderErrorEvent
  | RenderKeyedListSubscriptionAddEvent
  | RenderKeyedListSubscriptionRemoveEvent
  | RenderKeyedListReorderEvent
  | RenderKeyedListUpdateErrorEvent
  | RenderKeyedListStateEvent
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
  | ResourceFetchInterruptedEvent
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
  | RouterPrefetchTriggerEvent
  | RouterPrefetchErrorEvent
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

/**
 * String union of all debug event names.
 *
 * @remarks
 * Useful for filters, plugin signatures, and helpers that only need the event
 * discriminator instead of the full payload union.
 *
 * @example
 * ```ts
 * const eventType: Debug.EventType = "signal.set"
 * ```
 *
 * @category Debugging
 * @public
 */
export type EventType = DebugEvent["event"];

/**
 * Loose input type for log function.
 * Accepts any event with optional fields - the discriminated union above
 * documents the expected shape for each event type.
 *
 * @remarks
 * `log` accepts this looser input and enriches it with timestamp and trace
 * context before dispatching it to plugins.
 *
 * @example
 * ```ts
 * const input: Debug.LogInput = { event: "signal.set", signal_id: "sig_1" }
 * ```
 *
 * @category Debugging
 * @public
 */
export type LogInput = {
  readonly event: EventType;
  readonly duration_ms?: number;
  // Allow any additional fields
  readonly [key: string]: unknown;
};

/**
 * Trace metadata attached to debug work.
 *
 * @remarks
 * `traceId`, `spanId`, and `parentSpanId` are threaded through Effect context
 * so plugins can correlate related events.
 *
 * @example
 * ```ts
 * const context: Debug.TraceContext = { traceId: "trace_1" }
 * ```
 *
 * @category Debugging
 * @public
 */
export interface TraceContext {
  readonly traceId?: string;
  readonly spanId?: string;
  readonly parentSpanId?: string;
}

// --- Plugin System ---

/**
 * Debug plugin interface.
 * Plugins receive structured events and can output them to any destination.
 *
 * @remarks
 * Register plugins through `registerPlugin` or pass them to `DevMode` to fan
 * out framework events to consoles, collectors, or external telemetry sinks.
 *
 * @example
 * ```ts
 * const plugin: Debug.DebugPlugin = Debug.createPlugin("capture", () => {})
 * ```
 *
 * @category Debugging
 * @public
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
 *
 * @remarks
 * Prefer this over hand-writing objects so plugin construction stays concise and
 * aligned with the public `DebugPlugin` shape.
 *
 * @example
 * ```ts
 * const plugin = Debug.createPlugin("capture", (event) => console.log(event.event))
 * ```
 *
 * @category Debugging
 * @public
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

/**
 * Allocate a fresh internal signal identifier.
 *
 * @remarks
 * Renderer and signal internals use this to attach stable IDs to debug events.
 *
 * @internal
 */
let signalCounter = 0;

/**
 * Allocate a fresh internal signal identifier.
 *
 * @remarks
 * Renderer and signal internals use this to attach stable IDs to debug events.
 *
 * @internal
 */
export const nextSignalId = (): string => `sig_${++signalCounter}`;

/** Store signal IDs on signal objects */
const signalIds = new WeakMap<object, string>();

/**
 * Get or assign the internal debug ID for a signal object.
 *
 * @remarks
 * Exported for framework internals that need stable signal identifiers in logs.
 *
 * @internal
 */
export const getSignalId = (signal: object): string => {
  let id = signalIds.get(signal);
  if (id === undefined) {
    id = nextSignalId();
    signalIds.set(signal, id);
  }
  return id;
};

// --- Trace ID Generation ---

/**
 * Allocate a fresh internal trace identifier.
 *
 * @remarks
 * Router and tracing internals use this when starting a new navigation trace.
 *
 * @internal
 */
let traceCounter = 0;

/**
 * Allocate a fresh internal trace identifier.
 *
 * @remarks
 * Router and tracing internals use this when starting a new navigation trace.
 *
 * @internal
 */
export const nextTraceId = (): string => `trace_${++traceCounter}`;

/**
 * Allocate a fresh internal span identifier.
 *
 * @remarks
 * Span helpers use this to correlate nested operations inside a trace.
 *
 * @internal
 */
let spanCounter = 0;

/**
 * Allocate a fresh internal span identifier.
 *
 * @remarks
 * Span helpers use this to correlate nested operations inside a trace.
 *
 * @internal
 */
export const nextSpanId = (): string => `span_${++spanCounter}`;

// --- Trace Context References ---

const getReference = <A>(reference: Context.Reference<A>): Effect.Effect<A> =>
  getFiberRef(reference);

const setReference = <A>(reference: Context.Reference<A>, value: A): Effect.Effect<void> =>
  setFiberRef(reference, value);

/**
 * Reference for current trace ID.
 * Set by router on navigate, propagated through Effect context.
 *
 * @remarks
 * Exported for low-level integrations that need direct access to the current
 * trace fiber ref.
 *
 * @internal
 * @since 1.0.0
 */
export const CurrentTraceId = Context.Reference<string | undefined>("trygg/Debug/CurrentTraceId", {
  defaultValue: () => undefined,
});

/**
 * Reference for current span ID.
 * Set by startSpan, propagated through Effect context.
 *
 * @remarks
 * Exported for low-level integrations that need direct access to the current
 * span fiber ref.
 *
 * @internal
 * @since 1.0.0
 */
export const CurrentSpanId = Context.Reference<string | undefined>("trygg/Debug/CurrentSpanId", {
  defaultValue: () => undefined,
});

/**
 * Reference for parent span ID.
 * Used for building span hierarchies.
 *
 * @remarks
 * Exported for low-level integrations that need direct access to parent span
 * context.
 *
 * @internal
 * @since 1.0.0
 */
export const CurrentParentSpanId = Context.Reference<string | undefined>(
  "trygg/Debug/CurrentParentSpanId",
  {
    defaultValue: () => undefined,
  },
);

/**
 * Get current trace context from references.
 * Effect-based - reads from fiber-local state.
 *
 * @remarks
 * Use this when custom debug helpers or plugins need the same trace metadata the
 * framework attaches to logged events.
 *
 * @example
 * ```ts
 * const context = yield* Debug.getTraceContext
 * ```
 *
 * @category Debugging
 * @public
 * @since 1.0.0
 */
export const getTraceContext: Effect.Effect<TraceContext> = Effect.gen(function* () {
  const traceId = yield* getReference(CurrentTraceId);
  const spanId = yield* getReference(CurrentSpanId);
  const parentSpanId = yield* getReference(CurrentParentSpanId);

  return {
    ...(traceId !== undefined ? { traceId } : {}),
    ...(spanId !== undefined ? { spanId } : {}),
    ...(parentSpanId !== undefined ? { parentSpanId } : {}),
  };
});

/**
 * Set the current trace ID.
 * Called by router on navigate to start a new trace.
 *
 * @remarks
 * Advanced integrations can call this when work should join an existing trace
 * or begin a new one outside the router.
 *
 * @example
 * ```ts
 * yield* Debug.setTraceId("trace_1")
 * ```
 *
 * @category Debugging
 * @public
 * @since 1.0.0
 */
export const setTraceId = (traceId: string): Effect.Effect<void> =>
  setReference(CurrentTraceId, traceId);

/**
 * Clear the current trace context.
 *
 * @remarks
 * Use this when a unit of work should stop inheriting previously established
 * trace or span metadata.
 *
 * @example
 * ```ts
 * yield* Debug.clearTraceContext
 * ```
 *
 * @category Debugging
 * @public
 * @since 1.0.0
 */
export const clearTraceContext: Effect.Effect<void> = Effect.gen(function* () {
  yield* setReference(CurrentTraceId, undefined);
  yield* setReference(CurrentSpanId, undefined);
  yield* setReference(CurrentParentSpanId, undefined);
});

// --- Enable/Disable API ---

/**
 * Enable debug logging.
 * Called internally by DevMode component.
 *
 * @remarks
 * Call this directly when debugging should be enabled without mounting
 * `DevMode`, for example in tests or non-JSX tooling.
 *
 * @param filter - Optional filter for event types
 *   - undefined: log all events
 *   - string: log events matching prefix (e.g., "signal" matches "signal.set")
 *   - string[]: log events matching any prefix
 *
 * @example
 * ```ts
 * Debug.enable(["signal", "trace"])
 * ```
 *
 * @category Debugging
 * @public
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
 *
 * @remarks
 * This resets both the enabled flag and the current prefix filter.
 *
 * @example
 * ```ts
 * Debug.disable()
 * ```
 *
 * @category Debugging
 * @public
 */
export const disable = (): void => {
  _enabled = false;
  _filter = null;
};

/**
 * Check if debug logging is enabled.
 *
 * @remarks
 * Useful for tests and custom tooling that need to assert or branch on current
 * debug state.
 *
 * @example
 * ```ts
 * const enabled = Debug.isEnabled()
 * ```
 *
 * @category Debugging
 * @public
 */
export const isEnabled = (): boolean => _enabled;

/**
 * Get current filter configuration.
 *
 * @remarks
 * Returns `null` when debug is enabled for all events.
 *
 * @example
 * ```ts
 * const filter = Debug.getFilter()
 * ```
 *
 * @category Debugging
 * @public
 */
export const getFilter = (): ReadonlyArray<string> | null => {
  return _filter !== null ? Array.from(_filter) : null;
};

// --- Plugin Registration ---

/**
 * Register a debug plugin.
 * Plugins receive all events that pass the current filter.
 * Multiple plugins can be registered; each receives events independently.
 *
 * @remarks
 * Register plugins imperatively when debug output should be wired outside
 * `DevMode`.
 *
 * @example
 * ```ts
 * Debug.registerPlugin(Debug.consolePlugin)
 * ```
 *
 * @category Debugging
 * @public
 * @since 1.0.0
 */
export const registerPlugin = (plugin: DebugPlugin): void => {
  _plugins.set(plugin.name, plugin);
};

/**
 * Unregister a debug plugin by name.
 *
 * @remarks
 * Use the plugin's `name` field to remove it from the global registry.
 *
 * @example
 * ```ts
 * Debug.unregisterPlugin("console")
 * ```
 *
 * @category Debugging
 * @public
 * @since 1.0.0
 */
export const unregisterPlugin = (name: string): void => {
  _plugins.delete(name);
};

/**
 * Get all registered plugin names.
 *
 * @remarks
 * Useful in tests and setup code that need to inspect or reset the plugin
 * registry.
 *
 * @example
 * ```ts
 * const names = Debug.getPlugins()
 * ```
 *
 * @category Debugging
 * @public
 * @since 1.0.0
 */
export const getPlugins = (): ReadonlyArray<string> => {
  return Array.from(_plugins.keys());
};

/**
 * Check if a plugin is registered.
 *
 * @remarks
 * This is a convenience query over the global plugin registry.
 *
 * @example
 * ```ts
 * const hasConsole = Debug.hasPlugin("console")
 * ```
 *
 * @category Debugging
 * @public
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
  if ("phase" in e) parts.push(`phase:${e.phase}`);
  if ("current_keys" in e) parts.push(`keys:${e.current_keys}`);
  if ("total_items" in e) parts.push(`items:${e.total_items}`);
  if ("moves" in e) parts.push(`moves:${e.moves}`);
  if ("stable_nodes" in e) parts.push(`stable:${e.stable_nodes}`);
  if ("move_count" in e && e.move_count !== undefined) parts.push(`move_count:${e.move_count}`);
  if ("key_order" in e && Array.isArray(e.key_order)) {
    parts.push(`order:[${e.key_order.map(String).join(",")}]`);
  }
  if ("new_keys" in e && Array.isArray(e.new_keys)) {
    parts.push(`new:[${e.new_keys.map(String).join(",")}]`);
  }
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
 *
 * @remarks
 * Include this plugin explicitly when custom plugin lists should still preserve
 * human-readable console output.
 *
 * @example
 * ```ts
 * Debug.registerPlugin(Debug.consolePlugin)
 * ```
 *
 * @category Debugging
 * @public
 * @since 1.0.0
 */
export const consolePlugin: DebugPlugin = createPlugin("console", formatEvent);

/**
 * Create a custom plugin that collects events into an array.
 * Useful for testing or building custom event processors.
 *
 * @remarks
 * This is the simplest way to capture debug events for assertions.
 *
 * @example
 * ```ts
 * const plugin = Debug.createCollectorPlugin("capture", [])
 * ```
 *
 * @category Debugging
 * @public
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
 * Reads trace context from references and dispatches to plugins.
 * No-op if debug is disabled or event is filtered out.
 *
 * @remarks
 * Use this for custom instrumentation that should flow through the same plugin
 * and filtering pipeline as framework-generated events.
 *
 * @example
 * ```ts
 * yield* Debug.log({ event: "trace.span.start", name: "custom" })
 * ```
 *
 * @category Debugging
 * @public
 * @since 1.0.0
 */
export const log: (event: LogInput) => Effect.Effect<void> = Effect.fnUntraced(function* (
  event: LogInput,
) {
  if (!shouldLog(event.event)) return;

  // Read trace context from references
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
 *
 * @remarks
 * Prefer `withSpan` for most callers. Use `startSpan` directly when span start
 * and end need to be separated across a larger control flow.
 *
 * @example
 * ```ts
 * const endSpan = yield* Debug.startSpan("load-user")
 * ```
 *
 * @category Debugging
 * @public
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
  const previousSpanId = yield* getReference(CurrentSpanId);
  const previousParentSpanId = yield* getReference(CurrentParentSpanId);

  // Set new span as current, with previous span as parent
  yield* setReference(CurrentParentSpanId, previousSpanId);
  yield* setReference(CurrentSpanId, newSpanId);

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
        setReference(CurrentSpanId, previousSpanId),
        setReference(CurrentParentSpanId, previousParentSpanId),
      ],
      { discard: true },
    ),
  );
});

/**
 * Run an effect within a span.
 * Automatically ends the span when the effect completes or fails.
 *
 * @remarks
 * This is the main public helper for attaching span boundaries to existing
 * Effects.
 *
 * @example
 * ```ts
 * const result = yield* Debug.withSpan("load-user", userEffect)
 * ```
 *
 * @category Debugging
 * @public
 * @since 1.0.0
 */
export const withSpan = <A, E, R>(
  name: string,
  effect: Effect.Effect<A, E, R>,
  attributes?: Record<string, unknown>,
): Effect.Effect<A, E, R> =>
  Effect.gen(function* () {
    const newSpanId = nextSpanId();
    const previousSpanId = yield* getReference(CurrentSpanId);
    const previousParentSpanId = yield* getReference(CurrentParentSpanId);

    // Set new span as current
    yield* setReference(CurrentParentSpanId, previousSpanId);
    yield* setReference(CurrentSpanId, newSpanId);

    yield* log({
      event: "trace.span.start",
      name,
      ...(attributes !== undefined ? { attributes } : {}),
    });

    return yield* effect.pipe(
      Effect.tap(() =>
        log({
          event: "trace.span.end",
          name,
          status: "ok",
        }),
      ),
      Effect.tapError((error) =>
        log({
          event: "trace.span.end",
          name,
          status: "error",
          error: String(error),
        }),
      ),
      Effect.ensuring(
        Effect.all(
          [
            setReference(CurrentSpanId, previousSpanId),
            setReference(CurrentParentSpanId, previousParentSpanId),
          ],
          { discard: true },
        ),
      ),
    );
  });

/**
 * Measure duration of an effect and log it.
 * No-op if debug is disabled or event is filtered out.
 *
 * @remarks
 * Use this when custom instrumentation should emit the same `duration_ms`
 * field shape as framework timing events.
 *
 * @example
 * ```ts
 * const result = yield* Debug.measure({ event: "trace.span.end", name: "custom" }, work)
 * ```
 *
 * @category Debugging
 * @public
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
 *
 * @example
 * ```typescript
 * Effect.provide(myEffect, Debug.defaultLayer)
 * ```
 *
 * @remarks
 * Provide this layer when console logging should be enabled through Effect layer
 * wiring instead of imperative plugin registration.
 *
 * @category Debugging
 * @public
 * @since 1.0.0
 */
export const defaultLayer: Layer.Layer<never> = Layer.effectDiscard(
  Effect.gen(function* () {
    registerPlugin(consolePlugin);

    yield* Effect.addFinalizer(() =>
      Effect.sync(() => {
        unregisterPlugin(consolePlugin.name);
      }),
    );
  }),
);
