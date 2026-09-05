# create-trygg

Scaffold a typed trygg app from the blank or full-stack incident template.

trygg is canary-only. Request the canary tag explicitly:

```sh
bunx create-trygg@canary my-app --yes
cd my-app
bun run dev
```

`--yes` selects the blank template, Bun platform, server output, Git, and dependency installation. Select the incident template non-interactively with:

```sh
bunx create-trygg@canary my-app --yes --template incident
```

Without `--yes`, the CLI prompts for the template, platform, output mode, version control, and dependency installation. `--template blank` or `--template incident` fixes only the template and leaves the other choices interactive.

## Scaffold Boundary

The target path is no-replace: if any file or directory already owns that path, the CLI fails without changing it. Files are first prepared in a hidden sibling directory named like `.<project>.create-trygg-*`; the target remains absent during this stage.

Publication reserves the target directory and moves staged entries into it. The reserved target is provisional and can be visible to other processes until the scaffold reports `Project created`. Failure or interruption waits for an active directory creation, copy, write, or move to settle, then removes the staging path and any target reserved by this invocation before the scaffold settles. Cancellation remains possible during reads and between mutations. Paths owned by another creator are never cleanup targets.

## VCS And Installation

Version-control initialization and dependency installation happen after the scaffold has completed, in that order. They are not part of scaffold rollback:

- A Git or Jujutsu initialization failure is reported as a warning and leaves the generated project in place.
- A dependency-install failure ends the command with an error and leaves the generated project, plus any completed VCS initialization, in place.
- Installation uses the package manager that invoked the CLI. If installation was declined, the final instructions print its install command instead.

## Child Process Ownership

VCS and install commands require a host with POSIX-style process-group signaling. Windows is currently unsupported for these CLI-owned steps. Each command starts without a shell in its own detached process group so interruption owns both the leader and its descendants.

On shutdown, the CLI sends `SIGTERM` to the process group and waits up to five seconds for the entire group to disappear. If it remains live, the CLI sends `SIGKILL` and waits for group quiescence before returning. This applies when the child succeeds, fails, or the CLI is interrupted.

Unsupported hosts fail before a child process is spawned. To scaffold without CLI-owned child processes, use the interactive flow, select no version control, and decline dependency installation; then initialize and install outside `create-trygg`. The generated target remains available if a post-scaffold child step is unsupported or fails.
