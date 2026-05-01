import { Effect, Scope, Exit } from "effect";
import * as Context from "effect/Context";
import { Element, isElement } from "./element.js";
import * as Signal from "./signal.js";
import * as Debug from "../debug/debug.js";
import type { ErrorBoundaryHandler, RenderContext, RenderResult } from "./renderer.js";

interface RenderOptions {
  readonly errorHandler: ErrorBoundaryHandler | null;
}

interface RenderSignalElementDeps {
  readonly renderElement: (
    element: Element,
    parent: Node,
    renderContext: RenderContext,
    context: Context.Context<unknown> | null,
    options: RenderOptions,
  ) => Effect.Effect<RenderResult, unknown, unknown>;
  readonly runForkInRenderContext: (
    effect: Effect.Effect<void, unknown, unknown>,
    renderContext: RenderContext,
    context: Context.Context<unknown> | null,
  ) => void;
}

export const renderSignalElement = (
  signal: Signal.Signal<unknown>,
  onSwap: Effect.Effect<void, unknown, unknown> | undefined,
  parent: Node,
  renderContext: RenderContext,
  context: Context.Context<unknown> | null,
  options: RenderOptions,
  deps: RenderSignalElementDeps,
): Effect.Effect<RenderResult, unknown, unknown> =>
  Effect.gen(function* () {
    const anchor = document.createComment("signal-element");
    parent.appendChild(anchor);

    let currentResult: RenderResult | null = null;
    let currentScope: Scope.Closeable | null = null;
    let isUnmounted = false;
    let swapVersion = 0;

    const renderValue = (value: unknown): Element =>
      isElement(value) ? value : Element.Text({ content: String(value) });

    const cleanupCurrent: Effect.Effect<void, unknown, unknown> = Effect.gen(function* () {
      if (currentResult !== null) {
        yield* currentResult.cleanup;
        currentResult = null;
      }
      if (currentScope !== null) {
        const scope = currentScope;
        currentScope = null;
        yield* Scope.close(scope, Exit.void);
      }
    });

    const renderWithScope: (
      value: unknown,
    ) => Effect.Effect<{ result: RenderResult; scope: Scope.Closeable }, unknown, unknown> =
      Effect.fnUntraced(function* (value: unknown) {
        const scope = yield* Scope.fork(yield* Effect.scope);
        const element = renderValue(value);
        const result = yield* deps
          .renderElement(element, parent, renderContext, context, options)
          .pipe(
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
            const result = yield* deps
              .renderElement(element, tempFragment, renderContext, context, options)
              .pipe(
                Scope.provide(scope),
                Effect.onError(() => Scope.close(scope, Exit.void)),
              );

            if (myVersion !== swapVersion) {
              yield* result.cleanup;
              yield* Scope.close(scope, Exit.void);
              return;
            }

            // Insert the replacement BEFORE cleaning the old subtree so that
            // the document never goes through a blank frame. The previous
            // tree's finalizers see the replacement already mounted.
            const actualParent = anchor.parentNode;
            if (actualParent !== null) {
              actualParent.insertBefore(tempFragment, anchor);
            }

            const oldResult = currentResult;
            const oldScope = currentScope;
            currentResult = result;
            currentScope = scope;

            if (oldResult !== null) {
              yield* oldResult.cleanup;
            }
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
                  reason: String(cause),
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
