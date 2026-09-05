import { Effect, Layer, Option, Schema } from "effect";
import { ApiClient, ApiClientLive } from "trygg/api";
import { AppTheme } from "./theme";
import { MutationAccess } from "./mutation-access";

export class AppServiceUnavailable extends Schema.TaggedError<AppServiceUnavailable>()(
  "AppServiceUnavailable",
  {
    service: Schema.Literal("ApiClient"),
  },
) {}

/** The single application composition root acquired by the document layout. */
export const AppServicesLive = Layer.merge(
  AppTheme.dark,
  ApiClientLive.pipe(
    Layer.provide(MutationAccess.clientLayer),
    Layer.provideMerge(MutationAccess.layer),
  ),
);

export namespace ApiClientRoot {
  export const layer = Layer.effect(
    ApiClient,
    // oxlint-disable-next-line effect/no-service-option -- This bridge preserves the root instance while closing route requirements and fails explicitly when absent.
    Effect.serviceOption(ApiClient).pipe(
      Effect.flatMap((service) =>
        Option.isSome(service)
          ? Effect.succeed(service.value)
          : Effect.fail(new AppServiceUnavailable({ service: "ApiClient" })),
      ),
    ),
  );
}
