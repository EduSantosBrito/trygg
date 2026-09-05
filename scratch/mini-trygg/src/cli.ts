#!/usr/bin/env bun
/**
 * MINI-CHECK CLI — no método svelte-check.
 *
 * Contrato:
 * - Saídas: `--output human` (padrão) | `machine` (uma linha por diagnóstico,
 *   para CI/agentes)
 * - `--tsconfig <caminho>` sobrepõe a descoberta automática (travessia
 *   ascendente a partir do diretório do projeto, como o sv check faz)
 * - `--threshold error|warning` filtra o que é exibido
 * - `--fail-on-warnings` transforma warnings em falha
 * - Exit codes: 0 limpo · 1 diagnósticos · 2 uso/configuração/erro interno
 *
 * @module mini-check/cli
 */
import { Data, Effect } from "effect";
import {
  CheckConfigError,
  CheckInternalError,
  checkProject,
  type CheckDiagnostic,
  type CheckResult,
} from "./engine.js";
import { serializeCheckResult } from "./protocol.js";

class UsageError extends Data.TaggedError("UsageError")<{ readonly message: string }> {}

const USAGE = `usage: mini-check [project-directory] [--tsconfig <path>] [--output human|machine|json]
             [--threshold error|warning] [--fail-on-warnings]`;

interface CliArgs {
  readonly projectDir: string;
  readonly tsconfigPath?: string;
  readonly output: "human" | "machine" | "json";
  readonly threshold: "error" | "warning";
  readonly failOnWarnings: boolean;
}

const parseArgs = (): Effect.Effect<CliArgs, UsageError> =>
  Effect.sync(() => process.argv.slice(2)).pipe(
    Effect.flatMap((argv) =>
      Effect.gen(function* () {
        let projectDir = process.cwd();
        let tsconfigPath: string | undefined;
        let output: "human" | "machine" | "json" = "human";
        let threshold: "error" | "warning" = "warning";
        let failOnWarnings = false;

        for (let i = 0; i < argv.length; i++) {
          const arg = argv[i];
          if (arg === "--output") {
            const value = argv[++i];
            if (value !== "human" && value !== "machine" && value !== "json") {
              return yield* new UsageError({ message: `invalid --output: ${value}` });
            }
            output = value;
          } else if (arg === "--tsconfig") {
            tsconfigPath = argv[++i];
          } else if (arg === "--threshold") {
            const value = argv[++i];
            if (value !== "error" && value !== "warning") {
              return yield* new UsageError({ message: `invalid --threshold: ${value}` });
            }
            threshold = value;
          } else if (arg === "--fail-on-warnings") {
            failOnWarnings = true;
          } else if (!arg.startsWith("--")) {
            projectDir = arg;
          } else {
            return yield* new UsageError({ message: `unknown flag: ${arg}` });
          }
        }
        return { projectDir, ...(tsconfigPath ? { tsconfigPath } : {}), output, threshold, failOnWarnings };
      }),
    ),
  );

// ---------------------------------------------------------------------------
// Rendering (rustc-inspired) — color, weight & information hierarchy
// ---------------------------------------------------------------------------

/** ANSI helpers. Auto-disable on non-TTY or NO_COLOR; FORCE_COLOR overrides (CI/LLM-safe piping). */
const colorsEnabled =
  process.env.NO_COLOR === undefined &&
  (process.stdout.isTTY === true || process.env.FORCE_COLOR !== undefined);
const paint =
  (code: string) =>
  (text: string): string =>
    colorsEnabled ? `\x1b[${code}m${text}\x1b[0m` : text;

const style = {
  bold: paint("1"),
  dim: paint("2"),
  red: paint("31"),
  green: paint("32"),
  yellow: paint("33"),
  blue: paint("34"),
  cyan: paint("36"),
};

const renderHuman = (
  diagnostics: ReadonlyArray<CheckDiagnostic>,
  result: CheckResult,
): Effect.Effect<void> =>
  Effect.sync(() => {
    for (const d of diagnostics) {
      const label = d.stableCode;
      const severityWord =
        d.severity === "error"
          ? style.bold(style.red(d.severity))
          : style.bold(style.yellow(d.severity));
      // Hierarchy 1 — the headline: severity + stable code + standalone message
      console.log(`${severityWord}${style.bold(`[${label}]`)}: ${style.bold(d.message)}`);

      // Hierarchy 2 — where: location line
      console.log(
        `  ${style.blue("-->")} ${style.bold(d.file)}${style.dim(`:${d.line}:${d.column}`)}`,
      );

      // Hierarchy 2 — the snippet: numbered gutter, raw source, caret span
      if (d.sourceLine !== undefined) {
        const gutter = String(d.line).length;
        const pad = " ".repeat(gutter);
        const rule = style.blue("|");
        console.log(`${style.blue(pad)} ${rule}`);
        console.log(`${style.bold(style.blue(String(d.line)))} ${rule} ${d.sourceLine.replace(/\r$/, "")}`);
        if (d.endColumn !== undefined && (d.endLine ?? d.line) === d.line) {
          const width = Math.max(1, d.endColumn - d.column);
          const caret = style.red("^".repeat(width));
          console.log(`${pad} ${rule} ${" ".repeat(Math.max(0, d.column - 1))}${caret}`);
          console.log(`${pad} ${rule}`);
        }
      }

      if (d.provenance) {
        const provenance = d.provenance;
        const originKind = provenance.origin.kind === "component" ? "component" : "layer";
        console.log(
          `\n${style.bold("required by:")} ${originKind} ${style.bold(provenance.origin.symbol)} requires ${style.bold(provenance.service)} at ${provenance.origin.file}:${provenance.origin.line}:${provenance.origin.column}`,
        );
        console.log(
          `${style.bold("propagated through:")} ${provenance.path.map((entry) => entry.symbol).join(" -> ")}`,
        );
        console.log(`${style.bold("valid provider scopes:")}`);
        for (const candidate of provenance.candidates) {
          console.log(
            `  ${style.cyan(candidate.lifetime.padEnd(20))} ${style.bold(candidate.component)} (${candidate.file}:${candidate.line}) - ${candidate.rationale}`,
          );
        }
        console.log(
          `${style.cyan("note:")} Provider ownership cannot be inferred from types alone; choose a scope based on the intended lifecycle.`,
        );
      }

      // Hierarchy 3 — how to fix: actionable, highlighted
      if (d.tryggCode !== "TRYGG0001" && d.hint) {
        console.log(`\n${style.bold(style.green("help:"))} ${d.hint}`);
      }
      if (d.tryggCode !== "TRYGG0001" && d.fix) {
        const gutter = String(d.line).length;
        const pad = " ".repeat(gutter);
        const rule = style.blue("|");
        console.log(`${style.blue(pad)} ${rule}`);
        console.log(
          `${style.bold(style.blue(String(d.line)))} ${rule} ${style.red("-")} ${style.red(d.fix.before.trimStart())}`,
        );
        console.log(`${pad} ${rule} ${style.green("+")} ${style.green(d.fix.after.trimStart())}`);
        console.log(`${pad} ${rule}`);
      }
      // Layering is free above the boundary — show where else it can live.
      for (const alt of d.tryggCode === "TRYGG0001" ? [] : d.alternatives ?? []) {
        console.log(`${style.dim("     · or:")} ${alt.replaceAll("\n", "\n           ")}`);
      }

      if (d.boundaryNote) {
        console.log(`${style.cyan("note:")} ${d.boundaryNote}`);
      }

      // Hierarchy 4 — audit trail: compiler detail, deliberately quiet
      if (d.technicalMessage) {
        console.log(
          `${style.cyan("note:")} ${style.dim(`compiler detail — ${d.technicalMessage.replaceAll("\n", "\n      ")}`)}`,
        );
      }

      // Hierarchy 4 — further reading
      if (d.tryggCode) console.log(`${style.dim(`docs: https://trygg.dev/errors/${d.tryggCode}`)}\n`);
    }

    // Summary — weight signals outcome at a glance
    const parts = [
      style.bold(`${result.summary.filesChecked} file(s) checked`),
      result.summary.errors > 0
        ? style.red(style.bold(`${result.summary.errors} error(s)`))
        : `${result.summary.errors} error(s)`,
      result.summary.warnings > 0
        ? style.yellow(`${result.summary.warnings} warning(s)`)
        : `${result.summary.warnings} warning(s)`,
    ];
    console.log(`Result: ${parts.join(style.dim(" · "))}`);
  });

const renderJson = (
  diagnostics: ReadonlyArray<CheckDiagnostic>,
  result: CheckResult,
): Effect.Effect<void> =>
  Effect.sync(() => {
    console.log(JSON.stringify(serializeCheckResult(result, diagnostics), null, 2));
  });

const renderMachine = (diagnostics: ReadonlyArray<CheckDiagnostic>): Effect.Effect<void> =>
  Effect.sync(() => {
    for (const d of diagnostics) {
      console.log(
        `${d.severity.toUpperCase()} "${d.file}" ${d.line} ${d.column} ${JSON.stringify({
          code: d.stableCode,
          message: d.message,
          confidence: d.confidence,
          analysisIncomplete: d.analysisIncomplete,
          ...(d.hint ? { help: d.hint } : {}),
        })}`,
      );
    }
  });

// ---------------------------------------------------------------------------
// Programa principal
// ---------------------------------------------------------------------------

const program: Effect.Effect<number, UsageError | CheckConfigError | CheckInternalError> =
  Effect.gen(function* () {
    const args = yield* parseArgs();

    const result = yield* checkProject({
      projectDir: args.projectDir,
      ...(args.tsconfigPath ? { tsconfigPath: args.tsconfigPath } : {}),
    });

    const visible =
      args.threshold === "error"
        ? result.diagnostics.filter((d) => d.severity === "error")
        : result.diagnostics;

    yield* args.output === "json"
      ? renderJson(visible, result)
      : args.output === "machine"
        ? renderMachine(visible)
        : renderHuman(visible, result);

    if (args.failOnWarnings && result.summary.warnings > 0) return 1;
    return result.summary.errors > 0 ? 1 : 0;
  });

if (import.meta.main) {
  const exitCode = await program.pipe(
    Effect.catch((error) =>
      Effect.sync(() => {
        if (error._tag === "UsageError") {
          console.error(error.message);
          console.error(USAGE);
        } else if (error._tag === "CheckConfigError") {
          console.error(`mini-check: configuration error: ${error.message}`);
        } else {
          console.error("mini-check: internal error:", error.cause);
        }
        return 2;
      }),
    ),
    Effect.runPromise,
  );
  process.exit(exitCode);
}
