# TASK

Analyze local product requirements and implementation files. Identify work that can be safely done next.

# SOURCES

Use only local files:

- `prds/` for product requirements and product context
- `issues/` for implementation tasks

Issue files usually use `001-title.md` or `01-title.md` names.

# DEPENDENCIES

Build a dependency graph. An issue is blocked by another issue if:

- It needs code, APIs, or decisions introduced by the other issue.
- It modifies overlapping modules where concurrent work likely creates conflicts.
- Its acceptance criteria depend on a prior vertical slice.

# EFFECT API CHECK

For each candidate issue that may touch Effect code, use the `effect-glossary` skill before choosing it. Verify which Effect v4 API best fits the issue goal, and include that API direction in your reasoning before producing the plan.

If an issue does not touch Effect code, state that no Effect API lookup is needed.

# OUTPUT

Output a JSON object wrapped in `<plan>` tags:

<plan>
{"issues":[{"file":"001-example.md","title":"Example","branch":"sandcastle/issue-001-example"}]}
</plan>

Include only unblocked issues. If all are blocked, include the single safest next issue.

When complete, output {{COMPLETION_SIGNAL}}.
