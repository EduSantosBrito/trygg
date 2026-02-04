---
name: trygg-router
description: trygg declarative router — Route builder, Schema-validated params/query, middleware composition, layouts, render/scroll strategies, link prefetching, data prefetching, trie-based matching, type-safe navigation, and Outlet component. Use when defining routes, adding middleware/guards, configuring lazy/eager loading, implementing layouts with nested Outlet, prefetching modules or data, handling 404/forbidden/error boundaries on routes, working with Router.Link or programmatic navigation, debugging route matching priority, or testing with Router.testLayer.
license: MIT
metadata:
  author: EduSantosBrito
  version: "0.1.0-canary.0"
---

# trygg Router

Declarative routing with Schema-validated params, middleware composition, and Layer-based rendering strategies.

## Decision Tree

```
What are you building?
|
+-- Defining routes?
|   +-- Single route: Route.make("/path").component(Comp)
|   +-- With params: .params(Schema.Struct({ id: Schema.NumberFromString }))
|   +-- With query: .query(Schema.Struct({ q: Schema.String }))
|   +-- Index route: Route.index(Component)
|   +-- Nested: .children(Route.make("/child").component(...))
|   See: references/router.md §Route Builder, §Path Params, §Query Params
|
+-- Middleware / guards?
|   +-- .middleware(effect) — runs before render, left-to-right
|   +-- Route.redirect("/path") for redirects
|   +-- Route.forbidden() for 403
|   +-- Provide services via Route.provide(layer)
|   See: references/router.md §Middleware
|
+-- Layouts?
|   +-- .layout(LayoutComponent) — renders <Router.Outlet /> for children
|   +-- Layouts stack root-to-leaf, persist during child navigation
|   See: references/router.md §Layouts
|
+-- Loading / error / 404 / forbidden boundaries?
|   +-- .loading(Comp), .error(Comp), .notFound(Comp), .forbidden(Comp)
|   +-- Nearest-wins resolution walking up from route to ancestors
|   See: references/router.md §Boundary Components
|
+-- Render strategy?
|   +-- Lazy (default): dynamic import at render time
|   +-- Eager: Route.provide(RenderStrategy.Eager)
|   See: references/router.md §Render Strategy
|
+-- Navigation?
|   +-- <Router.Link to="/path" params={...} query={...} />
|   +-- Programmatic: router.navigate, router.back, router.forward
|   +-- Active detection: Router.isActive("/path", { exact: true })
|   See: references/router.md §Navigation
|
+-- Prefetching?
|   +-- Link prefetch: "intent" | "viewport" | "render" | false
|   +-- Data prefetch: .prefetch(({ params }) => Effect.succeed(resource))
|   +-- Programmatic: Router.prefetch("/path")
|   See: references/router.md §Link Prefetching, §Data Prefetching
|
+-- Testing?
|   +-- Router.testLayer("/initial/path") — in-memory, no DOM
|   See: references/router.md §Testing
```

## Core Rules

1. **All paths start with `/`** — relative to parent in children
2. **`.component()` and `.children()` are mutually exclusive**
3. **Schema keys must match path params exactly** — type-enforced
4. **`.add()` enforces `R = never`** — provide layers before adding to Routes
5. **Trie matching priority**: static (3) > param (2) > required catch-all (1.5) > optional catch-all (1)

## Reference Files

| File | When to Read |
|------|-------------|
| [router.md](references/router.md) | Full router API: Route builder, params, middleware, layouts, strategies, navigation, prefetching, testing |
