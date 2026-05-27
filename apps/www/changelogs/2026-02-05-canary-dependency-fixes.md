---
title: Canary Dependency Fixes
version: "trygg@0.1.0-canary.1"
---

## Summary

This canary makes generated projects installable outside the Trygg workspace and clarifies the scaffolded app setup.

## Changed

- Emit published `trygg@^0.1.0-canary.1` and shared Effect/tooling versions from `create-trygg` instead of `workspace:*`, so scaffolded projects install outside the repo.
- Clarify `create-trygg` platform and output prompts and rely on generated project files instead of stale template files.
- Document the CLI-generated project structure and source-owned setup docs in the `trygg` README instead of manual mounting; see the [core README](../../../packages/core/README.md).

## Fixed

- Use current Effect platform package versions in `create-trygg` and generated projects, avoiding stale scaffold dependencies.

## Versions

- `trygg@0.1.0-canary.1` includes changes since the `trygg@0.1.0-canary.0` git tag.
