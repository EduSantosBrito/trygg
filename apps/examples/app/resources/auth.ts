import { Effect, Layer, Option } from "effect";
import * as Context from "effect/Context";
import { Signal } from "trygg";
import * as Router from "trygg/router";

export interface AuthUser {
  readonly id: string;
  readonly name: string;
}

export class AuthStore extends Context.Service<
  AuthStore,
  {
    readonly user: Signal.Signal<Option.Option<AuthUser>>;
    readonly setAuth: (user: Option.Option<AuthUser>) => Effect.Effect<void>;
    readonly getAuth: Effect.Effect<Option.Option<AuthUser>>;
  }
>()("examples/AuthStore") {}

/**
 * Auth state lives in a provided scoped service so it follows the app lifecycle.
 */
export const AuthLive = Layer.effect(
  AuthStore,
  Effect.gen(function* () {
    const user = yield* Signal.make<Option.Option<AuthUser>>(Option.none());
    return {
      user,
      setAuth: (nextUser: Option.Option<AuthUser>) => Signal.set(user, nextUser),
      getAuth: Signal.peek(user),
    };
  }),
);

/**
 * Helper to set auth state.
 */
export const setAuth = (user: Option.Option<AuthUser>): Effect.Effect<void, never, AuthStore> =>
  Effect.service(AuthStore).pipe(Effect.flatMap((store) => store.setAuth(user)));

/**
 * Helper to get current auth state.
 */
export const getAuth: Effect.Effect<Option.Option<AuthUser>, never, AuthStore> = Effect.service(
  AuthStore,
).pipe(Effect.flatMap((store) => store.getAuth));

/**
 * Route middleware - checks if user is authenticated.
 * Redirects to /login if not authenticated.
 */
export const requireAuth = Effect.gen(function* () {
  const user = yield* getAuth;

  if (Option.isNone(user)) {
    return yield* Router.routeRedirect("/login");
  }
});
