import { Effect, Predicate } from "effect";
import * as Context from "effect/Context";
import type { Element } from "./element.js";
import type { ErrorBoundaryHandler, RenderContext, RenderResult } from "./renderer.js";

interface RenderOptions {
  readonly errorHandler: ErrorBoundaryHandler | null;
}

interface RenderProvideDeps<R> {
  readonly renderElement: (
    element: Element,
    parent: Node,
    renderContext: RenderContext,
    context: Context.Context<unknown> | null,
    options: RenderOptions,
  ) => Effect.Effect<RenderResult, unknown, R>;
}

export const renderProvide: <R>(
  providedContext: Context.Context<unknown>,
  child: Element,
  parent: Node,
  renderContext: RenderContext,
  context: Context.Context<unknown> | null,
  options: RenderOptions,
  deps: RenderProvideDeps<R>,
) => Effect.Effect<RenderResult, unknown, R> = Effect.fn("renderProvide")(
  function* (providedContext, child, parent, renderContext, context, options, deps) {
    const mergedContext =
      context !== null ? Context.merge(context, providedContext) : providedContext;
    const childResult = yield* deps.renderElement(
      child,
      parent,
      renderContext,
      mergedContext,
      options,
    );

    return {
      get node() {
        return childResult.node;
      },
      cleanup: childResult.cleanup,
      reconcile: (nextElement: Element, nextContext: Context.Context<unknown> | null) =>
        Effect.gen(function* () {
          if (!Predicate.isTagged(nextElement, "Provide") || childResult.reconcile === undefined) {
            return false;
          }

          const nextMergedContext =
            nextContext !== null
              ? Context.merge(nextContext, nextElement.context)
              : nextElement.context;

          return yield* childResult.reconcile(nextElement.child, nextMergedContext);
        }),
    };
  },
);
