import { Cause, Effect, Exit, Option, Predicate, Scope } from "effect";
import * as Context from "effect/Context";
import { Element, isElement } from "./element.js";
import * as Signal from "./signal.js";
import * as Trace from "../trace/index.js";
import type { ErrorBoundaryHandler, RenderContext, RenderResult } from "./renderer.js";
import * as RenderTransaction from "./render-transaction.js";
import { equalOrChanged, resolveReconcileTarget } from "./render-utils.js";
import { cleanupAll, reportUnhandledRenderCause } from "./render-cleanup.js";

interface RenderOptions {
  readonly errorHandler: ErrorBoundaryHandler | null;
}

interface RenderSignalElementDeps<E, R> {
  readonly renderElement: (
    element: Element,
    parent: Node,
    renderContext: RenderContext,
    context: Context.Context<unknown> | null,
    options: RenderOptions,
  ) => Effect.Effect<RenderResult, E, R>;
  readonly runForkInRenderContext: <E2, R2>(
    effect: Effect.Effect<void, E2, R2>,
    renderContext: RenderContext,
    context: Context.Context<unknown> | null,
  ) => void;
}

type FailedBeforeCommit = Extract<
  RenderTransaction.RenderTransactionOutcome,
  { readonly _tag: "FailedBeforeCommit" }
>;

const isFailedBeforeCommit = (
  outcome: RenderTransaction.RenderTransactionOutcome,
): outcome is FailedBeforeCommit => Predicate.isTagged(outcome, "FailedBeforeCommit");

type DroppedStale = Extract<
  RenderTransaction.RenderTransactionOutcome,
  { readonly _tag: "DroppedStale" }
>;

const isDroppedStale = (
  outcome: RenderTransaction.RenderTransactionOutcome,
): outcome is DroppedStale => Predicate.isTagged(outcome, "DroppedStale");

// A "transient" render failure does NOT indicate a defect in the rendered
// subtree — it means a newer, latest-wins render has already superseded this one
// mid-flight:
//   - StaleRouteRender (router/outlet-services): the router advanced to another
//     route while this route/layout element was still rendering.
//   - ComponentAnchorError: a concurrent render detached the subtree's anchor.
// Tags are matched by string so this primitive stays decoupled from the router
// and survives module duplication (instanceof can fail across duplicated copies).
// Mirrors render-component.ts TRANSIENT_FAILURE_TAGS.
const TRANSIENT_FAILURE_TAGS: ReadonlySet<string> = new Set([
  "ComponentAnchorError",
  "StaleRouteRender",
]);

const hasTransientTag = (error: unknown): boolean =>
  Predicate.hasProperty(error, "_tag") &&
  typeof error._tag === "string" &&
  TRANSIENT_FAILURE_TAGS.has(error._tag);

const isTransientRenderFailure = (cause: Cause.Cause<unknown>): boolean => {
  if (hasTransientTag(Cause.squash(cause))) return true;
  const firstError = Cause.findErrorOption(cause);
  return Option.isSome(firstError) && hasTransientTag(firstError.value);
};

export const renderSignalElement = Effect.fn("renderSignalElement")(function* <E, R>(
  signal: Signal.Signal<unknown>,
  onSwap: ((value: unknown) => Effect.Effect<void, unknown, R>) | undefined,
  parent: Node,
  renderContext: RenderContext,
  context: Context.Context<unknown> | null,
  options: RenderOptions,
  deps: RenderSignalElementDeps<E, R>,
) {
  const anchor = document.createComment("signal-element");
  parent.appendChild(anchor);
  const signalScope = yield* Scope.fork(renderContext.scope);
  const signalContext: RenderContext = { ...renderContext, scope: signalScope };
  const workerScope = yield* Scope.fork(signalScope);
  const workerContext: RenderContext = { ...signalContext, scope: workerScope };

  let currentResult: RenderResult | null = null;
  let currentScope: Scope.Closeable | null = null;
  let isUnmounted = false;
  let swapVersion = 0;
  let workerRunning = false;
  let swapPending = false;
  const renderValue = (value: unknown): Element =>
    isElement(value) ? value : Element.Text({ content: String(value) });

  const cleanupCurrent: Effect.Effect<void, unknown, R> = Effect.gen(function* () {
    const result = currentResult;
    const scope = currentScope;
    currentResult = null;
    currentScope = null;
    const cleanups: Array<Effect.Effect<void, unknown, R>> = [];
    if (result !== null) cleanups.push(RenderTransaction.cleanup(result));
    if (scope !== null) cleanups.push(Scope.close(scope, Exit.void));
    yield* cleanupAll(cleanups);
  });

  const renderWithScope = Effect.fnUntraced(function* (value: unknown) {
    const scope = yield* Scope.fork(signalScope);
    const valueContext: RenderContext = { ...signalContext, scope };
    const element = renderValue(value);
    const result = yield* deps.renderElement(element, parent, valueContext, context, options).pipe(
      Scope.provide(scope),
      Effect.onExit((exit) =>
        Exit.isFailure(exit) ? Scope.close(scope, Exit.asVoid(exit)) : Effect.void,
      ),
    );
    return { result, scope };
  });

  const initialState = yield* Effect.gen(function* () {
    // peek (not get): this SignalElement owns its own subscription via
    // Signal.subscribe(signal) below. Using Signal.get here would subscribe the
    // *enclosing component's* render phase to the signal, forcing the whole
    // component to re-render (and REPLACE its subtree) on every change instead of
    // letting this element swap in place.
    const initialValue = yield* Signal.peek(signal);
    // The initial value's subtree can be superseded mid-render by a newer
    // latest-wins render — a fast navigation that fires before this page settles
    // turns the in-flight route stale and its gated run raises StaleRouteRender
    // (or a concurrent detach raises ComponentAnchorError). On the SWAP path this
    // is already contained (scheduleSwap's catchCause); on the INITIAL render it
    // was not, so the failure propagated synchronously up to renderDocumentElement,
    // failed the whole-app root render, and disposed the outlet — a permanent blank
    // under fast cold-load navigation. Degrade to an empty placeholder instead and
    // let recovery happen below: this SignalElement owns a live subscription, and
    // the post-subscribe re-peek re-renders the latest value once the outlet
    // commits the new route. Never blank permanently, never tear down the document.
    const initialOutcome = yield* Effect.exit(renderWithScope(initialValue));
    let initialRender: { result: RenderResult; scope: Scope.Closeable };
    if (Exit.isSuccess(initialOutcome)) {
      initialRender = initialOutcome.value;
    } else if (
      !Cause.hasDies(initialOutcome.cause) &&
      !Cause.hasInterrupts(initialOutcome.cause) &&
      isTransientRenderFailure(initialOutcome.cause)
    ) {
      yield* Trace.emit("signalElement.superseded", () => ({
        phase: "initial",
        signal_id: signal._debugId,
        cause_type: Trace.causeValueType(initialOutcome.cause),
      }));
      initialRender = yield* renderWithScope(Element.Text({ content: "" }));
    } else {
      return yield* Effect.failCause(initialOutcome.cause);
    }
    return { initialValue, initialRender };
  }).pipe(
    Effect.onExit((exit) =>
      Exit.isFailure(exit)
        ? cleanupAll([
            Scope.close(workerScope, Exit.asVoid(exit)),
            Scope.close(signalScope, Exit.asVoid(exit)),
            Effect.sync(() => anchor.remove()),
          ])
        : Effect.void,
    ),
  );
  const { initialValue, initialRender } = initialState;
  currentResult = initialRender.result;
  currentScope = initialRender.scope;
  parent.insertBefore(currentResult.node, anchor);

  yield* Trace.emit("signalElement.insert", () => ({ signal_id: signal._debugId }));

  const runSwap = Effect.fnUntraced(function* (myVersion: number) {
    if (myVersion !== swapVersion || isUnmounted) return;

    // peek (not get): subscription is already owned below; reading the latest
    // value must never re-subscribe an ambient render phase.
    const newValue = yield* Signal.peek(signal);
    const element = renderValue(newValue);

    if (currentResult !== null && currentResult.reconcile !== undefined) {
      const reconcileExit = yield* Effect.exit(currentResult.reconcile(element, context));
      if (Exit.isSuccess(reconcileExit)) {
        if (reconcileExit.value) {
          if (myVersion !== swapVersion) return;
          if (onSwap !== undefined) {
            yield* onSwap(newValue);
          }
          yield* Trace.emit("signalElement.reconcile", () => ({
            signal_id: signal._debugId,
          }));
          return;
        }
      } else if (Cause.hasDies(reconcileExit.cause) || Cause.hasInterrupts(reconcileExit.cause)) {
        return yield* Effect.failCause(reconcileExit.cause);
      } else if (myVersion !== swapVersion || isUnmounted) {
        yield* Trace.emit("signalElement.superseded", () => ({
          phase: "reconcile",
          signal_id: signal._debugId,
          cause_type: Trace.causeValueType(reconcileExit.cause),
        }));
        return;
      }
    }

    const tempFragment = document.createDocumentFragment();
    const scope = yield* Scope.fork(signalScope);
    const nextContext: RenderContext = { ...signalContext, scope };
    const renderNext = deps
      .renderElement(element, tempFragment, nextContext, context, options)
      .pipe(Scope.provide(scope));

    const actualParent = anchor.parentNode;
    if (actualParent === null) {
      yield* Scope.close(scope, Exit.void);
      return;
    }

    const oldScope = currentScope;
    let committed = false;
    const outcome = yield* RenderTransaction.replace({
      parent: actualParent,
      previous: currentResult === null ? Option.none() : Option.some(currentResult),
      renderNext,
      context: nextContext,
      onCommit: (result) => {
        currentResult = result;
        currentScope = scope;
        committed = true;
      },
      releaseStagedScope: (exit) => Scope.close(scope, exit),
      shouldCommit: () => myVersion === swapVersion && !isUnmounted,
    }).pipe(
      Effect.onExit((exit) =>
        Exit.isFailure(exit) && committed && oldScope !== null
          ? Scope.close(oldScope, Exit.asVoid(exit))
          : Effect.void,
      ),
    );

    if (isFailedBeforeCommit(outcome)) {
      return yield* Effect.failCause(outcome.cause);
    }

    if (isDroppedStale(outcome)) {
      return;
    }

    if (Predicate.isTagged(outcome, "Committed") && Option.isSome(outcome.cleanupCause)) {
      reportUnhandledRenderCause(outcome.cleanupCause.value);
    }

    if (oldScope !== null) {
      yield* Scope.close(oldScope, Exit.void);
    }

    if (onSwap !== undefined) {
      yield* onSwap(newValue);
    }
  });

  const handleSwapCause = Effect.fnUntraced(function* (cause: Cause.Cause<unknown>) {
    yield* Trace.emit("signalElement.swap.error", () => ({
      signal_id: signal._debugId,
      cause_type: Trace.causeValueType(cause),
    }));

    if (Cause.hasDies(cause) || Cause.hasInterrupts(cause) || options.errorHandler === null) {
      return yield* Effect.failCause(cause);
    }
    options.errorHandler(cause);
  });

  const runWorker = Effect.fnUntraced(function* () {
    while (swapPending && !isUnmounted) {
      swapPending = false;
      yield* runSwap(swapVersion);
    }
  });

  const startWorker = () => {
    if (workerRunning || isUnmounted) return;
    workerRunning = true;
    deps.runForkInRenderContext(
      runWorker().pipe(
        Effect.catchCause(handleSwapCause),
        Effect.ensuring(
          Effect.sync(() => {
            workerRunning = false;
            if (swapPending && !isUnmounted) startWorker();
          }),
        ),
      ),
      workerContext,
      context,
    );
  };

  const scheduleSwap = () => {
    if (isUnmounted) return;
    swapVersion += 1;
    swapPending = true;
    startWorker();
  };

  const unsubscribe = yield* Signal.subscribe(signal, () => Effect.sync(scheduleSwap));

  const currentValue = yield* Signal.peek(signal);
  if (!equalOrChanged(initialValue, currentValue)) {
    yield* Effect.sync(scheduleSwap);
  }

  return {
    node: anchor,
    // Two SignalElements over the SAME signal are the same reactive source.
    // This element already owns a live subscription that keeps its DOM in sync,
    // so when a parent rerenders and re-emits an equivalent SignalElement child
    // (e.g. a router Outlet re-yielding its child during a context-change
    // reconcile cascade), we must PRESERVE this subtree in place — never tear it
    // down and remount. Without this, every ancestor rerender forced a full
    // REPLACE of the outlet child, remounting the route subtree and dropping its
    // local state / DOM identity. A different signal is a genuinely different
    // reactive source and falls through to REPLACE.
    reconcile: (nextElement: Element, nextContext: Context.Context<unknown> | null) =>
      Effect.sync(() => {
        const resolved = resolveReconcileTarget(nextElement, nextContext);
        if (!Element.$is("SignalElement")(resolved.element)) {
          return false;
        }
        return resolved.element.signal === signal;
      }),
    cleanup: Effect.gen(function* () {
      isUnmounted = true;
      swapPending = false;
      yield* cleanupAll([
        unsubscribe,
        Scope.close(workerScope, Exit.void),
        cleanupCurrent,
        Scope.close(signalScope, Exit.void),
        Effect.sync(() => anchor.remove()),
      ]);
    }),
  };
});
