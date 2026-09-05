import { afterAll, expect, test } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import * as path from "node:path";
import { Effect } from "effect";
import { checkProject } from "./engine.js";
import { createCheckSession } from "./session.js";

const demoDir = path.resolve(import.meta.dir, "../demo");
const brokenFile = path.resolve(demoDir, "app-broken.tsx");
const brokenText = await Bun.file(brokenFile).text();
const fixedOverlay = brokenText.replace("return <ProfileCard />;", "return <div />;");
const sessions: ReturnType<typeof createCheckSession>[] = [];

const session = () => {
  const value = createCheckSession({ projectDir: demoDir, tsconfigPath: "tsconfig.json" });
  sessions.push(value);
  return value;
};

afterAll(() => {
  for (const value of sessions) value.dispose();
});

test("unsaved overlay changes feed diagnostics and provenance without disk writes", async () => {
  const value = session();
  value.openDocument(brokenFile, brokenText, 1);
  expect((await Effect.runPromise(value.check())).summary.errors).toBe(1);

  value.updateDocument(brokenFile, fixedOverlay, 2);
  expect((await Effect.runPromise(value.check())).summary.errors).toBe(0);
  expect(await Bun.file(brokenFile).text()).toBe(brokenText);
});

test("closing an overlay returns to disk diagnostics", async () => {
  const value = session();
  value.openDocument(brokenFile, fixedOverlay, 1);
  expect((await Effect.runPromise(value.check())).summary.errors).toBe(0);

  value.closeDocument(brokenFile);
  expect((await Effect.runPromise(value.check())).diagnostics[0]?.stableCode).toBe("TRYGG0001");
});

test("stale document versions are ignored", async () => {
  const value = session();
  value.openDocument(brokenFile, brokenText, 2);
  value.updateDocument(brokenFile, fixedOverlay, 2);
  value.updateDocument(brokenFile, fixedOverlay, 1);

  expect((await Effect.runPromise(value.check())).summary.errors).toBe(1);
});

test("multiline mounted JSX retains its exact original source span", async () => {
  const value = session();
  const multiline = brokenText.replace("mount(null, <App />);", "mount(null,\n    <App\n    />,\n  );");
  value.openDocument(brokenFile, multiline, 1);
  const diagnostic = (await Effect.runPromise(value.check())).diagnostics.find(
    (candidate) => candidate.stableCode === "TRYGG0001",
  );

  expect(diagnostic).toMatchObject({ line: 18, column: 5, endLine: 19, endColumn: 7 });
  expect(diagnostic?.sourceLine).toBe("    <App");
});

test("identical checks are cached and invalidation observes disk changes", async () => {
  const tempDir = await mkdtemp("/tmp/opencode/mini-check-session-");
  const appFile = path.join(tempDir, "app.tsx");
  const runtime = path.resolve(import.meta.dir, "../jsx-runtime.js");
  const broken = `import { Element, gen, jsx, mount, RequiresService, UserRepository } from ${JSON.stringify(runtime)};
const App = gen(function* (): Generator<RequiresService<UserRepository>, Element, never> {
  void (yield [new UserRepository()] as never);
  return jsx("div", null);
});
mount(null, <App />);
`;
  const fixed = broken.replace(
    "const App = gen(function* (): Generator<RequiresService<UserRepository>, Element, never> {\n  void (yield [new UserRepository()] as never);",
    "const App = gen(function* () {",
  );
  await writeFile(
    path.join(tempDir, "tsconfig.json"),
    JSON.stringify({
      compilerOptions: {
        target: "es2022",
        module: "preserve",
        moduleResolution: "bundler",
        strict: true,
        noEmit: true,
        skipLibCheck: true,
        jsx: "react-jsx",
        types: [],
      },
      include: ["app.tsx"],
    }),
  );
  await writeFile(appFile, broken);
  const value = createCheckSession({ projectDir: tempDir });
  sessions.push(value);

  const first = await Effect.runPromise(value.check());
  const cached = await Effect.runPromise(value.check());
  expect(cached).toBe(first);
  expect(first.summary.errors).toBe(1);

  await writeFile(appFile, fixed);
  value.invalidateFile(appFile);
  expect((await Effect.runPromise(value.check())).summary.errors).toBe(0);
  await rm(tempDir, { recursive: true, force: true });
});

test("layer inputs and merge semantics remain unresolved", async () => {
  for (const tsconfigPath of [
    "demo/tsconfig.layer-input-broken.json",
    "demo/tsconfig.layer-merge-broken.json",
  ]) {
    const result = await Effect.runPromise(checkProject({ projectDir: "demo", tsconfigPath }));
    expect(result.diagnostics).toHaveLength(1);
    expect(result.diagnostics[0]?.provenance?.service).toBe("HttpClient");
    expect(result.diagnostics[0]?.provenance?.origin.kind).toBe("layer-input");
  }
});

test("imported component graphs report incomplete analysis instead of false-clean", async () => {
  const tempDir = await mkdtemp("/tmp/opencode/mini-check-import-graph-");
  const runtime = path.resolve(import.meta.dir, "../jsx-runtime.js");
  try {
    await writeFile(
      path.join(tempDir, "tsconfig.json"),
      JSON.stringify({
        compilerOptions: {
          target: "es2022",
          module: "preserve",
          moduleResolution: "bundler",
          strict: true,
          noEmit: true,
          skipLibCheck: true,
          jsx: "react-jsx",
          types: [],
        },
        include: ["*.tsx"],
      }),
    );
    await writeFile(
      path.join(tempDir, "child.tsx"),
      `import { Element, gen, jsx, RequiresService, UserRepository } from ${JSON.stringify(runtime)};
export const Child = gen(function* (): Generator<RequiresService<UserRepository>, Element, never> {
  void (yield [new UserRepository()] as never);
  return jsx("div", null);
});
`,
    );
    await writeFile(
      path.join(tempDir, "app.tsx"),
      `import { mount } from ${JSON.stringify(runtime)};
import { Child } from "./child.js";
mount(null, <Child />);
`,
    );

    const result = await Effect.runPromise(checkProject({ projectDir: tempDir }));
    expect(result.diagnostics.some((diagnostic) => diagnostic.stableCode === "TRYGG0901")).toBe(
      true,
    );
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});

test("watcher invalidation refreshes tsconfig membership for new files", async () => {
  const tempDir = await mkdtemp("/tmp/opencode/mini-check-new-file-");
  const runtime = path.resolve(import.meta.dir, "../jsx-runtime.js");
  const appFile = path.join(tempDir, "app.tsx");
  try {
    await writeFile(
      path.join(tempDir, "tsconfig.json"),
      JSON.stringify({
        compilerOptions: {
          target: "es2022",
          module: "preserve",
          moduleResolution: "bundler",
          strict: true,
          noEmit: true,
          skipLibCheck: true,
          jsx: "react-jsx",
          types: [],
        },
        include: ["*.tsx"],
      }),
    );
    const value = createCheckSession({ projectDir: tempDir });
    sessions.push(value);
    expect((await Effect.runPromise(value.check())).summary.filesChecked).toBe(0);

    await writeFile(
      appFile,
      `import { Element, gen, jsx, mount, RequiresService, UserRepository } from ${JSON.stringify(runtime)};
const App = gen(function* (): Generator<RequiresService<UserRepository>, Element, never> {
  void (yield [new UserRepository()] as never);
  return jsx("div", null);
});
mount(null, <App />);
`,
    );
    value.invalidateFile(appFile);
    const result = await Effect.runPromise(value.check());
    expect(result.summary.filesChecked).toBe(1);
    expect(result.diagnostics.some((diagnostic) => diagnostic.stableCode === "TRYGG0001")).toBe(
      true,
    );
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});

test("namespace-imported JSX components report incomplete analysis", async () => {
  const tempDir = await mkdtemp("/tmp/opencode/mini-check-namespace-import-");
  const runtime = path.resolve(import.meta.dir, "../jsx-runtime.js");
  try {
    await writeFile(
      path.join(tempDir, "tsconfig.json"),
      JSON.stringify({
        compilerOptions: {
          target: "es2022",
          module: "preserve",
          moduleResolution: "bundler",
          strict: true,
          noEmit: true,
          skipLibCheck: true,
          jsx: "react-jsx",
          types: [],
        },
        include: ["*.tsx"],
      }),
    );
    await writeFile(
      path.join(tempDir, "child.tsx"),
      `import { Element, gen, jsx, RequiresService, UserRepository } from ${JSON.stringify(runtime)};
export const Child = gen(function* (): Generator<RequiresService<UserRepository>, Element, never> {
  void (yield [new UserRepository()] as never);
  return jsx("div", null);
});
`,
    );
    await writeFile(
      path.join(tempDir, "app.tsx"),
      `import { gen, mount } from ${JSON.stringify(runtime)};
import * as ui from "./child.js";
const App = gen(function* () {
  return <ui.Child />;
});
mount(null, <App />);
`,
    );

    const result = await Effect.runPromise(checkProject({ projectDir: tempDir }));
    expect(result.diagnostics.some((diagnostic) => diagnostic.stableCode === "TRYGG0901")).toBe(
      true,
    );
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});
