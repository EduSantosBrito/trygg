import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { tmpdir } from "node:os";
import { basename, dirname, join } from "node:path";
import { NodeRuntime, NodeServices } from "@effect/platform-node";
import * as sandcastle from "@ai-hero/sandcastle";
import type { AgentProvider } from "@ai-hero/sandcastle";
import { docker } from "@ai-hero/sandcastle/sandboxes/docker";
import * as Console from "effect/Console";
import * as Data from "effect/Data";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";

const outerIterations = 10;
const agentIterations = 100;
const completionSignal = "<promise>COMPLETE</promise>";
const dockerImageName = "sandcastle:trygg";
const dockerfileHashLabel = "trygg.sandcastle.dockerfile-sha256";
const dockerfile = join(process.cwd(), ".sandcastle", "Dockerfile");
const jjRepoDir = join(process.cwd(), ".jj");
const completedDir = join(process.cwd(), ".sandcastle", "completed");
const implementPromptFile = ".sandcastle/implement-prompt.md";
const reviewPromptFile = ".sandcastle/review-prompt.md";
const mergePromptFile = ".sandcastle/merge-prompt.md";
const hostOpenCodeShareDir = join(process.env.HOME ?? "", ".local", "share", "opencode");
const hostOpenCodeConfigDir = join(process.env.HOME ?? "", ".config", "opencode");
const issueFilePattern = /^(\d{2,3})-.+\.md$/;
const markdownFilePattern = /^.+\.md$/;
const localPrdRoot = join(process.cwd(), "prds");
const localIssueRoot = join(process.cwd(), "issues");
const issueRootCandidates = [join(process.cwd(), "issues"), join(process.cwd(), ".plans")];
const useLocalSources = process.argv.includes("--local");
const planPromptFile = useLocalSources
  ? ".sandcastle/plan-prompt-local.md"
  : ".sandcastle/plan-prompt-default.md";

type Issue = {
  readonly id: string;
  readonly title: string;
  readonly file: string;
  readonly body: string;
};

type IssueFile = {
  readonly id: string;
  readonly file: string;
};

type Prd = {
  readonly title: string;
  readonly file: string;
  readonly body: string;
};

type GitHubIssue = {
  readonly number: number;
  readonly title: string;
  readonly body: string;
};

type OpenCodeState = {
  readonly root: string;
  readonly shareDir: string;
  readonly configDir: string;
};

type Vcs =
  | {
      readonly type: "jj";
    }
  | {
      readonly type: "git";
    };

class SandcastleError extends Data.TaggedError("SandcastleError")<{
  readonly message: string;
  readonly cause?: unknown;
}> {}

const mapPlatformError = (message: string) => (cause: unknown) =>
  new SandcastleError({ message, cause });

const shellEscape = (value: string) => `'${value.replace(/'/g, "'\\''")}'`;

const sandboxedOpenCode = (model: string): AgentProvider => ({
  name: "opencode",
  env: {},
  captureSessions: false,
  buildPrintCommand: ({ prompt }) => ({
    command: `opencode run --dangerously-skip-permissions --model ${shellEscape(model)} ${shellEscape(prompt)}`,
  }),
  buildInteractiveArgs: ({ prompt }) => {
    const args = ["opencode", "--dangerously-skip-permissions", "--model", model];
    if (prompt.length > 0) args.push("-p", prompt);
    return args;
  },
  parseStreamLine: () => [],
});

const command = (
  binary: string,
  args: ReadonlyArray<string>,
): Effect.Effect<string, SandcastleError> =>
  Effect.tryPromise({
    try: (signal) =>
      new Promise<string>((resolve, reject) => {
        const child = execFile(
          binary,
          [...args],
          { cwd: process.cwd(), encoding: "utf8", maxBuffer: 10 * 1024 * 1024 },
          (error, stdout, stderr) => {
            if (error !== null) {
              reject(stderr.trim().length > 0 ? stderr.trim() : error);
              return;
            }

            resolve(stdout.trim());
          },
        );

        signal.addEventListener("abort", () => child.kill(), { once: true });
      }),
    catch: (cause) => new SandcastleError({ message: `${binary} ${args.join(" ")} failed`, cause }),
  });

const pathExists = Effect.fn("pathExists")(function* (path: string) {
  const fs = yield* FileSystem.FileSystem;
  return yield* fs.exists(path).pipe(Effect.mapError(mapPlatformError(`Failed to check ${path}`)));
});

const git = (args: ReadonlyArray<string>) => command("git", args);

const jj = (args: ReadonlyArray<string>) => command("jj", args);

const detectVcs = Effect.fn("detectVcs")(function* () {
  const isJjRepo = yield* pathExists(jjRepoDir);
  if (!isJjRepo) return { type: "git" } satisfies Vcs;

  yield* jj(["--version"]);
  return { type: "jj" } satisfies Vcs;
});

const syncJjFromGit = (vcs: Vcs) =>
  vcs.type === "jj" ? jj(["git", "import"]).pipe(Effect.asVoid) : Effect.void;

const syncJjToGit = (vcs: Vcs) =>
  vcs.type === "jj" ? jj(["git", "export"]).pipe(Effect.asVoid) : Effect.void;

const vcsInstructions = (vcs: Vcs) =>
  vcs.type === "jj"
    ? [
        "This host repository is jj-managed (`.jj/` exists).",
        "Prefer `jj` commands whenever `.jj/` exists in your working directory.",
        "If the Sandcastle worktree has no `.jj/`, it is a Git-backed compatibility worktree; use Git there.",
        "When using Git in that compatibility worktree, keep the branch `{{BRANCH}}` updated with normal commits.",
      ].join("\n")
    : "This repository is Git-managed. Use Git commands.";

const reviewCommands = (vcs: Vcs) =>
  vcs.type === "jj"
    ? [
        "- If `.jj/` exists: `jj diff --from 'roots(immutable_heads()..@)' --to @`",
        "- If `.jj/` exists: `jj status`",
        "- Otherwise: `git diff HEAD~1..HEAD`",
        "- Otherwise: `git status --short`",
      ].join("\n")
    : ["- `git diff HEAD~1..HEAD`", "- `git status --short`"].join("\n");

const sourceInstructions = () =>
  useLocalSources
    ? [
        "Issue source mode: local.",
        "Use only `./issues` for implementation tasks.",
        "Use `./prds` only as product context for the selected issue.",
        "Do not fetch remote issue trackers or infer work from external tickets.",
      ].join("\n")
    : [
        "Issue source mode: default.",
        "Use the issue body provided below as the source of truth.",
        "If the issue file is a tracker reference like `#123`, treat it as an already-loaded remote issue.",
        "If the issue file is a local markdown path, treat that file as the source of truth.",
      ].join("\n");

const mergeSteps = (vcs: Vcs) =>
  vcs.type === "jj"
    ? [
        "- If `.jj/` exists, run `jj git import`, then merge with `jj new @ {{BRANCH}}`.",
        "- If there are conflicts, resolve them correctly by reading both sides, then run `jj resolve` as needed.",
        "- Run relevant tests/build, usually `bun run typecheck` and targeted tests.",
        "- If tests fail, fix them before finishing.",
        "- Describe the merge change with a concise conventional message if needed.",
        "- Leave the issue bookmark `{{BRANCH}}` on the implementation commit; do not move it to the merge commit.",
        "- Run `jj git export` after the merge is complete.",
        "- If `.jj/` does not exist, run `git merge {{BRANCH}} --no-edit` instead.",
        "- Do not modify `.sandcastle`.",
        "- When complete, output {{COMPLETION_SIGNAL}}.",
      ].join("\n")
    : [
        "- Run `git merge {{BRANCH}} --no-edit`.",
        "- If there are conflicts, resolve them correctly by reading both sides.",
        "- Run relevant tests/build, usually `bun run typecheck` and targeted tests.",
        "- If tests fail, fix them before finishing.",
        "- Commit the completed merge if Git requires a commit.",
        "- Do not modify `.sandcastle`.",
        "- When complete, output {{COMPLETION_SIGNAL}}.",
      ].join("\n");

const dockerImageLabel = (label: string) =>
  command("docker", [
    "image",
    "inspect",
    "--format",
    `{{ index .Config.Labels "${label}" }}`,
    dockerImageName,
  ]).pipe(
    Effect.map((value) => (value.length > 0 && value !== "<no value>" ? value : undefined)),
    Effect.catchTag("SandcastleError", () => Effect.succeed(undefined)),
  );

const ensureDockerImage = Effect.fn("ensureDockerImage")(function* () {
  const fs = yield* FileSystem.FileSystem;
  const dockerfileExists = yield* pathExists(dockerfile);
  if (!dockerfileExists) {
    return yield* new SandcastleError({
      message: `Missing ${dockerfile}; cannot build ${dockerImageName}`,
    });
  }

  const dockerfileText = yield* fs
    .readFileString(dockerfile)
    .pipe(Effect.mapError(mapPlatformError("Failed to read Dockerfile")));
  const dockerfileHash = createHash("sha256").update(dockerfileText).digest("hex");

  const currentLabel = yield* dockerImageLabel(dockerfileHashLabel);
  if (currentLabel === dockerfileHash) return;

  yield* Console.log(`Building Docker image ${dockerImageName}...`);
  yield* command("docker", [
    "build",
    "--label",
    `${dockerfileHashLabel}=${dockerfileHash}`,
    "-t",
    dockerImageName,
    "-f",
    dockerfile,
    process.cwd(),
  ]).pipe(Effect.asVoid);
});

const findIssueRoot = Effect.fn("findIssueRoot")(function* () {
  for (const candidate of issueRootCandidates) {
    const exists = yield* pathExists(candidate);
    if (exists) return candidate;
  }

  return undefined;
});

const parseIssueFile = (file: string): IssueFile | undefined => {
  const match = issueFilePattern.exec(file);
  const id = match?.at(1);

  return id === undefined ? undefined : { id, file };
};

const titleFromMarkdown = (file: string, body: string) => {
  const heading = body.split("\n").find((line) => line.startsWith("# "));
  const fallbackTitle = basename(file, ".md").replace(/^\d{2,3}-/, "");

  return heading?.replace(/^#\s+(?:\d{2,3}:\s*)?/, "").trim() || fallbackTitle;
};

const prdContext = (prds: ReadonlyArray<Prd>) =>
  prds.length === 0
    ? ""
    : [
        "# LOCAL PRD CONTEXT",
        "",
        "Use these local PRDs as product context. Implement only the selected issue below.",
        "",
        ...prds.map((prd) => [`## ${prd.file}: ${prd.title}`, "", prd.body].join("\n")),
        "",
        "# SELECTED ISSUE",
        "",
      ].join("\n");

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const parseGitHubIssue = (value: unknown): GitHubIssue | undefined => {
  if (!isRecord(value)) return undefined;

  const number = value["number"];
  const title = value["title"];
  const body = value["body"];

  if (typeof number !== "number") return undefined;
  if (typeof title !== "string") return undefined;
  if (typeof body !== "string") return undefined;

  return { number, title, body };
};

const parseGitHubIssues = Effect.fn("parseGitHubIssues")(function* (text: string) {
  const parsed = yield* Effect.try({
    try: () => JSON.parse(text),
    catch: (cause) => new SandcastleError({ message: "Failed to parse GitHub issues JSON", cause }),
  });

  if (!Array.isArray(parsed)) {
    return yield* new SandcastleError({ message: "Expected GitHub issues JSON array" });
  }

  return parsed.flatMap((value) => {
    const issue = parseGitHubIssue(value);
    return issue === undefined ? [] : [issue];
  });
});

const blockedByOpenIssue = (issue: GitHubIssue, openIssueNumbers: ReadonlySet<number>): boolean => {
  const matches = issue.body.matchAll(/Blocked by #(\d+)/g);

  for (const match of matches) {
    const numberText = match.at(1);
    if (numberText === undefined) continue;

    const number = Number.parseInt(numberText, 10);
    if (openIssueNumbers.has(number)) return true;
  }

  return false;
};

const loadGitHubIssues = Effect.fn("loadGitHubIssues")(function* () {
  const text = yield* command("gh", [
    "issue",
    "list",
    "--state",
    "open",
    "--label",
    "Sandcastle",
    "--limit",
    "100",
    "--json",
    "number,title,body",
  ]);
  const issues = yield* parseGitHubIssues(text);
  const openIssueNumbers = new Set(issues.map((issue) => issue.number));

  return issues
    .filter((issue) => !blockedByOpenIssue(issue, openIssueNumbers))
    .toSorted((left, right) => left.number - right.number)
    .map(
      (issue) =>
        ({
          id: String(issue.number),
          title: issue.title,
          file: `#${issue.number}`,
          body: issue.body,
        }) satisfies Issue,
    );
});

const loadLocalPrds = Effect.fn("loadLocalPrds")(function* () {
  const fs = yield* FileSystem.FileSystem;
  const exists = yield* pathExists(localPrdRoot);
  if (!exists) return [] satisfies ReadonlyArray<Prd>;

  const files = yield* fs
    .readDirectory(localPrdRoot)
    .pipe(Effect.mapError(mapPlatformError(`Failed to read ${localPrdRoot}`)));

  return yield* Effect.forEach(
    files
      .filter((file) => markdownFilePattern.test(file))
      .toSorted((left, right) => left.localeCompare(right)),
    (file) =>
      Effect.gen(function* () {
        const body = yield* fs
          .readFileString(join(localPrdRoot, file))
          .pipe(Effect.mapError(mapPlatformError(`Failed to read ${file}`)));

        return { title: titleFromMarkdown(file, body), file, body } satisfies Prd;
      }),
  );
});

const loadLocalIssues = Effect.fn("loadLocalIssues")(function* () {
  const fs = yield* FileSystem.FileSystem;
  const exists = yield* pathExists(localIssueRoot);
  if (!exists) {
    return yield* new SandcastleError({ message: `--local requires ${localIssueRoot}` });
  }

  const prds = yield* loadLocalPrds();
  const context = prdContext(prds);
  const files = yield* fs
    .readDirectory(localIssueRoot)
    .pipe(Effect.mapError(mapPlatformError(`Failed to read ${localIssueRoot}`)));

  const issues = yield* Effect.forEach(
    files
      .flatMap((file) => {
        const issueFile = parseIssueFile(file);
        return issueFile === undefined ? [] : [issueFile];
      })
      .toSorted((left, right) => left.file.localeCompare(right.file)),
    ({ id, file }) =>
      Effect.gen(function* () {
        const body = yield* fs
          .readFileString(join(localIssueRoot, file))
          .pipe(Effect.mapError(mapPlatformError(`Failed to read ${file}`)));

        return {
          id,
          title: titleFromMarkdown(file, body),
          file,
          body: `${context}${body}`,
        } satisfies Issue;
      }),
  );

  if (issues.length === 0) {
    return yield* new SandcastleError({ message: `No issue files found in ${localIssueRoot}` });
  }

  return issues;
});

const loadIssues = Effect.fn("loadIssues")(function* () {
  if (useLocalSources) return yield* loadLocalIssues();

  const fs = yield* FileSystem.FileSystem;
  const issueRoot = yield* findIssueRoot();
  if (issueRoot === undefined) return yield* loadGitHubIssues();

  const files = yield* fs
    .readDirectory(issueRoot)
    .pipe(Effect.mapError(mapPlatformError(`Failed to read ${issueRoot}`)));

  return yield* Effect.forEach(
    files
      .flatMap((file) => {
        const issueFile = parseIssueFile(file);
        return issueFile === undefined ? [] : [issueFile];
      })
      .toSorted((left, right) => left.file.localeCompare(right.file)),
    ({ id, file }) =>
      Effect.gen(function* () {
        const body = yield* fs
          .readFileString(join(issueRoot, file))
          .pipe(Effect.mapError(mapPlatformError(`Failed to read ${file}`)));

        return { id, title: titleFromMarkdown(file, body), file, body } satisfies Issue;
      }),
  );
});

const completionMarker = (issue: Issue) => join(completedDir, issue.id);

const isIssueComplete = (issue: Issue) => pathExists(completionMarker(issue));

const markIssueComplete = (issue: Issue) =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    yield* fs
      .makeDirectory(completedDir, { recursive: true })
      .pipe(Effect.mapError(mapPlatformError(`Failed to create ${completedDir}`)));
    yield* fs
      .writeFileString(completionMarker(issue), `${issue.file}\n`)
      .pipe(Effect.mapError(mapPlatformError(`Failed to mark issue ${issue.id} complete`)));
  });

const isMergedIntoHead = (branch: string, vcs: Vcs) =>
  vcs.type === "jj"
    ? syncJjFromGit(vcs).pipe(
        Effect.andThen(() =>
          jj(["log", "-r", `heads(::@ & ::${branch})`, "--no-graph", "-T", "change_id.short()"]),
        ),
        Effect.map((output) => output.trim().length > 0),
        Effect.catchTag("SandcastleError", () => Effect.succeed(false)),
      )
    : git(["merge-base", "--is-ancestor", branch, "HEAD"]).pipe(
        Effect.as(true),
        Effect.catchTag("SandcastleError", () => Effect.succeed(false)),
      );

const createOpenCodeState = Effect.fn("createOpenCodeState")(function* () {
  const fs = yield* FileSystem.FileSystem;
  const root = yield* fs
    .makeTempDirectory({ directory: tmpdir(), prefix: "trygg-opencode-" })
    .pipe(Effect.mapError(mapPlatformError("Failed to create OpenCode sandbox state")));
  const shareDir = join(root, "share", "opencode");
  const configDir = join(root, "config", "opencode");

  yield* fs
    .makeDirectory(shareDir, { recursive: true })
    .pipe(Effect.mapError(mapPlatformError(`Failed to create ${shareDir}`)));
  yield* fs
    .makeDirectory(configDir, { recursive: true })
    .pipe(Effect.mapError(mapPlatformError(`Failed to create ${configDir}`)));

  for (const file of ["auth.json", "mcp-auth.json"]) {
    const source = join(hostOpenCodeShareDir, file);
    const exists = yield* pathExists(source);
    if (exists) {
      yield* fs
        .copyFile(source, join(shareDir, file))
        .pipe(Effect.mapError(mapPlatformError(`Failed to copy ${source}`)));
    }
  }

  const configExists = yield* pathExists(hostOpenCodeConfigDir);
  if (configExists) yield* copyOpenCodeConfig(hostOpenCodeConfigDir, configDir);

  return { root, shareDir, configDir } satisfies OpenCodeState;
});

const cleanupOpenCodeState = (state: OpenCodeState) =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    yield* fs
      .remove(state.root, { recursive: true, force: true })
      .pipe(Effect.orElseSucceed(() => undefined));
  });

const copyOpenCodeConfig: (
  sourceDir: string,
  targetDir: string,
) => Effect.Effect<void, SandcastleError, FileSystem.FileSystem> = Effect.fn("copyOpenCodeConfig")(
  function* (sourceDir: string, targetDir: string) {
    const fs = yield* FileSystem.FileSystem;
    const entries = yield* fs
      .readDirectory(sourceDir)
      .pipe(Effect.mapError(mapPlatformError(`Failed to read ${sourceDir}`)));

    for (const entry of entries) {
      if (entry === "node_modules") continue;

      const source = join(sourceDir, entry);
      const target = join(targetDir, entry);
      const stat = yield* fs
        .stat(source)
        .pipe(Effect.mapError(mapPlatformError(`Failed to stat ${source}`)));
      if (stat.type === "Directory") {
        yield* fs
          .makeDirectory(target, { recursive: true })
          .pipe(Effect.mapError(mapPlatformError(`Failed to create ${target}`)));
        yield* copyOpenCodeConfig(source, target);
      } else if (stat.type === "File") {
        yield* fs
          .makeDirectory(dirname(target), { recursive: true })
          .pipe(Effect.mapError(mapPlatformError(`Failed to create ${dirname(target)}`)));
        yield* fs
          .copyFile(source, target)
          .pipe(Effect.mapError(mapPlatformError(`Failed to copy ${source}`)));
      }
    }
  },
);

const slugFor = (issue: Issue) =>
  issue.title
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");

const nextIssue = Effect.fn("nextIssue")(function* () {
  const issues = yield* loadIssues();

  for (const issue of issues) {
    const complete = yield* isIssueComplete(issue);
    if (!complete) return issue;
  }

  return undefined;
});

const runAgent = (options: Parameters<typeof sandcastle.run>[0]) =>
  Effect.tryPromise({
    try: () => sandcastle.run(options),
    catch: (cause) =>
      new SandcastleError({ message: `Sandcastle run failed: ${options.name ?? "agent"}`, cause }),
  });

const program = Effect.gen(function* () {
  const agent = sandboxedOpenCode("openai/gpt-5.5");
  const vcs = yield* detectVcs();

  yield* Effect.acquireUseRelease(
    createOpenCodeState(),
    (state) =>
      Effect.gen(function* () {
        const sandbox = docker({
          imageName: dockerImageName,
          mounts: [
            {
              hostPath: state.shareDir,
              sandboxPath: "/home/agent/.local/share/opencode",
            },
            {
              hostPath: state.configDir,
              sandboxPath: "/home/agent/.config/opencode",
            },
          ],
        });

        for (let iteration = 1; iteration <= outerIterations; iteration += 1) {
          yield* Console.log(`\n=== Sandcastle iteration ${iteration}/${outerIterations} ===\n`);

          const issue = yield* nextIssue();
          if (issue === undefined) {
            yield* Console.log("No remaining issues.");
            return;
          }

          yield* ensureDockerImage();

          const branch = `sandcastle/issue-${issue.id}-${slugFor(issue)}`;

          yield* syncJjToGit(vcs);

          const implementation = yield* runAgent({
            agent,
            sandbox,
            name: "implementer",
            branchStrategy: { type: "branch", branch },
            promptFile: implementPromptFile,
            promptArgs: {
              ISSUE_FILE: issue.file,
              ISSUE_BODY: issue.body,
              ISSUE_TITLE: issue.title,
              BRANCH: branch,
              SOURCE_INSTRUCTIONS: sourceInstructions(),
              VCS_INSTRUCTIONS: vcsInstructions(vcs).replaceAll("{{BRANCH}}", branch),
              COMPLETION_SIGNAL: completionSignal,
            },
            maxIterations: agentIterations,
            completionSignal,
          });

          yield* Console.log(`${issue.id}: ${issue.title} -> ${branch}`);

          if (implementation.commits.length > 0) {
            yield* runAgent({
              agent,
              sandbox,
              name: "reviewer",
              branchStrategy: { type: "branch", branch },
              promptFile: reviewPromptFile,
              promptArgs: {
                ISSUE_FILE: issue.file,
                ISSUE_BODY: issue.body,
                ISSUE_TITLE: issue.title,
                BRANCH: branch,
                SOURCE_INSTRUCTIONS: sourceInstructions(),
                VCS_INSTRUCTIONS: vcsInstructions(vcs).replaceAll("{{BRANCH}}", branch),
                REVIEW_COMMANDS: reviewCommands(vcs),
                COMPLETION_SIGNAL: completionSignal,
              },
              maxIterations: agentIterations,
              completionSignal,
            });
          }

          yield* runAgent({
            agent,
            sandbox,
            name: "merger",
            promptFile: mergePromptFile,
            promptArgs: {
              ISSUE_FILE: issue.file,
              ISSUE_BODY: issue.body,
              BRANCH: branch,
              SOURCE_INSTRUCTIONS: sourceInstructions(),
              VCS_INSTRUCTIONS: vcsInstructions(vcs).replaceAll("{{BRANCH}}", branch),
              MERGE_STEPS: mergeSteps(vcs)
                .replaceAll("{{BRANCH}}", branch)
                .replaceAll("{{COMPLETION_SIGNAL}}", completionSignal),
              COMPLETION_SIGNAL: completionSignal,
            },
            maxIterations: agentIterations,
            completionSignal,
          });

          const merged = yield* isMergedIntoHead(branch, vcs);
          if (!merged) {
            return yield* new SandcastleError({
              message: `Merger did not merge ${branch} into HEAD.`,
            });
          }

          yield* markIssueComplete(issue);
          yield* Console.log("Merged completed branches.");
        }
      }),
    cleanupOpenCodeState,
  );
}).pipe(Effect.provide(NodeServices.layer));

NodeRuntime.runMain(program);
