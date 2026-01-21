#!/usr/bin/env bun
/**
 * create-effect-ui CLI
 *
 * Usage: bun create effect-ui my-app
 *        bunx create-effect-ui my-app
 */
import { Args, Command } from "@effect/cli";
import { BunContext, BunRuntime } from "@effect/platform-bun";
import { FileSystem } from "@effect/platform";
import { Console, Effect } from "effect";
import * as path from "node:path";

// =============================================================================
// CLI Definition
// =============================================================================

const projectName = Args.text({ name: "project-name" }).pipe(
  Args.withDescription("Name of the project to create"),
);

const TEMPLATE_DIR = path.join(import.meta.dir, "template");

const create = Command.make("create-effect-ui", { projectName }, ({ projectName }) =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;

    // Validate project name
    if (!/^[a-zA-Z0-9-_]+$/.test(projectName)) {
      yield* Console.error(
        `Error: Invalid project name "${projectName}". Use only letters, numbers, hyphens, and underscores.`,
      );
      return yield* Effect.fail("Invalid project name");
    }

    const targetDir = path.resolve(process.cwd(), projectName);

    // Check if directory exists
    const exists = yield* fs.exists(targetDir);
    if (exists) {
      yield* Console.error(`Error: Directory "${projectName}" already exists.`);
      return yield* Effect.fail("Directory exists");
    }

    yield* Console.log(`Creating effect-ui project in ${targetDir}...`);

    // Copy template recursively
    yield* copyDir(fs, TEMPLATE_DIR, targetDir);

    // Update package.json with project name
    const pkgPath = path.join(targetDir, "package.json");
    const pkgContent = yield* fs.readFileString(pkgPath);
    const pkg = JSON.parse(pkgContent);
    pkg.name = projectName;
    yield* fs.writeFileString(pkgPath, JSON.stringify(pkg, null, 2) + "\n");

    yield* Console.log(`
Done! Your effect-ui project is ready.

Next steps:
  cd ${projectName}
  bun install
  bun run dev

Open http://localhost:5173 in your browser.
`);
  }),
).pipe(Command.withDescription("Create a new effect-ui project"));

// =============================================================================
// Helpers
// =============================================================================

const copyDir = (
  fs: FileSystem.FileSystem,
  src: string,
  dest: string,
): Effect.Effect<void, Error> =>
  Effect.gen(function* () {
    yield* fs.makeDirectory(dest, { recursive: true });
    const entries = yield* fs.readDirectory(src);

    for (const entry of entries) {
      const srcPath = path.join(src, entry);
      const destPath = path.join(dest, entry);

      const stat = yield* fs.stat(srcPath);
      if (stat.type === "Directory") {
        yield* copyDir(fs, srcPath, destPath);
      } else {
        yield* fs.copyFile(srcPath, destPath);
      }
    }
  });

// =============================================================================
// Run
// =============================================================================

const cli = Command.run(create, {
  name: "create-effect-ui",
  version: "0.1.0",
});

cli(process.argv).pipe(Effect.provide(BunContext.layer), BunRuntime.runMain);
