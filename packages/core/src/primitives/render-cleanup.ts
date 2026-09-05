import { Cause, Effect, Exit, Scope } from "effect";
import * as Context from "effect/Context";

// Scope finalizers have no typed recovery channel. Promote only typed release
// failures, preserving every existing defect and interrupt for the closing owner.
export const asFinalizer = <A, E, R>(effect: Effect.Effect<A, E, R>): Effect.Effect<A, never, R> =>
  effect.pipe(
    Effect.catchCause((cause) =>
      Effect.failCause(
        Cause.fromReasons<never>(
          cause.reasons.map((reason) =>
            Cause.isFailReason(reason)
              ? Cause.makeDieReason(reason.error).annotate(
                  // rc.112's implementation requires a Context despite its
                  // wider public annotation type. Preserve each reason's context.
                  Cause.reasonAnnotations(reason),
                )
              : reason,
          ),
        ),
      ),
    ),
  );

export const cleanupAll = Effect.fnUntraced(function* <E, R>(
  cleanups: Iterable<Effect.Effect<void, E, R>>,
) {
  let cleanupCause: Cause.Cause<E> | undefined;
  return yield* Effect.uninterruptible(
    Effect.gen(function* () {
      // Successful releases need no retained result; teardown often visits
      // thousands of DOM nodes. Keep only failures for Effect's Cause aggregation.
      const failures: Array<Exit.Failure<void, E>> = [];
      for (const cleanup of cleanups) {
        const exit = yield* Effect.exit(cleanup);
        if (Exit.isFailure(exit)) failures.push(exit);
      }

      const combined = Exit.asVoidAll(failures);
      if (Exit.isFailure(combined)) cleanupCause = combined.cause;
    }),
  ).pipe(
    // A deferred interrupt is the primary Exit; failing its finalizer retains
    // every cleanup Cause instead of allowing either side to replace the other.
    Effect.onExit(() =>
      cleanupCause === undefined ? Effect.void : Effect.failCause(cleanupCause),
    ),
  );
});

export const reportUnhandledRenderCause = (cause: Cause.Cause<unknown>): void => {
  if (Cause.hasInterruptsOnly(cause)) return;
  console.error("[trygg] Unhandled render fiber failure:", Cause.pretty(cause));
};

export const reportUnhandledRenderExit = <A, E>(exit: Exit.Exit<A, E>): void => {
  if (Exit.isFailure(exit)) reportUnhandledRenderCause(exit.cause);
};

export const runOwnedRenderFiber = <A, E, R>(
  effect: Effect.Effect<A, E, R>,
  services: Context.Context<R>,
  scope: Scope.Scope,
): void => {
  // forkIn registers ownership before scheduling; flush preserves the renderer's
  // synchronous-start behavior without a start-before-registration window. The
  // launcher uses its own dispatcher so a re-entrant captured dispatcher cannot
  // defer the first run; the child installs the captured services when it starts.
  const owned = Effect.provide(effect.pipe(Scope.provide(scope)), services);
  const launch = Effect.forkIn(owned, scope).pipe(
    Effect.tap((fiber) =>
      Effect.sync(() => {
        fiber.addObserver(reportUnhandledRenderExit);
      }),
    ),
    Effect.asVoid,
  );

  const launcher = Effect.runFork(launch);
  launcher.addObserver(reportUnhandledRenderExit);
  launcher.currentDispatcher.flush();
};
