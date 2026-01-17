/**
 * @since 1.0.0
 * effect-ui - An Effect-native UI framework with JSX support
 *
 * @example
 * ```tsx
 * import { Effect } from "effect"
 * import { mount, Signal } from "effect-ui"
 *
 * const App = Effect.gen(function* () {
 *   const count = yield* Signal.make(0)
 *   return (
 *     <button onClick={() => Signal.update(count, n => n + 1)}>
 *       Count: {count}
 *     </button>
 *   )
 * })
 *
 * mount(document.getElementById("root")!, App)
 * ```
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
  suspense,
  portal,
  keyedList,
  empty,
  isElement,
  isEmpty,
  normalizeChild,
  normalizeChildren,
  getKey,
  keyed
} from "./Element.js"

// JSX Runtime
export {
  jsx,
  jsxs,
  Fragment,
  type JSXProps,
  type ComponentFunction,
  type JSXElementType
} from "./jsx-runtime.js"

// Renderer
export {
  Renderer,
  browserLayer,
  render,
  mount,
  type RendererService,
  type RenderContext,
  type RenderResult,
  CurrentRenderContext,
  PortalTargetNotFoundError
} from "./Renderer.js"

// Signal - Effect-native reactive state
export * as Signal from "./Signal.js"

// Component wrapper for JSX compatibility
export { component, Component, type ComponentType } from "./Component.js"

// Components
export { Suspense, type SuspenseProps } from "./components/Suspense.js"
export {
  ErrorBoundary,
  type ErrorBoundaryProps
} from "./components/ErrorBoundary.js"
export { Portal, type PortalProps } from "./components/Portal.js"
export { DevMode, type DevModeProps } from "./DevMode.js"

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
  WaitForTimeoutError
} from "./testing.js"

// Debug utilities
// Enable by adding <DevMode /> to your app, or see OBSERVABILITY.md
export * as Debug from "./debug.js"
