---
title: Initial Canary Release
version: "trygg@0.1.0-canary.0"
---

## Summary

The first Trygg canary publishes the Effect-native JSX framework, router, Vite plugin, testing utilities, examples, and project scaffolder.

## Added

- Add the core `trygg` Effect-native component model, JSX runtime, fine-grained `Signal` reactivity, keyed rendering, `Resource` data fetching, `ErrorBoundary`, `Portal`, `Head`, debug events, and metrics; see the [core README](../../../packages/core/README.md).
- Add `trygg/router` route builders, typed params and query decoding, middleware, redirects, forbidden responses, nested outlets, loading and error boundaries, scroll strategies, prefetch support, browser navigation, and in-memory test routing; see the [router guide](../../../packages/core/src/router/router.docs.md).
- Add `trygg/vite-plugin` support for JSX runtime configuration, generated app entry files and route types, Effect HttpApi development routes, and static or server builds; see the [Vite plugin guide](../../../packages/core/src/vite/plugin.docs.md).
- Add `create-trygg` scaffolding for Bun or Node projects with server or static output, optional Git or Jujutsu setup, generated config files, router templates, API templates, and dependency installation.
- Add examples for counters, dashboards, forms, resources, suspended views, portals, route layouts, protected routes, API routes, and service-provided state.

## Fixed

- Merge parent and child context in `Component.provide` instead of replacing it, preserving services supplied higher in the tree.
- Handle `Signal.suspend` error paths without crashing while suspended work resolves.
- Preserve JSX component `key` values so keyed list and component identity behave consistently.
- Harden API middleware, schema decode failures, error boundaries, dev-mode cleanup, router requirement narrowing, and canary publish tagging before the release.

## Versions

- `trygg@0.1.0-canary.0` includes changes from the first commit through the `trygg@0.1.0-canary.0` git tag.
