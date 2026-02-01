/**
 * Platform configuration service
 * Defines the interface for platform-specific configuration (Node.js vs Bun)
 * @since 1.0.0
 */
import { Context, Layer } from "effect";

/**
 * Platform-specific configuration for scaffolding
 * @since 1.0.0
 */
export interface PlatformConfig {
  readonly name: "node" | "bun";
  readonly devScript: string;
  readonly devDependencies: Readonly<Record<string, string>>;
  readonly runtimeDependencyName: string;
  readonly runtimeVersion: string;
}

/**
 * Context tag for PlatformConfig service
 * @since 1.0.0
 */
export const PlatformConfig = Context.GenericTag<PlatformConfig>("trygg/PlatformConfig");

/**
 * Helper to create platform config
 * @since 1.0.0
 */
export const make = (config: PlatformConfig): PlatformConfig => config;

/**
 * Layer constructor for PlatformConfig
 * @since 1.0.0
 */
export const layer = (config: PlatformConfig): Layer.Layer<PlatformConfig> =>
  Layer.succeed(PlatformConfig, config);
