import { Effect, Layer, Option } from "effect";
import { HttpClient, HttpClientResponse } from "effect/unstable/http";
import * as Profiling from "../../packages/core/dist/profiling.js";

declare const __TRYGG_PROFILE_SESSION__: string;

// Test-owned in-memory transport. The host runner exports only after measurement;
// this response acknowledges capture, never collector acceptance or storage.
const batches: Array<string> = [];
const client = HttpClient.make((request) => Effect.sync(() => {
  if (request.body._tag !== "Uint8Array") throw new Error("Expected serialized OTLP bytes");
  batches.push(new TextDecoder().decode(request.body.body));
  return HttpClientResponse.fromWeb(request, new Response("{}"));
}));

export const layer = Profiling.layer({
  url: "https://trygg-benchmark.invalid/v1/traces",
  serviceName: "trygg-granular-profile",
  sessionId: __TRYGG_PROFILE_SESSION__,
  maxSpans: 100_000,
  startPaused: true,
}).pipe(Layer.provide(Layer.succeed(HttpClient.HttpClient, client)));

export const controls = Effect.gen(function* () {
  const found = yield* Effect.serviceOption(Profiling.Session);
  if (Option.isNone(found)) throw new Error("Profiling Session missing from benchmark owner");
  const session = found.value;
  return {
    start: () => Effect.runPromise(session.start),
    stop: () => Effect.runPromise(session.stop),
    collect: () => Effect.runPromise(Effect.gen(function* () {
      yield* session.stop;
      yield* session.flush;
      return { snapshot: yield* session.snapshot, batches: batches.splice(0) };
    })),
  };
});
