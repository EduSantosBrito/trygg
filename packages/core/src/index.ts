/**
 * @since 1.0.0
 * effect-ui - An Effect-native UI framework with JSX support
 *
 * ## Quick Start
 *
 * ```tsx
 * import { mount, Signal, Component } from "effect-ui"
 *
 * const Counter = Component.gen(function* () {
 *   const count = yield* Signal.make(0)
 *   return (
 *     <button onClick={() => Signal.update(count, n => n + 1)}>
 *       Count: {count}
 *     </button>
 *   )
 * })
 *
 * mount(document.getElementById("root")!, <Counter />)
 * ```
 *
 * ## Key Concepts
 *
 * - **Components via Component.gen**: Define components with `Component.gen` and JSX
 * - **Signal for state**: `Signal.make(initial)` creates reactive state
 * - **Fine-grained updates**: Pass signals directly to JSX for surgical DOM updates
 * - **Re-renders**: Use `Signal.get(signal)` when you need the component to re-render
 *
 * ## Core Exports
 *
 * - {@link mount} - Mount an app to the DOM
 * - {@link Signal} - Reactive state primitives
 * - {@link Component} - Typed components with explicit DI
 * - {@link DevMode} - Debug event viewer
 *
 * @see README.md for full documentation
 * @see DESIGN.md for architecture details
 * @see OBSERVABILITY.md for debugging guide
 *
 * @module effect-ui
 */

// Core Element types and utilities
export {
  Element,
  type ElementKey,
  type ElementChild,
  type ElementChildren,
  type ElementProps,
  type BaseProps,
  type EventProps,
  type EventHandler,
  intrinsic,
  text,
  componentElement,
  fragment,
  portal,
  keyedList,
  empty,
  isElement,
  isEmpty,
  normalizeChild,
  normalizeChildren,
  getKey,
  keyed,
} from "./element.js";

// JSX Runtime
export {
  jsx,
  jsxs,
  Fragment,
  type JSXProps,
  type ComponentFunction,
  type JSXElementType,
} from "./jsx-runtime.js";

// Renderer
export {
  Renderer,
  browserLayer,
  mount,
  type RendererService,
  type RenderContext,
  type RenderResult,
  CurrentRenderContext,
  PortalTargetNotFoundError,
} from "./renderer.js";

// Signal - Effect-native reactive state
export * as Signal from "./signal.js";

// Api - Type utilities for HttpApi integration
export * as Api from "./api.js";

// Resource - Data fetching with caching and fine-grained reactivity
export * as Resource from "./Resource.js";

// Component API for typed props
import {
  Component as ComponentFn,
  gen as componentGen,
  provide as componentProvide,
  isEffectComponent,
  type ComponentType,
  type ComponentProps,
  type PropsMarker,
} from "./component.js";

/**
 * Component API for creating JSX components with typed props.
 *
 * ## Usage
 *
 * Use `Component.gen` for the recommended syntax:
 *
 * @example
 * ```tsx
 * const Card = Component.gen(function* (Props: ComponentProps<{ title: string }>) {
 *   const { title } = yield* Props
 *   const theme = yield* Theme
 *   return <div style={{ color: theme.primary }}>{title}</div>
 * })
 *
 * const App = Component.gen(function* () {
 *   return Effect.gen(function* () {
 *     return <Card title="Hello" />
 *   }).pipe(Component.provide(themeLayer))
 * })
 * ```
 *
 * Service requirements are satisfied by parent effects, not props.
 *
 * @see DESIGN.md Section 5 for detailed documentation
 */
type ComponentApi = typeof ComponentFn & {
  readonly gen: typeof componentGen;
  readonly provide: typeof componentProvide;
};

export const Component: ComponentApi = Object.assign(ComponentFn, {
  gen: componentGen,
  provide: componentProvide,
});

export { isEffectComponent, type ComponentType, type ComponentProps, type PropsMarker };

// Components
export { ErrorBoundary, type ErrorBoundaryProps } from "./components/error-boundary.js";
export { Portal, type PortalProps } from "./components/portal.js";
export { DevMode, type DevModeProps } from "./components/dev-mode.js";

// Testing utilities (re-export for convenience)
export {
  render as testRender,
  renderElement,
  testLayer,
  click,
  type as typeInput,
  waitFor,
  type TestRenderResult,
  type RenderInput,
  ElementNotFoundError,
  WaitForTimeoutError,
} from "./testing.js";

// Debug utilities
// Enable by adding <DevMode /> to your app, or see OBSERVABILITY.md
export * as Debug from "./debug/debug.js";

// Metrics for observability
// Counters and histograms for navigation, rendering, and signal updates
export * as Metrics from "./debug/metrics.js";

// SafeUrl validation for secure href/src attributes
// Validates URLs against a configurable scheme allowlist
export * as SafeUrl from "./security/safe-url.js";
export { UnsafeUrlError } from "./security/safe-url.js";

// Test server for LLM observability
// Use Debug.serverLayer() to start server with debug plugin integration
// Access the server via TestServer context tag
export {
  TestServer,
  type TestServerService,
  type TestServerConfig,
  type StoredLogEvent,
  type LogLevel,
  type QueryOptions,
} from "./debug/test-server.js";
