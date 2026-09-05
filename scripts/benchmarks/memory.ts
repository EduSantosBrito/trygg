import { Schema } from "effect";
import type { Page } from "playwright";

const Snapshot = Schema.Struct({
  label: Schema.String,
  usedSize: Schema.Number,
  totalSize: Schema.Number,
  documents: Schema.Number,
  nodes: Schema.Number,
  jsEventListeners: Schema.Number,
});

/** Forced-GC diagnostics; deliberately separate from timed interaction samples. */
export const measureMemory = async (page: Page, independentBatches = 10) => {
  const session = await page.context().newCDPSession(page);
  const samples: Array<typeof Snapshot.Type> = [];
  const snapshot = async (label: string) => {
    // Allow the browser to finish pending frame work before collecting detached
    // nodes, matching the frame/task settlement used by the interaction fixture.
    await page.evaluate(() => new Promise<void>((resolve) =>
      requestAnimationFrame(() => setTimeout(resolve, 0)),
    ));
    await session.send("HeapProfiler.collectGarbage");
    const heap: unknown = await session.send("Runtime.getHeapUsage");
    const dom: unknown = await session.send("Memory.getDOMCounters");
    const counters = Schema.decodeUnknownSync(
      Schema.Struct({
        heap: Schema.Struct({ usedSize: Schema.Number, totalSize: Schema.Number }),
        dom: Schema.Struct({
          documents: Schema.Number,
          nodes: Schema.Number,
          jsEventListeners: Schema.Number,
        }),
      }),
    )({ heap, dom });
    samples.push({ label, ...counters.heap, ...counters.dom });
  };
  const run = async (operation: string, expected: number) => {
    const result = await page.evaluate((name) => window.tryggBenchmark.run(name), operation);
    if (result.rows !== expected)
      throw new Error(`${operation}: expected ${expected} rows, received ${result.rows}`);
  };
  try {
    await run("clear", 0);
    await snapshot("baseline");
    for (let cycle = 1; cycle <= 10; cycle++) {
      await run("create10k", 10_000);
      if (cycle === 1) await snapshot("mounted10k");
      await run("clear", 0);
      await snapshot(`cleared-${cycle}`);
    }
    // Load and warm the independent-mount probe before taking its own baseline;
    // its lazy bundle and runtime metadata are retained by the page thereafter.
    await page.evaluate(() => window.tryggBenchmark.mountCycle());
    await snapshot("independent-baseline");
    const independentMounts = [];
    for (let cycle = 1; cycle <= independentBatches; cycle++) {
      independentMounts.push(await page.evaluate(() => window.tryggBenchmark.mountCycle()));
      await snapshot(`independent-closed-${cycle}`);
    }
    await run("create1k", 1_000);
    await page.evaluate(() =>
      window.dispatchEvent(new PageTransitionEvent("pagehide", { persisted: true })),
    );
    // A retained bfcache document must keep its live owner and callbacks.
    await run("update", 1_000);
    await page.evaluate(() =>
      window.dispatchEvent(new PageTransitionEvent("pagehide", { persisted: false })),
    );
    await page.waitForFunction(() => document.getElementById("root")?.childNodes.length === 0);
    // Release the benchmark's own closure so retained heap measures framework ownership.
    await page.evaluate(() => Reflect.deleteProperty(window, "tryggBenchmark"));
    await snapshot("pagehide");
    return { cycles: 10, rowsPerCycle: 10_000, forcedGc: true, settlement: "animationFrameThenTask", independentMounts, samples };
  } finally {
    await session.detach();
  }
};
