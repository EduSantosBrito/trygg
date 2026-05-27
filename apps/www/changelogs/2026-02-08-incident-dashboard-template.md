---
title: Incident Dashboard Template
version: "trygg@0.2.0-canary.0"
---

## Summary

This canary adds selectable project templates, a full-stack incident dashboard scaffold, reactive route activity signals, and renderer fixes for keyed lists and boundaries.

## Changed

- **Breaking:** Return `Signal<boolean>` from `Router.isActive` instead of a boolean, enabling fine-grained active-link updates without rerendering route components; see the [router service guide](../../../packages/core/src/router/service.docs.md).
- **Breaking:** Move signal creation toward Effect-scoped `Signal.make` state for service-backed globals; see the [signal guide](../../../packages/core/src/primitives/signal.docs.md).
- **Breaking:** Move testing helper imports from the root `trygg` entrypoint to `trygg/testing`.
- Forward user `data-*` and `aria-*` attributes from `Link` to the underlying anchor, supporting active-state attributes derived from `Router.isActive`; see the [link guide](../../../packages/core/src/router/link.docs.md).
- Track schema-decoded route params and query requirements through route builders and error-boundary coverage, surfacing missing route boundaries at typecheck time; see the [route guide](../../../packages/core/src/router/route.docs.md).
- Expose a Vite plugin shape that avoids app-local Vite type identity conflicts; see the [Vite plugin guide](../../../packages/core/src/vite/plugin.docs.md).

## Added

- Add Blank App and Incident Dashboard template choices to `create-trygg`, so teams can start from either a minimal app or a full-stack example.
- Add an Incident Dashboard template with API routes, incident resources, report forms, detail and settings pages, route boundaries, theme state, command palette UI, and static assets.
- Add the `trygg/testing` package entrypoint for Effect-native render helpers, DOM event helpers, and waits; see the [testing guide](../../../packages/core/src/testing/testing.docs.md).

## Fixed

- Preserve keyed item DOM ranges in `Signal.each` during reorder and rerender, preventing fragment moves from dropping content or flashing stale rows.
- Mount `ErrorBoundary` fallback content before cleaning up the failed render, avoiding blank states when an error races with DOM placement.
- Update signal-valued attributes on document-rendered elements, so reactive attributes stay current outside normal element children.
- Remove the unnecessary server API file from blank static scaffolds.

## Versions

- `trygg@0.2.0-canary.0` includes changes since the `trygg@0.1.0-canary.1` git tag and was generated from the `2026-02-08` release tag.
