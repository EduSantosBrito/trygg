import { Config, Effect } from "effect";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  DocsContractConfigError,
  DocsContractFileError,
  checkDocsContract,
} from "./docs-contract.js";

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../../");
const jsonOnly = process.argv.includes("--json");
const formatError = (
  error: Config.ConfigError | DocsContractConfigError | DocsContractFileError,
): string => {
  if (error instanceof DocsContractConfigError) {
    return `Docs contract config error: ${error.detail}`;
  }
  if (error instanceof DocsContractFileError) {
    return `Docs contract file error at ${error.path}: ${error.detail}`;
  }
  return "Docs contract config error: unable to read TRYGG_DOCS_TOUCHED_FILES";
};

const program = Effect.gen(function* () {
  const touchedFiles = yield* Config.string("TRYGG_DOCS_TOUCHED_FILES").pipe(
    Config.orElse(() => Config.succeed("")),
    Config.map((value) =>
      value
        .split("\n")
        .map((file) => file.trim())
        .filter((file) => file.length > 0),
    ),
  );

  return yield* checkDocsContract({ packageRoot, touchedFiles });
});

const exitCode = await Effect.runPromise(
  program.pipe(
    Effect.match({
      onFailure: (error) => {
        process.stderr.write(`${formatError(error)}\n`);
        return 1;
      },
      onSuccess: (report) => {
        process.stdout.write(`${jsonOnly ? report.json : report.human}\n`);
        return report.violations.length === 0 ? 0 : 1;
      },
    }),
  ),
);

process.exit(exitCode);
