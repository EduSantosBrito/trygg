import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { cpus, platform, arch } from "node:os";
import { Effect, Exit, Redacted, Schema } from "effect";
import { MutationPolicy } from "../packages/cli/templates/incident/app/services/authorization.js";

class BenchmarkInvariantError extends Schema.TaggedError<BenchmarkInvariantError>()(
  "BenchmarkInvariantError",
  { message: Schema.String },
) {}

// Public benchmark fixtures, never an application credential.
const token = "benchmark-operator-token-with-32-plus-characters-a";
const wrongToken = "benchmark-operator-token-with-32-plus-characters-b";
const warmup = 200;
const iterations = 1000;
const batches = 7;

const measurements = await Effect.runPromise(
  Effect.scoped(
    Effect.gen(function* () {
      const policy = yield* MutationPolicy;
      const results: Array<{ variant: string; samplesUs: Array<number>; medianUs: number }> = [];
      for (const [variant, value, succeeds] of [
        ["valid", token, true],
        ["invalid-same-length", wrongToken, false],
      ] satisfies Array<[string, string, boolean]>) {
        const request = policy.decide(Redacted.make(value)).pipe(Effect.exit);
        for (let i = 0; i < warmup; i++) yield* request;
        const samplesUs: Array<number> = [];
        for (let batch = 0; batch < batches; batch++) {
          let matched = 0;
          const started = performance.now();
          for (let i = 0; i < iterations; i++) {
            const exit = yield* request;
            if (Exit.isSuccess(exit) === succeeds) matched++;
          }
          samplesUs.push(((performance.now() - started) * 1000) / iterations);
          if (matched !== iterations)
            return yield* new BenchmarkInvariantError({ message: "Authentication result changed" });
        }
        const ordered = samplesUs.toSorted((a, b) => a - b);
        const medianUs = ordered[Math.floor(ordered.length / 2)];
        if (medianUs === undefined)
          return yield* new BenchmarkInvariantError({ message: "Missing median" });
        results.push({ variant, samplesUs, medianUs });
      }
      return results;
    }).pipe(Effect.provide(MutationPolicy.tokenLayer(Redacted.make(token)))),
  ),
);

const files = [
  "scripts/benchmark-incident-auth.ts",
  "packages/cli/templates/incident/app/services/authorization.ts",
  "packages/cli/templates/incident/app/errors/incidents.ts",
  "bun.lock",
];
const hashes = await Promise.all(
  files.map(async (file) => ({
    file,
    sha256: createHash("sha256")
      .update(await readFile(file))
      .digest("hex"),
  })),
);
const report = {
  recordedAt: new Date().toISOString(),
  runtime: Bun.version,
  platform: platform(),
  architecture: arch(),
  cpu: cpus()[0]?.model,
  warmup,
  iterations,
  batches,
  scope:
    "Actual MutationPolicy token verification with native WebCrypto. Layer acquisition excluded; one request at a time. Includes Effect.exit and result classification. No HTTP, repository, DOM, or network. Sequential local samples are not a controlled speedup comparison.",
  hashes,
  measurements,
};
const encode = Schema.encodeSync(Schema.fromJsonString(Schema.Unknown));
process.stdout.write(`${encode(report)}\n`);
