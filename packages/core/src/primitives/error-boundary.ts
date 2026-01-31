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
 * const builder = yield* ErrorBoundary.catch(RiskyComponent)
 * const withNetwork = yield* builder.on("NetworkError", (cause) =>
 *   Effect.succeed(<NetworkErrorView cause={cause} />),
 * )
 * const SafeComponent = yield* withNetwork.catchAll((cause) =>
 *   Effect.succeed(<GenericError cause={cause} />),
 * )
 *
 * return <SafeComponent userId={userId} />
 * ```
 */
import { Cause, Data, Effect, Ref } from "effect";
import { Component, tagComponent } from "./component.js";
import { type Element, Element as ElementEnum, componentElement } from "./element.js";
import * as Signal from "./signal.js";
import type { SignalOrValue } from "./resource.js";

// =============================================================================
// Types
// =============================================================================

/**
 * Error handler function type - receives Cause and returns Element effect.
 * @since 1.0.0
 */
export type ErrorHandler<E = unknown, R = never> = (
  cause: Cause.Cause<unknown>,
) => Effect.Effect<Element, never, R>;

/**
 * Union of error tags from an error type.
 * Returns string when error type is unknown or has no _tag.
 * @internal
 */
type ErrorTags<E> = E extends { _tag: infer Tag } ? (Tag extends string ? Tag : string) : string;

/**
 * Transform component props to accept SignalOrValue for each field.
 * This allows wrapped components to accept reactive signals as props.
 * @internal
 */
type ReactiveProps<P> = { readonly [K in keyof P]: SignalOrValue<P[K]> };

type PropsOutput<Props extends object> = [Props] extends [never] ? {} : Props;
type PropsInput<Props extends object> = ReactiveProps<PropsOutput<Props>>;
type PropsKey<Props extends object> = Extract<keyof PropsOutput<Props>, string | symbol>;
type PropsValue<Props extends object> = PropsOutput<Props>[PropsKey<Props>];

export class BuilderError extends Data.TaggedError("BuilderError")<{
  readonly reason:
    | "on-after-catchAll"
    | "duplicate-handler"
    | "catchAll-multiple"
    | "props-incomplete";
  readonly tag?: string | undefined;
}> {}

// =============================================================================
// Builder State
// =============================================================================

/**
 * Internal mutable state for the error boundary builder.
 * Shared across all builders in a chain to track if catchAll was called.
 * @internal
 */
interface BuilderState<E> {
  readonly handlers: Map<string, ErrorHandler<E, unknown>>;
  readonly hasCatchAll: boolean;
}

/**
 * Create initial builder state.
 * @internal
 */
const createState = <E>(): BuilderState<E> => ({
  handlers: new Map<string, ErrorHandler<E, unknown>>(),
  hasCatchAll: false,
});

const isTaggedError = (value: unknown): value is { readonly _tag: string } => {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  const tag = Reflect.get(value, "_tag");
  return typeof tag === "string";
};

const isSignalValue = <A>(value: SignalOrValue<A>): value is Signal.Signal<A> =>
  Signal.isSignal(value);

const unwrapSignalValue = <A>(value: SignalOrValue<A>): Effect.Effect<A> =>
  isSignalValue(value) ? Signal.get(value) : Effect.succeed(value);

const isPropKey = <Props extends object>(
  key: PropertyKey,
  props: PropsInput<Props>,
): key is PropsKey<Props> => key in props;

const hasAllProps = <Props extends object>(
  value: Partial<Props>,
  keys: ReadonlyArray<keyof Props>,
): value is Props => keys.every((key) => Object.prototype.hasOwnProperty.call(value, key));

// =============================================================================
// ErrorBoundary Builder Interface
// =============================================================================

/**
 * Error boundary builder with .on() and .catchAll() methods.
 *
 * @since 1.0.0
 */
export interface ErrorBoundaryBuilder<Props extends object, E, R, RHandlers = never> {
  /**
   * Add a handler for a specific error tag.
   * Cannot be called after catchAll, and cannot add duplicate handlers.
   *
   * @since 1.0.0
   */
  on<Tag extends ErrorTags<E>, RHandler>(
    tag: Tag,
    handler: ErrorHandler<E, RHandler>,
  ): Effect.Effect<ErrorBoundaryBuilder<Props, E, R, RHandlers | RHandler>, BuilderError>;

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
    Component.Type<ReactiveProps<Props>, BuilderError, R | RHandlers | RHandler>,
    BuilderError
  >;
}

// =============================================================================
// Builder Implementation
// =============================================================================

/**
 * Create a builder implementation for a component.
 * @internal
 */
function createBuilder<Props extends object, E, R, RHandlers = never>(
  component: Component.Type<Props, E, R>,
  stateRef: Ref.Ref<BuilderState<E>>,
): ErrorBoundaryBuilder<Props, E, R, RHandlers> {
  return {
    on<Tag extends ErrorTags<E>, RHandler>(
      tag: Tag,
      handler: ErrorHandler<E, RHandler>,
    ): Effect.Effect<ErrorBoundaryBuilder<Props, E, R, RHandlers | RHandler>, BuilderError> {
      return Effect.gen(function* () {
        const state = yield* Ref.get(stateRef);
        if (state.hasCatchAll) {
          return yield* new BuilderError({ reason: "on-after-catchAll" });
        }
        if (state.handlers.has(tag)) {
          return yield* new BuilderError({ reason: "duplicate-handler", tag });
        }

        const handlers: Map<string, ErrorHandler<E, unknown>> = new Map();
        for (const [existingTag, existingHandler] of state.handlers) {
          handlers.set(existingTag, existingHandler);
        }
        handlers.set(tag, handler);

        const nextState: BuilderState<E> = {
          handlers,
          hasCatchAll: state.hasCatchAll,
        };
        yield* Ref.set(stateRef, nextState);

        return createBuilder<Props, E, R, RHandlers | RHandler>(component, stateRef);
      });
    },

    catchAll<RHandler>(
      handler: ErrorHandler<E, RHandler>,
    ): Effect.Effect<
      Component.Type<ReactiveProps<Props>, BuilderError, R | RHandlers | RHandler>,
      BuilderError
    > {
      return Effect.gen(function* () {
        const state = yield* Ref.get(stateRef);
        if (state.hasCatchAll) {
          return yield* new BuilderError({ reason: "catchAll-multiple" });
        }

        yield* Ref.set(stateRef, {
          handlers: state.handlers,
          hasCatchAll: true,
        });

        const fallbackHandler = (
          cause: Cause.Cause<unknown>,
        ): Effect.Effect<Element, never, unknown> =>
          Effect.gen(function* () {
            const error = Cause.squash(cause);

            if (isTaggedError(error)) {
              const specificHandler = state.handlers.get(error._tag);
              if (specificHandler !== undefined) {
                return yield* specificHandler(cause);
              }
            }

            return yield* handler(cause);
          });

        // Create wrapped component using componentGen
        // This ensures proper .provide() behavior through tagComponent
        // We create a component that accepts reactive props and wraps with error boundary
        const safeComponentRunFn = (
          _props: PropsInput<Props>,
        ): Effect.Effect<Element, BuilderError, R> =>
          Effect.gen(function* () {
            const propKeys = Reflect.ownKeys(_props).filter((key): key is PropsKey<Props> =>
              isPropKey<Props>(key, _props),
            );
            const entries = yield* Effect.forEach(
              propKeys,
              (key): Effect.Effect<[PropsKey<Props>, PropsValue<Props>], never> => {
                return Effect.gen(function* () {
                  const value: SignalOrValue<PropsValue<Props>> = _props[key];
                  const resolved = yield* unwrapSignalValue(value);
                  const entry: [PropsKey<Props>, PropsValue<Props>] = [key, resolved];
                  return entry;
                });
              },
              { concurrency: "inherit" },
            );

            const unwrappedProps: Partial<PropsOutput<Props>> = {};
            for (const [key, value] of entries) {
              unwrappedProps[key] = value;
            }

            if (!hasAllProps<PropsOutput<Props>>(unwrappedProps, propKeys)) {
              return yield* new BuilderError({ reason: "props-incomplete" });
            }

            const childElement = component(unwrappedProps);
            return ElementEnum.ErrorBoundaryElement({
              child: childElement,
              fallback: fallbackHandler,
              onError: null,
            });
          });

        const safeComponentFn = (_props: PropsInput<Props>): Element =>
          componentElement(() => safeComponentRunFn(_props));

        const mergedRequirements = [...component._requirements];

        // Preserve original component layers for .provide() chaining
        const originalLayers = component._layers;

        // Use tagComponent to create proper Component.Type with working .provide()
        // Pass runFn so .provide() can wrap it properly
        const safeComponent: Component.Type<
          ReactiveProps<Props>,
          BuilderError,
          R | RHandlers | RHandler
        > = tagComponent(safeComponentFn, originalLayers, mergedRequirements, safeComponentRunFn);

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
 * const builder = yield* ErrorBoundary.catch(RiskyComponent)
 * const withNetwork = yield* builder.on("NetworkError", (cause) =>
 *   Effect.succeed(<NetworkErrorView cause={cause} />),
 * )
 * const SafeComponent = yield* withNetwork.catchAll((cause) =>
 *   Effect.succeed(<GenericError cause={cause} />),
 * )
 *
 * return <SafeComponent userId={userId} />
 * ```
 *
 * @since 1.0.0
 */
export function catch_<Props extends object, E, R>(
  component: Component.Type<Props, E, R>,
): Effect.Effect<ErrorBoundaryBuilder<Props, E, R>, never> {
  return Effect.map(Ref.make(createState<E>()), (stateRef) =>
    createBuilder<Props, E, R>(component, stateRef),
  );
}

// Export catch_ as catch (reserved word workaround)
export { catch_ as catch };
