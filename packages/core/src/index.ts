/**
 * @since 1.0.0
 * trygg - An Effect-native UI framework with JSX support
 *
 * ## Quick Start
 *
 * ```tsx
 * import { mount, Signal, Component } from "trygg"
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
 * @module trygg
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
} from "./primitives/element.js";

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
  mountDocument,
  renderDocument,
  type RendererService,
  type RenderContext,
  type RenderResult,
  CurrentRenderContext,
} from "./primitives/renderer.js";

// Signal - Effect-native reactive state
export * as Signal from "./primitives/signal.js";

// cx - Class name composition with fine-grained reactivity
export { cx, type ClassInput, type ClassValue } from "./primitives/cx.js";

// Api - Type utilities for HttpApi integration
export * as Api from "./api/types.js";

// Resource - Data fetching with caching and fine-grained reactivity
export * as Resource from "./primitives/resource.js";

// Component API for typed props
import {
  Component as ComponentFn,
  gen as componentGen,
  provide as componentProvide,
  isEffectComponent,
  type ComponentProps,
  type PropsMarker,
} from "./primitives/component.js";

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

export declare namespace Component {
  /**
   * Component type - tracks Props, Error, and Requirements.
   *
   * @example
   * ```typescript
   * const Card: Component.Type<{ title: string }, never, Theme>
   * const Pure: Component.Type<never, never, never>
   * ```
   *
   * @since 1.0.0
   */
  export interface Type<Props = never, _E = never, _R = never> {
    readonly _tag: "EffectComponent";
    (props: [Props] extends [never] ? {} : Props): import("./primitives/element.js").Element;
  }
}

export { isEffectComponent, type ComponentProps, type PropsMarker };

// Components
export { ErrorBoundary, type ErrorBoundaryProps } from "./components/error-boundary.js";
export { DevMode, type DevModeProps } from "./components/dev-mode.js";

// Portal
export * as Portal from "./primitives/portal.js";
export {
  type PortalProps,
  type PortalOptions,
  PortalTargetNotFoundError,
} from "./primitives/portal.js";

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
} from "./testing/index.js";

// Debug utilities
// Enable by adding <DevMode /> to your app, or see OBSERVABILITY.md
export * as Debug from "./debug/debug.js";

// Metrics for observability
// Counters and histograms for navigation, rendering, and signal updates
export * as Metrics from "./debug/metrics.js";

// Head management — head element hoisting and dedup
export * as Head from "./primitives/head.js";

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
