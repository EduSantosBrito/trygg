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

/** Base fields for all events */
interface BaseEvent {
  readonly timestamp: string
  readonly duration_ms?: number
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
  // Render events
  | RenderComponentInitialEvent
  | RenderComponentRerenderEvent
  | RenderComponentCleanupEvent
  | RenderSignalTextInitialEvent
  | RenderSignalTextUpdateEvent
  | RenderIntrinsicEvent
  | RenderScheduleEvent
  | RenderKeyedListUpdateEvent
  | RenderKeyedListItemAddEvent
  | RenderKeyedListItemRemoveEvent
  | RenderKeyedListItemRerenderEvent
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

// --- Internal State ---

let _enabled = false
let _filter: Set<string> | null = null

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
  if (event.startsWith("render.intrinsic")) return "#3498db" // blue
  if (event.startsWith("render.schedule")) return "#f39c12" // orange
  if (event.startsWith("render.keyedlist")) return "#16a085" // teal
  if (event.startsWith("router")) return "#e91e63" // pink
  return "#95a5a6" // gray
}

/**
 * Log a wide event.
 * No-op if debug is disabled or event is filtered out.
 */
export const log = (event: LogInput): void => {
  if (!shouldLog(event.event)) return

  const fullEvent = {
    timestamp: new Date().toISOString(),
    ...event
  }

  const color = getColor(event.event)

  // eslint-disable-next-line no-console
  console.log(
    `%c[effectui]%c ${event.event}`,
    `color: ${color}; font-weight: bold`,
    "color: inherit",
    fullEvent
  )
}

/**
 * Measure duration of an operation and log it.
 * No-op if debug is disabled or event is filtered out.
 */
export const measure = <T>(
  event: LogInput,
  fn: () => T
): T => {
  if (!shouldLog(event.event)) return fn()

  const start = performance.now()
  const result = fn()
  const duration_ms = performance.now() - start

  log({ ...event, duration_ms })
  return result
}

// --- Auto-initialize from environment ---

// Only auto-init in browser and only once
if (typeof window !== "undefined") {
  initFromEnvironment()
}
