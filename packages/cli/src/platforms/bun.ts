/**
 * Bun platform configuration layer
 * @since 1.0.0
 */
import { PlatformConfig, layer } from "../platform-config.js";

const BUN_VERSION = "^0.87.0";

const config: PlatformConfig = {
  name: "bun",
  devScript: "bunx --bun vite",
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
