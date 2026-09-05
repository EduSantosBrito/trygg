import { describe, expect, test } from "bun:test";
import { DiagnosticSeverity } from "vscode-languageserver/node";
import {
  checkerSpanToRange,
  filesRequiringClear,
  groupDiagnosticsByUri,
  resolveDiagnosticFile,
  toLspDiagnostic,
  type ExtendedCheckDiagnostic,
} from "./lsp-adapter.js";

const options = {
  serverCwd: "/work/mini-check",
  projectDir: "/work/mini-check/demo",
};

const diagnostic: ExtendedCheckDiagnostic = {
  file: "demo/app-broken.tsx",
  line: 17,
  column: 15,
  endLine: 17,
  endColumn: 22,
  code: 2345,
  stableCode: "TRYGG0001",
  tryggCode: "TRYGG0001",
  severity: "error",
  message: "Application boundary has an unsatisfied service requirement: UserRepository.",
  confidence: "exact",
  suppressible: false,
  analysisIncomplete: false,
  relatedLocations: [],
  provenance: {
    service: "UserRepository",
    origin: {
      kind: "component",
      symbol: "ProfileCard",
      file: "demo/app-broken.tsx",
      line: 3,
      column: 61,
    },
    path: [
      { kind: "component", symbol: "ProfileCard", file: "demo/app-broken.tsx", line: 3 },
      { kind: "component", symbol: "App", file: "demo/app-broken.tsx", line: 12 },
      { kind: "boundary", symbol: "mount", file: "demo/app-broken.tsx", line: 17 },
    ],
    candidates: [
      {
        component: "ProfileCard",
        file: "demo/app-broken.tsx",
        line: 3,
        lifetime: "per-mounted-instance",
        rationale: "Limits the provider to each mounted instance.",
      },
    ],
  },
};

describe("LSP diagnostic adapter", () => {
  test("converts one-based checker spans to zero-based LSP ranges", () => {
    expect(checkerSpanToRange({ line: 2, column: 3, endLine: 4, endColumn: 5 })).toEqual({
      start: { line: 1, character: 2 },
      end: { line: 3, character: 4 },
    });
  });

  test("resolves cwd-relative and project-relative checker paths", () => {
    expect(resolveDiagnosticFile("demo/app.tsx", options)).toBe("/work/mini-check/demo/app.tsx");
    expect(resolveDiagnosticFile("app.tsx", options)).toBe("/work/mini-check/demo/app.tsx");
    expect(resolveDiagnosticFile("/other/app.tsx", options)).toBe("/other/app.tsx");
  });

  test("maps TRYGG diagnostics with provenance and candidate information", () => {
    const converted = toLspDiagnostic(diagnostic, options);
    expect(converted.uri).toBe("file:///work/mini-check/demo/app-broken.tsx");
    expect(converted.diagnostic).toMatchObject({
      code: "TRYGG0001",
      source: "mini-check",
      severity: DiagnosticSeverity.Error,
      range: {
        start: { line: 16, character: 14 },
        end: { line: 16, character: 21 },
      },
      data: {
        code: "TRYGG0001",
        confidence: "exact",
        suppressible: false,
        analysisIncomplete: false,
      },
    });
    expect(converted.diagnostic.relatedInformation?.map((related) => related.message)).toEqual([
      "Requirement for UserRepository originates in ProfileCard.",
      "Requirement propagates through ProfileCard.",
      "Requirement propagates through App.",
      "Propagation reaches the application mount boundary.",
      "Provider candidate ProfileCard (per-mounted-instance): Limits the provider to each mounted instance.",
    ]);
    expect((converted.diagnostic.data as { candidates: unknown[] }).candidates).toHaveLength(1);
  });

  test("prefers explicit related information over provenance-derived locations", () => {
    const converted = toLspDiagnostic(
      {
        ...diagnostic,
        related: [
          {
            message: "Explicit origin",
            file: "app-broken.tsx",
            line: 3,
            column: 1,
          },
        ],
      },
      options,
    );
    expect(converted.diagnostic.relatedInformation).toHaveLength(1);
    expect(converted.diagnostic.relatedInformation?.[0]?.message).toBe("Explicit origin");
  });

  test("uses a compact TRYGG0001 presentation for clients with constrained hovers", () => {
    const converted = toLspDiagnostic(diagnostic, { ...options, compact: true });
    expect(converted.diagnostic.message).toBe(
      "Missing service at application boundary: UserRepository.",
    );
    expect(converted.diagnostic.relatedInformation?.map((related) => related.message)).toEqual([
      "UserRepository is required by ProfileCard.",
    ]);
    expect((converted.diagnostic.data as { provenance?: unknown }).provenance).toBeDefined();
  });

  test("groups diagnostics and identifies files that need clearing", () => {
    const grouped = groupDiagnosticsByUri([diagnostic, { ...diagnostic, message: "second" }], options);
    expect(grouped.get("file:///work/mini-check/demo/app-broken.tsx")).toHaveLength(2);
    expect(filesRequiringClear(["file:///old.tsx", ...grouped.keys()], grouped)).toEqual([
      "file:///old.tsx",
    ]);
  });

  test("uses TS-prefixed codes for TypeScript diagnostics", () => {
    const converted = toLspDiagnostic(
      { ...diagnostic, tryggCode: undefined, stableCode: "TS2345" },
      options,
    );
    expect(converted.diagnostic.code).toBe("TS2345");
    expect((converted.diagnostic.data as { code: string }).code).toBe("TS2345");
  });
});
