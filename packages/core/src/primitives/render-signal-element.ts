import { Cause, Effect, Exit, Option, Predicate, Scope, Semaphore } from "effect";
import * as Context from "effect/Context";
import { Element, isElement } from "./element.js";
import * as Signal from "./signal.js";
import * as Trace from "../trace/index.js";
import type { ErrorBoundaryHandler, RenderContext, RenderResult } from "./renderer.js";
import { makeRenderTransaction, type RenderTransactionOutcome } from "./render-transaction.js";
import { equalOrChanged, resolveReconcileTarget } from "./render-utils.js";

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
  RenderTransactionOutcome,
  { readonly _tag: "FailedBeforeCommit" }
>;

const isFailedBeforeCommit = (outcome: RenderTransactionOutcome): outcome is FailedBeforeCommit =>
  Predicate.isTagged(outcome, "FailedBeforeCommit");

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
  onSwap: Effect.Effect<void, unknown, R> | undefined,
  parent: Node,
  renderContext: RenderContext,
  context: Context.Context<unknown> | null,
  options: RenderOptions,
  deps: RenderSignalElementDeps<E, R>,
) {
  const anchor = document.createComment("signal-element");
  parent.appendChild(anchor);

  let currentResult: RenderResult | null = null;
  let currentScope: Scope.Closeable | null = null;
  let isUnmounted = false;
  let swapVersion = 0;
  // Serialize swaps for THIS signalElement so a second navigation can't fork a
  // reconcile/replace fiber that interleaves with an in-flight one and stomps
  // the shared render-component/render-intrinsic closure state (silent layout
  // teardown under fast nav). One permit per instance — not module-global.
  const swapLock = Semaphore.makeUnsafe(1);
  const renderTransaction = makeRenderTransaction();

  const renderValue = (value: unknown): Element =>
    isElement(value) ? value : Element.Text({ content: String(value) });

  const cleanupCurrent: Effect.Effect<void, unknown, R> = Effect.gen(function* () {
    if (currentResult !== null) {
      yield* renderTransaction.cleanup(currentResult);
      currentResult = null;
    }
    if (currentScope !== null) {
      const scope = currentScope;
      currentScope = null;
      yield* Scope.close(scope, Exit.void);
    }
  });

  const renderWithScope = Effect.fnUntraced(function* (value: unknown) {
    const scope = yield* Scope.fork(yield* Effect.scope);
    const element = renderValue(value);
    const result = yield* deps.renderElement(element, parent, renderContext, context, options).pipe(
      Scope.provide(scope),
      Effect.onError(() => Scope.close(scope, Exit.void)),
    );
    return { result, scope };
  });

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
  } else if (isTransientRenderFailure(initialOutcome.cause)) {
    yield* Trace.emit("signalElement.superseded", () => ({
      phase: "initial",
      signal_id: signal._debugId,
      reason: Cause.pretty(initialOutcome.cause),
    }));
    initialRender = yield* renderWithScope(Element.Text({ content: "" }));
  } else {
    return yield* Effect.failCause(initialOutcome.cause);
  }
  currentResult = initialRender.result;
  currentScope = initialRender.scope;
  parent.insertBefore(currentResult.node, anchor);

  yield* Trace.emit("signalElement.insert", () => ({ signal_id: signal._debugId }));

  const scheduleSwap = () => {
    if (isUnmounted) return;

    const myVersion = ++swapVersion;

    deps.runForkInRenderContext(
      swapLock
        .withPermits(1)(
          Effect.gen(function* () {
            // Permit acquired. A superseded navigation that queued behind the
            // in-flight swap coalesces away here before any DOM read/mutation;
            // the surviving fiber re-reads the signal so it renders the latest
            // value. Keeps latest-wins and skips wasted subtree mounts.
            if (myVersion !== swapVersion || isUnmounted) return;
            // peek (not get): subscription is already owned below; reading the
            // latest value must never re-subscribe an ambient render phase.
            const newValue = yield* Signal.peek(signal);
            const element = renderValue(newValue);

            // Reconcile in place when the new value's outer Component matches
            // the current one by key/identity. Without this, sibling-route
            // navigation (e.g. /docs/signals → /docs/resources) tears down
            // and remounts the entire shared layout subtree.
            if (currentResult !== null && currentResult.reconcile !== undefined) {
              const reconcileExit = yield* Effect.exit(currentResult.reconcile(element, context));
              if (Exit.isSuccess(reconcileExit)) {
                if (reconcileExit.value) {
                  if (myVersion !== swapVersion) return;
                  if (onSwap !== undefined) {
                    yield* onSwap;
                  }
                  yield* Trace.emit("signalElement.reconcile", () => ({
                    signal_id: signal._debugId,
                  }));
                  return;
                }
                // reconcile returned false (key / identity / provider change) —
                // fall through to the REPLACE path below.
              } else if (myVersion !== swapVersion || isUnmounted) {
                // The reconcile FAILED but a newer swap has already been scheduled
                // (or this element unmounted): this is a benign supersession — a
                // StaleRouteRender or transient anchor detach from a fast sibling
                // navigation. Preserve the current subtree and let the latest swap
                // produce the final DOM. Never blank, never remount. The newer
                // swap fiber is already queued on swapLock and will reconcile to
                // the up-to-date value once this fiber releases the permit.
                yield* Trace.emit("signalElement.superseded", () => ({
                  phase: "reconcile",
                  signal_id: signal._debugId,
                  reason: Cause.pretty(reconcileExit.cause),
                }));
                return;
              }
              // Genuine reconcile failure with no newer navigation pending — fall
              // through to REPLACE so a real defect still recovers (insert-before-
              // remove keeps the old subtree until the replacement is committed).
            }

            const tempFragment = document.createDocumentFragment();
            const scope = yield* Scope.fork(yield* Effect.scope);
            const renderNext = deps
              .renderElement(element, tempFragment, renderContext, context, options)
              .pipe(
                Scope.provide(scope),
                Effect.onError(() => Scope.close(scope, Exit.void)),
              );

            if (myVersion !== swapVersion) {
              yield* Scope.close(scope, Exit.void);
              return;
            }

            const actualParent = anchor.parentNode;
            if (actualParent === null) {
              yield* Scope.close(scope, Exit.void);
              return;
            }

            const oldScope = currentScope;
            const outcome = yield* renderTransaction.replace({
              parent: actualParent,
              previous: currentResult === null ? Option.none() : Option.some(currentResult),
              renderNext,
              context: renderContext,
            });

            if (isFailedBeforeCommit(outcome)) {
              yield* Scope.close(scope, Exit.void);
              return yield* Effect.fail(outcome.cause);
            }

            currentResult = outcome.result;
            currentScope = scope;

            if (oldScope !== null) {
              yield* Scope.close(oldScope, Exit.void);
            }

            if (onSwap !== undefined) {
              yield* onSwap;
            }
            // The committed swap is already traced as `signalElement.swap.commit`
            // by the render transaction — no second emit here (no double-emit).
          }),
        )
        .pipe(
          Effect.catchCause((cause) =>
            Effect.gen(function* () {
              yield* Trace.emit("signalElement.swap.error", () => ({
                signal_id: signal._debugId,
                reason: Cause.pretty(cause),
              }));

              if (options.errorHandler !== null) {
                options.errorHandler(cause);
              }
            }),
          ),
        ),
      renderContext,
      context,
    );
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
      yield* unsubscribe;
      yield* cleanupCurrent;
      anchor.remove();
    }),
  };
});
