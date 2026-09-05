import { Cause, Deferred, Effect, Exit, Fiber, Schema, Stream } from "effect";
import * as FileSystem from "effect/FileSystem";
import * as PlatformError from "effect/PlatformError";
import * as ChildProcess from "effect/unstable/process/ChildProcess";
import * as ChildProcessSpawner from "effect/unstable/process/ChildProcessSpawner";
import * as path from "node:path";
import { pathToFileURL } from "node:url";
import { assert, describe, it } from "@effect/vitest";
import { NodeServices } from "@effect/platform-node";
import { packCreateTryggArtifact } from "../../../../scripts/release/cli.js";
import { scaffoldProject } from "../scaffold.js";
import { generateApiClientTypes } from "../generators/api-client-types.js";

const TEMPLATES_DIR = path.join(import.meta.dirname, "../../templates");
const CLI_ROOT = path.resolve(import.meta.dirname, "../..");
const WORKSPACE_ROOT = path.resolve(import.meta.dirname, "../../../..");
const WORKSPACE_TEMP_DIR = path.join(WORKSPACE_ROOT, "apps/examples");
const TSC_CLI = path.join(CLI_ROOT, "node_modules/typescript/bin/tsc");
const NodeFileSystemLayer = NodeServices.layer;
const INCIDENT_README_AUTH = "Mutations require an operator access token";

class ExpectedJsonObjectError extends Schema.TaggedError<ExpectedJsonObjectError>()(
  "ExpectedJsonObjectError",
  { label: Schema.String },
) {}

const JsonObject = Schema.Record(Schema.String, Schema.Unknown);
const JsonObjectString = Schema.fromJsonString(JsonObject);
const parseJsonObject = Schema.decodeUnknownEffect(JsonObjectString);
const parseTsConfig = Schema.decodeUnknownEffect(
  Schema.fromJsonString(Schema.Struct({ include: Schema.Array(Schema.String) })),
);
const parsePackageVersion = Schema.decodeUnknownEffect(
  Schema.fromJsonString(Schema.Struct({ version: Schema.String })),
);
const encodeJsonString = Schema.encodeSync(Schema.fromJsonString(Schema.String));

const makeTargetDir = (fs: FileSystem.FileSystem, directory?: string) =>
  fs
    .makeTempDirectoryScoped(
      directory === undefined
        ? { prefix: "trygg-scaffold-test-" }
        : { directory, prefix: "trygg-scaffold-test-" },
    )
    .pipe(Effect.map((parentDir) => path.join(parentDir, "test-app")));

const assertNoScaffoldArtifacts = Effect.fn("assertNoScaffoldArtifacts")(function* (
  fs: FileSystem.FileSystem,
  targetDir: string,
) {
  const entries = yield* fs.readDirectory(path.dirname(targetDir));
  assert.deepEqual(
    entries.filter((entry) => entry.startsWith(`.${path.basename(targetDir)}.create-trygg`)),
    [],
  );
});

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const requireRecord = (
  value: unknown,
  label: string,
): Effect.Effect<Record<string, unknown>, ExpectedJsonObjectError> =>
  isRecord(value) ? Effect.succeed(value) : Effect.fail(new ExpectedJsonObjectError({ label }));

const runScaffold = (targetDir: string, template: "blank" | "incident") =>
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
  readonly exitCode: number;
  readonly stdout: string;
  readonly stderr: string;
}

const runCommand = Effect.fn("runCommand")(function* (
  cwd: string,
  command: string,
  args: ReadonlyArray<string>,
) {
  const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
  return yield* Effect.scoped(
    Effect.gen(function* () {
      const handle = yield* spawner.spawn(
        ChildProcess.make(command, args, {
          cwd,
          stdout: "pipe",
          stderr: "pipe",
          forceKillAfter: "5 seconds",
        }),
      );
      const [stdoutResult, stderrResult, exitCode] = yield* Effect.all(
        [
          handle.stdout.pipe(Stream.decodeText(), Stream.mkString),
          handle.stderr.pipe(Stream.decodeText(), Stream.mkString),
          handle.exitCode,
        ],
        { concurrency: "unbounded" },
      );
      return { exitCode, stdout: stdoutResult, stderr: stderrResult } satisfies CommandResult;
    }),
  );
});

const checkNoTryggApiImports: (
  dir: string,
) => Effect.Effect<void, PlatformError.PlatformError, FileSystem.FileSystem> = Effect.fn(
  "checkNoTryggApiImports",
)(function* (dir: string) {
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
  it.effect("should copy the optional incident README while leaving blank behavior unchanged", () =>
    Effect.gen(function* () {
      // Scope: verifies the allowlisted optional template-root file without broadening root copying.
      // Assertion: incident gets its authentication instructions, blank gets no README, and undeclared root files stay out.
      const fs = yield* FileSystem.FileSystem;
      const incidentTarget = yield* makeTargetDir(fs);
      const blankTarget = yield* makeTargetDir(fs);

      yield* runScaffold(incidentTarget, "incident");
      yield* runScaffold(blankTarget, "blank");

      const incidentReadme = yield* fs.readFileString(path.join(incidentTarget, "README.md"));
      assert.include(incidentReadme, INCIDENT_README_AUTH);
      assert.isFalse(yield* fs.exists(path.join(blankTarget, "README.md")));
      assert.isFalse(yield* fs.exists(path.join(incidentTarget, "trygg-api.d.ts")));
    }).pipe(Effect.scoped, Effect.provide(NodeFileSystemLayer)),
  );

  it.effect("should scaffold the incident README from the packed create-trygg tarball", () =>
    Effect.gen(function* () {
      // Scope: runs the scaffold implementation and templates extracted from the publishable tarball.
      // Assertion: the tarball contains the README, incident copies its authentication instructions, and blank remains unchanged.
      const fs = yield* FileSystem.FileSystem;
      const output = yield* fs.makeTempDirectoryScoped({
        directory: WORKSPACE_TEMP_DIR,
        prefix: ".trygg-packed-scaffold-test-",
      });
      const cliPackage = yield* fs
        .readFileString(path.join(CLI_ROOT, "package.json"))
        .pipe(Effect.flatMap(parsePackageVersion));
      const artifact = yield* packCreateTryggArtifact(
        "cccccccccccccccccccccccccccccccccccccccc",
        cliPackage.version,
        output,
      );
      const unpacked = path.join(output, "unpacked");
      yield* fs.makeDirectory(unpacked);

      const extractResult = yield* runCommand(output, "tar", [
        "-xzf",
        artifact.tarball,
        "-C",
        unpacked,
      ]);
      assert.strictEqual(
        extractResult.exitCode,
        0,
        `tar extraction should pass. stderr: ${extractResult.stderr}`,
      );

      const packedPackage = path.join(unpacked, "package");
      const packedReadme = yield* fs.readFileString(
        path.join(packedPackage, "templates", "incident", "README.md"),
      );
      assert.include(packedReadme, INCIDENT_README_AUTH);

      const incidentTarget = path.join(output, "packed-incident");
      const blankTarget = path.join(output, "packed-blank");
      const runnerPath = path.join(output, "run-packed-scaffold.ts");
      const packedScaffoldUrl = pathToFileURL(path.join(packedPackage, "src", "scaffold.ts")).href;
      yield* fs.writeFileString(
        runnerPath,
        `import { basename } from "node:path";
import { NodeServices } from "@effect/platform-node";
import { Effect } from "effect";
import { scaffoldProject } from ${encodeJsonString(packedScaffoldUrl)};

const templatesDir = ${encodeJsonString(path.join(packedPackage, "templates"))};
const projects = [
  ["incident", ${encodeJsonString(incidentTarget)}],
  ["blank", ${encodeJsonString(blankTarget)}],
] as const;

for (const [template, targetDir] of projects) {
  await Effect.runPromise(
    scaffoldProject(
      targetDir,
      {
        name: basename(targetDir),
        template,
        platform: "bun",
        output: "server",
        vcs: "none",
        install: false,
      },
      templatesDir,
    ).pipe(Effect.provide(NodeServices.layer)),
  );
}
`,
      );
      const scaffoldResult = yield* runCommand(output, "bun", [runnerPath]);
      assert.strictEqual(
        scaffoldResult.exitCode,
        0,
        `packed scaffold should pass. stdout: ${scaffoldResult.stdout}\nstderr: ${scaffoldResult.stderr}`,
      );

      const generatedReadme = yield* fs.readFileString(path.join(incidentTarget, "README.md"));
      assert.include(generatedReadme, INCIDENT_README_AUTH);
      assert.isFalse(yield* fs.exists(path.join(blankTarget, "README.md")));
      assert.isFalse(yield* fs.exists(path.join(incidentTarget, "trygg-api.d.ts")));
    }).pipe(Effect.scoped, Effect.provide(NodeFileSystemLayer)),
  );

  it.effect("should generate .trygg/api.d.ts for incident template", () =>
    Effect.gen(function* () {
      // Scope: verifies incident scaffold produces visible trygg/api declarations.
      // Assertion: .trygg/api.d.ts exists with correct ambient module augmentation.
      const fs = yield* FileSystem.FileSystem;
      const targetDir = yield* makeTargetDir(fs);

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
      const targetDir = yield* makeTargetDir(fs);

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
      const targetDir = yield* makeTargetDir(fs);

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

  it.effect("should roll back staging when a filesystem write fails", () =>
    Effect.gen(function* () {
      // Scope: verifies a late scaffold failure cannot publish a partial destination.
      // Assertion: the PlatformError is preserved and neither target nor owned staging remains.
      const fs = yield* FileSystem.FileSystem;
      const targetDir = yield* makeTargetDir(fs);
      const cause = PlatformError.badArgument({
        module: "FileSystem",
        method: "writeFileString",
        description: "test write failure",
      });
      const failingFs = FileSystem.FileSystem.of({
        ...fs,
        writeFileString: (file, data, options) =>
          path.basename(file) === "package.json"
            ? Effect.fail(cause)
            : fs.writeFileString(file, data, options),
      });

      const error = yield* Effect.flip(
        runScaffold(targetDir, "blank").pipe(
          Effect.provideService(FileSystem.FileSystem, failingFs),
        ),
      );

      assert.strictEqual(error, cause);
      assert.isFalse(yield* fs.exists(targetDir));
      yield* assertNoScaffoldArtifacts(fs, targetDir);
    }).pipe(Effect.scoped, Effect.provide(NodeFileSystemLayer)),
  );

  for (const stage of [
    "app",
    ".trygg",
    "api.d.ts",
    "styles.css",
    "public",
    "README.md",
    "package.json",
    "vite.config.ts",
    "tsconfig.json",
    ".gitignore",
    ".oxlintrc.json",
  ]) {
    it.effect(`should preserve a ${stage} staging failure and allow retry`, () =>
      Effect.gen(function* () {
        // Scope: each template/configuration stage fails through the real filesystem port.
        // Assertion: the exact operational failure survives, owned paths disappear, and retry publishes successfully.
        const fs = yield* FileSystem.FileSystem;
        const targetDir = yield* makeTargetDir(fs);
        const failure = PlatformError.badArgument({
          module: "FileSystem",
          method: "scaffold-stage",
          description: stage,
        });
        const failingFs = FileSystem.FileSystem.of({
          ...fs,
          readDirectory: (directory) =>
            (stage === "app" || stage === "public") && path.basename(directory) === stage
              ? Effect.fail(failure)
              : fs.readDirectory(directory),
          makeDirectory: (directory, options) =>
            stage === ".trygg" && path.basename(directory) === stage
              ? Effect.fail(failure)
              : fs.makeDirectory(directory, options),
          copyFile: (source, destination) =>
            path.basename(destination) === stage
              ? Effect.fail(failure)
              : fs.copyFile(source, destination),
          writeFileString: (file, content, options) =>
            path.basename(file) === stage
              ? Effect.fail(failure)
              : fs.writeFileString(file, content, options),
        });
        const error = yield* Effect.flip(
          runScaffold(targetDir, "incident").pipe(
            Effect.provideService(FileSystem.FileSystem, failingFs),
          ),
        );
        assert.strictEqual(error, failure);
        assert.isFalse(yield* fs.exists(targetDir));
        yield* assertNoScaffoldArtifacts(fs, targetDir);
        yield* runScaffold(targetDir, "incident");
        assert.isTrue(yield* fs.exists(path.join(targetDir, "package.json")));
        yield* assertNoScaffoldArtifacts(fs, targetDir);
      }).pipe(Effect.scoped, Effect.provide(NodeFileSystemLayer)),
    );
  }

  it.effect("should roll back staging after scaffold interruption", () =>
    Effect.gen(function* () {
      // Scope: verifies Ctrl+C during template copying owns all provisional files.
      // Assertion: interruption remains in the Cause and cleanup completes before interrupt returns.
      const fs = yield* FileSystem.FileSystem;
      const targetDir = yield* makeTargetDir(fs);
      const readStarted = yield* Deferred.make<void>();
      const blockingFs = FileSystem.FileSystem.of({
        ...fs,
        readDirectory: () =>
          Deferred.succeed(readStarted, undefined).pipe(Effect.andThen(Effect.never)),
      });
      const fiber = yield* Effect.forkChild(
        runScaffold(targetDir, "blank").pipe(
          Effect.provideService(FileSystem.FileSystem, blockingFs),
        ),
      );

      yield* Deferred.await(readStarted);
      yield* Fiber.interrupt(fiber);
      const exit = yield* Fiber.await(fiber);

      assert.isTrue(Exit.isFailure(exit));
      if (Exit.isFailure(exit)) {
        assert.isTrue(Cause.hasInterrupts(exit.cause));
      }
      assert.isFalse(yield* fs.exists(targetDir));
      yield* assertNoScaffoldArtifacts(fs, targetDir);
    }).pipe(Effect.scoped, Effect.provide(NodeFileSystemLayer)),
  );

  for (const operation of ["makeDirectory", "copyFile", "writeFileString"]) {
    it.effect(`should await ${operation} settlement before interrupted staging cleanup`, () =>
      Effect.gen(function* () {
        // Scope: a native staging mutation applies before its callback reports completion.
        // Assertion: cancellation cannot start cleanup until that callback settles; retry then succeeds.
        const fs = yield* FileSystem.FileSystem;
        const targetDir = yield* makeTargetDir(fs);
        const mutationApplied = yield* Deferred.make<void>();
        const allowSettlement = yield* Deferred.make<void>();
        let cleanupCalls = 0;
        const delayed = (effect: Effect.Effect<void, PlatformError.PlatformError>) =>
          effect.pipe(
            Effect.tap(() => Deferred.succeed(mutationApplied, undefined)),
            Effect.andThen(Deferred.await(allowSettlement)),
          );
        const coordinatedFs = FileSystem.FileSystem.of({
          ...fs,
          makeDirectory: (directory, options) =>
            operation === "makeDirectory"
              ? delayed(fs.makeDirectory(directory, options))
              : fs.makeDirectory(directory, options),
          copyFile: (source, destination) =>
            operation === "copyFile"
              ? delayed(fs.copyFile(source, destination))
              : fs.copyFile(source, destination),
          writeFileString: (file, content, options) =>
            operation === "writeFileString"
              ? delayed(fs.writeFileString(file, content, options))
              : fs.writeFileString(file, content, options),
          remove: (file, options) =>
            Effect.sync(() => {
              cleanupCalls++;
            }).pipe(Effect.andThen(fs.remove(file, options))),
        });
        const creator = yield* Effect.forkChild(
          runScaffold(targetDir, "incident").pipe(
            Effect.provideService(FileSystem.FileSystem, coordinatedFs),
          ),
        );
        yield* Deferred.await(mutationApplied);
        const interruption = yield* Effect.forkChild(Fiber.interrupt(creator));
        yield* Effect.yieldNow;
        const prematureCleanupCalls = cleanupCalls;
        yield* Deferred.succeed(allowSettlement, undefined);
        yield* Fiber.join(interruption);

        assert.strictEqual(prematureCleanupCalls, 0);
        assert.isTrue(Exit.hasInterrupts(yield* Fiber.await(creator)));
        assert.isFalse(yield* fs.exists(targetDir));
        yield* assertNoScaffoldArtifacts(fs, targetDir);
        yield* runScaffold(targetDir, "incident");
        assert.isTrue(yield* fs.exists(path.join(targetDir, "package.json")));
      }).pipe(Effect.scoped, Effect.provide(NodeFileSystemLayer)),
    );
  }

  it.effect("should remove a reserved target when publication fails", () =>
    Effect.gen(function* () {
      // Scope: verifies failure after the no-replace reservation still rolls publication back.
      // Assertion: the original PlatformError is preserved and no target or staging path survives.
      const fs = yield* FileSystem.FileSystem;
      const targetDir = yield* makeTargetDir(fs);
      const cause = PlatformError.badArgument({
        module: "FileSystem",
        method: "rename",
        description: "test publish failure",
      });
      const failingFs = FileSystem.FileSystem.of({
        ...fs,
        rename: () => Effect.fail(cause),
      });
      const error = yield* Effect.flip(
        runScaffold(targetDir, "blank").pipe(
          Effect.provideService(FileSystem.FileSystem, failingFs),
        ),
      );

      assert.strictEqual(error, cause);
      assert.isFalse(yield* fs.exists(targetDir));
      yield* assertNoScaffoldArtifacts(fs, targetDir);
    }).pipe(Effect.scoped, Effect.provide(NodeFileSystemLayer)),
  );

  it.effect("should not overwrite an external creator that wins the target race", () =>
    Effect.gen(function* () {
      // Scope: races the production no-replace reservation against a real external mkdir.
      // Assertion: the scaffold loses with DirectoryExistsError and leaves the empty winner unchanged.
      const fs = yield* FileSystem.FileSystem;
      const targetDir = yield* makeTargetDir(fs);
      const reservationStarted = yield* Deferred.make<void>();
      const allowReservation = yield* Deferred.make<void>();
      const coordinatedFs = FileSystem.FileSystem.of({
        ...fs,
        makeDirectory: (directory, options) =>
          directory === targetDir
            ? Deferred.succeed(reservationStarted, undefined).pipe(
                Effect.andThen(Deferred.await(allowReservation)),
                Effect.andThen(fs.makeDirectory(directory, options)),
              )
            : fs.makeDirectory(directory, options),
      });
      const creator = yield* Effect.forkChild(
        runScaffold(targetDir, "blank").pipe(
          Effect.provideService(FileSystem.FileSystem, coordinatedFs),
        ),
      );

      yield* Deferred.await(reservationStarted);
      yield* fs.makeDirectory(targetDir);
      assert.deepEqual(yield* fs.readDirectory(targetDir), []);
      const winnerInfo = yield* fs.stat(targetDir);
      yield* Deferred.succeed(allowReservation, undefined);

      const error = yield* Effect.flip(Fiber.join(creator));
      assert.strictEqual(error._tag, "DirectoryExistsError");
      assert.deepEqual(yield* fs.readDirectory(targetDir), []);
      const retainedInfo = yield* fs.stat(targetDir);
      assert.strictEqual(retainedInfo.dev, winnerInfo.dev);
      assert.deepEqual(retainedInfo.ino, winnerInfo.ino);
      yield* assertNoScaffoldArtifacts(fs, targetDir);
    }).pipe(Effect.scoped, Effect.provide(NodeFileSystemLayer)),
  );

  it.effect("should await real rename settlement before interrupted cleanup returns", () =>
    Effect.gen(function* () {
      // Scope: interrupts after a real filesystem rename mutates the reserved target but before its adapter settles.
      // Assertion: interruption waits for settlement, then removes the provisional target and staging paths.
      const fs = yield* FileSystem.FileSystem;
      const targetDir = yield* makeTargetDir(fs);
      const renameApplied = yield* Deferred.make<void>();
      const allowRenameSettlement = yield* Deferred.make<void>();
      const coordinatedFs = FileSystem.FileSystem.of({
        ...fs,
        rename: (oldPath, newPath) =>
          path.dirname(newPath) === targetDir
            ? fs.rename(oldPath, newPath).pipe(
                Effect.tap(() => Deferred.succeed(renameApplied, undefined)),
                Effect.andThen(Deferred.await(allowRenameSettlement)),
              )
            : fs.rename(oldPath, newPath),
      });
      const creator = yield* Effect.forkChild(
        runScaffold(targetDir, "blank").pipe(
          Effect.provideService(FileSystem.FileSystem, coordinatedFs),
        ),
      );

      yield* Deferred.await(renameApplied);
      assert.isNotEmpty(yield* fs.readDirectory(targetDir));

      const interruptRequest = yield* Effect.forkChild(Fiber.interrupt(creator));
      yield* Effect.yieldNow;

      assert.isUndefined(interruptRequest.pollUnsafe());
      assert.isTrue(yield* fs.exists(targetDir));

      yield* Deferred.succeed(allowRenameSettlement, undefined);
      yield* Fiber.join(interruptRequest);
      const exit = yield* Fiber.await(creator);

      assert.isTrue(Exit.isFailure(exit));
      if (Exit.isFailure(exit)) {
        assert.isTrue(Cause.hasInterrupts(exit.cause));
      }
      assert.isFalse(yield* fs.exists(targetDir));
      yield* assertNoScaffoldArtifacts(fs, targetDir);
    }).pipe(Effect.scoped, Effect.provide(NodeFileSystemLayer)),
  );

  it.effect("should serialize concurrent creators without overwriting the winner", () =>
    Effect.gen(function* () {
      // Scope: verifies the target reservation serializes two cooperating CLI instances.
      // Assertion: the loser receives DirectoryExistsError and the winner publishes one complete target.
      const fs = yield* FileSystem.FileSystem;
      const targetDir = yield* makeTargetDir(fs);
      const renameStarted = yield* Deferred.make<void>();
      const allowRename = yield* Deferred.make<void>();
      const coordinatedFs = FileSystem.FileSystem.of({
        ...fs,
        rename: (oldPath, newPath) =>
          Deferred.succeed(renameStarted, undefined).pipe(
            Effect.andThen(Deferred.await(allowRename)),
            Effect.andThen(fs.rename(oldPath, newPath)),
          ),
      });
      const winner = yield* Effect.forkChild(
        runScaffold(targetDir, "blank").pipe(
          Effect.provideService(FileSystem.FileSystem, coordinatedFs),
        ),
      );

      yield* Deferred.await(renameStarted);
      const loserError = yield* Effect.flip(
        runScaffold(targetDir, "blank").pipe(
          Effect.provideService(FileSystem.FileSystem, coordinatedFs),
        ),
      );
      assert.strictEqual(loserError._tag, "DirectoryExistsError");

      yield* Deferred.succeed(allowRename, undefined);
      yield* Fiber.join(winner);

      assert.isTrue(yield* fs.exists(path.join(targetDir, "package.json")));
      yield* assertNoScaffoldArtifacts(fs, targetDir);
    }).pipe(Effect.scoped, Effect.provide(NodeFileSystemLayer)),
  );

  it.effect("generated package pins Effect dependencies to one version", () =>
    Effect.gen(function* () {
      // Scope: guards published scaffolds against mixed Effect installs.
      // Assertion: generated package.json uses exact Effect versions and pins node-shared.
      const fs = yield* FileSystem.FileSystem;
      const targetDir = yield* makeTargetDir(fs);

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
      assert.strictEqual(dependencies.effect, "4.0.0-rc.112");
      assert.strictEqual(dependencies["@effect/platform-browser"], "4.0.0-rc.112");
      assert.strictEqual(dependencies["@effect/platform-bun"], "4.0.0-rc.112");
      assert.strictEqual(dependencies["@effect/platform-node-shared"], "4.0.0-rc.112");
      assert.strictEqual(devDependencies["@effect/language-service"], "0.87.2");
      assert.strictEqual(devDependencies.typescript, "^5.7.0");
    }).pipe(Effect.scoped, Effect.provide(NodeFileSystemLayer)),
  );

  it.effect("blank scaffold demonstrates Component.gen with Theme service", () =>
    Effect.gen(function* () {
      // Scope: verifies the default blank app teaches trygg DI basics.
      // Assertion: generated home page uses Component.gen, a Theme service, and service injection.
      const fs = yield* FileSystem.FileSystem;
      const targetDir = yield* makeTargetDir(fs);

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
      // Scope: verifies a blank app against the installed workspace toolchain without registry I/O.
      // Assertion: TypeScript and Vite both accept the generated app without API setup.
      const fs = yield* FileSystem.FileSystem;
      const targetDir = yield* makeTargetDir(fs, WORKSPACE_TEMP_DIR);

      yield* runScaffold(targetDir, "blank");

      const typecheckResult = yield* runCommand(targetDir, "bun", [TSC_CLI, "--noEmit"]);
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
        const targetDir = yield* makeTargetDir(fs, WORKSPACE_TEMP_DIR);

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

  it.effect("incident scaffold should provide its global API client and build", () =>
    Effect.gen(function* () {
      // Scope: the global command palette fetches incidents before any route-local provider runs.
      // Assertion: the layout provides the root containing ApiClientLive, and the app typechecks and builds.
      const fs = yield* FileSystem.FileSystem;
      const targetDir = yield* makeTargetDir(fs, WORKSPACE_TEMP_DIR);

      yield* runScaffold(targetDir, "incident");

      const layout = yield* fs.readFileString(path.join(targetDir, "app", "layout.tsx"));
      assert.include(layout, "Component.provide(AppServicesLive)");

      const typecheckResult = yield* runCommand(targetDir, "bun", [TSC_CLI, "--noEmit"]);
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

  it.effect("blank scaffold home uses Component.gen and Theme service", () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const targetDir = yield* makeTargetDir(fs);

      yield* runScaffold(targetDir, "blank");

      const homePath = path.join(targetDir, "app", "pages", "home.tsx");
      const homeContent = yield* fs.readFileString(homePath);

      assert.include(homeContent, "Component.gen");
      assert.include(homeContent, "yield* Theme");
      assert.include(homeContent, "Theme service");
    }).pipe(Effect.scoped, Effect.provide(NodeFileSystemLayer)),
  );

  it.effect("blank scaffold page provides theme layer", () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const targetDir = yield* makeTargetDir(fs);

      yield* runScaffold(targetDir, "blank");

      const homePath = path.join(targetDir, "app", "pages", "home.tsx");
      const homeContent = yield* fs.readFileString(homePath);

      assert.include(homeContent, "ThemeLive");
      assert.include(homeContent, ".pipe(Component.provide(ThemeLive))");
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
