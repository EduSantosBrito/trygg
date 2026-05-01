import { Effect, SubscriptionRef } from "effect";
import * as Router from "trygg/router";

export const currentRouteSnapshot = Effect.gen(function* () {
  const router = yield* Router.get;
  return yield* SubscriptionRef.get(router.current._ref);
});
