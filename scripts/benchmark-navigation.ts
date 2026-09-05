import assert from "node:assert/strict";
import { Config, Effect } from "effect";
import * as References from "effect/References";
import {
  NavigationAdapter,
  NavigationCore,
  navigationTarget,
} from "../packages/core/src/router/navigation-core.js";

// Coordinator throughput only: no Router Signal publication, DOM, TCP, or browser history.
// Replace keeps the memory history bounded while navigation versions continue increasing.
const results = await Effect.runPromise(
  Effect.gen(function* () {
    const measurements: Array<{
      readonly concurrency: number;
      readonly operations: number;
      readonly millisecondsPerNavigation: ReadonlyArray<number>;
    }> = [];
    for (const concurrency of [1, 8]) {
      const adapter = yield* NavigationAdapter.makeInMemory("/");
      const core = yield* NavigationCore.make({ notifyUnchangedQuery: false }, adapter);
      const targets = Array.from({ length: concurrency }, (_, index) =>
        navigationTarget(`/page-${index}?owner=${index}#section`, { replace: true }),
      );
      const batch = Effect.forEach(targets, (target) => core.navigate(target), {
        concurrency,
        discard: true,
      });
      let operations = 0;
      const verify = Effect.gen(function* () {
        const snapshot = yield* core.current;
        const history = yield* adapter.read;
        assert.equal(snapshot.navigationId, operations);
        assert.equal(snapshot.path, history.path);
        assert.equal(snapshot.query.toString(), history.query.toString());
        assert.equal(snapshot.hash, history.hash);
        assert.equal(snapshot.scrollKey, history.scrollKey);
      });
      for (let index = 0; index < 200; index++) {
        yield* batch;
        operations += concurrency;
      }
      yield* verify;
      const millisecondsPerNavigation: Array<number> = [];
      for (let sample = 0; sample < 7; sample++) {
        const start = performance.now();
        for (let index = 0; index < 1_000; index++) yield* batch;
        millisecondsPerNavigation.push((performance.now() - start) / (1_000 * concurrency));
        operations += 1_000 * concurrency;
        yield* verify;
      }
      measurements.push({ concurrency, operations, millisecondsPerNavigation });
    }
    return measurements;
  }).pipe(Effect.provideService(References.MinimumLogLevel, "None")),
);

const output = await Effect.runPromise(
  Config.string("BENCHMARK_OUTPUT").pipe(
    Config.withDefault("/tmp/trygg-navigation-benchmark.json"),
  ),
);
await Bun.write(
  output,
  JSON.stringify(
    {
      date: new Date().toISOString(),
      bun: Bun.version,
      warmupBatches: 200,
      measuredBatches: 1_000,
      samples: 7,
      results,
    },
    null,
    2,
  ),
);
for (const result of results) {
  const median = result.millisecondsPerNavigation.toSorted((a, b) => a - b)[3];
  console.log(
    `concurrency ${result.concurrency}: ${median?.toFixed(6)} ms/navigation; verified ${result.operations} operations`,
  );
}
