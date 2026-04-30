import { Effect } from "effect";
import * as Context from "effect/Context";
import type { Element } from "./element.js";
import type { ErrorBoundaryHandler, RenderContext, RenderResult } from "./renderer.js";

interface RenderOptions {
  readonly errorHandler: ErrorBoundaryHandler | null;
}

interface RenderFragmentDeps {
  readonly renderElement: (
    element: Element,
    parent: Node,
    renderContext: RenderContext,
    context: Context.Context<unknown> | null,
    options: RenderOptions,
  ) => Effect.Effect<RenderResult, unknown, unknown>;
}

export const renderFragment = (
  children: ReadonlyArray<Element>,
  parent: Node,
  renderContext: RenderContext,
  context: Context.Context<unknown> | null,
  options: RenderOptions,
  deps: RenderFragmentDeps,
): Effect.Effect<RenderResult, unknown, unknown> =>
  Effect.gen(function* () {
    const fragment = document.createDocumentFragment();
    const childResults: Array<RenderResult> = [];

    for (const child of children) {
      const result = yield* deps.renderElement(child, fragment, renderContext, context, options);
      childResults.push(result);
    }

    parent.appendChild(fragment);

    const maybeFirstChild = childResults[0];
    if (maybeFirstChild === undefined) {
      const emptyAnchor = document.createComment("fragment");
      parent.appendChild(emptyAnchor);
      return {
        node: emptyAnchor,
        cleanup: Effect.sync(() => emptyAnchor.remove()),
      };
    }

    return {
      node: maybeFirstChild.node,
      cleanup: Effect.gen(function* () {
        for (const child of childResults) {
          yield* child.cleanup;
        }
      }),
    };
  });
