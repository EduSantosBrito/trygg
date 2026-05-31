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
      {
        label: "Tutorial",
        href: "/docs/tutorial",
        description:
          "Build an incident tracker end to end: routing, a service, a resource, signals, and a typed error boundary.",
      },
    ],
  },
  {
    label: "Concepts",
    links: [
      {
        label: "How trygg works",
        href: "/docs/concepts/how-it-works",
        description:
          "JSX becomes an element tree, the renderer mounts it once, and signals update real DOM nodes directly. No virtual DOM, no re-renders.",
      },
      {
        label: "You already know Effect",
        href: "/docs/concepts/effect",
        description:
          "Components are Effects. Services, typed errors, and layers work the way they already do, so the framework has almost no new surface to learn.",
      },
      {
        label: "Thinking in trygg",
        href: "/docs/concepts/thinking",
        description:
          "The mental shifts coming from React, Solid, or Vue: components run once, state is signals, cleanup is scope-based.",
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
        description: "Construct, inspect, and transform the tree JSX compiles to, for codegen and tooling.",
        primaryExport: "Element",
      },
      {
        label: "Renderer",
        href: "/docs/renderer",
        description:
          "Mount trygg element trees, wire browser layers, and understand the render boundary.",
        primaryExport: "Renderer",
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
        label: "Class names",
        href: "/docs/cx",
        description: "Compose conditional className strings without a runtime dependency.",
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
        label: "Overview",
        href: "/docs/router/overview",
        description: "The routing mental model: how routes, layouts, and the outlet fit together.",
      },
      {
        label: "Defining routes",
        href: "/docs/router/routes",
        description: "Build a route with the fluent builder: components, typed params, and guards.",
      },
      {
        label: "Route collections",
        href: "/docs/router/collections",
        description:
          "Assemble routes into a tree, declare the not-found route, and emit the manifest.",
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
        label: "Layouts and outlet",
        href: "/docs/router/layouts",
        description: "Share route chrome through nested layout boundaries and the outlet.",
      },
      {
        label: "Prefetching",
        href: "/docs/router/prefetch",
        description: "Warm a route's component and data before the click so navigation feels instant.",
      },
      {
        label: "Render strategies",
        href: "/docs/router/render-strategy",
        description: "Choose when a route's component loads and renders: eager, lazy, or on intent.",
      },
      {
        label: "Scroll restoration",
        href: "/docs/router/scroll-strategy",
        description: "Control scroll position across navigations: restore, reset, or preserve.",
      },
      {
        label: "Route matching",
        href: "/docs/router/matching",
        description: "The lower-level matcher for custom navigation surfaces.",
      },
      {
        label: "Route types",
        href: "/docs/router/types",
        description: "The type vocabulary that makes wrong paths and missing params compile errors.",
      },
    ],
  },
  {
    label: "Tooling",
    links: [
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
        label: "API types",
        href: "/docs/api-types",
        description: "Generated same-origin API client types for app APIs.",
      },
      {
        label: "Testing",
        href: "/docs/testing",
        description: "Render components under test layers and assert UI behavior.",
      },
      {
        label: "Deployment",
        href: "/docs/deployment",
        description: "Choose a platform and output mode, build, and run the production server or static assets.",
      },
    ],
  },
  {
    label: "Patterns",
    links: [
      {
        label: "Global storage",
        href: "/docs/patterns/global-storage",
        description:
          "Share state across the tree with a Service that owns Signals and typed write methods.",
      },
      {
        label: "Forms and inputs",
        href: "/docs/patterns/forms",
        description:
          "Bind inputs to signals, read values in handlers, and validate on submit with typed errors.",
      },
    ],
  },
];
