/**
 * Bun platform configuration layer
 * @since 1.0.0
 */
import { layer, type PlatformConfigService } from "../platform-config.js";

const BUN_VERSION = "4.0.0-beta.58";

const config: PlatformConfigService = {
  name: "bun",
  devScript: "bunx --bun vite",
  buildScript: "bunx --bun vite build",
  previewScript: "bunx --bun vite preview",
  devDependencies: {
    "@effect/platform-bun": BUN_VERSION,
  },
  runtimeDependencyName: "@effect/platform-bun",
  runtimeVersion: BUN_VERSION,
};

/**
 * Layer providing Bun platform configuration
 * @since 1.0.0
 */
export const BunPlatformConfig = layer(config);
