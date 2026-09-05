# Profiling

Find expensive render phases with a scoped, opt-in Layer that exports Effect spans
to SigNoz or another OTLP collector without loading an exporter in ordinary apps.

```ts
import * as Profiling from "trygg/profiling";

const profile = Profiling.layer({
  url: "http://127.0.0.1:4318/v1/traces",
  serviceName: "trygg-render-profile",
});
```

## When to use

Import `* as Profiling from "trygg/profiling"` to export finite render-profiling
sessions to SigNoz or another OTLP/HTTP collector. This separate entrypoint uses
Effect's native OTLP exporter, not an OpenTelemetry SDK or a renderer-specific
transport. It is **off by default**. It replaces the tracer in its provided context.

## Behavior

```ts
import { Effect, Layer } from "effect";
import { FetchHttpClient } from "effect/unstable/http";
import * as Profiling from "trygg/profiling";

const profile = Profiling.layer({
  url: "http://127.0.0.1:4318/v1/traces",
  serviceName: "trygg-render-profile",
  sessionId: "granular-investigation",
  startPaused: true,
}).pipe(Layer.provide(FetchHttpClient.layer));

// Provide profile around the whole render lifetime, not one Signal.set call.
// Initialize/mount the workload inside this Effect, before session.start.
const program = Effect.gen(function* () {
  const session = yield* Profiling.Session;
  yield* session.start;
  // Trigger updates and await the actual renderer workers here.
  yield* session.stop;
  const snapshot = yield* session.snapshot;
  yield* session.flush;
  return snapshot;
}).pipe(Effect.scoped, Effect.provide(profile));
```

The HTTP client is injected so browsers, server programs and tests can choose a
transport without coupling core rendering to Fetch. The loopback URL above is
for processes on the collector host, **not remote browsers**. Do not embed SigNoz
query credentials in a browser bundle. Browser export needs an explicitly
authorized collector route/CORS policy or a test-owned transport; this Layer does
not create a proxy, expose a service, or bypass mixed-content/CORS restrictions.

### Lifetime and limits

- Defaults: 10,000 admitted spans per Layer build, batch trigger 512, export
  interval 1,000 ms, shutdown timeout 3,000 ms. These are positive integers with
  upper limits of 1,000,000 / 10,000 / 60,000 / 60,000 respectively.
- Admission is finite across start/stop windows. The budget bounds admitted span
  count over the entire session, **not bytes**; batching alone is not a bounded
  queue. Nested spans may be truncated when the budget is exhausted.
- Stop prevents new admissions. Already admitted spans may finish until owner
  closure. Start cannot reopen a closed owner or reset its budget.
- Keep the Layer outside the mount/workload Scope so row cleanup ends before the
  exporter closes. Await workers before stopping or flushing.
- The Effect exporter owns background fibers, batching, retries, and final flush.
  Export errors do not fail rendering. Retries can duplicate data; failures,
  overload, timeouts and process exit can lose data. There is no durable delivery.
- `recorded` means handed to the exporter, **not collector acceptance or SigNoz
  indexing**. Manual flush is bounded best effort, does not await exports already
  in flight, and returns no delivery acknowledgment. Scope closure waits for
  native in-flight export fibers up to the shutdown timeout.
- Invalid configuration returns `ProfilingConfigError` before transport acquisition.

### Data and span vocabulary

Only fixed framework names are admitted. User attributes, events, span links,
annotations, error messages and stacks are not forwarded through the span methods.
Failure, defect and interruption categories are projected to generic OTLP status
and exception information without changing the application's original Cause.
Service name/version and optional `trygg.profile.session` are explicitly exported
and must not contain secrets. Ambient OTEL resource configuration is not inherited.
Trace IDs, span IDs, parent IDs, names and timestamps remain visible. This is not
a security sandbox for code with direct access to the tracer or HTTP client.

Keyed workers have independent roots (`trygg.keyedList.granular` and
`trygg.keyedList.update`) rather than referencing an old mount span. Granular
workers include these phases when the corresponding path executes:

| Span suffix  | Measured boundary                                                              |
| ------------ | ------------------------------------------------------------------------------ |
| `prepare`    | Row render/normalization, compatibility planning and candidate DOM build       |
| `render`     | User row Effect and normalization, nested inside prepare                       |
| `properties` | Effectful compatible-row preparation plan, nested inside prepare               |
| `reconcile`  | Attempt to patch the retained row                                              |
| `cleanup`    | Post-commit subscriptions/retirement, or failed candidate rollback and release |

Source updates share preparation spans; not every source/DOM/cleanup subpath is
separately instrumented. Existing fixed renderer/component/derivation names are
also admitted; the full catalog is in `primitives/render-profiling.ts`. Trace's
structured flight-recorder **logs are not converted into artificial timed spans**.

### Reading costs honestly

Span duration is wall time: active execution, suspension, scheduler yields and GC
can all contribute. Parent durations include children, so summing them double
counts. Parallel workers overlap. An uninstrumented gap is not automatically CPU
self-time. Compare equivalent workloads with profiling disabled, enabled but
paused, and recording; use separate CPU/GC tooling to explain the difference.
Do not use instrumented latency as a replacement for the uninstrumented benchmark.

## Related exports

- `layer`: scoped OTLP profiler; requires an Effect HttpClient.
- `Session`: start, stop, flush and inspect the current profiling window.
- `ProfilingOptions`, `ProfilingSnapshot`: configuration and admission counters.
- `ProfilingConfigError`: typed configuration failure.
- `Debug` / `Trace`: console and structured event recording, separate from spans.
