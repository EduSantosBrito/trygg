---
title: Effect 4 Reactivity
version: "trygg@0.2.0-canary.2"
---

## Summary

This canary moves the core package onto the Effect 4 beta line and updates reactive async APIs so suspended views and resources keep type information and stale UI through refreshes.

```tsx
const SuspendedProfile =
  yield *
  Signal.suspend(UserProfile).pipe(
    Signal.on("Pending", Spinner),
    Signal.on("Failure", ErrorView),
    Signal.exhaustive,
  );
```

## Changed

- Breaking: `Signal.suspend` now uses pipeable `Signal.on` and `Signal.exhaustive` handlers, preserving component props, errors, and requirements through suspended views; see the [Signal docs](../../../packages/core/src/primitives/signal.docs.md).
- Breaking: `Resource.match` now supports pipeable `Resource.on` and `Resource.exhaustive` handlers for exhaustive async state rendering; see the [Resource docs](../../../packages/core/src/primitives/resource.docs.md).
- Breaking: `trygg` now targets Effect 4 beta peer packages, replacing the Effect 3 peer dependency set used by `trygg@0.2.0-canary.1`.

## Fixed

- Signal state now stays stable when Vite loads duplicated Trygg modules during development.
- Router prefetch now runs render-triggered prefetches after the link render pass, avoiding render-phase interference.
- `Resource.match` now keeps stale successful data available while pending or failed states render fallback UI.
- `Signal.suspend` now keeps stale rendered output by dependency key and reacts to signal changes without dropping component requirements.

## Versions

- `trygg@0.2.0-canary.2` includes changes since the `trygg@0.2.0-canary.1` git tag.
