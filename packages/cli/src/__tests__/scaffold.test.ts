import { Effect } from "effect";
import * as FileSystem from "effect/FileSystem";
import * as path from "node:path";
import { spawn } from "node:child_process";
import { assert, describe, it } from "@effect/vitest";
import { layer as NodeFileSystemLayer } from "@effect/platform-node/NodeFileSystem";
import { scaffoldProject } from "../scaffold.js";
import { generateApiClientTypes } from "../generators/api-client-types.js";

const TEMPLATES_DIR = path.join(import.meta.dirname, "../../templates");
const WORKSPACE_TEMP_DIR = path.resolve(import.meta.dirname, "../../../../apps/examples");

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

interface CommandResult {
  readonly exitCode: number | null;
  readonly stdout: string;
  readonly stderr: string;
}

const runCommand = (
  cwd: string,
  command: string,
  args: ReadonlyArray<string>,
): Effect.Effect<CommandResult, Error> =>
  Effect.promise(
    () =>
      new Promise((resolve, reject) => {
        const proc = spawn(command, args, { cwd, shell: false });
        let stdout = "";
        let stderr = "";

        if (proc.stdout) {
          proc.stdout.on("data", (data: Buffer) => {
            stdout += data.toString();
          });
        }

        if (proc.stderr) {
          proc.stderr.on("data", (data: Buffer) => {
            stderr += data.toString();
          });
        }

        proc.on("close", (exitCode) => {
          resolve({ exitCode, stdout, stderr });
        });

        proc.on("error", (error) => {
          reject(error);
        });
      }),
  );

const checkNoTryggApiImports = (dir: string): Effect.Effect<void, unknown, FileSystem.FileSystem> =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const entries = yield* fs.readDirectory(dir);
    for (const entry of entries) {
      const entryPath = path.join(dir, entry);
      const stat = yield* fs.stat(entryPath);
      if (stat.type === "Directory") {
        yield* checkNoTryggApiImports(entryPath);
      } else if (entry.endsWith(".ts") || entry.endsWith(".tsx")) {
        const content = yield* fs.readFileString(entryPath);
        assert.notInclude(content, "trygg/api", `${entryPath} should not import from trygg/api`);
      }
    }
  });

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

  it.effect("should NOT generate API boilerplate for blank template", () =>
    Effect.gen(function* () {
      // Scope: verifies blank scaffold stays safe as a no-API app.
      // Assertion: no app/api.ts, no .trygg/api.d.ts, no trygg-api.d.ts, and no trygg/api imports.
      const fs = yield* FileSystem.FileSystem;
      const targetDir = yield* fs.makeTempDirectory({
        directory: WORKSPACE_TEMP_DIR,
        prefix: "trygg-scaffold-test-",
      });
      yield* Effect.addFinalizer(() =>
        fs.remove(targetDir, { recursive: true }).pipe(Effect.ignore),
      );

      yield* runScaffold(targetDir, "blank");

      const apiFilePath = path.join(targetDir, "app", "api.ts");
      const apiFileExists = yield* fs.exists(apiFilePath);
      assert.isFalse(apiFileExists, "app/api.ts should not exist for blank template");

      const tryggDirPath = path.join(targetDir, ".trygg");
      const tryggExists = yield* fs.exists(tryggDirPath);
      assert.isFalse(tryggExists, ".trygg directory should not exist for blank template");

      const tryggApiDtsPath = path.join(targetDir, "trygg-api.d.ts");
      const tryggApiDtsExists = yield* fs.exists(tryggApiDtsPath);
      assert.isFalse(tryggApiDtsExists, "trygg-api.d.ts should not exist for blank template");

      yield* checkNoTryggApiImports(path.join(targetDir, "app"));
    }).pipe(Effect.scoped, Effect.provide(NodeFileSystemLayer)),
  );

  it.effect("blank scaffold should typecheck and build successfully", () =>
    Effect.gen(function* () {
      // Scope: verifies a freshly scaffolded blank app works without any API setup.
      // Assertion: bun run typecheck and bun run build both exit 0.
      const fs = yield* FileSystem.FileSystem;
      const targetDir = yield* fs.makeTempDirectory({
        directory: WORKSPACE_TEMP_DIR,
        prefix: "trygg-scaffold-test-",
      });
      yield* Effect.addFinalizer(() =>
        fs.remove(targetDir, { recursive: true }).pipe(Effect.ignore),
      );

      yield* runScaffold(targetDir, "blank");

      const typecheckResult = yield* runCommand(targetDir, "bun", ["run", "typecheck"]);
      assert.strictEqual(
        typecheckResult.exitCode,
        0,
        `typecheck should pass. stdout: ${typecheckResult.stdout}\nstderr: ${typecheckResult.stderr}`,
      );

      const buildResult = yield* runCommand(targetDir, "bun", ["run", "build"]);
      assert.strictEqual(
        buildResult.exitCode,
        0,
        `build should pass. stdout: ${buildResult.stdout}\nstderr: ${buildResult.stderr}`,
      );
    }).pipe(Effect.scoped, Effect.provide(NodeFileSystemLayer)),
  );

  it.effect(
    "blank scaffold with explicit trygg/api import should fail build with clear diagnostic",
    () =>
      Effect.gen(function* () {
        // Scope: verifies the generated-client failure mode is preserved for explicit opt-in.
        // Assertion: importing ApiClientLive from trygg/api causes build to fail with the missing-Api message.
        const fs = yield* FileSystem.FileSystem;
        const targetDir = yield* fs.makeTempDirectory({
          directory: WORKSPACE_TEMP_DIR,
          prefix: "trygg-scaffold-test-",
        });
        yield* Effect.addFinalizer(() =>
          fs.remove(targetDir, { recursive: true }).pipe(Effect.ignore),
        );

        yield* runScaffold(targetDir, "blank");

        const homePath = path.join(targetDir, "app", "pages", "home.tsx");
        const homeContent = yield* fs.readFileString(homePath);
        yield* fs.writeFileString(
          homePath,
          `import { ApiClientLive } from "trygg/api";\n${homeContent}`,
        );

        const buildResult = yield* runCommand(targetDir, "bun", ["run", "build"]);
        assert.notStrictEqual(
          buildResult.exitCode,
          0,
          "build should fail when trygg/api is imported without app/api.ts",
        );
        const output = `${buildResult.stdout}\n${buildResult.stderr}`;
        assert.include(output, "app/api.ts must export Api");
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
