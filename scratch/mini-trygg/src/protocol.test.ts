import { expect, test } from "bun:test";
import { Effect } from "effect";
import { checkProject } from "./engine.js";
import { schema, serializeCheckResult } from "./protocol.js";

test("protocol serialization preserves provenance and diagnostic metadata", async () => {
  const result = await Effect.runPromise(
    checkProject({ projectDir: "demo", tsconfigPath: "demo/tsconfig.json" }),
  );
  const report = serializeCheckResult(result);
  const roundTrip = JSON.parse(JSON.stringify(report));
  const diagnostic = roundTrip.diagnostics[0];

  expect(roundTrip.schema).toBe(schema);
  expect(diagnostic.code).toBe("TRYGG0001");
  expect(diagnostic.confidence).toBe("exact");
  expect(diagnostic.suppressible).toBe(false);
  expect(diagnostic.analysisIncomplete).toBe(false);
  expect(diagnostic.provenance.origin.symbol).toBe("ProfileCard");
  expect(diagnostic.provenance.candidates.length).toBeGreaterThan(0);
  expect(diagnostic.relatedLocations.map((location: { kind: string }) => location.kind)).toContain(
    "origin",
  );
  expect(diagnostic.relatedLocations.map((location: { kind: string }) => location.kind)).toContain(
    "component-path",
  );
  expect(diagnostic.relatedLocations.map((location: { kind: string }) => location.kind)).toContain(
    "candidate",
  );
});
