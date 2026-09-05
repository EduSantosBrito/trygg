import { Effect, Layer, Option, Redacted, Schema } from "effect";
import * as Context from "effect/Context";
import { HttpClientRequest } from "effect/unstable/http";
import { HttpApiMiddleware } from "effect/unstable/httpapi";
import { Signal } from "trygg";
import { MutationAuthorization } from "./authorization";
import { MutationToken } from "../errors/incidents";

const isToken = Schema.is(MutationToken);

export class MutationAccessError extends Schema.TaggedError<MutationAccessError>()(
  "MutationAccessError",
  { message: Schema.String },
) {}

/** Tab-local credentials. Only the presence flag is reactive; the token stays private. */
export class MutationAccess extends Context.Service<
  MutationAccess,
  {
    readonly configured: Signal.Signal<boolean>;
    readonly setToken: (
      token: Redacted.Redacted<string>,
    ) => Effect.Effect<void, MutationAccessError>;
    readonly clear: Effect.Effect<void>;
    readonly authorize: (
      request: HttpClientRequest.HttpClientRequest,
    ) => Effect.Effect<HttpClientRequest.HttpClientRequest>;
  }
>()("incident/MutationAccess") {}

export namespace MutationAccess {
  export const layer = Layer.effect(
    MutationAccess,
    Effect.gen(function* () {
      const configured = yield* Signal.make(false);
      let token = Option.none<Redacted.Redacted<string>>();
      let open = true;
      yield* Effect.addFinalizer(() =>
        Effect.sync(() => {
          open = false;
          token = Option.none();
        }),
      );
      return MutationAccess.of({
        configured,
        setToken: (next) =>
          Effect.gen(function* () {
            if (!open) return yield* new MutationAccessError({ message: "This session is closed" });
            const value = Redacted.value(next);
            if (!isToken(value)) {
              return yield* new MutationAccessError({
                message: "Enter a valid access token (32–512 characters)",
              });
            }
            token = Option.some(next);
            yield* Signal.set(configured, true);
          }),
        clear: Effect.suspend(() => {
          token = Option.none();
          return open ? Signal.set(configured, false) : Effect.void;
        }),
        authorize: (request) =>
          Effect.sync(() =>
            Option.isSome(token)
              ? HttpClientRequest.setHeader(
                  request,
                  "authorization",
                  `Bearer ${Redacted.value(token.value)}`,
                )
              : request,
          ),
      });
    }).pipe(Effect.annotateLogs({ service: "MutationAccess" })),
  );

  /** Only endpoints carrying MutationAuthorization receive this credential. */
  export const clientLayer = HttpApiMiddleware.layerClient(
    MutationAuthorization,
    Effect.gen(function* () {
      const access = yield* MutationAccess;
      return ({ request, next }) => access.authorize(request).pipe(Effect.flatMap(next));
    }),
  );
}
