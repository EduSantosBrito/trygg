# Ubiquitous Language

## Core model

| Term | Definition | Aliases to avoid |
| ----------- | ------------------------------------------------------- | --------------------- |
| **trygg** | An Effect-native UI framework with JSX, fine-grained reactivity, and built-in dependency injection. | library, wrapper |
| **Component** | An Effect-backed UI unit created with `Component.gen` that can yield services and props before producing UI. | view, widget |
| **Element** | The normalized tagged data shape that represents JSX output before the renderer mounts it. | node, vnode |
| **Service** | A dependency read from Effect context by a component or effect. | dependency, context value |
| **Layer** | A provider of one or more services that satisfies component or app requirements. | provider, module |
| **Renderer** | The runtime that turns an `Element` tree into DOM and preserves render scope. | DOM engine, mount helper |
| **Mount boundary** | The point where an app is attached to the DOM and all required services must already be provided. | root render, bootstrap |

## Reactivity and data

| Term | Definition | Aliases to avoid |
| ----------- | ------------------------------------------------------- | --------------------- |
| **Signal** | A reactive state value that drives fine-grained DOM updates and derived UI. | store, atom |
| **Resource** | A keyed async data descriptor whose fetched state is cached, deduplicated, and exposed reactively. | query, fetcher |
| **Resource state** | The reactive loading result of a resource, modeled as `Pending`, `Success`, or `Failure`. | status, result |

## Routing

| Term | Definition | Aliases to avoid |
| ----------- | ------------------------------------------------------- | --------------------- |
| **Router** | The navigation service and public facade for route state, navigation, params, query, and prefetch. | navigator, history wrapper |
| **Route** | A declared path pattern plus its component, schemas, middleware, layouts, and strategy layers. | page, screen |
| **Current route** | The runtime navigation state for the path that is currently active. | route, location |
| **Routes collection** | The fluent root builder that gathers top-level routes and root boundaries before finalization. | route list, router config |
| **Routes manifest** | The finalized normalized route tree consumed by `Outlet` and route matching. | routes, config |
| **Outlet** | The component that matches the current path and renders the active route tree. | router view, slot |
| **Link** | A real anchor element that performs typed client-side navigation and optional prefetch. | nav item, router link |
| **Layout** | A route-owned wrapper component that surrounds nested child route content. | shell, wrapper |
| **Boundary** | A route-level fallback surface for loading, forbidden, not found, or error states. | guard, fallback page |

## Supporting surfaces

| Term | Definition | Aliases to avoid |
| ----------- | ------------------------------------------------------- | --------------------- |
| **ErrorBoundary** | An explicit component matcher that turns tagged render failures into fallback UI. | error handler, try/catch |
| **Head** | The document metadata surface that hoists and deduplicates title and meta tags from components. | SEO helper, head manager |
| **Portal** | A component-owned rendering surface that places UI into another DOM target. | teleport, overlay mount |
| **Trace** | The framework's internal flight recorder: one ordered catalog event per meaningful step, asserted by tests and read back for debugging. | logging, telemetry |
| **Debug** | A console logger over the trace stream that pretty-prints catalog events for humans. | DevMode, debugger, devtools |

## Relationships

- A **Component** produces an **Element** tree.
- A **Renderer** mounts an **Element** tree at the **Mount boundary**.
- A **Component** may yield **Service** dependencies.
- A **Layer** satisfies **Service** requirements before or at the **Mount boundary**.
- A **Signal** can appear directly in JSX and update part of an **Element** tree without re-running the whole **Component**.
- A **Resource** exposes **Resource state** reactively, typically through a **Signal**.
- A **Routes collection** produces exactly one **Routes manifest**.
- An **Outlet** consumes a **Routes manifest** and the **Current route** to render the active **Route**.
- A **Route** may define a **Layout** and one or more **Boundary** surfaces.
- A **Link** delegates navigation and optional prefetch to the **Router**.
- **Head**, **Portal**, and **ErrorBoundary** modify how a **Component** tree is rendered without changing what a **Route** means.

## Example dialogue

> **Dev:** "If a **Component** needs theme data, should it read a **Service** directly?"
>
> **Domain expert:** "Yes. The **Component** yields the **Service**, and a parent **Layer** provides it before the **Mount boundary**."
>
> **Dev:** "For page data, should I keep it in a **Signal** or a **Resource**?"
>
> **Domain expert:** "Use a **Resource** when the data is async, keyed, and cacheable; use a **Signal** for local reactive state."
>
> **Dev:** "When routing changes, does the **Router** render the page?"
>
> **Domain expert:** "Not directly. The **Router** updates the **Current route**, and the **Outlet** matches the **Routes manifest** to render the active **Route** and its **Layout**."

## Flagged ambiguities

- "component" is overloaded. Use **Component** for the Effect-backed UI unit, **Element** for normalized JSX output, and **Route component** only for a component stored in a route slot.
- "route" is overloaded. Use **Route** for the declared definition and **Current route** for runtime navigation state.
- "routes" is overloaded. Use **Routes** for the namespace, **Routes collection** for the fluent builder instance, and **Routes manifest** for the finalized tree passed to `Outlet`.
- "render" and "mount" are close but distinct. Use **render** for producing/updating DOM output and **Mount boundary** for attaching the fully-provided app to the DOM.
- "provider" appears informally in UI discussions. Prefer **Layer** when talking about the Effect service provider concept.
