import { assert, describe, it } from "@effect/vitest";
import path from "node:path";
import ts from "typescript";

const source = `import { Component } from "trygg";

const Html = Component.gen(function* () {
  return <div vi />;
});

const Svg = Component.gen(function* () {
  return <svg vi />;
});
`;

const completionNamesFor = (tag: "div" | "svg"): ReadonlySet<string> => {
  const root = process.cwd();
  const fileName = path.join(root, "src", "__completion-repro.tsx");
  const files = new Map<string, { readonly version: string; readonly text: string }>([
    [fileName, { version: "0", text: source }],
  ]);
  const options: ts.CompilerOptions = {
    target: ts.ScriptTarget.ES2022,
    module: ts.ModuleKind.ESNext,
    moduleResolution: ts.ModuleResolutionKind.Bundler,
    jsx: ts.JsxEmit.ReactJSX,
    jsxImportSource: "trygg",
    strict: true,
    skipLibCheck: true,
    noEmit: true,
    lib: ["lib.esnext.d.ts", "lib.dom.d.ts", "lib.dom.iterable.d.ts"],
    baseUrl: root,
    paths: {
      trygg: ["src/index.ts"],
      "trygg/jsx-runtime": ["src/jsx-runtime.ts"],
      "trygg/jsx-dev-runtime": ["src/jsx-dev-runtime.ts"],
    },
  };

  const host: ts.LanguageServiceHost = {
    getScriptFileNames: () => [fileName],
    getScriptVersion: (name) => files.get(name)?.version ?? "0",
    getScriptSnapshot: (name) => {
      const virtual = files.get(name)?.text;
      if (virtual !== undefined) return ts.ScriptSnapshot.fromString(virtual);
      if (!ts.sys.fileExists(name)) return undefined;
      return ts.ScriptSnapshot.fromString(ts.sys.readFile(name) ?? "");
    },
    getCurrentDirectory: () => root,
    getCompilationSettings: () => options,
    getDefaultLibFileName: (compilerOptions) => ts.getDefaultLibFilePath(compilerOptions),
    fileExists: ts.sys.fileExists,
    readFile: ts.sys.readFile,
    readDirectory: ts.sys.readDirectory,
    directoryExists: ts.sys.directoryExists,
    getDirectories: ts.sys.getDirectories,
    realpath: (name) => (ts.sys.realpath !== undefined ? ts.sys.realpath(name) : name),
  };

  const service = ts.createLanguageService(host);
  const marker = `<${tag} vi`;
  const position = source.indexOf(marker) + marker.length;
  const completions = service.getCompletionsAtPosition(fileName, position, {});
  return new Set(completions?.entries.map((entry) => entry.name) ?? []);
};

describe("JSX intrinsic completions", () => {
  it("does not offer SVG props on HTML elements", () => {
    const divNames = completionNamesFor("div");
    const svgNames = completionNamesFor("svg");

    assert.isFalse(divNames.has("viewBox"));
    assert.isFalse(divNames.has("strokeWidth"));
    assert.isTrue(svgNames.has("viewBox"));
    assert.isTrue(svgNames.has("strokeWidth"));
  });
});
