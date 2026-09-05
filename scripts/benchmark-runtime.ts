import { Effect } from "effect";
import * as References from "effect/References";
import { empty } from "../packages/core/src/primitives/element.js";
import { cleanupAll } from "../packages/core/src/primitives/render-cleanup.js";
import { resolveRoutes, RouteMatcher } from "../packages/core/src/router/matching.js";
import * as Route from "../packages/core/src/router/route.js";
import * as Routes from "../packages/core/src/router/routes.js";

// Run with: bun scripts/benchmark-runtime.ts
// Warm up each production operation, then report the median of seven samples.
// These timings are evidence for local comparison, never a CI pass/fail threshold.
const measure = Effect.fnUntraced(function* <A, E, R>(
  name: string,
  operation: Effect.Effect<A, E, R>,
  iterations: number,
) {
  for (let index = 0; index < 5; index++) yield* operation;
  const samples: Array<number> = [];
  for (let sample = 0; sample < 7; sample++) {
    const start = performance.now();
    for (let index = 0; index < iterations; index++) yield* operation;
    samples.push((performance.now() - start) / iterations);
  }
  samples.sort((left, right) => left - right);
  console.log(`${name}: ${samples[3]?.toFixed(3)} ms/op`);
});

const program = Effect.gen(function* () {
  const page = Effect.succeed(empty);
  for (const size of [100, 1_000, 4_000]) {
    let routes = Routes.make();
    for (let index = 0; index < size; index++) {
      routes = routes.add(Route.make(`/page-${index}/:id`).component(page));
    }
    yield* measure(`resolve ${size} routes`, resolveRoutes(routes.manifest), 10);
    const matcher = yield* RouteMatcher.make(routes.manifest);
    yield* measure(`match last of ${size} routes`, matcher.match(`/page-${size - 1}/a%2Fb`), 20);
    yield* measure(`miss ${size} routes`, matcher.match("/missing/value"), 20);
  }
  for (const size of [1_000, 10_000]) {
    const cleanups = Array.from({ length: size }, () => Effect.void);
    yield* measure(`cleanup ${size} releases`, cleanupAll(cleanups), 20);
  }
}).pipe(Effect.provideService(References.MinimumLogLevel, "None"));

await Effect.runPromise(program);
