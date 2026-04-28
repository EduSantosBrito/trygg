---
title: Effect-Native Element Constructors
version: "trygg@0.2.0-canary.4"
---

## Summary

This canary moves low-level element construction and child normalization onto Effect-native APIs. JSX construction is more defensive against hostile JavaScript inputs, portals snapshot caller-owned child arrays, and outlet navigation applies scroll after fast loading-boundary renders.

## Added

- `Element.fromEffect` and `Element.fail` now create lazy component elements without the old thunk-based constructor; see the [element docs](../../../packages/core/src/primitives/element.docs.md).
- `Element.fromUnknown` and `Element.fromChildren` now provide Effect-native JSX child normalization for lower-level helpers; see the [element docs](../../../packages/core/src/primitives/element.docs.md).

## Changed

- Breaking: `componentElement`, `normalizeChild`, `normalizeChildren`, and `portal` are no longer exported from the root `trygg` entrypoint. Use `Element.fromEffect`, `Element.fromUnknown`, and `Element.fromChildren` for low-level element construction and child normalization.
- `jsx`, `jsxs`, and `jsxDEV` now share the same builder path, so production and development JSX normalize props, children, and keys consistently.
- `portal` now snapshots child array shape when the portal element is created, preventing later caller-owned array mutations from changing the first portal render.

## Fixed

- JSX construction now degrades malformed prop objects without throwing before render, while invalid component inputs still fail lazily with `InvalidComponentError`.
- `Router.Outlet` now waits for loading-boundary content to reach `Ready` before applying deferred scroll, including fast synchronous route renders; see the [outlet docs](../../../packages/core/src/router/outlet.docs.md).

## Versions

- `trygg@0.2.0-canary.4` includes changes since the `trygg@0.2.0-canary.3` git tag.
