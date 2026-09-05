import { layer as NodeFileSystemLayer } from "@effect/platform-node/NodeFileSystem";
import { Config, Effect, FileSystem, Layer, Schema, Stream } from "effect";
import * as References from "effect/References";
import { HttpRouter, HttpServerResponse } from "effect/unstable/http";
import type { HandlerFactory } from "../packages/core/src/vite/dev-platform.js";
import { trygg } from "../packages/core/src/vite/plugin.js";

const decodeFactory = Schema.decodeUnknownEffect(
  Schema.Struct({
    makeApiLayer: Schema.declare(
      (value: unknown): value is HandlerFactory["makeApiLayer"] => typeof value === "function",
    ),
    makeWebHandler: Schema.declare(
      (value: unknown): value is HandlerFactory["makeWebHandler"] => typeof value === "function",
    ),
  }),
);

const decodePlugin = Schema.decodeUnknownEffect(
  Schema.Struct({
    buildEnd: Schema.declare(
      (value: unknown): value is (error: Error) => Promise<void> | void =>
        typeof value === "function",
    ),
    resolveId: Schema.declare(
      (value: unknown): value is (id: string) => string | null => typeof value === "function",
    ),
    load: Schema.declare(
      (value: unknown): value is (id: string) => Promise<string | null> =>
        typeof value === "function",
    ),
  }),
);

const report = await Effect.runPromise(
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const plugin = yield* Effect.acquireRelease(
      Effect.sync(() => trygg({ platform: "node", output: "server" })).pipe(
        Effect.flatMap(decodePlugin),
      ),
      (plugin) =>
        Effect.promise(async () => {
          await plugin.buildEnd(new Error("Benchmark complete"));
        }),
    );
    const id = plugin.resolveId("virtual:trygg/handler-factory");
    if (id === null) return yield* Effect.fail(new Error("Handler factory did not resolve"));
    const code = yield* Effect.promise(() => plugin.load(id));
    if (code === null) return yield* Effect.fail(new Error("Handler factory did not load"));
    const directory = yield* fs.makeTempDirectoryScoped({
      directory: process.cwd(),
      prefix: "trygg-benchmark-",
    });
    const modulePath = `${directory}/handler.mjs`;
    yield* fs.writeFileString(modulePath, code);
    const factory = yield* Effect.promise(() => import(modulePath)).pipe(
      Effect.flatMap(decodeFactory),
    );
    const payload = "x".repeat(64);
    const bytes = new TextEncoder().encode(payload);
    let releases = 0;
    let requests = 0;
    const api = yield* factory.makeApiLayer({
      default: Layer.mergeAll(
        Layer.succeed(References.MinimumLogLevel, "None"),
        HttpRouter.add(
          "GET",
          "/api/text",
          Effect.gen(function* () {
            yield* Effect.addFinalizer(() =>
              Effect.sync(() => {
                releases++;
              }),
            );
            return HttpServerResponse.text(payload);
          }),
        ),
        HttpRouter.add(
          "GET",
          "/api/stream",
          Effect.gen(function* () {
            yield* Effect.addFinalizer(() =>
              Effect.sync(() => {
                releases++;
              }),
            );
            return HttpServerResponse.stream(Stream.succeed(bytes));
          }),
        ),
      ),
    });
    const handler = yield* Effect.acquireRelease(
      factory.makeWebHandler(api),
      (handler) => handler.dispose,
    );
    const results: Array<{ operation: string; millisecondsPerOperation: Array<number> }> = [];
    for (const operation of ["text", "stream", "HEAD"]) {
      const request = Effect.promise(async () => {
        requests++;
        const response = await handler.handler(
          new Request(`http://localhost/api/${operation === "text" ? "text" : "stream"}`, {
            method: operation === "HEAD" ? "HEAD" : "GET",
          }),
        );
        const body = await response.text();
        if (response.status !== 200 || body !== (operation === "HEAD" ? "" : payload)) {
          throw new Error("Generated handler response changed");
        }
      });
      for (let index = 0; index < 200; index++) yield* request;
      const millisecondsPerOperation: Array<number> = [];
      for (let sample = 0; sample < 7; sample++) {
        const start = performance.now();
        for (let index = 0; index < 1_000; index++) yield* request;
        millisecondsPerOperation.push((performance.now() - start) / 1_000);
      }
      results.push({ operation, millisecondsPerOperation });
    }
    yield* handler.dispose;
    if (releases !== requests)
      return yield* Effect.fail(new Error(`Request cleanup mismatch: ${releases}/${requests}`));
    return {
      date: new Date().toISOString(),
      bun: Bun.version,
      warmupOperations: 200,
      samples: 7,
      operationsPerSample: 1_000,
      payloadBytes: bytes.byteLength,
      requests,
      releases,
      results,
    };
  }).pipe(Effect.scoped, Effect.provide(NodeFileSystemLayer)),
);

const output = await Effect.runPromise(
  Config.string("BENCHMARK_OUTPUT").pipe(Config.withDefault("/tmp/trygg-dev-api-benchmark.json")),
);
await Bun.write(output, JSON.stringify(report, null, 2));
for (const result of report.results) {
  const median = result.millisecondsPerOperation.toSorted((a, b) => a - b)[3];
  console.log(`${result.operation}: ${median?.toFixed(6)} ms/op`);
}
console.log(`Finalized ${report.releases}/${report.requests} requests`);
