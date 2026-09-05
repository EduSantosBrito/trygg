import { Cause, Effect, Equal, Exit, Option, Predicate, Schema, Scope } from "effect";
import * as Context from "effect/Context";
import * as Metrics from "../debug/metrics.js";
import * as Trace from "../trace/index.js";
import * as Ids from "../internal/ids.js";
import type { Element } from "./element.js";
import { unsafeBuildProviderContext } from "../internal/unsafe.js";
import { Element as ElementService } from "./element.js";
import * as Signal from "./signal.js";
import type { RenderContext, RenderResult } from "./renderer.js";
import * as RenderTransaction from "./render-transaction.js";
import { cleanupAll, reportUnhandledRenderCause } from "./render-cleanup.js";

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

export class ComponentAnchorError extends Schema.TaggedError<ComponentAnchorError>()(
  "ComponentAnchorError",
  { message: Schema.String },
) {}

// A "transient" reconcile failure does NOT indicate a defect in the component
// itself — it means a newer, latest-wins render has already superseded this one
// mid-flight:
//   - ComponentAnchorError: a concurrent render detached this component's anchor.
//   - StaleRouteRender (router/outlet-services): the router advanced to another
//     route while this layout/route element was still rendering.
// On these, the reconcile-driven defect path must PRESERVE the current subtree
// (let the newer render win) instead of tearing it down. Tearing down here is
// what blanked the whole layout under fast docs navigation, then laundered the
// re-raise into a full REPLACE/remount with duplicate orphan nodes. Tags are
// matched by string so the renderer stays decoupled from the router and survives
// module duplication (instanceof can fail across duplicated module copies).
const TRANSIENT_FAILURE_TAGS: ReadonlySet<string> = new Set([
  "ComponentAnchorError",
  "StaleRouteRender",
]);

const hasTransientTag = (error: unknown): boolean =>
  Predicate.hasProperty(error, "_tag") &&
  typeof error._tag === "string" &&
  TRANSIENT_FAILURE_TAGS.has(error._tag);

const isTransientRenderFailure = (cause: Cause.Cause<unknown>): boolean => {
  // squash extracts the representative reason (a failure is preferred over a
  // defect), which is how StaleRouteRender / ComponentAnchorError surface here.
  if (hasTransientTag(Cause.squash(cause))) return true;
  const firstError = Cause.findErrorOption(cause);
  return Option.isSome(firstError) && hasTransientTag(firstError.value);
};

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
  const componentScope = yield* Scope.fork(yield* Effect.scope);
  const componentRuntime: RenderContext = { ...runtime, scope: componentScope };
  const providerScope = provider === null ? null : yield* Scope.fork(componentScope);
  const providerId = provider === null ? null : Ids.nextProviderId();
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
        Trace.emit("provider.failure", () => ({
          provider_id: providerId,
          component: provider.displayName,
          reason: "failure",
          duration_ms: performance.now() - acquireStart,
          cause_type: Trace.causeValueType(cause),
        })),
      ),
      Effect.onExit((exit) =>
        Exit.isFailure(exit)
          ? cleanupAll([
              Scope.close(componentScope, Exit.asVoid(exit)),
              Effect.sync(() => anchor.remove()),
            ])
          : Effect.void,
      ),
    );
    currentContext = mergeProviderContext(currentContext);
    const durationMs = performance.now() - acquireStart;
    yield* Metrics.recordProviderAcquisition;
    yield* Metrics.recordProviderAcquisitionDuration(durationMs);
    yield* Trace.emit("provider.acquire", () => ({
      provider_id: providerId,
      component: provider.displayName,
      reason: "mount",
      duration_ms: durationMs,
    }));
  }

  const renderPhase = yield* Signal.makeRenderPhase;
  let subscriptionCleanups: Array<Effect.Effect<void, unknown, RuntimeRequirements>> = [];

  const cleanupCurrent: Effect.Effect<void, unknown, RuntimeRequirements> = Effect.gen(
    function* () {
      const result = currentResult;
      const scope = currentRenderScope;
      currentResult = null;
      currentRenderScope = null;
      const cleanups: Array<Effect.Effect<void, unknown, RuntimeRequirements>> = [];
      if (result !== null) cleanups.push(RenderTransaction.cleanup(result));
      if (scope !== null) cleanups.push(Scope.close(scope, Exit.void));
      yield* cleanupAll(cleanups);
    },
  );

  const runComponentEffect: () => Effect.Effect<
    { element: Element; scope: Scope.Closeable },
    unknown,
    RuntimeRequirements
  > = Effect.fnUntraced(function* () {
    const effectWithContext = deps.provideRenderContext(
      currentRun(),
      componentRuntime,
      currentContext,
    );
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
      Effect.onExit((exit) =>
        Exit.isFailure(exit) ? Scope.close(renderScope, Exit.asVoid(exit)) : Effect.void,
      ),
    );
    yield* Trace.emit("component.render", () => ({ component_type: Trace.valueType(currentRun) }));
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
      .renderElement(childElement, actualParent, componentRuntime, currentContext, options)
      .pipe(Scope.provide(componentScope), Effect.provideService(Signal.CurrentRenderPhase, null));

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
    let inserted = firstInsert ? true : yield* tryInsert(anchor.parentNode);

    if (!inserted && anchor.parentNode === null) {
      yield* Effect.sync(() => {
        actualParent.appendChild(anchor);
      }).pipe(Effect.catchCause(() => Effect.void));
      inserted = yield* tryInsert(anchor.parentNode);
    }

    if (!inserted) {
      yield* result.cleanup;
      return { node: anchor, cleanup: Effect.void };
    }

    return result;
  });

  const onRerenderFailure = Effect.fnUntraced(function* (cause: Cause.Cause<unknown>) {
    yield* Trace.emit("component.rerender.error", () => ({
      cause_type: Trace.causeValueType(cause),
    }));

    if (options.errorHandler !== null) {
      options.errorHandler(cause);
    }

    isRerendering = false;
    pendingRerender = false;
  });

  type RerenderFailureMode = "preserve" | "propagate";

  const rerenderEffectBody = Effect.fnUntraced(function* () {
    if (isUnmounted) {
      isRerendering = false;
      pendingRerender = false;
      return;
    }

    const rerenderStart = performance.now();
    if (provider !== null && providerId !== null) {
      yield* Trace.emit("provider.reuse", () => ({
        provider_id: providerId,
        component: provider.displayName,
        reason: "rerender",
      }));
    }
    yield* Signal.resetRenderPhase(renderPhase);

    const nextRender = yield* runComponentEffect();
    const prepared = yield* Effect.gen(function* () {
      const nextElement = yield* ElementService.fromUnknown(nextRender.element);
      const reconcileOutcome: Option.Option<RenderTransaction.RenderTransactionOutcome> =
        currentResult === null
          ? Option.none()
          : Option.some(
              yield* RenderTransaction.reconcile({
                previous: currentResult,
                nextElement,
                nextContext: currentContext,
                context: componentRuntime,
              }),
            );
      return { nextElement, reconcileOutcome };
    }).pipe(
      Effect.onExit((exit) =>
        Exit.isFailure(exit) ? Scope.close(nextRender.scope, Exit.asVoid(exit)) : Effect.void,
      ),
    );
    const { nextElement, reconcileOutcome } = prepared;

    if (
      Option.isSome(reconcileOutcome) &&
      RenderTransaction.RenderTransactionOutcome.$is("Reconciled")(reconcileOutcome.value)
    ) {
      const previousScope = currentRenderScope;
      currentRenderScope = nextRender.scope;
      if (previousScope !== null) {
        const closeExit = yield* Effect.exit(Scope.close(previousScope, Exit.void));
        if (Exit.isFailure(closeExit)) reportUnhandledRenderCause(closeExit.cause);
      }
    } else {
      const actualParent = anchor.parentNode;
      if (actualParent === null) {
        const error = new ComponentAnchorError({
          message:
            "Component anchor has no parent - component may have been unmounted during rerender",
        });
        return yield* Effect.fail(error).pipe(
          Effect.onExit((exit) => Scope.close(nextRender.scope, Exit.asVoid(exit))),
        );
      }
      // Render the replacement subtree off-DOM into a fragment so the
      // user never sees the new tree mid-construction next to the old
      // one. The previous renderAndPosition path mounted progressively
      // into actualParent, producing visible "two trees coexisting"
      // flashes under CPU throttling.
      const tempFragment = document.createDocumentFragment();
      const previousResult = currentResult;
      const previousScope = currentRenderScope;
      let committed = false;
      const outcome = yield* RenderTransaction.replace({
        parent: actualParent,
        previous: previousResult === null ? Option.none() : Option.some(previousResult),
        renderNext: deps
          .renderElement(nextElement, tempFragment, componentRuntime, currentContext, options)
          .pipe(
            Scope.provide(componentScope),
            Effect.provideService(Signal.CurrentRenderPhase, null),
          ),
        context: componentRuntime,
        onCommit: (result) => {
          currentRenderScope = nextRender.scope;
          currentResult = result;
          committed = true;
        },
        releaseStagedScope: (exit) => Scope.close(nextRender.scope, exit),
      }).pipe(
        Effect.onExit((exit) =>
          Exit.isFailure(exit) && committed && previousScope !== null
            ? Scope.close(previousScope, Exit.asVoid(exit))
            : Effect.void,
        ),
      );

      if (RenderTransaction.RenderTransactionOutcome.$is("FailedBeforeCommit")(outcome)) {
        return yield* Effect.failCause(outcome.cause);
      }

      let cleanupCause =
        RenderTransaction.RenderTransactionOutcome.$is("Committed")(outcome) &&
        Option.isSome(outcome.cleanupCause)
          ? outcome.cleanupCause
          : Option.none<Cause.Cause<unknown>>();
      if (previousScope !== null) {
        const closeExit = yield* Effect.exit(Scope.close(previousScope, Exit.void));
        if (Exit.isFailure(closeExit)) {
          cleanupCause = Option.some(
            Option.isSome(cleanupCause)
              ? Cause.combine(cleanupCause.value, closeExit.cause)
              : closeExit.cause,
          );
        }
      }
      if (Option.isSome(cleanupCause)) {
        reportUnhandledRenderCause(cleanupCause.value);
      }
    }

    const rerenderDuration = performance.now() - rerenderStart;
    yield* Trace.emit("component.rerender", () => ({ duration_ms: rerenderDuration }));
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
      Effect.catchCause((cause) => {
        if (Cause.hasDies(cause) || Cause.hasInterrupts(cause)) {
          isRerendering = false;
          pendingRerender = false;
          return Effect.failCause(cause);
        }
        if (failureMode !== "propagate" || options.errorHandler !== null) {
          return onRerenderFailure(cause);
        }
        if (isTransientRenderFailure(cause)) {
          // Superseded by a newer latest-wins render. Preserve currentResult and
          // re-raise so the caller (render-signal-element) keeps the current DOM
          // when a newer swap is pending, or replaces it cleanly. Do NOT tear
          // down — that blanked the layout under fast docs navigation and forced
          // a full REPLACE/remount with duplicate orphan nodes.
          return Effect.gen(function* () {
            isRerendering = false;
            pendingRerender = false;
            yield* Trace.emit("component.superseded", () => ({
              cause_type: Trace.causeValueType(cause),
            }));
            return yield* Effect.failCause(cause);
          });
        }
        isRerendering = false;
        pendingRerender = false;
        return Effect.failCause(cause);
      }),
      Scope.provide(componentScope),
    );

  let scheduleRerender: () => void;

  const doRerender = (): void => {
    renderCount++;
    deps.runForkInRenderContext(rerenderEffect("preserve"), componentRuntime, currentContext);
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
  let acquiredInitialScope: Scope.Closeable | null = null;
  let acquiredInitialResult: RenderResult | null = null;
  const initialState = yield* Effect.gen(function* () {
    const initialRender = yield* runComponentEffect();
    acquiredInitialScope = initialRender.scope;
    const initialElement = yield* ElementService.fromUnknown(initialRender.element);
    const initialResult = yield* renderAndPosition(initialElement);
    acquiredInitialResult = initialResult;
    return { initialRender, initialResult };
  }).pipe(
    Effect.onExit((exit) => {
      if (Exit.isSuccess(exit)) return Effect.void;
      const rollback: Array<Effect.Effect<void, unknown, RuntimeRequirements>> = [];
      if (acquiredInitialResult !== null) {
        rollback.push(RenderTransaction.cleanup(acquiredInitialResult));
      }
      if (acquiredInitialScope !== null) {
        rollback.push(Scope.close(acquiredInitialScope, Exit.asVoid(exit)));
      }
      rollback.push(
        Scope.close(componentScope, Exit.asVoid(exit)),
        Effect.sync(() => anchor.remove()),
      );
      return cleanupAll(rollback);
    }),
  );
  const { initialRender, initialResult } = initialState;
  currentRenderScope = initialRender.scope;
  currentResult = initialResult;
  const renderDuration = performance.now() - renderStart;
  renderCount++;

  yield* Trace.emit("component.initial", () => ({
    accessed_signals: renderPhase.accessed.size,
    duration_ms: renderDuration,
  }));

  yield* Metrics.recordComponentRender;
  yield* Metrics.recordRenderDuration(renderDuration);
  yield* subscribeToSignals(renderPhase.accessed);

  return {
    node: anchor,
    cleanup: Effect.gen(function* () {
      isUnmounted = true;
      const cleanups = subscriptionCleanups;
      subscriptionCleanups = [];
      const providerFinalizeStart = providerId === null ? null : performance.now();
      yield* cleanupAll([
        ...cleanups,
        cleanupCurrent,
        Scope.close(componentScope, Exit.void),
        Effect.gen(function* () {
          if (provider !== null && providerId !== null && providerFinalizeStart !== null) {
            const durationMs = performance.now() - providerFinalizeStart;
            yield* Metrics.recordProviderFinalization;
            yield* Metrics.recordProviderFinalizationDuration(durationMs);
            yield* Trace.emit("provider.finalize", () => ({
              provider_id: providerId,
              component: provider.displayName,
              reason: "unmount",
              duration_ms: durationMs,
            }));
          }
        }),
        Effect.sync(() => anchor.remove()),
      ]);
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
            yield* Trace.emit("provider.replace", () => ({
              provider_id: providerId,
              component: provider.displayName,
              reason: "key-change",
            }));
          }
          return false;
        }

        if (resolvedNextElement.provider?.layer !== provider?.layer) {
          if (provider !== null && providerId !== null) {
            yield* Trace.emit("provider.replace", () => ({
              provider_id: providerId,
              component: provider.displayName,
              reason: "identity-change",
            }));
          }
          return false;
        }

        const sameIdentity =
          identity !== undefined
            ? resolvedNextElement.identity === identity
            : resolvedNextElement.identity === identity && resolvedNextElement.run === currentRun;

        if (!sameIdentity) {
          if (provider !== null && providerId !== null) {
            yield* Trace.emit("provider.replace", () => ({
              provider_id: providerId,
              component: provider.displayName,
              reason: "identity-change",
            }));
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
            yield* Trace.emit("provider.reuse", () => ({
              provider_id: providerId,
              component: provider.displayName,
              reason: "rerender",
            }));
          }
          return true;
        }

        if (isRerendering) {
          pendingRerender = true;
          return true;
        }

        isRerendering = true;
        renderCount++;
        yield* rerenderEffect("propagate");
        return true;
      }),
  };
});
