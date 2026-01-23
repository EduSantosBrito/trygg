/**
 * @since 1.0.0
 * ErrorBoundary component for catching errors in component subtrees
 *
 * Catches errors from child components and displays a fallback UI.
 * Uses Effect's error handling for type-safe error recovery.
 *
 * This component catches errors from:
 * 1. Initial render failures (via ErrorBoundaryElement)
 * 2. Re-render failures (via ErrorBoundaryElement propagation)
 */
import { Effect } from "effect";
import { Element, componentElement, normalizeChild } from "../primitives/element.js";

/**
 * Props for the ErrorBoundary component
 * @since 1.0.0
 */
export interface ErrorBoundaryProps<E = unknown> {
  /**
   * Child element - an Effect that may fail, or a static Element.
   */
  readonly children: Effect.Effect<Element, E, unknown> | Element;
  /**
   * Fallback element to show when an error occurs.
   * Can be a static element or a function that receives the error.
   */
  readonly fallback: Element | ((error: E) => Element);
  /**
   * Optional callback when an error is caught.
   * Returns an Effect for logging, telemetry, etc.
   */
  readonly onError?: (error: E) => Effect.Effect<void, never, unknown>;
}

/**
 * ErrorBoundary component
 *
 * Provides an error boundary that catches errors from child components
 * and displays a fallback UI. This is similar to React's ErrorBoundary
 * but integrated with Effect's error handling.
 *
 * **Catches errors from:**
 * - Initial render failures (when the child Effect fails)
 * - Re-render failures (when a child component re-renders due to signal changes and throws)
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
  const { children, fallback, onError } = props;

  // Check if children is an Effect
  const isEffect =
    typeof children === "object" && children !== null && Effect.EffectTypeId in children;

  // Normalize fallback and onError for ErrorBoundaryElement
  const normalizedFallback =
    typeof fallback === "function" ? (e: unknown) => fallback(e as E) : fallback;
  const normalizedOnError = onError ? (e: unknown) => onError(e as E) : null;

  // If children is a static Element, wrap it in ErrorBoundaryElement
  if (!isEffect) {
    return Element.ErrorBoundaryElement({
      child: normalizeChild(children),
      fallback: normalizedFallback,
      onError: normalizedOnError,
    });
  }

  // Children is an Effect - wrap it in a Component element, then wrap that in ErrorBoundaryElement.
  // This ensures:
  // 1. The child Effect becomes its own Component with its own signal subscriptions
  // 2. ErrorBoundaryElement wraps the Component, catching both initial AND re-render errors
  //
  // Structure:
  //   ErrorBoundaryElement
  //     └── Component (child effect)
  //           └── rendered Element
  //
  // When the child Component re-renders and throws, the error propagates to
  // ErrorBoundaryElement's error handler via options.errorHandler.
  const childComponent = componentElement(() => children as Effect.Effect<Element, E, unknown>);

  return Element.ErrorBoundaryElement({
    child: childComponent,
    fallback: normalizedFallback,
    onError: normalizedOnError,
  });
};
