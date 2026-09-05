import assert from "node:assert/strict";
import { gcAndSweep, heapStats } from "bun:jsc";
import { Config, Effect, Option, Schema } from "effect";
import * as References from "effect/References";
import {
  makeNavigationActivation,
  RouteActivation,
} from "../packages/core/src/router/route-activation.js";

const report = await Effect.runPromise(
  Effect.gen(function* () {
    const mode = yield* Config.string("ACTIVATION_MODE").pipe(
      Config.withDefault("navigation"),
      Effect.flatMap(Schema.decodeUnknownEffect(Schema.Literals(["opaque", "navigation"]))),
    );
    const activation = yield* mode === "opaque"
      ? RouteActivation.make()
      : makeNavigationActivation();
    const samples: Array<{
      readonly claims: number;
      readonly heapBytes: number;
      readonly strings: number;
      readonly objects: number;
    }> = [];
    let claims = 0;
    for (const target of [1_000, 11_000, 31_000, 61_000, 101_000]) {
      while (claims < target) {
        claims++;
        // Gaps exercise coalesced navigations; interval compression would still grow here.
        const navigationId = claims * 2;
        yield* activation.claim({
          activationId: `navigation-${navigationId}`,
          path: "/page",
          query: new URLSearchParams(),
          scrollIntent: Option.some({
            navigationId,
            isPopstate: false,
            hash: "",
            scrollKey: "key",
          }),
        });
      }
      // Let the dispatcher finish pending span callbacks before collecting garbage.
      yield* Effect.promise(() => new Promise<void>((resolve) => setImmediate(resolve)));
      gcAndSweep();
      const stats = heapStats();
      samples.push({
        claims,
        heapBytes: stats.heapSize,
        strings: stats.objectTypeCounts.string ?? 0,
        objects: stats.objectCount,
      });
      assert.deepEqual(
        yield* activation.currentActivationId,
        Option.some(`navigation-${claims * 2}`),
      );
    }
    let staleWork = 0;
    const stale = yield* Effect.exit(
      activation.runWhileCurrent(
        "navigation-2",
        Effect.sync(() => {
          staleWork++;
        }),
      ),
    );
    assert.equal(stale._tag, "Failure");
    assert.equal(staleWork, 0);
    return { date: new Date().toISOString(), bun: Bun.version, mode, samples };
  }).pipe(Effect.provideService(References.MinimumLogLevel, "None")),
);

const output = await Effect.runPromise(
  Config.string("BENCHMARK_OUTPUT").pipe(Config.withDefault("/tmp/trygg-activation-memory.json")),
);
await Bun.write(output, JSON.stringify(report, null, 2));
for (const sample of report.samples) console.log(JSON.stringify(sample));
