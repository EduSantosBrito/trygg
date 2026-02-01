/**
 * @since 1.0.0
 * ErrorBoundary - Effect-native error handling with pattern matching
 *
 * Provides chainable builder API for error handling. Wraps components with
 * error boundaries that catch errors and render fallback UIs.
 *
 * Handlers return Elements (JSX). Effects are wrapped internally.
 *
 * @example
 * ```tsx
 * // With catchAll for non-exhaustive matching
 * const SafeComponent = yield* ErrorBoundary
 *   .catch(RiskyComponent)
 *   .on("NetworkError", NetworkErrorView)
 *   .catchAll((cause) => <GenericError cause={cause} />)
 *
 * // With exhaustive matching (all errors handled)
 * const SafeComponent = yield* ErrorBoundary
 *   .catch(RiskyComponent)
 *   .on("NetworkError", NetworkErrorView)
 *   .on("ValidationError", ValidationErrorView)
 *   .exhaustive()
 *
 * return <SafeComponent userId={userId} />
 * ```
 */
import { Cause, Data, Effect } from "effect";
import { Component, tagComponent } from "./component.js";
import { type Element, Element as ElementEnum, componentElement } from "./element.js";
import * as Signal from "./signal.js";
import type { SignalOrValue } from "./resource.js";

// =============================================================================
// Types
// =============================================================================

type ErrorForTag<E, Tag extends ErrorTags<E>> = Extract<E, { readonly _tag: Tag }>;

/**
 * CatchAll handler function type.
 * @internal
 */
export type CatchAllHandler<_E> = (cause: Cause.Cause<unknown>) => Element;

/**
 * Union of error tags from an error type.
 * @internal
 */
type ErrorTags<E> = E extends { _tag: infer Tag } ? (Tag extends string ? Tag : string) : string;

/**
 * Union of all known error tags from an error type.
 * @internal
 */
type AllErrorTags<E> = E extends { _tag: infer Tag } ? (Tag extends string ? Tag : string) : string;

/**
 * Remaining tags after handling.
 * @internal
 */
type RemainingTags<E, HandledTags extends string> = Exclude<AllErrorTags<E>, HandledTags>;

/**
 * Transform component props to accept SignalOrValue for each field.
 * @internal
 */
type ReactiveProps<P> = { readonly [K in keyof P]: SignalOrValue<P[K]> };

type PropsOutput<Props extends object> = [Props] extends [never] ? {} : Props;
type PropsInput<Props extends object> = ReactiveProps<PropsOutput<Props>>;
type PropsKey<Props extends object> = Extract<keyof PropsOutput<Props>, string | symbol>;
type PropsValue<Props extends object> = PropsOutput<Props>[PropsKey<Props>];

/**
 * Errors that can occur during error boundary building.
 * @since 1.0.0
 */
export class BuilderError extends Data.TaggedError("BuilderError")<{
  readonly reason: "duplicate-handler" | "catchAll-multiple" | "on-after-catchAll";
  readonly tag?: string;
}> {}

/**
 * Error when unhandled errors remain at render time.
 * @since 1.0.0
 */
export class UnhandledErrorsError extends Data.TaggedError("UnhandledErrorsError")<{
  readonly unhandledTags: ReadonlyArray<string>;
}> {}

// =============================================================================
// Builder State (Mutable, per instance)
// =============================================================================

interface BuilderState<_E> {
  handlers: Map<string, (error: unknown, cause: Cause.Cause<unknown>) => Element>;
  error: BuilderError | null;
  hasCatchAll: boolean;
}

const createState = <E>(): BuilderState<E> => ({
  handlers: new Map(),
  error: null,
  hasCatchAll: false,
});

// =============================================================================
// Helpers
// =============================================================================

const isTaggedError = (value: unknown): value is { readonly _tag: string } => {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  const tag = Reflect.get(value, "_tag");
  return typeof tag === "string";
};

const isErrorTag = <E, Tag extends ErrorTags<E>>(
  tag: Tag,
  error: unknown,
): error is ErrorForTag<E, Tag> => isTaggedError(error) && error._tag === tag;

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

const unhandledErrorElement = (cause: Cause.Cause<unknown>): Element =>
  componentElement(() =>
    Effect.gen(function* () {
      const message = String(Cause.squash(cause));
      return yield* new UnhandledErrorsError({
        unhandledTags: [message],
      });
    }),
  );

// =============================================================================
// Builder Interface
// =============================================================================

interface ErrorBoundaryBuilderBase<
  Props extends object,
  E,
  R,
  RHandlers,
  HandledTags extends string,
> {
  on<Tag extends ErrorTags<E>, RHandler>(
    tag: Tag,
    component: Component.Type<{ error: ErrorForTag<E, Tag> }, any, RHandler>,
  ): ErrorBoundaryBuilder<Props, E, R, RHandlers | RHandler, HandledTags | Tag>;

  catchAll(
    handler: CatchAllHandler<E>,
  ): Effect.Effect<Component.Type<ReactiveProps<Props>, never, R | RHandlers>, BuilderError>;

  exhaustive(
    this: [RemainingTags<E, HandledTags>] extends [never]
      ? ErrorBoundaryBuilderImpl<Props, E, R, RHandlers, HandledTags>
      : never,
  ): Effect.Effect<
    Component.Type<ReactiveProps<Props>, never, R | RHandlers>,
    BuilderError | UnhandledErrorsError
  >;
}

export type ErrorBoundaryBuilder<
  Props extends object,
  E,
  R,
  RHandlers = never,
  HandledTags extends string = never,
> = ErrorBoundaryBuilderBase<Props, E, R, RHandlers, HandledTags>;

// =============================================================================
// Builder Implementation
// =============================================================================

class ErrorBoundaryBuilderImpl<
  Props extends object,
  E,
  R,
  RHandlers,
  HandledTags extends string,
> implements ErrorBoundaryBuilderBase<Props, E, R, RHandlers, HandledTags> {
  constructor(
    private readonly component: Component.Type<Props, E, R>,
    private readonly state: BuilderState<E>,
  ) {}

  on<Tag extends ErrorTags<E>, RHandler>(
    tag: Tag,
    component: Component.Type<{ error: ErrorForTag<E, Tag> }, any, RHandler>,
  ): ErrorBoundaryBuilder<Props, E, R, RHandlers | RHandler, HandledTags | Tag> {
    if (this.state.hasCatchAll) {
      const nextState = this.withError(new BuilderError({ reason: "on-after-catchAll" }));
      return new ErrorBoundaryBuilderImpl<Props, E, R, RHandlers | RHandler, HandledTags | Tag>(
        this.component,
        nextState,
      );
    }

    if (this.state.handlers.has(tag)) {
      const nextState = this.withError(new BuilderError({ reason: "duplicate-handler", tag }));
      return new ErrorBoundaryBuilderImpl<Props, E, R, RHandlers | RHandler, HandledTags | Tag>(
        this.component,
        nextState,
      );
    }

    const handlers = new Map(this.state.handlers);
    const handle = (error: unknown, cause: Cause.Cause<unknown>): Element => {
      if (isErrorTag<E, Tag>(tag, error)) {
        return component({ error });
      }
      return unhandledErrorElement(cause);
    };
    handlers.set(tag, handle);

    const nextState: BuilderState<E> = {
      handlers,
      error: this.state.error,
      hasCatchAll: this.state.hasCatchAll,
    };

    return new ErrorBoundaryBuilderImpl<Props, E, R, RHandlers | RHandler, HandledTags | Tag>(
      this.component,
      nextState,
    );
  }

  catchAll(
    handler: CatchAllHandler<E>,
  ): Effect.Effect<Component.Type<ReactiveProps<Props>, never, R | RHandlers>, BuilderError> {
    // Validate and mutate state synchronously before entering Effect context
    if (this.state.error !== null) {
      const error = this.state.error;
      return Effect.gen(this, function* () {
        return yield* error;
      });
    }
    if (this.state.hasCatchAll) {
      return Effect.gen(this, function* () {
        return yield* new BuilderError({ reason: "catchAll-multiple" });
      });
    }
    this.state.hasCatchAll = true;

    return Effect.gen(this, function* () {
      const fallbackHandler = (cause: Cause.Cause<unknown>): Element =>
        this.resolveHandler(handler, cause);

      return yield* this.buildComponent(fallbackHandler);
    });
  }

  exhaustive(
    this: [RemainingTags<E, HandledTags>] extends [never]
      ? ErrorBoundaryBuilderImpl<Props, E, R, RHandlers, HandledTags>
      : never,
  ): Effect.Effect<
    Component.Type<ReactiveProps<Props>, never, R | RHandlers>,
    BuilderError | UnhandledErrorsError
  > {
    // Validate and mutate state synchronously before entering Effect context
    if (this.state.error !== null) {
      const error = this.state.error;
      return Effect.gen(this, function* () {
        return yield* error;
      });
    }
    if (this.state.hasCatchAll) {
      return Effect.gen(this, function* () {
        return yield* new BuilderError({ reason: "catchAll-multiple" });
      });
    }
    this.state.hasCatchAll = true;

    return Effect.gen(this, function* () {
      const fallbackHandler = (cause: Cause.Cause<unknown>): Element =>
        this.resolveExhaustiveHandler(cause);

      return yield* this.buildComponent(fallbackHandler);
    });
  }

  private withError(error: BuilderError): BuilderState<E> {
    if (this.state.error !== null) {
      return this.state;
    }

    return {
      handlers: this.state.handlers,
      error,
      hasCatchAll: this.state.hasCatchAll,
    };
  }

  private resolveHandler(
    catchAllHandler: CatchAllHandler<E>,
    cause: Cause.Cause<unknown>,
  ): Element {
    const error = Cause.squash(cause);

    if (isTaggedError(error)) {
      const specificHandler = this.state.handlers.get(error._tag);
      if (specificHandler !== undefined) {
        return specificHandler(error, cause);
      }
    }

    return catchAllHandler(cause);
  }

  private resolveExhaustiveHandler(cause: Cause.Cause<unknown>): Element {
    const error = Cause.squash(cause);

    if (isTaggedError(error)) {
      const specificHandler = this.state.handlers.get(error._tag);
      if (specificHandler !== undefined) {
        return specificHandler(error, cause);
      }
    }

    return unhandledErrorElement(cause);
  }

  private buildComponent(
    fallbackHandler: (cause: Cause.Cause<unknown>) => Element,
  ): Effect.Effect<Component.Type<ReactiveProps<Props>, never, R>, never> {
    return Effect.sync(() => {
      const component = this.component;
      const safeComponentRunFn = (_props: PropsInput<Props>): Effect.Effect<Element, never, R> =>
        Effect.gen(function* () {
          const propKeys = Reflect.ownKeys(_props).filter((key): key is PropsKey<Props> =>
            isPropKey<Props>(key, _props),
          );

          const entries = yield* Effect.forEach(
            propKeys,
            (key): Effect.Effect<[PropsKey<Props>, PropsValue<Props>], never> =>
              Effect.gen(function* () {
                const value: SignalOrValue<PropsValue<Props>> = _props[key];
                const resolved = yield* unwrapSignalValue(value);
                return [key, resolved];
              }),
            { concurrency: "inherit" },
          );

          const unwrappedProps: Partial<PropsOutput<Props>> = {};
          for (const [key, value] of entries) {
            unwrappedProps[key] = value;
          }

          if (!hasAllProps<PropsOutput<Props>>(unwrappedProps, propKeys)) {
            return ElementEnum.Text({ content: "Error: props incomplete" });
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

      const safeComponent: Component.Type<ReactiveProps<Props>, never, R> = tagComponent(
        safeComponentFn,
        this.component._layers,
        this.component._requirements,
        safeComponentRunFn,
      );

      return safeComponent;
    });
  }
}

// =============================================================================
// Public API
// =============================================================================

/**
 * Create an error boundary builder for a component.
 *
 * Returns a synchronous builder - no yield* needed to start chaining.
 * Finalize with .catchAll() or .exhaustive() when done.
 *
 * @since 1.0.0
 */
export function catch_<Props extends object, E, R>(
  component: Component.Type<Props, E, R>,
): ErrorBoundaryBuilder<Props, E, R, never, never> {
  return new ErrorBoundaryBuilderImpl<Props, E, R, never, never>(component, createState<E>());
}

// Export catch_ as catch (reserved word workaround)
export { catch_ as catch };
