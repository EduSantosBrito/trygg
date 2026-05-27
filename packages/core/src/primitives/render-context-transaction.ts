import { Data, Effect, Exit, Layer, Option, Schema, Scope } from "effect";
import * as Context from "effect/Context";
import type { RenderContext } from "./renderer.js";

export type RenderContextSnapshot = RenderContext;

export interface RenderContextForkRequest {
  readonly parent: RenderContextSnapshot;
  readonly additionalServices: Option.Option<Context.Context<unknown>>;
  readonly scopeOwner: "component" | "provider" | "signal" | "portal" | "boundary";
}

export class RenderContextOwnershipError extends Data.TaggedError("RenderContextOwnershipError")<{
  readonly owner: RenderContextForkRequest["scopeOwner"];
  readonly cause: unknown;
}> {}

export const RenderContextTransactionConfigInput = Schema.Struct({
  emitLifecycleTraceEvents: Schema.Boolean,
});

type RenderContextTransactionConfig = typeof RenderContextTransactionConfigInput.Type;

export interface RenderContextTransactionShape {
  readonly forkContext: (
    request: RenderContextForkRequest,
  ) => Effect.Effect<RenderContextSnapshot, RenderContextOwnershipError>;
  readonly runEventHandler: <A, E>(
    snapshot: RenderContextSnapshot,
    handler: Effect.Effect<A, E, unknown>,
  ) => Effect.Effect<A, E>;
  readonly finalizeOwnedScope: (snapshot: RenderContextSnapshot) => Effect.Effect<void, never>;
}

export const makeRenderContextTransaction = (
  configInput: RenderContextTransactionConfig,
): RenderContextTransactionShape => {
  const config = RenderContextTransactionConfigInput.make(configInput);
  void config;

  return {
    forkContext: Effect.fn("RenderContextTransaction.forkContext")(function* (request) {
      const scope = yield* Scope.fork(request.parent.scope).pipe(
        Effect.mapError(
          (cause) => new RenderContextOwnershipError({ owner: request.scopeOwner, cause }),
        ),
      );
      const services = Option.isSome(request.additionalServices)
        ? Context.merge(request.parent.services, request.additionalServices.value)
        : request.parent.services;

      return {
        services,
        scope,
        safeUrlConfig: request.parent.safeUrlConfig,
      };
    }),
    runEventHandler: (snapshot, handler) =>
      handler.pipe(Scope.provide(snapshot.scope), Effect.provide(snapshot.services)),
    finalizeOwnedScope: Effect.fn("RenderContextTransaction.finalizeOwnedScope")(function* (
      snapshot,
    ) {
      yield* Scope.close(snapshot.scope, Exit.void).pipe(Effect.orDie);
    }),
  };
};

export class RenderContextTransaction extends Context.Service<
  RenderContextTransaction,
  RenderContextTransactionShape
>()("trygg/RenderContextTransaction") {
  static readonly layer = (
    configInput: RenderContextTransactionConfig,
  ): Layer.Layer<RenderContextTransaction> =>
    Layer.succeed(RenderContextTransaction, makeRenderContextTransaction(configInput));
}
