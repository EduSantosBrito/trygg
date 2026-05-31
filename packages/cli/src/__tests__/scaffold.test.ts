import { Effect, Schema } from "effect";
import * as FileSystem from "effect/FileSystem";
import * as path from "node:path";
import { spawn } from "node:child_process";
import { assert, describe, it } from "@effect/vitest";
import { layer as NodeFileSystemLayer } from "@effect/platform-node/NodeFileSystem";
import { scaffoldProject } from "../scaffold.js";
import { generateApiClientTypes } from "../generators/api-client-types.js";

const TEMPLATES_DIR = path.join(import.meta.dirname, "../../templates");
const WORKSPACE_ROOT = path.resolve(import.meta.dirname, "../../../..");
const TRYGG_CORE_ABS = path.join(WORKSPACE_ROOT, "packages/core");
const WORKSPACE_TEMP_DIR = path.join(WORKSPACE_ROOT, "apps/examples");

class CommandSpawnError extends Schema.TaggedErrorClass<CommandSpawnError>()("CommandSpawnError", {
  command: Schema.String,
  cause: Schema.Unknown,
}) {}

class ExpectedJsonObjectError extends Schema.TaggedErrorClass<ExpectedJsonObjectError>()(
  "ExpectedJsonObjectError",
  { label: Schema.String },
) {}

const JsonObject = Schema.Record(Schema.String, Schema.Unknown);
const JsonObjectString = Schema.fromJsonString(JsonObject);
const parseJsonObject = Schema.decodeUnknownEffect(JsonObjectString);
const encodeJsonObject = Schema.encodeEffect(JsonObjectString);
const parseTsConfig = Schema.decodeUnknownEffect(
  Schema.fromJsonString(Schema.Struct({ include: Schema.Array(Schema.String) })),
);

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const requireRecord = (
  value: unknown,
  label: string,
): Effect.Effect<Record<string, unknown>, ExpectedJsonObjectError> =>
  isRecord(value) ? Effect.succeed(value) : Effect.fail(new ExpectedJsonObjectError({ label }));

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

const runCommand = Effect.fn("runCommand")(function* (
  cwd: string,
  command: string,
  args: ReadonlyArray<string>,
) {
  return yield* Effect.callback<CommandResult, CommandSpawnError>((resume) => {
    const proc = spawn(command, args, { cwd, shell: false });
    let stdout = "";
    let stderr = "";

    const onStdout = (data: Buffer): void => {
      stdout += data.toString();
    };
    const onStderr = (data: Buffer): void => {
      stderr += data.toString();
    };
    const onClose = (exitCode: number | null): void => {
      resume(Effect.succeed({ exitCode, stdout, stderr }));
    };
    const onError = (cause: Error): void => {
      resume(Effect.fail(new CommandSpawnError({ command, cause })));
    };

    proc.stdout?.on("data", onStdout);
    proc.stderr?.on("data", onStderr);
    proc.on("close", onClose);
    proc.on("error", onError);

    return Effect.sync(() => {
      proc.stdout?.off("data", onStdout);
      proc.stderr?.off("data", onStderr);
      proc.off("close", onClose);
      proc.off("error", onError);
      if (!proc.killed) {
        proc.kill();
      }
    });
  });
});

const checkNoTryggApiImports: (dir: string) => Effect.Effect<void, unknown, FileSystem.FileSystem> =
  Effect.fn("checkNoTryggApiImports")(function* (dir: string) {
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

const patchPackageJsonForLocalTrygg = Effect.fn("patchPackageJsonForLocalTrygg")(function* (
  targetDir: string,
) {
  const fs = yield* FileSystem.FileSystem;
  const pkgPath = path.join(targetDir, "package.json");
  const pkgText = yield* fs.readFileString(pkgPath);
  const pkg = yield* parseJsonObject(pkgText);
  const dependencies = yield* requireRecord(pkg.dependencies, "package.json dependencies");
  const relativeTryggPath = path.relative(targetDir, TRYGG_CORE_ABS);
  const patchedPkg = {
    ...pkg,
    dependencies: { ...dependencies, trygg: "file:" + relativeTryggPath },
  };
  const patchedText = yield* encodeJsonObject(patchedPkg);
  yield* fs.writeFileString(pkgPath, `${patchedText}\n`);
});

const bunInstall = (cwd: string): Effect.Effect<CommandResult, CommandSpawnError> =>
  runCommand(cwd, "bun", ["install"]);

describe("scaffoldProject", () => {
  it.effect("should generate .trygg/api.d.ts for incident template", () =>
    Effect.gen(function* () {
      // Scope: verifies incident scaffold produces visible trygg/api declarations.
      // Assertion: .trygg/api.d.ts exists with correct ambient module augmentation.
      const fs = yield* FileSystem.FileSystem;
      const targetDir = yield* fs.makeTempDirectoryScoped({ prefix: "trygg-scaffold-test-" });

      yield* runScaffold(targetDir, "incident");

      const apiDtsPath = path.join(targetDir, ".trygg", "api.d.ts");
      const apiDtsExists = yield* fs.exists(apiDtsPath);
      assert.isTrue(apiDtsExists, ".trygg/api.d.ts should exist for incident template");

      const content = yield* fs.readFileString(apiDtsPath);
      assert.include(content, 'declare module "trygg/api"');
      assert.include(content, 'import type { Api } from "../app/api"');
      assert.include(content, 'import type { Layer } from "effect/Layer"');
      assert.include(content, "type ApiClientService = HttpApiClient.ForApi<typeof Api>");
      assert.include(content, "export interface ApiClient {}");
      assert.include(
        content,
        'export const ApiClient: Context.ServiceClass<ApiClient, "ApiClient",',
      );
      assert.include(content, "export const ApiClientLive: Layer.Layer<ApiClient>");
      assert.include(content, "export { Api }");
    }).pipe(Effect.scoped, Effect.provide(NodeFileSystemLayer)),
  );

  it.effect("should include .trygg/**/*.d.ts in generated tsconfig.json", () =>
    Effect.gen(function* () {
      // Scope: verifies generated tsconfig.json makes trygg/api declarations visible to tsc.
      // Assertion: include array contains .trygg/**/*.d.ts.
      const fs = yield* FileSystem.FileSystem;
      const targetDir = yield* fs.makeTempDirectoryScoped({ prefix: "trygg-scaffold-test-" });

      yield* runScaffold(targetDir, "incident");

      const tsconfigPath = path.join(targetDir, "tsconfig.json");
      const tsconfigContent = yield* fs.readFileString(tsconfigPath);
      const tsconfig = yield* parseTsConfig(tsconfigContent);
      assert.deepEqual(tsconfig.include, ["app/**/*.ts", "app/**/*.tsx", ".trygg/**/*.d.ts"]);
    }).pipe(Effect.scoped, Effect.provide(NodeFileSystemLayer)),
  );

  it.effect("should NOT generate API boilerplate for blank template", () =>
    Effect.gen(function* () {
      // Scope: verifies blank scaffold stays safe as a no-API app.
      // Assertion: no app/api.ts, no .trygg/api.d.ts, no trygg-api.d.ts, and no trygg/api imports.
      const fs = yield* FileSystem.FileSystem;
      const targetDir = yield* fs.makeTempDirectoryScoped({
        directory: WORKSPACE_TEMP_DIR,
        prefix: "trygg-scaffold-test-",
      });

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

  it.effect("generated package pins Effect dependencies to one beta", () =>
    Effect.gen(function* () {
      // Scope: guards published scaffolds against mixed Effect beta installs.
      // Assertion: generated package.json uses exact Effect versions and pins node-shared.
      const fs = yield* FileSystem.FileSystem;
      const targetDir = yield* fs.makeTempDirectoryScoped({
        directory: WORKSPACE_TEMP_DIR,
        prefix: "trygg-scaffold-test-",
      });

      yield* runScaffold(targetDir, "blank");

      const pkgText = yield* fs.readFileString(path.join(targetDir, "package.json"));
      const pkg = yield* parseJsonObject(pkgText);
      const dependencies = yield* requireRecord(pkg.dependencies, "package.json dependencies");
      const devDependencies = yield* requireRecord(
        pkg.devDependencies,
        "package.json devDependencies",
      );
      const scripts = yield* requireRecord(pkg.scripts, "package.json scripts");

      assert.strictEqual(scripts.build, "bunx --bun vite build");
      assert.strictEqual(dependencies.effect, "4.0.0-beta.58");
      assert.strictEqual(dependencies["@effect/platform-browser"], "4.0.0-beta.58");
      assert.strictEqual(dependencies["@effect/platform-bun"], "4.0.0-beta.58");
      assert.strictEqual(dependencies["@effect/platform-node-shared"], "4.0.0-beta.58");
      assert.strictEqual(devDependencies["@effect/language-service"], "0.85.1");
    }).pipe(Effect.scoped, Effect.provide(NodeFileSystemLayer)),
  );

  it.effect("blank scaffold demonstrates Component.gen with Theme service", () =>
    Effect.gen(function* () {
      // Scope: verifies the default blank app teaches trygg DI basics.
      // Assertion: generated home page uses Component.gen, a Theme service, and service injection.
      const fs = yield* FileSystem.FileSystem;
      const targetDir = yield* fs.makeTempDirectoryScoped({
        directory: WORKSPACE_TEMP_DIR,
        prefix: "trygg-scaffold-test-",
      });

      yield* runScaffold(targetDir, "blank");

      const homePath = path.join(targetDir, "app", "pages", "home.tsx");
      const homeContent = yield* fs.readFileString(homePath);

      assert.include(homeContent, "Component.gen");
      assert.include(homeContent, "class Theme extends Context.Service");
      assert.include(homeContent, "yield* Theme");
      assert.include(homeContent, "Layer.succeed(Theme");
    }).pipe(Effect.scoped, Effect.provide(NodeFileSystemLayer)),
  );

  it.effect("blank scaffold should typecheck and build successfully", () =>
    Effect.gen(function* () {
      // Scope: verifies a freshly scaffolded blank app works without any API setup.
      // Assertion: bun run typecheck and bun run build both exit 0.
      const fs = yield* FileSystem.FileSystem;
      const targetDir = yield* fs.makeTempDirectoryScoped({
        directory: WORKSPACE_TEMP_DIR,
        prefix: "trygg-scaffold-test-",
      });

      yield* runScaffold(targetDir, "blank");
      yield* patchPackageJsonForLocalTrygg(targetDir);

      const installResult = yield* bunInstall(targetDir);
      assert.strictEqual(
        installResult.exitCode,
        0,
        `bun install should pass. stderr: ${installResult.stderr}`,
      );

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
        const targetDir = yield* fs.makeTempDirectoryScoped({
          directory: WORKSPACE_TEMP_DIR,
          prefix: "trygg-scaffold-test-",
        });

        yield* runScaffold(targetDir, "blank");
        yield* patchPackageJsonForLocalTrygg(targetDir);

        const installResult = yield* bunInstall(targetDir);
        assert.strictEqual(
          installResult.exitCode,
          0,
          `bun install should pass. stderr: ${installResult.stderr}`,
        );

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

  it.effect("blank scaffold home uses Component.gen and Theme service", () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const targetDir = yield* fs.makeTempDirectoryScoped({ prefix: "trygg-scaffold-test-" });

      yield* runScaffold(targetDir, "blank");

      const homePath = path.join(targetDir, "app", "pages", "home.tsx");
      const homeContent = yield* fs.readFileString(homePath);

      assert.include(homeContent, "Component.gen");
      assert.include(homeContent, "yield* Theme");
      assert.include(homeContent, "Theme service");
    }).pipe(Effect.scoped, Effect.provide(NodeFileSystemLayer)),
  );

  it.effect("blank scaffold layout provides theme layer", () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const targetDir = yield* fs.makeTempDirectoryScoped({ prefix: "trygg-scaffold-test-" });

      yield* runScaffold(targetDir, "blank");

      const layoutPath = path.join(targetDir, "app", "layout.tsx");
      const layoutContent = yield* fs.readFileString(layoutPath);

      assert.include(layoutContent, "ThemeLive");
      assert.include(layoutContent, ".pipe(Component.provide(ThemeLive))");
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
        assert.include(output, 'import type { Layer } from "effect/Layer"');
        assert.include(output, "type ApiClientService = HttpApiClient.ForApi<typeof Api>");
        assert.include(output, "export interface ApiClient {}");
        assert.include(
          output,
          'export const ApiClient: Context.ServiceClass<ApiClient, "ApiClient",',
        );
        assert.include(output, "export const ApiClientLive: Layer.Layer<ApiClient>");
        assert.include(output, "export { Api }");
      }),
  );
});
