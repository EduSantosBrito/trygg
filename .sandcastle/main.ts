// Parallel Planner with Review — four-phase orchestration loop
//
// This template drives a multi-phase workflow:
//   Phase 1 (Plan):             An opus agent analyzes open issues, builds a
//                               dependency graph, and outputs a <plan> JSON
//                               listing unblocked issues with branch names.
//   Phase 2 (Execute + Review): For each issue, a sandbox is created via
//                               createSandbox(). The implementer runs first
//                               (100 iterations). If it produces commits, a
//                               reviewer runs in the same sandbox on the same
//                               branch (1 iteration). All issue pipelines run
//                               concurrently via Promise.allSettled().
//   Phase 3 (Merge):            A single agent merges all completed branches
//                               into the current branch.
//
// The outer loop repeats up to MAX_ITERATIONS times so that newly unblocked
// issues are picked up after each round of merges.
//
// Usage:
//   npx tsx .sandcastle/main.ts
// Or add to package.json:
//   "scripts": { "sandcastle": "npx tsx .sandcastle/main.ts" }

import * as sandcastle from "@ai-hero/sandcastle";
import type { AgentProvider } from "@ai-hero/sandcastle";
import { docker } from "@ai-hero/sandcastle/sandboxes/docker";
import { $ } from "bun";
import { tmpdir } from "node:os";
import {
  mkdtempSync,
  mkdirSync,
  copyFileSync,
  existsSync,
  cpSync,
  rmSync,
} from "node:fs";
import { join } from "node:path";

type Issue = {
  readonly number: number;
  readonly title: string;
  readonly body: string;
};

type PlannedIssue = {
  readonly id: string;
  readonly title: string;
  readonly branch: string;
};

type VcsIdentity = {
  readonly name: string;
  readonly email: string;
};

const slugify = (title: string): string =>
  title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);

const shellEscape = (value: string): string => `'${value.replace(/'/g, "'\\''")}'`;

const parsePositiveInteger = (name: string, fallback: number): number => {
  const raw = Bun.env[name];
  if (raw === undefined || raw.trim().length === 0) {
    return fallback;
  }

  const value = Number.parseInt(raw, 10);
  if (!Number.isInteger(value) || value < 1 || String(value) !== raw.trim()) {
    throw new Error(`${name} must be a positive integer.`);
  }

  return value;
};

const parseOptionalPositiveInteger = (name: string): number | undefined => {
  const raw = Bun.env[name];
  if (raw === undefined || raw.trim().length === 0) {
    return undefined;
  }

  const value = Number.parseInt(raw, 10);
  if (!Number.isInteger(value) || value < 1 || String(value) !== raw.trim()) {
    throw new Error(`${name} must be a positive integer.`);
  }

  return value;
};

const readJjConfig = async (key: string): Promise<string | undefined> => {
  try {
    const value = (await $`jj config get ${key}`.quiet().text()).trim();
    return value.length > 0 ? value : undefined;
  } catch {
    return undefined;
  }
};

const loadVcsIdentity = async (): Promise<VcsIdentity> => {
  const name =
    Bun.env.SANDCASTLE_VCS_NAME ??
    Bun.env.JJ_USER ??
    Bun.env.GIT_AUTHOR_NAME ??
    (await readJjConfig("user.name"));
  const email =
    Bun.env.SANDCASTLE_VCS_EMAIL ??
    Bun.env.JJ_EMAIL ??
    Bun.env.GIT_AUTHOR_EMAIL ??
    (await readJjConfig("user.email"));

  if (name === undefined || email === undefined) {
    throw new Error(
      "Sandcastle needs VCS identity. Set SANDCASTLE_VCS_NAME and SANDCASTLE_VCS_EMAIL, or configure git user.name/user.email.",
    );
  }

  return { name, email };
};

const vcsEnv = (identity: VcsIdentity): Record<string, string> => ({
  JJ_USER: identity.name,
  JJ_EMAIL: identity.email,
  GIT_AUTHOR_NAME: identity.name,
  GIT_AUTHOR_EMAIL: identity.email,
  GIT_COMMITTER_NAME: identity.name,
  GIT_COMMITTER_EMAIL: identity.email,
});

const requireNoEmptyOutgoingCommits = async () => {
  const revset = "empty() & (main@origin..@)";
  const output = await $`jj log -r ${revset} --no-graph -T ${"change_id.short() ++ \"\\n\""}`
    .quiet()
    .text();

  if (output.trim().length > 0) {
    await $`jj abandon ${revset}`.quiet();
  }
};

const outgoingRevisionsWithMissingIdentity = async (): Promise<readonly string[]> => {
  const output = await $`jj log -r ${"main@origin..@"} --no-graph -T ${
    'if(author.name() == "" || author.email() == "" || committer.name() == "" || committer.email() == "", change_id.short() ++ "\\n")'
  }`
    .quiet()
    .text();

  return output
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
};

const repairMissingVcsIdentity = async (identity: VcsIdentity) => {
  const revisions = await outgoingRevisionsWithMissingIdentity();
  for (const revision of revisions) {
    await $`env JJ_USER=${identity.name} JJ_EMAIL=${identity.email} jj metaedit --update-author --force-rewrite ${revision}`.quiet();
  }
};

const assertNoUndescribedOutgoingCommits = async () => {
  const output = await $`jj log -r ${"main@origin..@ & description(exact:\"\")"} --no-graph -T ${
    'change_id.short() ++ " " ++ commit_id.short() ++ "\\n"'
  }`
    .quiet()
    .text();

  if (output.trim().length > 0) {
    throw new Error(`Outgoing commits without descriptions:\n${output}`);
  }
};

const isBookmarkMergedIntoWorkingCopy = async (bookmark: string): Promise<boolean> => {
  const output = await $`jj log -r ${`${bookmark} ~ ancestors(@)`} --no-graph -T ${"commit_id.short()"}`
    .quiet()
    .text();
  return output.trim().length === 0;
};

const deleteMergedBookmark = async (bookmark: string) => {
  if (await isBookmarkMergedIntoWorkingCopy(bookmark)) {
    await $`jj bookmark delete ${bookmark}`.quiet();
    return;
  }

  console.warn(`Refusing to delete unmerged bookmark: ${bookmark}`);
};

const finalizeLinearMain = async (
  completedBranches: readonly string[],
  identity: VcsIdentity,
) => {
  await requireNoEmptyOutgoingCommits();
  await repairMissingVcsIdentity(identity);
  await assertNoUndescribedOutgoingCommits();

  for (const branch of completedBranches) {
    await deleteMergedBookmark(branch);
  }

  await $`jj bookmark set main -r @`.quiet();
  await $`jj git export`.quiet();
};

const sandboxedOpenCode = (model: string, variant?: string): AgentProvider => ({
  name: "opencode",
  env: {},
  captureSessions: false,
  buildPrintCommand: ({ prompt }) => ({
    command: [
      "prompt_file=$(mktemp)",
      "cat > \"$prompt_file\"",
      [
        "opencode run --dangerously-skip-permissions --model",
        shellEscape(model),
        variant === undefined ? "" : `--variant ${shellEscape(variant)}`,
        shellEscape("Read the attached prompt file and follow it exactly."),
        "--file \"$prompt_file\"",
      ]
        .filter((part) => part.length > 0)
        .join(" "),
      "status=$?",
      "rm -f \"$prompt_file\"",
      "exit $status",
    ]
      .filter((part) => part.length > 0)
      .join("; "),
    stdin: prompt,
  }),
  buildInteractiveArgs: ({ prompt }) => {
    const args = [
      "opencode",
      "--dangerously-skip-permissions",
      "--model",
      model,
    ];
    if (variant !== undefined) {
      args.push("--variant", variant);
    }
    if (prompt.length > 0) {
      args.push("-p", prompt);
    }
    return args;
  },
  parseStreamLine: () => [],
});

const createOpenCodeState = () => {
  const root = mkdtempSync(join(tmpdir(), "trygg-opencode-"));
  const shareDir = join(root, "share", "opencode");
  const configDir = join(root, "config", "opencode");

  mkdirSync(shareDir, { recursive: true });
  mkdirSync(configDir, { recursive: true });

  const hostShareDir = join(process.env.HOME ?? "", ".local", "share", "opencode");
  const hostConfigDir = join(process.env.HOME ?? "", ".config", "opencode");

  for (const file of ["auth.json", "mcp-auth.json"]) {
    const source = join(hostShareDir, file);
    if (existsSync(source)) {
      copyFileSync(source, join(shareDir, file));
    }
  }

  if (existsSync(hostConfigDir)) {
    cpSync(hostConfigDir, configDir, {
      recursive: true,
      filter: (src) => !src.includes("node_modules"),
    });
  }

  return { root, shareDir, configDir };
};

const cleanupOpenCodeState = (state: { readonly root: string }) => {
  try {
    rmSync(state.root, { recursive: true, force: true });
  } catch {
    // ignore cleanup errors
  }
};

const parseIssue = (value: unknown): Issue | undefined => {
  if (typeof value !== "object" || value === null) {
    return undefined;
  }

  const number = Reflect.get(value, "number");
  const title = Reflect.get(value, "title");
  const body = Reflect.get(value, "body");

  if (typeof number !== "number" || typeof title !== "string") {
    return undefined;
  }

  return {
    number,
    title,
    body: typeof body === "string" ? body : "",
  };
};

const parseIssues = (json: string): readonly Issue[] => {
  const value: unknown = JSON.parse(json);
  if (!Array.isArray(value)) {
    return [];
  }
  return value.flatMap((item) => {
    const issue = parseIssue(item);
    return issue === undefined ? [] : [issue];
  });
};

const blockedBy = (body: string): readonly number[] => {
  const blockers: number[] = [];
  for (const match of body.matchAll(/Blocked by #(\d+)/g)) {
    const number = Number(match[1]);
    if (Number.isInteger(number)) {
      blockers.push(number);
    }
  }
  return blockers;
};

const parsePlannedIssue = (value: unknown): PlannedIssue | undefined => {
  if (typeof value !== "object" || value === null) {
    return undefined;
  }

  const id = Reflect.get(value, "id");
  const title = Reflect.get(value, "title");
  const branch = Reflect.get(value, "branch");

  if (
    typeof id !== "string" ||
    typeof title !== "string" ||
    typeof branch !== "string"
  ) {
    return undefined;
  }

  return { id, title, branch };
};

const parsePlan = (stdout: string): readonly PlannedIssue[] | undefined => {
  const match = stdout.match(/<plan>\s*([\s\S]*?)\s*<\/plan>/);
  const json = match?.[1];
  if (json === undefined) {
    return undefined;
  }

  const value: unknown = JSON.parse(json);
  if (typeof value !== "object" || value === null) {
    return undefined;
  }

  const issues = Reflect.get(value, "issues");
  if (!Array.isArray(issues)) {
    return undefined;
  }

  return issues.flatMap((item) => {
    const issue = parsePlannedIssue(item);
    return issue === undefined ? [] : [issue];
  });
};

const loadDeterministicPlan = async (): Promise<readonly PlannedIssue[]> => {
  const issueJson =
    await $`gh issue list --state open --label Sandcastle --limit 100 --json number,title,body`.text();
  const issues = parseIssues(issueJson);
  const openIssueNumbers = new Set(issues.map((issue) => issue.number));

  const unblocked = issues.filter((issue) =>
    blockedBy(issue.body).every((blocker) => !openIssueNumbers.has(blocker)),
  );

  const selected = unblocked.length > 0 ? unblocked : issues.slice(0, 1);
  return selected.map((issue) => ({
    id: String(issue.number),
    title: issue.title,
    branch: `sandcastle/issue-${issue.number}-${slugify(issue.title)}`,
  }));
};

const loadPlan = async (): Promise<readonly PlannedIssue[]> => {
  const { provider, cleanup } = createSandboxProvider();
  try {
    const plan = await sandcastle.run({
      hooks,
      sandbox: provider,
      name: "planner",
      maxIterations: 4,
      agent: plannerAgent,
      promptFile: "./.sandcastle/plan-prompt.md",
      completionSignal: "</plan>",
      copyToWorktree,
    });
    const issues = parsePlan(plan.stdout);
    if (issues !== undefined) {
      return issues;
    }
    throw new Error("Planner returned no valid <plan> block.");
  } catch (error) {
    if (Bun.env.SANDCASTLE_DETERMINISTIC_PLAN_FALLBACK === "1") {
      console.warn(`Planner failed: ${String(error)}. Falling back.`);
      return loadDeterministicPlan();
    }
    throw error;
  } finally {
    cleanup();
  }
};

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

// Keep Sandcastle high-throughput by default. Set SANDCASTLE_MAX_PARALLEL_ISSUES
// only when a temporary throttle is needed for a risky batch.
const MAX_ITERATIONS = parsePositiveInteger("SANDCASTLE_MAX_ITERATIONS", 100);
const MAX_PARALLEL_ISSUES = parseOptionalPositiveInteger(
  "SANDCASTLE_MAX_PARALLEL_ISSUES",
);

// Hooks run inside the sandbox before the agent starts each iteration.
// bun install ensures the sandbox always has fresh dependencies.
const hooks = {
  sandbox: { onSandboxReady: [{ command: "bun install" }] },
};

// Do not copy node_modules into every worktree. Copying it in parallel is slow
// enough to trip Sandcastle's 60s copy timeout; the hook above runs bun install
// inside each sandbox instead.
const copyToWorktree: string[] = [];

const vcsIdentity = await loadVcsIdentity();

const createSandboxProvider = () => {
  const state = createOpenCodeState();
  const provider = docker({
    env: vcsEnv(vcsIdentity),
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
  return { provider, cleanup: () => cleanupOpenCodeState(state) };
};

const plannerModel = "openai/gpt-5.5";
const implementerModel = "openai/gpt-5.5";
const reviewerModel = "deepseek/deepseek-v4-pro";
const mergerModel = "openai/gpt-5.5";

const plannerAgent = sandboxedOpenCode(plannerModel, "medium");
const implementerAgent = sandboxedOpenCode(implementerModel);
const reviewerAgent = sandboxedOpenCode(reviewerModel);
const mergerAgent = sandboxedOpenCode(mergerModel);

// ---------------------------------------------------------------------------
// Main loop
// ---------------------------------------------------------------------------

for (let iteration = 1; iteration <= MAX_ITERATIONS; iteration++) {
  console.log(`\n=== Iteration ${iteration}/${MAX_ITERATIONS} ===\n`);

  // -------------------------------------------------------------------------
  // Phase 1: Plan
  //
  // Prefer the prompt-based planner so dependency analysis lives in
  // .sandcastle/plan-prompt.md. Deterministic planning is opt-in fallback only.
  // -------------------------------------------------------------------------
  const plannedIssues = await loadPlan();
  const issues =
    MAX_PARALLEL_ISSUES === undefined
      ? plannedIssues
      : plannedIssues.slice(0, MAX_PARALLEL_ISSUES);

  if (MAX_PARALLEL_ISSUES !== undefined && plannedIssues.length > issues.length) {
    console.log(
      `Safety cap: running ${issues.length}/${plannedIssues.length} planned issue(s). Set SANDCASTLE_MAX_PARALLEL_ISSUES to raise.`,
    );
  }

  if (issues.length === 0) {
    // No unblocked work — either everything is done or everything is blocked.
    console.log("No unblocked issues to work on. Exiting.");
    break;
  }

  console.log(
    `Planning complete. ${issues.length} issue(s) to work in parallel:`,
  );
  for (const issue of issues) {
    console.log(`  ${issue.id}: ${issue.title} → ${issue.branch}`);
  }

  if (Bun.env.SANDCASTLE_PLAN_ONLY === "1") {
    console.log("Plan-only mode enabled. Exiting before execution.");
    break;
  }

  // -------------------------------------------------------------------------
  // Phase 2: Execute + Review
  //
  // For each issue, create a sandbox via createSandbox() so the implementer
  // and reviewer share the same sandbox instance per branch. The implementer
  // runs first; if it produces commits, the reviewer runs in the same sandbox.
  //
  // Promise.allSettled means one failing pipeline doesn't cancel the others.
  // -------------------------------------------------------------------------

  await $`jj git export`.quiet();
  const sourceRevision = (await $`jj log -r main --no-graph -T ${"commit_id"}`.text()).trim();

  const settled = await Promise.allSettled(
    issues.map(async (issue) => {
      const { provider: issueSandbox, cleanup: cleanupIssueSandbox } =
        createSandboxProvider();
      const sandbox = await sandcastle.createSandbox({
        branch: issue.branch,
        sandbox: issueSandbox,
        hooks,
        copyToWorktree,
      });

      try {
        // Run the implementer
        const implement = await sandbox.run({
          name: "implementer",
          maxIterations: 100,
          agent: implementerAgent,
          promptFile: "./.sandcastle/implement-prompt.md",
          promptArgs: {
            TASK_ID: issue.id,
            ISSUE_TITLE: issue.title,
            BRANCH: issue.branch,
          },
        });

        // Only review if the implementer produced commits
        if (implement.commits.length > 0) {
          const review = await sandbox.run({
            name: "reviewer",
            maxIterations: 1,
            agent: reviewerAgent,
            promptFile: "./.sandcastle/review-prompt.md",
            promptArgs: {
              BRANCH: issue.branch,
              BASE_REVISION: sourceRevision,
            },
          });

          // Merge commits from both runs so the merge phase sees all of them.
          // Each sandbox.run() only returns commits from its own run.
          return {
            ...review,
            commits: [...implement.commits, ...review.commits],
          };
        }

        return implement;
      } finally {
        await sandbox.close();
        cleanupIssueSandbox();
      }
    }),
  );

  // Log any agents that threw (network error, sandbox crash, etc.).
  for (const [i, outcome] of settled.entries()) {
    if (outcome.status === "rejected") {
      console.error(
        `  ✗ ${issues[i]!.id} (${issues[i]!.branch}) failed: ${outcome.reason}`,
      );
    }
  }

  // Only pass branches that actually produced commits to the merge phase.
  // An agent that ran successfully but made no commits has nothing to merge.
  const completedIssues = settled
    .map((outcome, i) => ({ outcome, issue: issues[i]! }))
    .filter(
      (entry) =>
        entry.outcome.status === "fulfilled" &&
        entry.outcome.value.commits.length > 0,
    )
    .map((entry) => entry.issue);

  const completedBranches = completedIssues.map((i) => i.branch);

  console.log(
    `\nExecution complete. ${completedBranches.length} branch(es) with commits:`,
  );
  for (const branch of completedBranches) {
    console.log(`  ${branch}`);
  }

  if (completedBranches.length === 0) {
    // All agents ran but none made commits — nothing to merge this cycle.
    console.log("No commits produced. Nothing to merge.");
    continue;
  }

  // -------------------------------------------------------------------------
  // Phase 3: Merge
  //
  // One agent merges all completed branches into the current branch,
  // resolving any conflicts and running tests to confirm everything works.
  //
  // The {{BRANCHES}} and {{ISSUES}} prompt arguments are lists that the agent
  // uses to know which branches to merge and which issues to close.
  // -------------------------------------------------------------------------
  const { provider: mergerSandbox, cleanup: cleanupMergerSandbox } =
    createSandboxProvider();
  try {
    await sandcastle.run({
      hooks,
      sandbox: mergerSandbox,
      name: "merger",
      maxIterations: 1,
      agent: mergerAgent,
      promptFile: "./.sandcastle/merge-prompt.md",
      promptArgs: {
        // A markdown list of branch names, one per line.
        BRANCHES: completedBranches.map((b) => `- ${b}`).join("\n"),
        // A markdown list of issue IDs and titles, one per line.
        ISSUES: completedIssues.map((i) => `- ${i.id}: ${i.title}`).join("\n"),
        VCS_USER: vcsIdentity.name,
        VCS_EMAIL: vcsIdentity.email,
      },
    });

    await finalizeLinearMain(completedBranches, vcsIdentity);
  } finally {
    cleanupMergerSandbox();
  }

  console.log("\nBranches merged.");
}

console.log("\nAll done.");
