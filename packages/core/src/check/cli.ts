#!/usr/bin/env bun
/**
 * CLI entrypoint for `trygg check`.
 *
 * @remarks
 * Runs {@link checkProject} against a project directory and prints tsc-style
 * diagnostics with original source coordinates and carets.
 *
 * Usage:
 * ```
 * bun run packages/core/src/check/cli.ts <projectDir> [--json]
 * ```
 *
 * Exit codes: `0` clean, `1` errors found, `2` usage or internal failure.
 *
 * @internal
 * @since 0.5.0
 */
import * as fs from "node:fs";
import * as path from "node:path";
import { Effect } from "effect";
import { checkProject, type CheckResult } from "./checker.js";

const USAGE = "usage: bun run packages/core/src/check/cli.ts <projectDir> [--json]";

const formatDiagnostic = (diagnostic: CheckResult["diagnostics"][number]): string => {
  const relative = path.relative(process.cwd(), diagnostic.file) || diagnostic.file;
  const header = `${relative}:${diagnostic.line}:${diagnostic.column} - ${diagnostic.severity} TS${diagnostic.code}: ${diagnostic.messageText}`;

  let snippet = "";
  if (fs.existsSync(diagnostic.file)) {
    const lines = fs.readFileSync(diagnostic.file, "utf8").split("\n");
    const sourceLine = lines[diagnostic.line - 1];
    if (sourceLine !== undefined && sourceLine.length <= 200) {
      const caret = `${" ".repeat(Math.max(0, diagnostic.column - 1))}^`;
      snippet = `\n    ${sourceLine.trimStart() || sourceLine}\n    ${caret}`;
    }
  }
  return header + snippet;
};

const main = (): number => {
  const args = process.argv.slice(2).filter((arg) => arg !== "--");
  const json = args.includes("--json");
  const positional = args.filter((arg) => arg !== "--json");

  if (positional.length > 1) {
    console.error(USAGE);
    return 2;
  }

  const projectDir = positional[0] ?? process.cwd();
  if (!fs.existsSync(projectDir)) {
    console.error(`trygg:check: project directory not found: ${projectDir}`);
    return 2;
  }

  const result = checkProject({
    rootDir: path.resolve(projectDir),
    tsconfigPath: undefined,
  });

  if (json) {
    console.log(JSON.stringify(result, null, 2));
  } else {
    for (const diagnostic of result.diagnostics) {
      console.log(formatDiagnostic(diagnostic));
    }
    const { files, errors, warnings } = result.summary;
    console.log(
      errors === 0 && warnings === 0
        ? `No problems found in ${files} file(s).`
        : `Found ${errors} error(s) and ${warnings} warning(s) in ${files} file(s).`,
    );
  }
  return result.summary.errors > 0 ? 1 : 0;
};

const exitCode: number = await Effect.runPromise(
  Effect.try({
    try: main,
    catch: () => ({ detail: "unexpected internal failure" }),
  }).pipe(
    Effect.catch(({ detail }) => {
      console.error("trygg:check: internal failure:", detail);
      return Effect.succeed(2);
    }),
  ),
).catch(() => 2);
process.exitCode = exitCode;
