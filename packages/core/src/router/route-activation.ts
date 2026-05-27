/**
 * Current-route activation coordination for Outlet.
 *
 * @remarks
 * RouteActivation owns latest-activation identity and stale commit suppression.
 * Outlet remains responsible for rendering elements and DOM replacement, while
 * this seam decides whether a route activation is still current before visible
 * UI may commit.
 *
 * @since 1.0.0
 * @module trygg/router/route-activation
 */
import { Data, Deferred, Effect, Layer, Option, Schema, SynchronizedRef } from "effect";
import * as Context from "effect/Context";
import type { ScrollIntent } from "./navigation-outlet-coordination.js";
import type { RouteMatch, RouteMatcherShape } from "./matching.js";

export interface RouteActivationRequest {
  readonly activationId: string;
  readonly path: string;
  readonly query: URLSearchParams;
  readonly scrollIntent: Option.Option<ScrollIntent>;
}

export type RouteActivationOutcome =
  | { readonly _tag: "Committed"; readonly activationId: string; readonly path: string }
  | { readonly _tag: "DroppedStale"; readonly activationId: string; readonly supersededBy: string }
  | { readonly _tag: "NotFound"; readonly activationId: string; readonly path: string };

export class RouteActivationError extends Data.TaggedError("RouteActivationError")<{
  readonly activationId: string;
  readonly path: string;
  readonly cause: unknown;
}> {}

export const RouteActivationConfigInput = Schema.Struct({
  emitTraceEvents: Schema.Boolean,
});

type RouteActivationConfig = typeof RouteActivationConfigInput.Type;

export interface RouteActivationShape {
  readonly activate: (
    request: RouteActivationRequest,
  ) => Effect.Effect<RouteActivationOutcome, RouteActivationError>;
  readonly commit: (
    request: Pick<RouteActivationRequest, "activationId" | "path">,
  ) => Effect.Effect<RouteActivationOutcome>;
  readonly currentActivationId: Effect.Effect<Option.Option<string>>;
  readonly waitForDomSwap: (activationId: string) => Effect.Effect<Deferred.Deferred<void>>;
}

export const makeRouteActivation = (
  input: RouteActivationConfig,
  matcher?: RouteMatcherShape,
): Effect.Effect<RouteActivationShape> =>
  Effect.gen(function* () {
    const config = RouteActivationConfigInput.make(input);
    const current = yield* SynchronizedRef.make<Option.Option<string>>(Option.none());

    const currentOrStale = (activationId: string, path: string): Effect.Effect<RouteActivationOutcome> =>
      Effect.gen(function* () {
        const latest = yield* SynchronizedRef.get(current);
        if (Option.isSome(latest) && latest.value !== activationId) {
          return { _tag: "DroppedStale", activationId, supersededBy: latest.value } as const;
        }
        return { _tag: "Committed", activationId, path } as const;
      });

    return {
      activate: Effect.fn("RouteActivation.activate")(function* (request) {
        yield* SynchronizedRef.set(current, Option.some(request.activationId));
        if (matcher !== undefined) {
          const match = yield* matcher.match(request.path).pipe(
            Effect.mapError(
              (cause) =>
                new RouteActivationError({
                  activationId: request.activationId,
                  path: request.path,
                  cause,
                }),
            ),
          );
          if (Option.isNone(match)) {
            return { _tag: "NotFound", activationId: request.activationId, path: request.path };
          }
        }
        void config;
        return { _tag: "Committed", activationId: request.activationId, path: request.path };
      }),
      commit: Effect.fn("RouteActivation.commit")(function* (request) {
        return yield* currentOrStale(request.activationId, request.path);
      }),
      currentActivationId: SynchronizedRef.get(current),
      waitForDomSwap: Effect.fn("RouteActivation.waitForDomSwap")(function* (_activationId) {
        return yield* Deferred.make<void>();
      }),
    };
  });

export class RouteActivation extends Context.Service<RouteActivation, RouteActivationShape>()(
  "trygg/RouteActivation",
) {
  static readonly layer = (
    input: RouteActivationConfig,
    matcher?: RouteMatcherShape,
  ): Layer.Layer<RouteActivation> => Layer.effect(RouteActivation, makeRouteActivation(input, matcher));
}

export type RouteActivationMatch = RouteMatch;
