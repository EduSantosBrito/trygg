import { Cause, Effect, Exit, Option, Predicate, Scope } from "effect";
import * as Context from "effect/Context";
import { Element, isElement } from "./element.js";
import * as Signal from "./signal.js";
import * as Debug from "../debug/debug.js";
import type { ErrorBoundaryHandler, RenderContext, RenderResult } from "./renderer.js";
import { makeRenderTransaction, type RenderTransactionOutcome } from "./render-transaction.js";

interface RenderOptions {
  readonly errorHandler: ErrorBoundaryHandler | null;
}

interface RenderSignalElementDeps<E, R> {
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

type FailedBeforeCommit = Extract<
  RenderTransactionOutcome,
  { readonly _tag: "FailedBeforeCommit" }
>;

const isFailedBeforeCommit = (outcome: RenderTransactionOutcome): outcome is FailedBeforeCommit =>
  Predicate.isTagged(outcome, "FailedBeforeCommit");

export const renderSignalElement = Effect.fn("renderSignalElement")(function* <E, R>(
  signal: Signal.Signal<unknown>,
  onSwap: Effect.Effect<void, unknown, R> | undefined,
  parent: Node,
  renderContext: RenderContext,
  context: Context.Context<unknown> | null,
  options: RenderOptions,
  deps: RenderSignalElementDeps<E, R>,
) {
  const anchor = document.createComment("signal-element");
  parent.appendChild(anchor);

  let currentResult: RenderResult | null = null;
  let currentScope: Scope.Closeable | null = null;
  let isUnmounted = false;
  let swapVersion = 0;
  const renderTransaction = makeRenderTransaction({ emitTraceEvents: true });

  const renderValue = (value: unknown): Element =>
    isElement(value) ? value : Element.Text({ content: String(value) });

  const cleanupCurrent: Effect.Effect<void, unknown, R> = Effect.gen(function* () {
    if (currentResult !== null) {
      yield* renderTransaction.cleanup(currentResult);
      currentResult = null;
    }
    if (currentScope !== null) {
      const scope = currentScope;
      currentScope = null;
      yield* Scope.close(scope, Exit.void);
    }
  });

  const renderWithScope = Effect.fnUntraced(function* (value: unknown) {
    const scope = yield* Scope.fork(yield* Effect.scope);
    const element = renderValue(value);
    const result = yield* deps.renderElement(element, parent, renderContext, context, options).pipe(
      Scope.provide(scope),
      Effect.onError(() => Scope.close(scope, Exit.void)),
    );
    return { result, scope };
  });

  const initialValue = yield* Signal.get(signal);
  const initialRender = yield* renderWithScope(initialValue);
  currentResult = initialRender.result;
  currentScope = initialRender.scope;
  parent.insertBefore(currentResult.node, anchor);

  yield* Debug.log({ event: "render.signalelement.initial", signal_id: signal._debugId });

  const unsubscribe = yield* Signal.subscribe(signal, () =>
    Effect.sync(() => {
      if (isUnmounted) return;

      const myVersion = ++swapVersion;

      deps.runForkInRenderContext(
        Effect.gen(function* () {
          const newValue = yield* Signal.get(signal);
          const element = renderValue(newValue);

          // Reconcile in place when the new value's outer Component matches
          // the current one by key/identity. Without this, sibling-route
          // navigation (e.g. /docs/signals → /docs/resources) tears down
          // and remounts the entire shared layout subtree.
          if (currentResult !== null && currentResult.reconcile !== undefined) {
            const reconciled = yield* currentResult
              .reconcile(element, context)
              .pipe(Effect.catchCause(() => Effect.succeed(false)));
            if (reconciled) {
              if (myVersion !== swapVersion) return;
              if (onSwap !== undefined) {
                yield* onSwap;
              }
              yield* Debug.log({
                event: "render.signalelement.reconcile",
                signal_id: signal._debugId,
              });
              return;
            }
          }

          const tempFragment = document.createDocumentFragment();
          const scope = yield* Scope.fork(yield* Effect.scope);
          const renderNext = deps
            .renderElement(element, tempFragment, renderContext, context, options)
            .pipe(
              Scope.provide(scope),
              Effect.onError(() => Scope.close(scope, Exit.void)),
            );

          if (myVersion !== swapVersion) {
            yield* Scope.close(scope, Exit.void);
            return;
          }

          const actualParent = anchor.parentNode;
          if (actualParent === null) {
            yield* Scope.close(scope, Exit.void);
            return;
          }

          const oldScope = currentScope;
          const outcome = yield* renderTransaction.replace({
            parent: actualParent,
            previous: currentResult === null ? Option.none() : Option.some(currentResult),
            renderNext,
            context: renderContext,
          });

          if (isFailedBeforeCommit(outcome)) {
            yield* Scope.close(scope, Exit.void);
            return yield* Effect.fail(outcome.cause);
          }

          currentResult = outcome.result;
          currentScope = scope;

          if (oldScope !== null) {
            yield* Scope.close(oldScope, Exit.void);
          }

          if (onSwap !== undefined) {
            yield* onSwap;
          }

          yield* Debug.log({ event: "render.signalelement.swap", signal_id: signal._debugId });
        }).pipe(
          Effect.catchCause((cause) =>
            Effect.gen(function* () {
              yield* Debug.log({
                event: "render.signalelement.swap",
                trigger: "error",
                signal_id: signal._debugId,
                reason: Cause.pretty(cause),
              });

              if (options.errorHandler !== null) {
                options.errorHandler(cause);
              }
            }),
          ),
        ),
        renderContext,
        context,
      );
    }),
  );

  return {
    node: anchor,
    cleanup: Effect.gen(function* () {
      isUnmounted = true;
      yield* unsubscribe;
      yield* cleanupCurrent;
      anchor.remove();
    }),
  };
});
