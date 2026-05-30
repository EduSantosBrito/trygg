import { Effect, Predicate } from "effect";
import * as Context from "effect/Context";
import type { Element } from "./element.js";
import type { ErrorBoundaryHandler, RenderContext, RenderResult } from "./renderer.js";
import { resolveReconcileTarget } from "./render-utils.js";
import { makeRenderTransaction } from "./render-transaction.js";

interface RenderOptions {
  readonly errorHandler: ErrorBoundaryHandler | null;
}

interface RenderFragmentDeps<E, R> {
  readonly renderElement: (
    element: Element,
    parent: Node,
    renderContext: RenderContext,
    context: Context.Context<unknown> | null,
    options: RenderOptions,
  ) => Effect.Effect<RenderResult, E, R>;
}

export const renderFragment: <E, R>(
  children: ReadonlyArray<Element>,
  parent: Node,
  renderContext: RenderContext,
  context: Context.Context<unknown> | null,
  options: RenderOptions,
  deps: RenderFragmentDeps<E, R>,
) => Effect.Effect<RenderResult, E, R> = Effect.fn("renderFragment")(function* <E, R>(
  children: ReadonlyArray<Element>,
  parent: Node,
  renderContext: RenderContext,
  context: Context.Context<unknown> | null,
  options: RenderOptions,
  deps: RenderFragmentDeps<E, R>,
) {
  const childResults: Array<RenderResult> = [];
  const renderTransaction = makeRenderTransaction();

  const cleanupRenderedChildren = Effect.gen(function* () {
    for (const child of childResults) {
      yield* renderTransaction.cleanup(child);
    }
  }).pipe(Effect.catchCause(() => Effect.void));

  for (const child of children) {
    const result = yield* deps
      .renderElement(child, parent, renderContext, context, options)
      .pipe(Effect.onError(() => cleanupRenderedChildren));
    childResults.push(result);
  }

  const maybeFirstChild = childResults[0];
  if (maybeFirstChild === undefined) {
    const emptyAnchor = document.createComment("fragment");
    parent.appendChild(emptyAnchor);
    return {
      node: emptyAnchor,
      cleanup: Effect.sync(() => emptyAnchor.remove()),
      reconcile: (nextElement: Element, nextContext: Context.Context<unknown> | null) =>
        Effect.sync(() => {
          const resolved = resolveReconcileTarget(nextElement, nextContext);
          return (
            Predicate.isTagged(resolved.element, "Fragment") &&
            resolved.element.children.length === 0
          );
        }),
    } satisfies RenderResult;
  }

  return {
    node: maybeFirstChild.node,
    cleanup: Effect.gen(function* () {
      for (const child of childResults) {
        yield* renderTransaction.cleanup(child);
      }
    }),
    reconcile: (nextElement: Element, nextContext: Context.Context<unknown> | null) =>
      Effect.gen(function* () {
        const resolved = resolveReconcileTarget(nextElement, nextContext);
        const resolvedNextElement = resolved.element;
        const resolvedNextContext = resolved.context;

        if (!Predicate.isTagged(resolvedNextElement, "Fragment")) return false;
        if (resolvedNextElement.children.length !== childResults.length) return false;

        for (let index = 0; index < childResults.length; index++) {
          const childResult = childResults[index];
          const nextChild = resolvedNextElement.children[index];
          if (
            childResult === undefined ||
            nextChild === undefined ||
            childResult.reconcile === undefined
          ) {
            return false;
          }

          const outcome = yield* renderTransaction.reconcile({
            previous: childResult,
            nextElement: nextChild,
            nextContext: resolvedNextContext,
            context: renderContext,
          });
          if (!Predicate.isTagged(outcome, "Reconciled")) return false;
        }

        return true;
      }),
  } satisfies RenderResult;
});
