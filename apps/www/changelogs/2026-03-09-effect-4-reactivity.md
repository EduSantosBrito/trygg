---
title: Effect 4 Reactivity
version: "trygg@0.2.0-canary.2"
---

## Summary

This canary moves the core package onto the Effect 4 beta line and updates reactive async APIs so suspended views and resources keep type information and stale UI through refreshes.

## Changed

- **Breaking:** Replace `Signal.suspend` match objects with pipeable `Signal.on` and `Signal.exhaustive` handlers, preserving component props, errors, and requirements through suspended views; see the [Signal docs](../../../packages/core/src/primitives/signal.docs.md).
- **Breaking:** Add pipeable `Resource.on` and `Resource.exhaustive` handlers to `Resource.match` for exhaustive async state rendering; see the [Resource docs](../../../packages/core/src/primitives/resource.docs.md).
- **Breaking:** Target Effect 4 beta peer packages from `trygg`, replacing the Effect 3 peer dependency set used by `trygg@0.2.0-canary.1`.

## Fixed

- Keep Signal state stable when Vite loads duplicated Trygg modules during development.
- Run router prefetches triggered by render after the link render pass, avoiding render-phase interference.
- Keep stale successful data available in `Resource.match` while pending or failed states render fallback UI.
- Preserve stale `Signal.suspend` output by dependency key and react to signal changes without dropping component requirements.

## Versions

- `trygg@0.2.0-canary.2` includes changes since the `trygg@0.2.0-canary.1` git tag.
