import type {
  CheckDiagnostic,
  CheckResult,
  DiagnosticConfidence,
  RelatedLocation,
  RequirementProvenance,
} from "./engine.js";

export const schema = "mini-check/v1" as const;
export const MINI_CHECK_SCHEMA = schema;

export interface ProtocolPosition {
  readonly line: number;
  readonly column: number;
}

export interface ProtocolSpan {
  readonly start: ProtocolPosition;
  readonly end: ProtocolPosition;
}

export interface ProtocolFix {
  readonly description: string;
  readonly before: string;
  readonly after: string;
  readonly applicability: "automatic" | "review" | "required-none";
  /** Kept for consumers of the original mini-check/v1 JSON shape. */
  readonly applicable: boolean;
}

export interface ProtocolDiagnostic {
  readonly code: string;
  readonly tsCode: number;
  readonly severity: CheckDiagnostic["severity"];
  readonly confidence: DiagnosticConfidence;
  readonly suppressible: boolean;
  readonly analysisIncomplete: boolean;
  readonly file: string;
  readonly span: ProtocolSpan;
  readonly message: string;
  readonly relatedLocations: ReadonlyArray<RelatedLocation>;
  readonly provenance?: RequirementProvenance;
  readonly sourceLine?: string;
  readonly help?: string;
  readonly boundaryNote?: string;
  readonly suggestedFix?: ProtocolFix;
  readonly alternativeStrategies?: ReadonlyArray<string>;
  readonly technical?: string;
  readonly docs?: string;
}

export interface MiniCheckReport {
  readonly schema: typeof schema;
  readonly summary: CheckResult["summary"];
  readonly diagnostics: ReadonlyArray<ProtocolDiagnostic>;
}

/** Canonical conversion used by JSON, machine, and editor integrations. */
export const serializeCheckResult = (
  result: CheckResult,
  diagnostics: ReadonlyArray<CheckDiagnostic> = result.diagnostics,
): MiniCheckReport => ({
  schema,
  summary: result.summary,
  diagnostics: diagnostics.map((diagnostic): ProtocolDiagnostic => ({
    code: diagnostic.stableCode,
    tsCode: diagnostic.code,
    severity: diagnostic.severity,
    confidence: diagnostic.confidence,
    suppressible: diagnostic.suppressible,
    analysisIncomplete: diagnostic.analysisIncomplete,
    file: diagnostic.file,
    span: {
      start: { line: diagnostic.line, column: diagnostic.column },
      end: {
        line: diagnostic.endLine ?? diagnostic.line,
        column: diagnostic.endColumn ?? diagnostic.column,
      },
    },
    message: diagnostic.message,
    relatedLocations: diagnostic.relatedLocations,
    ...(diagnostic.provenance ? { provenance: diagnostic.provenance } : {}),
    ...(diagnostic.sourceLine !== undefined ? { sourceLine: diagnostic.sourceLine } : {}),
    ...(diagnostic.hint ? { help: diagnostic.hint } : {}),
    ...(diagnostic.boundaryNote ? { boundaryNote: diagnostic.boundaryNote } : {}),
    ...(diagnostic.fix
      ? {
          suggestedFix: {
            description: diagnostic.fix.description,
            before: diagnostic.fix.before,
            after: diagnostic.fix.after,
            applicability: diagnostic.fix.applicability ?? "review",
            applicable: diagnostic.fix.applicability === "automatic",
          },
        }
      : {}),
    ...(diagnostic.alternatives ? { alternativeStrategies: diagnostic.alternatives } : {}),
    ...(diagnostic.technicalMessage ? { technical: diagnostic.technicalMessage } : {}),
    ...(diagnostic.tryggCode
      ? { docs: `https://trygg.dev/errors/${diagnostic.tryggCode}` }
      : {}),
  })),
});
