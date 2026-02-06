#!/usr/bin/env bun
/**
 * create-trygg CLI
 *
 * Usage: bun create trygg [project-name] [options]
 *        bunx create-trygg [project-name] [options]
 */
import { Args, Command, Options } from "@effect/cli";
import pkg from "./package.json";
import { BunContext, BunRuntime } from "@effect/platform-bun";
import { FileSystem } from "@effect/platform";
import { Effect, Layer, Option } from "effect";
import * as clack from "@clack/prompts";
import * as path from "node:path";
import { promptProjectOptions, type ProjectOptions } from "./src/prompts";
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

const projectName = Args.text({ name: "project-name" }).pipe(
  Args.withDescription("Name of the project to create"),
  Args.optional,
);

const templateOption = Options.text("template").pipe(
  Options.withDescription("Template to scaffold (default: incident)"),
  Options.optional,
);

const yesFlag = Options.boolean("yes", { aliases: ["y"] }).pipe(
  Options.withDescription(
    "Accept all defaults (template: incident, platform: bun, output: server, vcs: git, install: yes)",
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
  (args) =>
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
          validate: (value) => {
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
      const resolvedTemplate = Option.isSome(args.template) ? args.template.value : "incident";
      if (resolvedTemplate !== "incident") {
        clack.cancel(`Unknown template "${resolvedTemplate}". Available: incident`);
        return yield* new InvalidTemplateError({ template: resolvedTemplate });
      }

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
        yield* Effect.async<void>((resume) => {
          const proc = spawn(vcsCommand, { cwd: targetDir, shell: true });
          proc.on("close", (code) => {
            if (code === 0) {
              spinner.stop(`Initialized ${options.vcs} repository`);
              resume(Effect.void);
            } else {
              spinner.stop(`Failed to initialize ${options.vcs}`);
              resume(Effect.void);
            }
          });
        });
      }

      // Install dependencies
      if (options.install) {
        const pm = yield* detectPackageManager();
        const installCmd = getInstallCommand(pm);

        spinner.start(`Installing dependencies with ${pm}...`);
        yield* Effect.async<void, InstallFailedError>((resume) => {
          const proc = spawn(installCmd, { cwd: targetDir, shell: true, stdio: "inherit" });
          proc.on("close", (code) => {
            if (code === 0) {
              spinner.stop("Dependencies installed");
              resume(Effect.void);
            } else {
              spinner.stop("Failed to install dependencies");
              resume(Effect.fail(new InstallFailedError()));
            }
          });
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
  name: "create-trygg",
  version: pkg.version,
});

// Application layer with prompts
const AppLayer = Layer.mergeAll(BunContext.layer, PromptsLive);

cli(process.argv).pipe(Effect.provide(AppLayer), BunRuntime.runMain);
