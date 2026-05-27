import { Effect, Exit, Layer, Option, Schema, Scope } from "effect";
import * as Context from "effect/Context";
import * as ContractTrace from "../contract/trace.js";
import type { RenderContext } from "./renderer.js";

export type RenderContextSnapshot = RenderContext;

export interface RenderContextForkRequest {
  readonly parent: RenderContextSnapshot;
  readonly additionalServices: Option.Option<Context.Context<unknown>>;
  readonly scopeOwner: "component" | "provider" | "signal" | "portal" | "boundary";
}

const ScopeOwner = Schema.Union([
  Schema.Literal("component"),
  Schema.Literal("provider"),
  Schema.Literal("signal"),
  Schema.Literal("portal"),
  Schema.Literal("boundary"),
]);

export class RenderContextOwnershipError extends Schema.TaggedErrorClass<RenderContextOwnershipError>()(
  "RenderContextOwnershipError",
  {
    owner: ScopeOwner,
    cause: Schema.Unknown,
  },
) {}

export const RenderContextTransactionConfigInput = Schema.Struct({
  emitLifecycleTraceEvents: Schema.Boolean,
});

type RenderContextTransactionConfig = typeof RenderContextTransactionConfigInput.Type;

const emitLifecycleTrace = (
  enabled: boolean,
  event: ContractTrace.ContractTraceEventName,
  payload: Record<string, unknown>,
): Effect.Effect<void> =>
  enabled ? ContractTrace.emit({ event, level: "semantic", payload }) : Effect.void;

export interface RenderContextTransactionShape {
  readonly forkContext: (
    request: RenderContextForkRequest,
  ) => Effect.Effect<RenderContextSnapshot, RenderContextOwnershipError>;
  readonly runEventHandler: <A, E, R>(
    snapshot: RenderContextSnapshot,
    handler: Effect.Effect<A, E, R>,
  ) => Effect.Effect<A, E>;
  readonly finalizeOwnedScope: (snapshot: RenderContextSnapshot) => Effect.Effect<void, never>;
}

export const makeRenderContextTransaction = (
  configInput: RenderContextTransactionConfig,
): RenderContextTransactionShape => {
  const config = RenderContextTransactionConfigInput.make(configInput);

  return {
    forkContext: Effect.fn("RenderContextTransaction.forkContext")(function* (request) {
      yield* emitLifecycleTrace(config.emitLifecycleTraceEvents, "effect.fork.scoped", {
        owner: request.scopeOwner,
      });
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
    finalizeOwnedScope: Effect.fn("RenderContextTransaction.finalizeOwnedScope")(
      function* (snapshot) {
        yield* Scope.close(snapshot.scope, Exit.void);
        yield* emitLifecycleTrace(config.emitLifecycleTraceEvents, "effect.scope.close", {
          owner: "render-context",
        });
      },
    ),
  };
};

export class RenderContextTransaction extends Context.Service<
  RenderContextTransaction,
  {
    readonly forkContext: (
      request: RenderContextForkRequest,
    ) => Effect.Effect<RenderContextSnapshot, RenderContextOwnershipError>;
    readonly runEventHandler: <A, E, R>(
      snapshot: RenderContextSnapshot,
      handler: Effect.Effect<A, E, R>,
    ) => Effect.Effect<A, E>;
    readonly finalizeOwnedScope: (snapshot: RenderContextSnapshot) => Effect.Effect<void, never>;
  }
>()("trygg/RenderContextTransaction") {
  static readonly layer = (
    configInput: RenderContextTransactionConfig,
  ): Layer.Layer<RenderContextTransaction> =>
    Layer.succeed(RenderContextTransaction, makeRenderContextTransaction(configInput));
}
