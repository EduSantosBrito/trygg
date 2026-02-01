/**
 * Project scaffolding orchestration
 * @since 1.0.0
 */
import { FileSystem } from "@effect/platform";
import { Effect, Layer } from "effect";
import * as path from "node:path";
import type { ProjectOptions } from "./prompts";
import { generatePackageJson } from "./generators/package-json";
import { generateViteConfig } from "./generators/vite-config";
import { generateTryggConfig } from "./generators/trygg-config";
import { generateTsConfig } from "./generators/tsconfig";
import { generateGitignore } from "./generators/gitignore";
import { PlatformConfig } from "./platform-config";
import { BunPlatformConfig, NodePlatformConfig } from "./platforms";

/**
 * Copy a directory recursively
 */

const copyDir: (
  fs: FileSystem.FileSystem,
  src: string,
  dest: string,
) => Effect.Effect<void, unknown> = Effect.fn("scaffold.copyDir")(function* (fs, src, dest) {
  yield* fs.makeDirectory(dest, { recursive: true });
  const entries = yield* fs.readDirectory(src);

  for (const entry of entries) {
    const srcPath = path.join(src, entry);
    const destPath = path.join(dest, entry);

    const stat = yield* fs.stat(srcPath);
    if (stat.type === "Directory") {
      yield* Effect.suspend(() => copyDir(fs, srcPath, destPath));
    } else {
      yield* fs.copyFile(srcPath, destPath);
    }
  }
});

/**
 * Get the platform configuration layer based on user selection
 */
const getPlatformLayer = (platform: "node" | "bun"): Layer.Layer<PlatformConfig> =>
  platform === "bun" ? BunPlatformConfig : NodePlatformConfig;

/**
 * Scaffold a new effect-ui project
 */
export const scaffoldProject = (targetDir: string, options: ProjectOptions, templatesDir: string) =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;

    // 1. Create target directory
    yield* fs.makeDirectory(targetDir, { recursive: true });

    // 2. Copy base template
    const baseDir = path.join(templatesDir, "base");
    yield* copyDir(fs, baseDir, targetDir);

    // 3. Copy static assets
    const staticDir = path.join(templatesDir, "static");
    yield* copyDir(fs, staticDir, targetDir);

    // 4. Always copy router template (routes are core to effect-ui)
    const routerDir = path.join(templatesDir, "router");
    yield* copyDir(fs, routerDir, targetDir);

    // 5. Always copy API template (needed for Resource examples and type-safe client)
    const apiDir = path.join(templatesDir, "api");
    yield* copyDir(fs, apiDir, targetDir);

    // 6. Generate package.json with platform-specific configuration
    const platformLayer = getPlatformLayer(options.platform);
    const packageJson = yield* generatePackageJson({
      name: options.name,
      output: options.output,
    }).pipe(Effect.provide(platformLayer));
    yield* fs.writeFileString(path.join(targetDir, "package.json"), packageJson);

    // 7. Generate trygg.config.ts
    const tryggConfig = yield* generateTryggConfig({
      platform: options.platform,
      output: options.output,
    });
    yield* fs.writeFileString(path.join(targetDir, "trygg.config.ts"), tryggConfig);

    // 8. Generate vite.config.ts
    const viteConfig = yield* generateViteConfig();
    yield* fs.writeFileString(path.join(targetDir, "vite.config.ts"), viteConfig);

    // 9. Generate tsconfig.json
    const tsconfig = yield* generateTsConfig();
    yield* fs.writeFileString(path.join(targetDir, "tsconfig.json"), tsconfig);

    // 10. Generate .gitignore
    const gitignore = yield* generateGitignore();
    yield* fs.writeFileString(path.join(targetDir, ".gitignore"), gitignore);
  });
