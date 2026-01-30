# Production Readiness Review

## Blockers (critical rules)
- Type casting is used across core runtime and new APIs, violating the "no `as` / `!`" rule and weakening type guarantees: `packages/core/src/primitives/component.ts:92`, `packages/core/src/primitives/error-boundary.ts:63`, `packages/core/src/primitives/resource.ts:421`, `packages/core/src/primitives/signal.ts:935`, `packages/core/src/jsx-runtime.ts:85`, `packages/core/src/router/outlet.ts:679`, `packages/core/src/router/outlet-services.ts:291`.
- Synchronous throwing is introduced in builder code instead of yieldable errors: `packages/core/src/primitives/error-boundary.ts:55` uses `throw new Error`, and router paths use `Effect.dieMessage` / `Effect.die(new Error(...))` (`packages/core/src/router/outlet.ts:679`, `packages/core/src/router/outlet-services.ts:291`). These bypass the error channel and violate "errors must be yieldable".
- `Signal.suspend` fallback still uses a non-null assertion and will throw when `_textElementImpl` is null, exactly in the error path it tries to handle: `packages/core/src/primitives/signal.ts:935`.

## Reliability Risks
- `ErrorBoundary.catch(...).catchAll(...)` copies `.provide` from the original component (`packages/core/src/primitives/error-boundary.ts:214`). Calling `.provide` on the wrapped component will drop the error boundary wrapper entirely because the copied method closes over the original component, not the wrapper.
- `ErrorBoundary` builder state is mutable and shared (`packages/core/src/primitives/error-boundary.ts:80`). Branching builder chains will leak handlers across instances, which is surprising and currently untested.
- `Component` namespace import appears to be internally inconsistent: consumers cannot use `Component.gen` and `Component.Type` together without type conflicts. This suggests the exported namespace or type aliases are not aligned across entrypoints (likely `packages/core/src/index.ts`, `packages/core/src/primitives/component.ts`, or type re-exports).
- `ErrorBoundary.catch(...).on(...)` does not propagate the requirements of the handler components. In the reported case, `SafeRiskyComponent` loses `ErrorTheme` even though handler components require it, making `SafeRiskyComponent` under-declare dependencies and fail at runtime when rendered without a parent `Provide`.
- `jsx` now computes `resolvedKey` but does not apply it to `Component` elements (`packages/core/src/jsx-runtime.ts:96`). Component keys are effectively ignored, which can break keyed list reconciliation and reordering semantics.
- `Component.provide` builds a new context and `Provide` replaces the parent context instead of merging (`packages/core/src/primitives/renderer.ts:597`). Unless `buildContextFromLayers` preserves parent services (unclear), nested providers can drop services. Router code already adds a special-case merge for layouts, indicating an underlying inconsistency.
- `toRouteParams` and loader resolution use `Schema.decodeUnknownSync` (`packages/core/src/router/outlet.ts:121`). Any invalid value will throw synchronously outside the effect channel.

## UX / DX Concerns
- ErrorBoundary usage now requires `yield*` and `Cause.squash` + casts in consumer code; the example uses explicit `as` casts (`apps/examples/app/pages/error-boundary.tsx:31`). This is a DX regression and violates the no-cast rule.
- `ErrorBoundaryPage` passes a `Signal` directly to `RiskyComponent` (`apps/examples/app/pages/error-boundary.tsx:63`), but `RiskyComponent` expects a string (`apps/examples/app/components/error-boundary/risky-component.tsx:19`). The UI will never trigger errors because comparisons are against a Signal object.
- `.oxlintrc.json` hardcodes an absolute plugin path (`.oxlintrc.json:2`). This breaks for any other machine/CI runner and makes the lint setup non-portable.
- New `packages/oxlint-plugin` appears to include `dist/` and `node_modules/` in the workspace. This is a repo-size/DX regression and should be excluded via `.gitignore` and build pipelines.
- Docs/templates still mention the old project name `effect-ui`, which is user-facing and confusing after the rename.


## Missing / Weak Tests
- No test validates that `SafeComponent.provide(...)` retains the error boundary wrapper (regression risk from `packages/core/src/primitives/error-boundary.ts:214`).
- No tests cover `SignalInitError`/fallback paths for `Signal.each` and `Signal.suspend` after the new changes (`packages/core/src/primitives/signal.ts:935`).
- No tests for key propagation on Component JSX elements after the runtime change (`packages/core/src/jsx-runtime.ts:96`).
- Missing tests for invalid route params and invalid route component values after the new schema validation (`packages/core/src/router/outlet.ts:106`).
- `packages/core/src/primitives/__tests__/component.test.tsx:540` uses `it(...)` with `render(...)` (not `it.scoped`), which can leak scopes/fibers.
- The lint rule still requires inline disables in component tests due to scope-tracking limitations (`packages/core/src/primitives/__tests__/component.test.tsx:226`).


## Effectful Refactor Targets
- Replace `throw new Error` in `ErrorBoundary` builder with `Data.TaggedError` and return `Effect.fail(...)` so invalid usage is still yieldable (`packages/core/src/primitives/error-boundary.ts:55`).
- Replace `Effect.dieMessage`/`Effect.die(new Error)` with yieldable tagged errors in router runtime (`packages/core/src/router/outlet.ts:679`, `packages/core/src/router/outlet-services.ts:291`).
- Replace `Schema.decodeUnknownSync` with `Schema.decodeUnknown` + `Effect.mapError` for route params and dynamic component loading (`packages/core/src/router/outlet.ts:106`).
- Remove `error as E` cast in Resource failure handling; consider widening `Failure` to `unknown` or decoding errors explicitly (`packages/core/src/primitives/resource.ts:421`).
- Remove `_textElementImpl!` in `Signal.suspend` and fail with `SignalInitError` in the effect channel or return a safe sentinel element (`packages/core/src/primitives/signal.ts:935`).

## Scope / Fiber Leaks
- `packages/core/src/primitives/__tests__/component.test.tsx:540` uses `it(...)` + `render(...)` without `it.scoped`. This likely leaks the render scope and any child fibers.

## Overall
This diff introduces a new API surface (`Component.provide`, `ErrorBoundary.catch`) but violates several critical rules (type casting, synchronous throws, defect-based failures). There are also behavior regressions (component keys ignored, error boundary wrapper dropped on `.provide`) and DX issues (absolute lint plugin path, false positives). The changes are not production-ready until these blockers are addressed and tests are added for the new failure paths and provider semantics.

## Remediation Plan (handoff checklist)

### P0. Remove forbidden casts and sync throws
- **Why** This repo explicitly bans `as`/`!` and sync throws; current changes violate both and can crash outside Effect handling.
- **Change** Replace `as` and `!` with explicit type guards, pattern matching, or tagged errors. In particular: remove `as` in `packages/core/src/primitives/error-boundary.ts`, `packages/core/src/primitives/resource.ts`, `packages/core/src/router/outlet.ts`, `packages/core/src/router/outlet-services.ts`.
- **Change** Replace `throw new Error` and `Effect.die*` in new code with `Data.TaggedError` + `Effect.fail` so errors stay on the error channel.
- **Acceptance** A grep for `\bas\b`, `!`, `throw new Error`, and `Effect.die` across `packages/core/src` shows no new violations; invalid JSX component types, invalid route components, and ErrorBoundary builder misuse return `Exit.Failure` (not `Die`) with tagged errors; these paths never throw synchronously during render or component construction.
- **Tests** Add explicit tests that use `Effect.exit(render(...))` and assert `Exit.isFailure` + `Cause.isFail` (not `Cause.isDie`) for: (1) invalid route component loader returning a non-component, and (2) calling `.on(...)` after `.catchAll(...)` on an ErrorBoundary builder.
- **Verify** Manually review the touched files to ensure no `as` assertions, non-null `!`, or sync `throw` remain, then run `bun run test` and confirm the new failure-channel tests pass without any `Die` causes.

### P0. Fix ErrorBoundary .provide regression
- **Why** The wrapped component copies `.provide` from the original, which drops the error boundary when you call `.provide` on the wrapper.
- **Change** Build the wrapped component using `Component.gen` (or another official constructor) so it owns its `.provide` method. Avoid copying `.provide` from the original.
- **Change** Ensure wrapper metadata (`_layers`, `_requirements`) are derived from the wrapper itself, not the original.
- **Acceptance** Calling `.provide(...)` on a safe component preserves boundary behavior: a child error still renders the fallback, and any services provided via `.provide(...)` are available inside the wrapped tree. `Component.isEffectComponent(SafeComponent)` remains true and `SafeComponent` renders even when services are required.
- **Tests** Add a test in `packages/core/src/components/__tests__/components.test.tsx` that: (1) creates a failing component that requires a service, (2) wraps it with `ErrorBoundary.catch(...).catchAll(...)`, (3) calls `.provide(layer)` on the safe component, and (4) asserts the fallback is rendered and no defect is raised.
- **Verify** Run `bun run test` and check that the new ErrorBoundary test renders the fallback instead of crashing when `.provide(...)` is called on the safe wrapper.

### P0. Fix ErrorBoundary requirements propagation
- **Why** Handler components registered with `.on(...)` can require services (e.g., `ErrorTheme`), but the resulting safe component currently drops those requirements. This makes `SafeRiskyComponent` type as `R = never` even when the error view needs a service.
- **Change** When building the safe component, merge the requirements of: (1) the original risky component, and (2) every handler component returned from `.on(...)`/`.catchAll(...)`. Requirements should be part of the safe component's metadata and type parameters.
- **Acceptance** `SafeRiskyComponent` type includes `ErrorTheme` when any handler requires it; rendering without `ErrorTheme` fails early with a tagged error; rendering with `ErrorTheme` works for both success and fallback paths.
- **Tests** Add a test in `packages/core/src/components/__tests__/components.test.tsx` where: (1) the risky component requires no services, (2) a handler component requires `ErrorTheme`, (3) `SafeRiskyComponent` is rendered without providing `ErrorTheme` and fails with missing-service error, (4) rendering with `ErrorTheme` succeeds and displays the fallback.
- **Verify** Run `bun run test` and confirm the new requirement-propagation test passes, and that the inferred type of `SafeRiskyComponent` in a TS test includes `ErrorTheme`.

### P0. Fix Component namespace export mismatch
- **Why** Users cannot use `Component.gen` and `Component.Type` together; this indicates the namespace export is inconsistent (likely type-only vs value-only exports or mismatched aliasing).
- **Change** Align exports so that `Component` is both a namespace/value and a type container: ensure `Component.Type` and `Component.gen` come from the same module and that the entrypoint re-exports preserve the namespace shape. If needed, re-export `Component` as a namespace object and separately export `ComponentType`/`ComponentProps` without shadowing.
- **Acceptance** In a consumer file, `import { Component } from "trygg";` allows `Component.gen` and `Component.Type` to be used together without TypeScript errors. This should work in `apps/examples` and in `packages/core` tests.
- **Tests** Add a small type-only test file (or `tsd`-style compile test) that imports `Component` from `trygg`, declares `Component.Type<...>` and `Component.gen(...)`, and passes `bun run typecheck` without errors.
- **Verify** Run `bun run typecheck` and ensure no TS errors in both the new type check file and existing example pages using `Component`.

### P0. Restore key propagation in JSX runtime
- **Why** Keys are computed but ignored for component elements, which breaks keyed list reconciliation.
- **Change** After `type(resolvedProps)`, apply `keyed(resolvedKey, element)` (from `packages/core/src/primitives/element.ts`) before returning.
- **Acceptance** `<MyComponent key="x" />` yields an element where `getKey(element) === "x"`. In a keyed list, reordering component children keeps their DOM nodes and preserves internal signal state (no teardown/recreate for the same key).
- **Tests** Add a test in `packages/core/src/primitives/__tests__/renderer.test.tsx` that renders a keyed list of components, reorders the list via a `Signal`, and asserts that the `HTMLElement` reference for a given key is identical before/after the reorder.
- **Verify** Run `bun run test` and confirm the keyed list test keeps identical DOM references across reorders (same `HTMLElement` instance for the same key).

### P0. Merge context in Provide rendering
- **Why** `Provide` currently replaces the parent context. Nested providers can erase parent services, which is inconsistent with Layer semantics.
- **Change** In `packages/core/src/primitives/renderer.ts`, merge parent context with `providedContext`. Choose a clear precedence rule (likely "provided wins") and document it.
- **Acceptance** Nested providers preserve parent services: a child Provide adds services without removing existing ones, and if the same service is provided again the inner value wins deterministically. Behavior is consistent for layouts and component-provided contexts.
- **Tests** Add tests in `packages/core/src/primitives/__tests__/renderer.test.tsx` that: (1) parent provides ServiceA, child Provide adds ServiceB, grandchild reads both; (2) parent provides ServiceA=value1, child Provide overrides ServiceA=value2, grandchild reads value2.
- **Verify** Run `bun run test` and confirm both context-merge tests pass, with child overrides taking precedence while other parent services remain visible.

### P0. Fix error-boundary example regression
- **Why** `ErrorBoundaryPage` now passes a `Signal` where `RiskyComponent` expects a string, so errors never trigger.
- **Change** Either pass `yield* Signal.get(errorType)` or change `RiskyComponent` to accept `SignalOrValue` and unwrap safely (no casts).
- **Acceptance** Selecting `network`, `validation`, and `unknown` states produces the correct fallback UI, and `none` renders success. No type casts are required and the signal state drives the UI deterministically.
- **Tests** Add a focused test (in examples or core) that toggles a signal between the four states and asserts: (1) correct fallback component renders for each error, (2) success view renders when state is `none`.
- **Verify** Run `bun run examples`, open the ErrorBoundary page, click each error button, and confirm the correct fallback renders for each state and resets to success when set to `none`.

### P1. Remove sync schema decoding
- **Why** `Schema.decodeUnknownSync` throws synchronously, bypassing Effect error handling.
- **Change** Use `Schema.decodeUnknown` and map decode errors to `RenderLoadError` or a new tagged error.
- **Acceptance** Invalid route params or invalid route component values surface as `Exit.Failure` with a `RenderLoadError` (or a new tagged error), never a synchronous throw. `Schema.decodeUnknownSync` is no longer used in routing paths.
- **Tests** Add router tests that: (1) loader returns a non-component (e.g., string) and `Effect.exit(render(...))` is a `Failure` with a `RenderLoadError`, and (2) params include a non-string value and routing fails with the same error type, not a defect.
- **Verify** Run `rg "decodeUnknownSync" packages/core/src/router` and confirm no matches, then run `bun run test` and verify the new routing failure tests report `Exit.Failure` with `RenderLoadError`.

### P1. Fix Signal initialization fallback
- **Why** `Signal.suspend` uses `_textElementImpl!` in the error path and can crash when not initialized.
- **Change** Return a safe `Element.Text` without `!` or fail with a tagged `SignalInitError` (via Effect, not throw).
- **Acceptance** Calling `Signal.each` before initialization returns `Effect.fail(SignalInitError)` (no throws), and `Signal.suspend` returns a safe sentinel element or a failing Effect with `SignalInitError` (choose one and document). No `!` remains in these code paths and the error message is stable for test assertions.
- **Tests** Add a new test file that imports `Signal` without importing `element.ts` to keep `_eachImpl` and `_textElementImpl` unset. Assert that `Effect.exit(Signal.each(...))` fails with `SignalInitError`, and that `Signal.suspend` either yields a `Text` element with the expected message or fails with `SignalInitError` (matching the chosen behavior).
- **Verify** Run the new signal init tests and confirm the error is a tagged failure (not a throw), then ensure `Signal.suspend` behaves exactly as documented.

### P1. Make oxlint setup portable
- **Why** `.oxlintrc.json` hardcodes a local absolute path and the repo appears to include build output.
- **Change** Use a relative path (e.g. `./packages/oxlint-plugin/dist/index.js`) and add `packages/oxlint-plugin/dist/` + `packages/oxlint-plugin/node_modules/` to `.gitignore`.
- **Acceptance** `oxlint` runs from the repo root on a clean clone without editing paths; no `dist/` or `node_modules/` from `packages/oxlint-plugin` are tracked after build or install.
- **Tests** Add a repo script (e.g., `bun run lint`) that runs `oxlint` from root and document it. Verify locally or in CI that `git status` stays clean after building the plugin.
- **Verify** In a clean checkout, run `bun run lint` and then `git status --porcelain`; both should succeed with no tracked build output.

### P1. Remove legacy `effect-ui` naming
- **Why** The project was renamed to `trygg`, but old naming still appears in docs/templates, which is user-facing and confusing for new adopters.
- **Change** Replace `effect-ui` with `trygg` in docs, templates, and README files (including any sample code, CLI templates, or package descriptions).
- **Acceptance** A repo-wide search for `effect-ui` yields zero matches in user-facing files (docs, templates, README, examples, CLI output).
- **Tests** No new runtime tests needed; this is content correctness.
- **Verify** Run `rg "effect-ui"` at the repo root and confirm no results; check template output from `packages/cli` still references `trygg`.



### P1. Scope leak cleanup in tests
- **Why** Non-scoped tests that call `render(...)` can leak scopes/fibers.
- **Change** Convert `it(...)` to `it.scoped(...)` where `render` is used; specifically `packages/core/src/primitives/__tests__/component.test.tsx:540`.
- **Acceptance** Every test that calls `render(...)` is either `it.scoped(...)` or explicitly wrapped in `Effect.scoped`. A grep for `render(` in test files shows no usage inside plain `it(...)` blocks.
- **Tests** Run the full test suite and confirm there are no scope leak warnings; specifically watch for leaked fibers in `@effect/vitest` output.
- **Verify** Run `bun run test` and scan output for scope leak warnings or leaked fibers; none should be reported.

### P2. Lint rule false positives
- **Why** The lint rule requires inline disables in tests, indicating scope tracking gaps.
- **Change** Add unit tests for the lint rule that cover nested component trees and multiple child components; update scope tracking so disables are no longer required in tests.
- **Acceptance** The rule correctly recognizes parent `.provide(...)` across nested trees and multiple sibling components without needing inline disables. The test suite compiles with `trygg/no-unprovided-components` enabled and no suppressions in component tests.
- **Tests** Add oxlint plugin tests that cover: (1) multiple `<Child />` siblings under a single provided parent, (2) nested components where a callback is inside a component scope, and (3) `.provide([...])` arrays. Assert that diagnostics are emitted only when a required service is genuinely missing.
- **Verify** Run the oxlint plugin test suite and `oxlint` on `packages/core/src/primitives/__tests__/component.test.tsx`; there should be zero diagnostics and no inline disables.



## Suggested execution order
1. Fix ErrorBoundary `.provide` regression and JSX key propagation (highest risk behavior regressions).
2. Replace sync throws/defects with tagged errors and remove `as`/`!` in core runtime paths.
3. Fix Provide context merging and Signal initialization error handling.
4. Add missing tests and convert non-scoped tests.
