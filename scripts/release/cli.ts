import { fileURLToPath } from "node:url";
import { join } from "node:path";
import { NodeRuntime, NodeServices } from "@effect/platform-node";
import * as Console from "effect/Console";
import * as Data from "effect/Data";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Stream from "effect/Stream";
import * as Command from "effect/unstable/cli/Command";
import * as Flag from "effect/unstable/cli/Flag";
import * as ChildProcess from "effect/unstable/process/ChildProcess";
import * as ChildProcessSpawner from "effect/unstable/process/ChildProcessSpawner";

type JsonObject = Record<string, unknown>;

interface CommandResult {
  readonly stdout: string;
  readonly stderr: string;
  readonly exitCode: number;
}

type NpmLookupResult =
  | { readonly _tag: "Found" }
  | { readonly _tag: "NotFound" }
  | {
    readonly _tag: "Failed";
    readonly stdout: string;
    readonly stderr: string;
    readonly exitCode: number;
  };

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

class ReleaseCliError extends Data.TaggedError("ReleaseCliError")<{
  readonly message: string;
  readonly cause?: unknown;
  readonly stdout?: string;
  readonly stderr?: string;
  readonly exitCode?: number;
}> {}

const root = new URL("../../", import.meta.url);
const corePackagePath = fileURLToPath(new URL("packages/core/package.json", root));
const cliPackagePath = fileURLToPath(new URL("packages/cli/package.json", root));
const cliVersionsPath = fileURLToPath(new URL("packages/cli/src/versions.ts", root));
const wwwPackagePath = fileURLToPath(new URL("apps/www/package.json", root));
const mainBranch = "main";

const gitIdentity = {
  GIT_AUTHOR_NAME: "github-actions[bot]",
  GIT_AUTHOR_EMAIL: "41898282+github-actions[bot]@users.noreply.github.com",
  GIT_COMMITTER_NAME: "github-actions[bot]",
  GIT_COMMITTER_EMAIL: "41898282+github-actions[bot]@users.noreply.github.com",
} as const;

const isJsonObject = (value: unknown): value is JsonObject => typeof value === "object" && value !== null && !Array.isArray(value);

const collectStream = (stream: Stream.Stream<Uint8Array, unknown>) =>
  stream.pipe(
    Stream.decodeText(),
    Stream.mkString,
    Effect.orElseSucceed(() => ""),
  );

const runCommand = Effect.fn("runCommand")(function*(
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
    Effect.gen(function*() {
      const handle = yield* spawner.spawn(
        ChildProcess.make(command, args, {
          cwd: options?.cwd,
          env: options?.env,
          extendEnv: true,
          stdout: "pipe",
          stderr: "pipe",
        }),
      ).pipe(
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
          message: details.length > 0
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

const readText = Effect.fn("readText")(function*(path: string) {
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

const writeText = Effect.fn("writeText")(function*(path: string, text: string) {
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

const writeGithubOutput = Effect.fn("writeGithubOutput")(function*(name: string, value: string) {
  const outputPath = process.env["GITHUB_OUTPUT"];

  if (typeof outputPath !== "string" || outputPath.length === 0) {
    return;
  }

  yield* writeText(outputPath, `${name}=${value}\n`);
});

const writeShouldRelease = Effect.fn("writeShouldRelease")(function*(shouldRelease: boolean) {
  yield* writeGithubOutput("should_release", shouldRelease ? "true" : "false");
});

const parseJsonObject = Effect.fn("parseJsonObject")(function*(text: string, path: string) {
  const parsed = yield* Effect.try({
    try: () => JSON.parse(text),
    catch: (cause) =>
      new ReleaseCliError({
        message: `Failed to parse JSON in ${path}`,
        cause,
      }),
  });

  if (!isJsonObject(parsed)) {
    return yield* new ReleaseCliError({
      message: `Expected JSON object in ${path}`,
    });
  }

  return parsed;
});

const readJsonObject = Effect.fn("readJsonObject")(function*(path: string) {
  const text = yield* readText(path);
  return yield* parseJsonObject(text, path);
});

const readTrackedTryggVersion = Effect.fn("readTrackedTryggVersion")(function*(path: string) {
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

const readStringField = Effect.fn("readStringField")(function*(json: JsonObject, key: string, path: string) {
  const value = json[key];

  if (typeof value !== "string") {
    return yield* new ReleaseCliError({
      message: `Missing string ${key} in ${path}`,
    });
  }

  return value;
});

const readDependencyMap = Effect.fn("readDependencyMap")(function*(json: JsonObject, key: string, path: string) {
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

const overwriteText = Effect.fn("overwriteText")(function*(path: string, text: string) {
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

const writeJsonObject = Effect.fn("writeJsonObject")(function*(path: string, json: JsonObject, dryRun: boolean) {
  if (dryRun) {
    return;
  }

  yield* overwriteText(path, `${JSON.stringify(json, null, 2)}\n`);
});

const readPackageVersion = Effect.fn("readPackageVersion")(function*(path: string) {
  const json = yield* readText(path).pipe(Effect.flatMap((text) => parseJsonObject(text, path)));
  const version = json["version"];

  if (typeof version !== "string") {
    return yield* new ReleaseCliError({
      message: `Missing string version in ${path}`,
    });
  }

  return version;
});

const parseSemver = Effect.fn("parseSemver")(function*(value: string) {
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

const nextCliVersion = Effect.fn("nextCliVersion")(function*(currentCliVersion: string, tryggVersion: string) {
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

const updateTryggVersionConstant = Effect.fn("updateTryggVersionConstant")(function*(path: string, tryggVersion: string, dryRun: boolean) {
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

const syncCreateTrygg = Effect.fn("syncCreateTrygg")(function*(dryRun: boolean, writeOutputs: boolean = true) {
  const tryggPackage = yield* readJsonObject(corePackagePath);
  const tryggVersion = yield* readStringField(tryggPackage, "version", corePackagePath);
  const trackedTryggVersion = yield* readTrackedTryggVersion(cliVersionsPath);

  const cliPackage = yield* readJsonObject(cliPackagePath);
  const cliVersion = yield* readStringField(cliPackage, "version", cliPackagePath);
  const nextVersion = trackedTryggVersion === tryggVersion
    ? cliVersion
    : yield* nextCliVersion(cliVersion, tryggVersion);

  yield* writeJsonObject(
    cliPackagePath,
    {
      ...cliPackage,
      version: nextVersion,
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

const isNpmNotFound = (stdout: string, stderr: string): boolean => {
  const output = `${stdout}\n${stderr}`;

  return /npm ERR! code E404/.test(output) ||
    /is not in this registry/.test(output) ||
    /No match found for version/.test(output) ||
    /No match found for/.test(output);
};

const npmLookup = Effect.fn("npmLookup")(function*(packageName: string, version: string) {
  const result = yield* runCommand("npm", ["view", `${packageName}@${version}`, "version"], { allowFailure: true });

  if (result.exitCode === 0) {
    return { _tag: "Found" } satisfies NpmLookupResult;
  }

  if (isNpmNotFound(result.stdout, result.stderr)) {
    return { _tag: "NotFound" } satisfies NpmLookupResult;
  }

  return {
    _tag: "Failed",
    stdout: result.stdout,
    stderr: result.stderr,
    exitCode: result.exitCode,
  } satisfies NpmLookupResult;
});

const remoteTagExists = Effect.fn("remoteTagExists")(function*(tag: string) {
  const existing = yield* runCommand("git", ["ls-remote", "--exit-code", "--tags", "origin", `refs/tags/${tag}`], {
    allowFailure: true,
  });

  if (existing.exitCode === 0) {
    return true;
  }

  if (existing.exitCode === 2) {
    return false;
  }

  return yield* new ReleaseCliError({
    message: `Failed to check existing tag ${tag}`,
    stdout: existing.stdout,
    stderr: existing.stderr,
    exitCode: existing.exitCode,
  });
});

const detectTryggBump = Command.make("detect-trygg-bump", {
  branch: Flag.string("branch"),
  beforeSha: Flag.string("before-sha").pipe(Flag.withDefault("")),
}).pipe(
  Command.withHandler(Effect.fnUntraced(function*({ branch, beforeSha }) {
    if (branch !== mainBranch) {
      yield* writeShouldRelease(false);
      yield* Console.log(JSON.stringify({ shouldRelease: false, branch, reason: "non-main-branch" }));
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

      if (tryggPublished._tag === "Failed") {
        return yield* new ReleaseCliError({
          message: `Failed to check npm for trygg@${currentVersion}`,
          stdout: tryggPublished.stdout,
          stderr: tryggPublished.stderr,
          exitCode: tryggPublished.exitCode,
        });
      }

      if (cliPublished._tag === "Failed") {
        return yield* new ReleaseCliError({
          message: `Failed to check npm for create-trygg@${syncResult.cliVersion}`,
          stdout: cliPublished.stdout,
          stderr: cliPublished.stderr,
          exitCode: cliPublished.exitCode,
        });
      }

      const shouldRelease = tryggPublished._tag === "NotFound" || cliPublished._tag === "NotFound";

      yield* writeShouldRelease(shouldRelease);
      yield* Console.log(JSON.stringify({
        shouldRelease,
        branch,
        mode: "manual",
        tryggVersion: currentVersion,
        cliVersion: syncResult.cliVersion,
      }));
      return;
    }

    if (beforeSha === "0000000000000000000000000000000000000000") {
      yield* writeShouldRelease(false);
      yield* Console.log(JSON.stringify({ shouldRelease: false, tryggVersion: currentVersion }));
      return;
    }

    yield* runCommand("git", ["rev-parse", "--verify", `${beforeSha}^{commit}`]);

    const previousPackageExists = yield* runCommand("git", ["cat-file", "-e", `${beforeSha}:packages/core/package.json`], {
      allowFailure: true,
    });

    if (previousPackageExists.exitCode !== 0) {
      yield* writeShouldRelease(true);
      yield* Console.log(JSON.stringify({ shouldRelease: true, tryggVersion: currentVersion }));
      return;
    }

    const previousPackage = yield* runCommand("git", ["show", `${beforeSha}:packages/core/package.json`]);

    const previousJson = yield* parseJsonObject(previousPackage.stdout, `git:${beforeSha}:packages/core/package.json`);
    const previousVersion = previousJson["version"];

    if (typeof previousVersion !== "string") {
      return yield* new ReleaseCliError({
        message: `Missing string version in git:${beforeSha}:packages/core/package.json`,
      });
    }

    const shouldRelease = currentVersion !== previousVersion;

    yield* writeShouldRelease(shouldRelease);
    yield* Console.log(JSON.stringify({ shouldRelease, tryggVersion: currentVersion }));
  })),
);

const syncCreateTryggCommand = Command.make("sync", {
  dryRun: Flag.boolean("dry-run").pipe(Flag.withDefault(false)),
}).pipe(
  Command.withHandler(Effect.fnUntraced(function*({ dryRun }) {
    const result = yield* syncCreateTrygg(dryRun);
    yield* Console.log(JSON.stringify(result));
  })),
);

const commitSync = Command.make("commit-sync", {
  branch: Flag.string("branch"),
  tryggVersion: Flag.string("trygg-version"),
}).pipe(
  Command.withHandler(Effect.fnUntraced(function*({ branch, tryggVersion }) {
    const trackedPaths = [
      "packages/cli/package.json",
      "packages/cli/src/versions.ts",
      "apps/www/package.json",
      "bun.lock",
    ] as const;

    const diff = yield* runCommand("git", ["diff", "--quiet", "--", ...trackedPaths], { allowFailure: true });

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
  })),
);

const waitForNpm = Command.make("wait-for-npm", {
  packageName: Flag.string("package"),
  packageVersion: Flag.string("package-version"),
  attempts: Flag.integer("attempts").pipe(Flag.withDefault(20)),
  sleepMs: Flag.integer("sleep-ms").pipe(Flag.withDefault(15_000)),
}).pipe(
  Command.withHandler(Effect.fnUntraced(function*({ packageName, packageVersion, attempts, sleepMs }) {
    for (let attempt = 1; attempt <= attempts; attempt++) {
      const result = yield* npmLookup(packageName, packageVersion);

      if (result._tag === "Found") {
        yield* Console.log(JSON.stringify({ packageName, version: packageVersion, available: true, attempt }));
        return;
      }

      if (result._tag === "Failed") {
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
  })),
);

const publishPackage = Command.make("publish-package", {
  packageName: Flag.string("package"),
  packageVersion: Flag.string("package-version"),
  cwd: Flag.string("cwd"),
}).pipe(
  Command.withHandler(Effect.fnUntraced(function*({ packageName, packageVersion, cwd }) {
    const packageJsonPath = join(cwd, "package.json");
    const localVersion = yield* readPackageVersion(packageJsonPath);

    if (localVersion !== packageVersion) {
      return yield* new ReleaseCliError({
        message: `Version mismatch for ${packageJsonPath}: expected ${packageVersion}, found ${localVersion}`,
      });
    }

    const published = yield* npmLookup(packageName, packageVersion);

    if (published._tag === "Found") {
      yield* writeGithubOutput("published", "false");
      yield* Console.log(JSON.stringify({ packageName, version: packageVersion, published: false, reason: "already-exists" }));
      return;
    }

    if (published._tag === "Failed") {
      return yield* new ReleaseCliError({
        message: `Failed to check npm for ${packageName}@${packageVersion}`,
        stdout: published.stdout,
        stderr: published.stderr,
        exitCode: published.exitCode,
      });
    }

    const distTag = distTagFromVersion(packageVersion);
    const args = distTag === undefined
      ? ["publish", "--provenance", "--access", "public"]
      : ["publish", "--provenance", "--access", "public", "--tag", distTag];

    yield* Effect.tap(
      Effect.tapError(runCommand("npm", args, { cwd }), () =>
        Effect.gen(function* () {
          yield* writeGithubOutput("published", "false");
          yield* Console.log(
            JSON.stringify({ packageName, version: packageVersion, published: false, reason: "publish-failed" }),
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
  })),
);

const pushTag = Command.make("push-tag", {
  tag: Flag.string("tag"),
  target: Flag.string("target"),
  message: Flag.string("message"),
}).pipe(
  Command.withHandler(Effect.fnUntraced(function*({ tag, target, message }) {
    const existing = yield* runCommand("git", ["ls-remote", "--exit-code", "--tags", "origin", `refs/tags/${tag}`], {
      allowFailure: true,
    });

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
  })),
);

const cli = Command.make("release", {}).pipe(
  Command.withSubcommands([
    detectTryggBump,
    syncCreateTryggCommand,
    commitSync,
    waitForNpm,
    publishPackage,
    pushTag,
  ]),
);

const main = Command.run(cli, { version: "0.0.0" }).pipe(Effect.provide(NodeServices.layer));

NodeRuntime.runMain(main);
