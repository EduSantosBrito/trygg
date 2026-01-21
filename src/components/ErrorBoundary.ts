/**
 * @since 1.0.0
 * ErrorBoundary component for catching errors in component subtrees
 * 
 * Catches errors from child components and displays a fallback UI.
 * Uses Effect's error handling for type-safe error recovery.
 */
import { Effect } from "effect"
import { Element, componentElement } from "../Element.js"

/**
 * Props for the ErrorBoundary component
 * @since 1.0.0
 */
export interface ErrorBoundaryProps<E = unknown> {
  /**
   * Child element - an Effect that may fail.
   */
  readonly children: Effect.Effect<Element, E, unknown>
  /**
   * Fallback element to show when an error occurs.
   * Can be a static element or a function that receives the error.
   */
  readonly fallback: Element | ((error: E) => Element)
  /**
   * Optional callback when an error is caught.
   * Returns an Effect for logging, telemetry, etc.
   */
  readonly onError?: (error: E) => Effect.Effect<void, never, unknown>
}

/**
 * ErrorBoundary component
 * 
 * Provides an error boundary that catches errors from child components
 * and displays a fallback UI. This is similar to React's ErrorBoundary
 * but integrated with Effect's error handling.
 * 
 * The child effect can rely on services provided by parent context.
 * 
 * @example
 * ```tsx
 * const RiskyComponent = Effect.gen(function* () {
 *   const data = yield* fetchData() // May fail
 *   return <div>{data}</div>
 * })
 * 
 * const App = Component.gen(function* () {
 *   return (
 *     <ErrorBoundary fallback={<div>Something went wrong</div>}>
 *       {RiskyComponent}
 *     </ErrorBoundary>
 *   )
 * })
 * ```
 * 
 * @example With error rendering
 * ```tsx
 * const App = Component.gen(function* () {
 *   return (
 *     <ErrorBoundary
 *       fallback={(error) => <div>Error: {String(error)}</div>}
 *       onError={(error) => Effect.log(`Caught error: ${error}`)}
 *     >
 *       {RiskyComponent}
 *     </ErrorBoundary>
 *   )
 * })
 * ```
 * 
 * @since 1.0.0
 */
export const ErrorBoundary = <E>(props: ErrorBoundaryProps<E>): Element => {
  const { children, fallback, onError } = props

  const effect = Effect.gen(function* () {
    // Try to render children, catching any errors
    const result = yield* children.pipe(
      Effect.catchAll((error: E) =>
        Effect.gen(function* () {
          // Call onError callback if provided
          if (onError) {
            yield* onError(error)
          }
          
          // Return fallback element
          if (typeof fallback === "function") {
            return fallback(error)
          }
          return fallback
        })
      )
    )
    
    return result
  })

  return componentElement(() => effect)
}
