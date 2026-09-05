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
import { Effect, Layer, Option, Predicate } from "effect";
import * as clack from "@clack/prompts";
import * as path from "node:path";
import { isTemplate, promptProjectOptions, type ProjectOptions } from "./src/prompts";
import { scaffoldProject } from "./src/scaffold";
import {
  detectPackageManager,
  getInstallCommand,
  getInstallProcess,
  getRunCommand,
} from "./src/detect-pm";
import { runProcess } from "./src/process";
import * as ProcessGroupPosix from "./src/adapters/process-group-live";
import * as PromptsClack from "./src/adapters/prompts-live";
import {
  Prompts,
  InvalidProjectNameError,
  InvalidTemplateError,
  PromptCancelledError,
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
  (args) =>
    Effect.gen(function* () {
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
      yield* scaffoldProject(targetDir, options, TEMPLATES_DIR).pipe(
        Effect.tapError(() =>
          Effect.sync(() => {
            spinner.stop("Failed to create project");
          }),
        ),
      );
      spinner.stop("Project created");

      // Initialize VCS
      if (options.vcs !== "none") {
        spinner.start(`Initializing ${options.vcs}...`);
        const vcsProcess =
          options.vcs === "git"
            ? { executable: "git", args: ["init"] }
            : { executable: "jj", args: ["git", "init"] };

        yield* runProcess({ ...vcsProcess, cwd: targetDir }).pipe(
          Effect.matchEffect({
            onFailure: (error) =>
              Effect.sync(() => {
                spinner.stop(`Failed to initialize ${options.vcs}`);
                const detail = Predicate.isTagged(error, "ProcessExitError")
                  ? `exit code ${error.exitCode}`
                  : Predicate.isTagged(error, "UnsupportedProcessPlatformError")
                    ? `unsupported platform ${error.platform}`
                    : String(error.cause);
                clack.log.warn(`${options.vcs} initialization skipped: ${detail}`);
              }),
            onSuccess: () =>
              Effect.sync(() => {
                spinner.stop(`Initialized ${options.vcs} repository`);
              }),
          }),
        );
      }

      // Install dependencies
      if (options.install) {
        const pm = yield* detectPackageManager;
        const installProcess = getInstallProcess(pm);

        spinner.start(`Installing dependencies with ${pm}...`);
        yield* runProcess({ ...installProcess, cwd: targetDir }).pipe(
          Effect.tap(() =>
            Effect.sync(() => {
              spinner.stop("Dependencies installed");
            }),
          ),
          Effect.tapError(() =>
            Effect.sync(() => {
              spinner.stop("Failed to install dependencies");
            }),
          ),
        );
      }

      // Success message
      const pm = yield* detectPackageManager;
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
const AppLayer = Layer.mergeAll(BunServices.layer, PromptsClack.layer, ProcessGroupPosix.layer);

cli.pipe(
  Effect.provide(AppLayer),
  Effect.catchTag("PromptCancelledError", () =>
    Effect.sync(() => {
      clack.cancel(PromptCancelledError.default.message);
    }),
  ),
  BunRuntime.runMain,
);
