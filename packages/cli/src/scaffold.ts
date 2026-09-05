/**
 * Project scaffolding orchestration
 * @since 1.0.0
 */
import * as FileSystem from "effect/FileSystem";
import type * as PlatformError from "effect/PlatformError";
import { Effect, Exit, Layer, Predicate } from "effect";
import * as path from "node:path";
import type { ProjectOptions } from "./prompts";
import { DirectoryExistsError, TemplateNotFoundError } from "./ports/prompts";
import { generatePackageJson } from "./generators/package-json";
import { generateViteConfig } from "./generators/vite-config";
import { generateTsConfig } from "./generators/tsconfig";
import { generateGitignore } from "./generators/gitignore";
import { generateOxlintConfig } from "./generators/oxlint-config";
import { generateApiClientTypes } from "./generators/api-client-types";
import { PlatformConfig } from "./platform-config";
import { BunPlatform, NodePlatform } from "./platforms";

/**
 * Copy a directory recursively
 */

const copyDir: (
  fs: FileSystem.FileSystem,
  src: string,
  dest: string,
) => Effect.Effect<void, PlatformError.PlatformError> = Effect.fn("scaffold.copyDir")(
  function* (fs, src, dest) {
    yield* fs.makeDirectory(dest, { recursive: true }).pipe(Effect.uninterruptible);
    const entries = yield* fs.readDirectory(src);

    for (const entry of entries) {
      const srcPath = path.join(src, entry);
      const destPath = path.join(dest, entry);

      const stat = yield* fs.stat(srcPath);
      if (stat.type === "Directory") {
        yield* Effect.suspend(() => copyDir(fs, srcPath, destPath));
      } else {
        yield* fs.copyFile(srcPath, destPath).pipe(Effect.uninterruptible);
      }
    }
  },
);

const cleanupOwnedPath = (fs: FileSystem.FileSystem, ownedPath: string) =>
  fs.remove(ownedPath, { recursive: true, force: true });

const reserveTarget = (fs: FileSystem.FileSystem, targetDir: string) =>
  fs
    .makeDirectory(targetDir)
    .pipe(
      Effect.mapError((error) =>
        Predicate.isTagged(error.reason, "AlreadyExists")
          ? new DirectoryExistsError({ path: targetDir })
          : error,
      ),
    );

/**
 * Publish staged entries into an atomically reserved target directory.
 *
 * `makeDirectory(targetDir)` is the no-replace linearization point: an existing
 * path wins unchanged. After reservation, the visible target is provisional
 * until this effect succeeds. Failure or interruption waits for any active
 * rename to settle, then removes both the target and staging paths before the
 * scaffold effect settles.
 */
const publishStaging = Effect.fn("scaffold.publishStaging")(function* (
  fs: FileSystem.FileSystem,
  stagingDir: string,
  targetDir: string,
) {
  const entries = yield* fs.readDirectory(stagingDir);

  for (const entry of entries) {
    // A native rename callback can settle after cancellation, so cleanup must wait for this mutation.
    yield* fs
      .rename(path.join(stagingDir, entry), path.join(targetDir, entry))
      .pipe(Effect.uninterruptible);
  }

  yield* cleanupOwnedPath(fs, stagingDir).pipe(Effect.uninterruptible);
});

/**
 * Get the platform configuration layer based on user selection
 */
const getPlatformLayer = (platform: "node" | "bun"): Layer.Layer<PlatformConfig> =>
  platform === "bun" ? BunPlatform.layer : NodePlatform.layer;

/**
 * Scaffold a new trygg project from a template in packages/cli/templates/
 *
 * Copies app/, styles.css, public/, and an optional root README.md from the
 * template, then generates config files (package.json, tsconfig, etc.).
 * Native mutations settle before cancellation starts rollback; reads and the
 * boundaries between mutations remain interruptible.
 */
export const scaffoldProject = Effect.fn("Cli.scaffoldProject")(function* (
  targetDir: string,
  options: ProjectOptions,
  templatesDir: string,
) {
  const fs = yield* FileSystem.FileSystem;
  const templateDir = path.join(templatesDir, options.template);

  // 1. Validate template exists
  const templateExists = yield* fs.exists(templateDir);
  if (!templateExists) {
    return yield* new TemplateNotFoundError({ template: options.template, path: templateDir });
  }

  if (yield* fs.exists(targetDir)) {
    return yield* new DirectoryExistsError({ path: targetDir });
  }

  const parentDir = path.dirname(targetDir);
  const targetName = path.basename(targetDir);
  const stagingPrefix = `.${targetName}.create-trygg-`;

  return yield* Effect.acquireUseRelease(
    fs.makeTempDirectory({ directory: parentDir, prefix: stagingPrefix }),
    (stagingDir) =>
      Effect.gen(function* () {
        yield* copyDir(fs, path.join(templateDir, "app"), path.join(stagingDir, "app"));

        const apiFilePath = path.join(templateDir, "app", "api.ts");
        if (yield* fs.exists(apiFilePath)) {
          yield* fs
            .makeDirectory(path.join(stagingDir, ".trygg"), { recursive: true })
            .pipe(Effect.uninterruptible);
          const apiClientTypes = yield* generateApiClientTypes({
            apiTypeImportPath: "../app/api",
          });
          yield* fs
            .writeFileString(path.join(stagingDir, ".trygg", "api.d.ts"), apiClientTypes)
            .pipe(Effect.uninterruptible);
        }

        yield* fs
          .copyFile(path.join(templateDir, "styles.css"), path.join(stagingDir, "styles.css"))
          .pipe(Effect.uninterruptible);
        yield* copyDir(fs, path.join(templateDir, "public"), path.join(stagingDir, "public"));

        const readmePath = path.join(templateDir, "README.md");
        if (yield* fs.exists(readmePath)) {
          yield* fs
            .copyFile(readmePath, path.join(stagingDir, "README.md"))
            .pipe(Effect.uninterruptible);
        }

        const platformLayer = getPlatformLayer(options.platform);
        const packageJson = yield* generatePackageJson({
          name: options.name,
          output: options.output,
        }).pipe(Effect.provide(platformLayer));
        yield* fs
          .writeFileString(path.join(stagingDir, "package.json"), packageJson)
          .pipe(Effect.uninterruptible);

        const viteConfig = yield* generateViteConfig({
          platform: options.platform,
          output: options.output,
        });
        yield* fs
          .writeFileString(path.join(stagingDir, "vite.config.ts"), viteConfig)
          .pipe(Effect.uninterruptible);

        const tsconfig = yield* generateTsConfig;
        yield* fs
          .writeFileString(path.join(stagingDir, "tsconfig.json"), tsconfig)
          .pipe(Effect.uninterruptible);

        const gitignore = yield* generateGitignore;
        yield* fs
          .writeFileString(path.join(stagingDir, ".gitignore"), gitignore)
          .pipe(Effect.uninterruptible);

        const oxlintConfig = yield* generateOxlintConfig;
        yield* fs
          .writeFileString(path.join(stagingDir, ".oxlintrc.json"), oxlintConfig)
          .pipe(Effect.uninterruptible);

        yield* Effect.acquireUseRelease(
          reserveTarget(fs, targetDir),
          () => publishStaging(fs, stagingDir, targetDir),
          (_reservation, exit) =>
            Exit.isSuccess(exit) ? Effect.void : cleanupOwnedPath(fs, targetDir),
        );
      }),
    (ownedPath) => cleanupOwnedPath(fs, ownedPath),
  );
});
