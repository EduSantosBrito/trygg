import { Effect, Predicate, Scope } from "effect";

/**
 * Capture the Vite owner's services and callback lifetime before registering
 * native listeners. Removing those listeners then precedes waiting for callbacks.
 *
 * @internal
 */
export const make = Effect.fnUntraced(function* <R = never>() {
  const owner = yield* Effect.scope;
  const callbacks = yield* Scope.fork(owner);
  const services = yield* Effect.context<R>();

  return (effect: Effect.Effect<unknown, unknown, R>): void => {
    if (Predicate.isTagged(owner.state, "Closed")) return;
    // forkIn attaches before the first callback instruction can reenter
    // shutdown. runSync uses its own Scheduler, so restore captured services
    // inside the child as well as at the synchronous launcher boundary.
    Effect.runSyncWith(services)(Effect.forkIn(effect.pipe(Effect.provide(services)), callbacks));
  };
});
