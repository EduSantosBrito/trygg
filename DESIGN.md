---
name: trygg
description: Effect-native UI documentation for developers who want components to compose like Effects. Editorial-typographic on paper-warm, with oxblood as the architectural signature. One sans family carries display, prose, and UI; one mono carries code.
colors:
  paper: "oklch(97% 0.005 70)"
  paper-subtle: "oklch(95% 0.006 70)"
  paper-elevated: "oklch(99% 0.003 70)"
  paper-deep: "oklch(92% 0.008 70)"
  ink: "oklch(20% 0.012 60)"
  ink-muted: "oklch(45% 0.012 55)"
  ink-subtle: "oklch(60% 0.01 50)"
  rule: "oklch(20% 0.012 60 / 0.14)"
  rule-strong: "oklch(20% 0.012 60 / 0.28)"
  signature: "oklch(42% 0.14 25)"
  signature-strong: "oklch(34% 0.15 25)"
  signature-mark: "oklch(42% 0.14 25 / 0.12)"
  mark: "oklch(64% 0.13 75)"
  mark-bg: "oklch(64% 0.13 75 / 0.1)"
  code-bg: "oklch(16% 0.01 50)"
  code-surface: "oklch(19% 0.012 50)"
  code-ink: "oklch(94% 0.005 70)"
  code-ink-muted: "oklch(65% 0.012 50)"
  code-signature: "oklch(70% 0.14 28)"
  code-mark: "oklch(78% 0.12 80)"
  code-rule: "oklch(94% 0.005 70 / 0.1)"
typography:
  display:
    fontFamily: "IBM Plex Sans, system-ui, sans-serif"
    fontSize: "56px"
    fontWeight: 700
    lineHeight: 1.04
    letterSpacing: "-0.025em"
  headline:
    fontFamily: "IBM Plex Sans, system-ui, sans-serif"
    fontSize: "36px"
    fontWeight: 700
    lineHeight: 1.1
    letterSpacing: "-0.02em"
  title:
    fontFamily: "IBM Plex Sans, system-ui, sans-serif"
    fontSize: "20px"
    fontWeight: 600
    lineHeight: 1.3
    letterSpacing: "-0.01em"
  body:
    fontFamily: "IBM Plex Sans, system-ui, sans-serif"
    fontSize: "16px"
    fontWeight: 400
    lineHeight: 1.65
    letterSpacing: "normal"
  prose:
    fontFamily: "IBM Plex Sans, system-ui, sans-serif"
    fontSize: "17px"
    fontWeight: 400
    lineHeight: 1.7
    letterSpacing: "normal"
  wordmark:
    fontFamily: "Space Grotesk, IBM Plex Sans, system-ui, sans-serif"
    fontSize: "17px"
    fontWeight: 700
    lineHeight: 1
    letterSpacing: "-0.015em"
  label:
    fontFamily: "IBM Plex Mono, ui-monospace, monospace"
    fontSize: "12px"
    fontWeight: 500
    lineHeight: 1.4
    letterSpacing: "0.14em"
  mono:
    fontFamily: "IBM Plex Mono, ui-monospace, monospace"
    fontSize: "13px"
    fontWeight: 400
    lineHeight: 1.6
    letterSpacing: "0"
rounded:
  none: "0px"
  xs: "2px"
  sm: "4px"
  md: "6px"
  code: "8px"
spacing:
  hair: "2px"
  xs: "4px"
  sm: "8px"
  md: "12px"
  lg: "16px"
  xl: "24px"
  2xl: "32px"
  3xl: "48px"
  section: "80px"
components:
  button-primary:
    backgroundColor: "{colors.signature}"
    textColor: "{colors.paper-elevated}"
    typography: "{typography.body}"
    rounded: "{rounded.sm}"
    padding: "10px 18px"
  button-primary-hover:
    backgroundColor: "{colors.signature-strong}"
  button-secondary:
    backgroundColor: "transparent"
    textColor: "{colors.ink}"
    borderColor: "{colors.ink}"
    typography: "{typography.body}"
    rounded: "{rounded.sm}"
    padding: "10px 18px"
  link:
    textColor: "{colors.ink}"
    textDecoration: "underline"
    textDecorationColor: "{colors.rule-strong}"
  link-hover:
    textDecorationColor: "{colors.signature}"
    textDecorationThickness: "2px"
  sidebar-active:
    leftMark: "4px {colors.signature}"
    textColor: "{colors.ink}"
    backgroundColor: "transparent"
  canary-badge:
    backgroundColor: "{colors.mark-bg}"
    textColor: "{colors.mark}"
    borderColor: "{colors.mark}"
    typography: "{typography.label}"
    rounded: "{rounded.none}"
    padding: "3px 8px"
  code-block:
    backgroundColor: "{colors.code-bg}"
    textColor: "{colors.code-ink}"
    typography: "{typography.mono}"
    rounded: "{rounded.code}"
    padding: "18px 22px"
---

# Design System: trygg

## 1. Overview

**Creative North Star: "Typed on paper"**

trygg's visual system is an editorial-typographic surface that reads like a serious technical journal. Pages are set on paper-warm. Every word of display, prose, and UI is rendered in IBM Plex Sans; every line of code is rendered in IBM Plex Mono. The "trygg" wordmark is the one named exception: it uses Space Grotesk 700 as a logotype, never as a display face on body or headings. Hierarchy elsewhere comes from scale + weight contrast within Plex Sans, never from a second display face, never from italic emphasis. A single deeply saturated oxblood carries every primary action, current-state mark, and architectural rule. Code is the one place where the canvas flips: code blocks and the workbench preview render as dark warm-ink surfaces with oxblood gutter marks, regardless of page theme. There is no third color, no decorative effect, and no editorial-serif lane.

The scene that justifies this: a senior Effect developer reads typed-API articles on a 14-inch laptop in afternoon sun, with the editor in dark-ink mode beside the prose. Pages need editorial calm; code needs unambiguous syntax. Paper for pages, ink for code.

The system rejects every category reflex: not purple (Vercel), not lime (foldkit), not mint (Mintlify), not gradient cards (OpenAI), not neon-on-black (terminal hacker), not navy-and-gold (banking). It rejects identical card grids, gradient text, decorative glass, side-stripe accents, and big-number SaaS heroes. It also rejects the second-order reflex of "editorial serif + italic emphasis" — the current AI-slop tell for any framework site that's already left the SaaS lane. Sans + weight contrast is the durable lane.

**Key characteristics:**

- Paper-warm surfaces with hairline ink rules instead of containers.
- One signature color, oxblood, used architecturally — never decoratively.
- Editorial typographic patterns (indexed list, mapped pair, annotated timeline, topic index) instead of card grids.
- Code surfaces are intrinsically dark, even on light pages.
- Confident, restrained motion (150–250ms ease-out-quart).
- Keyboard-first focus rings with paper offset.

## 2. Colors

The palette is Restrained with a single Committed signature. Paper-warm carries 90% of every surface; oxblood does the architectural work.

### Paper layer (default page surfaces)

- **Paper** (`paper`): The default page background. Warm white with a touch of yellow tint, never pure `#fff`.
- **Paper Subtle** (`paper-subtle`): The first tonal step below paper. For sidebars, search inputs, and quiet panels.
- **Paper Elevated** (`paper-elevated`): Slightly brighter than paper, for header surfaces and overlay panels.
- **Paper Deep** (`paper-deep`): The deepest paper step, for hover backgrounds on quiet rows.

### Ink layer (text and rules)

- **Ink** (`ink`): The primary text color, a warm near-black. Body, headings, prose, controls.
- **Ink Muted** (`ink-muted`): Secondary prose, descriptions, sidebar labels.
- **Ink Subtle** (`ink-subtle`): Metadata, dates, kicker labels above titles.
- **Rule** (`rule`): The default hairline color, ink at 14% opacity. Use under headings, between list items, around the rare card.
- **Rule Strong** (`rule-strong`): A heavier rule for hover and current-state borders.

### Signature (oxblood)

- **Signature** (`signature`): The single architectural accent. Use for: primary action backgrounds, current-state left marks (sidebar, rail), focus rings, link hover underlines, code gutter marks, and editorial pull-marks above kicker labels.
- **Signature Strong** (`signature-strong`): The hover and active continuation of signature.
- **Signature Mark** (`signature-mark`): A 12%-opacity oxblood for soft background marks on selected rows.

### Mark (ochre)

- **Mark** (`mark`): A muted ochre. Reserved for the canary badge, warning marks, and inline type-signature highlights (`<T>` annotations).
- **Mark Bg** (`mark-bg`): A 10%-opacity ochre for badge backgrounds.

### Code layer (always dark workbench mode)

These tokens override the page theme inside code blocks and the workbench preview. They never appear on prose surfaces.

- **Code Bg** (`code-bg`): The warm-ink background of all code surfaces.
- **Code Surface** (`code-surface`): One step above the code background, for sidebar files and titlebars.
- **Code Ink** (`code-ink`): The default text color on code surfaces.
- **Code Ink Muted** (`code-ink-muted`): Line numbers, file-path strings, comments.
- **Code Signature** (`code-signature`): Oxblood lifted for AA on dark — used for gutter marks, current-step indicators.
- **Code Mark** (`code-mark`): Ochre lifted for dark — used for type signatures inline.
- **Code Rule** (`code-rule`): Hairline rules between editor panes.

### Dark page mode (opt-in)

A docs-only reading mode that flips the paper layer to warm ink. The signature and mark layers shift to their code-lifted variants. The code layer is unchanged.

### Named rules

**The One Architectural Accent Rule.** Oxblood is structural, not decorative. It marks current state, primary action, and the gutter of typed code. Do not use it as a background wash, a hover highlight on quiet items, or text emphasis on regular prose.

**The Paper Carries the Page Rule.** A surface earns elevation through ink rules and spacing, not through tonal layering. Avoid stacking `paper → paper-subtle → paper-elevated` to imitate cards. One step of paper is enough.

**The Code Is Dark Rule.** Code blocks are always warm-ink. Page theme does not change them. This is the workbench mode, and it is unconditional.

**The No Third Color Rule.** Ochre exists only for the canary badge, warning marks, and inline type-signature annotations. Do not introduce a fourth hue (no green for success, no blue for info). If a state needs distinction beyond signature + mark, use weight, position, or a sharp rule.

## 3. Typography

**Two reading families, one logotype.** IBM Plex Sans carries display, headline, title, body, and prose. IBM Plex Mono carries code, install commands, kickers, and metadata labels. The "trygg" wordmark is the single named exception: it uses Space Grotesk 700 as a logotype only — never as a display face on body, headings, or any text that someone reads. The wordmark is identity, not type.

Hierarchy in reading type is built from scale and weight contrast inside the sans family. Display is Plex Sans 700 at 56px; body is Plex Sans 400 at 16px. The ≥1.25 step ratio is held across the scale so the page reads at a glance.

### Hierarchy

- **Display** (Sans, 700, 56px, 1.04, -0.025em): Hero headline only. One per page.
- **Headline** (Sans, 700, 36px, 1.1, -0.02em): Major section headers and article H1s.
- **Title** (Sans, 600, 20px, 1.3, -0.01em): Card-rare titles, FAQ questions, docs subsection labels.
- **Body** (Sans, 400, 16px, 1.65): UI prose, sidebar text, form labels, control text.
- **Prose** (Sans, 400, 17px, 1.7): Long-form docs reading. Slightly larger than UI body, same family — the page reads as a journal through line height and measure, not through serifs.
- **Wordmark** (Space Grotesk, 700, 17px, 1, -0.015em): The "trygg" logo text in header, home nav, and footer. Loaded as a single weight from Google Fonts. Falls back to Plex Sans 700 if Grotesk fails to load.
- **Label** (Mono, 500, 12px, 0.14em, uppercase): Kickers above titles, metadata, dates, version tags.
- **Mono** (Mono, 400, 13px, 1.6): Inline code, install commands, file paths.

### Named rules

**The Scale-And-Weight Rule.** Hierarchy in reading type is built from scale (≥1.25 step ratio) and weight contrast (400 vs 600/700) inside Plex Sans. Do not introduce italic emphasis, a second display face for headings, or weight steps below 400 to create distinction.

**The Mono Carries Code Rule.** Mono appears in code blocks, install commands, type signatures inline, file paths, kicker labels, and version tags. It is never used as a decorative UI flavor on body prose.

**The Plex-For-Reading Rule.** Anything someone reads (display, headline, title, body, prose, mono, label) uses an IBM Plex family — Sans for words, Mono for code. The serif lane was tried and rejected: serif body + italics is the current AI-slop tell for any framework site that's already left the SaaS-cream lane. Sans + weight contrast is the durable lane.

**The Wordmark-Is-A-Logotype Rule.** The "trygg" wordmark uses Space Grotesk 700 at -0.015em tracking. Space Grotesk is loaded as a single weight and used in exactly three places: site header, home nav, and footer. It is a logotype, not a display face — it never appears on body text, headlines, or any reading surface. Treat the wordmark as a fixed mark; do not extend Grotesk to other UI.

## 4. Elevation

trygg is rule-led, not shadow-led. Visual separation comes from hairline rules, vertical spacing, and type hierarchy. Shadows appear only on the rare floating overlay (search dialog, mobile drawer) where stacking must be explained.

### Shadow vocabulary

- **Floating Overlay** (`0 8px 32px oklch(20% 0.012 60 / 0.12)`): Use only for the search dialog and mobile docs drawer.
- **No card shadows.** Cards rely on rules and backgrounds. No ambient lift, no glow, no glass.

### Named rules

**The Rule-First Rule.** If something needs separation, draw a hairline rule first. Add a background tint only when the rule isn't enough. Reach for a shadow only when one element floats over another.

**The No Glass Rule.** No `backdrop-filter`. The header is a solid paper-elevated surface with a bottom rule. Search dialog uses a paper-elevated panel over a paper-ink scrim, no blur.

## 5. Components

### Buttons

- **Primary**: Oxblood background, paper text, 4px radius, 10px×18px padding. Hover shifts to signature-strong.
- **Secondary**: Transparent background, ink text, 1px ink border, same shape as primary. Hover fills with paper-deep.
- **Tertiary**: Ink text, rule-strong underline, hover underline shifts to oxblood with 2px thickness.
- **Focus**: Always 2px oxblood ring with 2px paper offset, on every interactive element.

### Badges

- **Canary**: Ochre text on mark-bg, 1px ochre border, sharp 0 radius, mono 11px uppercase. Sharp corners signal seriousness.
- **Version**: Mono 12px, oxblood text, no background, used inline next to changelog dates.

### Links

- Body links: ink color, rule-strong underline at 1px offset of 2px. Hover thickens underline to 2px and shifts color to oxblood. No color-only change.
- Code links inside articles: same pattern.
- Navigation links: no underline by default; the active state is a left mark (4px oxblood, full row height), not a fill.

### Tabs (package manager, code variants)

- Container: paper-subtle background, 1px rule, 4px radius.
- Inactive: ink-muted, no background.
- Active: ink text, 2px oxblood rule below (bottom-border style), no fill.
- Focus: 2px oxblood ring, 0 offset (contained in the tab group).

### Cards (used sparingly)

Cards exist only when content is genuinely card-shaped (a release entry, a search result panel). When they appear:

- 0 radius (sharp corners) or 4px (soft).
- 1px rule border, paper-elevated background.
- No shadow. No nested cards.
- Hover: rule color shifts to rule-strong; no background change.

### Code blocks

Code blocks are always dark workbench surfaces.

- Background: code-bg (warm ink, always — never the page paper).
- Body: Plex Mono 13px, code-ink color, generous horizontal padding.
- Header: code-surface bg, mono 12px, file path in code-ink-muted, copy mark top-right.
- Line numbers: code-ink-muted, mono 11px, right-aligned.
- Gutter mark: 2px oxblood left rule on typed-result lines (where shown).
- Type signatures inline: code-mark (ochre).

### Navigation

- **Site header**: Paper-elevated background, 1px rule bottom, 64px tall, no backdrop-blur. Wordmark in Space Grotesk 700.
- **Docs sidebar**: 240px wide, paper-subtle bg, mono 11px group labels, sans 14px links. Active link gets a 4px oxblood left mark and ink text — no pill, no background fill. Landmark must carry `aria-label="Documentation navigation"`.
- **Docs rail (on-this-page)**: Ink-subtle text, 2px ink-subtle left rule, current heading shifts to ink color with oxblood left rule. Landmark labelled "On this page".
- **Footer**: Paper-elevated bg, 1px rule top, two thin rows: link columns + copyright row. Wordmark in Space Grotesk 700.

### Editorial patterns (in place of card grids)

These compositions replace the identical-card-grid trap:

- **Indexed list**: `01 / 02 / 03` numbered runs. Each item gets a full-width rule above and a mono label. Used for: home feature run, docs topic index, 404 escape list.
- **Mapped pair**: Two-column layout where left is a sticky kicker (mono label + 1-2 word title) and right is full prose. Used for: docs section intros.
- **Editor cutaway**: Real editor pane (code-bg) embedded in flow with an oxblood gutter mark on typed lines. Used for: home workbench, docs examples.
- **Annotated timeline**: Left-rule with date stamps and prose blocks. Used for: changelog. Replaces release-card-per-version.
- **Topic index**: Editorial index (kicker + title + leader-dots + reading-time mark). Used for: docs landing. Replaces 3-col docs cards.

## 6. Do's and Don'ts

### Do:

- **Do** use oxblood for primary action, current state, focus, and code gutter marks.
- **Do** treat prose pages like journal pages: sans body at 17px, generous line height, 65–75ch max line length.
- **Do** keep code surfaces dark even on light pages — the workbench is intrinsically inked.
- **Do** use indexed lists, mapped pairs, and annotated timelines instead of card grids.
- **Do** render canary status as a sharp ochre badge with mono label, not a pill with a glow.
- **Do** build hierarchy from scale and weight (400 vs 600/700) inside Plex Sans.

### Don't:

- **Don't** use purple in any UI surface (avoid Vercel mimicry).
- **Don't** use lime, mint, or any bright green (avoid foldkit + Mintlify mimicry).
- **Don't** use gradient backgrounds, gradient text, glass blur, or ambient card shadows.
- **Don't** wrap groups of features into identical-card grids.
- **Don't** put side-stripe colored borders on list items, cards, or callouts.
- **Don't** introduce a third hue beyond signature + mark.
- **Don't** introduce a serif lane — Plex Serif was tried and rejected (AI-slop second-order reflex).
- **Don't** extend Space Grotesk past the "trygg" wordmark. It is a logotype, not a display face for headings or body.
- **Don't** use italic emphasis to differentiate prose — weight contrast is the lane.
- **Don't** flip code blocks to a light surface in light mode — code is always dark.
