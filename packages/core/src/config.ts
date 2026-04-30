/**
 * Type-safe configuration for the `trygg/config` entrypoint.
 *
 * @remarks
 * Owner module for app-level configuration passed into `trygg/vite-plugin`.
 * Use these exports in `trygg.config.ts` when choosing the production runtime
 * and build output mode.
 *
 * @see ./config.docs.md - Source-owned topic guide
 * @since 1.0.0
 * @module trygg/config
 */

/**
 * Supported production runtime platforms.
 *
 * @remarks
 * `Platform` selects which server runtime trygg targets when it generates API
 * handlers and production server entrypoints.
 *
 * @example
 * ```ts
 * const platform: Platform = "node"
 * ```
 *
 * @category Configuration
 * @public
 * @since 1.0.0
 */
export type Platform = "bun" | "cloudflare" | "node";

/**
 * Supported build output modes.
 *
 * @remarks
 * `Output` controls whether builds produce a server bundle or a fully static
 * client output.
 *
 * @example
 * ```ts
 * const output: Output = "server"
 * ```
 *
 * @category Configuration
 * @public
 * @since 1.0.0
 */
export type Output = "server" | "static";

/**
 * Shape of a trygg app configuration file.
 *
 * @remarks
 * `TryggConfig` is the shared contract consumed by `defineConfig` and the Vite
 * plugin so app setup stays consistent across tooling.
 *
 * @example
 * ```ts
 * const config: TryggConfig = {
 *   platform: "bun",
 *   output: "server",
 * }
 * ```
 *
 * @category Configuration
 * @public
 * @since 1.0.0
 */
export interface TryggConfig {
  /** Runtime platform for dev API and production server */
  readonly platform: Platform;
  /** Build output mode */
  readonly output: Output;
}

/**
 * Define a trygg configuration with full type safety.
 *
 * @remarks
 * `defineConfig` keeps `trygg.config.ts` narrow and typed without introducing a
 * runtime wrapper beyond returning the provided object.
 *
 * @example
 * ```ts
 * import { defineConfig } from "trygg/config"
 *
 * export default defineConfig({
 *   platform: "bun",
 *   output: "server",
 * })
 * ```
 *
 * @category Configuration
 * @public
 * @since 1.0.0
 */
export const defineConfig = (config: TryggConfig): TryggConfig => config;
