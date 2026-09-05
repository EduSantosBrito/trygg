import * as fs from "node:fs";
import * as path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { afterAll, assert, describe, it } from "@effect/vitest";
import { Schema } from "effect";
import { checkProject } from "../checker";

const coreDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const repoDir = path.resolve(coreDir, "../..");
const coreSrcDir = path.join(coreDir, "src");
const checkerCliPath = path.join(coreSrcDir, "check", "cli.ts");
const decodeCliOutput = Schema.decodeUnknownSync(
  Schema.fromJsonString(
    Schema.Struct({
      diagnostics: Schema.Array(Schema.Struct({ code: Schema.Number })),
    }),
  ),
);

const scratchRoot = path.join(repoDir, ".tmp-check-fixtures");
let liveScratchDir: string | undefined;
const writeFixture = (files: Record<string, string>): string => {
  if (liveScratchDir !== undefined) {
    fs.rmSync(liveScratchDir, { recursive: true, force: true });
    liveScratchDir = undefined;
  }
  fs.mkdirSync(scratchRoot, { recursive: true });
  const dir = fs.mkdtempSync(path.join(scratchRoot, "project-"));
  for (const [name, contents] of Object.entries(files)) {
    const filePath = path.join(dir, name);
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, contents);
  }
  return dir;
};

afterAll(() => fs.rmSync(scratchRoot, { recursive: true, force: true }));

const tsconfigFor = (): string =>
  JSON.stringify({
    compilerOptions: {
      strict: true,
      target: "ES2022",
      module: "Preserve",
      moduleResolution: "bundler",
      jsx: "react-jsx",
      jsxImportSource: "trygg",
      lib: ["ESNext", "DOM"],
      noEmit: true,
      skipLibCheck: true,
      types: [],
      paths: {
        trygg: [path.join(coreSrcDir, "index.ts")],
        "trygg/jsx-runtime": [path.join(coreSrcDir, "jsx-runtime.ts")],
      },
    },
    include: ["**/*.ts", "**/*.tsx"],
  });

describe("checkProject", () => {
  it("reports unsatisfied service requirements at original coordinates", () => {
    const dir = writeFixture({
      "tsconfig.json": tsconfigFor(),
      "app.tsx": `import { Context } from "effect";
import { Component, mount } from "trygg";

class ThemeStore extends Context.Service<ThemeStore, { readonly value: string }>()("check/ThemeStore") {}

export const ThemedView = Component.gen(function* () {
  const theme = yield* ThemeStore;
  return <p>{theme.value}</p>;
});

declare const root: HTMLElement;

mount(root, <ThemedView />);
`,
    });
    liveScratchDir = dir;

    const result = checkProject({ rootDir: dir });

    assert.ok(result.summary.errors >= 1);
    const requirementErrors = result.diagnostics.filter((d) =>
      d.messageText.includes("ThemeStore"),
    );
    assert.ok(requirementErrors.length >= 1);
    assert.equal(requirementErrors[0]?.file, path.join(dir, "app.tsx"));
    // The mount call is on line 13 of the ORIGINAL file.
    assert.equal(requirementErrors[0]?.line, 13);
  });

  it("reports no errors when requirements are provided via Component.provide", () => {
    const dir = writeFixture({
      "tsconfig.json": tsconfigFor(),
      "app.tsx": `import { Context, Layer } from "effect";
import { Component, mount } from "trygg";

class ThemeStore extends Context.Service<ThemeStore, { readonly value: string }>()("check/ThemeStore") {}

export const ThemedView = Component.gen(function* () {
  const theme = yield* ThemeStore;
  return <p>{theme.value}</p>;
});

const ThemeLive = Layer.succeed(ThemeStore, { value: "dark" });
const ProvidedView = ThemedView.pipe(Component.provide(ThemeLive));

declare const root: HTMLElement;

mount(root, <ProvidedView />);
`,
    });
    liveScratchDir = dir;

    const result = checkProject({ rootDir: dir });

    assert.deepEqual(result.diagnostics, []);
    assert.equal(result.summary.errors, 0);
  });

  it("reports plain syntax errors at exact original positions", () => {
    const dir = writeFixture({
      "tsconfig.json": tsconfigFor(),
      "broken.ts": `export const ok = 1;

const broken: number = ;
`,
    });
    liveScratchDir = dir;

    const result = checkProject({ rootDir: dir });

    assert.ok(result.summary.errors >= 1);
    const syntaxError = result.diagnostics.find((d) => d.file === path.join(dir, "broken.ts"));
    assert.equal(syntaxError?.line, 3);
    assert.ok((syntaxError?.column ?? 0) > 1);
  });

  it("reports invalid compiler options as project diagnostics", () => {
    // Scope: covers config diagnostics that TypeScript does not attach to a source file.
    // Assertion: invalid target configuration fails the project at the tsconfig path.
    const dir = writeFixture({
      "tsconfig.json": tsconfigFor().replace('"ES2022"', '"NOT_A_TARGET"'),
      "app.ts": "export const value = 1;",
    });
    liveScratchDir = dir;

    const result = checkProject({ rootDir: dir });
    const targetError = result.diagnostics.find((diagnostic) => diagnostic.code === 6046);

    assert.equal(targetError?.file, path.join(dir, "tsconfig.json"));
    assert.ok(result.summary.errors >= 1);
  });

  it("reports a tsconfig that selects no input files", () => {
    // Scope: covers semantic config parsing diagnostics before Program source checking.
    // Assertion: TS18003 is retained as a project error instead of producing a green result.
    const dir = writeFixture({
      "tsconfig.json": JSON.stringify({
        compilerOptions: { noEmit: true },
        include: ["missing/**/*.ts"],
      }),
    });
    liveScratchDir = dir;

    const result = checkProject({ rootDir: dir });
    const noInputs = result.diagnostics.find((diagnostic) => diagnostic.code === 18003);

    assert.equal(noInputs?.file, path.join(dir, "tsconfig.json"));
    assert.equal(noInputs?.line, 1);
    assert.ok(result.summary.errors >= 1);
  });

  it("reports global diagnostics at the project location", () => {
    // Scope: covers Program diagnostics that have no source-file coordinates.
    // Assertion: missing global types are surfaced against tsconfig and counted as errors.
    const dir = writeFixture({
      "tsconfig.json": JSON.stringify({
        compilerOptions: { noEmit: true, noLib: true, types: [] },
        files: ["app.ts"],
      }),
      "app.ts": "export const value = 1;",
    });
    liveScratchDir = dir;

    const result = checkProject({ rootDir: dir });
    const globalError = result.diagnostics.find((diagnostic) => diagnostic.code === 2318);

    assert.equal(globalError?.file, path.join(dir, "tsconfig.json"));
    assert.ok(result.summary.errors >= 1);
  });

  it("exits 1 through the real CLI for every TypeScript diagnostic phase", () => {
    // Scope: covers checker failures across the Bun process boundary used by `trygg:check`.
    // Assertion: syntactic, semantic, config, zero-input, and global errors produce JSON status 1.
    const cases = [
      {
        code: 1109,
        files: {
          "tsconfig.json": tsconfigFor(),
          "broken.ts": "export const value: number = ;",
        },
      },
      {
        code: 2322,
        files: {
          "tsconfig.json": tsconfigFor(),
          "app.ts": "export const value: string = 1;",
        },
      },
      {
        code: 6046,
        files: {
          "tsconfig.json": tsconfigFor().replace('"ES2022"', '"NOT_A_TARGET"'),
          "app.ts": "export const value = 1;",
        },
      },
      {
        code: 18003,
        files: {
          "tsconfig.json": JSON.stringify({
            compilerOptions: { noEmit: true },
            include: ["missing/**/*.ts"],
          }),
        },
      },
      {
        code: 2318,
        files: {
          "tsconfig.json": JSON.stringify({
            compilerOptions: { noEmit: true, noLib: true, types: [] },
            files: ["app.ts"],
          }),
          "app.ts": "export const value = 1;",
        },
      },
    ];

    for (const testCase of cases) {
      const dir = writeFixture(testCase.files);
      liveScratchDir = dir;
      const processResult = spawnSync("bun", [checkerCliPath, dir, "--json"], {
        encoding: "utf8",
      });

      assert.equal(processResult.status, 1, processResult.stderr);
      const output = decodeCliOutput(processResult.stdout);
      assert.isTrue(output.diagnostics.some((diagnostic) => diagnostic.code === testCase.code));
    }
  }, 15_000);
});
