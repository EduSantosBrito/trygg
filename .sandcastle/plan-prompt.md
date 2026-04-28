# TASK

Deep-dive the issue below and produce a concrete implementation plan. Output the plan within `<plan>` tags.

Issue file: {{ISSUE_FILE}}

Issue title: {{ISSUE_TITLE}}

VCS:

{{VCS_INSTRUCTIONS}}

SOURCE:

{{SOURCE_INSTRUCTIONS}}

{{ISSUE_BODY}}

# CONTEXT

Read the relevant repo docs before planning:

{{REPO_DOCS}}

# PROCESS

## 1. Understand the Problem

- Read the issue body carefully. Extract the core problem, acceptance criteria, and any constraints.
- Search the codebase to identify ALL files/modules that will be touched or referenced.
- Read existing tests and nearby code to understand current behavior and conventions.

## 2. Research Effect APIs

If the issue may touch Effect code, use the `effect-glossary` skill to find the best Effect v4 APIs for the task. Verify API names, signatures, and idiomatic patterns from source. Do not guess from memory.

If the issue does not touch Effect code, state that no Effect API lookup is needed.

## 3. Design the Interface

Use the `design-an-interface` skill workflow but adapted for solo non-interactive analysis:

- Generate 2-3 different interface designs for the module/function
- Each design must be radically different (different method counts, different abstraction levels, different trade-offs)
- Compare them internally on: interface simplicity, depth (small interface over deep implementation), general-purpose vs specialized, alignment with existing codebase patterns
- Pick the best design

Before choosing, evaluate:
- Does it match existing codebase conventions?
- Does it use idiomatic Effect v4 patterns where applicable?
- Does it have the smallest interface that solves the problem?
- Are illegal states unrepresentable?

## 4. Plan Implementation

Define the implementation steps in dependency order:

- New types/modules to create
- Existing files to modify (with what changes)
- Tests to add (describe what each test verifies)
- Potential conflicts with other work

# OUTPUT

Output within `<plan>` tags:

<plan>
## Chosen Interface

[Type signatures, method signatures, key design decisions]

## Implementation Steps

1. [Step description — which file, what to do, why this order]
2. ...

## Test Plan

- [Test description — what behavior it verifies]

## Risks / Notes

- [Any edge cases, dependencies, or concerns]
</plan>

When complete, output {{COMPLETION_SIGNAL}}.
