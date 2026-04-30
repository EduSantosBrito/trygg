/**
 * Error-boundary matchers for tagged render failures.
 *
 * @remarks
 * Owner module for the `ErrorBoundary` topic. Use this module when component
 * failures should stay typed and render a fallback through explicit matcher
 * composition instead of ad-hoc `catch` logic.
 *
 * @see ./error-boundary.docs.md - Source-owned topic guide
 * @since 1.0.0
 * @module trygg/primitives/error-boundary
 */
import { Cause, Data, Effect } from "effect";
import { Component, tagComponent } from "./component.js";
import { Element, type Element as ElementType } from "./element.js";
import * as ReactiveMatcher from "./reactive-matcher.js";

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
 *
 * @remarks
 * `ErrorBoundary.exhaustive` fails with this error when a tagged failure still
 * escapes the matcher chain at render time.
 *
 * @example
 * ```ts
 * const exit = yield* Effect.exit(SafeBoundary)
 * ```
 *
 * @category Error Boundaries
 * @public
 * @since 1.0.0
 */
export class UnhandledErrorsError extends Data.TaggedError("UnhandledErrorsError")<{
  readonly unhandledTags: ReadonlyArray<string>;
}> {}

/**
 * Pipeable matcher for building an error boundary.
 *
 * @remarks
 * `E` tracks the remaining unhandled errors.
 * `R` tracks the accumulated requirements from the wrapped component and all handlers.
 *
 * @example
 * ```ts
 * const matcher = ErrorBoundary.catch_(RiskyComponent)
 * ```
 *
 * @category Error Boundaries
 * @public
 * @since 1.0.0
 */
export interface ErrorBoundaryMatcher<Props, E, R, HandledTags extends string>
  extends ReactiveMatcher.ReactiveMatcher<
    "ErrorBoundaryMatcher",
    Component.Type<Props, E, R>,
    ReadonlyMap<string, ErrorHandler>
  > {
  readonly _tag: "ErrorBoundaryMatcher";
  readonly source: Component.Type<Props, E, R>;
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

const unhandledErrorElement = (cause: Cause.Cause<unknown>): ElementType =>
  Element.fromEffect(
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
  ...ReactiveMatcher.make("ErrorBoundaryMatcher", component, handlers),
  source: component,
  component,
  handlers,
});

const resolveFallback = (
  handlers: ReadonlyMap<string, ErrorHandler>,
  catchAllComponent: Component.Type<{ cause: Cause.Cause<unknown> }, any, any>,
  cause: Cause.Cause<unknown>,
): ElementType => {
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
 * @remarks
 * Start matcher composition here, then finish with `catchAll` or `exhaustive`.
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
 * @category Error Boundaries
 * @public
 * @since 1.0.0
 */
export const catch_ = <Props, E, R>(
  component: Component.Type<Props, E, R>,
): ErrorBoundaryMatcher<Props, E, R, never> => makeMatcher(component, new Map());

/**
 * Handle a specific tagged error with a component.
 *
 * @remarks
 * The handler receives `{ error }` props and its requirements are added to the
 * resulting component requirements.
 *
 * @example
 * ```ts
 * const matcher = ErrorBoundary.catch_(Risky).pipe(ErrorBoundary.on("NetworkError", Fallback))
 * ```
 *
 * @category Error Boundaries
 * @public
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
    const handlers = ReactiveMatcher.addHandler(self.handlers, tag, {
      render: (error, cause) =>
        isErrorTag<E, Tag>(tag, error) ? component({ error }) : unhandledErrorElement(cause),
    });
    return makeMatcher(self.component, handlers);
  };

/**
 * Handle all remaining errors with a component.
 *
 * @remarks
 * The handler receives `{ cause }` props and its requirements are added to the
 * resulting component requirements.
 *
 * @example
 * ```ts
 * const Safe = yield* ErrorBoundary.catch_(Risky).pipe(ErrorBoundary.catchAll(GenericFallback))
 * ```
 *
 * @category Error Boundaries
 * @public
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
      ): Effect.Effect<ElementType, never, R | RHandler> =>
        Effect.succeed(
          Element.ErrorBoundaryElement({
            child: self.component(props),
            fallback: (cause) => resolveFallback(self.handlers, component, cause),
            onError: null,
          }),
        );

      const safeComponentFn = (props: PropsInput<Props>): ElementType =>
        Element.fromEffect(
          Effect.suspend(() => safeComponentRunFn(props)),
          {
            identity: safeComponentFn,
            inputs: props,
          },
        );

      return tagComponent<Props, PropsInput<Props>, never, R | RHandler>(
        safeComponentFn,
        self.component._layers,
        safeComponentRunFn,
      );
    });

/**
 * Finalize the matcher exhaustively.
 *
 * @remarks
 * Only compiles when all tagged errors have been handled via `ErrorBoundary.on`.
 *
 * @example
 * ```ts
 * const Safe = yield* ErrorBoundary.exhaustive(matcher)
 * ```
 *
 * @category Error Boundaries
 * @public
 * @since 1.0.0
 */
export const exhaustive = <Props, E, R, HandledTags extends string>(
  self: [E] extends [never] ? ErrorBoundaryMatcher<Props, E, R, HandledTags> : never,
): Effect.Effect<Component.Type<Props, never, R>, UnhandledErrorsError> =>
  Effect.sync(() => {
    const safeComponentRunFn = (props: PropsInput<Props>): Effect.Effect<ElementType, never, R> =>
      Effect.succeed(
        Element.ErrorBoundaryElement({
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

    const safeComponentFn = (props: PropsInput<Props>): ElementType =>
      Element.fromEffect(
        Effect.suspend(() => safeComponentRunFn(props)),
        {
          identity: safeComponentFn,
          inputs: props,
        },
      );

    return tagComponent<Props, PropsInput<Props>, never, R>(
      safeComponentFn,
      self.component._layers,
      safeComponentRunFn,
    );
  });

export { catch_ as catch };
