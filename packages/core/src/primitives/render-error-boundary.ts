import { Cause, Effect, Exit, Scope } from "effect";
import * as Context from "effect/Context";
import type { Element } from "./element.js";
import * as Debug from "../debug/debug.js";
import type { ErrorBoundaryHandler, RenderContext, RenderResult } from "./renderer.js";

interface RenderOptions {
  readonly errorHandler: ErrorBoundaryHandler | null;
}

interface RenderErrorBoundaryDeps<E, R> {
  readonly defaultRenderOptions: RenderOptions;
  readonly emptyContext: Context.Context<unknown>;
  readonly renderElement: (
    element: Element,
    parent: Node,
    renderContext: RenderContext,
    context: Context.Context<unknown> | null,
    options: RenderOptions,
  ) => Effect.Effect<RenderResult, E, R>;
  readonly runForkInRenderContext: <E2, R2>(
    effect: Effect.Effect<void, E2, R2>,
    renderContext: RenderContext,
    context: Context.Context<unknown> | null,
  ) => void;
}

type ChildRenderResult =
  | { readonly success: true; readonly result: RenderResult; readonly scope: Scope.Closeable }
  | { readonly success: false };

export const renderErrorBoundary = Effect.fn("renderErrorBoundary")(function* <E, R>(
  child: Element,
  fallback: Element | ((cause: Cause.Cause<unknown>) => Element),
  onError: ((cause: Cause.Cause<unknown>) => Effect.Effect<void, unknown, R>) | null,
  parent: Node,
  renderContext: RenderContext,
  context: Context.Context<unknown> | null,
  deps: RenderErrorBoundaryDeps<E, R>,
) {
  const anchor = document.createComment("error-boundary");
  parent.appendChild(anchor);

  let currentResult: RenderResult | null = null;
  let currentScope: Scope.Closeable | null = null;
  let isUnmounted = false;
  let hasErrored = false;

  const cleanupRendered = Effect.fnUntraced(function* (
    result: RenderResult | null,
    scope: Scope.Closeable | null,
  ) {
    if (result !== null) {
      yield* result.cleanup;
    }
    if (scope !== null) {
      yield* Scope.close(scope, Exit.void);
    }
  });

  const cleanupCurrent = Effect.gen(function* () {
    const result = currentResult;
    const scope = currentScope;
    currentResult = null;
    currentScope = null;
    yield* cleanupRendered(result, scope);
  });

  const insertBeforeAnchor: (node: Node) => Effect.Effect<boolean> = Effect.fnUntraced(
    function* (node) {
      const tryInsert = (parentNode: Node | null): Effect.Effect<boolean> =>
        parentNode === null
          ? Effect.succeed(false)
          : Effect.try({
              try: () => {
                parentNode.insertBefore(node, anchor);
                return true;
              },
              catch: () => false,
            }).pipe(Effect.catch((failed) => Effect.succeed(failed)));

      if (yield* tryInsert(anchor.parentNode)) return true;
      if (yield* tryInsert(anchor.parentNode)) return true;
      return false;
    },
  );

  const mountFallback = Effect.fnUntraced(function* (fallbackElement: Element) {
    const renderParent = anchor.parentNode;
    if (renderParent === null) return null;

    const fallbackScope = yield* Scope.fork(yield* Effect.scope);
    const fallbackResult = yield* deps
      .renderElement(
        fallbackElement,
        renderParent,
        renderContext,
        context,
        deps.defaultRenderOptions,
      )
      .pipe(
        Scope.provide(fallbackScope),
        Effect.onError(() => Scope.close(fallbackScope, Exit.void)),
      );

    const inserted = yield* insertBeforeAnchor(fallbackResult.node);
    if (!inserted) {
      yield* cleanupRendered(fallbackResult, fallbackScope);
      return null;
    }

    return { result: fallbackResult, scope: fallbackScope };
  });

  const runOnError = (cause: Cause.Cause<unknown>) =>
    onError === null ? Effect.void : Effect.provide(onError(cause), context ?? deps.emptyContext);

  const mountFallbackForCause = Effect.fnUntraced(function* (cause: Cause.Cause<unknown>) {
    yield* Debug.log({ event: "render.errorboundary.caught", reason: Cause.pretty(cause) });
    yield* runOnError(cause);

    const fallbackElement = typeof fallback === "function" ? fallback(cause) : fallback;
    const mounted = yield* mountFallback(fallbackElement);
    if (mounted === null) return null;

    yield* Debug.log({ event: "render.errorboundary.fallback" });
    return mounted;
  });

  const errorHandler: ErrorBoundaryHandler = (cause) => {
    if (isUnmounted || hasErrored) return;
    hasErrored = true;

    deps.runForkInRenderContext(
      Effect.gen(function* () {
        const mounted = yield* mountFallbackForCause(cause);
        if (mounted === null) return;

        const previousResult = currentResult;
        const previousScope = currentScope;
        currentResult = mounted.result;
        currentScope = mounted.scope;
        yield* cleanupRendered(previousResult, previousScope);
      }).pipe(
        Effect.tapCause((fallbackCause) =>
          Effect.sync(() => {
            console.error(
              "[trygg] ErrorBoundary fallback rendering failed:",
              Cause.pretty(fallbackCause),
            );
          }),
        ),
      ),
      renderContext,
      context,
    );
  };

  const childOptions: RenderOptions = { errorHandler };

  const renderFallbackForError = Effect.fnUntraced(function* (cause: Cause.Cause<unknown>) {
    hasErrored = true;
    const mounted = yield* mountFallbackForCause(cause);
    if (mounted === null) return;

    currentResult = mounted.result;
    currentScope = mounted.scope;
  });

  const childScope = yield* Scope.fork(yield* Effect.scope);
  const childRenderResult = yield* deps
    .renderElement(child, parent, renderContext, context, childOptions)
    .pipe(
      Scope.provide(childScope),
      Effect.onError(() => Scope.close(childScope, Exit.void)),
      Effect.map((result): ChildRenderResult => ({ success: true, result, scope: childScope })),
      Effect.catchCause((cause) =>
        renderFallbackForError(cause).pipe(
          Effect.map((): ChildRenderResult => ({ success: false })),
        ),
      ),
    );

  if (childRenderResult.success) {
    currentResult = childRenderResult.result;
    currentScope = childRenderResult.scope;
    const inserted = yield* insertBeforeAnchor(currentResult.node);
    if (!inserted) {
      yield* cleanupCurrent;
    }

    yield* Debug.log({ event: "render.errorboundary.initial" });
  }

  return {
    node: anchor,
    cleanup: Effect.gen(function* () {
      isUnmounted = true;
      yield* cleanupCurrent;
      anchor.remove();
    }),
  };
});
