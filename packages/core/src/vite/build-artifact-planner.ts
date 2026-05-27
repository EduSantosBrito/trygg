/**
 * Pure build output validation planning for the trygg Vite plugin.
 *
 * @remarks
 * BuildArtifactPlanner decides output/platform/API diagnostics as data before
 * Vite hooks perform file I/O, nested builds, or artifact generation.
 *
 * @since 1.0.0
 * @module trygg/vite/build-artifact-planner
 */
import { Data, Effect, Layer, Schema } from "effect";
import * as Context from "effect/Context";
import type { Output, Platform } from "../config.js";

export type BuildOutputMode = Output;
export type BuildPlatform = Platform;

export interface BuildArtifactPlanInput {
  readonly output: BuildOutputMode;
  readonly platform: BuildPlatform;
  readonly hasApi: boolean;
  readonly appDir: string;
  readonly generatedDir: string;
}

export type BuildPlanDiagnostic =
  | { readonly _tag: "Warning"; readonly code: string; readonly message: string }
  | { readonly _tag: "Error"; readonly code: string; readonly message: string };

export interface BuildOutputValidationPlan {
  readonly input: BuildArtifactPlanInput;
  readonly diagnostics: ReadonlyArray<BuildPlanDiagnostic>;
  readonly mayProceed: boolean;
}

export class InvalidBuildOutputCombination extends Data.TaggedError(
  "InvalidBuildOutputCombination",
)<{
  readonly input: BuildArtifactPlanInput;
  readonly diagnostic: BuildPlanDiagnostic;
}> {}

export const BuildArtifactPlannerConfigInput = Schema.Struct({
  failOnWarnings: Schema.Boolean,
});

type BuildArtifactPlannerConfig = typeof BuildArtifactPlannerConfigInput.Type;

export interface BuildArtifactPlannerShape {
  readonly validateOutput: (
    input: BuildArtifactPlanInput,
  ) => Effect.Effect<BuildOutputValidationPlan, InvalidBuildOutputCombination>;
}

export const diagnosticCodes = {
  cloudflareServerUnsupported: "TRYGG_BUILD_CLOUDFLARE_SERVER_UNSUPPORTED",
  staticApiWarning: "TRYGG_BUILD_STATIC_API_WARNING",
  cloudflareStaticApiUnsupported: "TRYGG_BUILD_CLOUDFLARE_STATIC_API_UNSUPPORTED",
} as const;

export const makeBuildArtifactPlanner = (
  configInput: BuildArtifactPlannerConfig,
): BuildArtifactPlannerShape => {
  const config = BuildArtifactPlannerConfigInput.make(configInput);

  return {
    validateOutput: Effect.fn("BuildArtifactPlanner.validateOutput")(function* (input) {
      const diagnostics: Array<BuildPlanDiagnostic> = [];

      if (input.output === "server" && input.platform === "cloudflare") {
        diagnostics.push({
          _tag: "Error",
          code: diagnosticCodes.cloudflareServerUnsupported,
          message:
            'Cloudflare server output is not supported yet. Use platform: "node" or platform: "bun" for output: "server".',
        });
      }

      if (input.hasApi && input.output === "static" && input.platform === "cloudflare") {
        diagnostics.push({
          _tag: "Error",
          code: diagnosticCodes.cloudflareStaticApiUnsupported,
          message:
            'app/api.ts is not supported with platform: "cloudflare" and output: "static". Use output: "server" for API routes.',
        });
      } else if (input.hasApi && input.output === "static") {
        diagnostics.push({
          _tag: "Warning",
          code: diagnosticCodes.staticApiWarning,
          message:
            '⚠ API routes in app/api.ts will not be included in static build.\n  Deploy your API separately or use output: "server".',
        });
      }

      const blocking = diagnostics.find(
        (diagnostic) => diagnostic._tag === "Error" || config.failOnWarnings,
      );
      if (blocking !== undefined) {
        return yield* new InvalidBuildOutputCombination({ input, diagnostic: blocking });
      }

      return { input, diagnostics, mayProceed: true };
    }),
  };
};

export class BuildArtifactPlanner extends Context.Service<
  BuildArtifactPlanner,
  BuildArtifactPlannerShape
>()("trygg/BuildArtifactPlanner") {
  static readonly layer = (
    configInput: BuildArtifactPlannerConfig,
  ): Layer.Layer<BuildArtifactPlanner> =>
    Layer.succeed(BuildArtifactPlanner, makeBuildArtifactPlanner(configInput));
}
