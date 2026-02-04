/**
 * @since 1.0.0
 * Render Strategy
 *
 * Controls how route components are loaded. Provided as a Layer via
 * `Route.provide(RenderStrategy.Eager)`. The Vite plugin reads the
 * strategy at build time; the runtime dispatches structurally.
 *
 * Extensible: future strategies (Server, Island, Static) add union
 * members to `RenderStrategyType` without breaking existing code.
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
import { Context, Data, Layer } from "effect";

// =============================================================================
// Strategy Variants (discriminated union)
// =============================================================================

/**
 * Eager — component stays in main bundle. No code splitting.
 * Vite plugin skips the dynamic import transform for Eager routes.
 * @since 1.0.0
 */
export interface Eager {
  readonly _tag: "Eager";
}

/**
 * Lazy — component is code-split via dynamic import. Default strategy.
 * Vite plugin transforms `.component(X)` → `.component(() => import("./X"))`.
 * @since 1.0.0
 */
export interface Lazy {
  readonly _tag: "Lazy";
}

// Future variants (uncomment when implementing):
// export interface Server { readonly _tag: "Server"; readonly endpoint?: string }
// export interface Island { readonly _tag: "Island"; readonly hydrate: "load" | "visible" | "idle" }
// export interface Static { readonly _tag: "Static"; readonly revalidateSeconds?: number }

/**
 * Union of all render strategies.
 * Extend this union when adding new strategies.
 * @since 1.0.0
 */
export type RenderStrategyType = Eager | Lazy;

// =============================================================================
// Error (standalone — not coupled to strategy)
// =============================================================================

/**
 * Error when a render strategy load fails.
 * @since 1.0.0
 */
export class RenderLoadError extends Data.TaggedError("RenderLoadError")<{
  readonly cause: unknown;
}> {}

// =============================================================================
// Context.Tag + Layer Factories
// =============================================================================

/** @internal */
const eager: Eager = { _tag: "Eager" };

/** @internal */
const lazy: Lazy = { _tag: "Lazy" };

/**
 * RenderStrategy Context.Tag — controls how route components are loaded/rendered.
 *
 * Consumed by:
 * - **Build time (Vite plugin)**: reads `_tag` via string matching to decide transform
 *   - `Eager` → skip dynamic import rewrite
 *   - `Lazy` → rewrite `.component(X)` to `.component(() => import("./X"))`
 *
 * - **Runtime (Outlet)**: dispatches structurally on ComponentInput shape
 *   - Eager/Lazy → loader function vs direct reference (no Context read needed)
 *   - Future: Server/Island → outlet reads strategy from Context for dispatch
 *
 * @since 1.0.0
 */
export class RenderStrategy extends Context.Tag("trygg/RenderStrategy")<
  RenderStrategy,
  RenderStrategyType
>() {
  /**
   * Eager rendering — component in main bundle.
   * Singleton Layer (no config).
   */
  static readonly Eager: Layer.Layer<RenderStrategy> = Layer.succeed(RenderStrategy, eager);

  /**
   * Lazy rendering — dynamic import at render time. Default.
   * Singleton Layer (no config).
   */
  static readonly Lazy: Layer.Layer<RenderStrategy> = Layer.succeed(RenderStrategy, lazy);
}
