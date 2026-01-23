/**
 * @since 1.0.0
 * Prefetch Runner
 *
 * Runs prefetch effects in parallel when a route matches.
 * Errors in prefetch are logged but don't block navigation.
 *
 * @example
 * ```tsx
 * Route.make("/users/:id")
 *   .prefetch(({ params }) => Effect.succeed(userResource({ id: params.id })))
 *   .component(UserProfile)
 * ```
 */
import { Effect } from "effect";

/**
 * Run all prefetch effects in parallel.
 * Errors are logged but don't block navigation.
 *
 * @since 1.0.0
 */
export const runPrefetch = (
  prefetchFns: ReadonlyArray<(ctx: unknown) => Effect.Effect<unknown, unknown, never>>,
  ctx: unknown,
): Effect.Effect<void, never, never> => {
  if (prefetchFns.length === 0) {
    return Effect.void;
  }

  const effects = prefetchFns.map((fn) =>
    fn(ctx).pipe(
      Effect.catchAll((error) =>
        Effect.logWarning("Prefetch failed").pipe(
          Effect.annotateLogs("error", String(error)),
          Effect.asVoid,
        ),
      ),
      Effect.asVoid,
    ),
  );

  return Effect.all(effects, { concurrency: "unbounded" }).pipe(Effect.asVoid);
};
