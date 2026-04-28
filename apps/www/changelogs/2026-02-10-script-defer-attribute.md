---
title: Script Defer Attribute
version: "trygg@0.2.0-canary.1"
---

## Summary

JSX script elements now accept the `defer` attribute, so apps can type deferred script loading without escaping the `ElementProps` surface.

```tsx
<script src="/analytics.js" defer />
```

## Added

- `ElementProps` now includes the `defer` script attribute with reactive boolean support; see the [Element docs](../../../packages/core/src/primitives/element.docs.md).

## Versions

- `trygg@0.2.0-canary.1` includes changes since the `trygg@0.2.0-canary.0` git tag.
