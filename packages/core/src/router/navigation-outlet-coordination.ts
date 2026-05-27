/**
 * Coordination seam between navigation, prefetch, and Outlet scroll activation.
 *
 * @remarks
 * NavigationOutletCoordination owns the mutable router-to-outlet handshake for
 * mounted prefetch resolvers and one-shot scroll intent. It deliberately does
 * not match routes, render UI, load components, or perform browser scrolling.
 *
 * @since 1.0.0
 * @module trygg/router/navigation-outlet-coordination
 */
import { Deferred, Effect, Layer, Option, Ref, Schema } from "effect";
import * as Context from "effect/Context";

export type NavigationPrefetchState =
  | { readonly _tag: "Idle" }
  | { readonly _tag: "Active"; readonly prefetch: (path: string) => Effect.Effect<void> };

export interface ScrollIntent {
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
  readonly publishScrollIntent: (intent: ScrollIntent) => Effect.Effect<void>;
  readonly takeScrollIntent: Effect.Effect<Option.Option<ScrollIntent>>;
  readonly outletReady: Effect.Effect<Deferred.Deferred<void>>;
}

export const makeNavigationOutletCoordination = (
  input: NavigationOutletCoordinationConfig,
): Effect.Effect<NavigationOutletCoordinationShape> =>
  Effect.gen(function* () {
    const config = NavigationOutletCoordinationConfigInput.make(input);
    const prefetchStateRef = yield* Ref.make<NavigationPrefetchState>({ _tag: "Idle" });
    const scrollIntentRef = yield* Ref.make<Option.Option<ScrollIntent>>(Option.none());
    const outletReady = yield* Deferred.make<void>();

    return {
      prefetchState: Ref.get(prefetchStateRef),
      activatePrefetch: Effect.fn("NavigationOutletCoordination.activatePrefetch")(function* (
        prefetch,
      ) {
        yield* Ref.set(prefetchStateRef, { _tag: "Active", prefetch });
        yield* Deferred.succeed(outletReady, void 0).pipe(Effect.ignore);
        void config;
      }),
      prefetch: Effect.fn("NavigationOutletCoordination.prefetch")(function* (path) {
        const state = yield* Ref.get(prefetchStateRef);
        if (state._tag === "Active") {
          yield* state.prefetch(path);
        }
      }),
      publishScrollIntent: Effect.fn("NavigationOutletCoordination.publishScrollIntent")(
        function* (intent) {
          yield* Ref.set(scrollIntentRef, Option.some(intent));
        },
      ),
      takeScrollIntent: Ref.getAndSet(scrollIntentRef, Option.none()),
      outletReady: Effect.succeed(outletReady),
    };
  });

export class NavigationOutletCoordination extends Context.Service<
  NavigationOutletCoordination,
  NavigationOutletCoordinationShape
>()("trygg/NavigationOutletCoordination") {
  static readonly layer = (
    input: NavigationOutletCoordinationConfig,
  ): Layer.Layer<NavigationOutletCoordination> =>
    Layer.effect(NavigationOutletCoordination, makeNavigationOutletCoordination(input));
}
