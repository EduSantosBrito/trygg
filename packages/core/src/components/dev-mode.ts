/**
 * Development-time component for enabling debug observability.
 *
 * @remarks
 * Owner module for the `DevMode` topic. Use this component when the app should
 * enable the public `Debug` surface from JSX instead of calling imperative
 * helpers directly.
 *
 * @see ./dev-mode.docs.md - Source-owned topic guide
 * @since 1.0.0
 * @module trygg/components/dev-mode
 */
import { Effect } from "effect";
import * as Debug from "../debug/debug.js";
import { empty } from "../primitives/element.js";
import * as Component from "../primitives/component.js";
import type { ComponentProps } from "../primitives/component.js";

/**
 * Props for the `DevMode` component.
 *
 * @remarks
 * These props control when debug mode is enabled and which plugins receive the
 * emitted debug events.
 *
 * @example
 * ```ts
 * const props: DevModeProps = { filter: ["signal"], enabled: true }
 * ```
 *
 * @category Development
 * @public
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
  readonly filter?: string | ReadonlyArray<string>;

  /**
   * Whether debug mode is enabled. Defaults to true.
   * Use this for conditional enabling.
   *
   * @example
   * ```tsx
   * <DevMode enabled={import.meta.env.DEV} />
   * ```
   */
  readonly enabled?: boolean;

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
  readonly plugins?: ReadonlyArray<Debug.DebugPlugin>;
}

/**
 * DevMode component - enables debug observability when added to your app.
 *
 * @remarks
 * This component renders nothing (empty fragment) but enables wide event
 * logging when mounted.
 *
 * Debug output appears in the browser console with color-coded events
 * showing signal operations, component renders, and fine-grained updates.
 *
 * @example
 * ```tsx
 * import { mount, DevMode } from "trygg"
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
 * @category Development
 * @public
 * @since 1.0.0
 */
export const DevMode = Component.gen(function* (Props: ComponentProps<DevModeProps>) {
  const { filter, enabled = true, plugins } = yield* Props;

  if (!enabled) {
    return empty;
  }

  // Enable debug with filter
  Debug.enable(filter);

  // Register plugins and track names for cleanup
  const registeredPluginNames: Array<string> = [];
  if (plugins !== undefined && plugins.length > 0) {
    for (const plugin of plugins) {
      Debug.registerPlugin(plugin);
      registeredPluginNames.push(plugin.name);
    }
  }

  // Cleanup on unmount: unregister plugins and disable debug
  yield* Effect.addFinalizer(() =>
    Effect.sync(() => {
      for (const name of registeredPluginNames) {
        Debug.unregisterPlugin(name);
      }
      Debug.disable();
    }),
  );

  return empty;
});
