import { Cause, Effect, Equal, Exit, Option, Schema, Scope } from "effect";
import * as Context from "effect/Context";
import * as Debug from "../debug/debug.js";
import * as Metrics from "../debug/metrics.js";
import * as ContractTrace from "../contract/trace.js";
import type { Element } from "./element.js";
import { unsafeBuildProviderContext } from "../internal/unsafe.js";
import { Element as ElementService } from "./element.js";
import * as Signal from "./signal.js";
import type { RenderContext, RenderResult } from "./renderer.js";
import {
  makeRenderTransaction,
  RenderTransactionOutcome,
  type RenderTransactionOutcome as RenderTransactionOutcomeType,
} from "./render-transaction.js";

type RuntimeRequirements = unknown;

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
  ) => Effect.Effect<RenderResult, unknown, RuntimeRequirements>;
  readonly provideRenderContext: <A, E, R>(
    effect: Effect.Effect<A, E, R>,
    renderContext: RenderContext,
    context: Context.Context<unknown> | null,
  ) => Effect.Effect<A, E, RuntimeRequirements>;
  readonly runForkInRenderContext: <A, E>(
    effect: Effect.Effect<A, E, RuntimeRequirements>,
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

export class ComponentAnchorError extends Schema.TaggedErrorClass<ComponentAnchorError>()(
  "ComponentAnchorError",
  { message: Schema.String },
) {}

const equalOrChanged = (left: unknown, right: unknown): boolean =>
  Effect.runSync(
    Effect.try({
      try: () => Equal.equals(left, right),
      catch: () => false,
    }).pipe(Effect.catch((equals) => Effect.succeed(equals))),
  );

export const renderComponent = Effect.fn("renderComponent")(function* (
  component: ComponentElement,
  parent: Node,
  runtime: RenderContext,
  context: Context.Context<unknown> | null,
  options: RenderComponentOptions,
  deps: RenderComponentDeps,
) {
  const { run, key, identity, inputs, provider = null } = component;
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
  let providerContext: Context.Context<unknown> | null = null;
  const renderTransaction = makeRenderTransaction({ emitTraceEvents: true });

  const componentScope = yield* Scope.fork(yield* Effect.scope);
  const providerScope = provider === null ? null : yield* Scope.fork(componentScope);
  const providerId = provider === null ? null : Debug.nextProviderId();
  const mergeProviderContext = (parentContext: Context.Context<unknown> | null) =>
    providerContext === null
      ? parentContext
      : Context.merge(deps.normalizeContext(parentContext), providerContext);

  if (provider !== null && providerScope !== null && providerId !== null) {
    const acquireStart = performance.now();
    const providerParentContext =
      currentContext === null
        ? null
        : Context.omit(
            Signal.CurrentRenderPhase,
            Signal.CurrentComponentScope,
            Signal.CurrentSignalOwner,
          )(currentContext);
    providerContext = yield* unsafeBuildProviderContext(
      provider.layer,
      providerScope,
      providerParentContext,
    ).pipe(
      Effect.provideService(Signal.CurrentRenderPhase, null),
      Effect.provideService(Signal.CurrentComponentScope, null),
      Effect.provideService(Signal.CurrentSignalOwner, "provider"),
      Effect.tapCause((cause) =>
        Effect.gen(function* () {
          const durationMs = performance.now() - acquireStart;
          yield* Debug.log({
            event: "provider.failure",
            provider_id: providerId,
            component: provider.displayName,
            reason: "failure",
            duration_ms: durationMs,
            cause: Cause.pretty(cause),
          });
          yield* ContractTrace.emit({
            event: "provider.failure",
            level: "semantic",
            payload: {
              provider_id: providerId,
              component: provider.displayName,
              reason: "failure",
              duration_ms: durationMs,
            },
          });
        }),
      ),
    );
    currentContext = mergeProviderContext(currentContext);
    const durationMs = performance.now() - acquireStart;
    yield* Metrics.recordProviderAcquisition;
    yield* Metrics.recordProviderAcquisitionDuration(durationMs);
    yield* Debug.log({
      event: "provider.acquire",
      provider_id: providerId,
      component: provider.displayName,
      reason: "mount",
      duration_ms: durationMs,
    });
    yield* ContractTrace.emit({
      event: "provider.acquire",
      level: "semantic",
      payload: {
        provider_id: providerId,
        component: provider.displayName,
        reason: "mount",
        duration_ms: durationMs,
      },
    });
  }

  const renderPhase = yield* Signal.makeRenderPhase;
  const rendererScope = yield* Effect.scope;
  let subscriptionCleanups: Array<Effect.Effect<void, unknown, RuntimeRequirements>> = [];

  const closeCurrentRenderScope: Effect.Effect<void, unknown, RuntimeRequirements> = Effect.gen(
    function* () {
      if (currentRenderScope !== null) {
        const scope = currentRenderScope;
        currentRenderScope = null;
        yield* Scope.close(scope, Exit.void);
      }
    },
  );

  const cleanupCurrent: Effect.Effect<void, unknown, RuntimeRequirements> = Effect.gen(
    function* () {
      if (currentResult !== null) {
        yield* renderTransaction.cleanup(currentResult);
        currentResult = null;
      }
      yield* closeCurrentRenderScope;
    },
  );

  const runComponentEffect: () => Effect.Effect<
    { element: Element; scope: Scope.Closeable },
    unknown,
    RuntimeRequirements
  > = Effect.fnUntraced(function* () {
    const effectWithContext = deps.provideRenderContext(currentRun(), runtime, currentContext);
    const renderScope = yield* Scope.fork(componentScope);
    const element = yield* Effect.provideService(
      Effect.provideService(
        Effect.provideService(
          Effect.provideService(effectWithContext, Signal.CurrentRenderPhase, renderPhase),
          Signal.CurrentComponentScope,
          componentScope,
        ),
        Signal.CurrentRenderScope,
        renderScope,
      ),
      Signal.CurrentSignalOwner,
      "component",
    ).pipe(
      Scope.provide(componentScope),
      Effect.onError(() => Scope.close(renderScope, Exit.void)),
    );
    return { element, scope: renderScope };
  });

  const renderAndPosition = Effect.fnUntraced(function* (childElement: Element) {
    const actualParent = anchor.parentNode;
    if (actualParent === null) {
      return yield* new ComponentAnchorError({
        message: "Component anchor has no parent - component may have been unmounted",
      });
    }
    const result = yield* deps
      .renderElement(childElement, actualParent, runtime, currentContext, options)
      .pipe(Effect.provideService(Signal.CurrentRenderPhase, null));

    const tryInsert = (parentNode: Node | null): Effect.Effect<boolean> =>
      parentNode === null
        ? Effect.succeed(false)
        : Effect.try({
            try: () => {
              parentNode.insertBefore(result.node, anchor);
              return true;
            },
            catch: () => false,
          }).pipe(Effect.catch((inserted) => Effect.succeed(inserted)));

    const firstInsert = yield* tryInsert(anchor.parentNode);
    const inserted = firstInsert ? true : yield* tryInsert(anchor.parentNode);

    if (!inserted) {
      yield* result.cleanup;
      return { node: anchor, cleanup: Effect.void };
    }

    return result;
  });

  const onRerenderFailure = Effect.fnUntraced(function* (cause: Cause.Cause<unknown>) {
    yield* Debug.log({
      event: "render.component.rerender",
      trigger: "error",
      reason: Cause.pretty(cause),
    });

    if (options.errorHandler !== null) {
      options.errorHandler(cause);
    }

    isRerendering = false;
    pendingRerender = false;
  });

  type RerenderFailureMode = "preserve" | "defect";

  const rerenderEffectBody = Effect.fnUntraced(function* () {
    if (isUnmounted) {
      isRerendering = false;
      pendingRerender = false;
      return;
    }

    const rerenderStart = performance.now();
    if (provider !== null && providerId !== null) {
      yield* Debug.log({
        event: "provider.reuse",
        provider_id: providerId,
        component: provider.displayName,
        reason: "rerender",
      });
      yield* ContractTrace.emit({
        event: "provider.reuse",
        level: "semantic",
        payload: {
          provider_id: providerId,
          component: provider.displayName,
          reason: "rerender",
        },
      });
    }
    yield* Signal.resetRenderPhase(renderPhase);

    const nextRender = yield* runComponentEffect();
    const nextElement = yield* ElementService.fromUnknown(nextRender.element);
    const reconcileOutcome: Option.Option<RenderTransactionOutcomeType> =
      currentResult === null
        ? Option.none()
        : Option.some(
            yield* renderTransaction.reconcile({
              previous: currentResult,
              nextElement,
              nextContext: currentContext,
              context: runtime,
            }),
          );

    if (
      Option.isSome(reconcileOutcome) &&
      RenderTransactionOutcome.$is("Reconciled")(reconcileOutcome.value)
    ) {
      yield* closeCurrentRenderScope;
      currentRenderScope = nextRender.scope;
    } else {
      const actualParent = anchor.parentNode;
      if (actualParent === null) {
        yield* Scope.close(nextRender.scope, Exit.void);
        return yield* new ComponentAnchorError({
          message:
            "Component anchor has no parent - component may have been unmounted during rerender",
        });
      }
      // Render the replacement subtree off-DOM into a fragment so the
      // user never sees the new tree mid-construction next to the old
      // one. The previous renderAndPosition path mounted progressively
      // into actualParent, producing visible "two trees coexisting"
      // flashes under CPU throttling.
      const tempFragment = document.createDocumentFragment();
      const previousResult = currentResult;
      const outcome = yield* renderTransaction.replace({
        parent: actualParent,
        previous: previousResult === null ? Option.none() : Option.some(previousResult),
        renderNext: deps
          .renderElement(nextElement, tempFragment, runtime, currentContext, options)
          .pipe(
            Effect.provideService(Signal.CurrentRenderPhase, null),
            Effect.onError(() => Scope.close(nextRender.scope, Exit.void)),
          ),
        context: runtime,
      });

      if (RenderTransactionOutcome.$is("FailedBeforeCommit")(outcome)) {
        yield* Scope.close(nextRender.scope, Exit.void);
        return yield* Effect.fail(outcome.cause);
      }

      if (currentRenderScope !== null) {
        yield* Scope.close(currentRenderScope, Exit.void);
      }
      currentRenderScope = nextRender.scope;
      currentResult = outcome.result;
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
  });

  const rerenderEffect = (failureMode: RerenderFailureMode) =>
    rerenderEffectBody().pipe(
      Effect.catchCause((cause) =>
        failureMode === "defect" && options.errorHandler === null
          ? Effect.ensuring(
              Effect.failCause(cause),
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
  ) => Effect.Effect<void, unknown, RuntimeRequirements> = Effect.fnUntraced(function* (
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
      const providerFinalizeStart = providerId === null ? null : performance.now();
      yield* Scope.close(componentScope, Exit.void);
      if (provider !== null && providerId !== null && providerFinalizeStart !== null) {
        const durationMs = performance.now() - providerFinalizeStart;
        yield* Metrics.recordProviderFinalization;
        yield* Metrics.recordProviderFinalizationDuration(durationMs);
        yield* Debug.log({
          event: "provider.finalize",
          provider_id: providerId,
          component: provider.displayName,
          reason: "unmount",
          duration_ms: durationMs,
        });
        yield* ContractTrace.emit({
          event: "provider.finalize",
          level: "semantic",
          payload: {
            provider_id: providerId,
            component: provider.displayName,
            reason: "unmount",
            duration_ms: durationMs,
          },
        });
      }
      anchor.remove();
    }),
    reconcile: (nextElement: Element, nextContext: Context.Context<unknown> | null) =>
      Effect.gen(function* () {
        const resolved = deps.resolveReconcileTarget(nextElement, nextContext);
        const resolvedNextElement = resolved.element;
        const resolvedNextContext = resolved.context;

        if (!ElementService.$is("Component")(resolvedNextElement)) {
          return false;
        }

        if (resolvedNextElement.key !== key) {
          if (provider !== null && providerId !== null) {
            yield* Debug.log({
              event: "provider.replace",
              provider_id: providerId,
              component: provider.displayName,
              reason: "key-change",
            });
            yield* ContractTrace.emit({
              event: "provider.replace",
              level: "semantic",
              payload: {
                provider_id: providerId,
                component: provider.displayName,
                reason: "key-change",
              },
            });
          }
          return false;
        }

        if (resolvedNextElement.provider?.layer !== provider?.layer) {
          if (provider !== null && providerId !== null) {
            yield* Debug.log({
              event: "provider.replace",
              provider_id: providerId,
              component: provider.displayName,
              reason: "identity-change",
            });
            yield* ContractTrace.emit({
              event: "provider.replace",
              level: "semantic",
              payload: {
                provider_id: providerId,
                component: provider.displayName,
                reason: "identity-change",
              },
            });
          }
          return false;
        }

        const sameIdentity =
          identity !== undefined
            ? resolvedNextElement.identity === identity
            : resolvedNextElement.identity === identity && resolvedNextElement.run === currentRun;

        if (!sameIdentity) {
          if (provider !== null && providerId !== null) {
            yield* Debug.log({
              event: "provider.replace",
              provider_id: providerId,
              component: provider.displayName,
              reason: "identity-change",
            });
            yield* ContractTrace.emit({
              event: "provider.replace",
              level: "semantic",
              payload: {
                provider_id: providerId,
                component: provider.displayName,
                reason: "identity-change",
              },
            });
          }
          return false;
        }

        const inputsChanged = !equalOrChanged(currentInputs, resolvedNextElement.inputs);
        const effectiveNextContext = mergeProviderContext(resolvedNextContext);
        const contextChanged = !equalOrChanged(
          deps.normalizeContext(currentContext),
          deps.normalizeContext(effectiveNextContext),
        );

        currentRun = resolvedNextElement.run;
        currentInputs = resolvedNextElement.inputs;
        currentContext = effectiveNextContext;

        if (!inputsChanged && !contextChanged) {
          if (provider !== null && providerId !== null) {
            yield* Debug.log({
              event: "provider.reuse",
              provider_id: providerId,
              component: provider.displayName,
              reason: "rerender",
            });
            yield* ContractTrace.emit({
              event: "provider.reuse",
              level: "semantic",
              payload: {
                provider_id: providerId,
                component: provider.displayName,
                reason: "rerender",
              },
            });
          }
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
