/**
 * Render strategy primitives for `trygg/router`.
 *
 * @remarks
 * Owner module for route render strategies. This module owns the strategy union,
 * the load error type, and the service tag whose layers configure eager versus
 * lazy route loading.
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
 * @since 1.0.0
 * @module trygg/router/render-strategy
 */
import { Data, Layer, Schema } from "effect";
import * as Context from "effect/Context";

// =============================================================================
// Strategy Variants (discriminated union)
// =============================================================================

/**
 * Eager — component stays in main bundle. No code splitting.
 * Vite plugin skips the dynamic import transform for Eager routes.
 *
 * @remarks
 * Use `Eager` when a route should stay in the current bundle rather than load
 * through a lazy module boundary.
 *
 * @example
 * ```ts
 * type Strategy = Eager
 * ```
 *
 * @category Render Strategies
 * @public
 * @since 1.0.0
 */
export type Eager = Extract<RenderStrategyType, { readonly _tag: "Eager" }>;

/**
 * Lazy — component is code-split via dynamic import. Default strategy.
 * Vite plugin transforms `.component(X)` → `.component(() => import("./X"))`.
 *
 * @remarks
 * `Lazy` is the default route-loading mode and lets the Vite transform turn
 * direct component references into loader functions.
 *
 * @example
 * ```ts
 * type Strategy = Lazy
 * ```
 *
 * @category Render Strategies
 * @public
 * @since 1.0.0
 */
export type Lazy = Extract<RenderStrategyType, { readonly _tag: "Lazy" }>;

// Future variants (uncomment when implementing):
// export interface Server { readonly _tag: "Server"; readonly endpoint?: string }
// export interface Island { readonly _tag: "Island"; readonly hydrate: "load" | "visible" | "idle" }
// export interface Static { readonly _tag: "Static"; readonly revalidateSeconds?: number }

/**
 * Union of all render strategies.
 * Extend this union when adding new strategies.
 *
 * @remarks
 * `RenderStrategyType` is the pure-data union read by the router when a route's
 * render strategy layer has been resolved.
 *
 * @example
 * ```ts
 * const strategy: RenderStrategyType = { _tag: "Lazy" }
 * ```
 *
 * @category Render Strategies
 * @public
 * @since 1.0.0
 */
export type RenderStrategyType = Data.TaggedEnum<{
  readonly Eager: {};
  readonly Lazy: {};
}>;

export const RenderStrategyType = Data.taggedEnum<RenderStrategyType>();

// =============================================================================
// Error (standalone — not coupled to strategy)
// =============================================================================

/**
 * Error when a render strategy load fails.
 *
 * @remarks
 * `RenderLoadError` wraps failures that happen while resolving a lazy route
 * component.
 *
 * @example
 * ```ts
 * const error = new RenderLoadError({ cause: "network" })
 * ```
 *
 * @category Render Strategies
 * @public
 * @since 1.0.0
 */
export class RenderLoadError extends Schema.TaggedErrorClass<RenderLoadError>()("RenderLoadError", {
  cause: Schema.Unknown,
}) {}

// =============================================================================
// Service Keys + Layer Factories
// =============================================================================

/** @internal */
const eager: Eager = RenderStrategyType.Eager();

/** @internal */
const lazy: Lazy = RenderStrategyType.Lazy();

/**
 * RenderStrategy service key — controls how route components are loaded/rendered.
 *
 * Consumed by:
 * - **Build time (Vite plugin)**: reads `_tag` via string matching to decide transform
 *   - `Eager` → skip dynamic import rewrite
 *   - `Lazy` → rewrite `.component(X)` to `.component(() => import("./X"))`
 *
 * - **Runtime (Outlet)**: dispatches structurally on ComponentInput shape
 *   - Eager/Lazy → loader function vs direct reference (no Context read needed)
 *   - Future: Server/Island → outlet reads strategy from services for dispatch
 *
 * @remarks
 * Apply `RenderStrategy` with `Route.provide(...)` when a specific route should
 * opt into eager loading or preserve the default lazy behavior explicitly.
 *
 * @example
 * ```tsx
 * Route.make("/").component(HomePage).pipe(Route.provide(RenderStrategy.Eager))
 * ```
 *
 * @category Render Strategies
 * @public
 * @since 1.0.0
 */
export class RenderStrategy extends Context.Service<
  RenderStrategy,
  { readonly _tag: "Eager" } | { readonly _tag: "Lazy" }
>()("trygg/RenderStrategy") {
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
