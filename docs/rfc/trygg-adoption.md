# Effect-first refactor evidence

Date: 2026-09-04.

Trygg adopts the applicable guarantees of [Effect-First Backend Engineering Quality Standard](./effect-first.md), version `1.1-draft`. The checked-in specification is an exact copy of `/home/host/dev/effect-backend-quality-rfc.md`, SHA-256 `be687adae2d89ad51e61d74c4ca07336ec289a7ec879170526eddc4ce4811ea5`.

## Applicability

The specification directly covers CLI, generated backend, configuration, and server adapters. Its ownership, composition, Cause, boundary, and testing principles also guide the UI runtime. Persistence transactions, durable delivery, and replay requirements apply only when those capabilities exist; a local reactive cache is not a durable backend cache.

The [Effect contributor guide](../agents/effect-typescript.md) links the specification and uses APIs from the installed `effect@4.0.0-rc.112`. `Context.Service`, `Layer.effect`, `Schema.decodeUnknownEffect`, and `Stream.paginate` replace obsolete guidance. Installed sources and declarations take precedence over examples for other Effect releases.

## Changes in this refactor

| Area | Change and guarantee | RFC |
| --- | --- | --- |
| Route resolution | Execution-local iterative traversal replaces concurrent fibers and repeated copying of the growing result. Depth-first declaration order, ancestor identity, and independent executions are preserved. | 8.4, 12.2, 19.5 |
| Route matching | Decode and validate the pathname once, then use the canonical pure matcher for all compiled candidates. Malformed encoding, dot-segment rejection, parameter names, precedence, and empty manifests retain their behavior. | 7.2, 8.1, 16.3 |
| Signal comparisons | Remove generator wrappers around direct Effect composition. Equality fallback, hashing, atomic mutation, and listener policies stay intact. | 8.4 |
| Renderer cleanup | Retain only failed Exits during batch release. Successful teardown no longer stores a result for every released node; Effect still combines failures and preserves interruption. | 10.3, 12.4 |
| Resource registry | Finalize every retired entry, release capacity even when a finalizer fails, and preserve all cleanup Causes. Acquisition rollback retains cleanup failures alongside the original Cause and settles pending admission. | 10.3–10.4, 12.3–12.4 |
| Link callbacks | Recover pure expected navigation failures with the existing diagnostic. Defects, interruption, and mixed Causes propagate to the event fiber owner. | 10.3–10.4, 17.5 |

No public signatures or dependency versions changed in this refactor. Observable fixes are intentional: finalizer defects and interrupted or defective Link navigation can no longer appear as successful operations. Equally specific nested routes use declaration order independently of scheduler interleaving.

## Regression evidence

The starting worktree already contained substantial uncommitted changes and regression suites. Those changes were retained. The baseline passed `bun run check` and 1,611 tests: 1,457 core, 50 CLI, and 104 website tests. The first sandboxed test attempt could not open localhost ports; the authorized unrestricted run established the baseline.

Eight added cases exercise real implementations at their existing seams:

- [Matching](../../packages/core/src/router/__tests__/matching-performance.test.ts): exactly one URI decode per input segment across 100 candidates, late hits and misses, declaration order, isolated repeated execution, malformed input, and empty manifests. The decode-count test failed against the original implementation with 200 calls instead of 2.
- [Resource cleanup](../../packages/core/src/primitives/__tests__/resource-cleanup-regressions.test.ts): preserve deletion and batched TTL finalizer defects while completing all releases and reusing capacity. Batched cleanup previously returned success despite both defects.
- [Link Causes](../../packages/core/src/router/__tests__/link-cause.test.ts): preserve defects, interruption, Fail+Die, and Fail+Interrupt; continue recording and recovering expected navigation errors.

Existing renderer tests cover keyed-row identity and minimal DOM moves, fine-grained signal fanout, scheduler work during bulk creation, rollback, cleanup interruption, cache leases and capacity, and concurrent updates. Passing these tests is evidence for those cases, not a proof of every possible interleaving or browser behavior.

## Performance measurements

Run `bun scripts/benchmark-runtime.ts`. The script exercises production source with Effect's normal scheduler, disables logging consistently, warms each operation, and reports the median of seven samples. Manifest construction and matcher compilation are outside lookup timing. Each resolution sample performs 10 operations; each lookup and cleanup sample performs 20.

Local Bun measurements in this workspace, milliseconds per operation:

| Operation | Before | After |
| --- | ---: | ---: |
| Resolve 1,000 flat routes | 3.398 | 0.012 |
| Resolve 4,000 flat routes | 28.496 | 0.060 |
| Match last of 1,000 routes | 2.978 | 0.036 |
| Match last of 4,000 routes | 12.568 | 0.151 |
| Miss across 4,000 routes | 12.961 | 0.124 |
| Finalize 10,000 successful releases | 0.300 | 0.270 |

Timing is environment-dependent, particularly for short operations. The small cleanup timing difference is not a speed guarantee; its structural improvement is retaining only failures. The router still scans candidates linearly. Route resolution uses linear accumulation, plus the cost of materializing ancestor arrays and absolute paths for nested routes. No browser latency or memory benchmark is claimed.

## Validation scope

All final commands exited successfully:

| Gate | Result |
| --- | --- |
| `bun run check` | Lint, formatting, workspace typecheck, core build and published type tests passed; Effect diagnostics: 175 core files and 27 CLI files, zero errors/warnings/messages |
| `bun run test` | 1,619 passed: 1,465 core, 50 CLI, 104 website |
| `bun run --cwd packages/core docs:check` | 339 reachable exports validated |
| `bun run --cwd apps/examples build` | Client and production server built |
| `bun run www:build` | Website production build passed |
| `git diff --check` | Passed |

The release script still emits pre-existing informational Schema suggestions during typecheck. Happy DOM logs refused requests for fixture stylesheets during the tests, and the website build reports a large-chunk warning; none failed their gates. No regression was detected by the executed checks.

The historical `effect-rfc-review.md` describes an older, already-dirty snapshot against RFC `1.0-draft`. This document records current changes and executed evidence; it does not retroactively certify every historical finding as closed. Real-browser end-to-end tests and durable backend facilities outside Trygg's scope are not covered by this refactor.
