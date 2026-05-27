import { assert, describe, it } from "@effect/vitest";
import { Effect } from "effect";
import {
  BuildArtifactOperation,
  makeBuildArtifactPlanner,
  makeGeneratedArtifactPlanner,
  type BuildArtifactPlanInput,
} from "../build-artifact-planner.js";

const validationPlanner = makeBuildArtifactPlanner({ failOnWarnings: false });
const artifactPlanner = makeGeneratedArtifactPlanner({ includeCleanupOperations: true });

const input = (overrides: Partial<BuildArtifactPlanInput>): BuildArtifactPlanInput => ({
  output: "server",
  platform: "node",
  hasApi: false,
  appDir: "app",
  generatedDir: ".trygg",
  ...overrides,
});

const plan = Effect.fn("GeneratedArtifactPlanner.test.plan")(function* (
  overrides: Partial<BuildArtifactPlanInput>,
) {
  const validation = yield* validationPlanner.validateOutput(input(overrides));
  return yield* artifactPlanner.planArtifacts(validation);
});

const operationDescriptors = (operations: ReadonlyArray<BuildArtifactOperation>) =>
  operations.map((operation) =>
    BuildArtifactOperation.$match(operation, {
      WriteFile: ({ path }) => ({ tag: "WriteFile", path }),
      RemoveFile: ({ path }) => ({ tag: "RemoveFile", path }),
      RunNestedBuild: ({ name, configFile }) => ({ tag: "RunNestedBuild", name, configFile }),
    }),
  );

describe("GeneratedArtifactPlanner", () => {
  it.effect("plans static generated shell without Worker artifact for non-Cloudflare targets", () =>
    Effect.gen(function* () {
      const artifactPlan = yield* plan({ output: "static", platform: "node" });

      assert.deepStrictEqual(operationDescriptors(artifactPlan.operations), [
        { tag: "WriteFile", path: ".trygg/index.html" },
        { tag: "RemoveFile", path: ".trygg/worker-entry.js" },
      ]);
    }),
  );

  it.effect("plans Cloudflare static SPA Worker artifact", () =>
    Effect.gen(function* () {
      const artifactPlan = yield* plan({ output: "static", platform: "cloudflare" });

      assert.deepStrictEqual(operationDescriptors(artifactPlan.operations), [
        { tag: "WriteFile", path: ".trygg/index.html" },
        { tag: "WriteFile", path: ".trygg/worker-entry.js" },
      ]);
    }),
  );

  it.effect("plans server output with cleanup and nested server build intent", () =>
    Effect.gen(function* () {
      const artifactPlan = yield* plan({ output: "server", platform: "bun" });

      assert.deepStrictEqual(operationDescriptors(artifactPlan.operations), [
        { tag: "WriteFile", path: ".trygg/index.html" },
        { tag: "RemoveFile", path: ".trygg/worker-entry.js" },
        { tag: "RunNestedBuild", name: "production-server", configFile: ".trygg/server-entry.ts" },
      ]);
    }),
  );

  it.effect("renders operation summaries", () =>
    Effect.gen(function* () {
      const artifactPlan = yield* plan({ output: "server", platform: "node" });
      const summary = yield* artifactPlanner.renderOperationSummary(artifactPlan);

      assert.deepStrictEqual(summary, [
        "write .trygg/index.html",
        "remove .trygg/worker-entry.js",
        "run production-server from .trygg/server-entry.ts",
      ]);
    }),
  );
});
