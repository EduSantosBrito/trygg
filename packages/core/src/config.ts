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

import { Result, Schema } from "effect";

const PlatformSchema = Schema.Literals(["bun", "cloudflare", "node"]);

/**
 * Supported production runtime platforms.
 *
 * @remarks
 * `Platform` selects which server runtime trygg targets when it generates API
 * handlers and production server entrypoints.
 *
 * @example
 * ```ts
 * import type { Platform } from "trygg/config"
 *
 * const platform: Platform = "node"
 * ```
 *
 * @category Configuration
 * @public
 * @since 1.0.0
 */
export type Platform = typeof PlatformSchema.Type;

const OutputSchema = Schema.Literals(["server", "static"]);

/**
 * Supported build output modes.
 *
 * @remarks
 * `Output` controls whether builds produce a server bundle or a fully static
 * client output.
 *
 * @example
 * ```ts
 * import type { Output } from "trygg/config"
 *
 * const output: Output = "server"
 * ```
 *
 * @category Configuration
 * @public
 * @since 1.0.0
 */
export type Output = typeof OutputSchema.Type;

const TryggConfigSchema = Schema.Struct({
  platform: PlatformSchema,
  output: OutputSchema,
});

/**
 * Shape of a trygg app configuration file.
 *
 * @remarks
 * `TryggConfig` is the shared contract consumed by `defineConfig` and the Vite
 * plugin so app setup stays consistent across tooling.
 *
 * @example
 * ```ts
 * import type { TryggConfig } from "trygg/config"
 *
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
export type TryggConfig = typeof TryggConfigSchema.Type;

class TryggConfigError extends Schema.TaggedError<TryggConfigError>()("TryggConfigError", {
  cause: Schema.Unknown,
}) {
  override get message(): string {
    return "Invalid trygg configuration: expected a supported platform and output.";
  }
}

const decodeTryggConfig = Schema.decodeUnknownResult(TryggConfigSchema);

/**
 * Define a trygg configuration with full type safety.
 *
 * @remarks
 * `defineConfig` decodes the object with trygg's canonical configuration Schema,
 * so JavaScript callers and values widened past TypeScript fail at the same
 * boundary as typed configuration.
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
export const defineConfig = (config: TryggConfig): TryggConfig =>
  // Vite configuration executes synchronously before a runtime exists. Preserve
  // that boundary while giving JavaScript callers an owned error and decode cause.
  Result.getOrThrowWith(decodeTryggConfig(config), (cause) => new TryggConfigError({ cause }));
