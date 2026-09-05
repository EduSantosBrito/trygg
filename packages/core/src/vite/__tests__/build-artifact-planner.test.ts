import { assert, describe, it } from "@effect/vitest";
import { Cause, Effect, Exit } from "effect";
import {
  BuildArtifactPlanner,
  diagnosticCodes,
  InvalidBuildOutputCombination,
  type BuildArtifactPlanInput,
} from "../build-artifact-planner.js";

const planner = BuildArtifactPlanner.make({ failOnWarnings: false });

const input = (overrides: Partial<BuildArtifactPlanInput>): BuildArtifactPlanInput => ({
  output: "server",
  platform: "node",
  hasApi: false,
  appDir: "app",
  generatedDir: ".trygg",
  ...overrides,
});

describe("BuildArtifactPlanner", () => {
  it.effect("allows server output for supported platforms", () =>
    Effect.gen(function* () {
      const plan = yield* planner.validateOutput(input({ output: "server" }));

      assert.isTrue(plan.mayProceed);
      assert.deepStrictEqual(plan.diagnostics, []);
    }),
  );

  it.effect("allows deploy-target-neutral static output", () =>
    Effect.gen(function* () {
      const plan = yield* planner.validateOutput(input({ output: "static", platform: "node" }));

      assert.isTrue(plan.mayProceed);
      assert.deepStrictEqual(plan.diagnostics, []);
    }),
  );

  it.effect("allows Cloudflare static SPA output without API", () =>
    Effect.gen(function* () {
      const plan = yield* planner.validateOutput(
        input({ output: "static", platform: "cloudflare" }),
      );

      assert.isTrue(plan.mayProceed);
      assert.deepStrictEqual(plan.diagnostics, []);
    }),
  );

  it.effect("rejects Cloudflare server output", () =>
    Effect.gen(function* () {
      const exit = yield* Effect.exit(
        planner.validateOutput(input({ output: "server", platform: "cloudflare" })),
      );

      assert.isTrue(Exit.isFailure(exit));
      if (Exit.isFailure(exit)) {
        const error = Cause.squash(exit.cause);
        if (!(error instanceof InvalidBuildOutputCombination)) {
          return assert.fail(
            `Expected InvalidBuildOutputCombination but got ${Cause.pretty(exit.cause)}`,
          );
        }
        assert.strictEqual(error.diagnostic.code, diagnosticCodes.cloudflareServerUnsupported);
      }
    }),
  );

  it.effect("warns for static API on non-Cloudflare platforms", () =>
    Effect.gen(function* () {
      const plan = yield* planner.validateOutput(
        input({ output: "static", platform: "bun", hasApi: true }),
      );

      assert.isTrue(plan.mayProceed);
      assert.strictEqual(plan.diagnostics.length, 1);
      const diagnostic = plan.diagnostics[0];
      if (diagnostic === undefined) {
        return assert.fail("Expected one diagnostic");
      }
      assert.strictEqual(diagnostic._tag, "Warning");
      assert.strictEqual(diagnostic.code, diagnosticCodes.staticApiWarning);
    }),
  );

  it.effect("errors for Cloudflare static API", () =>
    Effect.gen(function* () {
      const exit = yield* Effect.exit(
        planner.validateOutput(input({ output: "static", platform: "cloudflare", hasApi: true })),
      );

      assert.isTrue(Exit.isFailure(exit));
      if (Exit.isFailure(exit)) {
        const error = Cause.squash(exit.cause);
        if (!(error instanceof InvalidBuildOutputCombination)) {
          return assert.fail(
            `Expected InvalidBuildOutputCombination but got ${Cause.pretty(exit.cause)}`,
          );
        }
        assert.strictEqual(error.diagnostic.code, diagnosticCodes.cloudflareStaticApiUnsupported);
      }
    }),
  );
});
