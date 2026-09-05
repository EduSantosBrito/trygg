# Runtime and browser benchmarks

Run `bun scripts/benchmark-resource.ts` for cached registry lookups and scoped
`Resource.fetch` hits at capacities 16, 256, and 2,048. Each case has 100 warmup
operations and seven samples of 1,000 operations, with shared-entry identity
assertions. `BENCHMARK_OUTPUT` selects the JSON output (default
`/tmp/trygg-resource-benchmark.json`). This measures warm cache hits under a
one-hour idle TTL; it excludes I/O, expiration sweeps, capacity churn, and DOM.

Run the pure runtime comparison with `bun run benchmark:runtime`.

Run the production renderer benchmark with:

```sh
bunx playwright install chromium
bun run benchmark:browser
```

Use `CHROME_BINARY` when the browser is installed elsewhere. On the current Nix
development host, the validated command is:

```sh
nix build nixpkgs#chromium --out-link /tmp/trygg-chromium
CHROME_BINARY=/tmp/trygg-chromium/bin/chromium bun run benchmark:browser
```

The runner binds only to localhost and closes the browser and server on exit.
It bundles the built core package, uses a scoped Component with keyed reactive
rows, and drives real DOM click handlers. Each case has five warmup iterations
followed by seven recorded samples. The JSON report retains every recorded
sample, the browser version, viewport, date, and sampling policy.
It also records navigation-relative DOMContentLoaded and first-contentful-paint
times for the empty app, plus raw and per-file gzip sizes of every generated JS
asset. These sizes include the benchmark fixture and shared runtime; source maps
are excluded. The localhost server serves uncompressed bytes, so gzip sizes are
an offline bundle metric, not a measurement of transferred bytes.
`loadedAtStartup` marks script resources observed before the timed workloads;
the lazy independent-mount diagnostic is included in the complete bundle totals
but loaded only for memory measurements.

`handlerMs` measures click dispatch through Effect handler completion. `frameMs`
measures the same start through a task posted from the next animation-frame
callback. This is a frame opportunity measurement; it does not independently
prove when pixels reached a physical display.

The fixture checks row counts, update labels, selection, survivor identity,
replacement identity, append identity, and keyed reorder. Unknown operation filters are rejected before launching Chromium; page exceptions
and console errors fail the run. It fails after 30 seconds
if a handler does not settle. It does not implement the official
js-framework-benchmark workload.

Optional environment variables:

- `BENCHMARK_INLINE=1`: bundle without splitting and inject into an in-memory
  Chromium document at an intercepted `.invalid` origin, without starting an
  HTTP server or making network requests. This isolates renderer
  interactions; startup/navigation timings and per-file `loadedAtStartup` are
  reported as `null`. It does not validate routing, HTTPS, transfer, or lazy
  chunk loading. Compare timings only against the same transport and fixture.
- `BENCHMARK_GRANULAR=1`: update row-owned Signals for every tenth row instead of
  replacing source items. Each changed worker is awaited; row properties include
  an Effect. This promotes the historical granular diagnostic to an explicit,
  reproducible fixture. It is not the default source-list workload.
- `BENCHMARK_OTLP=paused|record`: install the bounded `trygg/profiling` Layer.
  Requires `BENCHMARK_INLINE=1 BENCHMARK_GRANULAR=1 BENCHMARK_CASE=update`.
  `paused` measures the installed profiler without admitting spans; `record`
  admits spans only for measured updates, not setup or warmups. Default: `off`.
  The fixture uses an in-memory HttpClient and a 100,000-span lifetime budget.
  Serialized batches, counters, trace IDs and inclusive phase durations are saved
  next to the report as `<BENCHMARK_OUTPUT>.otlp.json`. A capture response is not
  an acknowledgment from a collector. Check `dropped` for truncated sessions.
- `BENCHMARK_OTLP_EXPORT=1`: with `BENCHMARK_OTLP=record`, POST the saved batches
  **after measurement** from the host process to the existing private collector at
  `http://127.0.0.1:4318/v1/traces`. Opt-in network exception: inline browser
  requests remain fully intercepted; only the host exporter contacts the
  collector. No listener, proxy, CORS or ingress changes. Raw data is saved before
  sending; non-2xx/partial-success responses fail the run. HTTP acceptance is not
  proof of SigNoz indexing. Never put API credentials in the browser fixture.
- `BENCHMARK_WORK=1`: after timing, run separate DOM, Map, and Set constructor
  probes. These count constructions, not allocated bytes or retained heap;
  instrumented observations are never included in timing samples.
- `BENCHMARK_OUTPUT`: output JSON path; defaults to the `trygg-browser-benchmark`
  directory in the OS temporary directory.
- `BENCHMARK_CASE`: restrict to an operation such as `create10k` or `remove`.
- `BENCHMARK_MEMORY=1`: after timed cases, force garbage collection between ten
  create-10k/clear cycles and record heap usage, document/node counts, and native
  listener counts. Also checks continued operation after persisted `pagehide` and
  DOM removal after non-persisted `pagehide`. The latter is a synthetic lifecycle
  event, not evidence that asynchronous finalizers finish during real tab teardown.
  Between row cycles and pagehide it runs ten batches of ten independent
  `Renderer`/Scope acquisitions, after a separate warmup batch. Each mount has
  100 derived signals, a native button handler, and one dynamic portal. It checks
  updates in rows and portal, exact component release, empty DOM after closure,
  and inactive handlers on retained detached buttons. Each GC snapshot follows
  an animation frame and a subsequent task so pending browser frame work can
  settle. This tests composable renderer ownership; the fire-and-forget `mount`
  bootstrap and Router/ResourceRegistry Layer graph remain a separate workload.
- `BENCHMARK_MOUNT_BATCHES`: 1–100 independent-mount batches, default 10; requires
  `BENCHMARK_MEMORY=1`. Each batch mounts and closes ten independent renderers.
- `BENCHMARK_PROFILE`: record a Chrome CPU profile for that operation's first
  measured sample. This preserves bundle identifiers for readable stacks and adds
  profiler overhead; do not compare these timings with ordinary runs.

Example profiling command:

```sh
CHROME_BINARY=/tmp/trygg-chromium/bin/chromium \
BENCHMARK_CASE=create10k BENCHMARK_PROFILE=create10k \
bun run benchmark:browser
```

For an isolated granular renderer comparison with an existing Chromium binary:

```sh
TMPDIR=/tmp/opencode CHROME_BINARY=/tmp/trygg-chromium/bin/chromium \
BENCHMARK_INLINE=1 BENCHMARK_GRANULAR=1 BENCHMARK_CASE=update \
BENCHMARK_WARMUP=20 BENCHMARK_SAMPLES=31 bun run benchmark:browser
```

Import the resulting `.cpuprofile` into Chromium DevTools. Keep before/after
workloads, browser versions, sampling, and runtime settings identical; avoid other
CPU-heavy work while measuring. See the [research log](../../docs/rfc/performance-research.md)
for limitations of fixed warmup counts and the current experiments.

For a bounded SigNoz profile on the collector host with its existing Chromium:

```sh
TMPDIR=/tmp/opencode CHROME_BINARY=/tmp/trygg-chromium/bin/chromium \
BENCHMARK_INLINE=1 BENCHMARK_GRANULAR=1 BENCHMARK_CASE=update \
BENCHMARK_WARMUP=20 BENCHMARK_SAMPLES=11 \
BENCHMARK_OTLP=record BENCHMARK_OTLP_EXPORT=1 \
BENCHMARK_OUTPUT=/tmp/opencode/trygg-profile.json bun run benchmark:browser
```

Compare `off`, `paused`, and `record` in fresh interleaved processes using the
same fixture. Recording includes span/serialization work but excludes the host
network POSTs. Do not attribute the whole difference to network export. Phase
durations include waiting, scheduling and GC; parents include their children and
browser clock quantization can produce zero-duration spans. See
[the profiling evidence](../../docs/rfc/profiling-signoz.md) for current results
and the outstanding authenticated-read check.
