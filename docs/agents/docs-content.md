# Docs Content Guidelines

How to write trygg documentation that an Effect developer can actually use.

This guide is about **content** — what each page says, in what order, and with what
voice. It is the companion to [docs-authoring.md](../docs-authoring.md), which owns
the **structure** (where docs live, the required headings, the enforcement). When
the two overlap, structure is the floor and content is the bar: passing the docs
checker is necessary, not sufficient.

Read this before writing or reworking any end-user-facing doc: a module doc block,
a public export's TSDoc, a `*.docs.md` sidecar, or a website page.

## Who we write for

trygg's readers are **Effect power users** (see [PRODUCT.md](../../PRODUCT.md)). They
already know services, layers, typed errors, `Effect.gen`, and `Scope`. They are
deciding whether UI can follow the same model instead of switching mental models at
the component layer.

Two consequences:

- **Lean on what they know.** "A Component is an Effect that yields its props and
  services, then produces an Element" lands instantly with this audience. Don't
  re-teach `Effect.gen` or what a `Layer` is — link to Effect's own docs and move on.
- **Don't condescend or pad.** No "in this section we will learn". No motivational
  framing. They came for the mental model and the sharp edges, fast.

## Voice

Precise, effect-idiomatic, calm — the brand personality from PRODUCT.md.

- **Direct and concrete.** Prefer "Pass a Signal to JSX and only the bound text node
  updates" over "Signals enable powerful, efficient reactivity".
- **No hype, no magic.** Banned words: _magic_, _just works_, _blazing_, _effortless_,
  _powerful_, _seamless_. If a thing is good, show the code that makes it good.
- **Honest about canary.** trygg is canary. Say so where it matters (install, stability
  of an API) without apologizing for it — transparency is trust-building, not a caveat
  tax on every paragraph.
- **Use the ubiquitous language exactly.** Component, Element, Signal, Resource, Layer,
  Mount boundary, Outlet, Routes manifest, Trace, Debug — as defined in
  [UBIQUITOUS_LANGUAGE.md](../../UBIQUITOUS_LANGUAGE.md). Never the banned aliases
  (store/atom, query/fetcher, logging/telemetry, guard/fallback-page, provider for Layer).

## How we talk about other frameworks

We do **not** explain trygg by comparison to React, Solid, or Svelte, and we never
position against another framework's site (no React-clone framing, no foldkit/Vercel
mimicry — see PRODUCT.md anti-references).

- The reference point is **Effect**, not React. "You already know this from Effect"
  is the on-ramp; "it's like React hooks but…" is not.
- It is fine to name a familiar _concept_ ("server-side data fetching", "scroll
  restoration") to anchor a feature. It is not fine to make a page only legible to
  someone who already knows another framework.
- Never claim parity, superiority, or feature-for-feature mapping with a named
  competitor.

## Lead with the benefit

Every doc unit opens with **what it lets the reader do**, then how. Mechanics-first
writing is the most common failure in the current docs.

- A sidecar's first line is a one-sentence **benefit hook**: the outcome, not the API
  shape. "Recover from a failed render with typed fallback UI instead of a blank
  screen" — not "ErrorBoundary is a namespace with a `match` export".
- A public export's TSDoc summary says what problem it solves before the signature
  details.
- A sidebar/description line sells the page, not its file name. "Fine-grained reactive
  state that updates DOM nodes in place" beats "The Signal primitive".

Test: read only the first sentence of a page. Does the reader know why they'd keep
reading? If not, rewrite it.

## Example-first, and every example compiles

After the benefit hook, the next thing the reader should see is the **smallest runnable
example** that delivers it. Concept prose comes after the code, not before.

Non-negotiable: **examples must compile against the current API.** Broken examples are
worse than no examples — they erode the type-safety promise the framework is selling.
Common mistakes to never ship:

- `Context.Service` must be the **double call**:
  `class Foo extends Context.Service<Foo, Shape>()("app/Foo") {}` — the empty `()` is
  required. `Context.Service<Foo, Shape>("app/Foo")` does not type-check.
- Effect 4 has **no `.Default`** on plain `Context.Service` classes — don't reference it.
  Back any type-equality claim with a `Types.Equals` contract before shipping it.
- Top-level mount effects must have `R = never`: every Service must be provided by a
  Layer before the Mount boundary.
- Import what you use in the snippet (`Component`, `Signal`, `Effect`, `ComponentProps`),
  and declare any Layer/service the snippet references.

Keep examples **minimal**: the fewest lines that show the idea, no incidental styling or
unrelated props. The canonical minimal Component is the bar for density:

```tsx
import { Component, Signal } from "trygg";

const Counter = Component.gen(function* () {
  const count = yield* Signal.make(0);
  return <button onClick={() => Signal.update(count, (n) => n + 1)}>Count: {count}</button>;
});
```

If a snippet is illustrative-only and intentionally not runnable, say so on the line
above it. The default assumption is runnable.

## One idea per page, progressive depth

Teach through progressive depth (PRODUCT.md principle 3): simplest runnable path first,
then conceptual detail, then edge cases.

- One page owns one idea. If a sidecar grows a 100-line cookbook for a secondary
  pattern (the old `signal.docs.md` "signal middleware via service" detour is the
  cautionary tale), that pattern wants its own page or a short "Related" pointer — not
  the top of the page the reader landed on for the basics.
- Order within a page: **benefit hook → minimal example → behavior & tradeoffs →
  related exports → troubleshooting**. The reader who wants only the gist stops after
  the example; the reader who wants depth keeps going.
- Don't hide the mental model behind advanced material. The first screen is for the
  90% case.

## Be honest about sharp edges

The audience trusts precise docs more than tidy ones. Document the edges that will
actually bite, with the workaround inline:

- **Signal-derived arrays need a Fragment wrap.** `Signal.derive` returning an array of
  Elements renders as `[object Object]` unless wrapped in `<>…</>`.
- **Deriving a Component reads its props once.** `Signal.derive(sig, () => <Comp />)`
  captures props at derive time; pass the Signal _into_ the Component, or resolve the
  value upfront, when you need it to track.
- **Disposed-signal access is a lifecycle edge, not a user error.** Reads return the last
  snapshot, writes are no-ops, and a `signal.disposed_access` diagnostic is emitted —
  signatures stay clean on purpose. Say this where it matters; don't make it the
  headline.

A page that only lists happy paths reads as marketing. Name the constraint, show the
fix, keep moving.

## Where each kind of content lives

[docs-authoring.md](../docs-authoring.md) is authoritative on structure. The content
split:

- **Module doc block** (top of the owner `.ts`): the one-paragraph "what this module
  owns and why" — orientation for someone reading the source.
- **Public export TSDoc**: per-symbol contract — summary (benefit first), `@remarks`
  for behavior/tradeoffs, `@example` for the minimal runnable use. This is what shows
  up in editor hovers; write it for the dev mid-keystroke.
- **Sidecar `*.docs.md`**: the topic guide that needs more room than a doc comment —
  the narrative that ties the exports together. Required sidecars follow the evolved
  shape below.
- **Website pages** (`apps/www`): the **guide layer** and storyline only. The site
  imports sidecars verbatim and adds sequencing, concept pages, and the tutorial. It
  must never become the canonical home for behavior — update the source first, always.

## The evolved sidecar shape

Required sidecars (per `docs.contract.json`) must lead with benefit and example
**above** the locked headings. The structure the checker enforces and we expect:

```md
# Topic Name

One-sentence benefit hook: what this lets the reader do.

​```tsx
// the smallest runnable example that delivers that benefit
​```

## When to use

Reach-for-this guidance and the cases where you'd pick something else.

## Behavior

How it actually works, the tradeoffs, and the sharp edges (with workarounds).

## Related exports

- `PrimaryExport`
- `RelatedExport`

## Troubleshooting

Optional. Symptom → cause → fix for the mistakes this API actually produces.
```

The `#` title must match the owner topic in `docs.contract.json`. `## When to use`,
`## Behavior`, and `## Related exports` are enforced exactly and in addition to the
benefit hook + example. `## Troubleshooting` is an optional convention — use it when an
API has recurring footguns worth a symptom/fix table.

## A note on trace

`Trace` is the framework's **internal** flight recorder (see UBIQUITOUS_LANGUAGE.md and
its `@internal` module tag). It is documented as an advanced/internal observability
topic on the site, but it is intentionally **not** a public docs-contract owner — don't
promote its surface to `@public` to satisfy the checker. App-facing observability is
`Debug` and `Metrics`; point readers there first.

## Before you ship a doc

- First sentence states the benefit, not the API shape.
- The first code block is the smallest runnable example, and it compiles.
- Ubiquitous-language terms are exact; no banned aliases; no hype words.
- Sharp edges are named with workarounds; canary status is honest where relevant.
- Canonical behavior lives in source (module doc / TSDoc / sidecar), not only on the site.
- `bun run --cwd packages/core docs:check` passes.
