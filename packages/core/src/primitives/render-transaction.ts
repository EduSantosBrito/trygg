import { Cause, Data, Effect, Exit, Option, Schema } from "effect";
import * as Context from "effect/Context";
import { unsafeWidenContext } from "../internal/unsafe.js";
import * as Trace from "../trace/index.js";
import type { Element } from "./element.js";
import type { RenderContext, RenderPreparation, RenderResult } from "./renderer.js";

export interface RenderTransactionRequest<R> {
  readonly parent: Node;
  readonly previous: Option.Option<RenderResult>;
  readonly renderNext: Effect.Effect<RenderResult, unknown, R>;
  readonly context: RenderContext;
  readonly onCommit: (result: RenderResult) => void;
  readonly releaseStagedScope: (exit: Exit.Exit<void, unknown>) => Effect.Effect<void, unknown>;
  readonly shouldCommit?: () => boolean;
}

export interface RenderTransactionReconcileRequest {
  readonly boundary?: "operation" | "child";
  readonly preparation?: RenderPreparation | undefined;
  readonly previous: RenderResult;
  readonly nextElement: Element;
  readonly nextContext: Context.Context<unknown> | null;
  readonly context: RenderContext;
}

export type RenderTransactionOutcome = Data.TaggedEnum<{
  readonly Committed: {
    readonly result: RenderResult;
    readonly cleanupCause: Option.Option<Cause.Cause<unknown>>;
  };
  readonly Reconciled: { readonly result: RenderResult };
  readonly NotReconciled: { readonly result: RenderResult };
  readonly DroppedStale: {};
  readonly FailedBeforeCommit: { readonly cause: Cause.Cause<unknown> };
}>;

export const RenderTransactionOutcome = Data.taggedEnum<RenderTransactionOutcome>();

export class RenderTransactionError extends Schema.TaggedError<RenderTransactionError>()(
  "RenderTransactionError",
  {
    phase: Schema.Union([
      Schema.Literal("render"),
      Schema.Literal("commit"),
      Schema.Literal("cleanup"),
    ]),
    cause: Schema.Unknown,
  },
) {}

const emptyRuntimeContext = unsafeWidenContext(Context.empty());

export const replace: <R>(
  request: RenderTransactionRequest<R>,
) => Effect.Effect<RenderTransactionOutcome, unknown> = Effect.fnUntraced(function* <R>(
  request: RenderTransactionRequest<R>,
) {
  let transferred = false;
  const operation = Effect.gen(function* () {
    yield* Trace.emit("signalElement.swap.start", () => ({
      operation: "replace",
      hasPrevious: Option.isSome(request.previous),
    }));

    return yield* Effect.acquireUseRelease(
      Effect.exit(
        Effect.interruptible(request.renderNext.pipe(Effect.provide(request.context.services))),
      ),
      (rendered) =>
        Effect.gen(function* () {
          if (Exit.isFailure(rendered)) {
            yield* Trace.emit("signalElement.swap.failBeforeCommit", () => ({
              operation: "replace",
              phase: "render",
              cause_type: Trace.causeValueType(rendered.cause),
            }));
            if (Cause.hasDies(rendered.cause) || Cause.hasInterrupts(rendered.cause)) {
              return yield* Effect.failCause(rendered.cause);
            }
            return RenderTransactionOutcome.FailedBeforeCommit({ cause: rendered.cause });
          }

          yield* Trace.emit("signalElement.swap.render", () => ({ operation: "replace" }));
          const next = rendered.value;
          const previous = Option.getOrUndefined(request.previous);
          let retainedCommitCause: Cause.Cause<unknown> | undefined;
          let retainedCleanupCause: Cause.Cause<unknown> | undefined;

          return yield* Effect.uninterruptibleMask((restore) =>
            Effect.gen(function* () {
              const commitExit = yield* Effect.exit(
                Effect.try({
                  try: () => {
                    if (request.shouldCommit !== undefined && !request.shouldCommit()) {
                      return false;
                    }
                    const referenceNode = previous?.node.nextSibling ?? null;
                    const stagedParent = next.node.parentNode;
                    if (stagedParent instanceof DocumentFragment) {
                      request.parent.insertBefore(stagedParent, referenceNode);
                      return true;
                    }
                    request.parent.insertBefore(next.node, referenceNode);
                    return true;
                  },
                  catch: (cause) => new RenderTransactionError({ phase: "commit", cause }),
                }),
              );

              if (Exit.isFailure(commitExit)) {
                const interruptExit = yield* Effect.exit(restore(Effect.void));
                retainedCommitCause = Exit.isFailure(interruptExit)
                  ? Cause.combine(commitExit.cause, interruptExit.cause)
                  : commitExit.cause;
                return yield* Effect.failCause(retainedCommitCause);
              }

              if (!commitExit.value) {
                yield* Trace.emit("signalElement.swap.dropStale", () => ({
                  operation: "replace",
                }));
                return RenderTransactionOutcome.DroppedStale();
              }

              yield* Effect.sync(() => {
                request.onCommit(next);
                transferred = true;
              });
              yield* Trace.emit("signalElement.swap.commit", () => ({ operation: "replace" }));

              let cleanupCause: Option.Option<Cause.Cause<unknown>> = Option.none();
              if (previous !== undefined) {
                yield* Trace.emit("signalElement.cleanup", () => ({
                  operation: "replace",
                  reason: "previous-result",
                }));
                const cleanupExit = yield* Effect.exit(
                  restore(previous.cleanup.pipe(Effect.provide(request.context.services))),
                );
                if (Exit.isFailure(cleanupExit)) {
                  if (Cause.hasInterrupts(cleanupExit.cause)) {
                    return yield* Effect.failCause(cleanupExit.cause);
                  }
                  retainedCleanupCause = cleanupExit.cause;
                  cleanupCause = Option.some(cleanupExit.cause);
                }
              }

              return RenderTransactionOutcome.Committed({ result: next, cleanupCause });
            }),
          ).pipe(
            Effect.onExit((exit) => {
              const retainedCause = retainedCommitCause ?? retainedCleanupCause;
              return Exit.isFailure(exit) &&
                Cause.hasInterrupts(exit.cause) &&
                retainedCause !== undefined &&
                !retainedCause.reasons.every((reason) => exit.cause.reasons.includes(reason))
                ? Effect.failCause(retainedCause)
                : Effect.void;
            }),
          );
        }),
      (rendered, useExit) =>
        !transferred && Exit.isSuccess(rendered)
          ? Effect.gen(function* () {
              const cleanupExit = yield* Effect.exit(
                Effect.uninterruptible(
                  rendered.value.cleanup.pipe(Effect.provide(request.context.services)),
                ),
              );
              const interruptExit =
                Exit.isFailure(useExit) && Cause.hasInterrupts(useExit.cause)
                  ? Exit.void
                  : yield* Effect.exit(Effect.interruptible(Effect.void));
              const releaseExit = Exit.asVoidAll([interruptExit, cleanupExit]);
              if (Exit.isFailure(releaseExit)) {
                return yield* Effect.failCause(releaseExit.cause);
              }
            })
          : Effect.void,
    );
  });

  return yield* operation.pipe(
    Effect.onExit((exit) => {
      if (transferred) return Effect.void;
      if (Exit.isSuccess(exit) && RenderTransactionOutcome.$is("FailedBeforeCommit")(exit.value)) {
        const renderCause = exit.value.cause;
        // The recoverable outcome is successful protocol delivery, not a
        // successful acquisition. Finalizers must see the failed render, and
        // a rollback failure must retain that original Cause as well.
        return Effect.uninterruptible(
          request
            .releaseStagedScope(Exit.failCause(renderCause))
            .pipe(
              Effect.catchCause((releaseCause) =>
                Effect.failCause(Cause.combine(renderCause, releaseCause)),
              ),
            ),
        );
      }
      return Effect.uninterruptible(request.releaseStagedScope(Exit.asVoid(exit)));
    }),
  );
});

export const reconcile: (
  request: RenderTransactionReconcileRequest,
) => Effect.Effect<RenderTransactionOutcome, unknown> = Effect.fnUntraced(function* (
  request: RenderTransactionReconcileRequest,
) {
  const operationBoundary = request.boundary !== "child";
  if (operationBoundary)
    yield* Trace.emit("signalElement.swap.start", () => ({ operation: "reconcile" }));
  if (request.previous.reconcile === undefined) {
    if (!operationBoundary)
      yield* Trace.emit("render.child.reconcile", () => ({ reconciled: false }));
    return RenderTransactionOutcome.NotReconciled({ result: request.previous });
  }

  const reconciled = yield* Effect.exit(
    request.previous
      .reconcile(request.nextElement, request.nextContext, request.preparation)
      .pipe(Effect.provide(request.context.services)),
  );
  if (Exit.isFailure(reconciled)) {
    yield* Trace.emit("signalElement.swap.failBeforeCommit", () => ({
      operation: "reconcile",
      phase: "render",
      cause_type: Trace.causeValueType(reconciled.cause),
    }));
    if (Cause.hasDies(reconciled.cause) || Cause.hasInterrupts(reconciled.cause)) {
      return yield* Effect.failCause(reconciled.cause);
    }
    return RenderTransactionOutcome.FailedBeforeCommit({ cause: reconciled.cause });
  }

  if (operationBoundary) {
    yield* Trace.emit("signalElement.swap.render", () => ({
      operation: "reconcile",
      reconciled: reconciled.value,
    }));
    if (reconciled.value)
      yield* Trace.emit("signalElement.swap.commit", () => ({ operation: "reconcile" }));
  } else {
    // The enclosing renderer owns publication; children contribute one cost fact.
    yield* Trace.emit("render.child.reconcile", () => ({ reconciled: reconciled.value }));
  }
  return reconciled.value
    ? RenderTransactionOutcome.Reconciled({ result: request.previous })
    : RenderTransactionOutcome.NotReconciled({ result: request.previous });
});

export const cleanup: (result: RenderResult) => Effect.Effect<void, unknown> = Effect.fnUntraced(
  function* (result: RenderResult) {
    yield* Trace.emit("signalElement.cleanup", () => ({
      operation: "cleanup",
      reason: "explicit",
    }));
    yield* result.cleanup.pipe(Effect.provide(emptyRuntimeContext));
  },
);
