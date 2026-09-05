import * as path from "node:path";
import { pathToFileURL } from "node:url";
import {
  DiagnosticSeverity,
  type Diagnostic,
  type DiagnosticRelatedInformation,
  type Range,
} from "vscode-languageserver/node";
import type { CheckDiagnostic, ProviderCandidate } from "./engine.js";

export interface LspAdapterOptions {
  readonly serverCwd: string;
  readonly projectDir: string;
  readonly compact?: boolean;
}

interface ExplicitRelatedLocation {
  readonly message: string;
  readonly file: string;
  readonly line: number;
  readonly column: number;
  readonly endLine?: number;
  readonly endColumn?: number;
}

export type ExtendedCheckDiagnostic = CheckDiagnostic & {
  readonly confidence?: "exact" | "high" | "medium" | "unknown";
  readonly suppressible?: boolean;
  readonly analysisIncomplete?: boolean;
  readonly related?: ReadonlyArray<ExplicitRelatedLocation>;
};

export interface MiniCheckDiagnosticData {
  readonly code: string;
  readonly docsUrl: string;
  readonly provenance?: ExtendedCheckDiagnostic["provenance"];
  readonly candidates?: ReadonlyArray<ProviderCandidate>;
  readonly confidence?: ExtendedCheckDiagnostic["confidence"];
  readonly suppressible?: boolean;
  readonly analysisIncomplete?: boolean;
}

export interface ConvertedDiagnostic {
  readonly uri: string;
  readonly diagnostic: Diagnostic;
}

const isWithin = (parent: string, candidate: string): boolean => {
  const relative = path.relative(parent, candidate);
  return relative === "" || (!relative.startsWith(`..${path.sep}`) && relative !== "..");
};

export const resolveDiagnosticFile = (
  file: string,
  { serverCwd, projectDir }: LspAdapterOptions,
): string => {
  if (path.isAbsolute(file)) return path.normalize(file);

  const cwdCandidate = path.resolve(serverCwd, file);
  const projectCandidate = path.resolve(projectDir, file);
  const cwdCandidateIsInProject = isWithin(projectDir, cwdCandidate);
  const projectCandidateIsInProject = isWithin(projectDir, projectCandidate);

  if (cwdCandidateIsInProject || !projectCandidateIsInProject) return cwdCandidate;
  return projectCandidate;
};

const point = (line: number, column: number) => ({
  line: Math.max(0, line - 1),
  character: Math.max(0, column - 1),
});

export const checkerSpanToRange = (span: {
  readonly line: number;
  readonly column: number;
  readonly endLine?: number;
  readonly endColumn?: number;
}): Range => {
  const start = point(span.line, span.column);
  const end = point(span.endLine ?? span.line, span.endColumn ?? span.column + 1);
  if (end.line < start.line || (end.line === start.line && end.character < start.character)) {
    return { start, end: start };
  }
  return { start, end };
};

export const docsUrlForCode = (code: string): string =>
  `https://trygg.dev/errors/${encodeURIComponent(code)}`;

const location = (
  file: string,
  span: { readonly line: number; readonly column: number; readonly endLine?: number; readonly endColumn?: number },
  options: LspAdapterOptions,
) => ({
  uri: pathToFileURL(resolveDiagnosticFile(file, options)).href,
  range: checkerSpanToRange(span),
});

const derivedRelatedInformation = (
  diagnostic: ExtendedCheckDiagnostic,
  options: LspAdapterOptions,
): DiagnosticRelatedInformation[] | undefined => {
  const provenance = diagnostic.provenance;
  if (!provenance) return undefined;

  const related: DiagnosticRelatedInformation[] = [
    {
      location: location(
        provenance.origin.file,
        { line: provenance.origin.line, column: provenance.origin.column },
        options,
      ),
      message: `Requirement for ${provenance.service} originates in ${provenance.origin.symbol}.`,
    },
    ...provenance.path.map((entry) => ({
      location: location(entry.file, { line: entry.line, column: 1 }, options),
      message: entry.kind === "boundary"
        ? "Propagation reaches the application mount boundary."
        : `Requirement propagates through ${entry.symbol}.`,
    })),
    ...provenance.candidates.map((candidate) => ({
      location: location(candidate.file, { line: candidate.line, column: 1 }, options),
      message:
        `Provider candidate ${candidate.component} (${candidate.lifetime}): ${candidate.rationale}`,
    })),
  ];
  return related;
};

const relatedInformation = (
  diagnostic: ExtendedCheckDiagnostic,
  options: LspAdapterOptions,
): DiagnosticRelatedInformation[] | undefined => {
  const explicit = diagnostic.related && diagnostic.related.length > 0
    ? diagnostic.related
    : diagnostic.relatedLocations;
  if (explicit.length > 0) {
    return explicit.map((related) => ({
      location: location(related.file, related, options),
      message: related.message,
    }));
  }
  return derivedRelatedInformation(diagnostic, options);
};

const compactRelatedInformation = (
  diagnostic: ExtendedCheckDiagnostic,
  options: LspAdapterOptions,
): DiagnosticRelatedInformation[] | undefined => {
  const provenance = diagnostic.provenance;
  if (!provenance) return relatedInformation(diagnostic, options);
  return [{
    location: location(
      provenance.origin.file,
      { line: provenance.origin.line, column: provenance.origin.column },
      options,
    ),
    message: `${provenance.service} is required by ${provenance.origin.symbol}.`,
  }];
};

export const toLspDiagnostic = (
  diagnostic: ExtendedCheckDiagnostic,
  options: LspAdapterOptions,
): ConvertedDiagnostic => {
  const code = diagnostic.tryggCode ?? diagnostic.stableCode ?? `TS${diagnostic.code}`;
  const data: MiniCheckDiagnosticData = {
    code,
    docsUrl: docsUrlForCode(code),
    ...(diagnostic.provenance ? { provenance: diagnostic.provenance } : {}),
    ...(diagnostic.provenance?.candidates
      ? { candidates: diagnostic.provenance.candidates }
      : {}),
    ...(diagnostic.confidence ? { confidence: diagnostic.confidence } : {}),
    ...(diagnostic.suppressible !== undefined ? { suppressible: diagnostic.suppressible } : {}),
    ...(diagnostic.analysisIncomplete !== undefined
      ? { analysisIncomplete: diagnostic.analysisIncomplete }
      : {}),
  };
  const compact = options.compact && code === "TRYGG0001" && diagnostic.provenance;
  const related = compact
    ? compactRelatedInformation(diagnostic, options)
    : relatedInformation(diagnostic, options);

  return {
    uri: pathToFileURL(resolveDiagnosticFile(diagnostic.file, options)).href,
    diagnostic: {
      range: checkerSpanToRange(diagnostic),
      severity: diagnostic.severity === "warning" ? DiagnosticSeverity.Warning : DiagnosticSeverity.Error,
      source: "mini-check",
      code,
      message: compact
        ? `Missing service at application boundary: ${diagnostic.provenance?.service}.`
        : diagnostic.message,
      data,
      ...(related && related.length > 0 ? { relatedInformation: related } : {}),
    },
  };
};

export const groupDiagnosticsByUri = (
  diagnostics: ReadonlyArray<ExtendedCheckDiagnostic>,
  options: LspAdapterOptions,
): Map<string, Diagnostic[]> => {
  const grouped = new Map<string, Diagnostic[]>();
  for (const checkerDiagnostic of diagnostics) {
    const converted = toLspDiagnostic(checkerDiagnostic, options);
    const current = grouped.get(converted.uri);
    if (current) current.push(converted.diagnostic);
    else grouped.set(converted.uri, [converted.diagnostic]);
  }
  return grouped;
};

export const filesRequiringClear = (
  previouslyPublished: Iterable<string>,
  nextDiagnostics: ReadonlyMap<string, ReadonlyArray<Diagnostic>>,
): string[] => [...previouslyPublished].filter((uri) => !nextDiagnostics.has(uri));
