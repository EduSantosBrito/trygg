import { Cause, Data, Effect, Exit, Layer, Option, Schema } from "effect";
import * as Context from "effect/Context";
import type { RenderContext, RenderResult } from "./renderer.js";

export interface RenderTransactionRequest {
  readonly parent: Node;
  readonly previous: Option.Option<RenderResult>;
  readonly renderNext: Effect.Effect<RenderResult, unknown, unknown>;
  readonly context: RenderContext;
}

export type RenderTransactionOutcome =
  | { readonly _tag: "Committed"; readonly result: RenderResult }
  | { readonly _tag: "Reconciled"; readonly result: RenderResult }
  | { readonly _tag: "FailedBeforeCommit"; readonly cause: unknown };

export class RenderTransactionError extends Data.TaggedError("RenderTransactionError")<{
  readonly phase: "render" | "commit" | "cleanup";
  readonly cause: unknown;
}> {}

export const RenderTransactionConfigInput = Schema.Struct({
  emitTraceEvents: Schema.Boolean,
});

type RenderTransactionConfig = typeof RenderTransactionConfigInput.Type;

export interface RenderTransactionShape {
  readonly replace: (
    request: RenderTransactionRequest,
  ) => Effect.Effect<RenderTransactionOutcome, RenderTransactionError>;
  readonly cleanup: (result: RenderResult) => Effect.Effect<void, unknown>;
}

export const makeRenderTransaction = (
  configInput: RenderTransactionConfig,
): RenderTransactionShape => {
  const config = RenderTransactionConfigInput.make(configInput);
  void config;

  return {
    replace: Effect.fn("RenderTransaction.replace")(function* (request) {
      const rendered = yield* Effect.exit(
        request.renderNext.pipe(Effect.provide(request.context.services)),
      );
      if (Exit.isFailure(rendered)) {
        return { _tag: "FailedBeforeCommit", cause: Cause.squash(rendered.cause) };
      }

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

      if (previous !== undefined) {
        yield* previous.cleanup.pipe(
          Effect.provide(request.context.services),
          Effect.mapError((cause) => new RenderTransactionError({ phase: "cleanup", cause })),
        );
      }

      return { _tag: "Committed", result: next };
    }),
    cleanup: Effect.fn("RenderTransaction.cleanup")(function* (result) {
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
