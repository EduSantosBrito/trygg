/**
 * @since 1.0.0
 * DevMode component for enabling debug observability
 *
 * Add this component to your app to enable wide event logging in the console.
 *
 * @example
 * ```tsx
 * import { mount, DevMode } from "effect-ui"
 *
 * mount(container, <>
 *   <App />
 *   <DevMode />
 * </>)
 * ```
 */
import { Effect } from "effect"
import * as Debug from "../debug/debug.js"
import { Element, empty, componentElement } from "../element.js"

/**
 * Props for the DevMode component
 * @since 1.0.0
 */
export interface DevModeProps {
  /**
   * Filter which events to log.
   * - undefined: log all events
   * - string: log events matching prefix (e.g., "signal" matches "signal.set")
   * - string[]: log events matching any prefix
   *
   * @example
   * ```tsx
   * <DevMode filter="signal" />
   * <DevMode filter={["signal", "render.component"]} />
   * ```
   */
  readonly filter?: string | ReadonlyArray<string>

  /**
   * Whether debug mode is enabled. Defaults to true.
   * Use this for conditional enabling.
   *
   * @example
   * ```tsx
   * <DevMode enabled={import.meta.env.DEV} />
   * ```
   */
  readonly enabled?: boolean

  /**
   * Custom plugins to use for debug output.
   * - undefined: uses the default console plugin
   * - DebugPlugin[]: uses only the specified plugins
   *
   * When plugins are provided, they replace the default console plugin.
   * To include console output alongside custom plugins, include
   * `Debug.consolePlugin` in the array.
   *
   * @example
   * ```tsx
   * // Custom plugin only
   * const events: Debug.DebugEvent[] = []
   * <DevMode plugins={[Debug.createCollectorPlugin("collector", events)]} />
   *
   * // Custom plugin + console
   * <DevMode plugins={[Debug.consolePlugin, myPlugin]} />
   * ```
   */
  readonly plugins?: ReadonlyArray<Debug.DebugPlugin>
}

/**
 * DevMode component - enables debug observability when added to your app.
 *
 * This component renders nothing (empty fragment) but enables wide event
 * logging when mounted.
 *
 * Debug output appears in the browser console with color-coded events
 * showing signal operations, component renders, and fine-grained updates.
 *
 * @example
 * ```tsx
 * import { mount, DevMode } from "effect-ui"
 *
 * const App = Effect.gen(function* () {
 *   return <div>Hello</div>
 * })
 *
 * // Basic usage - enables all debug logging
 * mount(container, <>
 *   <App />
 *   <DevMode />
 * </>)
 *
 * // With filter - only log signal events
 * mount(container, <>
 *   <App />
 *   <DevMode filter="signal" />
 * </>)
 *
 * // Conditional - only in development
 * mount(container, <>
 *   <App />
 *   <DevMode enabled={import.meta.env.DEV} />
 * </>)
 *
 * // With custom plugins
 * const events: Debug.DebugEvent[] = []
 * mount(container, <>
 *   <App />
 *   <DevMode plugins={[Debug.consolePlugin, Debug.createCollectorPlugin("test", events)]} />
 * </>)
 * ```
 *
 * @since 1.0.0
 */
export const DevMode = (props: DevModeProps = {}): Element => {
  const { filter, enabled = true, plugins } = props

  // If disabled, return empty immediately (no effect)
  if (!enabled) {
    return empty
  }

  // Create a component effect that enables debug on mount
  const effect = Effect.sync(() => {
    // Enable debug logging
    Debug.enable(filter)
    
    // Register custom plugins if provided
    if (plugins !== undefined && plugins.length > 0) {
      for (const plugin of plugins) {
        Debug.registerPlugin(plugin)
      }
    }
    
    // Return empty element (DevMode renders nothing)
    return empty
  })

  return componentElement(() => effect)
}
