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

/** Event types for categorization */
export type EventType =
  | "signal.create"
  | "signal.get"
  | "signal.set"
  | "signal.set.skipped"
  | "signal.update"
  | "signal.update.skipped"
  | "signal.notify"
  | "signal.subscribe"
  | "signal.unsubscribe"
  | "render.component.initial"
  | "render.component.rerender"
  | "render.component.cleanup"
  | "render.signaltext.initial"
  | "render.signaltext.update"
  | "render.intrinsic"
  | "render.schedule"
  | "render.keyedlist.update"
  | "render.keyedlist.item.add"
  | "render.keyedlist.item.remove"
  | "render.keyedlist.item.rerender"
  | "signal.get.phase"

/** Wide event structure */
export interface DebugEvent {
  readonly timestamp: string
  readonly event: EventType
  readonly component?: string
  readonly signal_id?: string
  readonly value?: unknown
  readonly prev_value?: unknown
  readonly listener_count?: number
  readonly accessed_signals?: number
  readonly is_rerendering?: boolean
  readonly pending_rerender?: boolean
  readonly trigger?: string
  readonly duration_ms?: number
  readonly element_tag?: string
  readonly reason?: string
  readonly current_keys?: number
  readonly key?: string | number
  readonly has_phase?: boolean
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
 * Initialize debug state from environment (URL params, localStorage).
 * Called automatically on module load in browser.
 * This is the "escape hatch" for debugging without code changes.
 */
export const initFromEnvironment = (): void => {
  if (typeof window === "undefined") return

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
  return "#95a5a6" // gray
}

/**
 * Log a wide event.
 * No-op if debug is disabled or event is filtered out.
 */
export const log = (event: Omit<DebugEvent, "timestamp">): void => {
  if (!shouldLog(event.event)) return

  const fullEvent: DebugEvent = {
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
  eventType: EventType,
  context: Omit<DebugEvent, "timestamp" | "event" | "duration_ms">,
  fn: () => T
): T => {
  if (!shouldLog(eventType)) return fn()

  const start = performance.now()
  const result = fn()
  const duration_ms = performance.now() - start

  log({ event: eventType, ...context, duration_ms })
  return result
}

// --- Auto-initialize from environment ---

// Only auto-init in browser and only once
if (typeof window !== "undefined") {
  initFromEnvironment()
}
