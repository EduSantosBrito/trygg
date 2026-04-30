import { Data, Effect } from "effect";
import * as Context from "effect/Context";
import { Element, type ElementChildren } from "./element.js";
import type { ErrorBoundaryHandler, RenderContext, RenderResult } from "./renderer.js";

export class PortalTargetNotFoundError extends Data.TaggedError("PortalTargetNotFoundError")<{
  readonly target: HTMLElement | string;
}> {
  override get message() {
    return `Portal target not found: ${this.target}`;
  }
}

interface RenderOptions {
  readonly errorHandler: ErrorBoundaryHandler | null;
}

interface RenderPortalDeps {
  readonly renderElement: (
    element: Element,
    parent: Node,
    renderContext: RenderContext,
    context: Context.Context<unknown> | null,
    options: RenderOptions,
  ) => Effect.Effect<RenderResult, unknown, unknown>;
}

export const renderPortal = (
  target: HTMLElement | string,
  children: ElementChildren,
  parent: Node,
  renderContext: RenderContext,
  context: Context.Context<unknown> | null,
  options: RenderOptions,
  deps: RenderPortalDeps,
): Effect.Effect<RenderResult, unknown, unknown> =>
  Effect.gen(function* () {
    const targetElement = typeof target === "string" ? document.querySelector(target) : target;

    if (!targetElement) {
      return yield* new PortalTargetNotFoundError({ target });
    }

    const normalizedChildren = yield* Element.fromChildren(children);
    const childResults: Array<RenderResult> = [];
    for (const child of normalizedChildren) {
      const result = yield* deps.renderElement(child, targetElement, renderContext, context, options);
      childResults.push(result);
    }

    const portalAnchor = document.createComment("portal");
    parent.appendChild(portalAnchor);

    return {
      node: portalAnchor,
      cleanup: Effect.gen(function* () {
        for (const child of childResults) {
          yield* child.cleanup;
        }
        portalAnchor.remove();
      }),
    };
  });
