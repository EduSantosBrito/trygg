import { Effect, Option } from "effect";
import { Signal } from "effect-ui";
import * as Router from "effect-ui/router";

export interface AuthUser {
  readonly id: string;
  readonly name: string;
}

/**
 * Global auth signal - in a real app this would be a proper service
 */
export const authSignal = Signal.unsafeMake<Option.Option<AuthUser>>(Option.none());

/**
 * Helper to set auth state
 */
export const setAuth = (user: Option.Option<AuthUser>): Effect.Effect<void> =>
  Signal.set(authSignal, user);

/**
 * Helper to get current auth state
 */
export const getAuth = Signal.get(authSignal);

/**
 * Route middleware - checks if user is authenticated.
 * Redirects to /login if not authenticated.
 */
export const requireAuth = Effect.gen(function* () {
  const user = yield* Signal.get(authSignal);

  if (Option.isNone(user)) {
    return yield* Router.routeRedirect("/login");
  }
});
