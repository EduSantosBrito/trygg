---
name: trygg
description: Effect-native UI documentation for developers who want components to compose like Effects. Editorial paper surfaces, oxblood architecture, dark workbench code, and a pixel-ladder mark.
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
  signature-rule: "oklch(42% 0.14 25 / 0.42)"
  mark: "oklch(58% 0.13 70)"
  mark-bg: "oklch(58% 0.13 70 / 0.12)"
  mark-rule: "oklch(58% 0.13 70 / 0.4)"
  code-bg: "oklch(16% 0.01 50)"
  code-surface: "oklch(19% 0.012 50)"
  code-elevated: "oklch(22% 0.014 50)"
  code-ink: "oklch(94% 0.005 70)"
  code-ink-muted: "oklch(68% 0.012 55)"
  code-ink-subtle: "oklch(52% 0.012 50)"
  code-signature: "oklch(72% 0.14 28)"
  code-signature-rule: "oklch(72% 0.14 28 / 0.45)"
  code-mark: "oklch(78% 0.12 80)"
  code-rule: "oklch(94% 0.005 70 / 0.1)"
  code-rule-strong: "oklch(94% 0.005 70 / 0.22)"
  header-bg: "oklch(99% 0.003 70 / 0.96)"
  brand-mark: "#892122"
  dark-paper: "oklch(11% 0.008 50)"
  dark-paper-subtle: "oklch(14% 0.01 50)"
  dark-paper-elevated: "oklch(16% 0.012 50)"
  dark-paper-deep: "oklch(19% 0.014 50)"
  dark-ink: "oklch(94% 0.005 70)"
  dark-ink-muted: "oklch(70% 0.012 60)"
  dark-ink-subtle: "oklch(55% 0.012 50)"
  dark-rule: "oklch(94% 0.005 70 / 0.1)"
  dark-rule-strong: "oklch(94% 0.005 70 / 0.22)"
  dark-signature: "oklch(72% 0.14 28)"
  dark-signature-strong: "oklch(78% 0.14 28)"
  dark-signature-mark: "oklch(72% 0.14 28 / 0.16)"
  dark-signature-rule: "oklch(72% 0.14 28 / 0.46)"
  dark-mark: "oklch(78% 0.12 80)"
  dark-mark-bg: "oklch(78% 0.12 80 / 0.14)"
  dark-mark-rule: "oklch(78% 0.12 80 / 0.4)"
  dark-header-bg: "oklch(11% 0.008 50 / 0.92)"
typography:
  display:
    fontFamily: "IBM Plex Sans, system-ui, -apple-system, sans-serif"
    fontSize: "clamp(2.5rem, calc(1.5rem + 3vw), 4.5rem)"
    fontWeight: 700
    lineHeight: 1
    letterSpacing: "-0.035em"
  headline:
    fontFamily: "IBM Plex Sans, system-ui, -apple-system, sans-serif"
    fontSize: "clamp(2rem, 4vw, 3rem)"
    fontWeight: 700
    lineHeight: 1.05
    letterSpacing: "-0.03em"
  title:
    fontFamily: "IBM Plex Sans, system-ui, -apple-system, sans-serif"
    fontSize: "1.125rem"
    fontWeight: 600
    lineHeight: 1.3
    letterSpacing: "-0.005em"
  body:
    fontFamily: "IBM Plex Sans, system-ui, -apple-system, sans-serif"
    fontSize: "1rem"
    fontWeight: 400
    lineHeight: 1.65
    letterSpacing: "normal"
  prose:
    fontFamily: "IBM Plex Sans, system-ui, -apple-system, sans-serif"
    fontSize: "1.0625rem"
    fontWeight: 400
    lineHeight: 1.7
    letterSpacing: "normal"
  wordmark:
    fontFamily: "Space Grotesk, IBM Plex Sans, system-ui, sans-serif"
    fontSize: "1.125rem"
    fontWeight: 700
    lineHeight: 1
    letterSpacing: "-0.015em"
  label:
    fontFamily: "IBM Plex Mono, ui-monospace, SF Mono, monospace"
    fontSize: "0.6875rem"
    fontWeight: 500
    lineHeight: 1.4
    letterSpacing: "0.14em"
  mono:
    fontFamily: "IBM Plex Mono, ui-monospace, SF Mono, monospace"
    fontSize: "0.8125rem"
    fontWeight: 400
    lineHeight: 1.65
    letterSpacing: "0"
rounded:
  none: "0px"
  hair: "2px"
  xs: "3px"
  sm: "4px"
  md: "6px"
  lg: "8px"
  pill: "999px"
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
    padding: "0.6875rem 1.375rem"
  button-secondary:
    backgroundColor: "transparent"
    textColor: "{colors.ink}"
    typography: "{typography.body}"
    rounded: "{rounded.sm}"
    padding: "0.6875rem 1.375rem"
  button-compact:
    backgroundColor: "transparent"
    textColor: "{colors.ink}"
    typography: "{typography.mono}"
    rounded: "{rounded.sm}"
    padding: "0.5rem 0.75rem"
  canary-badge:
    backgroundColor: "{colors.mark-bg}"
    textColor: "{colors.mark}"
    typography: "{typography.label}"
    rounded: "{rounded.none}"
    padding: "0.1875rem 0.5rem"
  search-trigger:
    backgroundColor: "{colors.paper-elevated}"
    textColor: "{colors.ink-muted}"
    typography: "{typography.mono}"
    rounded: "{rounded.sm}"
    padding: "0.375rem 0.75rem"
  command:
    backgroundColor: "{colors.code-bg}"
    textColor: "{colors.code-ink}"
    typography: "{typography.mono}"
    rounded: "{rounded.md}"
    padding: "0.875rem 0.875rem 0.875rem 1.125rem"
  code-block:
    backgroundColor: "{colors.code-bg}"
    textColor: "{colors.code-ink}"
    typography: "{typography.mono}"
    rounded: "{rounded.lg}"
    padding: "1rem 1.25rem"
  workbench-tab-active:
    backgroundColor: "transparent"
    textColor: "{colors.code-ink}"
    typography: "{typography.label}"
    rounded: "{rounded.none}"
    padding: "0.5rem 0.75rem 0.5rem 0.875rem"
  theme-toggle:
    backgroundColor: "transparent"
    textColor: "{colors.ink-muted}"
    rounded: "{rounded.sm}"
    height: "2.75rem"
    width: "2.75rem"
  inline-code:
    backgroundColor: "{colors.paper-deep}"
    textColor: "{colors.ink}"
    typography: "{typography.mono}"
    rounded: "{rounded.sm}"
    padding: "0.125rem 0.375rem"
---

# Design System: trygg

## 1. Overview

**Creative North Star: "The typed workbench"**

trygg now reads as a product documentation system built around one proof: component capabilities are visible in the type. The page surface is quiet editorial paper; the product truth appears inside dark workbench panels, type signatures, file tabs, terminal rows, and inline symbol tooltips. The brand mark is a pixel ladder in oxblood, so the identity feels computational without becoming terminal cosplay.

The physical scene is concrete: an Effect developer is reading docs beside an editor, checking whether props, typed failures, and service requirements stay explicit. The interface must let the code carry authority. Oxblood marks primary action and current state; ochre marks canary status and typed-failure annotations; paper and ink do the rest.

The current source of truth is `apps/www/styles.css`, `apps/www/public/mark.svg`, and the components under `apps/www/app/components`. The older "Typed on paper" language is still directionally right, but the live brand is more workbench-forward: command rows, code panes, active file tabs, and typed-signature legends are the signature pieces.

**Key Characteristics:**

- Paper surfaces with fixed hairline rules, not raised card stacks.
- Oxblood as architectural signature: primary action, active nav, focus, typed service marks, code gutters.
- A pixel-ladder mark in fixed oxblood, paired with a Space Grotesk wordmark only.
- Dark workbench code surfaces on every theme.
- Editorial lists, mapped pairs, timelines, and topic indexes instead of repeated icon cards.
- Product-speed motion: 150ms to 220ms state changes, no entrance choreography.
- Keyboard-first controls: visible focus, tabbed workbench, command search, mobile docs drawer.

## 2. Colors

The palette is restrained and source-owned in OKLCH. Paper carries the site, warm ink carries text, and oxblood carries structure. Dark mode is a docs reading mode that flips paper and ink while keeping code surfaces dark.

### Primary

- **Oxblood Signature** (`signature`, `signature-strong`, `signature-rule`, `signature-mark`): Primary actions, active navigation, focus rings, hero accent words, typed-service annotations, code gutter marks, and link hover underlines. It is structural, not decorative.
- **Pixel-Ladder Mark** (`brand-mark`): The SVG logo uses fixed oxblood rectangles with opacity steps. Treat the mark as an asset, not a general color ramp.

### Secondary

- **Canary Ochre** (`mark`, `mark-bg`, `mark-rule`): Canary badge, warning-adjacent status, and typed-failure highlights inside the component type legend. It is not a success, info, or decoration color.

### Neutral

- **Paper Layer** (`paper`, `paper-subtle`, `paper-elevated`, `paper-deep`): Default page, sidebar, header, hover, and quiet panel surfaces. Use one paper step at a time; do not stack tonal panels to fake depth.
- **Ink Layer** (`ink`, `ink-muted`, `ink-subtle`, `rule`, `rule-strong`): Headings and controls use `ink`; body and secondary prose use `ink-muted`; labels and metadata may use `ink-subtle` only when the text is short and non-critical.
- **Dark Reading Layer** (`dark-paper`, `dark-ink`, `dark-signature`, `dark-mark`): Opt-in docs reading mode. It flips page tokens only. The code layer does not change.
- **Code Layer** (`code-bg`, `code-surface`, `code-elevated`, `code-ink`, `code-ink-muted`, `code-ink-subtle`, `code-signature`, `code-mark`, `code-rule`): Always dark workbench surfaces for code blocks, install commands, home workbench, copied tooltip, and token tooltips.

### Named Rules

**The Workbench-Is-Dark Rule.** Code, terminal rows, typed signatures, and symbol tooltips stay on the dark code layer in every page theme. Do not create light code panels.

**The One Structural Accent Rule.** Oxblood is for action and state: primary buttons, active nav, focus, selected file, service type marks. Do not use it as a wash, decorative background, or body text emphasis.

**The Ochre-Is-Canary Rule.** Ochre exists for canary status and typed-failure annotations. Do not add green success, blue info, purple framework accents, or extra state hues unless the source code grows a real semantic system.

**The Contrast Floor Rule.** Body text must use `ink` or `ink-muted` on paper. `ink-subtle` is metadata only, never placeholder text, paragraph copy, or button text.

## 3. Typography

- **Display Font:** IBM Plex Sans with system fallbacks
- **Body Font:** IBM Plex Sans with system fallbacks
- **Label/Mono Font:** IBM Plex Mono with SF Mono fallback
- **Wordmark Font:** Space Grotesk 700, only for the `trygg` wordmark

The typography is a single-sans product documentation system. Plex Sans handles display, docs prose, nav, buttons, and dense UI labels. Plex Mono handles code, terminal commands, metadata labels, file paths, keycaps, and type signatures. Space Grotesk is a fixed wordmark treatment, never a display face.

### Hierarchy

- **Display** (700, `clamp(2.5rem, calc(1.5rem + 3vw), 4.5rem)`, 1, -0.035em): Home hero only. The accent word may turn oxblood, but the sentence stays readable without the color.
- **Docs H1** (700, `clamp(2.25rem, 5vw, 3.5rem)`, 1.02, -0.025em): Docs landing and article headers.
- **Headline** (700, `clamp(2rem, 4vw, 3rem)`, 1.05, -0.03em): Major landing sections and changelog titles.
- **Section Title** (600, `1.125rem` to `1.5rem`, 1.3, slight negative tracking): Step rows, topic links, FAQ-style titles, docs subsections.
- **Body** (400, `1rem`, 1.65): UI copy, controls, footer copy, list descriptions.
- **Prose** (400, `1.0625rem`, 1.7 to 1.75): Long-form docs and article bodies. Keep line length around 65 to 75ch.
- **Label** (Mono 500, `0.6875rem`, 0.14em, uppercase): Group labels, kickers, keycaps, status chips, and metadata. Use it sparingly so it reads as orientation, not decoration.
- **Mono** (Mono 400, `0.8125rem`, 1.65): Code blocks, file paths, install commands, inline code, tooltip signatures.
- **Wordmark** (Space Grotesk 700, `1.125rem` in header, `1.25rem` in footer): Logo text only.

### Named Rules

**The Plex-For-Reading Rule.** Anything someone reads uses Plex Sans or Plex Mono. Do not introduce a serif lane, display novelty, or italic emphasis.

**The Wordmark-Stays-A-Mark Rule.** Space Grotesk appears only as the `trygg` wordmark in header and footer. Do not extend it to headings, body, buttons, or labels.

**The Label-Sparsity Rule.** Monospace uppercase labels are allowed for navigation and code-adjacent orientation. They are forbidden as default section seasoning.

## 4. Elevation

trygg is flat by default. Separation comes from hairline rules, spacing, and state color. Shadows appear only when an element physically floats above the document, such as search, mobile drawer, and code-token tooltips.

### Shadow Vocabulary

- **Search Overlay** (`0 12px 40px oklch(20% 0.012 60 / 0.16)`): Search dialog panel over the scrim.
- **Mobile Drawer** (`0 0 24px oklch(20% 0.012 60 / 0.16)`): Mobile docs drawer only.
- **Code Tooltip** (`0 14px 32px oklch(0% 0 0 / 0.4)`): Token tooltip on code-elevated surface.
- **None Elsewhere:** Buttons, lists, docs panels, topic rows, changelog entries, and code blocks do not get ambient shadows.

### Named Rules

**The Rule-First Rule.** If a surface needs separation, draw a hairline rule before adding a background. Add a shadow only when an element overlays other content.

**The No-Glass Rule.** No decorative `backdrop-filter`. Current source has small code overlay badges with translucent fills; do not expand that into glass panels, blurred headers, or frosted cards.

**The No-Card-Stack Rule.** Repeated content uses rules, indexes, mapped pairs, and timelines. Cards are rare and flat.

## 5. Components

### Brand Mark and Wordmark

The mark is a 40 by 48 pixel ladder made from 7px rectangles in oxblood opacity steps. It sits next to the Space Grotesk `trygg` wordmark in header and footer. Do not redraw it as an icon, gradient, mascot, shield, or monogram.

### Buttons

- **Shape:** Compact rectangle with a 4px radius.
- **Primary:** Oxblood fill, paper text, 0.9375rem Plex Sans 500, 0.6875rem by 1.375rem padding on landing, 0.625rem by 1.125rem in docs.
- **Secondary:** Transparent, 1px ink border, ink text, same shape. Hover fills with `paper-deep`.
- **Compact:** 0.8125rem text, 0.5rem by 0.75rem padding, used for small controls.
- **Focus:** 2px oxblood outline with 2px offset, always visible on keyboard focus.

### Header, Footer, and Theme Toggle

- **Header:** Fixed, 4rem minimum height, `header-bg`, 1px bottom rule, no blur. Active nav uses a 2px oxblood underline with 6px offset.
- **Theme Toggle:** 2.75rem square, 4px radius, transparent background, 1px rule border, current theme icon only.
- **Footer:** Paper-elevated with a top rule, brand block on the left, resource and community nav groups on the right, mono uppercase section labels.

### Canary Badge

Sharp rectangular badge with mono uppercase text, ochre border, ochre translucent background, and 0 radius. It appears by the wordmark and links to the changelog. Do not make it a pill, glowing status, or generic yellow warning.

### Search

- **Trigger:** Paper-elevated rectangle, 4px radius, 1px strong rule, body-sized text plus a mono keycap.
- **Dialog:** Fixed overlay with ink scrim, paper-elevated panel, 4px radius, search shadow, and a top input with a bottom rule.
- **Results:** Full-width rows, no cards. Active and hover states use `paper-subtle`, not color fills.

### Navigation

- **Docs Sidebar:** Sticky column, grouped by mono uppercase labels. Active item uses a 2px oxblood left rule, stronger text, and no pill fill.
- **On This Page Rail:** Left-rule list, current heading uses a 2px oxblood rule and stronger text.
- **Mobile Drawer:** Full-height paper-elevated drawer with right rule and drawer shadow. Backdrop uses ink opacity, not blur.

### Code Blocks and Workbench

- **Code Blocks:** Dark `code-bg`, 8px radius, strong code rule border, Plex Mono, line numbers in `code-ink-subtle`, optional header row with file metadata and copy control.
- **Home Workbench:** Dark editor window with code-surface titlebar, file tabs, code editor, and terminal row. Active file uses a 2px code-signature rule. On narrow viewports, file tabs move from a left rail to a horizontal tab strip.
- **Terminal Command:** Dark code row, 6px radius, prompt in code-signature, command in code-ink, copy button as a small bordered control.
- **Token Tooltips:** Fixed-position dark tooltip on `code-elevated`, dismissable with Escape, hoverable, focusable, and shadowed only because it floats.

### Editorial Patterns

- **Typed Signature Legend:** Dark signature block plus rule-separated label rows. The three slots are props, typed failures, and service requirements.
- **Indexed Lists:** Full-width rows with mono numbers and hairline rules. Used for getting-started paths, seam steps, not-found links, and docs indexes.
- **Mapped Pairs:** Sticky left labels with prose and examples on the right. Used for step sections and docs teaching flow.
- **Annotated Timeline:** Changelog uses a vertical rule with date column and dot markers, not release cards.
- **Topic Index:** Docs landing groups links by model area, with rules and metadata rather than a card grid.

## 6. Do's and Don'ts

### Do:

- **Do** use `apps/www/styles.css` as the visual source of truth before editing this file again.
- **Do** use oxblood for primary action, active state, focus, selected file, and type-service marks.
- **Do** keep all code, terminal, command, and tooltip surfaces on the dark workbench layer.
- **Do** use paper, rules, and spacing for structure before reaching for a panel.
- **Do** keep body copy concrete: props, typed errors, service dependencies, layers, signals, generated clients.
- **Do** use indexed lists, mapped pairs, topic indexes, and timelines instead of repeated icon-heading-text cards.
- **Do** keep motion to state feedback in the 150ms to 220ms range, with reduced-motion fallbacks.
- **Do** keep every interactive control keyboard reachable with visible focus.

### Don't:

- **Don't** make generic SaaS landing pages with vague productivity claims.
- **Don't** frame trygg as a React clone or explain the product only through comparison.
- **Don't** use academic functional-programming presentation that feels distant from building apps.
- **Don't** use purple Vercel mimicry.
- **Don't** use lime-on-cream foldkit mimicry, or any framework site identity owned by a competitor.
- **Don't** use mint-wash Mintlify mimicry or gradient-card OpenAI mimicry.
- **Don't** use terminal-only hacker aesthetic that makes the product feel narrower than it is.
- **Don't** add decorative complexity that hides the mental model or weakens navigation.
- **Don't** use identical icon-heading-text card grids to fill space.
- **Don't** use gradient text, decorative glass, ambient card shadows, or colored side stripes on cards, callouts, or alerts.
- **Don't** introduce a serif lane, italic prose emphasis, or extra display fonts.
- **Don't** extend Space Grotesk beyond the wordmark.
- **Don't** turn ochre into a generic warning system or add green, blue, purple, or neon state colors without a real semantic need.
- **Don't** use `ink-subtle` for placeholder text, paragraph copy, or small critical labels.
