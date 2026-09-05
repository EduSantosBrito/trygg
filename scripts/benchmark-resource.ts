import { Effect, Option } from "effect";
import * as References from "effect/References";
import * as Resource from "../packages/core/src/primitives/resource.js";
import * as Signal from "../packages/core/src/primitives/signal.js";

interface Sample {
  readonly capacity: number;
  readonly operation: string;
  readonly millisecondsPerOperation: ReadonlyArray<number>;
}

const measure = Effect.fnUntraced(function* <A, E, R>(
  capacity: number,
  operation: string,
  effect: Effect.Effect<A, E, R>,
) {
  for (let index = 0; index < 100; index++) yield* effect;
  const millisecondsPerOperation: Array<number> = [];
  for (let sample = 0; sample < 7; sample++) {
    const start = performance.now();
    for (let index = 0; index < 1_000; index++) yield* effect;
    millisecondsPerOperation.push((performance.now() - start) / 1_000);
  }
  return { capacity, operation, millisecondsPerOperation } satisfies Sample;
});

const results = await Effect.runPromise(
  Effect.gen(function* () {
    const samples: Array<Sample> = [];
    for (const capacity of [16, 256, 2_048]) {
      yield* Effect.gen(function* () {
        const registry = yield* Resource.ResourceRegistryTag;
        for (let index = 0; index < capacity; index++) {
          const entry = yield* registry.getOrCreate(`key-${index}`);
          yield* Signal.set(entry.state, Resource.Success(index));
        }
        const key = `key-${capacity - 1}`;
        const entry = yield* registry.getOrCreate(key);
        const descriptor = Resource.make(() => Effect.succeed(-1), { key });
        const lookup = registry.get(key).pipe(
          Effect.tap((found) =>
            Effect.sync(() => {
              if (Option.isNone(found) || found.value !== entry)
                throw new Error("Cache hit lost identity");
            }),
          ),
        );
        const fetch = Resource.fetch(descriptor).pipe(
          Effect.tap((state) =>
            Effect.sync(() => {
              if (state !== entry.state) throw new Error("Cached fetch lost shared state identity");
            }),
          ),
          Effect.scoped,
        );
        samples.push(yield* measure(capacity, "registry.get", lookup));
        samples.push(yield* measure(capacity, "Resource.fetch scoped hit", fetch));
      }).pipe(
        Effect.provide(Resource.ResourceRegistry.layer({ capacity, timeToLive: "1 hour" })),
        Effect.scoped,
      );
    }
    return samples;
  }).pipe(Effect.provideService(References.MinimumLogLevel, "None")),
);

const report = {
  date: new Date().toISOString(),
  bun: Bun.version,
  warmupOperations: 100,
  samples: 7,
  operationsPerSample: 1_000,
  results,
};
for (const result of results) {
  const median = result.millisecondsPerOperation.toSorted((a, b) => a - b)[3];
  console.log(`${result.operation} @ ${result.capacity}: ${median?.toFixed(6)} ms/op`);
}
await Bun.write(
  process.env.BENCHMARK_OUTPUT ?? "/tmp/trygg-resource-benchmark.json",
  JSON.stringify(report, null, 2),
);
