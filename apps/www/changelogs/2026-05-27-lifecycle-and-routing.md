---
title: Lifecycle Providers, Trace, and Transactional Routing
version: "trygg@0.5.0-canary.0"
---

## Summary

This canary makes Effect-provided component state safer across renders and route transitions, moves routing through explicit navigation and activation seams, replaces ad hoc DevMode debugging with the typed Trace/Debug flight recorder, and tightens docs and keyed-list performance paths.

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
- `Signal.selector` now creates value-keyed derived signals for single-selection lists, sharing one source subscription while updating only the previous and next selected key buckets.
- Router internals now expose typed path-pattern matching, path interpolation, navigation-core state, outlet coordination, and route-activation seams for latest-navigation-wins behavior.
- The Trace flight recorder now records signal swaps, component renders, route activation, navigation decisions, resource fetches, and keyed-list costs through a typed catalog, recorder, analyzers, Markdown/JSON reports, and budget helpers; see the [trace docs](../../../packages/core/src/trace/trace.docs.md).
- `trygg/testing` now re-exports `Trace` and adds `withRecording` for hermetic assertions over framework event order.
- The Vite plugin now plans generated build artifacts through a dedicated planner, keeping client entries, worker entries, and production server builds on one validated path.
- Docs code blocks now use build-time Shiki prerendering for source-owned docs, so pages can render highlighted examples synchronously without downloading Shiki in the browser.
- The docs site now includes a refreshed home page, getting-started flow, docs layout, search dialog, theme toggle, tabs, and route-behavior contract coverage.

## Changed

- Breaking: component provision now uses the pipeable `Component.provide(layer)` helper instead of a `.provide(...)` method on component values. Pass one layer per call: `Component.gen(...).pipe(Component.provide(ThemeLive), Component.provide(AuthLive))`.
- Breaking: `Route.provide` now accepts only route strategy layers such as `RenderStrategy` and `ScrollStrategy`. Move route page services to `Component.provide(layer)` on the routed component, and pipe each route strategy separately.
- Breaking: `Signal.make` now requires an owner scope from component render, a lifecycle-provided `Layer.effect`, or an explicitly scoped Effect. Calls outside an owner scope now report `SignalScopeError` instead of creating process-lifetime state implicitly.
- `Signal.get`, `Signal.peek`, `Signal.set`, `Signal.update`, and `Signal.modify` no longer expose disposed-signal failures to application code; stale reads return the last snapshot, stale writes are ignored, and `signal.disposed_access` is recorded for diagnosis.
- `Debug` is now an Effect logger over the Trace stream. Use `Component.provide(Debug.layer({ minLevel, filter, batchWindow }))` to tune console diagnostics; generated entry modules install a default Debug layer.
- `Signal.each` keyed-list reconciliation now avoids subscribing the enclosing component to list updates, minimizes reorder moves, batches full clears off the live table, and keeps bulk create paths from yielding cooperative scheduler tasks.
- Examples and starter templates now use scoped service stores for theme, auth, dashboard, nested-provider, and command-palette state instead of process-global mutable services.
- Router rendering now coordinates loading boundaries, lazy route outcomes, scroll application, and route commits before swapping outlet content.
- Resource state now follows the same scoped signal ownership model as component state, reducing accidental cross-render reuse.

## Removed

- Breaking: `DevMode`, `DevModeProps`, and the old Debug plugin/span helper surface were removed. Configure console output with `Debug.layer(...)`, and use `Trace.makeRecorder` or `trygg/testing.withRecording` for test assertions.
- Breaking: `Signal.makeSync` was removed. Create reactive service state with `Signal.make` inside `Layer.effect`, then provide that layer at a component or layout boundary.
- Breaking: `Signal.peekSync` was removed. Use `yield* Signal.peek(signal)` from Effect code instead.

## Fixed

- `Component.provide` layers now survive route outlet wrapping, fixing routed pages that previously failed with `Service not found` for route-local services.
- Provider-created signals no longer consume component hook slots, fixing nested provider pages where local input state could be overwritten by provider state.
- `trygg/api` now emits browser-valid JavaScript for the generated `ApiClient` runtime module while keeping typed service declarations in `.trygg/api.d.ts`.
- Fast navigations now settle on the latest route, preserve progressive shells, drop stale lazy-loader and route-owned `SignalElement` results, refresh preserved-layout params, and apply scroll once after the committed route is ready.
- Docs article rendering no longer waits for runtime syntax highlighting, and the docs search dialog now uses router navigation while restoring focus when it opens or closes.
- Event handlers, stable children, keyed lists, fragments, signal elements, and error boundaries now participate in render transactions so interrupted or failed updates clean up more predictably.

## Versions

- `trygg@0.5.0-canary.0` includes changes since the `trygg@0.4.0-canary.1` git tag.
- `create-trygg@0.5.0-canary.0` scaffolds projects against `trygg@^0.5.0-canary.0`.
