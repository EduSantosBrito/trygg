/**
 * Platform configuration service
 * Defines the interface for platform-specific configuration (Node.js vs Bun)
 * @since 1.0.0
 */
import * as Layer from "effect/Layer";
import * as Context from "effect/Context";

/**
 * Platform-specific configuration for scaffolding
 * @since 1.0.0
 */
export interface PlatformConfigService {
  readonly name: "node" | "bun";
  readonly devScript: string;
  readonly buildScript: string;
  readonly previewScript: string;
  readonly devDependencies: Readonly<Record<string, string>>;
  readonly runtimeDependencyName: string;
  readonly runtimeVersion: string;
}

/**
 * Context tag for PlatformConfig service
 * @since 1.0.0
 */
export class PlatformConfig extends Context.Service<
  PlatformConfig,
  {
    readonly name: "node" | "bun";
    readonly devScript: string;
    readonly buildScript: string;
    readonly previewScript: string;
    readonly devDependencies: Readonly<Record<string, string>>;
    readonly runtimeDependencyName: string;
    readonly runtimeVersion: string;
  }
>()("trygg/PlatformConfig") {}

/**
 * Layer constructor for PlatformConfig
 * @since 1.0.0
 */
export const layer = (config: PlatformConfigService): Layer.Layer<PlatformConfig> =>
  Layer.succeed(PlatformConfig, config);
