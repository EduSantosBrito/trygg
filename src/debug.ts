/**
 * @since 1.0.0
 * Debug logging for effect-ui
 *
 * Uses wide event pattern - one structured log per operation with full context.
 * Enable by adding <DevMode /> component to your app.
 *
 * @example
 * ```tsx
 * import { mount, DevMode } from "effect-ui"
 *
 * mount(container, <>
 *   {App}
 *   <DevMode />
 * </>)
 * ```
 */
import { Effect, FiberRef, Layer, Runtime } from "effect"
import type { TestServerConfig } from "./test-server.js"
import { TestServer } from "./test-server.js"

/** Base fields for all events */
interface BaseEvent {
  readonly timestamp: string
  readonly duration_ms?: number
  /** Trace ID for correlating events across a navigation flow */
  readonly traceId?: string
  /** Span ID for tracking nested operations within a trace */
  readonly spanId?: string
  /** Parent span ID for building span hierarchies */
  readonly parentSpanId?: string
}

/** Signal events */
type SignalCreateEvent = BaseEvent & {
  readonly event: "signal.create"
  readonly signal_id: string
  readonly value: unknown
  readonly component: string
}

type SignalGetEvent = BaseEvent & {
  readonly event: "signal.get"
  readonly signal_id: string
  readonly trigger: string
}

type SignalGetPhaseEvent = BaseEvent & {
  readonly event: "signal.get.phase"
  readonly signal_id: string
  readonly has_phase: boolean
}

type SignalSetEvent = BaseEvent & {
  readonly event: "signal.set"
  readonly signal_id: string
  readonly prev_value: unknown
  readonly value: unknown
  readonly listener_count: number
}

type SignalSetSkippedEvent = BaseEvent & {
  readonly event: "signal.set.skipped"
  readonly signal_id: string
  readonly value: unknown
  readonly reason: string
}

type SignalUpdateEvent = BaseEvent & {
  readonly event: "signal.update"
  readonly signal_id: string
  readonly prev_value: unknown
  readonly value: unknown
  readonly listener_count: number
}

type SignalUpdateSkippedEvent = BaseEvent & {
  readonly event: "signal.update.skipped"
  readonly signal_id: string
  readonly value: unknown
  readonly reason: string
}

type SignalNotifyEvent = BaseEvent & {
  readonly event: "signal.notify"
  readonly signal_id: string
  readonly listener_count: number
}

type SignalSubscribeEvent = BaseEvent & {
  readonly event: "signal.subscribe"
  readonly signal_id: string
  readonly listener_count: number
}

type SignalUnsubscribeEvent = BaseEvent & {
  readonly event: "signal.unsubscribe"
  readonly signal_id: string
  readonly listener_count: number
}

/** F-003: Signal listener error event for error isolation */
type SignalListenerErrorEvent = BaseEvent & {
  readonly event: "signal.listener.error"
  readonly signal_id: string
  readonly cause: string
  readonly listener_index: number
}

type SignalDeriveCreateEvent = BaseEvent & {
  readonly event: "signal.derive.create"
  readonly signal_id: string
  readonly source_id: string
  readonly value: unknown
}

type SignalDeriveCleanupEvent = BaseEvent & {
  readonly event: "signal.derive.cleanup"
  readonly signal_id: string
  readonly source_id: string
}

/** Render events */
type RenderComponentInitialEvent = BaseEvent & {
  readonly event: "render.component.initial"
  readonly accessed_signals: number
}

type RenderComponentRerenderEvent = BaseEvent & {
  readonly event: "render.component.rerender"
  readonly trigger: string
  readonly accessed_signals: number
}

type RenderComponentCleanupEvent = BaseEvent & {
  readonly event: "render.component.cleanup"
}

type RenderSignalTextInitialEvent = BaseEvent & {
  readonly event: "render.signaltext.initial"
  readonly signal_id: string
  readonly value: unknown
}

type RenderSignalTextUpdateEvent = BaseEvent & {
  readonly event: "render.signaltext.update"
  readonly signal_id: string
  readonly value: unknown
}

type RenderSignalElementInitialEvent = BaseEvent & {
  readonly event: "render.signalelement.initial"
  readonly signal_id: string
}

type RenderSignalElementSwapEvent = BaseEvent & {
  readonly event: "render.signalelement.swap"
  readonly signal_id: string
}

type RenderIntrinsicEvent = BaseEvent & {
  readonly event: "render.intrinsic"
  readonly element_tag: string
}

type RenderScheduleEvent = BaseEvent & {
  readonly event: "render.schedule"
  readonly is_rerendering: boolean
  readonly pending_rerender: boolean
}

type RenderKeyedListUpdateEvent = BaseEvent & {
  readonly event: "render.keyedlist.update"
  readonly current_keys: number
}

type RenderKeyedListItemAddEvent = BaseEvent & {
  readonly event: "render.keyedlist.item.add"
  readonly key: string | number
}

type RenderKeyedListItemRemoveEvent = BaseEvent & {
  readonly event: "render.keyedlist.item.remove"
  readonly key: string | number
}

type RenderKeyedListItemRerenderEvent = BaseEvent & {
  readonly event: "render.keyedlist.item.rerender"
  readonly key: string | number
}

type RenderKeyedListSubscriptionAddEvent = BaseEvent & {
  readonly event: "render.keyedlist.subscription.add"
  readonly key: string | number
  readonly signal_id: string
}

type RenderKeyedListSubscriptionRemoveEvent = BaseEvent & {
  readonly event: "render.keyedlist.subscription.remove"
  readonly key: string | number
  readonly signal_id: string
}

type RenderKeyedListReorderEvent = BaseEvent & {
  readonly event: "render.keyedlist.reorder"
  readonly total_items: number
  readonly moves: number
  readonly stable_nodes: number
}

/** Suspense events */
type RenderSuspenseStartEvent = BaseEvent & {
  readonly event: "render.suspense.start"
  readonly parent_type: string
  readonly parent_connected: boolean
}

type RenderSuspenseFallbackEvent = BaseEvent & {
  readonly event: "render.suspense.fallback"
  readonly node_type: string
  readonly node_connected: boolean
}

type RenderSuspenseWaitStartEvent = BaseEvent & {
  readonly event: "render.suspense.wait.start"
}

type RenderSuspenseDeferredResolvedEvent = BaseEvent & {
  readonly event: "render.suspense.deferred.resolved"
  readonly element_tag: string
}

type RenderSuspenseActualParentEvent = BaseEvent & {
  readonly event: "render.suspense.actual_parent"
  readonly has_parent: boolean
  readonly parent_type: string
  readonly placeholder_connected: boolean
}

type RenderSuspenseSkipUnmountedEvent = BaseEvent & {
  readonly event: "render.suspense.skip.unmounted"
}

type RenderSuspenseFallbackCleanedEvent = BaseEvent & {
  readonly event: "render.suspense.fallback.cleaned"
}

type RenderSuspenseResolvedRenderedEvent = BaseEvent & {
  readonly event: "render.suspense.resolved.rendered"
  readonly node_type: string
  readonly node_connected: boolean
}

type RenderSuspenseErrorEvent = BaseEvent & {
  readonly event: "render.suspense.error"
  readonly suspense_id: string
  readonly error: string
}

/** Router events */
type RouterNavigateEvent = BaseEvent & {
  readonly event: "router.navigate"
  readonly from_path: string
  readonly to_path: string
  readonly replace?: boolean
}

type RouterNavigateCompleteEvent = BaseEvent & {
  readonly event: "router.navigate.complete"
  readonly path: string
}

type RouterMatchEvent = BaseEvent & {
  readonly event: "router.match"
  readonly path: string
  readonly route_pattern: string
  readonly params: Record<string, string>
}

type RouterMatchNotFoundEvent = BaseEvent & {
  readonly event: "router.match.notfound"
  readonly path: string
}

type RouterGuardStartEvent = BaseEvent & {
  readonly event: "router.guard.start"
  readonly route_pattern: string
  readonly has_guard: boolean
}

type RouterGuardAllowEvent = BaseEvent & {
  readonly event: "router.guard.allow"
  readonly route_pattern: string
}

type RouterGuardRedirectEvent = BaseEvent & {
  readonly event: "router.guard.redirect"
  readonly route_pattern: string
  readonly redirect_to: string
}

type RouterGuardSkipEvent = BaseEvent & {
  readonly event: "router.guard.skip"
  readonly route_pattern: string
  readonly reason: string
}

type RouterRenderStartEvent = BaseEvent & {
  readonly event: "router.render.start"
  readonly route_pattern: string
  readonly params: Record<string, string>
  readonly has_guard: boolean
  readonly has_layout: boolean
}

type RouterRenderCompleteEvent = BaseEvent & {
  readonly event: "router.render.complete"
  readonly route_pattern: string
  readonly has_layout: boolean
}

type RouterLinkClickEvent = BaseEvent & {
  readonly event: "router.link.click"
  readonly to_path: string
  readonly replace?: boolean
  readonly reason?: string
}

type RouterErrorEvent = BaseEvent & {
  readonly event: "router.error"
  readonly route_pattern: string
  readonly error: string
}

type RouterPopstateAddedEvent = BaseEvent & {
  readonly event: "router.popstate.added"
}

type RouterPopstateRemovedEvent = BaseEvent & {
  readonly event: "router.popstate.removed"
}

type RouterMatcherCompileEvent = BaseEvent & {
  readonly event: "router.matcher.compile"
  readonly route_count: number
  readonly is_recompile: boolean
}

type RouterMatcherCachedEvent = BaseEvent & {
  readonly event: "router.matcher.cached"
  readonly route_count: number
}

type Router404RenderEvent = BaseEvent & {
  readonly event: "router.404.render"
  readonly path: string
  readonly has_custom_404: boolean
}

type Router404FallbackEvent = BaseEvent & {
  readonly event: "router.404.fallback"
  readonly path: string
  readonly has_custom_404: boolean
}

/** F-002: Route load cancellation event */
type RouterLoadCancelledEvent = BaseEvent & {
  readonly event: "router.load.cancelled"
  readonly from_key: string
  readonly to_key: string
}

/** F-001: Module loading events for parallel loading with memoization */
type RouterModuleLoadStartEvent = BaseEvent & {
  readonly event: "router.module.load.start"
  readonly path: string
  readonly kind: "component" | "layout" | "guard" | "loading" | "error" | "not_found"
  readonly is_prefetch: boolean
  readonly attempt: number
}

type RouterModuleLoadCompleteEvent = BaseEvent & {
  readonly event: "router.module.load.complete"
  readonly path: string
  readonly kind: "component" | "layout" | "guard" | "loading" | "error" | "not_found"
  readonly duration_ms: number
  readonly is_prefetch: boolean
  readonly attempt: number
}

type RouterModuleLoadTimeoutEvent = BaseEvent & {
  readonly event: "router.module.load.timeout"
  readonly path: string
  readonly kind: "component" | "layout" | "guard" | "loading" | "error" | "not_found"
  readonly timeout_ms: number
  readonly is_prefetch: boolean
  readonly attempt: number
}

type RouterModuleLoadCacheHitEvent = BaseEvent & {
  readonly event: "router.module.load.cache_hit"
  readonly path: string
  readonly kind: "component" | "layout" | "guard" | "loading" | "error" | "not_found"
  readonly is_prefetch: boolean
}

type RouterPrefetchStartEvent = BaseEvent & {
  readonly event: "router.prefetch.start"
  readonly path: string
  readonly route_pattern: string
  readonly module_count: number
}

type RouterPrefetchCompleteEvent = BaseEvent & {
  readonly event: "router.prefetch.complete"
  readonly path: string
}

type RouterPrefetchNoMatchEvent = BaseEvent & {
  readonly event: "router.prefetch.no_match"
  readonly path: string
}

/** F-001: Viewport prefetch trigger event */
type RouterPrefetchViewportEvent = BaseEvent & {
  readonly event: "router.prefetch.viewport"
  readonly path: string
}

/** F-001: Viewport observer lifecycle events */
type RouterViewportObserverAddedEvent = BaseEvent & {
  readonly event: "router.viewport.observer.added"
}

type RouterViewportObserverRemovedEvent = BaseEvent & {
  readonly event: "router.viewport.observer.removed"
}

/** Trace events for correlation and span tracking */
type TraceSpanStartEvent = BaseEvent & {
  readonly event: "trace.span.start"
  readonly name: string
  readonly attributes?: Record<string, unknown>
}

type TraceSpanEndEvent = BaseEvent & {
  readonly event: "trace.span.end"
  readonly name: string
  readonly status: "ok" | "error"
  readonly error?: string
}

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
  // Render events
  | RenderComponentInitialEvent
  | RenderComponentRerenderEvent
  | RenderComponentCleanupEvent
  | RenderSignalTextInitialEvent
  | RenderSignalTextUpdateEvent
  | RenderSignalElementInitialEvent
  | RenderSignalElementSwapEvent
  | RenderIntrinsicEvent
  | RenderScheduleEvent
  | RenderKeyedListUpdateEvent
  | RenderKeyedListItemAddEvent
  | RenderKeyedListItemRemoveEvent
  | RenderKeyedListItemRerenderEvent
  | RenderKeyedListSubscriptionAddEvent
  | RenderKeyedListSubscriptionRemoveEvent
  | RenderKeyedListReorderEvent
  // Suspense events
  | RenderSuspenseStartEvent
  | RenderSuspenseFallbackEvent
  | RenderSuspenseWaitStartEvent
  | RenderSuspenseDeferredResolvedEvent
  | RenderSuspenseActualParentEvent
  | RenderSuspenseSkipUnmountedEvent
  | RenderSuspenseFallbackCleanedEvent
  | RenderSuspenseResolvedRenderedEvent
  | RenderSuspenseErrorEvent
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
  // Trace events
  | TraceSpanStartEvent
  | TraceSpanEndEvent

/** Extract event type from DebugEvent */
export type EventType = DebugEvent["event"]

/** 
 * Loose input type for log function.
 * Accepts any event with optional fields - the discriminated union above
 * documents the expected shape for each event type.
 */
export type LogInput = {
  readonly event: EventType
  readonly duration_ms?: number
  // Allow any additional fields
  readonly [key: string]: unknown
}

/** Trace context structure */
export interface TraceContext {
  readonly traceId?: string
  readonly spanId?: string
  readonly parentSpanId?: string
}

// --- Plugin System ---

/**
 * Debug plugin interface.
 * Plugins receive structured events and can output them to any destination.
 * @since 1.0.0
 */
export interface DebugPlugin {
  /** Unique plugin identifier */
  readonly name: string
  
  /**
   * Handle a debug event.
   * Called for each event that passes the current filter.
   * Errors thrown here are caught and logged to console.error
   * to prevent one plugin from breaking others.
   */
  readonly handle: (event: DebugEvent) => void
}

/**
 * Create a debug plugin.
 * Helper function for constructing type-safe plugins.
 * @since 1.0.0
 */
export const createPlugin = (
  name: string,
  handle: (event: DebugEvent) => void
): DebugPlugin => ({ name, handle })

// --- Internal State ---

let _enabled = false
let _filter: Set<string> | null = null
const _plugins: Map<string, DebugPlugin> = new Map()

// --- Signal ID Generation ---

/** Generate unique signal ID for tracking */
let signalCounter = 0
export const nextSignalId = (): string => `sig_${++signalCounter}`

/** Store signal IDs on signal objects */
const signalIds = new WeakMap<object, string>()

export const getSignalId = (signal: object): string => {
  let id = signalIds.get(signal)
  if (id === undefined) {
    id = nextSignalId()
    signalIds.set(signal, id)
  }
  return id
}

// --- Trace ID Generation ---

/** Generate unique trace ID for correlating events across a navigation flow */
let traceCounter = 0
export const nextTraceId = (): string => `trace_${++traceCounter}`

/** Generate unique span ID for tracking nested operations */
let spanCounter = 0
export const nextSpanId = (): string => `span_${++spanCounter}`

// --- Trace Context FiberRefs ---

/**
 * FiberRef for current trace ID.
 * Set by router on navigate, propagated through Effect context.
 * @since 1.0.0
 */
export const CurrentTraceId: FiberRef.FiberRef<string | undefined> = 
  FiberRef.unsafeMake<string | undefined>(undefined)

/**
 * FiberRef for current span ID.
 * Set by startSpan, propagated through Effect context.
 * @since 1.0.0
 */
export const CurrentSpanId: FiberRef.FiberRef<string | undefined> = 
  FiberRef.unsafeMake<string | undefined>(undefined)

/**
 * FiberRef for parent span ID.
 * Used for building span hierarchies.
 * @since 1.0.0
 */
export const CurrentParentSpanId: FiberRef.FiberRef<string | undefined> = 
  FiberRef.unsafeMake<string | undefined>(undefined)

/**
 * Get current trace context from FiberRefs.
 * Effect-based - reads from fiber-local state.
 * @since 1.0.0
 */
export const getTraceContext: Effect.Effect<TraceContext> = Effect.gen(function* () {
  const traceId = yield* FiberRef.get(CurrentTraceId)
  const spanId = yield* FiberRef.get(CurrentSpanId)
  const parentSpanId = yield* FiberRef.get(CurrentParentSpanId)
  
  const ctx: TraceContext = {}
  if (traceId !== undefined) (ctx as { traceId: string }).traceId = traceId
  if (spanId !== undefined) (ctx as { spanId: string }).spanId = spanId
  if (parentSpanId !== undefined) (ctx as { parentSpanId: string }).parentSpanId = parentSpanId
  return ctx
})

/**
 * Set the current trace ID.
 * Called by router on navigate to start a new trace.
 * @since 1.0.0
 */
export const setTraceId = (traceId: string): Effect.Effect<void> =>
  FiberRef.set(CurrentTraceId, traceId)

/**
 * Clear the current trace context.
 * @since 1.0.0
 */
export const clearTraceContext: Effect.Effect<void> = Effect.gen(function* () {
  yield* FiberRef.set(CurrentTraceId, undefined)
  yield* FiberRef.set(CurrentSpanId, undefined)
  yield* FiberRef.set(CurrentParentSpanId, undefined)
})

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
  _enabled = true
  if (filter === undefined) {
    _filter = null
  } else if (typeof filter === "string") {
    _filter = new Set([filter])
  } else {
    _filter = new Set(filter)
  }
}

/**
 * Disable debug logging.
 * Called internally by DevMode component cleanup.
 */
export const disable = (): void => {
  _enabled = false
  _filter = null
}

/**
 * Check if debug logging is enabled.
 */
export const isEnabled = (): boolean => _enabled

/**
 * Get current filter configuration.
 */
export const getFilter = (): ReadonlyArray<string> | null => {
  return _filter !== null ? Array.from(_filter) : null
}

// --- Plugin Registration ---

/**
 * Register a debug plugin.
 * Plugins receive all events that pass the current filter.
 * Multiple plugins can be registered; each receives events independently.
 * @since 1.0.0
 */
export const registerPlugin = (plugin: DebugPlugin): void => {
  _plugins.set(plugin.name, plugin)
}

/**
 * Unregister a debug plugin by name.
 * @since 1.0.0
 */
export const unregisterPlugin = (name: string): void => {
  _plugins.delete(name)
}

/**
 * Get all registered plugin names.
 * @since 1.0.0
 */
export const getPlugins = (): ReadonlyArray<string> => {
  return Array.from(_plugins.keys())
}

/**
 * Check if a plugin is registered.
 * @since 1.0.0
 */
export const hasPlugin = (name: string): boolean => {
  return _plugins.has(name)
}

// --- Environment Detection ---

/**
 * Check if we're in development mode.
 * Uses import.meta.env.DEV (Vite) or process.env.NODE_ENV.
 * Returns false if we can't determine - fail secure.
 */
const isDevelopment = (): boolean => {
  // Check Vite's import.meta.env.DEV
  try {
    // @ts-expect-error - import.meta.env may not be typed
    if (typeof import.meta !== "undefined" && import.meta.env?.DEV === true) {
      return true
    }
  } catch {
    // import.meta not available
  }
  
  // Check Node.js process.env.NODE_ENV
  try {
    if (typeof process !== "undefined" && process.env?.NODE_ENV === "development") {
      return true
    }
  } catch {
    // process not available
  }
  
  // Default to false (secure by default)
  return false
}

/**
 * Initialize debug state from environment (URL params, localStorage).
 * Called automatically on module load in browser.
 * 
 * SECURITY: Only works in development mode. In production, debug must be
 * enabled explicitly via the <DevMode /> component with `enabled` prop.
 */
export const initFromEnvironment = (): void => {
  if (typeof window === "undefined") return
  
  // SECURITY: Only allow environment-based debug in development
  if (!isDevelopment()) return

  // Check URL params first
  const url = new URL(window.location.href)
  const urlDebug = url.searchParams.get("effectui_debug")

  if (urlDebug !== null) {
    // URL param present
    if (urlDebug === "" || urlDebug === "true") {
      enable()
    } else {
      enable(urlDebug.split(","))
    }
    // Persist to localStorage for convenience
    if (typeof localStorage !== "undefined") {
      localStorage.setItem("effectui_debug", urlDebug || "true")
    }
    return
  }

  // Check localStorage
  if (typeof localStorage !== "undefined") {
    const stored = localStorage.getItem("effectui_debug")
    if (stored !== null) {
      if (stored === "true" || stored === "") {
        enable()
      } else {
        enable(stored.split(","))
      }
    }
  }
}

// --- Logging ---

/**
 * Check if an event should be logged based on current filter.
 */
const shouldLog = (event: EventType): boolean => {
  if (!_enabled) return false
  if (_filter === null) return true

  // Check if event matches any filter prefix
  for (const prefix of _filter) {
    if (event === prefix || event.startsWith(prefix + ".")) {
      return true
    }
  }
  return false
}

/** Color mapping for event categories */
const getColor = (event: EventType): string => {
  if (event.startsWith("signal")) return "#9b59b6" // purple
  if (event.startsWith("render.component")) return "#e74c3c" // red
  if (event.startsWith("render.signaltext")) return "#27ae60" // green
  if (event.startsWith("render.signalelement")) return "#2ecc71" // bright green (distinct from signaltext)
  if (event.startsWith("render.intrinsic")) return "#3498db" // blue
  if (event.startsWith("render.schedule")) return "#f39c12" // orange
  if (event.startsWith("render.keyedlist")) return "#16a085" // teal
  if (event.startsWith("router")) return "#e91e63" // pink
  if (event.startsWith("trace")) return "#00bcd4" // cyan
  return "#95a5a6" // gray
}

// --- Built-in Plugins ---

/**
 * Console plugin - outputs events to browser console with color coding.
 * This is the default plugin used when no custom plugins are registered.
 * @since 1.0.0
 */
export const consolePlugin: DebugPlugin = createPlugin(
  "console",
  (event: DebugEvent) => {
    const color = getColor(event.event)
    // eslint-disable-next-line no-console
    console.log(
      `%c[effectui]%c ${event.event}`,
      `color: ${color}; font-weight: bold`,
      "color: inherit",
      event
    )
  }
)

/**
 * Create a custom plugin that collects events into an array.
 * Useful for testing or building custom event processors.
 * @since 1.0.0
 */
export const createCollectorPlugin = (
  name: string,
  events: DebugEvent[]
): DebugPlugin => createPlugin(name, (event) => {
  events.push(event)
})

/**
 * Internal: dispatch event to plugins (sync operation).
 */
const dispatchToPlugins = (fullEvent: DebugEvent): void => {
  if (_plugins.size > 0) {
    for (const plugin of _plugins.values()) {
      try {
        plugin.handle(fullEvent)
      } catch (error) {
        // Isolate plugin errors - one failing plugin shouldn't break others
        // eslint-disable-next-line no-console
        console.error(`[effectui] Plugin "${plugin.name}" error:`, error)
      }
    }
  } else {
    // Default: use console plugin when no plugins registered
    consolePlugin.handle(fullEvent)
  }
}

/**
 * Log a wide event (Effect-based).
 * Reads trace context from FiberRefs and dispatches to plugins.
 * No-op if debug is disabled or event is filtered out.
 * @since 1.0.0
 */
export const log: (event: LogInput) => Effect.Effect<void> = Effect.fnUntraced(
  function* (event: LogInput) {
    if (!shouldLog(event.event)) return

    // Read trace context from FiberRefs
    const traceContext = yield* getTraceContext
    
    const fullEvent = {
      timestamp: new Date().toISOString(),
      ...traceContext,
      ...event
    } as DebugEvent

    dispatchToPlugins(fullEvent)
  }
)



/**
 * Start a new span within the current trace.
 * Returns an Effect that yields a function to end the span.
 * @since 1.0.0
 */
export const startSpan: (
  name: string, 
  attributes?: Record<string, unknown>
) => Effect.Effect<Effect.Effect<void>> = Effect.fnUntraced(
  function* (name: string, attributes?: Record<string, unknown>) {
    const newSpanId = nextSpanId()
    const previousSpanId = yield* FiberRef.get(CurrentSpanId)
    const previousParentSpanId = yield* FiberRef.get(CurrentParentSpanId)
    
    // Set new span as current, with previous span as parent
    yield* FiberRef.set(CurrentParentSpanId, previousSpanId)
    yield* FiberRef.set(CurrentSpanId, newSpanId)
    
    yield* log({
      event: "trace.span.start",
      name,
      ...(attributes !== undefined ? { attributes } : {})
    })
    
    // Return Effect to end span (intentionally returns Effect for later execution)
    return yield* Effect.succeed(
      Effect.all([
        log({ event: "trace.span.end", name, status: "ok" }),
        FiberRef.set(CurrentSpanId, previousSpanId),
        FiberRef.set(CurrentParentSpanId, previousParentSpanId)
      ], { discard: true })
    )
  }
)

/**
 * Run an effect within a span.
 * Automatically ends the span when the effect completes or fails.
 * @since 1.0.0
 */
export const withSpan = <A, E, R>(
  name: string,
  effect: Effect.Effect<A, E, R>,
  attributes?: Record<string, unknown>
): Effect.Effect<A, E, R> =>
  Effect.fnUntraced(function* () {
    const newSpanId = nextSpanId()
    const previousSpanId = yield* FiberRef.get(CurrentSpanId)
    const previousParentSpanId = yield* FiberRef.get(CurrentParentSpanId)
    
    // Set new span as current
    yield* FiberRef.set(CurrentParentSpanId, previousSpanId)
    yield* FiberRef.set(CurrentSpanId, newSpanId)
    
    yield* log({
      event: "trace.span.start",
      name,
      ...(attributes !== undefined ? { attributes } : {})
    })
    
    return yield* effect.pipe(
      Effect.tapBoth({
        onSuccess: () => log({
          event: "trace.span.end",
          name,
          status: "ok"
        }),
        onFailure: (error) => log({
          event: "trace.span.end",
          name,
          status: "error",
          error: String(error)
        })
      }),
      Effect.ensuring(
        Effect.all([
          FiberRef.set(CurrentSpanId, previousSpanId),
          FiberRef.set(CurrentParentSpanId, previousParentSpanId)
        ], { discard: true })
      )
    )
  })()

/**
 * Measure duration of an effect and log it.
 * No-op if debug is disabled or event is filtered out.
 * @since 1.0.0
 */
export const measure = <A, E, R>(
  event: LogInput,
  effect: Effect.Effect<A, E, R>
): Effect.Effect<A, E, R> =>
  Effect.fnUntraced(function* () {
    if (!shouldLog(event.event)) {
      return yield* effect
    }

    const start = performance.now()
    const result = yield* effect
    const duration_ms = performance.now() - start

    yield* log({ ...event, duration_ms })
    return result
  })()

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
    registerPlugin(consolePlugin)
    
    yield* Effect.addFinalizer(() =>
      Effect.sync(() => {
        unregisterPlugin(consolePlugin.name)
      })
    )
  })
)

/**
 * Server layer that starts TestServer and registers its debug plugin.
 * 
 * TestServer captures all debug events to SQLite and exposes an HTTP API
 * for querying logs. LLMs can query this server to observe application behavior.
 * 
 * The TestServer is automatically stopped when the scope closes.
 * 
 * @example
 * ```typescript
 * import { Effect } from "effect"
 * import * as Debug from "effect-ui/debug"
 * import { TestServer } from "effect-ui/test-server"
 * 
 * const program = Effect.gen(function* () {
 *   const server = yield* TestServer
 *   console.log(`Server running at ${server.url}`)
 *   
 *   // Debug.log calls are now captured by TestServer
 *   yield* Debug.log({ event: "signal.set", signal_id: "sig_1", prev_value: 0, value: 1, listener_count: 1 })
 * })
 * 
 * Effect.runPromise(Effect.scoped(program.pipe(Effect.provide(Debug.serverLayer()))))
 * ```
 * 
 * @since 1.0.0
 */
export const serverLayer = (config: TestServerConfig = {}): Layer.Layer<TestServer> =>
  Layer.scoped(
    TestServer,
    Effect.gen(function* () {
      // Dynamic import to avoid bundling test-server in production
      const { startInternal } = yield* Effect.promise(() => import("./test-server.js"))
      const server = yield* startInternal(config)
      const runtime = yield* Effect.runtime<never>()
      
      // Create and register debug plugin
      const plugin = createPlugin("test-server", (event) => {
        Runtime.runSync(runtime)(server.store(event))
      })
      registerPlugin(plugin)
      
      yield* Effect.addFinalizer(() =>
        Effect.sync(() => {
          unregisterPlugin(plugin.name)
        })
      )
      
      return server
    })
  )

// --- Auto-initialize from environment ---

// Only auto-init in browser and only once
if (typeof window !== "undefined") {
  initFromEnvironment()
}
