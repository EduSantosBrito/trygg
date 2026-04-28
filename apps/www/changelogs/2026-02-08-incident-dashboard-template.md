---
title: Incident Dashboard Template
version: "trygg@0.2.0-canary.0"
---

## Summary

The canary adds selectable project templates, a full-stack incident dashboard scaffold, reactive route activity signals, and renderer fixes for keyed lists and boundaries.

## Added

- `create-trygg` now lets new projects choose a Blank App or Incident Dashboard template, so teams can start from either a minimal app or a full-stack example.
- The Incident Dashboard template now includes API routes, incident resources, report forms, detail and settings pages, route boundaries, theme state, command palette UI, and static assets.
- `trygg/testing` is now a package entrypoint for Effect-native render helpers, DOM event helpers, and waits; see the [testing guide](../../../packages/core/src/testing/testing.docs.md).

## Changed

- Breaking: `Router.isActive` now returns `Signal<boolean>` instead of a boolean, enabling fine-grained active-link updates without rerendering route components; see the [router service guide](../../../packages/core/src/router/service.docs.md).
- Breaking: `Signal.unsafeMake` is now `Signal.makeSync`, clarifying that synchronous signals are for module-lifetime state and service-backed globals; see the [signal guide](../../../packages/core/src/primitives/signal.docs.md).
- Breaking: Testing helpers now import from `trygg/testing` instead of the root `trygg` entrypoint.
- `Link` now forwards user `data-*` and `aria-*` attributes to the underlying anchor, supporting active-state attributes derived from `Router.isActive`; see the [link guide](../../../packages/core/src/router/link.docs.md).
- Route builders now track schema-decoded route params and query requirements through error-boundary coverage, surfacing missing route boundaries at typecheck time; see the [route guide](../../../packages/core/src/router/route.docs.md).
- The Vite plugin now exposes a plugin shape that avoids app-local Vite type identity conflicts; see the [Vite plugin guide](../../../packages/core/src/vite/plugin.docs.md).

## Fixed

- `Signal.each` now preserves keyed item DOM ranges during reorder and rerender, preventing fragment moves from dropping content or flashing stale rows.
- `ErrorBoundary` now mounts fallback content before cleaning up the failed render, avoiding blank states when an error races with DOM placement.
- Signal-valued attributes now update document-rendered elements, so reactive attributes stay current outside normal element children.
- Blank static scaffolds no longer keep an unnecessary server API file.

## Versions

- `trygg@0.2.0-canary.0` includes changes since the `trygg@0.1.0-canary.1` git tag and was generated from the `2026-02-08` release tag.
