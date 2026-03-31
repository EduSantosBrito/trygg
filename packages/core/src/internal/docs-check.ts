import { Effect } from "effect";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { checkDocsContract } from "./docs-contract.js";

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../../");
const jsonOnly = process.argv.includes("--json");
const touchedFiles = (process.env.TRYGG_DOCS_TOUCHED_FILES ?? "")
  .split("\n")
  .map((value) => value.trim())
  .filter((value) => value.length > 0);

const program = checkDocsContract({ packageRoot, touchedFiles });

const exitCode = await Effect.runPromise(
  program.pipe(
    Effect.match({
      onFailure: (error) => {
        process.stderr.write(`${error.message}\n`);
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
