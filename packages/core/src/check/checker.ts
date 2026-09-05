/**
 * Requirement-checking pipeline for plain TypeScript programs.
 *
 * @remarks
 * TypeScript types every JSX expression as the unparameterized `JSX.Element`,
 * which erases the requirement brands carried by `trygg/jsx-runtime` overloads.
 * This module type-checks a project against a custom compiler host that
 * transparently lowers `.tsx` files with `transformTryggJsxForRequirements`,
 * so unsatisfied Effect service requirements surface as ordinary semantic
 * diagnostics (for example, a `mount` call whose argument still carries
 * `ElementWithRequirements<SomeService>` instead of `never`).
 *
 * Diagnostics are reported in ORIGINAL file coordinates. Because the lowering
 * transform reprints entire files, positions are recovered through
 * `LineMap.make`: lines are exact for top-level statement boundaries and
 * reliable elsewhere; columns are best-effort (exact only on lines the
 * transform did not rewrite, otherwise start-of-line).
 *
 * Only diagnostics located inside `rootDir` are reported; errors inside
 * dependencies (including `trygg` itself) are suppressed so consumers see
 * actionable output for their own code.
 *
 * @example
 * ```ts
 * import { checkProject } from "./checker.js"
 *
 * const result = checkProject({ rootDir: process.cwd() })
 * if (result.summary.errors > 0) process.exitCode = 1
 * ```
 *
 * @since 0.5.0
 */
import * as fs from "node:fs";
import * as path from "node:path";
import * as ts from "typescript";
import * as LineMap from "./line-map.js";
import { transformTryggJsxForRequirements } from "../vite/jsx-requirement-transform.js";

/**
 * Severity of a single check diagnostic.
 *
 * @category Check
 * @public
 * @since 0.5.0
 */
export type CheckSeverity = "error" | "warning" | "info";

/**
 * A single diagnostic reported at ORIGINAL source coordinates.
 *
 * @category Check
 * @public
 * @since 0.5.0
 */
export interface CheckDiagnostic {
  /** Absolute path of the original source file. */
  readonly file: string;
  /** 1-based line in the original file. */
  readonly line: number;
  /** 1-based column in the original file; 1 when only line precision exists. */
  readonly column: number;
  /** TypeScript diagnostic code (e.g. `2322`). */
  readonly code: number;
  readonly severity: CheckSeverity;
  /** Flattened human-readable diagnostic message. */
  readonly messageText: string;
}

/**
 * Aggregated result of checking one project.
 *
 * @category Check
 * @public
 * @since 0.5.0
 */
export interface CheckResult {
  /** Deduplicated diagnostics sorted by file, line, then column. */
  readonly diagnostics: ReadonlyArray<CheckDiagnostic>;
  readonly summary: {
    /** Number of root files included from the tsconfig. */
    readonly files: number;
    readonly errors: number;
    readonly warnings: number;
  };
}

/**
 * Options for {@link checkProject}.
 *
 * @category Check
 * @public
 * @since 0.5.0
 */
export interface CheckProjectOptions {
  /** Project directory containing the tsconfig. */
  readonly rootDir: string;
  /** Explicit tsconfig path; defaults to `<rootDir>/tsconfig.json`. */
  readonly tsconfigPath?: string | undefined;
}

interface LoweredSource {
  readonly sourceFile: ts.SourceFile;
  readonly toOriginal: (line: number, column: number) => { line: number; column: number };
}

const severityFor = (category: ts.DiagnosticCategory): CheckSeverity => {
  switch (category) {
    case ts.DiagnosticCategory.Error:
      return "error";
    case ts.DiagnosticCategory.Warning:
      return "warning";
    default:
      return "info";
  }
};

const flatten = (diagnostic: ts.Diagnostic): string =>
  ts.flattenDiagnosticMessageText(diagnostic.messageText, "\n");

/**
 * Type-check a project with Trygg's JSX requirement lowering applied.
 *
 * @remarks
 * Loads `tsconfigPath` (default `<rootDir>/tsconfig.json`), builds a
 * `ts.Program` whose `.tsx` sources are lowered via
 * `transformTryggJsxForRequirements`, and collects config, global, syntactic,
 * semantic, and option diagnostics. Positions are mapped back to the original
 * files. Project-level diagnostics without a source file are reported against
 * the tsconfig. Source diagnostics outside `rootDir` are filtered out and
 * duplicates removed.
 *
 * Limitations: because the transform reprints files, mapped columns fall back
 * to start-of-line whenever the transform rewrote that line.
 *
 * @category Check
 * @public
 * @since 0.5.0
 */
export const checkProject = (options: CheckProjectOptions): CheckResult => {
  const rootDir = path.resolve(options.rootDir);
  const tsconfigPath = path.resolve(options.tsconfigPath ?? path.join(rootDir, "tsconfig.json"));

  const configFile = ts.readConfigFile(tsconfigPath, ts.sys.readFile);
  if (configFile.error !== undefined) {
    return {
      diagnostics: [
        {
          file: tsconfigPath,
          line: 1,
          column: 1,
          code: configFile.error.code,
          severity: "error",
          messageText: flatten(configFile.error),
        },
      ],
      summary: { files: 0, errors: 1, warnings: 0 },
    };
  }

  const parsed = ts.parseJsonConfigFileContent(
    configFile.config,
    ts.sys,
    rootDir,
    undefined,
    tsconfigPath,
  );

  const loweredSources = new Map<string, LoweredSource>();
  const baseHost = ts.createCompilerHost(parsed.options);

  const compilerHost: ts.CompilerHost = {
    ...baseHost,
    getSourceFile(fileName, languageVersionOrOptions, onError, shouldCreateNewSourceFile) {
      const resolved = path.resolve(fileName);
      const cached = loweredSources.get(resolved);
      if (cached !== undefined) {
        return cached.sourceFile;
      }
      const isProjectTsx =
        resolved.endsWith(".tsx") && fs.existsSync(resolved) && !resolved.includes("node_modules");
      if (!isProjectTsx) {
        return baseHost.getSourceFile(
          fileName,
          languageVersionOrOptions,
          onError,
          shouldCreateNewSourceFile,
        );
      }
      const originalText = fs.readFileSync(resolved, "utf8");
      const { code, transformed } = transformTryggJsxForRequirements(originalText, resolved);
      const sourceFile = ts.createSourceFile(
        fileName,
        code,
        languageVersionOrOptions,
        /* setParentNodes */ true,
      );
      loweredSources.set(resolved, {
        sourceFile,
        toOriginal: transformed
          ? LineMap.make(originalText, code, true)
          : (line, column) => ({ line, column }),
      });
      return sourceFile;
    },
  };

  const program = ts.createProgram({
    rootNames: parsed.fileNames,
    options: parsed.options,
    host: compilerHost,
    configFileParsingDiagnostics: parsed.errors,
  });

  const allDiagnostics = [
    ...program.getConfigFileParsingDiagnostics(),
    ...program.getOptionsDiagnostics(),
    ...program.getGlobalDiagnostics(),
    ...program.getSyntacticDiagnostics(),
    ...program.getSemanticDiagnostics(),
  ];

  const seen = new Set<string>();
  const diagnostics: Array<CheckDiagnostic> = [];

  for (const diagnostic of allDiagnostics) {
    const file = diagnostic.file;
    if (file === undefined) {
      const item: CheckDiagnostic = {
        file: tsconfigPath,
        line: 1,
        column: 1,
        code: diagnostic.code,
        severity: severityFor(diagnostic.category),
        messageText: flatten(diagnostic),
      };
      const key = `${item.file}:${item.line}:${item.column}:${item.code}:${item.messageText}`;
      if (!seen.has(key)) {
        seen.add(key);
        diagnostics.push(item);
      }
      continue;
    }
    const resolved = path.resolve(file.fileName);
    if (resolved !== tsconfigPath && !resolved.startsWith(rootDir + path.sep)) {
      continue;
    }
    const lowered = loweredSources.get(resolved);
    const { line, character } = file.getLineAndCharacterOfPosition(diagnostic.start ?? 0);
    const mapped =
      lowered !== undefined
        ? lowered.toOriginal(line + 1, character + 1)
        : { line: line + 1, column: character + 1 };

    const item: CheckDiagnostic = {
      file: resolved,
      line: mapped.line,
      column: mapped.column,
      code: diagnostic.code,
      severity: severityFor(diagnostic.category),
      messageText: flatten(diagnostic),
    };
    const key = `${item.file}:${item.line}:${item.column}:${item.code}:${item.messageText}`;
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    diagnostics.push(item);
  }

  diagnostics.sort((a, b) =>
    a.file === b.file ? a.line - b.line || a.column - b.column : a.file < b.file ? -1 : 1,
  );

  const errors = diagnostics.filter((d) => d.severity === "error").length;
  const warnings = diagnostics.filter((d) => d.severity === "warning").length;

  return {
    diagnostics,
    summary: { files: parsed.fileNames.length, errors, warnings },
  };
};
