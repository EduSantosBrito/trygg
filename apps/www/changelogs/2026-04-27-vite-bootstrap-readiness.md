---
title: Vite Bootstrap Readiness
version: "trygg@0.3.0-canary.0"
---

## Summary

This canary aligns Trygg with Effect 4 beta.51 and makes Vite plugin startup safer for generated files, route transforms, and server builds.

## Changed

- Breaking: `trygg` now requires the exact Effect 4 beta.51 peer package set, replacing the beta.27 range used by `trygg@0.2.0-canary.4`.
- `trygg/vite-plugin` now shares resolved app configuration through a bootstrap service, so config-dependent Vite hooks wait for the ready app directory, generated directory, and discovered routes; see the [Vite plugin docs](../../../packages/core/src/vite/plugin.docs.md).

## Fixed

- JSX runtime typing now preserves component Effect requirements through `jsx` and `jsxs`, so missing parent-provided services stay visible to TypeScript.
- `trygg/vite-plugin` now reports a typed bootstrap error when a config-dependent hook runs before `configResolved`, instead of reading partial plugin state.

## Versions

- `trygg@0.3.0-canary.0` includes changes since the `trygg@0.2.0-canary.4` git tag.
