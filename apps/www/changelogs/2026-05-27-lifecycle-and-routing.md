---
title: Lifecycle Providers and Transactional Routing
version: "trygg@0.5.0-canary.0"
---

## Summary

This canary makes Effect-provided component state safer across renders and route transitions, moves routing through explicit navigation and activation seams, and adds traceable render transactions for diagnosing UI updates.

```tsx
import { Component } from "trygg";
import { Layer } from "effect";

const ThemedPage = Component.gen(function* () {
  const theme = yield* ThemeStore;
  return <main>{theme.mode}</main>;
}).pipe(Component.provide(ThemeStoreLive));
```

## Added

- `Component.provide` now owns provider-layer lifecycles with scoped signal stores, so services created for a component can hold reactive state without leaking beyond that component tree.
- Router internals now expose typed path-pattern matching, path interpolation, navigation-core state, outlet coordination, and route-activation seams for latest-navigation-wins behavior.
- Render transactions now trace signal swaps, component renders, route activation, and navigation decisions through the public trace contract; see the [trace docs](../../../packages/core/src/contract/trace.docs.md).
- The Vite plugin now plans generated build artifacts through a dedicated planner, keeping client entries, worker entries, and production server builds on one validated path.
- The docs site now includes a refreshed home page, getting-started flow, docs layout, search dialog, theme toggle, tabs, and route-behavior contract coverage.

## Changed

- Breaking: component provision now uses the pipeable `Component.provide(layer)` helper instead of a `.provide(...)` method on component values. Pass one layer per call: `Component.gen(...).pipe(Component.provide(ThemeLive), Component.provide(AuthLive))`.
- Breaking: `Route.provide` now accepts only route strategy layers such as `RenderStrategy` and `ScrollStrategy`. Move route page services to `Component.provide(layer)` on the routed component, and pipe each route strategy separately.
- Breaking: `Signal.make` now requires an owner scope from component render, a lifecycle-provided `Layer.effect`, or an explicitly scoped Effect. Calls outside an owner scope now report `SignalScopeError` instead of creating process-lifetime state implicitly.
- Examples and starter templates now use scoped service stores for theme, auth, dashboard, nested-provider, and command-palette state instead of process-global mutable services.
- Router rendering now coordinates loading boundaries, lazy route outcomes, scroll application, and route commits before swapping outlet content.
- Resource state now follows the same scoped signal ownership model as component state, reducing accidental cross-render reuse.

## Removed

- Breaking: `Signal.makeSync` was removed. Create reactive service state with `Signal.make` inside `Layer.effect`, then provide that layer at a component or layout boundary.
- Breaking: `Signal.peekSync` was removed. Use `yield* Signal.peek(signal)` from Effect code instead.

## Fixed

- `Component.provide` layers now survive route outlet wrapping, fixing routed pages that previously failed with `Service not found` for route-local services.
- Provider-created signals no longer consume component hook slots, fixing nested provider pages where local input state could be overwritten by provider state.
- `trygg/api` now emits browser-valid JavaScript for the generated `ApiClient` runtime module while keeping typed service declarations in `.trygg/api.d.ts`.
- Fast navigations now settle on the latest route, preserve progressive shells, avoid blank swaps, and apply scroll once after the committed route is ready.
- Event handlers, stable children, keyed lists, fragments, signal elements, and error boundaries now participate in render transactions so interrupted or failed updates clean up more predictably.

## Versions

- `trygg@0.5.0-canary.0` includes changes since the `trygg@0.4.0-canary.1` git tag.
- `create-trygg@0.5.0-canary.0` scaffolds projects against `trygg@^0.5.0-canary.0`.
