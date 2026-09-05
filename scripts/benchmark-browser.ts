import { chromium, type Browser } from "playwright";
import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import type { Measurement } from "./benchmarks/browser.js";
import { measureMemory } from "./benchmarks/memory.js";
import { exportBatches, summarize } from "./benchmarks/profile-report.js";

const cases = [
  { operation: "create1k", setup: "clear", count: 1_000 },
  { operation: "replace1k", setup: "create1k", count: 1_000 },
  { operation: "update", setup: "create1k", count: 1_000 },
  { operation: "select", setup: "create1k", count: 1_000 },
  { operation: "swap", setup: "create1k", count: 1_000 },
  { operation: "remove", setup: "create1k", count: 999 },
  { operation: "append1k", setup: "create1k", count: 2_000 },
  { operation: "clear", setup: "create1k", count: 0 },
  { operation: "create10k", setup: "clear", count: 10_000 },
];
const warmupCount = Number(process.env.BENCHMARK_WARMUP ?? "5");
const sampleCount = Number(process.env.BENCHMARK_SAMPLES ?? "7");
for (const name of ["BENCHMARK_INLINE", "BENCHMARK_GRANULAR"]) {
  if (process.env[name] !== undefined && process.env[name] !== "1")
    throw new Error(`${name} must be 1 when specified`);
}
const inline = process.env.BENCHMARK_INLINE === "1";
const otlp = process.env.BENCHMARK_OTLP ?? "off";
if (!["off", "paused", "record"].includes(otlp))
  throw new Error("BENCHMARK_OTLP must be off, paused or record");
if (otlp !== "off" && (!inline || process.env.BENCHMARK_GRANULAR !== "1" || process.env.BENCHMARK_CASE !== "update"))
  throw new Error("BENCHMARK_OTLP requires inline granular update isolation");
if (process.env.BENCHMARK_OTLP_EXPORT !== undefined &&
    (process.env.BENCHMARK_OTLP_EXPORT !== "1" || otlp !== "record"))
  throw new Error("BENCHMARK_OTLP_EXPORT=1 requires BENCHMARK_OTLP=record");
const profileSession = `granular-${Date.now()}-${crypto.randomUUID()}`;
if (!Number.isInteger(warmupCount) || warmupCount < 0 || warmupCount > 100)
  throw new Error("BENCHMARK_WARMUP must be an integer between 0 and 100");
if (!Number.isInteger(sampleCount) || sampleCount < 1 || sampleCount > 101 || sampleCount % 2 === 0)
  throw new Error("BENCHMARK_SAMPLES must be an odd integer between 1 and 101");
for (const name of ["BENCHMARK_CASE", "BENCHMARK_PROFILE"]) {
  const value = process.env[name];
  if (value !== undefined && !cases.some((test) => test.operation === value))
    throw new Error(`Unknown ${name}: ${value}`);
}
if (
  process.env.BENCHMARK_CASE !== undefined &&
  process.env.BENCHMARK_PROFILE !== undefined &&
  process.env.BENCHMARK_CASE !== process.env.BENCHMARK_PROFILE
)
  throw new Error("BENCHMARK_PROFILE must match BENCHMARK_CASE when both are specified");

const output = join(tmpdir(), "trygg-browser-benchmark");
if (process.env.BENCHMARK_MEMORY !== undefined && process.env.BENCHMARK_MEMORY !== "1")
  throw new Error("BENCHMARK_MEMORY must be 1 when specified");
if (process.env.BENCHMARK_WORK !== undefined && process.env.BENCHMARK_WORK !== "1")
  throw new Error("BENCHMARK_WORK must be 1 when specified");
const independentBatches = Number(process.env.BENCHMARK_MOUNT_BATCHES ?? "10");
if (!Number.isInteger(independentBatches) || independentBatches < 1 || independentBatches > 100)
  throw new Error("BENCHMARK_MOUNT_BATCHES must be an integer between 1 and 100");
if (process.env.BENCHMARK_MOUNT_BATCHES !== undefined && process.env.BENCHMARK_MEMORY !== "1")
  throw new Error("BENCHMARK_MOUNT_BATCHES requires BENCHMARK_MEMORY=1");
await mkdir(output, { recursive: true });
const bundle = await Bun.build({
  entrypoints: ["scripts/benchmarks/browser.ts"],
  outdir: output,
  target: "browser",
  splitting: !inline,
  define: {
    __TRYGG_BENCHMARK_GRANULAR__: String(process.env.BENCHMARK_GRANULAR === "1"),
    __TRYGG_BENCHMARK_OTLP__: JSON.stringify(otlp),
    __TRYGG_PROFILE_SESSION__: JSON.stringify(profileSession),
  },
  minify: {
    syntax: true,
    whitespace: true,
    identifiers: process.env.BENCHMARK_PROFILE === undefined,
  },
  sourcemap: "external",
});
if (!bundle.success) throw new AggregateError(bundle.logs, "Benchmark bundle failed");

const html = `<!doctype html><html><head><style>
body { font: 14px sans-serif; } table { width: 100%; border-collapse: collapse; }
td { padding: 8px; border-bottom: 1px solid #ddd; } .danger { background: #fdd; }
</style></head><body><div id="root"></div>${inline ? "" : '<script type="module" src="/browser.js"></script>'}</body></html>`;
const server = inline ? undefined : Bun.serve({
  hostname: "127.0.0.1",
  port: 0,
  fetch: (request) => {
    const path = new URL(request.url).pathname;
    if (path === "/") return new Response(html, { headers: { "Content-Type": "text/html" } });
    if (path === "/favicon.ico") return new Response(null, { status: 204 });
    const artifact = bundle.outputs.find((item) => `/${item.path.split("/").pop()}` === path);
    return artifact === undefined
      ? new Response("Not found", { status: 404 })
      : new Response(artifact);
  },
});

let browser: Browser | undefined;
try {
  browser = await chromium.launch({
    headless: true,
    ...(process.env.CHROME_BINARY ? { executablePath: process.env.CHROME_BINARY } : {}),
    args: ["--disable-background-timer-throttling"],
  });
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  const failures: Array<string> = [];
  let consoleMessages = 0;
  page.on("pageerror", (error) => failures.push(error.message));
  page.on("console", (message) => {
    consoleMessages++;
    if (message.type() === "error") failures.push(message.text());
  });
  if (inline) {
    // Isolate renderer work without an HTTP service. This mode does not measure
    // navigation, transport, lazy chunk loading, or application bootstrap latency.
    // A synthetic origin keeps browser storage available. Every request is
    // intercepted; no DNS, TLS connection, or application listener is involved.
    const origin = "https://trygg-benchmark.invalid/";
    await page.route("**/*", async (route) => {
      if (route.request().url() === origin)
        await route.fulfill({ status: 200, contentType: "text/html", body: html });
      else {
        failures.push(`Unexpected inline request: ${route.request().url()}`);
        await route.abort();
      }
    });
    await page.goto(origin);
    const entrypoint = bundle.outputs.find((artifact) => artifact.kind === "entry-point");
    if (entrypoint === undefined) throw new Error("Benchmark entrypoint missing");
    await page.addScriptTag({ type: "module", content: await entrypoint.text() });
  } else if (server !== undefined) {
    await page.goto(`http://127.0.0.1:${server.port}`);
  }
  await page.waitForSelector("#create1k").catch((error: unknown) => {
    throw failures.length === 0 ? error : new Error(failures.join("\n"));
  });
  // Observe the empty application's first paint before any workload mutates it.
  await page.waitForFunction(
    () => performance.getEntriesByName("first-contentful-paint").length > 0,
  );
  const startupScriptFiles = await page.evaluate(() =>
    performance
      .getEntriesByType("resource")
      .filter(
        (entry) => entry instanceof PerformanceResourceTiming && entry.initiatorType === "script",
      )
      .map((entry) => new URL(entry.name).pathname.split("/").pop()),
  );
  const results: Array<{ operation: string; samples: Array<Measurement> }> = [];
  const operationConsoleMessages: Array<{ operation: string; messages: number }> = [];
  const work: Array<{
    operation: string;
    rows: number;
    elements: number;
    textNodes: number;
    comments: number;
    maps: number;
    sets: number;
    tags: Record<string, number>;
  }> = [];
  for (const test of cases) {
    if (process.env.BENCHMARK_CASE !== undefined && process.env.BENCHMARK_CASE !== test.operation)
      continue;
    const samples: Array<Measurement> = [];
    let operationMessages = 0;
    for (let index = 0; index < warmupCount + sampleCount; index++) {
      await page.evaluate((operation) => window.tryggBenchmark.run(operation), test.setup);
      const profile =
        process.env.BENCHMARK_PROFILE === test.operation && index === warmupCount
          ? await page.context().newCDPSession(page)
          : undefined;
      if (profile !== undefined) {
        await profile.send("Profiler.enable");
        await profile.send("Profiler.setSamplingInterval", { interval: 100 });
        await profile.send("Profiler.start");
      }
      const messagesBefore = consoleMessages;
      if (otlp === "record" && index >= warmupCount)
        await page.evaluate(() => window.tryggBenchmark.profile?.start());
      const result = await page.evaluate(
        (operation) => window.tryggBenchmark.run(operation),
        test.operation,
      );
      const emittedMessages = consoleMessages - messagesBefore;
      if (otlp !== "off") await page.evaluate(() => window.tryggBenchmark.profile?.stop());
      operationMessages += emittedMessages;
      if (emittedMessages !== 0)
        throw new Error(`${test.operation}: emitted ${emittedMessages} console messages; timing requires a silent application`);
      if (profile !== undefined) {
        const recorded = await profile.send("Profiler.stop");
        await Bun.write(
          join(output, `${test.operation}.cpuprofile`),
          JSON.stringify(recorded.profile),
        );
        await profile.detach();
      }
      if (result.rows !== test.count)
        throw new Error(`${test.operation}: ${result.rows} rows, expected ${test.count}`);
      if (index >= warmupCount) samples.push(result);
    }
    results.push({ operation: test.operation, samples });
    operationConsoleMessages.push({ operation: test.operation, messages: operationMessages });
    const sorted = samples.map((sample) => sample.handlerMs).sort((a, b) => a - b);
    console.log(`${test.operation}: handler median ${sorted[Math.floor(sampleCount / 2)]?.toFixed(2)} ms`);
    if (process.env.BENCHMARK_WORK === "1") {
      await page.evaluate((operation) => window.tryggBenchmark.run(operation), test.setup);
      work.push(
        await page.evaluate(async (operation) => {
          // This separate probe is excluded from timing samples. Proxy forwarding
          // preserves native receivers, overloads, return values, and exceptions.
          const tags: Record<string, number> = {};
          const counts = { operation, rows: 0, elements: 0, textNodes: 0, comments: 0, maps: 0, sets: 0, tags };
          const MapConstructor = globalThis.Map;
          const SetConstructor = globalThis.Set;
          const createElement = Document.prototype.createElement;
          const createTextNode = Document.prototype.createTextNode;
          const createComment = Document.prototype.createComment;
          Document.prototype.createElement = new Proxy(createElement, {
            apply(target, receiver, args) {
              counts.elements++;
              const tag = args[0];
              if (typeof tag === "string") counts.tags[tag] = (counts.tags[tag] ?? 0) + 1;
              return Reflect.apply(target, receiver, args);
            },
          });
          Document.prototype.createTextNode = new Proxy(createTextNode, {
            apply(target, receiver, args) {
              counts.textNodes++;
              return Reflect.apply(target, receiver, args);
            },
          });
          Document.prototype.createComment = new Proxy(createComment, {
            apply(target, receiver, args) {
              counts.comments++;
              return Reflect.apply(target, receiver, args);
            },
          });
          globalThis.Map = new Proxy(MapConstructor, {
            construct(target, args, newTarget) {
              counts.maps++;
              return Reflect.construct(target, args, newTarget);
            },
          });
          globalThis.Set = new Proxy(SetConstructor, {
            construct(target, args, newTarget) {
              counts.sets++;
              return Reflect.construct(target, args, newTarget);
            },
          });
          try {
            counts.rows = (await window.tryggBenchmark.run(operation)).rows;
            return counts;
          } finally {
            Document.prototype.createElement = createElement;
            Document.prototype.createTextNode = createTextNode;
            Document.prototype.createComment = createComment;
            globalThis.Map = MapConstructor;
            globalThis.Set = SetConstructor;
          }
        }, test.operation),
      );
    }
  }
  const memory =
    process.env.BENCHMARK_MEMORY === "1"
      ? await measureMemory(page, independentBatches)
      : undefined;
  if (failures.length > 0) throw new Error(failures.join("\n"));
  const startup = inline ? null : await page.evaluate(() => {
    const navigation = performance.getEntriesByType("navigation")[0];
    const paint = performance.getEntriesByName("first-contentful-paint")[0];
    if (!(navigation instanceof PerformanceNavigationTiming) || paint === undefined)
      throw new Error("Navigation or first-contentful-paint measurement unavailable");
    return {
      domContentLoadedMs: navigation.domContentLoadedEventEnd,
      firstContentfulPaintMs: paint.startTime,
    };
  });
  const bundleSizes = await Promise.all(
    bundle.outputs
      .filter((artifact) => artifact.path.endsWith(".js"))
      .map(async (artifact) => {
        const bytes = await artifact.arrayBuffer();
        return {
          file: artifact.path.split("/").pop(),
          loadedAtStartup: inline ? null : startupScriptFiles.includes(artifact.path.split("/").pop()),
          bytes: bytes.byteLength,
          gzipBytes: Bun.gzipSync(bytes).byteLength,
        };
      }),
  );
  const report = {
    date: new Date().toISOString(),
    browser: browser.version(),
    transport: inline ? "inline" : "http",
    fixture: process.env.BENCHMARK_GRANULAR === "1" ? "granular" : "source",
    profiling: otlp,
    viewport: { width: 1280, height: 800 },
    warmup: warmupCount,
    samples: sampleCount,
    results,
    operationConsoleMessages,
    startup,
    bundleSizes,
    ...(process.env.BENCHMARK_WORK === "1" ? { work } : {}),
    ...(memory === undefined ? {} : { memory }),
  };
  if (otlp !== "off") {
    const captured = await page.evaluate(() => window.tryggBenchmark.profile?.collect());
    if (captured === undefined) throw new Error("Profiling controls missing");
    const evidence = {
      sessionId: profileSession, mode: otlp, snapshot: captured.snapshot,
      ...summarize(captured.batches), batches: captured.batches,
    };
    const evidencePath = `${process.env.BENCHMARK_OUTPUT ?? join(output, "results.json")}.otlp.json`;
    // Save raw batches before any transport can fail.
    await Bun.write(evidencePath, JSON.stringify(evidence, null, 2));
    if (process.env.BENCHMARK_OTLP_EXPORT === "1") {
      const acknowledgments = await exportBatches(captured.batches);
      await Bun.write(evidencePath, JSON.stringify({ ...evidence, acknowledgments }, null, 2));
      console.log(`OTLP: ${captured.snapshot.recorded} recorded spans, ${acknowledgments.length} accepted batches; session ${profileSession}`);
    }
  }
  await Bun.write(
    process.env.BENCHMARK_OUTPUT ?? join(output, "results.json"),
    JSON.stringify(report, null, 2),
  );
} finally {
  try {
    await browser?.close();
  } finally {
    server?.stop(true);
  }
}
