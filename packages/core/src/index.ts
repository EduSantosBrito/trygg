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
 * const root = document.getElementById("root")
 * if (root) mount(root, <Counter />)
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
  fragment,
  keyedList,
  empty,
  isElement,
  isEmpty,
  getKey,
  keyed,
} from "./primitives/element.js";

// JSX Runtime
export { jsx, jsxs, Fragment, type JSXProps, type JSXElementType } from "./jsx-runtime.js";

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
export {
  Component,
  isEffectComponent,
  type ComponentProps,
  type PropsMarker,
} from "./primitives/component.js";

// Components
export { DevMode, type DevModeProps } from "./components/dev-mode.js";

// ErrorBoundary
export * as ErrorBoundary from "./primitives/error-boundary.js";

// Portal
export * as Portal from "./primitives/portal.js";
export {
  type PortalProps,
  type PortalOptions,
  PortalTargetNotFoundError,
} from "./primitives/portal.js";

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
