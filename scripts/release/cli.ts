import { fileURLToPath } from "node:url";
import { dirname, join, resolve } from "node:path";
import { NodeRuntime, NodeServices } from "@effect/platform-node";
import * as Config from "effect/Config";
import * as Console from "effect/Console";
import * as Data from "effect/Data";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import * as Stream from "effect/Stream";
import * as Command from "effect/unstable/cli/Command";
import * as Flag from "effect/unstable/cli/Flag";
import * as ChildProcess from "effect/unstable/process/ChildProcess";
import * as ChildProcessSpawner from "effect/unstable/process/ChildProcessSpawner";
import { type PackageIdentity, validatePackageIdentity, validateReleaseSource } from "./source.js";

type JsonObject = Record<string, unknown>;

interface CommandResult {
  readonly stdout: string;
  readonly stderr: string;
  readonly exitCode: number;
}

type NpmLookupResult = Data.TaggedEnum<{
  readonly Found: { readonly metadata: PackageIdentity };
  readonly NotFound: {};
  readonly Failed: {
    readonly stdout: string;
    readonly stderr: string;
    readonly exitCode: number;
  };
}>;

const NpmLookupResult = Data.taggedEnum<NpmLookupResult>();

interface Semver {
  readonly major: number;
  readonly minor: number;
  readonly patch: number;
  readonly prerelease: string | undefined;
}

interface SyncCreateTryggResult {
  readonly tryggVersion: string;
  readonly cliVersion: string;
}

const NpmPackFile = Schema.Struct({
  path: Schema.String,
});

const NpmPackResult = Schema.Struct({
  name: Schema.String,
  version: Schema.String,
  filename: Schema.String,
  files: Schema.Array(NpmPackFile),
});

const NpmPackOutput = Schema.fromJsonString(Schema.Array(NpmPackResult));
const decodeNpmPackOutput = Schema.decodeUnknownEffect(NpmPackOutput);
const PackageIdentity = Schema.Struct({
  name: Schema.String,
  version: Schema.String,
  gitHead: Schema.optional(Schema.String),
});
const PackageIdentityJson = Schema.fromJsonString(PackageIdentity);
const decodePackageIdentityJson = Schema.decodeUnknownEffect(PackageIdentityJson);
const JsonUnknown = Schema.fromJsonString(Schema.Unknown);
const decodeJsonUnknown = Schema.decodeUnknownEffect(JsonUnknown);

class ReleaseCliError extends Schema.TaggedError<ReleaseCliError>()("ReleaseCliError", {
  message: Schema.String,
  cause: Schema.optional(Schema.Defect()),
  stdout: Schema.optional(Schema.String),
  stderr: Schema.optional(Schema.String),
  exitCode: Schema.optional(Schema.Number),
}) {}

const root = new URL("../../", import.meta.url);
const workspaceRoot = fileURLToPath(root);
const corePackagePath = fileURLToPath(new URL("packages/core/package.json", root));
const cliPackagePath = fileURLToPath(new URL("packages/cli/package.json", root));
const cliPackageDirectory = dirname(cliPackagePath);
const cliVersionsPath = fileURLToPath(new URL("packages/cli/src/versions.ts", root));
const wwwPackagePath = fileURLToPath(new URL("apps/www/package.json", root));
const mainBranch = "main";
const npmVerificationAttempts = 20;
const npmVerificationSleepMillis = 15_000;
const publicTemplates: ReadonlyArray<"blank" | "incident"> = ["blank", "incident"];
const requiredCliArtifactFiles: ReadonlyArray<string> = [
  "index.ts",
  "package.json",
  "src/adapters/process-group-live.ts",
  "src/ports/process-group.ts",
  "src/process.ts",
  "src/scaffold.ts",
  "templates/global.d.ts",
  "templates/incident/README.md",
];

const gitIdentity = {
  GIT_AUTHOR_NAME: "github-actions[bot]",
  GIT_AUTHOR_EMAIL: "41898282+github-actions[bot]@users.noreply.github.com",
  GIT_COMMITTER_NAME: "github-actions[bot]",
  GIT_COMMITTER_EMAIL: "41898282+github-actions[bot]@users.noreply.github.com",
};

const isJsonObject = (value: unknown): value is JsonObject =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const collectStream = (stream: Stream.Stream<Uint8Array, unknown>) =>
  stream.pipe(
    Stream.decodeText(),
    Stream.mkString,
    Effect.orElseSucceed(() => ""),
  );

const runCommand = Effect.fn("runCommand")(function* (
  command: string,
  args: ReadonlyArray<string>,
  options?: {
    readonly cwd?: string;
    readonly env?: Readonly<Record<string, string>>;
    readonly allowFailure?: boolean;
  },
) {
  const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
  return yield* Effect.scoped(
    Effect.gen(function* () {
      const handle = yield* spawner
        .spawn(
          ChildProcess.make(command, args, {
            cwd: options?.cwd,
            env: options?.env,
            extendEnv: true,
            stdout: "pipe",
            stderr: "pipe",
          }),
        )
        .pipe(
          Effect.mapError(
            (cause) =>
              new ReleaseCliError({
                message: `Failed to spawn ${command}`,
                cause,
              }),
          ),
        );

      const [stdout, stderr, exitCode] = yield* Effect.all([
        collectStream(handle.stdout),
        collectStream(handle.stderr),
        handle.exitCode.pipe(
          Effect.mapError(
            (cause) =>
              new ReleaseCliError({
                message: `Failed to read exit code for ${command}`,
                cause,
              }),
          ),
        ),
      ]);

      if (exitCode !== 0 && options?.allowFailure !== true) {
        const details = [stdout.trim(), stderr.trim()].filter((part) => part.length > 0).join("\n");

        return yield* new ReleaseCliError({
          message:
            details.length > 0
              ? `${command} exited with code ${exitCode}\n${details}`
              : `${command} exited with code ${exitCode}`,
          stdout,
          stderr,
          exitCode,
        });
      }

      return {
        stdout,
        stderr,
        exitCode,
      } satisfies CommandResult;
    }),
  );
});

const readText = Effect.fn("readText")(function* (path: string) {
  const fs = yield* FileSystem.FileSystem;

  return yield* fs.readFileString(path).pipe(
    Effect.mapError(
      (cause) =>
        new ReleaseCliError({
          message: `Failed to read ${path}`,
          cause,
        }),
    ),
  );
});

const writeText = Effect.fn("writeText")(function* (path: string, text: string) {
  const fs = yield* FileSystem.FileSystem;

  yield* fs.writeFileString(path, text, { flag: "a" }).pipe(
    Effect.mapError(
      (cause) =>
        new ReleaseCliError({
          message: `Failed to write ${path}`,
          cause,
        }),
    ),
  );
});

const writeGithubOutput = Effect.fn("writeGithubOutput")(function* (name: string, value: string) {
  const outputPath = yield* Config.option(Config.string("GITHUB_OUTPUT"));

  if (Option.isNone(outputPath) || outputPath.value.length === 0) {
    return;
  }

  yield* writeText(outputPath.value, `${name}=${value}\n`);
});

const writeShouldRelease = Effect.fn("writeShouldRelease")(function* (shouldRelease: boolean) {
  yield* writeGithubOutput("should_release", shouldRelease ? "true" : "false");
});

const parseJsonObject = Effect.fn("parseJsonObject")(function* (text: string, path: string) {
  const parsed = yield* decodeJsonUnknown(text).pipe(
    Effect.mapError(
      (cause) =>
        new ReleaseCliError({
          message: `Failed to parse JSON in ${path}`,
          cause,
        }),
    ),
  );

  if (!isJsonObject(parsed)) {
    return yield* new ReleaseCliError({
      message: `Expected JSON object in ${path}`,
    });
  }

  return parsed;
});

const readJsonObject = Effect.fn("readJsonObject")(function* (path: string) {
  const text = yield* readText(path);
  return yield* parseJsonObject(text, path);
});

const readTrackedTryggVersion = Effect.fn("readTrackedTryggVersion")(function* (path: string) {
  const text = yield* readText(path);
  const match = text.match(/^export const TRYGG_VERSION = "\^([^"]+)";$/m);

  if (match === null) {
    return yield* new ReleaseCliError({
      message: `TRYGG_VERSION export not found in ${path}`,
    });
  }

  const [, trackedVersion] = match;

  if (trackedVersion === undefined) {
    return yield* new ReleaseCliError({
      message: `TRYGG_VERSION export malformed in ${path}`,
    });
  }

  return trackedVersion;
});

const readStringField = Effect.fn("readStringField")(function* (
  json: JsonObject,
  key: string,
  path: string,
) {
  const value = json[key];

  if (typeof value !== "string") {
    return yield* new ReleaseCliError({
      message: `Missing string ${key} in ${path}`,
    });
  }

  return value;
});

const readDependencyMap = Effect.fn("readDependencyMap")(function* (
  json: JsonObject,
  key: string,
  path: string,
) {
  const value = json[key];

  if (value === undefined) {
    return {} satisfies JsonObject;
  }

  if (!isJsonObject(value)) {
    return yield* new ReleaseCliError({
      message: `Expected ${key} object in ${path}`,
    });
  }

  return value;
});

const overwriteText = Effect.fn("overwriteText")(function* (path: string, text: string) {
  const fs = yield* FileSystem.FileSystem;

  yield* fs.writeFileString(path, text).pipe(
    Effect.mapError(
      (cause) =>
        new ReleaseCliError({
          message: `Failed to write ${path}`,
          cause,
        }),
    ),
  );
});

const writeJsonObject = Effect.fn("writeJsonObject")(function* (
  path: string,
  json: JsonObject,
  dryRun: boolean,
) {
  if (dryRun) {
    return;
  }

  yield* overwriteText(path, `${JSON.stringify(json, null, 2)}\n`);
});

const readPackageVersion = Effect.fn("readPackageVersion")(function* (path: string) {
  const json = yield* readText(path).pipe(Effect.flatMap((text) => parseJsonObject(text, path)));
  const version = json["version"];

  if (typeof version !== "string") {
    return yield* new ReleaseCliError({
      message: `Missing string version in ${path}`,
    });
  }

  return version;
});

const parseSemver = Effect.fn("parseSemver")(function* (value: string) {
  const match = value.match(/^(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?(?:\+[0-9A-Za-z.-]+)?$/);

  if (match === null) {
    return yield* new ReleaseCliError({
      message: `Invalid semver: ${value}`,
    });
  }

  const [, majorText, minorText, patchText, prerelease] = match;

  if (majorText === undefined || minorText === undefined || patchText === undefined) {
    return yield* new ReleaseCliError({
      message: `Invalid semver capture: ${value}`,
    });
  }

  return {
    major: Number(majorText),
    minor: Number(minorText),
    patch: Number(patchText),
    prerelease,
  } satisfies Semver;
});

const semverRegex = /^[0-9]+\.[0-9]+\.[0-9]+(-[a-zA-Z0-9.]+)?(\+[a-zA-Z0-9.]+)?$/;

const formatSemver = (version: Semver): string => {
  const base = `${version.major}.${version.minor}.${version.patch}`;
  return version.prerelease === undefined ? base : `${base}-${version.prerelease}`;
};

const distTagFromVersion = (version: string): string | undefined => {
  const [, prerelease] = version.split("-", 2);

  if (prerelease === undefined) {
    return undefined;
  }

  const [distTag] = prerelease.split(".", 1);
  return distTag;
};

const trimOutput = (value: string): string => value.trim();

const readCoreVersionAt = Effect.fn("readCoreVersionAt")(function* (sourceSha: string) {
  const sourcePackagePath = `git:${sourceSha}:packages/core/package.json`;
  const sourcePackage = yield* runCommand("git", [
    "show",
    `${sourceSha}:packages/core/package.json`,
  ]);
  const sourceJson = yield* parseJsonObject(sourcePackage.stdout, sourcePackagePath);
  return yield* readStringField(sourceJson, "version", sourcePackagePath);
});

const verifyPreparedSource = Effect.fn("verifyPreparedSource")(function* (
  sourceSha: string,
  expectedTryggVersion: string,
) {
  const actualSha = trimOutput((yield* runCommand("git", ["rev-parse", "HEAD"])).stdout);
  const actualTryggVersion = yield* readCoreVersionAt(sourceSha);

  yield* validateReleaseSource({
    actualSha,
    expectedSha: sourceSha,
    actualTryggVersion,
    expectedTryggVersion,
  }).pipe(
    Effect.mapError(
      (error) =>
        new ReleaseCliError({
          message: `Prepared release ${error.reason} mismatch: expected ${error.expected}, found ${error.actual}`,
        }),
    ),
  );
});

const verifyTryggSource = Effect.fn("verifyTryggSource")(function* (
  sourceSha: string,
  tryggSourceSha: string,
  expectedTryggVersion: string,
) {
  const actualTryggVersion = yield* readCoreVersionAt(tryggSourceSha);
  if (actualTryggVersion !== expectedTryggVersion) {
    return yield* new ReleaseCliError({
      message: `Prepared core version mismatch: expected ${expectedTryggVersion}, found ${actualTryggVersion}`,
    });
  }

  const ancestor = yield* runCommand(
    "git",
    ["merge-base", "--is-ancestor", tryggSourceSha, sourceSha],
    { allowFailure: true },
  );
  if (ancestor.exitCode !== 0) {
    return yield* new ReleaseCliError({
      message: `Prepared core revision ${tryggSourceSha} is not an ancestor of create-trygg source ${sourceSha}`,
      stdout: ancestor.stdout,
      stderr: ancestor.stderr,
      exitCode: ancestor.exitCode,
    });
  }
});

const verifyRemoteBranch = Effect.fn("verifyRemoteBranch")(function* (
  branch: string,
  sourceSha: string,
) {
  const result = yield* runCommand("git", [
    "ls-remote",
    "--heads",
    "origin",
    `refs/heads/${branch}`,
  ]);
  const [remoteSha] = trimOutput(result.stdout).split(/\s+/, 1);

  if (remoteSha !== sourceSha) {
    return yield* new ReleaseCliError({
      message: `Refusing release sync because origin/${branch} advanced from ${sourceSha} to ${remoteSha ?? "missing"}`,
    });
  }
});

const nextCliVersion = Effect.fn("nextCliVersion")(function* (
  currentCliVersion: string,
  tryggVersion: string,
) {
  const current = yield* parseSemver(currentCliVersion);
  const trygg = yield* parseSemver(tryggVersion);

  if (trygg.prerelease !== undefined) {
    return formatSemver({
      ...current,
      prerelease: trygg.prerelease,
    });
  }

  if (current.prerelease !== undefined) {
    return formatSemver({
      ...current,
      prerelease: undefined,
    });
  }

  return formatSemver({
    ...current,
    patch: current.patch + 1,
  });
});

const updateTryggVersionConstant = Effect.fn("updateTryggVersionConstant")(function* (
  path: string,
  tryggVersion: string,
  dryRun: boolean,
) {
  const current = yield* readText(path);
  const next = current.replace(
    /^export const TRYGG_VERSION = "\^[^"]+";$/m,
    `export const TRYGG_VERSION = "^${tryggVersion}";`,
  );

  if (current === next) {
    if (!current.includes("export const TRYGG_VERSION")) {
      return yield* new ReleaseCliError({
        message: `TRYGG_VERSION export not found in ${path}`,
      });
    }

    return;
  }

  if (dryRun) {
    return;
  }

  yield* overwriteText(path, next);
});

const syncCreateTrygg = Effect.fn("syncCreateTrygg")(function* (
  dryRun: boolean,
  writeOutputs: boolean = true,
  tryggVersionOverride?: string,
  tryggSourceSha?: string,
) {
  const tryggVersion =
    tryggVersionOverride ??
    (yield* readJsonObject(corePackagePath).pipe(
      Effect.flatMap((tryggPackage) => readStringField(tryggPackage, "version", corePackagePath)),
    ));
  const trackedTryggVersion = yield* readTrackedTryggVersion(cliVersionsPath);

  const cliPackage = yield* readJsonObject(cliPackagePath);
  const cliVersion = yield* readStringField(cliPackage, "version", cliPackagePath);
  const nextVersion =
    trackedTryggVersion === tryggVersion
      ? cliVersion
      : yield* nextCliVersion(cliVersion, tryggVersion);

  yield* writeJsonObject(
    cliPackagePath,
    {
      ...cliPackage,
      version: nextVersion,
      ...(tryggSourceSha === undefined ? {} : { tryggSourceSha }),
    },
    dryRun,
  );

  const wwwPackage = yield* readJsonObject(wwwPackagePath);
  const wwwDependencies = yield* readDependencyMap(wwwPackage, "dependencies", wwwPackagePath);

  yield* writeJsonObject(
    wwwPackagePath,
    {
      ...wwwPackage,
      dependencies: {
        ...wwwDependencies,
        trygg: `^${tryggVersion}`,
      },
    },
    dryRun,
  );

  yield* updateTryggVersionConstant(cliVersionsPath, tryggVersion, dryRun);

  if (writeOutputs) {
    yield* writeGithubOutput("trygg_version", tryggVersion);
    yield* writeGithubOutput("cli_version", nextVersion);
  }

  return {
    tryggVersion,
    cliVersion: nextVersion,
  } satisfies SyncCreateTryggResult;
});

const verifyNpmSource = Effect.fn("verifyNpmSource")(function* (
  packageName: string,
  version: string,
  expectedSha: string,
) {
  const result = yield* npmLookup(packageName, version);
  if (NpmLookupResult.$is("Found")(result)) {
    return yield* validatePackageIdentity(result.metadata, {
      location: "npm",
      name: packageName,
      version,
      gitHead: expectedSha,
    });
  }

  if (NpmLookupResult.$is("NotFound")(result)) {
    return yield* new ReleaseCliError({
      message: `${packageName}@${version} is not published on npm`,
    });
  }

  return yield* new ReleaseCliError({
    message: `Failed to check npm for ${packageName}@${version}`,
    stdout: result.stdout,
    stderr: result.stderr,
    exitCode: result.exitCode,
  });
});

export interface PackedCreateTryggArtifact {
  readonly tarball: string;
  readonly manifest: PackageIdentity;
}

export const readPackedPackageManifest = Effect.fn("readPackedPackageManifest")(function* (
  tarball: string,
) {
  const manifest = yield* runCommand("tar", ["-xOf", tarball, "package/package.json"]);
  return yield* decodePackageIdentityJson(manifest.stdout).pipe(
    Effect.mapError(
      (cause) =>
        new ReleaseCliError({
          message: `Failed to decode packed manifest from ${tarball}`,
          cause,
        }),
    ),
  );
});

export const packCreateTryggArtifact = Effect.fn("packCreateTryggArtifact")(function* (
  sourceSha: string,
  packageVersion: string,
  outputDirectory: string,
) {
  const fs = yield* FileSystem.FileSystem;
  yield* fs.makeDirectory(outputDirectory, { recursive: true }).pipe(
    Effect.mapError(
      (cause) =>
        new ReleaseCliError({
          message: `Failed to create artifact output directory ${outputDirectory}`,
          cause,
        }),
    ),
  );
  const artifactDirectory = yield* fs
    .makeTempDirectory({ directory: outputDirectory, prefix: "create-trygg-artifact-" })
    .pipe(
      Effect.mapError(
        (cause) =>
          new ReleaseCliError({
            message: `Failed to create artifact directory in ${outputDirectory}`,
            cause,
          }),
      ),
    );

  return yield* Effect.scoped(
    Effect.gen(function* () {
      const stagingRoot = yield* fs
        .makeTempDirectoryScoped({ directory: artifactDirectory, prefix: "package-source-" })
        .pipe(
          Effect.mapError(
            (cause) =>
              new ReleaseCliError({
                message: `Failed to create package staging directory in ${artifactDirectory}`,
                cause,
              }),
          ),
        );
      const stagedPackageDirectory = join(stagingRoot, "create-trygg");
      yield* fs.copy(cliPackageDirectory, stagedPackageDirectory).pipe(
        Effect.mapError(
          (cause) =>
            new ReleaseCliError({
              message: `Failed to stage create-trygg in ${stagedPackageDirectory}`,
              cause,
            }),
        ),
      );
      const stagedPackagePath = join(stagedPackageDirectory, "package.json");
      const stagedPackage = yield* readJsonObject(stagedPackagePath);
      yield* writeJsonObject(
        stagedPackagePath,
        {
          ...stagedPackage,
          gitHead: sourceSha,
        },
        false,
      );

      const packCommand = yield* runCommand(
        "npm",
        ["pack", stagedPackageDirectory, "--json", "--pack-destination", artifactDirectory],
        { cwd: workspaceRoot },
      );
      const packResults = yield* decodeNpmPackOutput(packCommand.stdout).pipe(
        Effect.mapError(
          (cause) =>
            new ReleaseCliError({
              message: "Failed to decode npm pack output for create-trygg",
              cause,
            }),
        ),
      );
      const packResult = packResults[0];

      if (packResults.length !== 1 || packResult === undefined) {
        return yield* new ReleaseCliError({
          message: `Expected one create-trygg tarball, received ${packResults.length}`,
        });
      }

      if (packResult.name !== "create-trygg" || packResult.version !== packageVersion) {
        return yield* new ReleaseCliError({
          message: `Unexpected packed package ${packResult.name}@${packResult.version}`,
        });
      }

      const packedFiles = new Set(packResult.files.map((file) => file.path));
      for (const requiredFile of requiredCliArtifactFiles) {
        if (!packedFiles.has(requiredFile)) {
          return yield* new ReleaseCliError({
            message: `Packed create-trygg artifact is missing ${requiredFile}`,
          });
        }
      }
      for (const template of publicTemplates) {
        if (![...packedFiles].some((file) => file.startsWith(`templates/${template}/`))) {
          return yield* new ReleaseCliError({
            message: `Packed create-trygg artifact is missing the ${template} template`,
          });
        }
      }

      const tarball = join(artifactDirectory, packResult.filename);
      if (!(yield* fs.exists(tarball))) {
        return yield* new ReleaseCliError({
          message: `npm pack did not create ${tarball}`,
        });
      }

      const manifest = yield* readPackedPackageManifest(tarball);
      yield* validatePackageIdentity(manifest, {
        location: "packed-artifact",
        name: "create-trygg",
        version: packageVersion,
        gitHead: sourceSha,
      });

      return { tarball, manifest } satisfies PackedCreateTryggArtifact;
    }),
  );
});

const smokePackedCreateTrygg = Effect.fn("smokePackedCreateTrygg")(function* (
  sourceSha: string,
  packageVersion: string,
  tryggVersion: string,
  tryggSourceSha: string,
  outputDirectory: string,
) {
  const actualSha = trimOutput((yield* runCommand("git", ["rev-parse", "HEAD"])).stdout);
  if (actualSha !== sourceSha) {
    return yield* new ReleaseCliError({
      message: `Packed artifact revision mismatch: expected ${sourceSha}, found ${actualSha}`,
    });
  }

  const localVersion = yield* readPackageVersion(cliPackagePath);
  if (localVersion !== packageVersion) {
    return yield* new ReleaseCliError({
      message: `Packed artifact version mismatch: expected ${packageVersion}, found ${localVersion}`,
    });
  }

  yield* verifyNpmSource("trygg", tryggVersion, tryggSourceSha);

  const fs = yield* FileSystem.FileSystem;
  const { manifest, tarball } = yield* packCreateTryggArtifact(
    sourceSha,
    packageVersion,
    outputDirectory,
  );
  const artifactDirectory = dirname(tarball);

  yield* Effect.scoped(
    Effect.gen(function* () {
      const harness = yield* fs
        .makeTempDirectoryScoped({ directory: artifactDirectory, prefix: "installed-" })
        .pipe(
          Effect.mapError(
            (cause) =>
              new ReleaseCliError({
                message: `Failed to create packed artifact harness in ${artifactDirectory}`,
                cause,
              }),
          ),
        );
      yield* overwriteText(
        join(harness, "package.json"),
        `${JSON.stringify({ private: true, type: "module" }, null, 2)}\n`,
      );
      yield* runCommand(
        "npm",
        ["install", "--ignore-scripts", "--no-audit", "--no-fund", tarball],
        { cwd: harness },
      );

      const publishedBin = join(harness, "node_modules", ".bin", "create-trygg");
      for (const template of publicTemplates) {
        const projectName = `packed-${template}`;
        const projectDirectory = join(harness, projectName);
        yield* runCommand(publishedBin, [projectName, "--yes", "--template", template], {
          cwd: harness,
          env: {
            npm_config_user_agent: "bun/release-artifact-smoke",
          },
        });

        const generatedPackagePath = join(projectDirectory, "package.json");
        const generatedPackage = yield* readJsonObject(generatedPackagePath);
        const generatedDependencies = yield* readDependencyMap(
          generatedPackage,
          "dependencies",
          generatedPackagePath,
        );
        const generatedTryggVersion = yield* readStringField(
          generatedDependencies,
          "trygg",
          `${generatedPackagePath} dependencies`,
        );
        if (generatedTryggVersion !== `^${tryggVersion}`) {
          return yield* new ReleaseCliError({
            message: `${template} scaffold expected trygg ^${tryggVersion}, found ${generatedTryggVersion}`,
          });
        }

        yield* runCommand("bun", ["run", "typecheck"], { cwd: projectDirectory });
        yield* runCommand("bun", ["run", "build"], { cwd: projectDirectory });
      }
    }),
  );

  yield* writeGithubOutput("package_tarball", tarball);
  yield* Console.log(
    JSON.stringify({
      packageName: manifest.name,
      packageVersion: manifest.version,
      sourceSha,
      tarball,
      templates: publicTemplates,
    }),
  );

  return tarball;
});

const isNpmNotFound = (stdout: string, stderr: string): boolean => {
  const output = `${stdout}\n${stderr}`;

  return (
    /npm (?:ERR!|error) code E404/i.test(output) ||
    /is not in this registry/.test(output) ||
    /No match found for version/.test(output) ||
    /No match found for/.test(output)
  );
};

const npmLookup = Effect.fn("npmLookup")(function* (packageName: string, version: string) {
  const result = yield* runCommand(
    "npm",
    ["view", `${packageName}@${version}`, "--json", "name", "version", "gitHead"],
    { allowFailure: true },
  );

  if (result.exitCode === 0) {
    const metadata = yield* decodePackageIdentityJson(result.stdout).pipe(
      Effect.mapError(
        (cause) =>
          new ReleaseCliError({
            message: `Failed to decode npm metadata for ${packageName}@${version}`,
            cause,
            stdout: result.stdout,
            stderr: result.stderr,
          }),
      ),
    );
    return NpmLookupResult.Found({ metadata });
  }

  if (isNpmNotFound(result.stdout, result.stderr)) {
    return NpmLookupResult.NotFound();
  }

  return NpmLookupResult.Failed({
    stdout: result.stdout,
    stderr: result.stderr,
    exitCode: result.exitCode,
  });
});

const detectTryggBump = Command.make("detect-trygg-bump", {
  branch: Flag.string("branch"),
  beforeSha: Flag.string("before-sha").pipe(Flag.withDefault("")),
}).pipe(
  Command.withHandler(
    Effect.fnUntraced(function* ({ branch, beforeSha }) {
      const sourceSha = trimOutput((yield* runCommand("git", ["rev-parse", "HEAD"])).stdout);
      yield* writeGithubOutput("source_sha", sourceSha);

      if (branch !== mainBranch) {
        yield* writeShouldRelease(false);
        yield* Console.log(
          JSON.stringify({ shouldRelease: false, branch, reason: "non-main-branch" }),
        );
        return;
      }

      const currentVersion = yield* readPackageVersion(corePackagePath);
      yield* writeGithubOutput("trygg_version", currentVersion);

      if (!semverRegex.test(currentVersion)) {
        return yield* new ReleaseCliError({
          message: `Invalid semver: ${currentVersion}`,
        });
      }

      if (beforeSha === "") {
        const syncResult = yield* syncCreateTrygg(true, false);
        const tryggPublished = yield* npmLookup("trygg", currentVersion);
        const cliPublished = yield* npmLookup("create-trygg", syncResult.cliVersion);

        if (NpmLookupResult.$is("Failed")(tryggPublished)) {
          return yield* new ReleaseCliError({
            message: `Failed to check npm for trygg@${currentVersion}`,
            stdout: tryggPublished.stdout,
            stderr: tryggPublished.stderr,
            exitCode: tryggPublished.exitCode,
          });
        }

        if (NpmLookupResult.$is("Failed")(cliPublished)) {
          return yield* new ReleaseCliError({
            message: `Failed to check npm for create-trygg@${syncResult.cliVersion}`,
            stdout: cliPublished.stdout,
            stderr: cliPublished.stderr,
            exitCode: cliPublished.exitCode,
          });
        }

        const shouldRelease =
          NpmLookupResult.$is("NotFound")(tryggPublished) ||
          NpmLookupResult.$is("NotFound")(cliPublished);

        yield* writeShouldRelease(shouldRelease);
        yield* Console.log(
          JSON.stringify({
            shouldRelease,
            branch,
            mode: "manual",
            tryggVersion: currentVersion,
            cliVersion: syncResult.cliVersion,
          }),
        );
        return;
      }

      if (beforeSha === "0000000000000000000000000000000000000000") {
        yield* writeShouldRelease(false);
        yield* Console.log(JSON.stringify({ shouldRelease: false, tryggVersion: currentVersion }));
        return;
      }

      yield* runCommand("git", ["rev-parse", "--verify", `${beforeSha}^{commit}`]);

      const previousPackageExists = yield* runCommand(
        "git",
        ["cat-file", "-e", `${beforeSha}:packages/core/package.json`],
        {
          allowFailure: true,
        },
      );

      if (previousPackageExists.exitCode !== 0) {
        yield* writeShouldRelease(true);
        yield* Console.log(JSON.stringify({ shouldRelease: true, tryggVersion: currentVersion }));
        return;
      }

      const previousPackage = yield* runCommand("git", [
        "show",
        `${beforeSha}:packages/core/package.json`,
      ]);

      const previousJson = yield* parseJsonObject(
        previousPackage.stdout,
        `git:${beforeSha}:packages/core/package.json`,
      );
      const previousVersion = previousJson["version"];

      if (typeof previousVersion !== "string") {
        return yield* new ReleaseCliError({
          message: `Missing string version in git:${beforeSha}:packages/core/package.json`,
        });
      }

      const shouldRelease = currentVersion !== previousVersion;

      yield* writeShouldRelease(shouldRelease);
      yield* Console.log(JSON.stringify({ shouldRelease, tryggVersion: currentVersion }));
    }),
  ),
);

const syncCreateTryggCommand = Command.make("sync", {
  dryRun: Flag.boolean("dry-run").pipe(Flag.withDefault(false)),
  sourceSha: Flag.string("source-sha"),
  tryggVersion: Flag.string("trygg-version"),
  tryggSourceSha: Flag.string("trygg-source-sha"),
}).pipe(
  Command.withHandler(
    Effect.fnUntraced(function* ({ dryRun, sourceSha, tryggVersion, tryggSourceSha }) {
      yield* verifyPreparedSource(sourceSha, tryggVersion);
      yield* verifyTryggSource(sourceSha, tryggSourceSha, tryggVersion);
      const result = yield* syncCreateTrygg(dryRun, true, tryggVersion, tryggSourceSha);
      yield* Console.log(JSON.stringify(result));
    }),
  ),
);

const commitSync = Command.make("commit-sync", {
  branch: Flag.string("branch"),
  sourceSha: Flag.string("source-sha"),
  tryggVersion: Flag.string("trygg-version"),
}).pipe(
  Command.withHandler(
    Effect.fnUntraced(function* ({ branch, sourceSha, tryggVersion }) {
      yield* verifyPreparedSource(sourceSha, tryggVersion);

      const trackedPaths = [
        "packages/cli/package.json",
        "packages/cli/src/versions.ts",
        "apps/www/package.json",
        "bun.lock",
      ];

      const diff = yield* runCommand("git", ["diff", "--quiet", "--", ...trackedPaths], {
        allowFailure: true,
      });

      if (diff.exitCode > 1) {
        return yield* new ReleaseCliError({
          message: "git diff failed",
          stdout: diff.stdout,
          stderr: diff.stderr,
          exitCode: diff.exitCode,
        });
      }

      if (diff.exitCode === 0) {
        const sha = trimOutput((yield* runCommand("git", ["rev-parse", "HEAD"])).stdout);
        yield* writeGithubOutput("commit_sha", sha);
        yield* Console.log(JSON.stringify({ commitSha: sha, changed: false }));
        return;
      }

      yield* verifyRemoteBranch(branch, sourceSha);
      yield* runCommand("git", ["add", ...trackedPaths]);
      yield* runCommand(
        "git",
        ["commit", "-m", `chore(release): sync create-trygg for trygg v${tryggVersion}`],
        { env: gitIdentity },
      );
      yield* runCommand("git", ["push", "origin", `HEAD:${branch}`]);

      const sha = trimOutput((yield* runCommand("git", ["rev-parse", "HEAD"])).stdout);
      yield* writeGithubOutput("commit_sha", sha);
      yield* Console.log(JSON.stringify({ commitSha: sha, changed: true }));
    }),
  ),
);

const waitForNpmSource = Effect.fn("waitForNpmSource")(function* (
  packageName: string,
  packageVersion: string,
  sourceSha: string,
  attempts: number,
  sleepMs: number,
) {
  for (let attempt = 1; attempt <= attempts; attempt++) {
    const result = yield* npmLookup(packageName, packageVersion);

    if (NpmLookupResult.$is("Found")(result)) {
      yield* validatePackageIdentity(result.metadata, {
        location: "npm",
        name: packageName,
        version: packageVersion,
        gitHead: sourceSha,
      });
      yield* Console.log(
        JSON.stringify({ packageName, version: packageVersion, available: true, attempt }),
      );
      return;
    }

    if (NpmLookupResult.$is("Failed")(result)) {
      return yield* new ReleaseCliError({
        message: `Failed to check npm for ${packageName}@${packageVersion}`,
        stdout: result.stdout,
        stderr: result.stderr,
        exitCode: result.exitCode,
      });
    }

    if (attempt < attempts) {
      yield* Effect.sleep(`${sleepMs} millis`);
    }
  }

  return yield* new ReleaseCliError({
    message: `${packageName}@${packageVersion} not available on npm yet`,
  });
});

const waitForNpm = Command.make("wait-for-npm", {
  packageName: Flag.string("package"),
  packageVersion: Flag.string("package-version"),
  sourceSha: Flag.string("source-sha"),
  attempts: Flag.integer("attempts").pipe(Flag.withDefault(20)),
  sleepMs: Flag.integer("sleep-ms").pipe(Flag.withDefault(15_000)),
}).pipe(
  Command.withHandler(
    Effect.fnUntraced(function* ({ packageName, packageVersion, sourceSha, attempts, sleepMs }) {
      yield* waitForNpmSource(packageName, packageVersion, sourceSha, attempts, sleepMs);
    }),
  ),
);

const smokeCreateTryggArtifact = Command.make("smoke-create-trygg-artifact", {
  sourceSha: Flag.string("source-sha"),
  packageVersion: Flag.string("package-version"),
  tryggVersion: Flag.string("trygg-version"),
  tryggSourceSha: Flag.string("trygg-source-sha"),
  outputDirectory: Flag.string("output-directory"),
}).pipe(
  Command.withHandler(
    Effect.fnUntraced(function* ({
      sourceSha,
      packageVersion,
      tryggVersion,
      tryggSourceSha,
      outputDirectory,
    }) {
      yield* smokePackedCreateTrygg(
        sourceSha,
        packageVersion,
        tryggVersion,
        tryggSourceSha,
        outputDirectory,
      );
    }),
  ),
);

const publishPackage = Command.make("publish-package", {
  packageName: Flag.string("package"),
  packageVersion: Flag.string("package-version"),
  sourceSha: Flag.string("source-sha"),
  cwd: Flag.string("cwd"),
  artifact: Flag.string("artifact").pipe(Flag.optional),
}).pipe(
  Command.withHandler(
    Effect.fnUntraced(function* ({ packageName, packageVersion, sourceSha, cwd, artifact }) {
      const packageJsonPath = join(cwd, "package.json");
      const localPackage = yield* readJsonObject(packageJsonPath);
      const localName = yield* readStringField(localPackage, "name", packageJsonPath);
      const localVersion = yield* readStringField(localPackage, "version", packageJsonPath);

      if (localName !== packageName || localVersion !== packageVersion) {
        return yield* new ReleaseCliError({
          message: `Package mismatch for ${packageJsonPath}: expected ${packageName}@${packageVersion}, found ${localName}@${localVersion}`,
        });
      }

      if (packageName === "create-trygg" && Option.isNone(artifact)) {
        return yield* new ReleaseCliError({
          message: "create-trygg publication requires the packed artifact produced by its smoke",
        });
      }

      if (Option.isSome(artifact)) {
        const manifest = yield* readPackedPackageManifest(artifact.value);
        yield* validatePackageIdentity(manifest, {
          location: "packed-artifact",
          name: packageName,
          version: packageVersion,
          gitHead: sourceSha,
        });
      }

      const published = yield* npmLookup(packageName, packageVersion);

      if (NpmLookupResult.$is("Found")(published)) {
        yield* validatePackageIdentity(published.metadata, {
          location: "npm",
          name: packageName,
          version: packageVersion,
          gitHead: sourceSha,
        });
        yield* writeGithubOutput("published", "false");
        yield* Console.log(
          JSON.stringify({
            packageName,
            version: packageVersion,
            published: false,
            reason: "already-exists",
          }),
        );
        return;
      }

      if (NpmLookupResult.$is("Failed")(published)) {
        return yield* new ReleaseCliError({
          message: `Failed to check npm for ${packageName}@${packageVersion}`,
          stdout: published.stdout,
          stderr: published.stderr,
          exitCode: published.exitCode,
        });
      }

      const distTag = distTagFromVersion(packageVersion);
      const publishTarget = Option.match(artifact, {
        onNone: (): Array<string> => [],
        onSome: (path) => [path],
      });
      const args =
        distTag === undefined
          ? ["publish", ...publishTarget, "--provenance", "--access", "public"]
          : ["publish", ...publishTarget, "--provenance", "--access", "public", "--tag", distTag];

      yield* Effect.tap(
        Effect.tapError(
          runCommand("npm", args, { cwd }).pipe(
            Effect.andThen(
              waitForNpmSource(
                packageName,
                packageVersion,
                sourceSha,
                npmVerificationAttempts,
                npmVerificationSleepMillis,
              ),
            ),
          ),
          () =>
            Effect.gen(function* () {
              yield* writeGithubOutput("published", "false");
              yield* Console.log(
                JSON.stringify({
                  packageName,
                  version: packageVersion,
                  published: false,
                  reason: "publish-failed",
                }),
              );
            }),
        ),
        Effect.gen(function* () {
          yield* writeGithubOutput("published", "true");
          yield* Console.log(
            JSON.stringify({ packageName, version: packageVersion, published: true }),
          );
        }),
      );
    }),
  ),
);

const pushTag = Command.make("push-tag", {
  tag: Flag.string("tag"),
  target: Flag.string("target"),
  message: Flag.string("message"),
}).pipe(
  Command.withHandler(
    Effect.fnUntraced(function* ({ tag, target, message }) {
      const existing = yield* runCommand(
        "git",
        ["ls-remote", "--exit-code", "--tags", "origin", `refs/tags/${tag}`],
        {
          allowFailure: true,
        },
      );

      if (existing.exitCode === 0) {
        yield* Console.log(JSON.stringify({ tag, pushed: false, reason: "already-exists" }));
        return;
      }

      if (existing.exitCode !== 2) {
        return yield* new ReleaseCliError({
          message: `Failed to check existing tag ${tag}`,
          stdout: existing.stdout,
          stderr: existing.stderr,
          exitCode: existing.exitCode,
        });
      }

      yield* runCommand("git", ["tag", "-a", tag, target, "-m", message], { env: gitIdentity });
      yield* runCommand("git", ["push", "origin", tag]);
      yield* Console.log(JSON.stringify({ tag, pushed: true, target }));
    }),
  ),
);

const cli = Command.make("release", {}).pipe(
  Command.withSubcommands([
    detectTryggBump,
    syncCreateTryggCommand,
    commitSync,
    waitForNpm,
    smokeCreateTryggArtifact,
    publishPackage,
    pushTag,
  ]),
);

const main = Command.run(cli, { version: "0.0.0" }).pipe(Effect.provide(NodeServices.layer));

const entrypoint = process.argv[1];
if (entrypoint !== undefined && resolve(entrypoint) === fileURLToPath(import.meta.url)) {
  NodeRuntime.runMain(main);
}
