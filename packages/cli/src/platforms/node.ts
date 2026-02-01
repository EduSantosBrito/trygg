/**
 * Node.js platform configuration layer
 * @since 1.0.0
 */
import { PlatformConfig, layer } from "../platform-config.js";

const NODE_VERSION = "^0.87.0";

const config: PlatformConfig = {
  name: "node",
  devScript: "vite",
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
export const NodePlatformConfig = layer(config);
