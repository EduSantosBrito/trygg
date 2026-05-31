/**
 * Node.js platform configuration layer
 * @since 1.0.0
 */
import { layer, type PlatformConfigService } from "../platform-config.js";

const NODE_VERSION = "^4.0.0-beta.58";

const config: PlatformConfigService = {
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
