/**
 * @since 1.0.0
 * Type-safe configuration for trygg
 *
 * Provides `defineConfig` for creating fully typed configurations
 * that drive platform selection and build output.
 */

/**
 * Supported runtime platforms
 * @since 1.0.0
 */
export type Platform = "bun" | "node";

/**
 * Build output modes
 * @since 1.0.0
 */
export type Output = "server" | "static";

/**
 * Trygg configuration interface
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
 * @since 1.0.0
 */
export const defineConfig = (config: TryggConfig): TryggConfig => config;
