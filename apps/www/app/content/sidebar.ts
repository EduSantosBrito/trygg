export interface SidebarLink {
  readonly label: string;
  readonly href: string;
  readonly description?: string;
  readonly primaryExport?: string;
}

export interface SidebarGroup {
  readonly label: string;
  readonly links: readonly SidebarLink[];
}

export const sidebarGroups: readonly SidebarGroup[] = [
  {
    label: "Start",
    links: [
      {
        label: "Docs home",
        href: "/docs",
        description: "Orient yourself, choose the right path, and see how the docs are organized.",
      },
      {
        label: "Getting started",
        href: "/docs/getting-started",
        description: "Create a canary app, install dependencies, and run the local dev server.",
      },
    ],
  },
  {
    label: "Core model",
    links: [
      {
        label: "Components",
        href: "/docs/components",
        description: "Generator-based components with typed props, errors, and requirements.",
        primaryExport: "Component",
      },
      {
        label: "Elements",
        href: "/docs/elements",
        description: "The low-level element model produced by the JSX runtime.",
        primaryExport: "Element",
      },
      {
        label: "Signals",
        href: "/docs/signals",
        description: "Fine-grained reactive state that updates DOM nodes directly.",
        primaryExport: "Signal",
      },
      {
        label: "Resources",
        href: "/docs/resources",
        description: "Async data fetching with cache keys, invalidation, and refresh semantics.",
        primaryExport: "Resource",
      },
      {
        label: "Error boundaries",
        href: "/docs/error-boundary",
        description: "Typed render recovery for component failures.",
        primaryExport: "ErrorBoundary",
      },
    ],
  },
  {
    label: "Composition",
    links: [
      {
        label: "Portal",
        href: "/docs/portal",
        description: "Render a subtree into another DOM target.",
        primaryExport: "Portal",
      },
      {
        label: "Head",
        href: "/docs/head",
        description: "Hoist document metadata from route and component boundaries.",
        primaryExport: "Head",
      },
      {
        label: "cx",
        href: "/docs/cx",
        description: "Compose class names from values, arrays, objects, and signals.",
        primaryExport: "cx",
      },
      {
        label: "Security",
        href: "/docs/security",
        description: "Understand safe URL handling and browser-facing constraints.",
      },
    ],
  },
  {
    label: "Routing",
    links: [
      {
        label: "Routes",
        href: "/docs/router/routes",
        description: "Declare route trees, layouts, and route components.",
      },
      {
        label: "Links",
        href: "/docs/router/links",
        description: "Navigate with typed link components and active route state.",
      },
      {
        label: "Navigation",
        href: "/docs/router/navigation",
        description: "Move between routes from Effect-aware UI code.",
      },
      {
        label: "Params",
        href: "/docs/router/params",
        description: "Read path params with schema-backed route definitions.",
      },
      {
        label: "Query params",
        href: "/docs/router/query-params",
        description: "Model search params without hiding URL state.",
      },
      {
        label: "Layouts",
        href: "/docs/router/layouts",
        description: "Share route chrome through nested layout boundaries.",
      },
      {
        label: "Middleware",
        href: "/docs/router/middleware",
        description: "Redirect or guard routes before rendering.",
      },
      {
        label: "Prefetch",
        href: "/docs/router/prefetch",
        description: "Warm route modules when navigation intent is clear.",
      },
      {
        label: "Scroll",
        href: "/docs/router/scroll",
        description: "Control route scroll behavior and document anchors.",
      },
      {
        label: "Not found",
        href: "/docs/router/not-found",
        description: "Handle route misses with clear recovery paths.",
      },
    ],
  },
  {
    label: "Integration",
    links: [
      {
        label: "JSX runtime",
        href: "/docs/jsx-runtime",
        description: "How JSX lowers into trygg elements at build time.",
      },
      {
        label: "JSX dev runtime",
        href: "/docs/jsx-dev",
        description: "Development metadata and diagnostics for JSX output.",
      },
      {
        label: "API types",
        href: "/docs/api-types",
        description: "Generated same-origin API client types for app APIs.",
      },
      {
        label: "Config",
        href: "/docs/config",
        description: "Choose runtime platform and build output mode.",
      },
      {
        label: "Vite plugin",
        href: "/docs/vite-plugin",
        description: "Wire route generation, API modules, and build artifacts into Vite.",
      },
      {
        label: "Testing",
        href: "/docs/testing",
        description: "Render components under test layers and assert UI behavior.",
      },
      {
        label: "Debug",
        href: "/docs/debug",
        description: "Observe framework-level events while developing.",
      },
      {
        label: "Metrics",
        href: "/docs/metrics",
        description: "Collect low-level framework metrics and sinks.",
      },
    ],
  },
];
