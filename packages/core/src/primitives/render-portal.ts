import { Effect, Exit, Schema, Scope } from "effect";
import * as Context from "effect/Context";
import { Element, type ElementChildren } from "./element.js";
import type { ErrorBoundaryHandler, RenderContext, RenderResult } from "./renderer.js";
import { cleanupAll } from "./render-cleanup.js";

export class PortalTargetNotFoundError extends Schema.TaggedError<PortalTargetNotFoundError>()(
  "PortalTargetNotFoundError",
  {
    target: Schema.Unknown,
  },
) {
  override get message() {
    return `Portal target not found: ${this.target}`;
  }
}

interface RenderOptions {
  readonly errorHandler: ErrorBoundaryHandler | null;
}

interface RenderPortalDeps<R> {
  readonly renderElement: (
    element: Element,
    parent: Node,
    renderContext: RenderContext,
    context: Context.Context<unknown> | null,
    options: RenderOptions,
  ) => Effect.Effect<RenderResult, unknown, R>;
}

export const renderPortal: <R>(
  target: HTMLElement | string,
  children: ElementChildren,
  parent: Node,
  renderContext: RenderContext,
  context: Context.Context<unknown> | null,
  options: RenderOptions,
  deps: RenderPortalDeps<R>,
) => Effect.Effect<RenderResult, unknown | PortalTargetNotFoundError, R> = Effect.fn(
  "renderPortal",
)(function* (target, children, parent, renderContext, context, options, deps) {
  const targetElement = typeof target === "string" ? document.querySelector(target) : target;

  if (!targetElement) {
    return yield* new PortalTargetNotFoundError({ target });
  }

  const normalizedChildren = yield* Element.fromChildren(children);
  const portalScope = yield* Scope.fork(renderContext.scope);
  const portalContext: RenderContext = { ...renderContext, scope: portalScope };
  const staged = document.createDocumentFragment();
  const childResults: Array<RenderResult> = [];
  let portalAnchor: Comment | null = null;

  const cleanupPortal = (exit: Exit.Exit<unknown, unknown>) =>
    Effect.suspend(() => {
      const cleanups: Array<Effect.Effect<void, unknown>> = [Scope.close(portalScope, exit)];
      for (let index = childResults.length - 1; index >= 0; index--) {
        const child = childResults[index];
        if (child !== undefined) {
          cleanups.push(Effect.provide(child.cleanup, portalContext.services));
        }
      }
      cleanups.push(Effect.sync(() => portalAnchor?.remove()));
      return cleanupAll(cleanups);
    });

  return yield* Effect.gen(function* () {
    for (const child of normalizedChildren) {
      const result = yield* deps
        .renderElement(child, staged, portalContext, context, options)
        .pipe(Scope.provide(portalScope));
      childResults.push(result);
    }

    targetElement.appendChild(staged);
    portalAnchor = document.createComment("portal");
    parent.appendChild(portalAnchor);

    return {
      node: portalAnchor,
      cleanup: cleanupPortal(Exit.void),
    } satisfies RenderResult;
  }).pipe(
    Effect.onExit((exit) =>
      Exit.isFailure(exit)
        ? cleanupPortal(Exit.asVoid(exit)).pipe(Effect.provide(renderContext.services))
        : Effect.void,
    ),
  );
});
