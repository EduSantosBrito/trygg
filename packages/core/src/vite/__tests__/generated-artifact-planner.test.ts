import { describe, expect, it } from "vitest";
import { Effect } from "effect";
import {
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

const plan = (overrides: Partial<BuildArtifactPlanInput>) =>
  Effect.gen(function* () {
    const validation = yield* validationPlanner.validateOutput(input(overrides));
    return yield* artifactPlanner.planArtifacts(validation);
  });

describe("GeneratedArtifactPlanner", () => {
  it("plans static generated shell without Worker artifact for non-Cloudflare targets", async () => {
    const artifactPlan = await Effect.runPromise(plan({ output: "static", platform: "node" }));

    expect(artifactPlan.operations).toEqual([
      expect.objectContaining({ _tag: "WriteFile", path: ".trygg/index.html" }),
      { _tag: "RemoveFile", path: ".trygg/worker-entry.js" },
    ]);
  });

  it("plans Cloudflare static SPA Worker artifact", async () => {
    const artifactPlan = await Effect.runPromise(
      plan({ output: "static", platform: "cloudflare" }),
    );

    expect(artifactPlan.operations).toEqual([
      expect.objectContaining({ _tag: "WriteFile", path: ".trygg/index.html" }),
      expect.objectContaining({ _tag: "WriteFile", path: ".trygg/worker-entry.js" }),
    ]);
  });

  it("plans server output with cleanup and nested server build intent", async () => {
    const artifactPlan = await Effect.runPromise(plan({ output: "server", platform: "bun" }));

    expect(artifactPlan.operations).toEqual([
      expect.objectContaining({ _tag: "WriteFile", path: ".trygg/index.html" }),
      { _tag: "RemoveFile", path: ".trygg/worker-entry.js" },
      { _tag: "RunNestedBuild", name: "production-server", configFile: ".trygg/server-entry.ts" },
    ]);
  });

  it("renders operation summaries", async () => {
    const artifactPlan = await Effect.runPromise(plan({ output: "server", platform: "node" }));
    const summary = await Effect.runPromise(artifactPlanner.renderOperationSummary(artifactPlan));

    expect(summary).toEqual([
      "write .trygg/index.html",
      "remove .trygg/worker-entry.js",
      "run production-server from .trygg/server-entry.ts",
    ]);
  });
});
