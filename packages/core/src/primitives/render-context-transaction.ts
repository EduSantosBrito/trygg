import { Effect, Exit, Option, Schema, Scope } from "effect";
import * as Context from "effect/Context";
import * as Trace from "../trace/index.js";
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

export class RenderContextOwnershipError extends Schema.TaggedError<RenderContextOwnershipError>()(
  "RenderContextOwnershipError",
  {
    owner: ScopeOwner,
    cause: Schema.Unknown,
  },
) {}

export const forkContext: (
  request: RenderContextForkRequest,
) => Effect.Effect<RenderContextSnapshot, RenderContextOwnershipError> = Effect.fnUntraced(
  function* (request: RenderContextForkRequest) {
    yield* Trace.emit("effect.fork.scoped", () => ({ owner: request.scopeOwner }));
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
  },
);

export const runEventHandler = <A, E, R>(
  snapshot: RenderContextSnapshot,
  handler: Effect.Effect<A, E, R>,
): Effect.Effect<A, E> =>
  handler.pipe(Scope.provide(snapshot.scope), Effect.provide(snapshot.services));

export const finalizeOwnedScope: (snapshot: RenderContextSnapshot) => Effect.Effect<void, never> =
  Effect.fnUntraced(function* (snapshot: RenderContextSnapshot) {
    yield* Scope.close(snapshot.scope, Exit.void);
    yield* Trace.emit("effect.scope.close", () => ({ owner: "render-context" }));
  });
