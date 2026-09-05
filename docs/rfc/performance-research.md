# Performance research and experiments

This is an implementation research log for the [end-to-end audit](./end-to-end-audit.md), not a claim of optimal framework performance.

Latest experiment: [bounded OTLP/SigNoz profiling](./profiling-signoz.md) adds a
separate off/paused/record overhead block and locally analyzed phase evidence.
Final profiles sent 15,400 spans with collector acceptance; an authenticated MCP
query now confirms indexing of one complete seven-span trace. Preparation/render
is the leading measured phase candidate, not
a CPU attribution. The prior A–E–H granular +12.3% gap remains open; the profiling
experiment is not a replacement baseline or an accepted performance optimization.

Browser timing provenance: the earlier fixture applied `MinimumLogLevel=None`
only while producing the root element. Nested rendering could still log. The
[corrected silent baseline](#correcting-browser-logging-scope) is the reference
for future optimization comparisons. Earlier raw runs remain historical evidence
under their actual logging configuration; do not interpret their absolute times
as silent rendering costs or compare them directly with the corrected fixture.

## Verification after middleware boundary review

The complete nine-case Chromium run passed after correcting initial Outlet
redirect admission and test-container rollback. Create-10k measured a 310.0 ms
handler median; first contentful paint was 80 ms. These are local follow-up
observations, not a controlled comparison. The table fixture does not use Outlet
or the testing entrypoint, so it verifies ordinary DOM behavior without measuring
the changed redirect or failed-mount paths. No memory probe was enabled.
[Browser samples](./browser-after-middleware-audit.json),
[source/version metadata](./browser-after-middleware-environment.json).

The runtime probe recorded 0.164 ms/op for matching the last of 4,000 routes,
0.121 ms/op for a miss, and 0.266 ms/op for 10,000 no-op releases.
[Command and output](./runtime-after-middleware.txt). No matching/cleanup
optimization was introduced in this step and these timings do not measure
middleware latency.

## Resource cache hits

The registry previously cloned three private Maps on state transitions and scanned
all cache entries for expiration on every lookup. Its Maps now mutate only inside
synchronous Ref decisions, with cleanup outside those decisions. A conservative
next-expiration bound skips scans until an entry could expire. Renewals and
deletions may leave the bound earlier than necessary, which permits an extra scan
without delaying expiration. Tests cover exact boundaries and backward clock
movement; LRU order is not assumed to be expiration order.

Two fresh Bun processes measured the original source, followed by two fresh
processes measuring the final cache and ownership changes. Each case used 100
warmup operations and seven samples of 1,000 operations against a fully populated
cache, with a one-hour idle TTL. The benchmark asserts shared entry/Signal identity.
Medians in microseconds per operation:

| Capacity | Operation        | Before 1 | Before 2 | After 1 | After 2 |
| -------: | ---------------- | -------: | -------: | ------: | ------: |
|       16 | Registry lookup  |    5.046 |    4.940 |   4.783 |   4.598 |
|       16 | Scoped fetch hit |   15.503 |   15.109 |  13.744 |  14.780 |
|      256 | Registry lookup  |    8.764 |    8.803 |   4.068 |   4.134 |
|      256 | Scoped fetch hit |   24.381 |   24.043 |  13.282 |  13.637 |
|    2,048 | Registry lookup  |   46.772 |   45.729 |   5.612 |   5.693 |
|    2,048 | Scoped fetch hit |  126.281 |  117.504 |  16.733 |  16.851 |

At the default capacity of 256, the average of the two run medians decreased by
53.3% for lookup and 44.4% for scoped fetch hits. At 2,048 entries, the decreases
were 87.8% and 86.2%. These sequential before-before-after-after runs are exploratory,
not an interleaved experiment or proof of statistical significance. They exclude
I/O, misses, expiration sweeps, capacity churn, and DOM. Full sweeps remain linear;
the results do not establish constant cost for every registry operation.

Run `bun scripts/benchmark-resource.ts`. Raw samples:
[before 1](./resource-cache-before-1.json), [before 2](./resource-cache-before-2.json),
[after 1](./resource-cache-after-1.json), [after 2](./resource-cache-after-2.json).
[Environment and source hashes](./resource-cache-environment.json) record Bun 1.4.0,
Effect 4.0.0-rc.112, and both source snapshots.

A subsequent shutdown audit added owner-state checks, rejected commits after
closure, and cleared retained cache references when the Layer closes. Two further
fresh-process runs with these final guards recorded the following microsecond
medians:

| Capacity | Operation        | Final run 1 | Final run 2 |
| -------: | ---------------- | ----------: | ----------: |
|       16 | Registry lookup  |       4.827 |       4.503 |
|       16 | Scoped fetch hit |      14.034 |      13.728 |
|      256 | Registry lookup  |       4.381 |       4.371 |
|      256 | Scoped fetch hit |      14.041 |      13.451 |
|    2,048 | Registry lookup  |       6.428 |       5.337 |
|    2,048 | Scoped fetch hit |      16.900 |      18.002 |

The reduction against the original run medians remains about 50% for lookup and
43% for scoped fetch hits at capacity 256. These follow-ups support retaining the
optimization together with its shutdown guarantees; they do not isolate the
guards' overhead from process and sample variation.
[Final run 1](./resource-cache-shutdown-1.json),
[final run 2](./resource-cache-shutdown-2.json),
[final source/version metadata](./resource-cache-shutdown-environment.json).

The cache design research provides context rather than a transplanted algorithm.
[Caffeine's design notes](https://github.com/ben-manes/caffeine/wiki/Design) describe
access-order metadata for eviction and idle expiration, separate retired/dead entry
states, and timer wheels for variable deadlines. The engineering inference for
Trygg is to separate lookup, policy bookkeeping, and resource release, then measure
their costs independently. Trygg retains its existing LRU and lease semantics;
timer wheels or frequency-based admission need evidence from pressure and expiry
workloads before adding their complexity.

The production renderer was rebuilt after the shutdown fix and all nine browser
interaction cases passed, including DOM identity/order assertions and rejection
of page exceptions or console errors. The create-10k handler median was 312.3 ms
and first contentful paint was 80 ms in this Chromium process. The fixture does
not use Resource, so this is browser regression evidence, not a cache speedup
measurement. No memory probe was enabled in this follow-up.
[Browser samples](./browser-after-resource-shutdown.json),
[source metadata](./browser-after-resource-environment.json).

## Runtime check after callback ownership changes

The 2026-09-05 local runtime run recorded 0.149 ms/op for matching the last of
4,000 routes, 0.120 ms/op for a miss at that size, and 0.275 ms/op for 10,000
no-op releases. [Command and medians](./runtime-after-vite-theme.txt) are retained.
This run exercises production router and cleanup operations, not the Vite or
theme callback bridges changed in that step. It is a sanity observation, not a
controlled performance comparison or evidence that these lifecycle fixes caused
a speedup. The controlled renderer comparison below remains the optimization
evidence; no new renderer optimization was made in this step.

## Independent renderer and portal lifetimes

The new lazy probe mounts and closes ten independent Renderer/Scope instances
per batch. Every mount has 100 derived signals, one native button handler, and
one dynamic portal. It asserts reactive updates in both the root and portal,
exact component release, empty published DOM after closure, and inactive handlers
when retained detached buttons are clicked. The probe uses the composable browser
Renderer Layer; it does not recreate the complete fire-and-forget browser bootstrap,
Router, or ResourceRegistry graph.

Two exploratory runs of 100 measured mounts passed the behavior checks and kept
37 listeners, but immediate post-close GC snapshots alternated between 37 and
69 nodes. Those raw observations remain available as
[immediate run 1](./browser-portals-immediate-1.json) and
[immediate run 2](./browser-portals-immediate-2.json). The next experiment allowed
an animation frame and subsequent task before GC, matching the interaction
fixture's frame settlement, and expanded to 1,000 measured mounts per browser.
This changes sampling policy; it does not identify the retainer of the transient
nodes. No heap-retainer attribution is claimed.

Both fresh Chromium runs then reported exactly **37 nodes and 37 listeners** in
all 101 independent-mount snapshots (baseline plus 100 batches). Each run acquired
and released exactly 1,000 measured components and portals, following a separate
10-mount warmup. Forced-GC heap bytes:

| Point                            | First run | Second run |
| -------------------------------- | --------: | ---------: |
| Warmed independent baseline      | 9,123,780 |  9,121,464 |
| After 100 measured mounts        | 9,244,424 |  9,260,452 |
| After 500 measured mounts        | 9,638,244 |  9,639,316 |
| After 700 measured mounts        | 9,699,656 |  9,684,468 |
| After 1,000 measured mounts      | 9,692,396 |  9,689,740 |
| Net change over final 300 mounts |    -7,260 |     +5,272 |

The measured heap reaches a plateau around 9.7 MB. This supports bounded retention
for this workload over these runs; it is not proof that all framework caches,
roots, or application configurations are leak-free. The initial approximately
569 KB increase has not been attributed to particular objects. Both persisted
pagehide/update and final non-persisted pagehide checks also passed, ending at
29 nodes and 36 listeners including the harness.

The ordinary nine interaction cases passed in the same runs. Create-10k handler
medians were 317.5 and 302.7 ms; first contentful paint was 92 and 84 ms. Startup
script resources total 558,683 JS bytes (170,606 bytes offline gzip), including the
fixture and shared runtime. The lazy mount probe adds a separate 2,102-byte chunk
(998 bytes gzip) not loaded at startup. Fixture and bundle composition changed, so
these values are observations rather than a controlled comparison to older runs.

Raw final samples: [first run](./browser-portals-settled-1.json),
[second run](./browser-portals-settled-2.json).
[Source/version metadata](./browser-portals-environment.json) records which sources
were measured and the later error-only finalizer annotation fix. Run with
`BENCHMARK_MEMORY=1 BENCHMARK_MOUNT_BATCHES=100` plus the documented Chromium path.

## Primary sources

### Detached DOM and explicit resource ownership

[Pienaar and Hundt, _JSWhiz: Static Analysis for JavaScript Memory Leaks_, CGO 2013](https://storage.googleapis.com/gweb-research2023-stg-media/pubtools/pdf/40738.pdf)
identifies framework event-registry and disposal patterns that keep otherwise
unused objects reachable. Its measurements connect retained DOM growth with
latency outliers in long-running workloads. Those Closure-era results do not
establish a defect in current Trygg or describe current Chrome internals.

The engineering application here is to measure repeated independent acquisitions,
verify listener removal and exact releases through production owners, and inspect
retainers before attributing a heap increase. Chrome's
[heap snapshot documentation](https://developer.chrome.com/docs/devtools/memory-problems/heap-snapshots)
provides the reference-graph view needed for that attribution. Total node counters
alone cannot identify which object retains a detached node.

### Change propagation and reuse

[Acar, Blelloch, Blume, Harper, and Tangwongsan, _An Experimental Analysis of Self-Adjusting Computation_, TOPLAS 2009](https://www.cs.cmu.edu/~blelloch/papers/ABBHT09.pdf) studies dynamic dependency tracking combined with memoization. Recomputing only dependencies affected by a change can save substantial work, but tracking alone does not guarantee faster incremental execution. The granularity at which work is reused matters.

Application to Trygg is an engineering inference: preserve row identity and scoped dependencies, measure which rows recompute after a mutation, and distinguish unnecessary work from work required by the public item/index callback contract. Changing a row's index cannot simply be ignored to improve removal timings.

### Real browser workloads

[V8, _How V8 measures real-world performance_](https://v8.dev/blog/real-world-performance) explains the move from isolated engine microbenchmarks toward representative sites, repeatable workloads, and profiling. Microbenchmarks remain useful for diagnosing a primitive but do not establish end-user performance.

Application to Trygg: keep the Bun runtime benchmark, but also measure production bundles in Chromium. Include creation, replacement, update, selection, reorder, removal, append, and cleanup. Validate output and identity before accepting a faster result. Record handler completion separately from frame latency.

### Warmup and sample stability

[Barrett, Bolz-Tereick, Killick, Mount, and Tratt, _Virtual Machine Warmup Blows Hot and Cold_](https://arxiv.org/abs/1602.00602) investigates assumptions about VM warmup and stable peak performance. A fixed number of discarded iterations is not, by itself, evidence that a VM reached steady state.

Application to Trygg: retain raw samples and the warmup policy. Compare equivalent workloads and browser versions, repeat promising changes, and inspect distributions. Current five-warmup/seven-sample runs are exploratory; they do not prove steady state or statistical significance.

### Framework benchmark workload reference

The upstream [js-framework-benchmark](https://github.com/krausest/js-framework-benchmark) defines keyed UI workloads and a browser-based measurement harness. Its [results index](https://krausest.github.io/js-framework-benchmark/index.html) warns that changes to browsers and benchmark drivers can invalidate comparisons across runs.

Trygg's fixture borrows the operation vocabulary. It uses its own deterministic data and per-row selector/derived signals. It is not an official submission or a valid ranking against the upstream published results.

## Experiment: repeated span construction

The first Chromium CPU profile of creating 10,000 reactive rows attributed approximately 142 ms of sampled self-time to Effect's `addSpanStackTrace`. This profile includes browser idle/frame work and profiling overhead, so those samples are a diagnostic, not an exact allocation of unprofiled handler latency.

Installed `effect@4.0.0-rc.112` source explains the mechanism: constructing `Effect.withSpan(name)` calls `addSpanStackTrace`, which allocates an Error even before the returned combinator executes. The call sites in `Signal.derive`, `deriveAll`, and `selector` have static names and internal source locations. Constructing those combinators once avoids repeating that work. Applying the combinator still executes `useSpan` in the calling fiber, creating independent spans with the correct parent and lifecycle.

The implementation retains span names, timing, failure behavior, and parent context. The captured internal source location moves to the reusable combinator declaration. `signal-spans.test.ts` verifies independent ended spans under different parents; the existing signal, reactive acquisition, and renderer performance suites passed 84 tests.

The exploratory full-browser rerun reduced create-1k from 45.6 to 30.4 ms and create-10k from 421.0 to 272.2 ms in handler medians. Removal changed from 46.7 to 32.6 ms. Clear varied from 13.5 to 14.3 ms and needs repeated measurement. These are preliminary observations: fixture scope typing was corrected during harness development, and equivalent final-harness before/after runs plus workload identity checks are still required before claiming a confirmed improvement.

## Controlled span comparison

Four fresh Chromium processes ran the stabilized fixture in A–B–B–A order
on the same host. A restores per-call `Effect.withSpan` construction; B uses
reusable combinators. Each run uses five warmups and seven retained samples
per operation. Both variants use the same production build, dependencies,
fixture, minification settings, viewport, operation order, and DOM assertions.

The baseline was made in an isolated copy of `packages/core/dist`: the one
`.pipe(withDeriveSpan)`, one `.pipe(withDeriveAllSpan)`, and two
`.pipe(withSelectorSpan)` call sites were replaced by their respective
`.pipe(Effect.withSpan("Signal.…"))` forms. Replacement counts were asserted.
Unused hoisted declarations remain but are tree-shaken from the browser bundle.
No worktree source or benchmark semantics were changed between variants.

Handler medians, milliseconds:

| Operation          | A first | B first | B second | A second |
| ------------------ | ------: | ------: | -------: | -------: |
| Create 1k          |    47.7 |    34.1 |     34.7 |     47.0 |
| Replace 1k         |    61.3 |    46.3 |     45.3 |     60.1 |
| Update every tenth |     6.2 |     4.5 |      4.9 |      6.4 |
| Select             |     0.3 |     0.3 |      0.3 |      0.3 |
| Swap               |     1.6 |     1.2 |      1.2 |      1.4 |
| Remove second      |    51.2 |    36.1 |     36.1 |     51.9 |
| Append 1k          |    48.1 |    32.5 |     32.8 |     47.6 |
| Clear 1k           |    11.7 |    11.9 |     12.3 |     11.7 |
| Create 10k         |   466.8 |   311.0 |    322.0 |    463.8 |

All four runs passed row counts, labels, selection, and DOM identity checks,
with no browser page or console errors. Create-10k improved about 32% when
comparing the means of the two run medians; create-1k improved about 27%.
Clear was 0.2–0.6 ms slower in these B runs; this small difference needs more
samples before attribution. This is evidence for this optimization on this
workload, not proof of optimality, statistical significance, or every-device
performance. Small test processes overlapped parts of the experiment; repeat
on a dedicated host before establishing release thresholds.

Environment and exact fixture/build fingerprints: [metadata](./browser-span-ab-environment.json).
The baseline reverses only span construction; it does not represent the framework
before earlier router, cleanup, or lifecycle fixes.

Raw samples: [A first](./browser-span-ab-1-per-call.json),
[B first](./browser-span-ab-2-reused.json),
[B second](./browser-span-ab-3-reused.json),
[A second](./browser-span-ab-4-per-call.json).

## Retained heap and page lifecycle

`BENCHMARK_MEMORY=1` measures ten create-10k/clear cycles after the ordinary
create-10k timing case, then exercises persisted and non-persisted `pagehide`.
Both fresh Chromium processes passed DOM assertions, continued updates after
the persisted event, and complete removal of the mount container's children
on the non-persisted event. The benchmark drops its own global closure before
the final heap measurement.

The runner requests garbage collection before each snapshot. It records
JavaScript isolate heap usage through [CDP Runtime.getHeapUsage](https://chromedevtools.github.io/devtools-protocol/tot/Runtime/#method-getHeapUsage)
and document, node, and listener counters through [CDP Memory.getDOMCounters](https://chromedevtools.github.io/devtools-protocol/tot/Memory/#method-getDOMCounters).
These include the fixture and browser instrumentation; they are not framework-only
allocation or whole-process resident memory. Protocol response fields are decoded
with Schema in the benchmark host.

| Snapshot                     | First run heap bytes | Repeat heap bytes | DOM nodes (both runs) |
| ---------------------------- | -------------------: | ----------------: | --------------------: |
| Baseline after clear         |            8,337,792 |         8,335,424 |                    37 |
| 10k rows mounted             |           76,984,716 |        76,988,836 |               120,038 |
| Tenth clear                  |            8,368,356 |         8,365,972 |                    37 |
| After non-persisted pagehide |            8,258,840 |         8,257,108 |                    29 |

Every cleared snapshot had 37 DOM nodes, 37 event listeners, and one document.
The final heap differs from baseline by 30,564 and 30,548 bytes after the ten
cycles. This supports bounded retention in this workload; it does not prove
absence of all leaks. The 36 listener count after pagehide includes browser/runtime
instrumentation and must not be interpreted as 36 leaked framework handlers.
Separate owner-level listener checks and repeated independent mounts remain useful.

The lifecycle events are synthetic, so this does not establish completion of
asynchronous finalizers during physical tab destruction. Independent mount/dispose cycles, resource-cache retention, and heap attribution
remain pending. A separate first-paint baseline is recorded below.

Raw reports: [first run](./browser-memory-initial.json),
[repeat](./browser-memory-repeat.json).

## Removal profile after span reuse

The [removal CPU profile](./browser-remove.cpuprofile) uses the production renderer
with identifiers retained and a 100-microsecond requested sampling interval.
[Profiled timing samples](./browser-remove-profiled.json) have a 38.2 ms handler
median. They are diagnostic and cannot be compared directly with minified,
unprofiled measurements.

The sampled work is distributed across Effect evaluation/primitive creation,
DOM construction and attribute application, reconciliation, and garbage
collection. Unlike the initial creation profile, there is no dominant repeated
span-stack capture in the top sampled frames. Approximately 93 ms in `(program)`
includes work outside named JavaScript frames and must not be attributed to a
specific renderer operation. Removal changes surviving row indices, so optimizing
this path must preserve item/index callback semantics. The next investigation is
how much candidate DOM construction is needed before reconciliation and how to
avoid it without weakening rollback or row identity.

## Initial bundle and startup baseline

Two fresh Chromium processes loaded the empty benchmark app from localhost.
The driver waited for its first-contentful-paint entry before starting any row
workload, so startup is not mixed with the first setup operation.
The first-contentful-paint entries were 88 and 80 ms after navigation start;
DOMContentLoaded ended at 61.3 and 52.9 ms. These are two local observations,
not a percentile target, cold-device estimate, or network performance claim.

The generated JS assets total 557,390 bytes, or 169,896 bytes when each asset
is independently gzipped by Bun. This includes the benchmark fixture and all
shared/runtime chunks, excludes source maps, and does not measure the standalone
framework export size. The local server served uncompressed assets. Framework-only
import probes and bundle attribution are needed before choosing size optimizations.

Reports include each asset's sizes and startup entries:
[first process](./browser-startup-1.json), [second process](./browser-startup-2.json).

## Browser verification after callback audit

After preserving captured Schedulers, fixing command-palette admission, and
rejecting closed observer handles, the complete browser workload plus memory
and synthetic pagehide checks passed. Handler medians were 33.2 ms create-1k,
44.8 ms replace, 4.9 ms update, 0.3 ms select, 1.2 ms swap, 36.2 ms remove,
33.4 ms append, 12.6 ms clear, and 310.5 ms create-10k.

The ten create-10k/clear memory cycles returned to 37 DOM nodes and 37 listeners.
Heap usage was 8,714,004 bytes at that run's baseline and 8,714,096 after the
last clear. These heap values follow all nine timed cases, unlike the earlier
memory-only follow-ups to create-10k, so cross-run absolute heap comparisons
would mix different warmup workloads. Startup FCP was 92 ms on this local run.

[Raw report](./browser-after-callback-audit.json). The large creation gain remains
consistent with the controlled span experiment; the measurements do not establish
zero regression for every adapter or workload.

## Generated development API baseline

`bun run benchmark:dev-api` runs `scripts/benchmark-dev-api.ts`, which imports the actual generated handler module and
measures complete Web Request/Response conversion for a 64-byte text body, a
one-chunk Effect stream, and HEAD over the streaming route. Each operation has
200 warmups followed by seven batches of 1,000 requests. Request construction,
body consumption, and request finalizers are included. There is no TCP transport;
console request logging is disabled with MinimumLogLevel while the production
handler, middleware, and ownership code execute normally.

Two fresh Bun processes produced these medians, in microseconds per operation:

| Operation |  Run 1 |  Run 2 |
| --------- | -----: | -----: |
| Text      | 12.317 | 12.721 |
| Stream    | 25.854 | 26.284 |
| HEAD      | 11.907 | 11.611 |

Both runs validated response status/body and exactly 21,600 request releases
for 21,600 requests. Raw samples: [run 1](./dev-api-owner-1.json),
[run 2](./dev-api-owner-2.json); source hashes, Effect version, and host metadata:
[environment](./dev-api-owner-environment.json). These sequential local runs
establish a baseline for the corrected lifecycle. They do not demonstrate an
improvement over the earlier unsafe implementation, steady state, network
latency, throughput under concurrency, or optimality.

## Generated HTTP span projection

After adding projection before tracer delivery, two fresh Bun processes again
validated all 21,600 request releases each. Medians in microseconds per operation:

| Operation |  Run 1 |  Run 2 |
| --------- | -----: | -----: |
| Text      | 13.216 | 12.794 |
| Stream    | 26.584 | 24.630 |
| HEAD      | 11.791 | 12.564 |

The delegate uses prototype methods, allocating one small wrapper per server span.
It preserves tracing and projects attributes and terminal values before forwarding
them to the configured tracer. The HTTP context is composed with `Layer.flatMap`.
Production API servers also stop composing the same request logger twice; real
Node/Bun process tests require exactly one response log.

Raw samples: [run 1](./dev-api-http-telemetry-1.json),
[run 2](./dev-api-http-telemetry-2.json);
[source hashes and environment](./dev-api-http-telemetry-environment.json).
These sequential local measurements show the cost of the protected workload,
not a controlled improvement, a statistical equivalence result, or a network
latency guarantee. The benchmark suppresses console logging, so it does not
measure the benefit of removing the duplicate production log.

The subsequent automatic HTTP logger projection adds a scoped logger context
around the response log while preserving application logger identities. It reuses
the composed middleware graph per logger configuration. Two fresh processes again
finalized all 21,600 requests each; medians in microseconds per operation were:

| Operation |  Run 1 |  Run 2 |
| --------- | -----: | -----: |
| Text      | 14.373 | 15.508 |
| Stream    | 27.860 | 27.371 |
| HEAD      | 13.480 | 13.001 |

Raw samples: [run 1](./dev-api-http-logger-1.json),
[run 2](./dev-api-http-logger-2.json);
[source hashes and environment](./dev-api-http-logger-environment.json).
These samples have higher medians than the immediately preceding span-only runs.
They include the extra context setup even though console output is filtered.
The sequential measurements do not isolate that cost statistically; they establish
the current protected workload's baseline and justify further profiling of context
setup.

## Navigation coordinator baseline

`bun run benchmark:navigation` measures the actual NavigationCore and in-memory
adapter after protecting snapshot reconciliation from post-mutation cancellation.
It uses replace transitions to keep history storage bounded, 200 warmup batches,
and seven measured batches of 1,000 operations at concurrency 1 or 8. After each
batch, assertions compare coordinator and adapter path, query, hash, scroll key,
and the exact monotonic navigation count.

Two fresh Bun processes produced these amortized microseconds per navigation:

| Concurrent callers |  Run 1 |  Run 2 | Verified transitions per run |
| ------------------ | -----: | -----: | ---------------------------: |
| 1                  | 10.156 | 10.122 |                        7,200 |
| 8                  |  8.700 |  8.584 |                       57,600 |

Raw samples: [run 1](./navigation-coordinator-1.json),
[run 2](./navigation-coordinator-2.json);
[source hashes and environment](./navigation-coordinator-environment.json).
Validation occurs outside timed batches. These numbers measure aggregate
coordinator throughput, not individual contended-request latency, browser history,
Router Signal publication, or rendered navigation latency. There is no controlled
before/after comparison or proof of steady state.

## Router publication baseline

`bun run benchmark:router` measures Router.testLayer after committed publication
became Router-owned. Each operation includes target resolution, bounded replace
history, the publication fiber, Signal update, subscriber delivery, and the caller's
join. One route subscriber reads both current route and projected query. Warmup
and sampling match the coordinator workload above, but the measured work differs.

Two fresh Bun processes produced these amortized microseconds per navigation:

| Concurrent callers |  Run 1 |  Run 2 | Transitions per run | Notifications per run |
| ------------------ | -----: | -----: | ------------------: | --------------------: |
| 1                  | 29.791 | 31.682 |               7,200 |                 7,200 |
| 8                  | 37.034 | 35.729 |              57,600 |                 7,200 |

Every sample verifies the exact navigation count, latest observed version, target
path/query/hash, matching projected query, and notification bounds. Concurrent
superseded versions need not publish; these runs delivered one winning notification
per eight-operation batch. Assertions run outside timed batches; the subscriber's
reads and bookkeeping remain inside them.

Raw samples: [run 1](./router-publication-1.json),
[run 2](./router-publication-2.json);
[source hashes and environment](./router-publication-environment.json).
This establishes the current ownership-preserving workload's baseline. It does not
isolate fiber overhead or establish an improvement over the previous cancellation
bug. It excludes DOM, native history, scroll, exporters, and console I/O; concurrency
numbers are amortized throughput, not individual request latency. Performance under
slow subscribers and retained memory across full Router lifetimes remain separate
measurements.

## Navigation activation retained memory

The built-in Outlet now admits activations using the Router's monotonic version.
It retains one highest accepted version, rejects duplicates, and interrupts older
versions even when they were skipped originally. The public RouteActivation API
continues to reject arbitrary string-ID reuse exactly for its lifetime, which
requires retaining those IDs. Outlet no longer uses that protocol.

`bun run benchmark:activation-memory` compares both actual constructors in fresh
Bun processes, in A–B–B–A order. Each coordinator remains live for 101,000 claims;
versions have gaps. After yielding to queued host callbacks, each checkpoint runs
`gcAndSweep()` and records `heapStats()`. Bun documents the former as synchronous
collection and sweeping, and the latter's heap size as already including owned
external memory, so external bytes are not added again.
([gcAndSweep](https://bun.sh/reference/bun/jsc/gcAndSweep),
[heapStats](https://bun.sh/reference/bun/jsc/heapStats)).

Retained heap in decimal MB:

| Claims  | String IDs A1 | Versions B1 | Versions B2 | String IDs A2 |
| ------- | ------------: | ----------: | ----------: | ------------: |
| 1,000   |         7.580 |       7.549 |       7.546 |         7.617 |
| 11,000  |         8.712 |       7.692 |       7.693 |         8.727 |
| 31,000  |        11.787 |       7.703 |       7.704 |        11.779 |
| 61,000  |        13.244 |       7.714 |       7.716 |        13.242 |
| 101,000 |        17.824 |       7.724 |       7.709 |        17.835 |

Both version runs retain 6,561 strings from 11,000 claims onward; the string-ID
runs reach 107,552 strings. The version protocol stabilizes around 7.7 MB while
the arbitrary-ID history continues growing. Every checkpoint verifies the latest
owner; both modes reject a stale owner's work without invoking its callback.

Raw samples: [A1](./activation-memory-a1.json), [B1](./activation-memory-b1.json),
[B2](./activation-memory-b2.json), [A2](./activation-memory-a2.json);
[source hashes and environment](./activation-memory-environment.json).
This isolates coordinator retention with explicit collection. It does not measure
whole-application browser memory, DOM work, tracing exporters, latency, or throughput.

## Browser and handler ownership audit follow-up

After the staged-render rollback correction, Chromium 141.0.7390.122 again passed
all nine ordinary interaction cases, including row identity and order assertions.
Handler medians were 33.2 ms create-1k, 44.8 ms replace-1k, 5.1 ms update,
0.3 ms select, 1.2 ms swap, 36.0 ms remove, 30.9 ms append-1k, 11.4 ms clear,
and 321.2 ms create-10k. First contentful paint was 80 ms.

[Raw samples](./browser-after-lifecycle-audit.json),
[source hashes and environment](./browser-after-lifecycle-environment.json).
The memory probe was disabled. This fixture does not inject render or rollback
failure; the measurements verify the ordinary workload after the change and do
not establish faster rollback or statistical equivalence with an earlier run.
For example, the create-10k median is higher than the earlier 302.7 ms observation;
these sequential runs do not isolate a causal performance difference.

A separate deterministic renderer regression executes 1,001 completed DOM event
handlers while their actual structural owner and the mount remain live. Both
finalizer counts equal the baseline after the first event. Another test removes
a provided Component during a suspended handler and verifies that the provider
remains live until the handler's blocked finalizer completes. These establish
registration-retention and lifetime ordering guarantees, not whole-heap bounds
or browser interaction latency.

## Outstanding hypotheses

- Determine whether per-row subscription acquisition or Effect dispatch dominates after removing repeated stack captures.
- Measure removal and reorder with callbacks that consume indices; maintain their output and cleanup semantics.
- Profile allocation and retained heap after repeated create/clear, including selector buckets and resource leases.
- Compare production logging-disabled and tracing-enabled paths without removing required failure evidence.
- Expand router and resource measurements across scale, cache pressure, and contention; avoid optimizing a single favorable input.

## Incident authentication verification baseline

The incident template now verifies configured bearer credentials before protected
repository acquisition. `MutationPolicy.tokenLayer` creates native WebCrypto HMAC
verification material once per Layer acquisition and verifies each bounded token
without a JavaScript string-equality shortcut. The browser credential middleware
uses the existing HttpApi client extension, and its private token is cleared with
the application owner.

`bun run benchmark:incident-auth` runs the production verifier in a fresh Bun
process: 200 warmups and seven batches of 1,000 sequential verifications per
variant. The invalid fixture has the same length and a different final character.
Each operation includes Effect exit capture and success/failure classification.
The benchmark uses public fixture strings, never application credentials.

| Fresh process | Valid median (µs) | Invalid median (µs) |
| ------------- | ----------------: | ------------------: |
| 1             |             7.115 |               7.363 |
| 2             |             8.613 |               8.691 |

Raw samples, runtime/CPU metadata, and exact source hashes are in
[run 1](./incident-auth-1.json) and [run 2](./incident-auth-2.json).
These are local sequential observations, not a before/after improvement or a
constant-time proof. They exclude Layer construction, HTTP middleware and
transport, repository work, DOM, and concurrent admission. End-to-end HTTP and
credential ownership behavior are covered separately by the CLI tests.

The implementation uses the standard [WebCrypto verify operation](https://developer.mozilla.org/en-US/docs/Web/API/SubtleCrypto/verify)
for HMAC verification. The [Bearer Token Usage specification](https://www.rfc-editor.org/rfc/rfc6750)
informs header syntax, challenges, and HTTPS guidance; this static operator token
is not an OAuth issuer, expiry service, or per-user identity system.

## Keyed-list DOM construction audit

The next measured target is provisional DOM construction during updates that
ultimately preserve existing nodes. `BENCHMARK_WORK=1` now runs a separate probe
**after** each case's timing samples. It forwards the native
`Document.createElement`, `createTextNode`, and `createComment` methods through
counting proxies, restores all three in `finally`, and keeps the existing DOM
identity/content assertions. These are explicit API-call counts, not total engine
allocation or retained-memory measurements.

The complete Chromium run used five warmups and seven timing samples per case:

| Operation          | Handler median (ms) | Elements created | Text nodes created | Comments created | Rows created |
| ------------------ | ------------------: | ---------------: | -----------------: | ---------------: | -----------: |
| Create 1,000       |               34.30 |            7,000 |              3,000 |            2,000 |        1,000 |
| Replace 1,000      |               43.70 |            7,000 |              3,000 |            2,000 |        1,000 |
| Update every tenth |                4.90 |              700 |                300 |              200 |          100 |
| Select             |                0.30 |                0 |                  0 |                0 |            0 |
| Swap two rows      |                1.20 |               14 |                  6 |                4 |            2 |
| Remove second row  |               36.40 |            6,986 |              2,994 |            1,996 |          998 |
| Append 1,000       |               31.70 |            7,000 |              3,000 |            2,000 |        1,000 |
| Clear              |               12.50 |                0 |                  0 |                0 |            0 |
| Create 10,000      |              311.50 |           70,000 |             30,000 |           20,000 |       10,000 |

Raw [full results](./browser-work-baseline.json), an independent
[remove-only run](./browser-remove-work-baseline.json), and
[environment/source hashes](./browser-work-environment.json) accompany this table.
Removing the second row preserves all 999 surviving DOM rows but creates 998
provisional rows. The source explains why: changed indices require rerunning the
row Effect; `renderItem` then builds a complete staged DOM range before the old
result attempts reconciliation. Successful reconciliation discards that staged
DOM. The same pattern appears for 100 label updates and two swapped rows.

The exploratory [CPU profile](./browser-remove-baseline.cpuprofile) and its
[run output](./browser-remove-profile-baseline.json) include static subtree
construction, native DOM creation, reconciliation, and substantial Effect runtime
work. Profiling uses named identifiers and samples through the following frame;
it is not directly comparable with the normally minified timing runs. It does not
establish that DOM construction accounts for the entire removal cost.

[Adapton's PLDI 2014 paper](https://www.cs.tufts.edu/~jfoster/papers/pldi14.pdf)
provides a relevant design principle: reuse computations according to actual
dependencies, with an explicit separation between incremental reads and outer
mutation. Its results do not justify suppressing arbitrary Trygg row Effects.
Those Effects can observe their index, acquire resources, or fail. The concrete
hypothesis here is narrower: retain their execution and scoped acquisition, but
avoid building a replacement DOM candidate when structural preparation proves
that the existing static result can reconcile it.

These baseline measurements defined the acceptance criteria for the prototype
below. It must preserve index-dependent output, exactly-once row execution,
scoped acquisitions, pre-commit rollback, mixed Causes, and native failure
behavior. It must stage unsupported/structurally changed rows before touching
committed nodes. Direct counters should show zero provisional row creation for
compatible update/swap/remove, followed by controlled before/after runs using the
same fixture. Retained scopes and user resources require separate lifetime
analysis; they cannot be closed merely because a render produced identical DOM.

## Static reconciliation preparation: accepted comparison

Compatible static keyed rows now execute their render Effect and acquire its
scope once, then prepare the normalized Element without constructing replacement
DOM. A non-mutating structural check on the existing result enables this path.
Unsupported structure still builds detached candidates before committed DOM is
patched. If a previously accepted reconciliation later declines, replacement is
built from the prepared Element without executing the user render again.

The new tests first reproduced provisional construction on remove/update/reorder.
They now observe zero element/text/comment creation while checking index-dependent
text, exact render counts, and surviving node identity. Other regressions cover
prepared resource release, retry after a later row failure, incompatible static
replacement, stable row Signals, old DOM subscription release, and a declined
preflight. The native failure test also exposed a partially applied property that
rollback failed to restore. The renderer now records attempted props before
writes. A replacement test exposed disposal using already-updated ItemState
markers; retirement now uses the captured old markers.

The comparison runs **A–B–B–A**, with A built in an isolated temporary copy from
the same implementation and consistency fixes, omitting only the static
`canReconcile` capability. Every run uses a fresh Chromium process, the same
fixture, five warmups, seven timing samples, and separate work probes.

| Operation          | A1 median (ms) | B1 median (ms) | B2 median (ms) | A2 median (ms) |
| ------------------ | -------------: | -------------: | -------------: | -------------: |
| Create 1,000       |          35.40 |          33.60 |          34.10 |          33.00 |
| Replace 1,000      |          45.40 |          44.90 |          44.80 |          44.20 |
| Update every tenth |           5.00 |           4.00 |           3.60 |           4.80 |
| Select             |           0.30 |           0.20 |           0.30 |           0.30 |
| Swap two rows      |           1.30 |           1.30 |           1.20 |           1.50 |
| Remove second row  |          37.70 |          24.80 |          26.10 |          36.40 |
| Append 1,000       |          32.80 |          32.00 |          31.20 |          31.80 |
| Clear              |          12.00 |          12.00 |          12.00 |          11.60 |
| Create 10,000      |         316.90 |         313.20 |         304.20 |         308.50 |

The mean of run medians falls from 37.05 to 25.45 ms for removal (**31.3%**) and
from 4.90 to 3.80 ms for updating 100 labels (**22.4%**). Both B runs create zero
provisional elements/text/comments for update, swap, and removal; both A runs
retain the baseline counts. Creation, replacement, and append keep their required
construction counts. The smaller timing differences in other cases are not
claimed as improvements. This remains a local measurement, not a dedicated-host
release threshold or proof of maximum possible performance.

Raw runs: [A1](./static-preparation-control-a1.json),
[B1](./static-preparation-control-b1.json),
[B2](./static-preparation-control-b2.json),
[A2](./static-preparation-control-a2.json).
[Environment and source hashes](./static-preparation-environment.json) and the
[exact baseline transformation](./static-preparation-baseline.diff) describe the
comparison. The earlier [exploratory optimized run](./browser-static-preparation-after.json)
and [initial control calibration](./static-preparation-exploratory-a.json)
are separate from these controls. Full validation passes 1,801 tests, including
keyed lifecycle and Cause regressions; the core, templates, examples, and website
also build. Further retained-scope analysis and repeated native rollback failure
cases remain part of the wider RFC audit.


## Recovery after failed native patch and rollback

Two production DOM regressions reproduced stale attributes after retry and a
nested Signal attribute subscription retained after row removal. The renderer
now remembers every possibly applied property key until a patch completes, and
keeps aborted subtrees reachable by subscription cleanup. A failure-only property
union avoids allocating that recovery snapshot during successful reconciliation.
Native defects continue through the existing Effect boundary; no Cause is caught
or translated by the synchronous bookkeeping.

A fresh Chromium A–B–B–A comparison checks the successful path. A is the previous
static preparation implementation; B includes this recovery fix. The coordinator
has only a comment difference. Both variants build and use static preparation.
Each process uses five warmups and seven samples for each of nine operations,
with separate native construction counters afterward. No tests or builds ran
during the measurements. Handler medians in milliseconds:

| Operation | A1 | B1 | B2 | A2 |
| --- | ---: | ---: | ---: | ---: |
| Create 1k | 33.6 | 34.0 | 32.6 | 33.4 |
| Replace 1k | 45.6 | 45.7 | 46.7 | 44.0 |
| Update 100 labels | 3.8 | 3.7 | 3.6 | 3.6 |
| Select | 0.3 | 0.3 | 0.3 | 0.3 |
| Swap | 1.2 | 1.1 | 1.2 | 1.2 |
| Remove | 27.4 | 26.1 | 24.5 | 27.1 |
| Append 1k | 32.1 | 32.2 | 31.7 | 32.4 |
| Clear | 11.9 | 12.2 | 12.0 | 11.5 |
| Create 10k | 310.5 | 300.4 | 305.8 | 308.7 |

All workload assertions pass. Update, swap, and removal construct zero explicit
Element/Text/Comment nodes in every process, preserving the previous work-count
improvement. Replacement and clear medians are modestly higher with B; these
shared-host samples do not establish their significance or prove universally
unchanged performance. Removal retains the main earlier improvement. This is a
correctness fix with local performance observations, not a claimed new speedup.
It does not measure failures, retained heap, or native construction acquisition
failure, which remains separate audit work.

Raw runs: [A1](./double-rollback-control-a1.json),
[B1](./double-rollback-control-b1.json), [B2](./double-rollback-control-b2.json),
[A2](./double-rollback-control-a2.json). The [source difference](./double-rollback-control.diff)
and [environment/source/built-JS/artifact hashes](./double-rollback-environment.json)
record the measured variants. Regression validation: 1,803 full-suite tests;
final strengthened tests also pass in the focused keyed suites. Full check and
documentation contract pass (191 core/30 CLI diagnostic files; 340 exports).


## Static acquisition, interruption, and release audit

Four initial real-DOM tests reproduced subscriptions leaked by failed properties,
child insertion, root insertion, and failed root rollback. Follow-up tests exposed
interruption skipping recovery, interrupted successful handoff losing the completed
result, and native removal skipping subscription cleanup. The final fourteen-test
matrix covers direct and keyed rendering, successful and failed reentrant native
writes, final keyed marker failure, and normal unmount failure. Every partial child
is retained before acquisition; native failure enters Effect rollback. Bounded
native masks allow recovery to settle, while user component rendering restores
interruptibility. Mixed interruption/native Causes remain observable, and teardown
releases subscriptions even if detachment fails.

A fresh-process A–B–B–A comparison uses the previous double-rollback renderer as A
and these additional acquisition/transfer/release guarantees as B. Both use static
preparation. Five warmups and seven handler samples run per operation, followed by
a separate native-construction probe. No tests or builds ran during measurements.
Handler medians in milliseconds:

| Operation | A1 | B1 | B2 | A2 |
| --- | ---: | ---: | ---: | ---: |
| Create 1k | 34.0 | 35.8 | 35.5 | 32.1 |
| Replace 1k | 44.4 | 45.0 | 47.3 | 45.1 |
| Update 100 labels | 3.9 | 3.9 | 4.0 | 4.1 |
| Select | 0.3 | 0.3 | 0.2 | 0.3 |
| Swap | 1.2 | 1.2 | 1.0 | 1.1 |
| Remove | 25.1 | 28.6 | 27.3 | 26.7 |
| Append 1k | 31.5 | 33.7 | 33.3 | 32.4 |
| Clear | 11.9 | 12.7 | 11.8 | 12.3 |
| Create 10k | 303.7 | 326.2 | 323.0 | 308.0 |

All workload assertions pass. Update, swap, and removal still create zero explicit
Element/Text/Comment nodes. However, creation of 10k rises from 305.85 to 324.60 ms
using the mean of the two medians per variant (6.1%); removal rises from 25.90 to
27.95 ms (7.9%). Creation of 1k and append also rise. This is evidence of a local
performance cost, not a successful performance optimization. Shared-host timing
limits remain, but the cost must be investigated rather than dismissed. The next
performance task is to profile acquisition Effects/allocations and their later GC
impact while preserving every new failure, interruption, and handoff test. These
measurements do not isolate which new bookkeeping contributes to the cost.

The [V8 fast-properties explanation](https://v8.dev/blog/fast-properties) describes
how identical property order supports shared object shapes and optimized access.
`StaticBuilt` initialization retains uniform property order as ownership moves
ahead of native writes. This is an implementation constraint; no measured speedup
is attributed to object shapes here, and the source is not a guarantee about the
current engine's optimization of this renderer.

Raw runs: [A1](./static-acquisition-control-a1.json),
[B1](./static-acquisition-control-b1.json), [B2](./static-acquisition-control-b2.json),
[A2](./static-acquisition-control-a2.json). The [source difference](./static-acquisition-control.diff)
and [environment/source/built-JS/artifact hashes](./static-acquisition-environment.json)
record both variants. The reconstructed A sources were checked against the previous
measurement's B hashes before building. Full tests pass: 1,817 (1,626 core, 87 CLI,
104 website). Full check passes (192 core/30 CLI Effect diagnostic files), and the
documentation contract still covers 340 exports. Overall RFC verification and
performance completion remain unproven.


## Acquisition cost experiments and static preparation validation

The [creation profile](./static-acquisition-create10k.cpuprofile) and its
[benchmark report](./static-acquisition-create10k-profile.json) exposed Effect
primitive construction, runtime work, and GC as investigation targets. The sampled
window includes validation and the following frame, and profiling preserves
identifiers, unlike ordinary timings. It cannot attribute the entire operation's
cost to acquisition. Pinned Effect source inspection confirmed that
`uninterruptibleMask` invokes its callback lazily through `withFiber` and that
`onExit` masks finalizer invocation.

Acquisition simplifications were evaluated against the renderer containing all
fourteen acquisition/interruption/release fixes. The original acquisition code
remains in production:

| Candidate | Mean create10k run medians, A → B | Mean remove run medians, A → B | Decision |
| --- | ---: | ---: | --- |
| Remove two generators, preliminary create-only run | 328.75 → 319.60 ms | Not measured | Exploratory only |
| Remove two generators and redundant suspend, full run | 326.95 → 315.30 ms | 24.95 → 27.60 ms | Rejected: removal rose 10.6% |
| Remove only the outer generator, full run | 321.00 → 332.40 ms | 25.05 → 26.60 ms | Rejected: both rose |

Replacing `onExit` with a failure-only continuation also failed the existing
interrupted-successful-write test: the retained node still reacted after its
owner stopped. That variant was rejected before benchmarking. This is evidence
for retaining the finalization contract, not permission to recover cancellation
as success.

Sources, run data, the preliminary variant, and the rejected continuation are
recorded in [the first experiment environment](./acquisition-cost-environment.json),
[its full source difference](./acquisition-cost-control.diff),
[the preliminary source difference](./acquisition-generators-exploratory.diff),
[the rejected continuation](./acquisition-failure-continuation-rejected.diff), and
[the smaller experiment environment](./acquisition-outer-environment.json).

The retained change instead combines static prop eligibility with structural
compatibility during preparation. Matching retained tags and keys proves the
existing non-hoistable/unkeyed-child invariants; each candidate's props are still
checked. Mutation retains its independent eligibility check. A new production
regression verifies that an earlier scoped property Effect executes during
preparation and releases when a later row fails. Removing the props check made
that test fail with zero acquisitions instead of one; restoring it passes.

The initial five-warmup/seven-sample comparison was inconclusive. It is preserved
in [its environment and artifacts](./static-check-environment.json). The browser
runner now accepts `BENCHMARK_WARMUP` (0–100) and `BENCHMARK_SAMPLES` (odd, 1–101),
keeping defaults at 5 and 7. Invalid values fail before browser launch; the profile
still targets the first measured sample. Reports record the chosen counts.
The [sampling change](./benchmark-sampling-options.diff) applies identically to
both variants of the longer comparison.

With ten warmups and twenty-one samples per operation, four fresh processes ran
A–B–B–A with no concurrent tests or builds. Handler medians in milliseconds:

| Operation | A1 | B1 | B2 | A2 |
| --- | ---: | ---: | ---: | ---: |
| Create 1k | 33.5 | 33.0 | 32.9 | 32.8 |
| Replace 1k | 46.2 | 46.0 | 45.3 | 46.8 |
| Update 100 labels | 3.8 | 3.6 | 3.8 | 3.7 |
| Select | 0.3 | 0.2 | 0.3 | 0.3 |
| Swap | 1.2 | 1.2 | 1.1 | 1.2 |
| Remove | 25.6 | 26.9 | 25.4 | 25.9 |
| Append 1k | 32.8 | 32.2 | 32.9 | 32.6 |
| Clear | 12.0 | 12.0 | 11.9 | 11.9 |
| Create 10k | 327.8 | 315.4 | 314.5 | 324.6 |

The mean create10k run median is 326.20 ms for A and 314.95 ms for B (3.4% lower).
Update and removal change little; removal is 25.75 versus 26.15 ms, with overlapping
run ranges. This does not establish faster removal or a direct causal speedup in
creation: preparation validation is not executed by new-row construction, and the
full fixture carries allocation/JIT history between cases. Shorter runs were
inconclusive, and all runs share a host. Retain the reduced preparation traversal
with its regression coverage; do not claim universally improved performance or
closure of the earlier acquisition cost.

All workload assertions and separate counters pass. Compatible update, swap, and
removal still construct zero explicit Element/Text/Comment nodes. Raw longer runs:
[A1](./static-check-long-a1.json), [B1](./static-check-long-b1.json),
[B2](./static-check-long-b2.json), [A2](./static-check-long-a2.json).
The [source difference](./static-check-control.diff) and
[environment/source/built-JS/artifact hashes](./static-check-long-environment.json)
identify the measured implementation and updated harness. Comparing all non-test
core TypeScript sources confirmed that only `render-intrinsic.ts` differs between
these variants. Full validation passes with 1,818 tests (1,627 core, 87 CLI, 104
website), 192 core/30 CLI diagnostic files, and 340 documented exports.

Remaining allocation candidates include eagerly created event-context snapshots
and empty listener/subscription arrays on static nodes. These are source-inspection
hypotheses, not measured savings; evaluate them separately while retaining the
acquisition, context, interruption, and finalization tests. Clause-level RFC
verification remains incomplete.


## Event snapshots created only when needed

Static prop application previously constructed an event context for every node,
even when all its props were plain values or Signal bindings. It now creates the
snapshot at the first event binding and shares it across that node's remaining
handlers. Signal updates retain their existing render context. Event services,
Scope ownership, acquisition rollback, and interruption behavior are unchanged
in the validated tests; no user render Effect is skipped.

The primary abstract for [Memento Mori: Dynamic Allocation-site-based Optimizations
(ISMM 2015)](https://research.google/pubs/memento-mori-dynamic-allocation-site-based-optimizations/)
describes how temporal allocation feedback can inform memory-management and object
representation optimizations. This supports measuring actual execution rather
than translating source-level constructions into assumed heap savings. It is
historical compiler research, not evidence about this fixture's current optimized
machine code. This experiment measures handler timing and explicit native DOM
construction; it does not measure allocated heap bytes or retained memory.

Four fresh Chromium processes ran A–B–B–A with ten warmups and twenty-one samples
per operation, followed by separate native construction probes. A is the validated
renderer with acquisition/handoff fixes and combined preparation validation; B
adds only lazy event snapshots. No tests or builds ran during timing. Handler
medians in milliseconds:

| Operation | A1 | B1 | B2 | A2 |
| --- | ---: | ---: | ---: | ---: |
| Create 1k | 33.1 | 30.0 | 30.2 | 34.1 |
| Replace 1k | 45.2 | 43.1 | 42.5 | 49.0 |
| Update 100 labels | 3.9 | 3.4 | 3.6 | 3.6 |
| Select | 0.3 | 0.2 | 0.3 | 0.3 |
| Swap | 1.2 | 1.0 | 1.1 | 1.3 |
| Remove | 23.4 | 24.6 | 25.2 | 27.2 |
| Append 1k | 33.5 | 29.7 | 31.3 | 33.2 |
| Clear | 11.9 | 12.0 | 11.5 | 11.9 |
| Create 10k | 334.3 | 288.5 | 298.8 | 326.2 |

Using the mean of the two run medians, create10k falls from 330.25 to 293.65 ms
(11.1%), create1k from 33.60 to 30.10 ms (10.4%), and append from 33.35 to 30.50 ms
(8.5%). Removal is 25.30 versus 24.90 ms and clear 11.90 versus 11.75 ms; their
variation does not establish a meaningful improvement. All workload assertions
pass, and compatible update/swap/remove still construct zero explicit
Element/Text/Comment nodes. These local results support retaining the change,
not a universal speedup or a release threshold on this shared host.

Raw runs: [A1](./lazy-events-control-a1.json), [B1](./lazy-events-control-b1.json),
[B2](./lazy-events-control-b2.json), [A2](./lazy-events-control-a2.json).
The [source difference](./lazy-events-control.diff) and
[environment/source/built-JS/artifact hashes](./lazy-events-environment.json)
identify the variants. Full tests pass: 1,818 (1,627 core, 87 CLI, 104 website),
including native acquisition/interruption/release and nearest-provider handler
lifecycle tests. Full check passes with 192 core/30 CLI diagnostic files;
340 reachable exports pass the documentation contract. Other allocations,
retained heap, and clause-level RFC verification remain open.

## Effectful intrinsic acquisition ownership cost

The default browser fixture's rows qualify for static acquisition, so it cannot
isolate the cost of the effectful intrinsic renderer. A separate fixture changes
only each row's `data-id` from a string to `Effect.succeed(String(row.id))`, forcing
property evaluation through that renderer. The [fixture difference](./intrinsic-acquisition-fixture.diff)
is applied identically to both isolated checkouts. No benchmark switch or default
workload was changed in the repository.

The acquisition correction adds ownership for partial roots, child markers and
results, preserves cleanup Causes, and keeps property/child Effects interruptible.
Fourteen of eighteen new behavioral tests fail without it. The comparison below
measures its cost against the previous implementation; it is not an optimization
claim and does not justify retaining the previous resource leaks.

Four sequential Chromium 141.0.7390.122 processes ran A1–B1–B2–A2, each with ten
warmups and twenty-one measured samples, selecting `create1k`. A is the previous
implementation including property rollback; B adds native/child acquisition
rollback. Builds and tests had finished before measurement.

| Variant | Handler median (ms) | Frame median (ms) |
| --- | ---: | ---: |
| A1 | 43.20 | 81.50 |
| B1 | 45.40 | 82.80 |
| B2 | 44.00 | 82.00 |
| A2 | 42.90 | 81.30 |

The mean of run medians increases from 43.05 to 44.70 ms (1.65 ms, about 3.8%)
for 1,000 rows. Each separate work probe reports the same 7,000 elements,
3,000 text nodes and 2,000 comments. This probe counts native DOM construction,
not JavaScript allocations or retained heap. Some A2 handler samples exceed
70 ms; the raw samples are retained rather than discarded. These shared-host
results establish a local ownership cost, not a universal release threshold.

Raw runs: [A1](./intrinsic-acquisition-control-a1.json),
[B1](./intrinsic-acquisition-control-b1.json),
[B2](./intrinsic-acquisition-control-b2.json),
[A2](./intrinsic-acquisition-control-a2.json).
The [implementation difference](./intrinsic-acquisition-control.diff) and
[environment, source, compiled JavaScript and raw hashes](./intrinsic-acquisition-environment.json)
identify the measured variants. Equivalent allocation reductions are being
measured separately with the complete ownership correction retained.

### Rejected event snapshot preflight on the effectful path

A follow-up candidate scans the already-collected property entries and only
constructs an event snapshot when a defined event property exists. It captures
before evaluating property Effects, retaining the corrected acquisition ownership.
The [candidate difference](./intrinsic-snapshot-control.diff) is archived; the
candidate is **not** in the final source.

An isolated `create1k` A–B–B–A probe suggested a small reduction from 45.25 to
44.50 ms. Expanding to all nine operations with the same ten warmups and twenty-one
samples per fresh process did not confirm a useful reduction in creation or
removal. A is the fully protected renderer with eager snapshots, B adds preflight.

| Operation | A1 | B1 | B2 | A2 | A mean of medians | B mean of medians |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| create1k | 45.20 | 45.40 | 46.00 | 46.30 | 45.75 | 45.70 |
| replace1k | 67.60 | 66.00 | 66.10 | 66.60 | 67.10 | 66.05 |
| update | 78.50 | 78.60 | 78.50 | 78.00 | 78.25 | 78.55 |
| select | 0.30 | 0.30 | 0.30 | 0.30 | 0.30 | 0.30 |
| swap | 2.80 | 2.90 | 2.90 | 2.70 | 2.75 | 2.90 |
| remove | 757.80 | 756.90 | 746.20 | 745.10 | 751.45 | 751.55 |
| append1k | 43.80 | 43.00 | 44.30 | 44.50 | 44.15 | 43.65 |
| clear | 20.80 | 20.20 | 20.40 | 20.70 | 20.75 | 20.30 |
| create10k | 419.20 | 412.70 | 421.80 | 416.50 | 417.85 | 417.25 |

All values are handler milliseconds. The initial micro-result is insufficient
evidence to retain this additional preflight. The earlier protected source was
restored; source and retained compiled JS were hash-verified against the complete passing gates:
1,841 tests (1,650 core, 87 CLI, 104 website), full check (194 core/30 CLI Effect
diagnostic files), 340 reachable documentation exports, and consumer builds.

Full runs: [A1](./intrinsic-snapshot-full-a1.json),
[B1](./intrinsic-snapshot-full-b1.json),
[B2](./intrinsic-snapshot-full-b2.json),
[A2](./intrinsic-snapshot-full-a2.json).
The isolated runs and all source, compiled-JS, harness and artifact hashes are
indexed in the [environment record](./intrinsic-snapshot-environment.json).

The work probes expose a larger target: effectful-row update constructs 700
provisional elements for 100 changed rows; one-row removal constructs 6,986
provisional elements for 998 surviving rows. The default static-row optimization
does not cover these Effect-bearing rows. Further work should profile this path
and separate required Effect evaluation from avoidable DOM preparation, preserving
scoped acquisitions and all failed/interrupted preparation semantics. The prior
Adapton research motivates reuse of valid subcomputations; it is not permission
to skip arbitrary user Effects or evidence that a particular reuse strategy is safe.

## Correcting browser logging scope

The [first Effect-property removal profile](./effectful-removal.cpuprofile)
showed 580.09 ms of self time in Effect rc.112's `defaultLogger`, within a 907.33 ms
sampled interval that also contains validation and following frames. Its
[report](./effectful-removal-profile.json) uses identifier-preserving profiling,
so its latency is not a comparison with ordinary minified runs.

The fixture's `MinimumLogLevel=None` wrapped `Effect.succeed(App({}))`, affecting
that Effect rather than the component tree subsequently rendered. A new harness
guard rejected the old fixture after **11,976 console messages** during one
removal. The count matches three nested reconciliation events for each of four
children in 998 changed surviving rows. The temporary hypothesis that cleanup's
empty `Effect.provide` erased caller settings was disproved by installed source
(`provideContext` merges contexts) and direct service/logger probes. Core source
was not changed to address that disproved hypothesis.

The logging policy now belongs to the App provider Layer. Every timed/warmup
operation must emit zero console messages; the report records the counts.
The [fixture/harness difference](./browser-logging-fixture.diff) preserves row
work, assertions and native-construction probes. Future comparisons use this
configuration. Previous runs remain historical evidence of their actual logging
policy, including console costs; improvements from changing measurement policy
must not be reported as framework speedups.

Four sequential fresh Chromium 141.0.7390.122 processes ran all nine operations,
each with ten warmups and twenty-one samples. Two use the default static-row
fixture; two acquire `data-id` with `Effect.succeed` per row. Both fixtures share
identical core source and compiled JS, with the complete intrinsic ownership fix.

| Operation | Static 1 | Effect 1 | Effect 2 | Static 2 |
| --- | ---: | ---: | ---: | ---: |
| create1k | 29.60 | 44.30 | 44.30 | 30.60 |
| replace1k | 41.70 | 64.80 | 65.30 | 43.00 |
| update | 3.40 | 8.00 | 7.80 | 3.90 |
| select | 0.30 | 0.30 | 0.30 | 0.30 |
| swap | 0.90 | 1.10 | 1.00 | 0.90 |
| remove | 24.20 | 70.60 | 70.90 | 25.70 |
| append1k | 29.90 | 45.90 | 43.90 | 31.10 |
| clear | 11.70 | 21.20 | 21.40 | 11.40 |
| create10k | 292.80 | 431.40 | 421.50 | 297.10 |

All values are handler medians in milliseconds. All 36 operation/run pairs passed
the row, identity and zero-console checks; native construction counts were recorded. These compare workloads,
not framework variants. The Effect-property path still constructs the provisional
subtrees previously counted, so that remains a real optimization target.

A [second profile with the corrected policy](./effectful-removal-silent.cpuprofile)
contains no `defaultLogger` samples among its recorded hot paths; Effect runtime
execution, Effect construction and GC now appear prominently. Its full sampled
interval is 194.60 ms and includes non-handler work. The
[profile report](./effectful-removal-silent-profile.json) is diagnostic evidence,
not a precise allocation breakdown or a speedup estimate.

Raw baselines: [Static 1](./browser-logging-fixed-static1.json),
[Effect 1](./browser-logging-fixed-effect1.json),
[Effect 2](./browser-logging-fixed-effect2.json),
[Static 2](./browser-logging-fixed-static2.json).
The [environment record](./browser-logging-environment.json) retains source,
compiled-JS, fixture, harness and artifact hashes. Benchmark typecheck passes;
core source and compiled JS match the existing complete 1,841-test validation.

The next observability audit should distinguish canonical operation facts from
nested step narration, as required by RFC 17.1/17.3. Primary research supports
measuring this cost explicitly: [Dapper](https://research.google/pubs/dapper-a-large-scale-distributed-systems-tracing-infrastructure/)
prioritizes inexpensive instrumentation, limited instrumentation sites and
sampling in its distributed tracing design. [Pivot Tracing](https://cs.brown.edu/people/jcmace/papers/mace15pivot.pdf)
combines dynamic instrumentation and causal correlation, evaluating query state
along request execution. Our inference is to investigate aggregate operation
facts with preserved causal context. Neither paper proves a browser speedup or
justifies dropping failure/interruption facts from Trygg's ownership boundaries.

## Bounded reconciliation operation events

The RFC operation-event correction addresses the default logging volume exposed
by the preceding profile. Intrinsic child reconciliation now contributes one cost
outcome. It no longer emits separate successful semantic swap phases. Failures
retain their previous record and protocol behavior. The keyed list owner publishes
one semantic `keyedList.reorder` record with inserted, removed, reconciled and
replaced counts, plus its existing total/move/stability fields.

Twelve new behavioral tests pass, including exactly one Info-level record for
list removal at different sizes with keyed/unkeyed children, insertion and
replacement counts, DOM identity, operation trace ordering, and typed/defect/
interrupted reconciliation outcomes. In real Chromium, an Info-level probe with
1,000 Effect-property rows emits [exactly one publication message](./reconcile-events-info-volume.json)
for removal. The single-sample probe verifies event volume, not latency. Its
explicit logging policy and guard differences are recorded in the environment
metadata. The earlier implementation emitted 11,976 messages for this scenario.

A separate performance comparison uses the corrected silent Effect-property
fixture for both variants. Four sequential fresh Chromium 141.0.7390.122 processes
run A1–B1–B2–A2 with ten warmups and twenty-one samples each. A retains nested
semantic steps; B introduces child cost facts and aggregate list publication.
All nine operations pass row/identity checks and zero-console guards.

| Operation | A1 | B1 | B2 | A2 | A mean of medians | B mean of medians |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| create1k | 44.60 | 44.80 | 44.50 | 45.00 | 44.80 | 44.65 |
| replace1k | 67.00 | 66.10 | 65.10 | 66.90 | 66.95 | 65.60 |
| update | 7.90 | 7.90 | 8.20 | 8.10 | 8.00 | 8.05 |
| select | 0.30 | 0.30 | 0.30 | 0.30 | 0.30 | 0.30 |
| swap | 1.10 | 1.20 | 1.10 | 1.00 | 1.05 | 1.15 |
| remove | 73.10 | 70.20 | 69.90 | 75.00 | 74.05 | 70.05 |
| append1k | 46.70 | 46.90 | 46.50 | 46.30 | 46.50 | 46.70 |
| clear | 20.20 | 21.50 | 21.50 | 20.00 | 20.10 | 21.50 |
| create10k | 432.60 | 435.00 | 428.00 | 431.60 | 432.10 | 431.50 |

Values are handler milliseconds. Removal is about 5.4% lower in this local
comparison. Native construction remains unchanged: updating 100 Effect-property
rows constructs 700 elements, and removal constructs 6,986 provisional elements
for 998 surviving rows. Reducing that preparation is still open work.

The unfavorable full-fixture clear result is retained. A follow-up isolated clear
comparison with the same sampling gives A1 21.10, B1 21.30, B2 20.90 and A2 20.10 ms:
20.60 → 21.10 ms in mean run medians. The smaller difference and 1 ms control spread
do not establish a stable 1.40 ms penalty; they also do not prove universal absence
of regression. The 0.10 ms swap difference is likewise not a reliable percentage
claim on this host. Keep the RFC observability correction and monitor cleanup and
workload-history effects in further comparisons.

Full runs: [A1](./reconcile-events-control-a1.json),
[B1](./reconcile-events-control-b1.json), [B2](./reconcile-events-control-b2.json),
[A2](./reconcile-events-control-a2.json).
Isolated clear: [A1](./reconcile-events-clear-a1.json),
[B1](./reconcile-events-clear-b1.json), [B2](./reconcile-events-clear-b2.json),
[A2](./reconcile-events-clear-a2.json).
The [source difference](./reconcile-events-control.diff) and
[environment, source, compiled-JS, harness and raw hashes](./reconcile-events-environment.json)
identify the variants and the later strengthening of the integration assertion.

Full tests pass: 1,853 (1,662 core, 87 CLI, 104 website). Full check passes with
195 core/30 CLI Effect diagnostic files; 340 reachable exports pass the docs
contract, and examples/site production builds pass. The exact-one-event integration
assertion was strengthened and rerun after measurement without changing production
source or compiled JS. This is a scoped operation-event correction, not completion
of the RFC observability audit or a claim of maximum framework performance.

## Reusing prepared Effect-property values

The preceding implementation evaluated a compatible row's Effect properties in
both detached preparation and live reconciliation. Rollback repeated old Effects,
and shallow-equal original props could discard newly acquired values instead.
Ten real renderer tests fail on that implementation and pass when preparations
carry per-property values through intrinsic nodes, fragments, context providers,
and insertion of new keyed child slots. The tests also cover native failure and
rollback/retry, cancellation of the update owner, finalization, shared Effect
objects, returned Signals, undefined, and an Effect returned as a value.

The reuse boundary is one acquired property in one prepared render. A future
render still executes that property, and using the same Effect in two properties
still performs two acquisitions. Acquired resources retain their original Scope
ownership. This corrects duplicated execution without introducing a cache keyed
by Effect object identity.

Research cross-check: the abstract of Acar, Blume, and Donham's
[A Consistent Semantics of Self-Adjusting Computation](https://arxiv.org/abs/1106.0478)
describes reuse combined with change propagation that adjusts for mutated memory.
The authors prove consistency for their formal semantics. The engineering
inference here is to make the validity of reused work explicit; the paper does
not establish correctness for arbitrary Trygg property Effects or browser DOM
mutation. Only its abstract and bibliographic information were reviewed in this
step. Trygg's evidence is the behavioral suite, not a transfer of that theorem.

The complete suite passes **1,863 tests** (1,672 core, 87 CLI, 104 website).
`bun run check`, the 340-export documentation contract, and examples/website
production builds pass. The new preparation snapshot still requires provisional
DOM; component execution and partial keyed-child rollback remain audit work.

The first candidate (B) is compared with the preceding bounded-event version (A)
in four fresh Chromium processes, A–B–B–A, with 10 warmups and 21 samples for each
of the nine operations. Both use the same corrected silent Effect-property
fixture. Tests and builds are stopped during measurements. All 36 operation/run
pairs produce zero measured/warmup console messages and pass DOM checks.

| Operation | A1 | B1 | B2 | A2 | Mean A medians | Mean B medians |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| create1k | 46.00 | 45.80 | 45.30 | 46.00 | 46.00 | 45.55 |
| replace1k | 66.40 | 66.70 | 67.20 | 65.50 | 65.95 | 66.95 |
| update | 7.60 | 8.30 | 8.10 | 7.90 | 7.75 | 8.20 |
| select | 0.30 | 0.30 | 0.30 | 0.30 | 0.30 | 0.30 |
| swap | 1.00 | 1.00 | 1.00 | 1.00 | 1.00 | 1.00 |
| remove | 70.90 | 72.70 | 73.30 | 70.20 | 70.55 | 73.00 |
| append1k | 48.60 | 48.30 | 47.50 | 47.60 | 48.10 | 47.90 |
| clear | 20.20 | 21.50 | 21.60 | 21.20 | 20.70 | 21.55 |
| create10k | 435.80 | 434.80 | 433.90 | 441.20 | 438.50 | 434.35 |

All values are handler milliseconds. Update increases 7.75 → 8.20 ms and removal
70.55 → 73.00 ms. Clear is 20.70 → 21.55 ms; control clear medians themselves differ
by 1 ms. These measurements do not establish absence of performance regressions.
The candidate is a correctness repair, not a demonstrated speed optimization.
Its acquired-value and snapshot allocations warrant further measurement.

Native construction remains unchanged: updating 100 rows creates 700 elements,
and removing one row prepares 998 row subtrees (6,986 elements, 2,994 text nodes,
1,996 comments). The native-work probe runs separately after timing and is not a
heap-allocation measurement.

Raw runs: [A1](./prepared-properties-a1.json), [B1](./prepared-properties-b1.json),
[B2](./prepared-properties-b2.json), [A2](./prepared-properties-a2.json).
[Source and environment hashes](./prepared-properties-environment.json),
[production diff](./prepared-properties-control.diff).

A follow-up candidate (C) keeps the already acquired readonly values Map during
binding. It allocates a new private Map only when an Effect still needs execution,
copying prior entries if a partially prepared set is supplied. This avoids one
Map allocation and value insertion per effectful node during commit/rollback.
The ten regression tests and the isolated core build pass.

An isolated B–C–C–B screen (10 warmups, 21 samples) gives update medians
8.10 / 8.00 / 7.90 / 8.10 ms, or 8.10 → 7.95 ms. Removal medians are
73.10 / 70.60 / 74.50 / 74.30 ms, or 73.70 → 72.55 ms; the 3.90 ms spread between
candidate medians prevents claiming a stable removal gain. These case-only runs
have different workload history from the nine-operation sequence above.
[Follow-up diff](./prepared-properties-reuse.diff),
[isolated run hashes and metadata](./prepared-properties-reuse-environment.json).

The final candidate retains the Map reuse and again passes the complete
**1,863-test** suite, `bun run check`, the 340-export docs gate, and both consumer
builds. A fresh full A–C–C–A comparison against the preceding implementation uses
the same 10 warmups, 21 samples, nine cases, and silent fixture:

| Operation | A1 | C1 | C2 | A2 | Mean A medians | Mean C medians |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| create1k | 44.80 | 45.80 | 43.00 | 45.70 | 45.25 | 44.40 |
| replace1k | 66.10 | 64.90 | 66.60 | 67.00 | 66.55 | 65.75 |
| update | 7.90 | 7.70 | 8.10 | 7.90 | 7.90 | 7.90 |
| select | 0.30 | 0.30 | 0.30 | 0.30 | 0.30 | 0.30 |
| swap | 1.20 | 1.10 | 1.00 | 1.40 | 1.30 | 1.05 |
| remove | 70.40 | 73.10 | 73.70 | 69.10 | 69.75 | 73.40 |
| append1k | 45.10 | 48.30 | 47.00 | 47.90 | 46.50 | 47.65 |
| clear | 21.80 | 21.70 | 21.90 | 21.30 | 21.55 | 21.80 |
| create10k | 430.20 | 440.00 | 432.30 | 443.80 | 437.00 | 436.15 |

Handler times are in milliseconds. The final update means are both 7.90 ms.
Removal is 69.75 → 73.40 ms (**5.2% higher**); this remains an unresolved local
performance regression relative to the preceding implementation. Append increases
46.50 → 47.65 ms, with control medians spanning 2.8 ms. Creation and clear are
close on these samples; the sub-millisecond swap difference is not evidence of a
stable percentage gain. The final correction is not yet evidence that the user's
no-regression performance objective has been met.

All 36 operation/run pairs again pass DOM checks with zero measured/warmup
console messages. Native construction counts are identical in all four runs.
Retaining prepared values fixes the demonstrated execution/ownership behavior;
removing provisional DOM and measuring snapshot/rollback bookkeeping remain
necessary follow-ups. The static-row timing impact of the shared keyed rollback
bookkeeping has not been measured in this step.

Final raw runs: [A1](./prepared-properties-final-a1.json),
[C1](./prepared-properties-final-c1.json), [C2](./prepared-properties-final-c2.json),
[A2](./prepared-properties-final-a2.json).
[Final source/environment hashes and validation](./prepared-properties-final-environment.json),
[final production diff](./prepared-properties-final.diff).

## Intrinsic preparation without provisional DOM

The preceding prepared-value implementation still constructs 998 detached row
subtrees for a one-row removal. A compatible intrinsic can now plan property
acquisition separately and lend its committed DOM until reconciliation. The plan
runs each parent property before child properties under the staging Scope. The
newly acquired values are distinct from the old snapshot captured for rollback.
If the whole compatible plan is unavailable, the renderer builds a replacement.

Planning must not execute a child getter early. Static child subtrees with
accessors or opaque host values decline this optimization. Host conversions found
during Effect execution switch to DOM rendering with partial acquired values,
before later Effects run. The same rule propagates from a child to its parent.
The candidate's early getter/conversion-order regressions were reproduced and
fixed before performance measurements. Twelve new tests include six that fail
on the preceding implementation's native construction counts; the other six
protect ordering and structural fallback behavior.

Research cross-check: Google's
[Incremental DOM overview](https://github.com/google/incremental-dom#overview)
describes updating an existing DOM while avoiding an intermediate tree and
identifies allocation/GC pressure as a motivation. This is an engineering
analogy for reducing provisional construction, not evidence that Trygg inherits
its performance or semantics. Only the project overview was reviewed here; no
implementation was ported. The earlier Adapton and self-adjusting-computation
research remains relevant to the requirement that reuse preserve observable work.

Both the corrected silent Effect-property fixture and the corrected silent
static fixture are measured against the preceding implementation in fresh
A–B–B–A browser processes, 10 warmups and 21 samples per operation. Native-work
probes run separately after timings. Complete tests and consumer builds finish
before the benchmark sequence begins.

Effect-property fixture, handler milliseconds:

| Operation | A1 | B1 | B2 | A2 | Mean A medians | Mean B medians |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| create1k | 45.60 | 44.90 | 44.70 | 45.10 | 45.35 | 44.80 |
| replace1k | 66.00 | 66.00 | 65.40 | 68.10 | 67.05 | 65.70 |
| update | 8.30 | 5.60 | 5.70 | 7.70 | 8.00 | 5.65 |
| select | 0.20 | 0.30 | 0.30 | 0.30 | 0.25 | 0.30 |
| swap | 1.20 | 1.00 | 0.90 | 1.10 | 1.15 | 0.95 |
| remove | 73.80 | 42.10 | 43.50 | 71.80 | 72.80 | 42.80 |
| append1k | 47.70 | 46.60 | 47.20 | 47.00 | 47.35 | 46.90 |
| clear | 20.00 | 21.60 | 20.10 | 20.80 | 20.40 | 20.85 |
| create10k | 431.50 | 429.80 | 436.60 | 428.40 | 429.95 | 433.20 |

Static fixture, handler milliseconds:

| Operation | A1 | B1 | B2 | A2 | Mean A medians | Mean B medians |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| create1k | 31.00 | 29.90 | 30.20 | 29.10 | 30.05 | 30.05 |
| replace1k | 43.70 | 43.10 | 42.50 | 41.60 | 42.65 | 42.80 |
| update | 3.50 | 3.60 | 3.60 | 3.70 | 3.60 | 3.60 |
| select | 0.30 | 0.30 | 0.30 | 0.30 | 0.30 | 0.30 |
| swap | 1.10 | 0.90 | 1.00 | 0.90 | 1.00 | 0.95 |
| remove | 24.10 | 24.00 | 24.80 | 24.30 | 24.20 | 24.40 |
| append1k | 30.50 | 30.00 | 30.00 | 30.10 | 30.30 | 30.00 |
| clear | 11.40 | 11.30 | 11.80 | 11.60 | 11.50 | 11.55 |
| create10k | 297.90 | 293.90 | 292.50 | 288.00 | 292.95 | 293.20 |

The Effect-property fixture improves update from 8.00 → 5.65 ms (**29.4% lower**)
and removal from 72.80 → 42.80 ms (**41.2% lower**) in this local comparison.
Native construction for update, removal, and swap becomes zero elements, text
nodes, and comments; creation and replacement counts remain unchanged. An empty
staging DocumentFragment and ordinary JavaScript bookkeeping still exist: these
counts are not total heap allocations or proof that all allocation disappeared.

The static fixture remains close to control: update is 3.60 ms in both variants,
removal 24.20 → 24.40 ms, and create-10k 292.95 → 293.20 ms. Effectful create-10k
is 429.95 → 433.20 ms and clear 20.40 → 20.85 ms; candidate medians span 6.8 ms
and 1.5 ms respectively. Small differences and sub-millisecond select/swap
percentages do not establish stable gains or regressions. The tests, work counts,
and samples support this compatible-intrinsic optimization; they do not prove
optimal performance or absence of regressions in unmeasured workloads.

All **72 operation/run pairs** pass DOM checks and produce zero measured/warmup
console messages. The final source passes **1,875 tests** (1,684 core, 87 CLI,
104 website), `bun run check`, the 340-export docs contract, and examples/website
production builds. One initial full run timed out in the checker test at its
5-second limit while consumer builds were active; the focused checker suite and
complete suite passed without concurrent builds. No timeout setting was changed.

Effect raw runs: [A1](./effectful-dom-effect-a1.json), [B1](./effectful-dom-effect-b1.json),
[B2](./effectful-dom-effect-b2.json), [A2](./effectful-dom-effect-a2.json).
Static raw runs: [A1](./effectful-dom-static-a1.json), [B1](./effectful-dom-static-b1.json),
[B2](./effectful-dom-static-b2.json), [A2](./effectful-dom-static-a2.json).
[Source/environment hashes and validation](./effectful-dom-environment.json),
[production diff](./effectful-dom-control.diff).

## Granular keyed-row preparation

The preceding intrinsic-preparation benchmark updated source-list items. This
checkpoint adds a different workload: update one internal Signal in every tenth
row of a 1,000-row list, leaving the source items unchanged. Each operation awaits
the actual row worker through a Deferred/Fiber barrier before recording handler
completion. The same synchronization and row-Signal ownership run in both
variants; these numbers are not directly comparable with the earlier immutable
source-item update timings.

Control A is the preceding 1,875-test checkpoint. Candidate B adds shared row
preparation, rollback on failed/interrupted granular work, and serialization with
source-list publication. See the [production diff](./keyed-row-control.diff),
[source fixture diff](./keyed-row-source-fixture.diff), and
[granular fixture diff](./keyed-row-granular-fixture.diff). Both current fixtures
construct the Effect-valued row through the JSX runtime; the isolated fixture
and browser harness pass TypeScript checking.

Fresh Chromium processes run A–B–B–A with 10 warmups and 21 samples per operation,
using the same minified build settings and silent logger configuration. No tests
or consumer builds run during timing. A separate native-construction probe runs
after the timing samples; it is not a heap-allocation measurement.

| Granular update metric | A1 | B1 | B2 | A2 | Mean A medians | Mean B medians |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| Handler ms | 23.10 | 26.60 | 24.50 | 19.00 | 21.05 | 25.55 |
| Frame ms | 31.30 | 34.70 | 34.80 | 28.90 | 30.10 | 34.75 |

The granular fixture exposes an observed handler regression of **21.4%** and
frame increase of **15.4%** in these local process medians. Both candidates are
slower than both controls, although A1/A2 themselves differ by 4.10 ms. This needs
profiling and optimization; green functional gates do not satisfy the requested
performance constraint. It is not evidence to drop rollback, scoped finalization,
or source/row publication ordering. Both variants construct zero element, text,
and comment nodes during the update; remaining costs are outside those native
construction counts. Retained heap and arbitrary reactive/host-conversion
interactions have not been proved by this fixture.

Raw granular results:
[A1](./keyed-row-granular-a1.json), [B1](./keyed-row-granular-b1.json),
[B2](./keyed-row-granular-b2.json), [A2](./keyed-row-granular-a2.json).
[Environment, source, fixture, built-JavaScript and result hashes](./keyed-row-environment.json)
identify the measured snapshots. Current complete validation passes 1,885 tests,
checks including Effect diagnostics, the 340-export documentation contract, and
both consumer production builds. The initial check found a missing definitive
`return yield*` in one new never-ending test branch; it passed after that test
correction.

The accompanying source-list A–B–B–A comparison covers all nine operations with
the same Effect-valued row property in both variants:

| Source-list operation (handler ms) | A1 | B1 | B2 | A2 | Mean A medians | Mean B medians |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| create1k | 44.80 | 45.10 | 46.20 | 45.60 | 45.20 | 45.65 |
| replace1k | 67.90 | 67.80 | 68.00 | 68.00 | 67.95 | 67.90 |
| update | 5.40 | 5.90 | 5.50 | 5.90 | 5.65 | 5.70 |
| select | 0.30 | 0.30 | 0.30 | 0.30 | 0.30 | 0.30 |
| swap | 1.00 | 1.00 | 1.10 | 1.00 | 1.00 | 1.05 |
| remove | 42.10 | 42.30 | 42.70 | 41.20 | 41.65 | 42.50 |
| append1k | 46.70 | 47.50 | 48.70 | 46.80 | 46.75 | 48.10 |
| clear | 21.60 | 21.30 | 20.10 | 21.40 | 21.50 | 20.70 |
| create10k | 449.00 | 442.00 | 438.70 | 437.00 | 443.00 | 440.35 |

Source-list update remains 5.65 → 5.70 ms; removal is 41.65 → 42.50 ms (+2.0%).
Append is 46.75 → 48.10 ms (+2.9%), while other differences vary in direction.
These small changes need more evidence before attribution; this run does not
prove static workloads unchanged. The material unresolved regression is the
granular workload above. Across both fixtures all 40 operation/run pairs pass
DOM validation with zero measured/warmup console messages. Source update,
removal, and swap still construct zero element/text/comment nodes.

Raw source-list results:
[A1](./keyed-row-source-a1.json), [B1](./keyed-row-source-b1.json),
[B2](./keyed-row-source-b2.json), [A2](./keyed-row-source-a2.json).

## Composing the granular preparation Scope

The granular correctness checkpoint introduced a second installation of the
same staging Scope: `renderItem` installed it for preparation, then the row
worker installed it again for live reconciliation. Its successful preparation
also traversed a failure-finalization wrapper despite the row worker already
owning staged rollback and release. `prepareItem` now exposes the shared private
preparation Effect without owning the caller's Scope. Source-list updates keep
their existing failure owner; granular rows install one Scope around preparation
and reconciliation and retain their `onExit` rollback/cleanup owner. See the
[change from the 1,885-test checkpoint](./keyed-row-scope-composition.diff).

Two additional deterministic cases suspend source preparation, change a row
Signal, then fail or interrupt the actual source worker. They verify that queued
row work resumes against the committed source input, with the latest dependency,
and that the source worker retains its typed failure or interruption. Together
with the existing cases, the four relevant suites pass 38 tests; complete gates
pass 1,887 tests, checks/types/Effect diagnostics, the 340-export documentation
contract, and both consumer production builds.

### Diagnostic evidence and limitations

The first 100-microsecond CPU profiles include validation and frame callbacks.
Most sampled duration lands in `(program)`, and the candidate records a 3.33 ms
collection. These short profiles do not isolate a cause of the earlier slowdown:
[control profile](./keyed-row-scope-control.cpuprofile),
[prepared/serialized candidate profile](./keyed-row-scope-candidate.cpuprofile).

An initial uninstrumented A–C–C–A comparison produces handler medians
24.00/24.10/26.30/33.80 ms. The 9.80 ms control spread makes a gain calculated from
its means unsuitable for claiming that the regression is resolved:
[A1](./keyed-row-scope-exploratory-a1.json),
[C1](./keyed-row-scope-exploratory-c1.json),
[C2](./keyed-row-scope-exploratory-c2.json),
[A2](./keyed-row-scope-exploratory-a2.json).

A separate diagnostic adds CDP `Performance.getMetrics` before/after each measured
operation. `TaskDuration` includes main-thread work over that interval, including
DOM validation, frame work, and possible GC; it is not a CPU attribution to just
the handler. Twenty warmups and 31 samples produce the following process medians:

| Diagnostic run | Handler ms | Frame ms | TaskDuration delta ms |
| --- | ---: | ---: | ---: |
| A1: original granular renderer | 24.50 | 32.40 | 39.567 |
| B1: prepared/serialized | 24.90 | 33.70 | 40.645 |
| C1: composed Scope | 24.20 | 27.40 | 28.848 |
| C2: composed Scope | 19.80 | 27.60 | 28.772 |
| B2: prepared/serialized | 35.10 | 38.20 | 45.218 |
| A2: original granular renderer | 23.90 | 30.20 | 28.640 |

The differences favor C in this diagnostic but the control TaskDuration also
varies substantially. Do not pool these data with uninstrumented timing:
[A1](./keyed-row-scope-task-a1.json), [B1](./keyed-row-scope-task-b1.json),
[C1](./keyed-row-scope-task-c1.json), [C2](./keyed-row-scope-task-c2.json),
[B2](./keyed-row-scope-task-b2.json), [A2](./keyed-row-scope-task-a2.json).

A third probe wraps the pinned Effect `Scheduler` while forwarding its execution
mode, `shouldYield`, and dispatcher to `MixedScheduler`. It counts consultations
and accepted yields during the update. All variants make one accepted yield;
consultations are A 32,221, B 35,721, C 34,721. Composition removes 1,000
consultations per 100 row updates (2.8% of B), while C still performs more than A.
These are scheduler consultations, not every Effect opcode, allocations, or a
latency guarantee. Instrumented times are excluded from performance comparisons:
[A](./keyed-row-scope-scheduler-a.json), [B](./keyed-row-scope-scheduler-b.json),
[C](./keyed-row-scope-scheduler-c.json).

The V8 team's [memory-optimization article](https://v8.dev/blog/optimizing-v8-memory)
argues for reproducible application workloads and separately tracking heap and
off-heap memory when weighing throughput, latency, and memory tradeoffs. This
supports the diagnostic method; it does not prove that this Scope change reduces
retained heap or guarantees a speedup. Its 2016 engine results are historical,
and no engine heuristic or published speedup is transferred to trygg.

### Final uninstrumented comparison

After all checks, tests, and consumer builds finished, fresh processes ran
control–candidate–candidate–control with 20 warmups and 31 samples. The granular
control is A (before the granular correctness changes); the source-list control
is B (the 1,885-test prepared/serialized checkpoint). Candidate C is the same
built renderer in both workloads. Keep those two baselines distinct.

| Granular operation (handler ms) | Control 1 | Candidate 1 | Candidate 2 | Control 2 | Mean control medians | Mean candidate medians |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| update | 23.70 | 26.70 | 24.70 | 23.10 | 23.40 | 25.70 |

Granular handler time remains 23.40 → 25.70 ms (**+9.8%**). The corresponding
frame medians average 31.40 → 31.70 ms. This run still contradicts a claim that
the granular handler regression is resolved. Its smaller relative gap than the
previous checkpoint's 21.4% is not a controlled estimate of the Scope change's
speedup: the control itself changed between measurements. The supported code
improvement is the removed duplicate Scope boundary and lower scheduler work;
latency optimization remains open.

| Source-list operation (handler ms) | Control 1 | Candidate 1 | Candidate 2 | Control 2 | Mean control medians | Mean candidate medians |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| create1k | 45.70 | 44.30 | 45.20 | 44.80 | 45.25 | 44.75 |
| replace1k | 67.00 | 68.60 | 64.80 | 66.70 | 66.85 | 66.70 |
| update | 5.90 | 5.60 | 5.30 | 5.80 | 5.85 | 5.45 |
| select | 0.30 | 0.30 | 0.30 | 0.30 | 0.30 | 0.30 |
| swap | 0.90 | 1.00 | 0.90 | 1.00 | 0.95 | 0.95 |
| remove | 44.60 | 40.80 | 41.70 | 41.70 | 43.15 | 41.25 |
| append1k | 47.20 | 47.30 | 47.90 | 46.90 | 47.05 | 47.60 |
| clear | 21.50 | 21.00 | 22.00 | 21.90 | 21.70 | 21.50 |
| create10k | 452.20 | 436.00 | 438.60 | 434.50 | 443.35 | 437.30 |

All 40 operation/run pairs pass DOM validation with zero measured/warmup console
messages. Update/removal/swap still construct zero element, text, and comment
nodes. These counts omit JavaScript objects and empty DocumentFragments. No new
static fixture or retained-memory result is claimed by this checkpoint.

Raw granular runs:
[control 1](./keyed-row-scope-granular-control1.json),
[candidate 1](./keyed-row-scope-granular-candidate1.json),
[candidate 2](./keyed-row-scope-granular-candidate2.json),
[control 2](./keyed-row-scope-granular-control2.json).
Raw source-list runs:
[control 1](./keyed-row-scope-source-control1.json),
[candidate 1](./keyed-row-scope-source-candidate1.json),
[candidate 2](./keyed-row-scope-source-candidate2.json),
[control 2](./keyed-row-scope-source-control2.json).
The [environment and hashes](./keyed-row-scope-environment.json) identify the
source, fixture, built JavaScript, gates, and raw artifacts. The separate
[diagnostic metadata](./keyed-row-scope-diagnostics.json),
[TaskDuration harness diff](./keyed-row-scope-task-harness.diff), and
[scheduler fixture diff](./keyed-row-scope-scheduler-fixture.diff) preserve the
instrumented experiments without mixing them into the final latency result.

## Reusing stable keyed-row dependency collections

`diffSubscriptions` rebuilt a Map of unsubscribe Effects and a Set of Signal IDs
on every call, including empty and unchanged graphs. The new fast path compares
size and ordered Signal IDs at Effect execution time. If both match, it retains
the existing subscription Map. Different membership or order keeps the existing
diff behavior, including the latest render's release order. No row render,
property Effect, Scope, or subscription cleanup is skipped by this change.
See the [production diff](./keyed-dependency-control.diff).

Two added behavioral tests cover repeated dependency use, replacement by another
Signal with the same graph size, transitions through an empty graph, restoration,
row removal, and reversing read order without changing membership. They verify
DOM identity/text, absence of obsolete listeners, and trace-visible release
order. Both tests pass against the 1,887-test control as well as the candidate:
these protect existing behavior during optimization. The complete candidate
passes 1,889 tests, checks/types, zero Effect diagnostics across 199 core and 30
CLI files, the 340-export documentation contract, and examples/site builds.

Latency is measured without replacing collection constructors. A separate group
of processes runs a work probe only after all timing processes finish. It wraps
global Map and Set constructors with forwarding Proxies and restores both in
`finally`, alongside the existing native DOM construction counters. These counts
cover constructor calls in the measured application operation, not total
allocations, iterator objects, bytes, or retained heap. Probe timings are excluded
from latency comparisons. See the [probe diff](./keyed-dependency-collection-probe.diff).

Three granular variants run A–C–D–D–C–A with 20 warmups and 31 samples: A is the
original 1,875-test granular renderer; C is the 1,887-test Scope-composed renderer;
D adds stable dependency reuse. Source-list timings compare C–D–D–C over all nine
operations. Both new fixtures and the probe pass their isolated TypeScript gate.
All tests and builds finish before the browser comparisons start.

### Final timing and collection counts

| Granular run | Handler median ms | Frame median ms |
| --- | ---: | ---: |
| A1 | 23.50 | 31.70 |
| C1 | 34.30 | 37.10 |
| D1 | 24.30 | 32.40 |
| D2 | 24.60 | 30.60 |
| C2 | 26.40 | 30.70 |
| A2 | 18.70 | 28.40 |

Means of granular handler process medians are A 21.10 ms, C 30.35 ms, and
D 24.45 ms. D is 19.4% below C in this comparison, but C itself spans 7.90 ms and
A spans 4.80 ms. These observations do not isolate a dependable speedup from this
small change. D remains **15.9% above A**, so the original granular regression is
still unresolved. Do not interpret the earlier checkpoint's 9.8% and this
checkpoint's 15.9% as a controlled measurement of deterioration: their A controls
also differ. Collection counts provide the direct evidence of work removed.

| Source-list operation (handler ms) | C1 | D1 | D2 | C2 | Mean C medians | Mean D medians |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| create1k | 44.20 | 44.30 | 44.20 | 46.00 | 45.10 | 44.25 |
| replace1k | 66.70 | 65.90 | 66.90 | 68.20 | 67.45 | 66.40 |
| update | 5.30 | 5.40 | 5.50 | 5.70 | 5.50 | 5.45 |
| select | 0.30 | 0.30 | 0.30 | 0.20 | 0.25 | 0.30 |
| swap | 0.90 | 1.00 | 1.00 | 1.00 | 0.95 | 1.00 |
| remove | 41.50 | 40.50 | 41.30 | 41.30 | 41.40 | 40.90 |
| append1k | 46.70 | 45.90 | 46.10 | 47.70 | 47.20 | 46.00 |
| clear | 20.30 | 21.60 | 21.90 | 22.10 | 21.20 | 21.75 |
| create10k | 431.80 | 438.20 | 437.00 | 448.60 | 440.20 | 437.60 |

Source update is 5.50 → 5.45 ms and removal is 41.40 → 40.90 ms. Small changes
elsewhere have mixed direction and meaningful control variation; no universal
no-regression or optimal-performance claim is supported by this run. All 42
timing operation/run pairs validate the DOM without measured/warmup console
messages.

The following constructor counts come from eight separate probe processes, with
zero warmups and one sample before the work probe. Their timing values are not
used above. Each pair has the same row count and native DOM construction counts:

| Probe | C Maps | D Maps | C Sets | D Sets |
| --- | ---: | ---: | ---: | ---: |
| granular update | 1,603 | 1,503 | 700 | 600 |
| source update | 1,407 | 1,307 | 704 | 604 |
| source create1k | 16,012 | 16,012 | 7,004 | 7,004 |
| source remove | 13,983 | 12,985 | 5,992 | 4,994 |

The change removes exactly 100 Map and 100 Set constructor calls for 100 updated
rows, and 998 of each for removal's 998 index-changed surviving rows. Initial
creation does not call this diff path and is unchanged. Update and removal
construct zero element/text/comment nodes in these probes; create1k keeps
7,000/3,000/2,000 respectively. This is not a retained-memory measurement and
excludes iterators and other JavaScript allocations. Graph churn and static
fixtures have behavioral or historical evidence, not fresh latency coverage here.

Raw granular timings:
[A1](./keyed-dependency-granular-a1.json), [C1](./keyed-dependency-granular-c1.json),
[D1](./keyed-dependency-granular-d1.json), [D2](./keyed-dependency-granular-d2.json),
[C2](./keyed-dependency-granular-c2.json), [A2](./keyed-dependency-granular-a2.json).
Raw source timings:
[C1](./keyed-dependency-source-c1.json), [D1](./keyed-dependency-source-d1.json),
[D2](./keyed-dependency-source-d2.json), [C2](./keyed-dependency-source-c2.json).
Collection probes:
[granular C](./keyed-dependency-collections-granular-update-c.json),
[granular D](./keyed-dependency-collections-granular-update-d.json),
[source update C](./keyed-dependency-collections-source-update-c.json),
[source update D](./keyed-dependency-collections-source-update-d.json),
[create C](./keyed-dependency-collections-source-create1k-c.json),
[create D](./keyed-dependency-collections-source-create1k-d.json),
[remove C](./keyed-dependency-collections-source-remove-c.json),
[remove D](./keyed-dependency-collections-source-remove-d.json).
[Environment, gates, source, built-JavaScript and raw hashes](./keyed-dependency-environment.json)
identify all snapshots.

The next concrete allocation candidate is row-context preparation:
`renderer.ts:provideRenderContext` merges captured services and calls
`Context.omit(Scope.Scope)` for every row render. In the pinned rc.112 source,
`Context.omit` uses `withFlat`, which constructs a new Map from `mapUnsafe` even
when the omitted service is absent. Evaluate preparing that immutable service
snapshot once per list owner, while preserving ambient row Scope, caller
annotations, and service behavior. No cache or context change is implemented in
this checkpoint.


## Reusing keyed-row service context

The list captures its provided services once per execution and reuses that
Context for each row body. Scope and CurrentLogAnnotations are excluded from
the snapshot: each row's staging Scope owns acquisitions, and immediate source
updates supply their triggering operation's annotations. Tests preserve provider
precedence, service identity and mutable service state, retained DOM, and exact
row release counts. The two new context tests fail on the preceding checkpoint D.

The completed experiment below measures E **before** the subsequent queued-source
context correction. Its source hashes and built JavaScript are historical evidence;
these timings do not measure the current final source. The correction retains
the latest pending caller Context, clears it before draining the queue, and drops
it when the list closes. Three additional tests first reproduced stale annotations
after predecessor success, typed failure, and interruption, then passed with the
correction. Granular callback and nested component annotation propagation remain
separate audit work.

Chromium 141.0.7390.122 ran 20 warmups and 31 retained samples per operation.
Granular runs used A–D–E–E–D–A order; the nine source operations used D–E–E–D.
A is the original granular path at the 1,875-test checkpoint; D is ordered
subscription reuse at 1,889 tests. Separate collection probes ran only after all
timing processes, with no constructor replacement during timing. All 42 timing
operation/run pairs and eight probes passed the harness with zero operation
console messages. [Environment and artifact hashes](./keyed-context-environment.json)
and the [measured production difference](./keyed-context-control.diff) identify E.

Granular handler medians, milliseconds:

| A1 | D1 | E1 | E2 | D2 | A2 |
| ---: | ---: | ---: | ---: | ---: | ---: |
| 23.30 | 28.20 | 24.60 | 25.10 | 31.60 | 24.60 |

Means of process medians are A 23.95, D 29.90, E 24.85 ms. E is lower than both
D runs, but is 3.8% above A. The 0.90 ms A/E difference is below A's 1.30 ms
between-process spread, and D varies by 3.40 ms. This does not establish that the
original regression is eliminated, nor statistical equivalence or optimality.
Do not pool comparisons from earlier checkpoints.

Source handler means of process medians, milliseconds:

| Operation | D | E |
| --- | ---: | ---: |
| create1k | 44.50 | 43.20 |
| replace1k | 66.55 | 64.85 |
| update | 5.65 | 5.70 |
| select | 0.30 | 0.25 |
| swap | 1.00 | 0.95 |
| remove | 41.70 | 41.00 |
| append1k | 46.85 | 44.80 |
| clear | 20.95 | 20.75 |
| create10k | 433.20 | 423.50 |

Separate constructor counts:

| Workload | D Maps | E Maps | Sets, both |
| --- | ---: | ---: | ---: |
| Granular update, 100 rows | 1,503 | 1,303 | 600 |
| Source update, 100 rows | 1,307 | 1,107 | 604 |
| Create 1,000 rows | 16,012 | 14,012 | 7,004 |
| Remove one row, 998 changed indices | 12,985 | 10,989 | 4,994 |

The fixture provides a non-null Context, so reusing merge/omit avoids two Maps
per row render. The list-level snapshot is acquired during empty mount, before
these operations; empty-list overhead and retained heap have not been measured.
Counts exclude other objects, iterators, and byte sizes. Update/removal still
construct zero elements, text nodes, and comments; creation retains 7,000 elements,
3,000 text nodes, and 2,000 comments. The source and granular fixtures remain
synthetic workloads, not a framework ranking or a whole-application speed claim.

## Granular caller context, coalescing, and composed services

The 2026-09-05 continuation reproduces lost annotations on immediate granular
updates and lost pending work after failed/interrupted granular preparation.
The row now retains only the latest pending caller Context, resumes after the
previous preparation/retirement cleanup, and clears pending references on drain,
removal, or shutdown. Eleven added tests cover source/granular service precedence,
both kinds of suspended predecessor, typed failure, interruption, reentrant
retirement, and a burst of 1,000 notifications during a defective asynchronous
release. The burst produces one subsequent render and retains both failure Reasons.

An intermediate propagation draft G merged caller services before reapplying
annotations. A strengthened property test found that its row body used the
captured service but a prepared property could instead use the caller's shadowing
service. Final H composes caller Context with captured row services once before
forking, for both source and granular updates. Captured services win; Scope is
installed by the owner, and operation annotations come from the caller. No extra
annotation provider or second captured-context merge is needed at that fork.
The body still has its own service boundary; this is not permission to remove
per-row isolation for scoped context mutations.

### Reproducible browser fixture without an HTTP listener

`BENCHMARK_GRANULAR=1` promotes the historical diagnostic into the maintained
browser fixture: 100 row-owned Signal updates in a 1,000-row table, awaited via
Deferred/Fiber barriers, with an Effect-valued row property. `BENCHMARK_INLINE=1`
injects an unsplit bundle into a Chromium document whose reserved `.invalid`
origin is fulfilled by Playwright. All requests are intercepted; unexpected
requests fail the run. No application server or external network is used.
Startup/navigation and script-transfer attribution are unavailable in this mode
and reported as null. These are renderer measurements, not ingress, full
bootstrap, or lazy-loading evidence.

The new comparisons use the same current fixture and runner for every checkpoint,
fresh Chromium 141.0.7390.122/Bun 1.4.0 processes, 20 warmups and 31 samples, in
A–E–candidate–candidate–E–A order. A and E's built JavaScript hashes match the
previous experiment exactly. H's source hashes match the final production files.
The host was not dedicated; no concurrent build/test work was launched by this
task during timings. Do not combine these inline results with older HTTP runs.

The first block measured G with means of process medians A 23.50, E 26.40, and
G 25.85 ms. Its allocation probe counted 1,403 Maps per 100 changed rows versus
E's 1,303. This intermediate draft is not the final implementation. Its
[environment](./keyed-granular-followup-environment.json) links all raw runs.

Final composed-context block, handler milliseconds; P10/P90 select sorted sample
indices `floor((n - 1) * p)` rather than interpolating:

| Process | Median | P10 | P90 |
| --- | ---: | ---: | ---: |
| A1 | 23.70 | 8.20 | 33.30 |
| E1 | 27.30 | 17.40 | 37.70 |
| H1 | 25.50 | 11.30 | 34.60 |
| H2 | 27.60 | 10.60 | 37.00 |
| E2 | 28.20 | 18.50 | 37.80 |
| A2 | 23.60 | 8.20 | 33.60 |

Means of process medians: **A 23.65, E 27.75, H 26.55 ms**. H remains **12.3%
above A** in this block. H is below E here, but the broad distributions and only
two processes per checkpoint do not support equivalence or a general speedup
claim. The original granular regression remains open. G/H block timings must not
be treated as an isolated measurement of composition overhead.

Separate constructor probes, excluded from timing:

| Checkpoint | Maps | Sets | Elements / text / comments |
| --- | ---: | ---: | --- |
| A | 1,603 | 700 | 0 / 0 / 0 |
| E | 1,303 | 600 | 0 / 0 / 0 |
| H | 1,303 | 600 | 0 / 0 / 0 |

The final correction removes G's 100 additional Maps while retaining caller
annotations, captured services, and cancellation/cleanup behavior. It restores
E's measured collection counts; it does not eliminate Context retention, other
JavaScript allocations, or DocumentFragments. Constructor counts are not bytes.

[Final environment, source/artifact hashes, and experiment runner](./keyed-granular-composed-environment.json)
link every raw run. Timings:
[A1](./keyed-granular-composed-a1.json), [E1](./keyed-granular-composed-e1.json),
[H1](./keyed-granular-composed-h1.json), [H2](./keyed-granular-composed-h2.json),
[E2](./keyed-granular-composed-e2.json), [A2](./keyed-granular-composed-a2.json).
Work probes: [A](./keyed-granular-composed-a-work.json),
[E](./keyed-granular-composed-e-work.json), [H](./keyed-granular-composed-h-work.json).

### Final source-workload smoke and memory observations

H also passes all nine source-list operations with one warmup and three samples
each, plus ten create-10k/clear cycles and 100 independent mounts with portals.
These short operation samples are smoke checks, not performance comparisons.
Both experiment blocks pass their six timing runs, three probes, and nine smoke
operations without operation console messages or harness failures.

In H, every clear returns to 39 DOM nodes and 38 listeners. Post-clear heap is
8.48–8.52 MB in this run. Independent mounts also return to those DOM/listener
counts and release every component, but heap rises from 8.94 MB at their baseline
to 9.12 MB after 100 mounts. That sequence does **not** demonstrate a retained-heap
plateau. Synthetic pagehide leaves 31 nodes and 37 listeners. None of these checks
isolates empty-list Context capture, pending caller Context reclamation, actual
tab closure, or the complete bootstrap graph; those remain pending.
[Raw smoke and memory observations](./keyed-granular-composed-source-smoke-memory.json).
