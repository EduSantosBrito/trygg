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
import { Data, Effect, Layer, Match, Schema } from "effect";
import * as Context from "effect/Context";
import type { Output, Platform } from "../config.js";

const generatedPath = (generatedDir: string, fileName: string): string =>
  `${generatedDir.replace(/\/$/, "")}/${fileName}`;

const generateHtmlTemplate = (): string => `<!DOCTYPE html>
<html>
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <link rel="icon" href="/favicon.svg" type="image/svg+xml" />
    <script type="module" src="/.trygg/entry.tsx"></script>
  </head>
  <body></body>
</html>`;

const renderCloudflareStaticWorkerEntryModule = (): string =>
  `export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const pathname = url.pathname;

    if (pathname.includes(".") && !pathname.startsWith("/api/")) {
      return env.ASSETS.fetch(request);
    }

    const assetResponse = await env.ASSETS.fetch(request);
    if (assetResponse.status !== 404) {
      return assetResponse;
    }

    return env.ASSETS.fetch(new Request(new URL("/index.html", request.url), request));
  },
};
`;

export type BuildOutputMode = Output;
export type BuildPlatform = Platform;

export interface BuildArtifactPlanInput {
  readonly output: BuildOutputMode;
  readonly platform: BuildPlatform;
  readonly hasApi: boolean;
  readonly appDir: string;
  readonly generatedDir: string;
}

export type BuildPlanDiagnostic = Data.TaggedEnum<{
  readonly Warning: { readonly code: string; readonly message: string };
  readonly Error: { readonly code: string; readonly message: string };
}>;

export const BuildPlanDiagnostic = Data.taggedEnum<BuildPlanDiagnostic>();

export interface BuildOutputValidationPlan {
  readonly input: BuildArtifactPlanInput;
  readonly diagnostics: ReadonlyArray<BuildPlanDiagnostic>;
  readonly mayProceed: boolean;
}

export class InvalidBuildOutputCombination extends Schema.TaggedErrorClass<InvalidBuildOutputCombination>()(
  "InvalidBuildOutputCombination",
  {
    input: Schema.Struct({
      output: Schema.String,
      platform: Schema.String,
      hasApi: Schema.Boolean,
      appDir: Schema.String,
      generatedDir: Schema.String,
    }),
    diagnostic: Schema.Struct({
      _tag: Schema.Union([Schema.Literal("Warning"), Schema.Literal("Error")]),
      code: Schema.String,
      message: Schema.String,
    }),
  },
) {}

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
};

export const makeBuildArtifactPlanner = (
  configInput: BuildArtifactPlannerConfig,
): BuildArtifactPlannerShape => {
  const config = BuildArtifactPlannerConfigInput.make(configInput);

  return {
    validateOutput: Effect.fn("BuildArtifactPlanner.validateOutput")(function* (input) {
      const diagnostics: Array<BuildPlanDiagnostic> = [];

      if (input.output === "server" && input.platform === "cloudflare") {
        diagnostics.push(
          BuildPlanDiagnostic.Error({
            code: diagnosticCodes.cloudflareServerUnsupported,
            message:
              'Cloudflare server output is not supported yet. Use platform: "node" or platform: "bun" for output: "server".',
          }),
        );
      }

      if (input.hasApi && input.output === "static" && input.platform === "cloudflare") {
        diagnostics.push(
          BuildPlanDiagnostic.Error({
            code: diagnosticCodes.cloudflareStaticApiUnsupported,
            message:
              'app/api.ts is not supported with platform: "cloudflare" and output: "static". Use output: "server" for API routes.',
          }),
        );
      } else if (input.hasApi && input.output === "static") {
        diagnostics.push(
          BuildPlanDiagnostic.Warning({
            code: diagnosticCodes.staticApiWarning,
            message:
              '⚠ API routes in app/api.ts will not be included in static build.\n  Deploy your API separately or use output: "server".',
          }),
        );
      }

      const blocking = diagnostics.find(
        (diagnostic): diagnostic is BuildPlanDiagnostic =>
          BuildPlanDiagnostic.$is("Error")(diagnostic) || config.failOnWarnings,
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
  {
    readonly validateOutput: (
      input: BuildArtifactPlanInput,
    ) => Effect.Effect<BuildOutputValidationPlan, InvalidBuildOutputCombination>;
  }
>()("trygg/BuildArtifactPlanner") {
  static readonly layer = (
    configInput: BuildArtifactPlannerConfig,
  ): Layer.Layer<BuildArtifactPlanner> =>
    Layer.succeed(BuildArtifactPlanner, makeBuildArtifactPlanner(configInput));
}

export type BuildArtifactOperation = Data.TaggedEnum<{
  readonly WriteFile: { readonly path: string; readonly contents: string };
  readonly RemoveFile: { readonly path: string };
  readonly RunNestedBuild: { readonly name: string; readonly configFile: string };
}>;

export const BuildArtifactOperation = Data.taggedEnum<BuildArtifactOperation>();

export interface GeneratedArtifactPlan {
  readonly validation: BuildOutputValidationPlan;
  readonly operations: ReadonlyArray<BuildArtifactOperation>;
  readonly diagnostics: ReadonlyArray<BuildPlanDiagnostic>;
}

export class BuildArtifactPlanningError extends Schema.TaggedErrorClass<BuildArtifactPlanningError>()(
  "BuildArtifactPlanningError",
  {
    operation: Schema.String,
    cause: Schema.Unknown,
  },
) {}

export const GeneratedArtifactPlannerConfigInput = Schema.Struct({
  includeCleanupOperations: Schema.Boolean,
});

type GeneratedArtifactPlannerConfig = typeof GeneratedArtifactPlannerConfigInput.Type;

export interface GeneratedArtifactPlannerShape {
  readonly planArtifacts: (
    validation: BuildOutputValidationPlan,
  ) => Effect.Effect<GeneratedArtifactPlan, BuildArtifactPlanningError>;
  readonly renderOperationSummary: (
    plan: GeneratedArtifactPlan,
  ) => Effect.Effect<ReadonlyArray<string>>;
}

export const makeGeneratedArtifactPlanner = (
  configInput: GeneratedArtifactPlannerConfig,
): GeneratedArtifactPlannerShape => {
  const config = GeneratedArtifactPlannerConfigInput.make(configInput);

  return {
    planArtifacts: Effect.fn("GeneratedArtifactPlanner.planArtifacts")(function* (validation) {
      const { generatedDir, output, platform } = validation.input;
      const workerPath = generatedPath(generatedDir, "worker-entry.js");
      const operations: Array<BuildArtifactOperation> = [
        BuildArtifactOperation.WriteFile({
          path: generatedPath(generatedDir, "index.html"),
          contents: generateHtmlTemplate(),
        }),
      ];

      if (output === "static" && platform === "cloudflare") {
        operations.push(
          BuildArtifactOperation.WriteFile({
            path: workerPath,
            contents: renderCloudflareStaticWorkerEntryModule(),
          }),
        );
      } else if (config.includeCleanupOperations) {
        operations.push(BuildArtifactOperation.RemoveFile({ path: workerPath }));
      }

      if (output === "server") {
        operations.push(
          BuildArtifactOperation.RunNestedBuild({
            name: "production-server",
            configFile: generatedPath(generatedDir, "server-entry.ts"),
          }),
        );
      }

      return { validation, operations, diagnostics: validation.diagnostics };
    }),
    renderOperationSummary: Effect.fn("GeneratedArtifactPlanner.renderOperationSummary")(
      function* (plan) {
        return plan.operations.map((operation) =>
          Match.value(operation).pipe(
            Match.tag("WriteFile", ({ path }) => `write ${path}`),
            Match.tag("RemoveFile", ({ path }) => `remove ${path}`),
            Match.tag("RunNestedBuild", ({ name, configFile }) => `run ${name} from ${configFile}`),
            Match.exhaustive,
          ),
        );
      },
    ),
  };
};

export class GeneratedArtifactPlanner extends Context.Service<
  GeneratedArtifactPlanner,
  {
    readonly planArtifacts: (
      validation: BuildOutputValidationPlan,
    ) => Effect.Effect<GeneratedArtifactPlan, BuildArtifactPlanningError>;
    readonly renderOperationSummary: (
      plan: GeneratedArtifactPlan,
    ) => Effect.Effect<ReadonlyArray<string>>;
  }
>()("trygg/GeneratedArtifactPlanner") {
  static readonly layer = (
    configInput: GeneratedArtifactPlannerConfig,
  ): Layer.Layer<GeneratedArtifactPlanner> =>
    Layer.succeed(GeneratedArtifactPlanner, makeGeneratedArtifactPlanner(configInput));
}
