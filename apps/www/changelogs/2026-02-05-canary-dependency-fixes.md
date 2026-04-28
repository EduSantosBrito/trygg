---
title: Canary Dependency Fixes
version: "trygg@0.1.0-canary.1"
---

## Summary

The canary updates scaffolded project dependencies to published package versions and clarifies the generated app setup.

## Changed

- `create-trygg` now emits the published `trygg@^0.1.0-canary.1` dependency and shared Effect/tooling versions instead of `workspace:*`, so scaffolded projects install outside the repo.
- `create-trygg` now uses clearer platform and output prompts and relies on generated project files instead of stale template files.
- The `trygg` README now documents the CLI-generated project structure and source-owned setup docs instead of manual mounting; see the [core README](../../../packages/core/README.md).

## Fixed

- `create-trygg` now uses current Effect platform package versions for the CLI and generated projects, avoiding stale scaffold dependencies.

## Versions

- `trygg@0.1.0-canary.1` includes changes since the `trygg@0.1.0-canary.0` git tag.
