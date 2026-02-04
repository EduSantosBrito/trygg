---
name: trygg-architecture
description: trygg framework internals — Element tagged enum, Renderer, Component.gen, Signal reactivity, head management, portals, error boundaries, security, Resource data fetching, API routes, Vite plugin, and design decisions. Use when debugging renderer behavior, understanding element variants, tracing how Components/Signals/Layers compose, investigating head hoisting or portal rendering, reviewing error boundary semantics, working with Resource cache/dedup, configuring the Vite plugin, or making architecture decisions.
---

# trygg Architecture

Internal design of the trygg Effect-native UI framework.

## Decision Tree

```
What are you investigating?
|
+-- Element variants?
|   +-- 10-variant TaggedEnum: Intrinsic, Text, SignalText, SignalElement,
|       Provide, Component, Fragment, Portal, KeyedList, ErrorBoundaryElement
|   See: references/design.md §2
|
+-- Rendering pipeline?
|   +-- Renderer service -> mount/render -> variant dispatch
|   +-- Event handlers: (event) => Effect, executed via Runtime.runFork
|   +-- Head hoisting: title/meta/link/style/script/base -> document.head
|   +-- Document-level: html/head/body map to existing DOM nodes
|   See: references/design.md §3, §6
|
+-- Component.gen internals?
|   +-- Component.Type<Props, E, R> with .provide() method
|   +-- Props via ComponentProps<T>, yielded inside generator
|   +-- .provide() returns new component with layer applied
|   See: references/design.md §5
|
+-- Signal reactivity model?
|   +-- Built on SubscriptionRef, position-based identity
|   +-- make() does NOT subscribe; only get() subscribes
|   +-- derive/deriveAll for computed signals
|   +-- Signal.each for keyed list rendering (LIS reconciliation)
|   +-- Signal.suspend for async component suspension
|   See: references/design.md §4
|
+-- Resource / data fetching?
|   +-- ResourceState: Pending | Success | Failure
|   +-- Resource.make (static key or parameterized factory)
|   +-- Cache: invalidate (stale-while-revalidate), refresh, clear
|   +-- Deduplication via Deferred for concurrent fetches
|   See: references/design.md §10
|
+-- API routes?
|   +-- HttpApi + HttpApiGroup + HttpApiEndpoint from @effect/platform
|   +-- Single app/api.ts file, handler layer export
|   +-- Vite plugin creates dev middleware
|   See: references/design.md §11
|
+-- Vite plugin?
|   +-- JSX config, route type gen, code splitting, entry gen, API middleware
|   See: references/design.md §12
|
+-- Design decisions?
|   See: references/design.md §15
```

## Core Principles

1. **Effect-Native** — everything is an Effect; `.provide()` for DI
2. **Type-Safe** — errors tracked at type level; R=never enforced; no casts
3. **Testable** — components renderable with test layers in isolation
4. **Explicit** — side effects visible in type signatures

## Reference Files

| File | When to Read |
|------|-------------|
| [design.md](references/design.md) | Full architecture: Element types, Renderer, Signal, Component, Resource, API, Vite plugin |
