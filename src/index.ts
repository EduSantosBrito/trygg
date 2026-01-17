/**
 * @since 1.0.0
 * effect-ui - An Effect-native UI framework with JSX support
 *
 * ## Quick Start
 *
 * ```tsx
 * import { Effect } from "effect"
 * import { mount, Signal } from "effect-ui"
 *
 * const Counter = Effect.gen(function* () {
 *   const count = yield* Signal.make(0)
 *   return (
 *     <button onClick={() => Signal.update(count, n => n + 1)}>
 *       Count: {count}
 *     </button>
 *   )
 * })
 *
 * mount(document.getElementById("root")!, Counter)
 * ```
 *
 * ## Key Concepts
 *
 * - **Components are Effects**: Use `Effect.gen(function* () { ... })` to define components
 * - **Signal for state**: `Signal.make(initial)` creates reactive state
 * - **Fine-grained updates**: Pass signals directly to JSX for surgical DOM updates
 * - **Re-renders**: Use `Signal.get(signal)` when you need the component to re-render
 *
 * ## Core Exports
 *
 * - {@link mount} - Mount an app to the DOM
 * - {@link Signal} - Reactive state primitives
 * - {@link Component} - Typed components with auto layer injection
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

// Component API for typed props and layer injection
import {
  Component as ComponentFn,
  gen as componentGen,
  isEffectComponent,
  type ComponentType,
  type ComponentProps,
  type PropsMarker
} from "./Component.js"

/**
 * Component API for creating JSX components with typed props and automatic layer injection.
 * 
 * ## Usage
 * 
 * Use `Component.gen` for the recommended syntax:
 * 
 * @example
 * ```tsx
 * // Without props - just pass the generator directly
 * const ThemedCard = Component.gen(function* () {
 *   const theme = yield* Theme
 *   return <div style={{ color: theme.primary }}>{theme.name}</div>
 * })
 * // TypeScript infers: { theme: Layer<Theme> }
 * 
 * // With props - use curried syntax for full type inference
 * const Card = Component.gen<{ title: string }>()(Props => function* () {
 *   const { title } = yield* Props
 *   const theme = yield* Theme
 *   return <div style={{ color: theme.primary }}>{title}</div>
 * })
 * // TypeScript infers: { title: string, theme: Layer<Theme> }
 * ```
 * 
 * ## How It Works
 * 
 * Service requirements (like Theme, Logger) are automatically detected from
 * the Effect's type and become layer props. When you use the component in JSX,
 * TypeScript requires you to pass the corresponding layers:
 * 
 * ```tsx
 * const themeLayer = Layer.succeed(Theme, { primary: "blue" })
 * <Card title="Hello" theme={themeLayer} />
 * ```
 * 
 * @see DESIGN.md Section 5 for detailed documentation
 */
export const Component = Object.assign(ComponentFn, { gen: componentGen })

export { 
  isEffectComponent, 
  type ComponentType,
  type ComponentProps,
  type PropsMarker
}

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
