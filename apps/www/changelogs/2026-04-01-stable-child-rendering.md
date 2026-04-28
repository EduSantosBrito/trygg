---
title: Stable Child Rendering
version: "trygg@0.2.0-canary.3"
---

## Summary

This canary hardens fine-grained rendering so parent updates no longer remount stable child subtrees unnecessarily. Local signals, DOM nodes, routed context, and error boundaries now survive common rerender paths that previously reset state or hid defects.

## Added

- Source-owned docs now cover the public core modules and exports, including renderer, router, signal, resource, JSX runtime, security, testing, and Vite plugin topics; see the [renderer docs](../../../packages/core/src/primitives/renderer.docs.md) and [router docs](../../../packages/core/src/router/router.docs.md).

## Fixed

- Renderer reconciliation now preserves stable child component identity during parent rerenders, keeping child-local signals, DOM nodes, event handlers, and render scopes alive when inputs are unchanged; see the [renderer docs](../../../packages/core/src/primitives/renderer.docs.md).
- Keyed children now keep identity and local state when siblings reorder, while unkeyed positional shifts and key changes still remount the affected subtree.
- Stable child updates now rerender when props or provided context change without tearing down the child, and failed stable-child updates surface as defects or route through `ErrorBoundary` fallback handling.
- `Router.Outlet` now renders with stable runtime identity, preserving routed child DOM and local state during child-local signal updates; see the [outlet docs](../../../packages/core/src/router/outlet.docs.md).
- `Router.params` is now available inside routed `Component.gen` pages, so route params resolve from the active outlet context instead of going missing.

## Versions

- `trygg@0.2.0-canary.3` includes changes since the `trygg@0.2.0-canary.2` git tag.
