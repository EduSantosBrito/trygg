import { Effect, Predicate } from "effect";
import * as Context from "effect/Context";
import type { Element } from "./element.js";
import type {
  ErrorBoundaryHandler,
  RenderContext,
  RenderPreparation,
  RenderResult,
} from "./renderer.js";
import { resolveReconcileTarget } from "./render-utils.js";
import * as RenderTransaction from "./render-transaction.js";
import { cleanupAll, reportUnhandledRenderCause } from "./render-cleanup.js";

interface RenderOptions {
  readonly preparation?: RenderPreparation | undefined;
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
  const cleanupRenderedChildren = Effect.suspend(() =>
    cleanupAll(childResults.map((child) => RenderTransaction.cleanup(child))),
  );

  for (let index = 0; index < children.length; index++) {
    const child = children[index];
    if (child === undefined) continue;
    const result = yield* deps
      .renderElement(
        child,
        parent,
        renderContext,
        context,
        options.preparation === undefined
          ? options
          : { ...options, preparation: options.preparation.children[index] },
      )
      .pipe(
        Effect.onError(() =>
          cleanupRenderedChildren.pipe(
            Effect.catchCause((cause) => Effect.sync(() => reportUnhandledRenderCause(cause))),
          ),
        ),
      );
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
    cleanup: cleanupRenderedChildren,
    get preparation(): RenderPreparation {
      return {
        propertyValues: undefined,
        children: childResults.map((child) => child.preparation),
      };
    },
    reconcile: (
      nextElement: Element,
      nextContext: Context.Context<unknown> | null,
      preparation?: RenderPreparation,
    ) =>
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

          const outcome = yield* RenderTransaction.reconcile({
            previous: childResult,
            preparation: preparation?.children[index],
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
