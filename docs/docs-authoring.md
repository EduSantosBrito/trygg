# Docs Authoring

This guide owns the **structure** of source-owned docs: where they live, the required
shape, and how the checker enforces them. For **content** — voice, benefit-first
writing, compiling examples, storyline — see [agents/docs-content.md](agents/docs-content.md).

Canonical docs live with the code that owns behavior.

For `packages/core`, source-owned docs have 3 units:

- Symbol docs: TSDoc on the exported declaration
- Module docs: leading file doc block on the owner module
- Sidecar guides: optional `*.docs.md` guide for owner topics that need more space

Derived docs like `README.md` are downstream summaries. Do not put canonical semantics there first.

Cloning the repo is the best way to work with LLMs because the canonical explanation should already live beside the owning code.

## Where To Write Docs

- Public symbol docs: on the exported declaration in the owner module
- Module docs: top of the owner module file
- Topic guide: adjacent `*.docs.md` file when the category requires a sidecar

Examples:

- `packages/core/src/primitives/component.ts`
- `packages/core/src/primitives/component.docs.md`
- `packages/core/src/router/index.ts`
- `packages/core/src/router/router.docs.md`

## Public Export Requirements

Every reachable export from a published `packages/core` entrypoint must have exactly 1 visibility tag:

- `@public`
- `@internal`

Every reachable export must also have:

- Summary
- `@remarks`

Every public behavioral export must also have:

- `@category`
- `@example`

Use applicable standard tags when relevant:

- `@param`
- `@returns`
- `@typeParam`
- `@deprecated`
- `@since`
- `@see`

Do not invent local tags. Allowed tags are enforced by `packages/core/docs.contract.json`.

## Module Doc Requirements

Owner modules need a leading file doc block with:

- Summary
- `@remarks`
- `@module`

Usually also include:

- `@see ./topic.docs.md - Source-owned topic guide`
- `@since`

Example shape:

```ts
/**
 * Component creation primitives for the root `Component` API.
 *
 * @remarks
 * Owner module for the `Component` topic. This module owns the callable
 * `Component` export, `Component.gen`, and the typing helpers used to thread
 * props and service requirements through JSX components.
 *
 * @see ./component.docs.md - Source-owned topic guide
 * @since 1.0.0
 * @module trygg/primitives/component
 */
```

## Sidecar Guide Requirements

Some categories require a sidecar guide. Check `packages/core/docs.contract.json`.

A sidecar leads with a one-sentence **benefit hook** and the **smallest runnable
example**, both above the locked headings, then the locked sections. Required shape:

```md
# Topic Name

One-sentence benefit hook: what this lets the reader do.

​```tsx
// the smallest runnable example that delivers that benefit
​```

## When to use

Short usage guidance, and when to pick something else.

## Behavior

Short behavior and tradeoff guidance, including the sharp edges and their workarounds.

## Related exports

- `PrimaryExport`
- `RelatedExport`

## Troubleshooting

Optional. Symptom → cause → fix for mistakes this API actually produces.
```

Enforced by the docs checker:

- A non-empty lead paragraph (the benefit hook) before the first `##` heading.
- At least one fenced code block (the minimal example) before the first `##` heading.
- The headings `## When to use`, `## Behavior`, and `## Related exports`, exactly.
- The `#` title must match the owner topic name from `docs.contract.json`.

`## Troubleshooting` is an optional convention — add it when an API has recurring
footguns worth a symptom/fix table. See [agents/docs-content.md](agents/docs-content.md)
for how to write each section well.

## Workflow

1. Find the owner module for the public surface.
2. Update the leading module doc block.
3. Update TSDoc on every reachable export you changed.
4. Add or update the sidecar `*.docs.md` if that category requires one.
5. Update derived docs only after source-owned docs are correct.
6. Run the docs checker.

## Checks

Run:

```sh
bun run --cwd packages/core docs:check
```

Optional JSON output:

```sh
bun run --cwd packages/core docs:check:json
```

## Inventory And Contract

Use these files when migrating or reviewing docs:

- Contract and taxonomy: `packages/core/docs.contract.json`
- Enforcement logic: `packages/core/src/internal/docs-contract.ts`
- Reachable public surface: `bun run --cwd packages/core docs:check:json` (the
  `reachableExports` array is the live inventory)

## Writing Guidance

- Prefer behavior, constraints, and tradeoffs over implementation trivia
- Keep examples minimal and runnable-looking
- Mark unstable helpers `@internal` instead of documenting them as public API
- Put canonical meaning in source first; update README and other derived docs after
- Follow existing owner-module patterns before inventing new structure
- `Trace` is intentionally `@internal` (see UBIQUITOUS_LANGUAGE.md). Document it as an
  advanced/internal observability topic; do not promote its surface to `@public` to
  register it as a contract owner. App-facing observability is `Debug` and `Metrics`.
