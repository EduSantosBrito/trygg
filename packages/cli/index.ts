#!/usr/bin/env bun
/**
 * create-trygg CLI
 *
 * Usage: bun create trygg [project-name] [options]
 *        bunx create-trygg [project-name] [options]
 */
import { Argument, Command, Flag } from "effect/unstable/cli";
import pkg from "./package.json";
import { BunRuntime } from "@effect/platform-bun";
import * as BunServices from "@effect/platform-bun/BunServices";
import * as FileSystem from "effect/FileSystem";
import { Effect, Layer, Option } from "effect";
import * as clack from "@clack/prompts";
import * as path from "node:path";
import { isTemplate, promptProjectOptions, type ProjectOptions } from "./src/prompts";
import { scaffoldProject } from "./src/scaffold";
import { detectPackageManager, getInstallCommand, getRunCommand } from "./src/detect-pm";
import { spawn } from "node:child_process";
import { PromptsLive } from "./src/adapters/prompts-live";
import {
  Prompts,
  InvalidProjectNameError,
  InvalidTemplateError,
  DirectoryExistsError,
  InstallFailedError,
} from "./src/ports/prompts";

// =============================================================================
// CLI Definition
// =============================================================================

const projectName = Argument.string("project-name").pipe(
  Argument.withDescription("Name of the project to create"),
  Argument.optional,
);

const templateOption = Flag.string("template").pipe(
  Flag.withDescription("Template to scaffold (default: blank)"),
  Flag.optional,
);

const yesFlag = Flag.boolean("yes").pipe(
  Flag.withAlias("y"),
  Flag.withDescription(
    "Accept all defaults (template: blank, platform: bun, output: server, vcs: git, install: yes)",
  ),
);

const TEMPLATES_DIR = path.join(import.meta.dir, "templates");

const create = Command.make(
  "create-trygg",
  {
    projectName,
    template: templateOption,
    yes: yesFlag,
  },
  (args): Effect.Effect<void, unknown, Prompts | FileSystem.FileSystem> =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const prompts = yield* Prompts;

      clack.intro(`create-trygg v${pkg.version}`);

      // Get project name (args.projectName is Option<string>)
      let name: string;
      if (Option.isSome(args.projectName)) {
        name = args.projectName.value;
      } else {
        name = yield* prompts.text({
          message: "Project name:",
          placeholder: "my-app",
          validate: (value: string) => {
            if (!value) return "Project name is required";
            if (!/^[a-zA-Z0-9-_]+$/.test(value)) {
              return "Use only letters, numbers, hyphens, and underscores";
            }
            return undefined;
          },
        });
      }

      // Validate project name
      if (!/^[a-zA-Z0-9-_]+$/.test(name)) {
        clack.cancel(`Invalid project name "${name}"`);
        return yield* new InvalidProjectNameError({ name });
      }

      const targetDir = path.resolve(process.cwd(), name);

      // Check if directory exists
      const exists = yield* fs.exists(targetDir);
      if (exists) {
        clack.cancel(`Directory "${name}" already exists`);
        return yield* new DirectoryExistsError({ path: targetDir });
      }

      // Gather options
      let options: ProjectOptions;

      // Resolve template from flag or default
      const resolvedTemplateRaw = Option.isSome(args.template) ? args.template.value : "blank";
      if (!isTemplate(resolvedTemplateRaw)) {
        clack.cancel(`Unknown template "${resolvedTemplateRaw}". Available: blank, incident`);
        return yield* new InvalidTemplateError({ template: resolvedTemplateRaw });
      }
      const resolvedTemplate = resolvedTemplateRaw;

      if (args.yes) {
        // Use all defaults
        options = {
          name,
          template: resolvedTemplate,
          platform: "bun",
          output: "server",
          vcs: "git",
          install: true,
        };
        clack.note(
          "Using defaults:\n" +
            `  Template: ${resolvedTemplate}\n` +
            "  Platform: bun\n" +
            "  Output: server (with API)\n" +
            "  VCS: git\n" +
            "  Install: yes",
          "Configuration",
        );
      } else if (Option.isSome(args.template)) {
        // Template from flag, prompt rest
        options = yield* promptProjectOptions(name, resolvedTemplate);
      } else {
        // Fully interactive
        options = yield* promptProjectOptions(name);
      }

      // Scaffold the project
      const spinner = clack.spinner();
      spinner.start("Creating project...");
      yield* scaffoldProject(targetDir, options, TEMPLATES_DIR);
      spinner.stop("Project created");

      // Initialize VCS
      if (options.vcs !== "none") {
        spinner.start(`Initializing ${options.vcs}...`);
        const vcsCommand = options.vcs === "git" ? "git init" : "jj git init";
        yield* Effect.promise(
          () =>
            new Promise<void>((resolve) => {
              const proc = spawn(vcsCommand, { cwd: targetDir, shell: true });
              proc.on("close", (code) => {
                if (code === 0) {
                  spinner.stop(`Initialized ${options.vcs} repository`);
                  resolve();
                } else {
                  spinner.stop(`Failed to initialize ${options.vcs}`);
                  resolve();
                }
              });
            }),
        );
      }

      // Install dependencies
      if (options.install) {
        const pm = yield* detectPackageManager();
        const installCmd = getInstallCommand(pm);

        spinner.start(`Installing dependencies with ${pm}...`);
        yield* Effect.tryPromise({
          try: () =>
            new Promise<void>((resolve, reject) => {
              const proc = spawn(installCmd, { cwd: targetDir, shell: true, stdio: "inherit" });
              proc.on("close", (code) => {
                if (code === 0) {
                  spinner.stop("Dependencies installed");
                  resolve();
                } else {
                  spinner.stop("Failed to install dependencies");
                  reject(new InstallFailedError());
                }
              });
            }),
          catch: () => new InstallFailedError(),
        });
      }

      // Success message
      const pm = yield* detectPackageManager();
      const runCmd = getRunCommand(pm);

      const nextSteps = [];
      nextSteps.push(`cd ${name}`);
      if (!options.install) {
        nextSteps.push(getInstallCommand(pm));
      }
      nextSteps.push(`${runCmd} dev       → http://localhost:5173`);
      nextSteps.push(`${runCmd} build     → dist/`);
      if (options.output === "server") {
        nextSteps.push(`${runCmd} start     → http://localhost:3000`);
      }

      clack.note(nextSteps.join("\n"), "Next steps");
      clack.outro(`Done! Created ${name}`);
    }),
).pipe(Command.withDescription("Create a new trygg project"));

// =============================================================================
// Run
// =============================================================================

const cli = Command.run(create, {
  version: pkg.version,
});

// Application layer with prompts
const AppLayer = Layer.mergeAll(BunServices.layer, PromptsLive);

cli.pipe(Effect.provide(AppLayer), BunRuntime.runMain);
