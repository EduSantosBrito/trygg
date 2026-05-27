import { Cause, Data, Effect, Exit, Layer, Option, Schema } from "effect";
import * as Context from "effect/Context";
import * as ContractTrace from "../contract/trace.js";
import type { Element } from "./element.js";
import type { RenderContext, RenderResult } from "./renderer.js";

export interface RenderTransactionRequest<R> {
  readonly parent: Node;
  readonly previous: Option.Option<RenderResult>;
  readonly renderNext: Effect.Effect<RenderResult, unknown, R>;
  readonly context: RenderContext;
}

export interface RenderTransactionReconcileRequest {
  readonly previous: RenderResult;
  readonly nextElement: Element;
  readonly nextContext: Context.Context<unknown> | null;
  readonly context: RenderContext;
}

export type RenderTransactionOutcome = Data.TaggedEnum<{
  readonly Committed: { readonly result: RenderResult };
  readonly Reconciled: { readonly result: RenderResult };
  readonly NotReconciled: { readonly result: RenderResult };
  readonly FailedBeforeCommit: { readonly cause: unknown };
}>;

export const RenderTransactionOutcome = Data.taggedEnum<RenderTransactionOutcome>();

export class RenderTransactionError extends Schema.TaggedErrorClass<RenderTransactionError>()(
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

export const RenderTransactionConfigInput = Schema.Struct({
  emitTraceEvents: Schema.Boolean,
});

type RenderTransactionConfig = typeof RenderTransactionConfigInput.Type;

const UnknownRuntimeContext = Context.Service<unknown>(
  "trygg/RenderTransaction/UnknownRuntimeContext",
);
const emptyRuntimeContext = Context.make(UnknownRuntimeContext, undefined);

const emitRenderTrace = (
  enabled: boolean,
  event: ContractTrace.ContractTraceEventName,
  payload: Record<string, unknown>,
): Effect.Effect<void> =>
  enabled ? ContractTrace.emit({ event, level: "semantic", payload }) : Effect.void;

export interface RenderTransactionShape {
  readonly replace: <R>(
    request: RenderTransactionRequest<R>,
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
          cause: Cause.pretty(rendered.cause),
        });
        return RenderTransactionOutcome.FailedBeforeCommit({ cause });
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

      return RenderTransactionOutcome.Committed({ result: next });
    }),
    reconcile: Effect.fn("RenderTransaction.reconcile")(function* (request) {
      yield* emitRenderTrace(config.emitTraceEvents, "signalElement.swap.start", {
        operation: "reconcile",
      });
      if (request.previous.reconcile === undefined) {
        return RenderTransactionOutcome.NotReconciled({ result: request.previous });
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
          cause: Cause.pretty(reconciled.cause),
        });
        return RenderTransactionOutcome.FailedBeforeCommit({ cause });
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
        ? RenderTransactionOutcome.Reconciled({ result: request.previous })
        : RenderTransactionOutcome.NotReconciled({ result: request.previous });
    }),
    cleanup: Effect.fn("RenderTransaction.cleanup")(function* (result) {
      yield* emitRenderTrace(config.emitTraceEvents, "signalElement.cleanup", {
        operation: "cleanup",
        reason: "explicit",
      });
      yield* result.cleanup.pipe(Effect.provide(emptyRuntimeContext));
    }),
  };
};

export class RenderTransaction extends Context.Service<
  RenderTransaction,
  {
    readonly replace: <R>(
      request: RenderTransactionRequest<R>,
    ) => Effect.Effect<RenderTransactionOutcome, RenderTransactionError>;
    readonly reconcile: (
      request: RenderTransactionReconcileRequest,
    ) => Effect.Effect<RenderTransactionOutcome>;
    readonly cleanup: (result: RenderResult) => Effect.Effect<void, unknown>;
  }
>()("trygg/RenderTransaction") {
  static readonly layer = (configInput: RenderTransactionConfig): Layer.Layer<RenderTransaction> =>
    Layer.succeed(RenderTransaction, makeRenderTransaction(configInput));
}
