# TASK

Review code changes on branch {{BRANCH}} for issue `{{ISSUE_FILE}}`: {{ISSUE_TITLE}}

VCS:

{{VCS_INSTRUCTIONS}}

SOURCE:

{{SOURCE_INSTRUCTIONS}}

{{ISSUE_BODY}}

# CONTEXT

Read the diff carefully:

{{REVIEW_COMMANDS}}

- Relevant tests and modules touched by the diff

Apply repo standards from:

- `AGENTS.md`
- `docs/agents/code-quality.md`
- `docs/agents/effect-typescript.md`
- `docs/agents/testing.md`

# REVIEW PROCESS

Before reviewing, use the `improve-codebase-architecture` skill on the files affected by this branch. Scope its recommendations to this issue's changed files only; do not start unrelated architecture work.

Look for bugs, regressions, missing edge cases, and avoidable complexity.

Stress changed code paths with hostile cases where relevant:

- Empty values
- Missing optional fields
- Rapid repeated calls
- Resource cleanup and interruption
- Adjacent behavior regressions

Improve code only when it preserves behavior and materially improves clarity, safety, or tests.

# EXECUTION

- Run relevant tests/checks first if practical, then run `bun run check` before completion.
- Add missing semantic tests when the diff has uncovered risk.
- Fix real issues directly on this branch.
- Preserve exact intended behavior.
- Do not modify `.sandcastle`.
- Commit review changes only if you made changes.
- `bun run check` may rewrite files; include every changed file in the final review commit.
- Do not signal completion with a dirty worktree; commit all verification changes first.

If code is already clean, tested, and safe, do nothing.

When complete, output {{COMPLETION_SIGNAL}}.
