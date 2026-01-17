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
   * Must have R = never (all requirements satisfied).
   */
  readonly children: Effect.Effect<Element, E, never>
  /**
   * Fallback element to show when an error occurs.
   * Can be a static element or a function that receives the error.
   */
  readonly fallback: Element | ((error: E) => Element)
  /**
   * Optional callback when an error is caught.
   * Returns an Effect for logging, telemetry, etc.
   */
  readonly onError?: (error: E) => Effect.Effect<void, never, never>
}

/**
 * ErrorBoundary component
 * 
 * Provides an error boundary that catches errors from child components
 * and displays a fallback UI. This is similar to React's ErrorBoundary
 * but integrated with Effect's error handling.
 * 
 * The child effect must have all its requirements satisfied (R = never).
 * Use Effect.provide to satisfy requirements before passing to ErrorBoundary.
 * 
 * @example
 * ```tsx
 * const RiskyComponent = Effect.gen(function* () {
 *   const data = yield* fetchData() // May fail
 *   return <div>{data}</div>
 * })
 * 
 * const App = Effect.gen(function* () {
 *   return ErrorBoundary({
 *     fallback: <div>Something went wrong</div>,
 *     children: RiskyComponent
 *   })
 * })
 * ```
 * 
 * @example With error rendering
 * ```tsx
 * const App = Effect.gen(function* () {
 *   return ErrorBoundary({
 *     fallback: (error) => <div>Error: {String(error)}</div>,
 *     children: RiskyComponent,
 *     onError: (error) => Effect.log(`Caught error: ${error}`)
 *   })
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

  return componentElement(effect)
}
