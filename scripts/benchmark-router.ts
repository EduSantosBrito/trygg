import assert from "node:assert/strict";
import { Config, Effect } from "effect";
import * as References from "effect/References";
import * as Signal from "../packages/core/src/primitives/signal.js";
import * as Router from "../packages/core/src/router/service.js";

// Actual Router, in-memory history, route/query publication, and a route subscriber.
// Replace bounds history storage. No DOM, browser history, scrolling, or console I/O.
const measure = (concurrency: number) =>
  Effect.gen(function* () {
    const router = yield* Router.Router;
    const targets = Array.from({ length: concurrency }, (_, index) => ({
      path: `/page-${index}`,
      owner: `${index}`,
      url: `/page-${index}?owner=${index}#section`,
    }));
    let notifications = 0;
    let observedVersion = 0;
    let consistentNotifications = true;
    yield* Signal.subscribe(router.current, () =>
      Effect.gen(function* () {
        const current = yield* Signal.peek(router.current);
        const query = yield* Signal.peek(router.query);
        notifications++;
        observedVersion = current.navigation.navigationId;
        consistentNotifications &&= current.query.toString() === query.toString();
      }),
    );
    const batch = Effect.forEach(
      targets,
      (target) => router.navigate(target.url, { replace: true }),
      {
        concurrency,
        discard: true,
      },
    );
    let operations = 0;
    let batches = 0;
    const verify = Effect.gen(function* () {
      const current = yield* Signal.peek(router.current);
      const query = yield* Signal.peek(router.query);
      const target = targets.find((target) => target.path === current.path);
      assert.ok(target);
      assert.equal(current.navigation.navigationId, operations);
      assert.equal(current.query.get("owner"), target.owner);
      assert.equal(query.toString(), current.query.toString());
      assert.equal(current.navigation.hash, "#section");
      assert.equal(observedVersion, operations);
      assert.equal(consistentNotifications, true);
      assert.ok(notifications >= batches && notifications <= operations);
    });
    for (let index = 0; index < 200; index++) {
      yield* batch;
      operations += concurrency;
      batches++;
    }
    yield* verify;
    const millisecondsPerNavigation: Array<number> = [];
    for (let sample = 0; sample < 7; sample++) {
      const start = performance.now();
      for (let index = 0; index < 1_000; index++) yield* batch;
      millisecondsPerNavigation.push((performance.now() - start) / (1_000 * concurrency));
      operations += 1_000 * concurrency;
      batches += 1_000;
      yield* verify;
    }
    return { concurrency, operations, notifications, millisecondsPerNavigation };
  }).pipe(Effect.provide(Router.testLayer("/")), Effect.scoped);

const results = await Effect.runPromise(
  Effect.forEach([1, 8], measure).pipe(Effect.provideService(References.MinimumLogLevel, "None")),
);
const output = await Effect.runPromise(
  Config.string("BENCHMARK_OUTPUT").pipe(Config.withDefault("/tmp/trygg-router-benchmark.json")),
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
    `concurrency ${result.concurrency}: ${median?.toFixed(6)} ms/navigation; verified ${result.operations} operations and ${result.notifications} notifications`,
  );
}
