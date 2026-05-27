import { describe, expect, it } from "vitest";
import { Cause, Effect, Exit } from "effect";
import {
  diagnosticCodes,
  makeBuildArtifactPlanner,
  type BuildArtifactPlanInput,
} from "../build-artifact-planner.js";

const planner = makeBuildArtifactPlanner({ failOnWarnings: false });

const input = (overrides: Partial<BuildArtifactPlanInput>): BuildArtifactPlanInput => ({
  output: "server",
  platform: "node",
  hasApi: false,
  appDir: "app",
  generatedDir: ".trygg",
  ...overrides,
});

describe("BuildArtifactPlanner", () => {
  it("allows server output for supported platforms", async () => {
    const plan = await Effect.runPromise(planner.validateOutput(input({ output: "server" })));

    expect(plan.mayProceed).toBe(true);
    expect(plan.diagnostics).toEqual([]);
  });

  it("allows deploy-target-neutral static output", async () => {
    const plan = await Effect.runPromise(
      planner.validateOutput(input({ output: "static", platform: "node" })),
    );

    expect(plan.mayProceed).toBe(true);
    expect(plan.diagnostics).toEqual([]);
  });

  it("allows Cloudflare static SPA output without API", async () => {
    const plan = await Effect.runPromise(
      planner.validateOutput(input({ output: "static", platform: "cloudflare" })),
    );

    expect(plan.mayProceed).toBe(true);
    expect(plan.diagnostics).toEqual([]);
  });

  it("rejects Cloudflare server output", async () => {
    const exit = await Effect.runPromiseExit(
      planner.validateOutput(input({ output: "server", platform: "cloudflare" })),
    );

    expect(Exit.isFailure(exit)).toBe(true);
    if (Exit.isFailure(exit)) {
      expect(Cause.squash(exit.cause)).toMatchObject({
        diagnostic: expect.objectContaining({ code: diagnosticCodes.cloudflareServerUnsupported }),
      });
    }
  });

  it("warns for static API on non-Cloudflare platforms", async () => {
    const plan = await Effect.runPromise(
      planner.validateOutput(input({ output: "static", platform: "bun", hasApi: true })),
    );

    expect(plan.mayProceed).toBe(true);
    expect(plan.diagnostics).toEqual([
      expect.objectContaining({
        _tag: "Warning",
        code: diagnosticCodes.staticApiWarning,
      }),
    ]);
  });

  it("errors for Cloudflare static API", async () => {
    const exit = await Effect.runPromiseExit(
      planner.validateOutput(input({ output: "static", platform: "cloudflare", hasApi: true })),
    );

    expect(Exit.isFailure(exit)).toBe(true);
    if (Exit.isFailure(exit)) {
      expect(Cause.squash(exit.cause)).toMatchObject({
        diagnostic: expect.objectContaining({ code: diagnosticCodes.cloudflareStaticApiUnsupported }),
      });
    }
  });
});
