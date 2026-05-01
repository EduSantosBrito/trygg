import { Cause, Effect, Equal, Exit, Scope } from "effect";
import * as Context from "effect/Context";
import * as Debug from "../debug/debug.js";
import * as Metrics from "../debug/metrics.js";
import type { Element } from "./element.js";
import { Element as ElementService } from "./element.js";
import * as Signal from "./signal.js";
import type { RenderContext, RenderResult } from "./renderer.js";

export interface RenderComponentOptions {
  readonly errorHandler: ((cause: Cause.Cause<unknown>) => void) | null;
}

export interface RenderComponentDeps {
  readonly renderElement: (
    element: Element,
    parent: Node,
    runtime: RenderContext,
    context: Context.Context<unknown> | null,
    options: RenderComponentOptions,
  ) => Effect.Effect<RenderResult, unknown, unknown>;
  readonly provideRenderContext: <A, E, R>(
    effect: Effect.Effect<A, E, R>,
    renderContext: RenderContext,
    context: Context.Context<unknown> | null,
  ) => Effect.Effect<A, E, unknown>;
  readonly runForkInRenderContext: <A, E>(
    effect: Effect.Effect<A, E, unknown>,
    renderContext: RenderContext,
    context: Context.Context<unknown> | null,
  ) => void;
  readonly resolveReconcileTarget: (
    element: Element,
    context: Context.Context<unknown> | null,
  ) => { readonly element: Element; readonly context: Context.Context<unknown> | null };
  readonly normalizeContext: (context: Context.Context<unknown> | null) => Context.Context<unknown>;
}

type ComponentElement = Extract<Element, { readonly _tag: "Component" }>;

export class ComponentAnchorError extends Error {
  readonly _tag = "ComponentAnchorError";

  constructor(readonly details: { readonly message: string }) {
    super(details.message);
  }
}

const equalOrChanged = (left: unknown, right: unknown): boolean => {
  try {
    return Equal.equals(left, right);
  } catch {
    return false;
  }
};

export const renderComponent = (
  component: ComponentElement,
  parent: Node,
  runtime: RenderContext,
  context: Context.Context<unknown> | null,
  options: RenderComponentOptions,
  deps: RenderComponentDeps,
): Effect.Effect<RenderResult, unknown, unknown> =>
  Effect.gen(function* () {
    const { run, key, identity, inputs } = component;
    const anchor = document.createComment("component");
    parent.appendChild(anchor);

    let currentResult: RenderResult | null = null;
    let currentRenderScope: Scope.Closeable | null = null;
    let isRerendering = false;
    let isUnmounted = false;
    let pendingRerender = false;
    let renderCount = 0;
    let currentRun = run;
    let currentInputs = inputs;
    let currentContext = context;

    const componentScope = yield* Scope.fork(yield* Effect.scope);
    const renderPhase = yield* Signal.makeRenderPhase;
    const rendererScope = yield* Effect.scope;
    let subscriptionCleanups: Array<Effect.Effect<void, unknown, unknown>> = [];

    const closeCurrentRenderScope: Effect.Effect<void, unknown, unknown> = Effect.gen(function* () {
      if (currentRenderScope !== null) {
        const scope = currentRenderScope;
        currentRenderScope = null;
        yield* Scope.close(scope, Exit.void);
      }
    });

    const cleanupCurrent: Effect.Effect<void, unknown, unknown> = Effect.gen(function* () {
      if (currentResult !== null) {
        yield* currentResult.cleanup;
        currentResult = null;
      }
      yield* closeCurrentRenderScope;
    });

    const runComponentEffect: () => Effect.Effect<
      { element: Element; scope: Scope.Closeable },
      unknown,
      unknown
    > = Effect.fnUntraced(function* () {
      const effectWithContext = deps.provideRenderContext(currentRun(), runtime, currentContext);
      const renderScope = yield* Scope.fork(componentScope);
      const element = yield* Effect.provideService(
        Effect.provideService(
          Effect.provideService(effectWithContext, Signal.CurrentRenderPhase, renderPhase),
          Signal.CurrentComponentScope,
          componentScope,
        ),
        Signal.CurrentRenderScope,
        renderScope,
      ).pipe(
        Scope.provide(componentScope),
        Effect.onError(() => Scope.close(renderScope, Exit.void)),
      );
      return { element, scope: renderScope };
    });

    const renderAndPosition = Effect.fnUntraced(function* (childElement: Element) {
      const actualParent = anchor.parentNode;
      if (actualParent === null) {
        return yield* Effect.fail(
          new ComponentAnchorError({
            message: "Component anchor has no parent - component may have been unmounted",
          }),
        );
      }
      const result = yield* deps
        .renderElement(childElement, actualParent, runtime, currentContext, options)
        .pipe(Effect.provideService(Signal.CurrentRenderPhase, null));

      const inserted = yield* Effect.sync(() => {
        const tryInsert = (parentNode: Node | null): boolean => {
          if (parentNode === null) return false;
          try {
            parentNode.insertBefore(result.node, anchor);
            return true;
          } catch {
            return false;
          }
        };

        if (tryInsert(anchor.parentNode)) return true;
        if (tryInsert(anchor.parentNode)) return true;
        return false;
      });

      if (!inserted) {
        yield* result.cleanup;
        return { node: anchor, cleanup: Effect.void };
      }

      return result;
    });

    const onRerenderFailure = (cause: Cause.Cause<unknown>) =>
      Effect.gen(function* () {
        yield* Debug.log({
          event: "render.component.rerender",
          trigger: "error",
          reason: String(cause),
        });

        if (options.errorHandler !== null) {
          options.errorHandler(cause);
        }

        isRerendering = false;
        pendingRerender = false;
      });

    type RerenderFailureMode = "preserve" | "defect";

    const rerenderEffect = (failureMode: RerenderFailureMode) =>
      Effect.gen(function* () {
        if (isUnmounted) {
          isRerendering = false;
          pendingRerender = false;
          return;
        }

        const rerenderStart = performance.now();
        yield* Signal.resetRenderPhase(renderPhase);

        const nextRender = yield* runComponentEffect();
        const nextElement = yield* ElementService.fromUnknown(nextRender.element);
        const reused =
          currentResult !== null && currentResult.reconcile !== undefined
            ? yield* currentResult.reconcile(nextElement, currentContext)
            : false;

        if (reused) {
          yield* closeCurrentRenderScope;
          currentRenderScope = nextRender.scope;
        } else {
          const actualParent = anchor.parentNode;
          if (actualParent === null) {
            yield* Scope.close(nextRender.scope, Exit.void);
            return yield* Effect.fail(
              new ComponentAnchorError({
                message:
                  "Component anchor has no parent - component may have been unmounted during rerender",
              }),
            );
          }
          // Render the replacement subtree off-DOM into a fragment so the
          // user never sees the new tree mid-construction next to the old
          // one. The previous renderAndPosition path mounted progressively
          // into actualParent, producing visible "two trees coexisting"
          // flashes under CPU throttling.
          const tempFragment = document.createDocumentFragment();
          const nextResult = yield* deps
            .renderElement(nextElement, tempFragment, runtime, currentContext, options)
            .pipe(
              Effect.provideService(Signal.CurrentRenderPhase, null),
              Effect.onError(() => Scope.close(nextRender.scope, Exit.void)),
            );
          actualParent.insertBefore(tempFragment, anchor);
          yield* cleanupCurrent;
          currentRenderScope = nextRender.scope;
          currentResult = nextResult;
        }

        const rerenderDuration = performance.now() - rerenderStart;
        yield* Metrics.recordComponentRender;
        yield* Metrics.recordRenderDuration(rerenderDuration);

        const needsAnotherRender = pendingRerender;
        isRerendering = false;
        pendingRerender = false;

        yield* subscribeToSignals(renderPhase.accessed);

        if (needsAnotherRender) {
          scheduleRerender();
        }
      }).pipe(
        Effect.catchCause((cause) =>
          failureMode === "defect" && options.errorHandler === null
            ? Effect.ensuring(
                Effect.die(Cause.squash(cause)),
                Effect.gen(function* () {
                  isRerendering = false;
                  pendingRerender = false;
                  yield* cleanupCurrent.pipe(Effect.catchCause(() => Effect.void));
                }),
              )
            : onRerenderFailure(cause),
        ),
        Scope.provide(rendererScope),
      );

    let scheduleRerender: () => void;

    const doRerender = (): void => {
      renderCount++;
      deps.runForkInRenderContext(rerenderEffect("preserve"), runtime, currentContext);
    };

    scheduleRerender = () => {
      if (isUnmounted) return;

      if (isRerendering) {
        pendingRerender = true;
        return;
      }

      isRerendering = true;
      queueMicrotask(doRerender);
    };

    const subscribeToSignals: (
      signals: Set<Signal.Signal<unknown>>,
    ) => Effect.Effect<void, unknown, unknown> = Effect.fnUntraced(function* (
      signals: Set<Signal.Signal<unknown>>,
    ) {
      const oldCleanups = subscriptionCleanups;
      for (const cleanup of oldCleanups) {
        yield* cleanup;
      }
      subscriptionCleanups = [];

      if (signals.size === 0) return;

      for (const signal of signals) {
        const unsubscribe = yield* Signal.subscribe(signal, () => Effect.sync(scheduleRerender));
        subscriptionCleanups.push(unsubscribe);
      }
    });

    const renderStart = performance.now();
    const initialRender = yield* runComponentEffect();
    const initialElement = yield* ElementService.fromUnknown(initialRender.element);
    const initialResult = yield* renderAndPosition(initialElement).pipe(
      Effect.onError(() => Scope.close(initialRender.scope, Exit.void)),
    );
    currentRenderScope = initialRender.scope;
    currentResult = initialResult;
    const renderDuration = performance.now() - renderStart;
    renderCount++;

    yield* Debug.log({
      event: "render.component.initial",
      accessed_signals: renderPhase.accessed.size,
      duration_ms: renderDuration,
    });

    yield* Metrics.recordComponentRender;
    yield* Metrics.recordRenderDuration(renderDuration);
    yield* subscribeToSignals(renderPhase.accessed);

    return {
      node: anchor,
      cleanup: Effect.gen(function* () {
        isUnmounted = true;
        for (const cleanup of subscriptionCleanups) {
          yield* cleanup;
        }
        subscriptionCleanups = [];
        yield* cleanupCurrent;
        yield* Scope.close(componentScope, Exit.void);
        anchor.remove();
      }),
      reconcile: (nextElement: Element, nextContext: Context.Context<unknown> | null) =>
        Effect.gen(function* () {
          const resolved = deps.resolveReconcileTarget(nextElement, nextContext);
          const resolvedNextElement = resolved.element;
          const resolvedNextContext = resolved.context;

          if (resolvedNextElement._tag !== "Component" || resolvedNextElement.key !== key) {
            return false;
          }

          const sameIdentity =
            identity !== undefined
              ? resolvedNextElement.identity === identity
              : resolvedNextElement.identity === identity && resolvedNextElement.run === currentRun;

          if (!sameIdentity) {
            return false;
          }

          const inputsChanged = !equalOrChanged(currentInputs, resolvedNextElement.inputs);
          const contextChanged = !equalOrChanged(
            deps.normalizeContext(currentContext),
            deps.normalizeContext(resolvedNextContext),
          );

          currentRun = resolvedNextElement.run;
          currentInputs = resolvedNextElement.inputs;
          currentContext = resolvedNextContext;

          if (!inputsChanged && !contextChanged) {
            return true;
          }

          if (isRerendering) {
            pendingRerender = true;
            return true;
          }

          isRerendering = true;
          renderCount++;
          yield* rerenderEffect("defect");
          return true;
        }),
    };
  });
