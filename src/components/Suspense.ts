/**
 * @since 1.0.0
 * Suspense component for async rendering
 * 
 * Shows a fallback while waiting for async child components to resolve.
 * Uses Effect's Deferred for coordination.
 */
import { Deferred, Effect, Scope } from "effect"
import { Element, componentElement, suspense as suspenseElement } from "../Element.js"

/**
 * Props for the Suspense component
 * @since 1.0.0
 */
export interface SuspenseProps<E = never> {
  /**
   * Fallback element to show while the child is loading
   */
  readonly fallback: Element
  /**
   * Async child element - an Effect that produces an Element.
   */
  readonly children: Effect.Effect<Element, E, unknown>
}

/**
 * Suspense component
 * 
 * Provides an async boundary that shows a fallback element while waiting
 * for the child Effect to resolve. Uses Effect's Deferred for coordination.
 * 
 * The child effect can rely on services provided by parent context.
 * 
 * @example
 * ```tsx
 * const AsyncContent = Effect.gen(function* () {
 *   const data = yield* fetchData()
 *   return <div>{data}</div>
 * })
 * 
 * const App = Component.gen(function* () {
 *   return (
 *     <Suspense fallback={<div>Loading...</div>}>
 *       {AsyncContent}
 *     </Suspense>
 *   )
 * })
 * ```
 * 
 * @since 1.0.0
 */
export const Suspense = <E>(props: SuspenseProps<E>): Element => {
  const { fallback, children } = props

  const effect = Effect.gen(function* () {
    // Create a deferred with unknown error type since the renderer
    // handles all errors uniformly
    const deferred = yield* Deferred.make<Element, unknown>()

    // Create a scope for the forked fiber
    const scope = yield* Scope.make()

    // Fork the child effect to resolve the deferred when complete
    yield* Effect.forkIn(
      children.pipe(
        Effect.flatMap((element) => Deferred.succeed(deferred, element)),
        Effect.catchAll((error: E) => Deferred.fail(deferred, error))
      ),
      scope
    )

    // Return a Suspense element that the renderer will handle
    return suspenseElement(deferred, fallback)
  })

  return componentElement(() => effect)
}
