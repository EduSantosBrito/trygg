---
title: Canary Rollup: Faster Rendering, Safer Routes, and Fuller Docs
version: "trygg@0.5.0-canary.3"
---

## Summary

This canary rollup collects the changes since `trygg@0.5.0-canary.0`: faster static rendering and keyed-list updates, stricter route component requirement checks, more reliable scaffolded installs, Bun dev API trace parity, and a much deeper docs website.

## Added

- Route component inputs now surface branded type guidance when a direct component, lazy default export, or lazy named component still has visible unprovided service requirements. Provide the page with `Component.provide(ServiceLive)` before passing it to `Route.make(...).component(...)` or `Route.index(...)`.
- JSX requirement type tests now cover nested component requirements, provided components, route components, index routes, and lazy route loaders so the virtual JSX lowering path stays requirement-aware.
- The docs website now includes concept guides, a tutorial, deployment notes, forms and global-storage patterns, richer sidebar grouping, link/table rendering in docs articles, and tests for the Markdown/docs rendering paths.
- Source-owned docs coverage now includes missing sidecars for class composition, route collections, route prefetch, render strategies, scroll strategies, and route types, with a stricter docs contract that requires a lead paragraph and example.
- Bun dev API handling now emits the same Trace events as Node for handler loading, handler loaded, and API request received events.

## Changed

- Static intrinsic JSX subtrees now take synchronous construction and reconciliation fast paths, reducing Effect runtime overhead for plain DOM-heavy screens while preserving existing renderer fallbacks for signal children, components, hoisting, and effectful props.
- Signals now store their current value in a lightweight cell instead of an Effect `SubscriptionRef`, cutting per-signal allocation overhead while preserving the public `Signal` API and reactive listener behavior.
- `Signal.each` keyed lists now update same-key static rows in place, preserve row DOM identity, avoid unnecessary subscription diffs for rows with no signal reads, and batch full clears off the live DOM before teardown.
- The renderer now shares stateless render transaction helpers instead of allocating fresh transaction objects on hot paths.
- The generated app entry remains wired to `Debug.layer`, and `Debug.layer({ batchWindow })` continues to batch console writes through Effect's `Logger.batched`.
- The Vite plugin logger now renders array log messages as readable space-joined text before forwarding them to consola.
- The docs homepage now opens with a concrete component example, computed section read times, broader search empty-state copy, and copy labels that distinguish code blocks from shell commands.

## Fixed

- `create-trygg` now scaffolds projects with exact, aligned Effect beta dependencies and includes `@effect/platform-node-shared`, avoiding mixed beta installs from npm range resolution.
- Bun scaffolds now use Bun-aware build and preview scripts (`bunx --bun vite build` / `bunx --bun vite preview`) instead of falling back to plain Vite commands.
- Published `trygg` package metadata now uses concrete Effect peer/dev dependency versions instead of workspace catalog references.
- The examples app now resolves `trygg/vite-plugin` to the actual source module path used by the package export.
- The docs app now reads the current route snapshot through the public router helper instead of reaching into the router signal internals.

## Versions

- `trygg@0.5.0-canary.3` includes changes since the `trygg@0.5.0-canary.0` git tag and supersedes the `0.5.0-canary.1` / `0.5.0-canary.2` publishing fixes.
- `create-trygg@0.5.0-canary.3` scaffolds projects against `trygg@^0.5.0-canary.3` with exact Effect beta dependencies.
