# TASK

Implement one vertical slice.

Issue file: {{ISSUE_FILE}}

Issue title: {{ISSUE_TITLE}}

Branch: {{BRANCH}}

VCS:

{{VCS_INSTRUCTIONS}}

SOURCE:

{{SOURCE_INSTRUCTIONS}}

{{ISSUE_BODY}}

# CONTEXT

Before implementing, use the `tdd` skill. Follow its red-green-refactor workflow for this issue.

Read the relevant repo docs before changing code:

- `AGENTS.md`
- `docs/agents/code-quality.md`
- `docs/agents/effect-typescript.md`
- `docs/agents/testing.md`
- `docs/agents/vcs.md`

Use local code search to find the smallest relevant surface area. Pay close attention to tests near changed code.

# EXECUTION

- Make minimal, surgical changes.
- Preserve type safety: no `any`, no non-null assertions, no type assertions.
- Use Effect v4 APIs and repo patterns for async, resourceful, or fallible code.
- Add deterministic tests for acceptance criteria when behavior changes.
- Prefer red-green-refactor for bug fixes and behavior changes.
- Do not modify `.sandcastle`.

# FEEDBACK LOOPS

Run relevant checks before committing. Prefer narrow checks first, then broader checks if practical:

- `bun run typecheck`
- `bun run test`
- `bun run check` when broad validation is warranted

# COMMIT

Commit your changes with a concise conventional commit message. If `.jj/` exists, use `jj describe`; otherwise use `git commit`.

If the task cannot be completed, commit only complete safe work and explain blockers in the final output.

When complete, output {{COMPLETION_SIGNAL}}.

# FINAL RULES

Only work on this issue. Do not start adjacent work.
