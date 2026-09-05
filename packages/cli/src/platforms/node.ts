/**
 * Node.js platform configuration layer
 * @since 1.0.0
 */
import * as PlatformConfig from "../platform-config.js";

const NODE_VERSION = "4.0.0-rc.112";

const config: PlatformConfig.PlatformConfigService = {
  name: "node",
  devScript: "vite",
  buildScript: "vite build",
  previewScript: "vite preview",
  devDependencies: {
    "@effect/platform-node": NODE_VERSION,
  },
  runtimeDependencyName: "@effect/platform-node",
  runtimeVersion: NODE_VERSION,
};

/**
 * Layer providing Node.js platform configuration
 * @since 1.0.0
 */
export const layer = PlatformConfig.layer(config);
