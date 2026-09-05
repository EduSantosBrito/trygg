/**
 * Position mapping between original TSX source and Trygg's lowered JSX output.
 *
 * @remarks
 * `transformTryggJsxForRequirements` reprints the whole file through the
 * TypeScript printer: it prepends one runtime-import line, drops blank lines,
 * normalizes indentation, and collapses multi-line JSX into single-line
 * `jsx()` calls. Exact per-character source maps are therefore not available.
 *
 * This module recovers reliable **line** positions by aligning top-level
 * statements between the original and lowered sources. The transform preserves
 * statement count and order (apart from one prepended runtime import), so
 * statements are paired by walking backwards while their syntax kinds match.
 * A diagnostic line is mapped by finding the nearest preceding anchor and
 * applying that anchor's line delta.
 *
 * Columns are best-effort: they are preserved (indentation-compensated) only
 * when the trimmed text of the mapped line is identical in both sources;
 * otherwise they fall back to the start of the line.
 *
 * @internal
 * @since 0.5.0
 */
import * as ts from "typescript";

/** Result of mapping a lowered-file position back to the original source. */
export interface MappedPosition {
  /** 1-based line in the ORIGINAL source file. Always at least 1. */
  readonly line: number;
  /**
   * 1-based column in the original source when it could be recovered exactly,
   * otherwise 1 (start of the mapped line).
   */
  readonly column: number;
}

interface StatementAnchor {
  /** Syntax kind used to verify the pairing across both sources. */
  readonly kind: string;
  /** 1-based line in the respective source. */
  readonly line: number;
}

interface Anchor {
  /** 1-based line in the lowered source. */
  readonly loweredLine: number;
  /** 1-based line in the original source. */
  readonly originalLine: number;
}

const statementAnchors = (
  sourceText: string,
  scriptKind: ts.ScriptKind,
): Array<StatementAnchor> => {
  const sourceFile = ts.createSourceFile(
    "mapping.tsx",
    sourceText,
    ts.ScriptTarget.Latest,
    /* setParentNodes */ false,
    scriptKind,
  );
  return sourceFile.statements.map((statement) => ({
    kind: ts.SyntaxKind[statement.kind],
    line: sourceFile.getLineAndCharacterOfPosition(statement.getStart(sourceFile)).line + 1,
  }));
};

/**
 * Build a position mapper between an original source text and its lowered
 * counterpart produced by `transformTryggJsxForRequirements`.
 *
 * @param originalText - The user-authored TSX/TS source.
 * @param loweredText - The transformed source actually type-checked.
 * @param originalIsTsx - Whether the original file is TSX.
 * @returns A function mapping lowered positions to `MappedPosition`.
 *
 * @internal
 * @since 0.5.0
 */
export const make = (
  originalText: string,
  loweredText: string,
  originalIsTsx: boolean,
): ((line: number, column: number) => MappedPosition) => {
  const originalLines = originalText.split("\n");
  const loweredLines = loweredText.split("\n");
  const originalStatements = statementAnchors(
    originalText,
    originalIsTsx ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  );
  const loweredStatements = statementAnchors(loweredText, ts.ScriptKind.TS);

  // Pair statements from the end while kinds agree. This tolerates the single
  // prepended runtime import and stops at any structural divergence.
  const pairs: Array<Anchor> = [];
  let originalIndex = originalStatements.length - 1;
  let loweredIndex = loweredStatements.length - 1;
  while (originalIndex >= 0 && loweredIndex >= 0) {
    const originalStatement = originalStatements[originalIndex];
    const loweredStatement = loweredStatements[loweredIndex];
    if (
      originalStatement === undefined ||
      loweredStatement === undefined ||
      originalStatement.kind !== loweredStatement.kind
    ) {
      break;
    }
    pairs.push({ loweredLine: loweredStatement.line, originalLine: originalStatement.line });
    originalIndex--;
    loweredIndex--;
  }
  pairs.sort((a, b) => a.loweredLine - b.loweredLine);

  return (line, column) => {
    const clampedLine = Math.max(1, line);

    if (pairs.length === 0) {
      return { line: clampedLine, column: Math.max(1, column) };
    }

    // Nearest anchor at or above the diagnostic line; the first anchor covers
    // leading diagnostics.
    let chosen = pairs[0];
    if (chosen === undefined) {
      return { line: clampedLine, column: Math.max(1, column) };
    }
    for (const pair of pairs) {
      if (pair.loweredLine <= clampedLine) {
        chosen = pair;
      } else {
        break;
      }
    }

    const mappedLine = Math.max(1, clampedLine + (chosen.originalLine - chosen.loweredLine));
    const loweredLine = loweredLines[clampedLine - 1] ?? "";
    const originalLine = originalLines[mappedLine - 1] ?? "";

    // Column is only trustworthy when the transform left the line's content
    // untouched. Compensate for indentation differences introduced by the
    // printer, otherwise fall back to the start of the line.
    if (loweredLine.trim() === originalLine.trim() && loweredLine.trim().length > 0) {
      const indentDelta =
        originalLine.length -
        originalLine.trimStart().length -
        (loweredLine.length - loweredLine.trimStart().length);
      return { line: mappedLine, column: Math.max(1, column + indentDelta) };
    }
    return { line: mappedLine, column: 1 };
  };
};
