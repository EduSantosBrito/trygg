import { Config, Effect, Layer, Option, Predicate, Redacted, Schema } from "effect";
import * as Context from "effect/Context";
import { HttpEffect, HttpServerRequest, HttpServerResponse } from "effect/unstable/http";
import { HttpApiMiddleware, HttpApiSchema } from "effect/unstable/httpapi";
import {
  MutationToken,
  MutationForbidden,
  MutationUnauthenticated,
  MutationAuthenticationUnavailable,
} from "../errors/incidents";

export const AuthenticatedMutation = Schema.TaggedStruct("Authenticated", {
  principalId: Schema.String,
});
export const DenyMutation = Schema.TaggedStruct("Deny", { reason: Schema.String });
export const MutationPolicyDecision = Schema.Union([AuthenticatedMutation, DenyMutation]);
export type MutationPolicyDecision = Schema.Schema.Type<typeof MutationPolicyDecision>;

/** Only the trusted server policy can turn a credential into an authenticated principal. */
export class MutationPolicy extends Context.Service<
  MutationPolicy,
  {
    readonly decide: (
      token: Redacted.Redacted<string>,
    ) => Effect.Effect<
      MutationPolicyDecision,
      MutationUnauthenticated | MutationAuthenticationUnavailable
    >;
  }
>()("incident/MutationPolicy") {}

export class MutationPrincipal extends Context.Service<
  MutationPrincipal,
  { readonly id: string; readonly anonymous: false }
>()("incident/MutationPrincipal") {}

export class MutationAuthorization extends HttpApiMiddleware.Service<
  MutationAuthorization,
  { requires: MutationPolicy; provides: MutationPrincipal }
>()("incident/MutationAuthorization", {
  error: [
    HttpApiSchema.status(401)(MutationUnauthenticated),
    HttpApiSchema.status(403)(MutationForbidden),
    HttpApiSchema.status(503)(MutationAuthenticationUnavailable),
  ],
}) {}

const unauthorized = () =>
  new MutationUnauthenticated({ message: "A valid access token is required" });
const unavailable = () =>
  new MutationAuthenticationUnavailable({ message: "Authentication is unavailable" });
const isToken = Schema.is(MutationToken);

export class MutationTokenConfigurationError extends Schema.TaggedError<MutationTokenConfigurationError>()(
  "MutationTokenConfigurationError",
  { message: Schema.String },
) {}

export namespace MutationPolicy {
  /** Explicit trusted policy override, useful for denial and controlled tests. */
  export const layer = (decision: MutationPolicyDecision): Layer.Layer<MutationPolicy> =>
    Layer.succeed(MutationPolicy, MutationPolicy.of({ decide: () => Effect.succeed(decision) }));

  /** One operator credential; verification material belongs to this Layer acquisition. */
  export const tokenLayer = (token: Redacted.Redacted<string>) =>
    Layer.effect(
      MutationPolicy,
      Effect.gen(function* () {
        if (!isToken(Redacted.value(token)))
          return yield* new MutationTokenConfigurationError({
            message: "INCIDENT_ACCESS_TOKEN must contain 32–512 bearer-token characters",
          });
        // WebCrypto verifies the MAC natively instead of an early-exit JavaScript string comparison.
        const verifier = yield* Effect.tryPromise({
          try: async () => {
            const subtle = globalThis.crypto.subtle;
            const key = await subtle.generateKey({ name: "HMAC", hash: "SHA-256" }, false, [
              "sign",
              "verify",
            ]);
            const signature = await subtle.sign(
              "HMAC",
              key,
              new TextEncoder().encode(Redacted.value(token)),
            );
            return { subtle, key, signature };
          },
          catch: unavailable,
        });
        return MutationPolicy.of({
          decide: (candidate) =>
            Effect.gen(function* () {
              if (!isToken(Redacted.value(candidate))) return yield* unauthorized();
              const matches = yield* Effect.tryPromise({
                try: () =>
                  verifier.subtle.verify(
                    "HMAC",
                    verifier.key,
                    verifier.signature,
                    new TextEncoder().encode(Redacted.value(candidate)),
                  ),
                catch: unavailable,
              });
              return matches
                ? AuthenticatedMutation.make({ principalId: "operator" })
                : yield* unauthorized();
            }),
        });
      }).pipe(Effect.annotateLogs({ service: "MutationPolicy" })),
    );
}

export namespace MutationAuthorization {
  export const layer = Layer.succeed(
    MutationAuthorization,
    MutationAuthorization.of((httpEffect) =>
      Effect.gen(function* () {
        yield* HttpEffect.appendPreResponseHandler((_request, response) =>
          Effect.succeed(
            response.status === 401
              ? HttpServerResponse.setHeader(
                  response,
                  "www-authenticate",
                  'Bearer realm="incident"',
                )
              : response,
          ),
        );
        const request = yield* HttpServerRequest.HttpServerRequest;
        const header = request.headers.authorization;
        // Bound and decode transport input before crypto or repository work.
        const match =
          typeof header === "string" && header.length <= 1024
            ? /^Bearer +([A-Za-z0-9\-._~+/]+=*)$/i.exec(header)
            : null;
        const raw = match?.[1];
        if (raw === undefined || !isToken(raw)) return yield* unauthorized();
        const policy = yield* MutationPolicy;
        const decision = yield* policy.decide(Redacted.make(raw));
        if (Predicate.isTagged(decision, "Deny"))
          return yield* new MutationForbidden({ message: decision.reason });
        return yield* Effect.provideService(
          httpEffect,
          MutationPrincipal,
          MutationPrincipal.of({ id: decision.principalId, anonymous: false }),
        );
      }),
    ),
  );
}

/** No configured credential means mutations remain closed; public reads still work. */
export const TokenMutationPolicyLive = Layer.unwrap(
  Config.option(Config.redacted("INCIDENT_ACCESS_TOKEN")).pipe(
    Effect.map((token) =>
      Option.isSome(token)
        ? MutationPolicy.tokenLayer(token.value)
        : Layer.succeed(
            MutationPolicy,
            MutationPolicy.of({ decide: () => Effect.fail(unauthorized()) }),
          ),
    ),
  ),
);
