import { Schema } from "effect";

const Payload = Schema.Struct({
  resourceSpans: Schema.Array(Schema.Struct({
    scopeSpans: Schema.Array(Schema.Struct({
      spans: Schema.Array(Schema.Struct({
        name: Schema.String,
        traceId: Schema.String,
        startTimeUnixNano: Schema.String,
        endTimeUnixNano: Schema.String,
      })),
    })),
  })),
});
const Response = Schema.Struct({
  partialSuccess: Schema.optional(Schema.Struct({
    rejectedSpans: Schema.optional(Schema.Union([Schema.String, Schema.Number])),
    errorMessage: Schema.optional(Schema.String),
  })),
});

export const summarize = (batches: ReadonlyArray<string>) => {
  const durations = new Map<string, Array<number>>();
  const traceIds = new Set<string>();
  for (const body of batches) {
    const payload = Schema.decodeUnknownSync(Schema.fromJsonString(Payload))(body);
    for (const resource of payload.resourceSpans) {
      for (const scope of resource.scopeSpans) {
        for (const span of scope.spans) {
          traceIds.add(span.traceId);
          const ms = Number(BigInt(span.endTimeUnixNano) - BigInt(span.startTimeUnixNano)) / 1e6;
          const samples = durations.get(span.name) ?? [];
          samples.push(ms);
          durations.set(span.name, samples);
        }
      }
    }
  }
  return {
    traceIds: [...traceIds],
    phases: [...durations].map(([name, samples]) => {
      samples.sort((a, b) => a - b);
      return { name, count: samples.length, totalMs: samples.reduce((a, b) => a + b, 0),
        medianMs: samples[Math.floor(samples.length / 2)], p95Ms: samples[Math.floor(samples.length * 0.95)], maxMs: samples.at(-1) };
    }),
  };
};

// Explicit host-only opt-in; never forwards credentials or exposes a listener.
export const exportBatches = async (batches: ReadonlyArray<string>) => {
  const acknowledgments: Array<{ status: number; rejectedSpans: number; errorMessage: string }> = [];
  for (const body of batches) {
    const response = await fetch("http://127.0.0.1:4318/v1/traces", {
      method: "POST", headers: { "Content-Type": "application/json" }, body,
      signal: AbortSignal.timeout(5_000),
    });
    if (!response.ok) throw new Error(`OTLP collector returned HTTP ${response.status}`);
    const result = Schema.decodeUnknownSync(Schema.fromJsonString(Response))(await response.text());
    const rejectedSpans = Number(result.partialSuccess?.rejectedSpans ?? 0);
    const errorMessage = result.partialSuccess?.errorMessage ?? "";
    acknowledgments.push({ status: response.status, rejectedSpans, errorMessage });
    if (rejectedSpans !== 0 || errorMessage !== "") throw new Error("OTLP collector reported partial success");
  }
  return acknowledgments;
};
