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

# PLAN

The planner produced this implementation plan. Follow it unless you find a better approach — if so, explain why.

{{PLAN}}

# CONTEXT

Before implementing, use the `tdd` skill. Follow its red-green-refactor workflow for this issue.

Read the relevant repo docs before changing code:

{{REPO_DOCS}}

{{TYPE_SAFETY_RULES}}

Use local code search to find the smallest relevant surface area. Pay close attention to tests near changed code.

# EXECUTION

- Make minimal, surgical changes.
- Add deterministic tests for acceptance criteria when behavior changes.
- Prefer red-green-refactor for bug fixes and behavior changes.
- Do not modify `.sandcastle`.

# FEEDBACK LOOPS

Run relevant checks before committing. Prefer narrow checks first, then broader checks if practical:

{{FEEDBACK_LOOPS}}

{{VERIFY_STEP}}

# COMMIT

Commit your changes with a concise conventional commit message. If `.jj/` exists, use `jj describe`; otherwise use `git commit`.
Do not signal completion with a dirty worktree; commit all verification changes first.

If the task cannot be completed, commit only complete safe work and explain blockers in the final output.

When complete, output {{COMPLETION_SIGNAL}}.

# FINAL RULES

Only work on this issue. Do not start adjacent work.
