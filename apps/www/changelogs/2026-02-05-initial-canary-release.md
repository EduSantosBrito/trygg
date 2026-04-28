---
title: Initial Canary Release
version: "trygg@0.1.0-canary.0"
---

## Summary

The first trygg canary publishes the Effect-native JSX framework, router, Vite plugin, testing utilities, examples, and project scaffolder.

## Added

- `trygg` now provides the core Effect-native component model, JSX runtime, fine-grained `Signal` reactivity, keyed rendering, `Resource` data fetching, `ErrorBoundary`, `Portal`, `Head`, debug events, and metrics; see the [core README](../../../packages/core/README.md).
- `trygg/router` now provides route builders, typed params and query decoding, middleware, redirects, forbidden responses, nested outlets, loading and error boundaries, scroll strategies, prefetch support, browser navigation, and in-memory test routing; see the [router guide](../../../packages/core/src/router/router.docs.md).
- `trygg/vite-plugin` now configures the JSX runtime, generates app entry files and route types, serves Effect HttpApi routes in development, and supports static and server builds; see the [Vite plugin guide](../../../packages/core/src/vite/plugin.docs.md).
- `create-trygg` now scaffolds Bun or Node projects with server or static output, optional Git or Jujutsu setup, generated config files, router templates, API templates, and dependency installation.
- The examples app now demonstrates counters, dashboards, forms, resources, suspended views, portals, route layouts, protected routes, API routes, and service-provided state.

## Fixed

- `Component.provide` now merges parent and child context instead of replacing it, preserving services supplied higher in the tree.
- `Signal.suspend` now handles error paths without crashing while suspended work resolves.
- JSX component elements now preserve `key`, so keyed list and component identity behave consistently.
- API middleware, schema decode failures, error boundaries, dev-mode cleanup, router requirement narrowing, and canary publish tagging were hardened before the release.

## Versions

- `trygg@0.1.0-canary.0` includes changes from the first commit through the `trygg@0.1.0-canary.0` git tag.
