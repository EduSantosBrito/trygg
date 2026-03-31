/**
 * @since 1.0.0
 * ErrorBoundary - Effect-native error handling with pipeable matchers.
 */
import { Cause, Data, Effect, Pipeable } from "effect";
import { Component, tagComponent } from "./component.js";
import { type Element, Element as ElementEnum, componentElement } from "./element.js";

type ErrorTags<E> = E extends { readonly _tag: infer Tag }
  ? Tag extends string
    ? Tag
    : never
  : never;

type ErrorForTag<E, Tag extends ErrorTags<E>> = Extract<E, { readonly _tag: Tag }>;

type PropsInput<Props> = [Props] extends [never] ? {} : Props;

interface ErrorHandler {
  readonly render: (error: unknown, cause: Cause.Cause<unknown>) => Element;
}

/**
 * Error when unhandled errors remain at render time.
 * @since 1.0.0
 */
export class UnhandledErrorsError extends Data.TaggedError("UnhandledErrorsError")<{
  readonly unhandledTags: ReadonlyArray<string>;
}> {}

/**
 * Pipeable matcher for building an error boundary.
 *
 * `E` tracks the remaining unhandled errors.
 * `R` tracks the accumulated requirements from the wrapped component and all handlers.
 *
 * @since 1.0.0
 */
export interface ErrorBoundaryMatcher<Props, E, R, HandledTags extends string>
  extends Pipeable.Pipeable {
  readonly _tag: "ErrorBoundaryMatcher";
  readonly component: Component.Type<Props, E, R>;
  readonly handlers: ReadonlyMap<string, ErrorHandler>;
  readonly _handledTags?: HandledTags;
}

const isTaggedError = (value: unknown): value is { readonly _tag: string } => {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  return typeof Reflect.get(value, "_tag") === "string";
};

const isErrorTag = <E, Tag extends ErrorTags<E>>(
  tag: Tag,
  error: unknown,
): error is ErrorForTag<E, Tag> => isTaggedError(error) && error._tag === tag;

const unhandledErrorElement = (cause: Cause.Cause<unknown>): Element =>
  componentElement(() =>
    Effect.gen(function* () {
      const error = Cause.squash(cause);
      const unhandledTag = isTaggedError(error) ? error._tag : String(error);
      return yield* new UnhandledErrorsError({
        unhandledTags: [unhandledTag],
      });
    }),
  );

const makeMatcher = <Props, E, R, HandledTags extends string>(
  component: Component.Type<Props, E, R>,
  handlers: ReadonlyMap<string, ErrorHandler>,
): ErrorBoundaryMatcher<Props, E, R, HandledTags> => ({
  _tag: "ErrorBoundaryMatcher",
  component,
  handlers,
  pipe() {
    return Pipeable.pipeArguments(this, arguments);
  },
});

const resolveFallback = (
  handlers: ReadonlyMap<string, ErrorHandler>,
  catchAllComponent: Component.Type<{ cause: Cause.Cause<unknown> }, any, any>,
  cause: Cause.Cause<unknown>,
): Element => {
  const error = Cause.squash(cause);
  if (isTaggedError(error)) {
    const handler = handlers.get(error._tag);
    if (handler !== undefined) {
      return handler.render(error, cause);
    }
  }
  return catchAllComponent({ cause });
};

/**
 * Create an error-boundary matcher for a component.
 *
 * @example
 * ```tsx
 * const SafeComponent = yield* ErrorBoundary
 *   .catch(RiskyComponent)
 *   .pipe(
 *     ErrorBoundary.on("NetworkError", NetworkErrorView),
 *     ErrorBoundary.catchAll(GenericError),
 *   )
 * ```
 *
 * @since 1.0.0
 */
export const catch_ = <Props, E, R>(
  component: Component.Type<Props, E, R>,
): ErrorBoundaryMatcher<Props, E, R, never> => makeMatcher(component, new Map());

/**
 * Handle a specific tagged error with a component.
 *
 * The handler receives `{ error }` props and its requirements are added to the
 * resulting component requirements.
 *
 * @since 1.0.0
 */
export const on =
  <
    Props,
    E,
    R,
    HandledTags extends string,
    Tag extends Exclude<ErrorTags<E>, HandledTags>,
    RHandler,
  >(
    tag: Tag,
    component: Component.Type<{ error: ErrorForTag<E, Tag> }, unknown, RHandler>,
  ) =>
  (
    self: ErrorBoundaryMatcher<Props, E, R, HandledTags>,
  ): ErrorBoundaryMatcher<
    Props,
    Exclude<E, { readonly _tag: Tag }>,
    R | RHandler,
    HandledTags | Tag
  > => {
    const handlers = new Map(self.handlers);
    handlers.set(tag, {
      render: (error, cause) =>
        isErrorTag<E, Tag>(tag, error) ? component({ error }) : unhandledErrorElement(cause),
    });
    return makeMatcher(self.component, handlers);
  };

/**
 * Handle all remaining errors with a component.
 *
 * The handler receives `{ cause }` props and its requirements are added to the
 * resulting component requirements.
 *
 * @since 1.0.0
 */
export const catchAll =
  <Props, E, R, RHandler>(
    component: Component.Type<{ cause: Cause.Cause<unknown> }, unknown, RHandler>,
  ) =>
  (
    self: ErrorBoundaryMatcher<Props, E, R, any>,
  ): Effect.Effect<Component.Type<Props, never, R | RHandler>> =>
    Effect.sync(() => {
      const safeComponentRunFn = (
        props: PropsInput<Props>,
      ): Effect.Effect<Element, never, R | RHandler> =>
        Effect.succeed(
          ElementEnum.ErrorBoundaryElement({
            child: self.component(props),
            fallback: (cause) => resolveFallback(self.handlers, component, cause),
            onError: null,
          }),
        );

      const safeComponentFn = (props: PropsInput<Props>): Element =>
        componentElement(() => safeComponentRunFn(props), null, safeComponentFn, props);

      return tagComponent<Props, PropsInput<Props>, never, R | RHandler>(
        safeComponentFn,
        self.component._layers,
        safeComponentRunFn,
      );
    });

/**
 * Finalize the matcher exhaustively.
 *
 * Only compiles when all tagged errors have been handled via `ErrorBoundary.on`.
 *
 * @since 1.0.0
 */
export const exhaustive = <Props, E, R, HandledTags extends string>(
  self: [E] extends [never] ? ErrorBoundaryMatcher<Props, E, R, HandledTags> : never,
): Effect.Effect<Component.Type<Props, never, R>, UnhandledErrorsError> =>
  Effect.sync(() => {
    const safeComponentRunFn = (props: PropsInput<Props>): Effect.Effect<Element, never, R> =>
      Effect.succeed(
        ElementEnum.ErrorBoundaryElement({
          child: self.component(props),
          fallback: (cause) => {
            const error = Cause.squash(cause);
            if (isTaggedError(error)) {
              const handler = self.handlers.get(error._tag);
              if (handler !== undefined) {
                return handler.render(error, cause);
              }
            }
            return unhandledErrorElement(cause);
          },
          onError: null,
        }),
      );

    const safeComponentFn = (props: PropsInput<Props>): Element =>
      componentElement(() => safeComponentRunFn(props), null, safeComponentFn, props);

    return tagComponent<Props, PropsInput<Props>, never, R>(
      safeComponentFn,
      self.component._layers,
      safeComponentRunFn,
    );
  });

export { catch_ as catch };
