/**
 * Route prefetch helpers for `trygg/router`.
 *
 * @remarks
 * Owner module for route-data prefetch execution. This module owns the helper
 * that runs route prefetch callbacks once matching has identified the target
 * route and decoded its params and query.
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
 * @since 1.0.0
 * @module trygg/router/prefetch
 */
import { Effect } from "effect";

/**
 * Run all prefetch effects in parallel.
 * Errors are logged but don't block navigation.
 *
 * @remarks
 * `runPrefetch` is the low-level executor used by the outlet once the active
 * route has been matched and its prefetch callbacks are known.
 *
 * @example
 * ```ts
 * yield* runPrefetch([loadUser], { params: { id: 123 } })
 * ```
 *
 * @category Route Prefetch
 * @public
 * @since 1.0.0
 */
export const runPrefetch = (
  prefetchFns: ReadonlyArray<(ctx: unknown) => Effect.Effect<unknown, unknown, never>>,
  ctx: unknown,
) => {
  if (prefetchFns.length === 0) {
    return Effect.void;
  }

  const effects = prefetchFns.map((fn) =>
    fn(ctx).pipe(
      Effect.catch((error: unknown) =>
        Effect.logWarning("Prefetch failed").pipe(
          Effect.annotateLogs("error", error),
          Effect.asVoid,
        ),
      ),
      Effect.asVoid,
    ),
  );

  return Effect.all(effects, { concurrency: "unbounded" }).pipe(Effect.asVoid);
};
