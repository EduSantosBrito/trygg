---
title: SVG Runtime Support
version: "trygg@0.4.0-canary.1"
---

## Summary

This canary renders SVG intrinsic elements in the SVG namespace, so inline icons and graphics behave like browser-native SVG instead of HTML elements.

```tsx
import { Component } from "trygg";

const Icon = Component.gen(function* () {
  return (
    <svg viewBox="0 0 24 24" className="icon">
      <circle cx="12" cy="12" r="10" fill="currentColor" />
    </svg>
  );
});
```

## Added

- SVG intrinsic tags, including `svg`, `path`, `circle`, `rect`, `g`, gradients, and masks, now render through `createElementNS` with the SVG namespace.
- `CommonProps`, `HtmlProps`, and `SvgProps` now separate shared, HTML-only, and SVG-only prop surfaces while keeping `ElementProps` as the low-level compatibility shape.

## Fixed

- `className` now applies to SVG elements through the `class` attribute, including Signal-backed updates.
- JSX now rejects SVG-only props such as `viewBox` and `strokeWidth` on known HTML tags.

## Versions

- `trygg@0.4.0-canary.1` includes SVG runtime support since `trygg@0.4.0-canary.0`.
