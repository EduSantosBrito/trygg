# SigNoz render profiling — 2026-09-05

`trygg/profiling` now provides a bounded, opt-in Layer using Effect 4.0.0-rc.112's
native `OtlpTracer`, `OtlpSerialization` and `OtlpExporter`. It exports spans, not
synthetic durations reconstructed from flight-recorder logs. The renderer imports
only a small internal flag/phase helper; ordinary applications do not import OTLP.
The [source-owned guide](../../packages/core/src/profiling.docs.md) owns API semantics.

## Observed delivery boundary

- Existing `signoz.service` was active, and
  `https://traces.brito.top/api/v1/health` returned `{"status":"ok"}`.
- The host collector is documented at `http://127.0.0.1:4318/v1/traces` in
  `/home/host/nixos-dotfiles/docs/signoz-traces.md`. It accepts OTLP/HTTP JSON.
- Final `record1` and `record2`: **7,700 spans each**, **1,100 independent granular
  traces each**, no missing parents, no budget drops. All **33 batches** returned
  HTTP 200 with zero reported rejected spans and no partial-success message.
- Service: **`trygg-granular-profile`**, visible at the SigNoz UI
  **https://traces.brito.top**; one complete trace has now been retrieved via MCP.
- Session attributes (`trygg.profile.session`):
  - `granular-1788617005252-a0aa09ac-f5b0-42d2-81a4-48c2e84a4abf`
  - `granular-1788617012047-81b225a4-7f19-486d-8e35-18e71552a31d`
- Reading the second session's real trace
  `d80856f62a9d64e19fc7fcda82d8146f` through
  `/api/v1/traces/d80856f62a9d64e19fc7fcda82d8146f` at
  **2026-09-05T16:06:01+02:00** returned **HTTP 401** with
  `{"status":"error","error":{"code":"unauthenticated","message":"unauthenticated"}}`.
  `SIGNOZ_API_KEY` was not available to that process. No credentials were searched
  out of private storage, created, or embedded in code.

**Follow-up: authenticated MCP querying now works.** After the user renamed the
Infisical secret from `SIGNOZ_API_TOKEN` to `SIGNOZ_API_KEY`, the MCP was launched
through `infisical run`, following the existing Fish launcher rather than relying
on the old OpenCode process environment. `signoz_get_trace_details` returned all
seven spans of `d80856f62a9d64e19fc7fcda82d8146f` with the expected hierarchy.
Returned link: https://traces.brito.top/trace/d80856f62a9d64e19fc7fcda82d8146f

This confirms indexing for that complete trace, not an exhaustive reconciliation
of all 15,400 exported spans. The phase analysis below still uses the original
local payloads. The historical 401 in `profiling-validation.json` is retained;
the successful follow-up is recorded in `profiling-mcp-validation.json`.

No application service or alternate ingress was launched. Chromium remained on
the intercepted inline origin; the test-owned HttpClient captured batches in
memory. Only the host benchmark process made collector POSTs, after timing.
No infrastructure changed. Finite commands ran in the task-owned Herdr pane `wM:p4`.

## Correctness and scope

Nineteen new tests cover OTLP serialization, endpoint/resource identity, parentage,
window/budget behavior, invalid options, generic failure/defect/interruption
projection without changing application Reasons, combined application/cleanup
Causes under rejected export, suspended-transport shutdown via TestClock, late
spans after owner closure, ambient OTEL resource isolation, and real keyed DOM
identity with Effect-valued properties and row derivations.

Two instrumentation gaps were first reproduced by failing tests:

1. Keyed granular workers had no timed phase hierarchy. They now expose prepare,
   render, properties, reconcile and post-commit/rollback cleanup spans.
2. A row's `Signal.derive` was parented to its captured mount span rather than the
   active profiling render phase. Profiling now omits only `ParentSpan` from the
   row-render service snapshot. The default non-profiling path remains unchanged.

The initial 3-sample smoke sent 2,100 spans before the parent correction. Its
session `granular-1788616425280-649cedb5-1b4e-4493-93a7-fa8273749035` contains orphaned
derivation spans and **must not be used as the final hierarchy evidence**.
The final block below uses the corrected code; all 15,400 span parents validate.

The profiler deliberately filters fixed names, strips attributes/events/links via
span methods and projects error details. It is not a security sandbox, durable
delivery pipeline, byte-bounded queue, or whole-framework span coverage. Unknown
or unsampled parents may suppress descendants; budget truncation can produce
partial traces. Keyed worker roots are deliberately independent of notifier spans.

## Overhead experiment

Six fresh Chromium 141.0.7390.122 processes, interleaved
**off1–paused1–record1–record2–paused2–off2**. Each used **20 warmups / 11 samples**,
the maintained inline fixture, 1,000 rows, every tenth row-owned Signal updated,
and Deferred/Fiber barriers awaiting actual workers. No task-owned build/test ran
concurrently with timing. The host was not dedicated.

| Mode/run | Handler median, ms | Min–max, ms |
| --- | ---: | ---: |
| off1 | 18.50 | 8.60–39.40 |
| paused1 | 26.50 | 11.00–49.70 |
| record1 | 29.70 | 12.90–56.50 |
| record2 | 27.70 | 12.60–45.20 |
| paused2 | 26.60 | 11.50–40.70 |
| off2 | 27.90 | 20.90–46.30 |

Means of the two process medians: off **23.20**, paused **26.55**, recording
**28.70 ms**. This block's descriptive recording difference is **+23.7%** versus
off, but the off processes themselves differ by **9.40 ms**. Do not treat this as
a stable overhead estimate, a causal regression attribution, or proof the normal
path is regression-free. Recording includes phase wrappers, tracer admission and
serialization/in-memory capture; it excludes collector POSTs. Paused still has
phase/tracer overhead. A longer dedicated-host study is needed.

These are **not** a rerun of the prior A–E–H comparison. The historical final-H
**+12.3%** gap remains open; neither the current off median nor the profile block
closes it. No production performance optimization was accepted in this task.

## Initial phase evidence

Totals across 2,200 recorded row workers, with seven spans per worker:

| Phase | Inclusive total, ms | Interpretation |
| --- | ---: | --- |
| granular root | 312.3 | Whole worker lifetime |
| prepare | 181.6 | 58.1% of recorded worker wall time; includes render/properties |
| render | 134.0 | Nested inside prepare; 42.9% of root total |
| Signal.derive | 24.1 | Nested inside render; do not add to render total |
| properties | 18.4 | Nested inside prepare |
| reconcile | 67.9 | 21.7% of root total |
| cleanup | 12.1 | 3.9%; includes post-commit subscription work |

**Preparation/row rendering is the first candidate to inspect**, ahead of
reconciliation and cleanup in this fixture. This is not CPU self-time. Individual
spans are quantized to approximately 0.1 ms in these browser results; many medians
are zero. Render maxima of 2.2–2.3 ms need CPU/GC/scheduler correlation rather than
speculative optimization. Worker roots also exclude notifier-to-worker queue delay
and do not explain the full click-handler duration.

Next: correlate long render spans retrieved through the authenticated MCP with
separate Chrome CPU/GC/scheduling evidence; test any suspected unnecessary work
before changing it; repeat uninstrumented equivalent-fixture comparisons.

## Reproduction and evidence

See [benchmark flags](../../scripts/benchmarks/README.md). The final experiment's
command, runner source, timestamps, source/dist/harness hashes, every timing sample,
counters, phase summaries and HTTP acknowledgments are preserved in
[`profiling-session-results.json`](./profiling-session-results.json).
Raw OTLP evidence is gzip-compressed without loss in
`profiling-record1-otlp.json.gz` and `profiling-record2-otlp.json.gz`; hashes of both
compressed and original bytes are in the experiment JSON. Source/dist/harness
hashes were unchanged across the measured block.

Validation: **1,924 tests passed** (1,733 core / 87 CLI / 104 site); build and full
typecheck passed; Effect diagnostics passed (203 core / 30 CLI files, zero
errors/warnings/messages); docs contract passed with **345 reachable exports**.
Aggregate `bun run check` remains blocked by the same seven pre-existing scaffold
formatting issues in `trygg-test-Qmdoqz`, `trygg-test-UEnGw2`, and
`trygg-test-yZUgiU`. Lint has only the two pre-existing `no-this-alias` warnings.
No unfamiliar scaffold work was deleted or reformatted. No commit or push.

Example and site production builds also passed, as did all nine source-mode
Chromium operation smoke checks (1 warmup / 3 samples; not comparative timing).
Final gate log hashes and source/hash verification are recorded in
[`profiling-validation.json`](./profiling-validation.json). The task-owned pane
was closed after confirming that only its shell remained; no application service
registration was created.
