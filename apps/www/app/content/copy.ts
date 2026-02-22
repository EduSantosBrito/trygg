/**
 * Landing page copy tokens.
 *
 * All user-facing copy is centralized here for:
 * - Type safety (literal types prevent copy drift)
 * - CI validation against banned claims
 * - Single source of truth for marketing copy
 *
 * @see specs/landing-page-trygg.md Section 4.4
 */

export interface LandingCopy {
  readonly heroTitle: string;
  readonly heroSubtitle: string;
  readonly canaryWarning: string;
  readonly primaryCtaLabel: "Try trygg";
  readonly primaryCtaHref: string;
}

export const copy: LandingCopy = {
  heroTitle: "Effect-native UI, type-safe by design.",
  heroSubtitle:
    "Fine-grained reactivity without a virtual DOM. Dependency injection built in. Components that compose like Effects.",
  canaryWarning: "Canary — breaking changes expected",
  primaryCtaLabel: "Try trygg",
  primaryCtaHref: "#install",
} as const;

/**
 * Section-specific copy tokens.
 */
export const sections = {
  builtOnEffect: {
    statement: "Built on Effect — the type-safe platform for TypeScript.",
    linkText: "Learn about Effect",
    linkHref: "https://effect.website",
  },

  features: {
    heading: "Built for Effect developers",
    cards: [
      {
        title: "Component.gen",
        description:
          "Generator-based components with full type inference. Yield services, handle errors, compose naturally.",
      },
      {
        title: "Signal Primitives",
        description:
          "Fine-grained reactivity with automatic dependency tracking. No virtual DOM diffing overhead.",
      },
      {
        title: "Layer & Context",
        description:
          "Dependency injection via Effect's Layer system. Services are provided, never imported.",
      },
      {
        title: "Typed Router",
        description:
          "Type-safe routing with params, search, and layouts. Navigation errors caught at compile time.",
      },
      {
        title: "Resource Management",
        description:
          "Scoped resources with automatic cleanup. Async data fetching with loading and error states.",
      },
      {
        title: "Error Boundaries",
        description: "Typed error handling with recovery. Observable spans and metrics built in.",
      },
    ],
  },

  install: {
    heading: "Start building",
    command: "bunx create-trygg@canary my-app",
  },

  faq: {
    heading: "Common questions",
    questions: [
      {
        q: "Is this production-ready?",
        a: "No. Trygg is in canary. APIs will change. Use it to explore and contribute, not for production workloads.",
      },
      {
        q: "Do I need to know Effect?",
        a: "Basic familiarity helps. You'll use Effect.gen, Layer, and Context. The docs cover what you need.",
      },
      {
        q: "Does this replace React?",
        a: "It's an alternative, not a replacement. Trygg targets teams already using Effect who want UI that fits the same patterns.",
      },
    ],
  },

  community: {
    heading: "Join the community",
    github: {
      label: "GitHub",
      href: "https://github.com/EduSantosBrito/trygg",
    },
  },

  footer: {
    links: [
      { label: "Docs", href: "https://docs.trygg.dev" },
      { label: "GitHub", href: "https://github.com/EduSantosBrito/trygg" },
      { label: "npm", href: "https://www.npmjs.com/package/trygg" },
      {
        label: "MIT License",
        href: "https://github.com/EduSantosBrito/trygg/blob/main/LICENSE",
      },
    ],
  },
} as const;
