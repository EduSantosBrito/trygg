/**
 * @since 1.0.0
 * ErrorBoundary - Effect-native error handling with pattern matching
 *
 * Provides functional composition for error handling, similar to Resource.match.
 * Wraps components with error boundaries that catch errors and render fallback UIs.
 *
 * @example
 * ```tsx
 * // With catchAll for flexible matching
 * const SafeComponent = yield* ErrorBoundary.catch(RiskyComponent)
 *   .on("NetworkError", (cause) => <NetworkErrorView cause={cause} />)
 *   .catchAll((cause) => <GenericError cause={cause} />)
 *
 * return <SafeComponent userId={userId} />
 * ```
 */
import { Cause, Effect, Scope, Context } from "effect";
import { Component, tagComponent } from "./component.js";
import {
  type Element,
  Element as ElementEnum,
  type ElementWithRequirements,
  componentElement,
} from "./element.js";
import * as Signal from "./signal.js";
import type { SignalOrValue } from "./resource.js";

// =============================================================================
// Types
// =============================================================================

/**
 * Error handler function type - receives Cause and returns Element.
 * @since 1.0.0
 */
export type ErrorHandler<E = unknown, R = never> = (
  cause: Cause.Cause<E>,
) => ElementWithRequirements<R>;

/**
 * Internal error handler type that accepts any cause.
 * @internal
 */
type AnyErrorHandler = (cause: Cause.Cause<unknown>) => Element;

/**
 * Union of error tags from an error type.
 * Returns string when error type is unknown or has no _tag.
 * @internal
 */
type ErrorTags<E> = E extends { _tag: infer Tag } ? (Tag extends string ? Tag : string) : string;

/**
 * Normalize requirements type - converts unknown to never.
 * @internal
 */
type NormalizeRequirements<R> = unknown extends R ? never : R;

/**
 * Transform component props to accept SignalOrValue for each field.
 * This allows wrapped components to accept reactive signals as props.
 * @internal
 */
type ReactiveProps<P> = { readonly [K in keyof P]: SignalOrValue<P[K]> };

// =============================================================================
// Builder State
// =============================================================================

/**
 * Internal mutable state for the error boundary builder.
 * Shared across all builders in a chain to track if catchAll was called.
 * @internal
 */
interface BuilderState {
  handlers: Map<string, AnyErrorHandler>;
  handlerRequirements: Array<Context.Tag<any, any>>;
  hasCatchAll: boolean;
}

/**
 * Create initial builder state.
 * @internal
 */
const createState = (): BuilderState => ({
  handlers: new Map(),
  handlerRequirements: [],
  hasCatchAll: false,
});

// =============================================================================
// ErrorBoundary Builder Interface
// =============================================================================

/**
 * Error boundary builder with .on() and .catchAll() methods.
 *
 * @since 1.0.0
 */
export interface ErrorBoundaryBuilder<Props, E, R, RHandlers = never> {
  /**
   * Add a handler for a specific error tag.
   * Cannot be called after catchAll, and cannot add duplicate handlers.
   *
   * @since 1.0.0
   */
  on<Tag extends ErrorTags<E>, RHandler>(
    tag: Tag,
    handler: ErrorHandler<E, RHandler>,
  ): ErrorBoundaryBuilder<Props, E, R, RHandlers | NormalizeRequirements<RHandler>>;

  /**
   * Add a catch-all handler for any remaining errors.
   * Finalizes the builder and returns the wrapped component.
   *
   * The wrapped component accepts SignalOrValue for all props, enabling
   * fine-grained reactivity when passing signals to error-boundary-wrapped
   * components.
   *
   * @since 1.0.0
   */
  catchAll<RHandler>(
    handler: ErrorHandler<E, RHandler>,
  ): Effect.Effect<
    Component.Type<ReactiveProps<Props>, never, R | RHandlers | NormalizeRequirements<RHandler>>,
    never,
    Scope.Scope
  >;
}

// =============================================================================
// Builder Implementation
// =============================================================================

/**
 * Create a builder implementation for a component.
 * @internal
 */
function createBuilder<Props, E, R, RHandlers = never>(
  component: Component.Type<Props, E, R>,
  state: BuilderState,
): ErrorBoundaryBuilder<Props, E, R, RHandlers> {
  return {
    on: <RHandler>(
      tag: string,
      handler: ErrorHandler<E, RHandler>,
    ): ErrorBoundaryBuilder<Props, E, R, RHandlers | NormalizeRequirements<RHandler>> => {
      if (state.hasCatchAll) {
        throw new Error("Cannot add .on() handler after .catchAll()");
      }
      if (state.handlers.has(tag)) {
        throw new Error(`Duplicate handler for error tag: ${tag}`);
      }

      // Mutate shared state
      state.handlers.set(tag, handler as AnyErrorHandler);

      return createBuilder<Props, E, R, RHandlers | NormalizeRequirements<RHandler>>(
        component,
        state,
      );
    },

    catchAll: <RHandler>(
      handler: ErrorHandler<E, RHandler>,
    ): Effect.Effect<
      Component.Type<ReactiveProps<Props>, never, R | RHandlers | NormalizeRequirements<RHandler>>,
      never,
      Scope.Scope
    > => {
      if (state.hasCatchAll) {
        throw new Error("Cannot call .catchAll() multiple times");
      }

      // Mark that catchAll has been called
      state.hasCatchAll = true;

      return Effect.gen(function* () {
        const fallbackHandler: ErrorHandler = (cause: Cause.Cause<unknown>): Element => {
          const error = Cause.squash(cause);

          // Check if error has a _tag for pattern matching
          if (typeof error === "object" && error !== null && "_tag" in error) {
            const tag = (error as { _tag: string })._tag;
            const specificHandler = state.handlers.get(tag);
            if (specificHandler !== undefined) {
              return specificHandler(cause as Cause.Cause<E>);
            }
          }

          // Fall back to catch-all handler
          return handler(cause as Cause.Cause<E>);
        };

        // Create wrapped component using componentGen
        // This ensures proper .provide() behavior through tagComponent
        // We create a component that accepts reactive props and wraps with error boundary
        const safeComponentRunFn = (
          _props: [Props] extends [never] ? {} : ReactiveProps<Props>,
        ): Effect.Effect<Element, never, R> =>
          Effect.gen(function* () {
            const unwrappedProps: Record<string, unknown> = {};
            for (const key of Object.keys(_props as Record<string, unknown>)) {
              const value = (_props as Record<string, unknown>)[key];
              if (Signal.isSignal(value)) {
                unwrappedProps[key] = yield* Signal.get(value);
              } else {
                unwrappedProps[key] = value;
              }
            }
            // Call the original component with unwrapped props
            const childElement = component(
              unwrappedProps as [Props] extends [never] ? {} : Props,
            );
            return ElementEnum.ErrorBoundaryElement({
              child: childElement,
              fallback: fallbackHandler,
              onError: null,
            });
          });

        const safeComponentFn = (
          _props: [Props] extends [never] ? {} : ReactiveProps<Props>,
        ): Element => componentElement(() => safeComponentRunFn(_props));

        // Merge requirements: original component requirements + handler requirements
        const mergedRequirements = [
          ...((component as any)._requirements || []),
          ...state.handlerRequirements,
        ];

        // Use tagComponent to create proper Component.Type with working .provide()
        // Pass runFn so .provide() can wrap it properly
        const safeComponent = tagComponent<
          ReactiveProps<Props>,
          never,
          R | RHandlers | NormalizeRequirements<RHandler>
        >(safeComponentFn, [], mergedRequirements, safeComponentRunFn);

        return safeComponent;
      });
    },
  };
}

// =============================================================================
// Public API
// =============================================================================

/**
 * Create an error boundary builder for a component.
 *
 * Returns a builder that tracks which error cases have been handled.
 * The builder must be completed with .catchAll() to finalize.
 *
 * @example
 * ```tsx
 * // With catchAll
 * const SafeComponent = yield* ErrorBoundary.catch(RiskyComponent)
 *   .on("NetworkError", (cause) => <NetworkErrorView cause={cause} />)
 *   .catchAll((cause) => <GenericError cause={cause} />)
 *
 * return <SafeComponent userId={userId} />
 * ```
 *
 * @since 1.0.0
 */
export function catch_<Props, E, R>(
  component: Component.Type<Props, E, R>,
): ErrorBoundaryBuilder<Props, E, R> {
  const state = createState();
  return createBuilder<Props, E, R>(component, state);
}

// Export catch_ as catch (reserved word workaround)
export { catch_ as catch };
