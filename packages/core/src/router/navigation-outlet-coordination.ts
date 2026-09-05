/**
 * Coordination seam between navigation, prefetch, and Outlet scroll activation.
 *
 * @remarks
 * NavigationOutletCoordination owns the mutable router-to-outlet handshake for
 * mounted prefetch resolvers and outlet readiness. Scroll intent instead travels
 * with its navigation snapshot so activation ownership remains explicit.
 *
 * @since 1.0.0
 * @module trygg/router/navigation-outlet-coordination
 */
import { Data, Deferred, Effect, Ref, Schema } from "effect";

export type NavigationPrefetchState = Data.TaggedEnum<{
  readonly Idle: {};
  readonly Active: { readonly prefetch: (path: string) => Effect.Effect<void> };
}>;

export const NavigationPrefetchState = Data.taggedEnum<NavigationPrefetchState>();

export interface ScrollIntent {
  readonly navigationId: number;
  readonly isPopstate: boolean;
  readonly hash: string;
  readonly scrollKey: string;
}

export const NavigationOutletCoordinationConfigInput = Schema.Struct({
  replayLatestPrefetchState: Schema.Boolean,
});

type NavigationOutletCoordinationConfig = typeof NavigationOutletCoordinationConfigInput.Type;

export interface NavigationOutletCoordinationShape {
  readonly prefetchState: Effect.Effect<NavigationPrefetchState>;
  readonly activatePrefetch: (
    prefetch: (path: string) => Effect.Effect<void>,
  ) => Effect.Effect<void>;
  readonly prefetch: (path: string) => Effect.Effect<void>;
  readonly outletReady: Effect.Effect<Deferred.Deferred<void>>;
}

const makeService: (
  input: NavigationOutletCoordinationConfig,
) => Effect.Effect<NavigationOutletCoordinationShape> = Effect.fn(
  "NavigationOutletCoordination.make",
)(function* (input: NavigationOutletCoordinationConfig) {
  const config = NavigationOutletCoordinationConfigInput.make(input);
  const prefetchStateRef = yield* Ref.make<NavigationPrefetchState>(NavigationPrefetchState.Idle());
  const outletReady = yield* Deferred.make<void>();

  return {
    prefetchState: config.replayLatestPrefetchState
      ? Ref.get(prefetchStateRef)
      : Effect.succeed(NavigationPrefetchState.Idle()),
    activatePrefetch: Effect.fn("NavigationOutletCoordination.activatePrefetch")(function* (
      prefetch: (path: string) => Effect.Effect<void>,
    ) {
      yield* Ref.set(prefetchStateRef, NavigationPrefetchState.Active({ prefetch }));
      yield* Deferred.succeed(outletReady, undefined).pipe(Effect.asVoid);
    }),
    prefetch: Effect.fn("NavigationOutletCoordination.prefetch")(function* (path: string) {
      const state = yield* Ref.get(prefetchStateRef);
      if (NavigationPrefetchState.$is("Active")(state)) {
        yield* state.prefetch(path);
      }
    }),
    outletReady: Effect.succeed(outletReady),
  };
});

export const NavigationOutletCoordination = { make: makeService };
