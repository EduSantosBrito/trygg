/**
 * @since 1.0.0
 * Render Strategy
 *
 * Controls how route components are loaded. Lazy loading uses dynamic import,
 * eager loading uses direct references (component already in memory).
 *
 * @example
 * ```tsx
 * import { Route, RenderStrategy } from "trygg/router"
 *
 * // Lazy (default) - vite transforms to dynamic import
 * Route.make("/users").component(UsersList)
 *
 * // Eager - stays as direct import, bundled in main chunk
 * Route.make("/").component(HomePage).pipe(Route.provide(RenderStrategy.Eager))
 * ```
 */
import { Context, Data, Effect, Layer } from "effect";

/**
 * RenderStrategy service interface.
 *
 * - `isEager`: true if component is already loaded (no dynamic import needed)
 * - `load`: loads a component from a dynamic import loader function.
 *   Only called for Lazy routes (after vite transform rewrites .component() to a loader).
 *
 * @since 1.0.0
 */
export interface RenderStrategyService {
  readonly _tag: "RenderStrategy";
  /** Whether the component is already loaded (no loader call needed) */
  readonly isEager: boolean;
  /** Load a component via dynamic import. Only used for Lazy routes. */
  readonly load: <A>(
    loader: () => Promise<{ default: A }>,
  ) => Effect.Effect<A, RenderLoadError, never>;
}

/**
 * Error when a render strategy load fails.
 * @since 1.0.0
 */
export class RenderLoadError extends Data.TaggedError("RenderLoadError")<{
  readonly cause: unknown;
}> {}

/**
 * RenderStrategy Context.Tag.
 * @since 1.0.0
 */
export class RenderStrategy extends Context.Tag("trygg/RenderStrategy")<
  RenderStrategy,
  RenderStrategyService
>() {
  /**
   * Lazy rendering - dynamic import at render time.
   * This is the default strategy. The vite plugin transforms .component(X)
   * into .component(() => import("./X")) for Lazy routes.
   */
  static readonly Lazy: Layer.Layer<RenderStrategy> = Layer.succeed(RenderStrategy, {
    _tag: "RenderStrategy",
    isEager: false,
    load: <A>(loader: () => Promise<{ default: A }>) =>
      Effect.tryPromise({
        try: () => loader(),
        catch: (cause) => new RenderLoadError({ cause }),
      }).pipe(Effect.map((m) => m.default)),
  });

  /**
   * Eager rendering - component already imported (no loader needed).
   * For critical paths that should be bundled with the main chunk.
   * The vite plugin does NOT transform .component() for Eager routes.
   *
   * `load` should never be called for Eager routes (the outlet renders directly).
   * If called anyway, it acts as a passthrough.
   */
  static readonly Eager: Layer.Layer<RenderStrategy> = Layer.succeed(RenderStrategy, {
    _tag: "RenderStrategy",
    isEager: true,
    load: <A>(loader: () => Promise<{ default: A }>) =>
      Effect.tryPromise({
        try: () => loader(),
        catch: (cause) => new RenderLoadError({ cause }),
      }).pipe(Effect.map((m) => m.default)),
  });
}
