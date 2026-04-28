import { Effect } from "effect";
import * as FileSystem from "effect/FileSystem";
import * as path from "node:path";
import { assert, describe, it } from "@effect/vitest";
import { layer as NodeFileSystemLayer } from "@effect/platform-node/NodeFileSystem";
import { scaffoldProject } from "../scaffold.js";
import { generateApiClientTypes } from "../generators/api-client-types.js";

const TEMPLATES_DIR = path.join(import.meta.dirname, "../../templates");

const runScaffold = (
  targetDir: string,
  template: "blank" | "incident",
): Effect.Effect<void, unknown, FileSystem.FileSystem> =>
  scaffoldProject(
    targetDir,
    {
      name: "test-app",
      template,
      platform: "bun",
      output: "server",
      vcs: "none",
      install: false,
    },
    TEMPLATES_DIR,
  );

describe("scaffoldProject", () => {
  it.effect("should generate .trygg/api.d.ts for incident template", () =>
    Effect.gen(function* () {
      // Scope: verifies incident scaffold produces visible trygg/api declarations.
      // Assertion: .trygg/api.d.ts exists with correct ambient module augmentation.
      const fs = yield* FileSystem.FileSystem;
      const targetDir = yield* fs.makeTempDirectory({ prefix: "trygg-scaffold-test-" });
      yield* Effect.addFinalizer(() =>
        fs.remove(targetDir, { recursive: true }).pipe(Effect.ignore),
      );

      yield* runScaffold(targetDir, "incident");

      const apiDtsPath = path.join(targetDir, ".trygg", "api.d.ts");
      const apiDtsExists = yield* fs.exists(apiDtsPath);
      assert.isTrue(apiDtsExists, ".trygg/api.d.ts should exist for incident template");

      const content = yield* fs.readFileString(apiDtsPath);
      assert.include(content, 'declare module "trygg/api"');
      assert.include(content, 'import type { Api } from "../app/api"');
      assert.include(content, "type ApiClientService = HttpApiClient.ForApi<typeof Api>");
      assert.include(content, "export interface ApiClient {}");
      assert.include(
        content,
        'export const ApiClient: Context.ServiceClass<ApiClient, "ApiClient",',
      );
      assert.include(content, "export const ApiClientLive: Layer.Layer<ApiClient>");
      assert.include(content, "export {}");
    }).pipe(Effect.scoped, Effect.provide(NodeFileSystemLayer)),
  );

  it.effect("should include .trygg/**/*.d.ts in generated tsconfig.json", () =>
    Effect.gen(function* () {
      // Scope: verifies generated tsconfig.json makes trygg/api declarations visible to tsc.
      // Assertion: include array contains .trygg/**/*.d.ts.
      const fs = yield* FileSystem.FileSystem;
      const targetDir = yield* fs.makeTempDirectory({ prefix: "trygg-scaffold-test-" });
      yield* Effect.addFinalizer(() =>
        fs.remove(targetDir, { recursive: true }).pipe(Effect.ignore),
      );

      yield* runScaffold(targetDir, "incident");

      const tsconfigPath = path.join(targetDir, "tsconfig.json");
      const tsconfigContent = yield* fs.readFileString(tsconfigPath);
      const tsconfig = JSON.parse(tsconfigContent);
      assert.deepEqual(tsconfig.include, ["app/**/*.ts", "app/**/*.tsx", ".trygg/**/*.d.ts"]);
    }).pipe(Effect.scoped, Effect.provide(NodeFileSystemLayer)),
  );

  it.effect("should NOT generate .trygg/api.d.ts for blank template", () =>
    Effect.gen(function* () {
      // Scope: verifies blank scaffold is not affected by API client generation.
      // Assertion: .trygg directory is absent when template has no app/api.ts.
      const fs = yield* FileSystem.FileSystem;
      const targetDir = yield* fs.makeTempDirectory({ prefix: "trygg-scaffold-test-" });
      yield* Effect.addFinalizer(() =>
        fs.remove(targetDir, { recursive: true }).pipe(Effect.ignore),
      );

      yield* runScaffold(targetDir, "blank");

      const tryggDirPath = path.join(targetDir, ".trygg");
      const tryggExists = yield* fs.exists(tryggDirPath);
      assert.isFalse(tryggExists, ".trygg directory should not exist for blank template");
    }).pipe(Effect.scoped, Effect.provide(NodeFileSystemLayer)),
  );

  it.effect(
    "generateApiClientTypes should match Vite plugin renderApiClientDeclarations shape",
    () =>
      Effect.gen(function* () {
        // Scope: ensures CLI-generated declarations stay compatible with Vite-generated ones.
        // Assertion: output contains the same key shapes as the core plugin renderer.
        const output = yield* generateApiClientTypes({ apiTypeImportPath: "../app/api" });
        assert.include(output, 'declare module "trygg/api"');
        assert.include(output, 'import type { Api } from "../app/api"');
        assert.include(output, "type ApiClientService = HttpApiClient.ForApi<typeof Api>");
        assert.include(output, "export interface ApiClient {}");
        assert.include(
          output,
          'export const ApiClient: Context.ServiceClass<ApiClient, "ApiClient",',
        );
        assert.include(output, "export const ApiClientLive: Layer.Layer<ApiClient>");
        assert.include(output, "export {}");
      }),
  );
});
