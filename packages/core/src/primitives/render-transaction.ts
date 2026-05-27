import { Cause, Data, Effect, Exit, Layer, Option, Schema } from "effect";
import * as Context from "effect/Context";
import * as ContractTrace from "../contract/trace.js";
import type { Element } from "./element.js";
import type { RenderContext, RenderResult } from "./renderer.js";

export interface RenderTransactionRequest {
  readonly parent: Node;
  readonly previous: Option.Option<RenderResult>;
  readonly renderNext: Effect.Effect<RenderResult, unknown, unknown>;
  readonly context: RenderContext;
}

export interface RenderTransactionReconcileRequest {
  readonly previous: RenderResult;
  readonly nextElement: Element;
  readonly nextContext: Context.Context<unknown> | null;
  readonly context: RenderContext;
}

export type RenderTransactionOutcome =
  | { readonly _tag: "Committed"; readonly result: RenderResult }
  | { readonly _tag: "Reconciled"; readonly result: RenderResult }
  | { readonly _tag: "NotReconciled"; readonly result: RenderResult }
  | { readonly _tag: "FailedBeforeCommit"; readonly cause: unknown };

export class RenderTransactionError extends Data.TaggedError("RenderTransactionError")<{
  readonly phase: "render" | "commit" | "cleanup";
  readonly cause: unknown;
}> {}

export const RenderTransactionConfigInput = Schema.Struct({
  emitTraceEvents: Schema.Boolean,
});

type RenderTransactionConfig = typeof RenderTransactionConfigInput.Type;

const emitRenderTrace = (
  enabled: boolean,
  event: ContractTrace.ContractTraceEventName,
  payload: Record<string, unknown>,
): Effect.Effect<void> =>
  enabled
    ? ContractTrace.emit({ event, level: "semantic", payload }).pipe(Effect.ignore)
    : Effect.void;

export interface RenderTransactionShape {
  readonly replace: (
    request: RenderTransactionRequest,
  ) => Effect.Effect<RenderTransactionOutcome, RenderTransactionError>;
  readonly reconcile: (
    request: RenderTransactionReconcileRequest,
  ) => Effect.Effect<RenderTransactionOutcome>;
  readonly cleanup: (result: RenderResult) => Effect.Effect<void, unknown>;
}

export const makeRenderTransaction = (
  configInput: RenderTransactionConfig,
): RenderTransactionShape => {
  const config = RenderTransactionConfigInput.make(configInput);

  return {
    replace: Effect.fn("RenderTransaction.replace")(function* (request) {
      yield* emitRenderTrace(config.emitTraceEvents, "signalElement.swap.start", {
        operation: "replace",
        hasPrevious: Option.isSome(request.previous),
      });
      const rendered = yield* Effect.exit(
        request.renderNext.pipe(Effect.provide(request.context.services)),
      );
      if (Exit.isFailure(rendered)) {
        const cause = Cause.squash(rendered.cause);
        yield* emitRenderTrace(config.emitTraceEvents, "signalElement.swap.failBeforeCommit", {
          operation: "replace",
          phase: "render",
          cause: String(cause),
        });
        return { _tag: "FailedBeforeCommit", cause };
      }

      yield* emitRenderTrace(config.emitTraceEvents, "signalElement.swap.render", {
        operation: "replace",
      });
      const next = rendered.value;
      const previous = Option.getOrUndefined(request.previous);

      yield* Effect.try({
        try: () => {
          const referenceNode = previous?.node.nextSibling ?? null;
          const stagedParent = next.node.parentNode;
          if (stagedParent instanceof DocumentFragment) {
            request.parent.insertBefore(stagedParent, referenceNode);
            return;
          }
          request.parent.insertBefore(next.node, referenceNode);
        },
        catch: (cause) => new RenderTransactionError({ phase: "commit", cause }),
      });

      yield* emitRenderTrace(config.emitTraceEvents, "signalElement.swap.commit", {
        operation: "replace",
      });

      if (previous !== undefined) {
        yield* emitRenderTrace(config.emitTraceEvents, "signalElement.cleanup", {
          operation: "replace",
          reason: "previous-result",
        });
        yield* previous.cleanup.pipe(
          Effect.provide(request.context.services),
          Effect.mapError((cause) => new RenderTransactionError({ phase: "cleanup", cause })),
        );
      }

      return { _tag: "Committed", result: next };
    }),
    reconcile: Effect.fn("RenderTransaction.reconcile")(function* (request) {
      yield* emitRenderTrace(config.emitTraceEvents, "signalElement.swap.start", {
        operation: "reconcile",
      });
      if (request.previous.reconcile === undefined) {
        return { _tag: "NotReconciled", result: request.previous };
      }

      const reconciled = yield* Effect.exit(
        request.previous
          .reconcile(request.nextElement, request.nextContext)
          .pipe(Effect.provide(request.context.services)),
      );
      if (Exit.isFailure(reconciled)) {
        const cause = Cause.squash(reconciled.cause);
        yield* emitRenderTrace(config.emitTraceEvents, "signalElement.swap.failBeforeCommit", {
          operation: "reconcile",
          phase: "render",
          cause: String(cause),
        });
        return { _tag: "FailedBeforeCommit", cause };
      }

      yield* emitRenderTrace(config.emitTraceEvents, "signalElement.swap.render", {
        operation: "reconcile",
        reconciled: reconciled.value,
      });
      if (reconciled.value) {
        yield* emitRenderTrace(config.emitTraceEvents, "signalElement.swap.commit", {
          operation: "reconcile",
        });
      }
      return reconciled.value
        ? { _tag: "Reconciled", result: request.previous }
        : { _tag: "NotReconciled", result: request.previous };
    }),
    cleanup: Effect.fn("RenderTransaction.cleanup")(function* (result) {
      yield* emitRenderTrace(config.emitTraceEvents, "signalElement.cleanup", {
        operation: "cleanup",
        reason: "explicit",
      });
      yield* result.cleanup.pipe(Effect.provide(Context.empty() as Context.Context<unknown>));
    }),
  };
};

export class RenderTransaction extends Context.Service<
  RenderTransaction,
  RenderTransactionShape
>()("trygg/RenderTransaction") {
  static readonly layer = (
    configInput: RenderTransactionConfig,
  ): Layer.Layer<RenderTransaction> =>
    Layer.succeed(RenderTransaction, makeRenderTransaction(configInput));
}
