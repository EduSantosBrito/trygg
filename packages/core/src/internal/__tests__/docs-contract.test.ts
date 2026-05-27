import { layer as NodeFileSystemLayer } from "@effect/platform-node/NodeFileSystem";
import { assert, describe, it } from "@effect/vitest";
import { Effect, FileSystem, Predicate } from "effect";
import { readFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { checkDocsContract } from "../docs-contract.js";

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../../../");

const fixturePackageJson = JSON.stringify(
  {
    name: "trygg-docs-fixture",
    type: "module",
    exports: {
      ".": {
        types: "./dist/index.d.ts",
        import: "./dist/index.js",
      },
    },
  },
  null,
  2,
);

const fixtureDocsContract = JSON.stringify(
  {
    allowedTags: ["category", "example", "internal", "module", "public", "remarks", "see", "since"],
    sidecarHeadings: ["When to use", "Behavior", "Related exports"],
    categories: [{ name: "Fixtures", ownerModule: "src/owner.ts", requiresSidecar: true }],
    migratedOwners: [
      {
        topic: "Fixture",
        category: "Fixtures",
        entrypoint: ".",
        module: "src/owner.ts",
        primaryExport: "thing",
        primaryKind: "named",
        memberExports: [],
        namedExports: [],
        sidecar: "src/owner.docs.md",
      },
    ],
  },
  null,
  2,
);

const fixtureDocsContractWrongOwnerModule = fixtureDocsContract.replace(
  '"ownerModule": "src/owner.ts"',
  '"ownerModule": "src/not-owner.ts"',
);

const fixtureDocsContractWithMemberExports = [
  "{",
  '  "allowedTags": ["category", "example", "internal", "module", "public", "remarks", "see", "since"],',
  '  "sidecarHeadings": ["When to use", "Behavior", "Related exports"],',
  '  "categories": [{ "name": "Fixtures", "ownerModule": "src/owner.ts", "requiresSidecar": true }],',
  '  "migratedOwners": [',
  "    {",
  '      "topic": "Fixture",',
  '      "category": "Fixtures",',
  '      "entrypoint": ".",',
  '      "module": "src/owner.ts",',
  '      "primaryExport": "thing",',
  '      "primaryKind": "named",',
  '      "memberExports": ["helper"],',
  '      "namedExports": [],',
  '      "sidecar": "src/owner.docs.md"',
  "    }",
  "  ]",
  "}",
].join("\n");

const fixtureSidecar = [
  "# Fixture",
  "",
  "## When to use",
  "",
  "Use the fixture export in tests.",
  "",
  "## Behavior",
  "",
  "The fixture models one migrated owner module.",
  "",
  "## Related exports",
  "",
  "- `thing`",
  "",
].join("\n");

const validOwnerSource = [
  "/**",
  " * Fixture owner module.",
  " *",
  " * @remarks",
  " * Owns the migrated fixture surface.",
  " *",
  " * @see ./owner.docs.md - Source-owned topic guide",
  " * @module trygg",
  " */",
  "",
  "/**",
  " * Fixture value.",
  " *",
  " * @remarks",
  " * `thing` is the migrated surface under test.",
  " *",
  " * @example",
  " * ```ts",
  " * const value = thing",
  " * ```",
  " *",
  " * @category Fixtures",
  " * @public",
  " * @since 1.0.0",
  " */",
  'export const thing = "ok";',
  "",
].join("\n");

const makeTempPackage = Effect.fn("DocsContractTest.makeTempPackage")(function* (
  files: Record<string, string>,
) {
  const fs = yield* FileSystem.FileSystem;
  const tempRoot = yield* fs.makeTempDirectoryScoped({ prefix: "trygg-docs-contract-" });

  yield* Effect.forEach(
    Object.entries(files),
    ([filePath, content]) =>
      Effect.gen(function* () {
        const fullPath = join(tempRoot, filePath);
        yield* fs.makeDirectory(dirname(fullPath), { recursive: true });
        yield* fs.writeFileString(fullPath, content);
      }),
    { concurrency: 1 },
  );

  return tempRoot;
});

const makeDocsFixture = ({
  docsContract = fixtureDocsContract,
  indexSource = 'export { thing } from "./owner.js";\n',
  ownerSource = validOwnerSource,
  sidecarSource = fixtureSidecar,
}: {
  readonly docsContract?: string;
  readonly indexSource?: string;
  readonly ownerSource?: string;
  readonly sidecarSource?: string | null;
} = {}) => {
  const files: Record<string, string> = {
    "docs.contract.json": docsContract,
    "package.json": fixturePackageJson,
    "src/index.ts": indexSource,
    "src/owner.ts": ownerSource,
  };

  if (sidecarSource !== null) {
    files["src/owner.docs.md"] = sidecarSource;
  }

  return makeTempPackage(files).pipe(Effect.provide(NodeFileSystemLayer));
};

describe("docs contract", () => {
  it("documents the platform and output contract", async () => {
    const docs = await readFile(join(packageRoot, "src/config.docs.md"), "utf8");

    assert.include(docs, "public config remains `platform`, not `adapter`");
    assert.include(docs, '`output: "static"`');
    assert.include(docs, '`output: "server"`');
    assert.include(docs, "requires `app/api.ts`");
    assert.include(docs, "Cloudflare server MVP");
    assert.include(docs, "full SSR route rendering");
    assert.include(docs, "`.trygg/worker-entry.js`");
    assert.include(docs, "fixed `ASSETS` binding");
    assert.include(docs, "Public Cloudflare preview UX is deferred");
  });

  it("documents layout-owned static SEO tags", async () => {
    const docs = await readFile(join(packageRoot, "src/primitives/head.docs.md"), "utf8");

    assert.include(docs, "layout-rendered `<head>`");
    assert.include(docs, '<script type="application/ld+json">');
    assert.include(docs, "Do not duplicate static SEO injection through Vite `transformIndexHtml`");
    assert.include(docs, "hoists these tags to `document.head`");
  });

  it.effect("validates current migrated public surface", () =>
    Effect.gen(function* () {
      const report = yield* checkDocsContract({ packageRoot });

      assert.deepStrictEqual(report.violations, []);

      for (const publicName of [
        "trygg.Component",
        "trygg.PropsMarker",
        "trygg.Element",
        "trygg.Element.fromEffect",
        "trygg.Element.fail",
        "trygg.Element.fromUnknown",
        "trygg.Element.fromChildren",
        "trygg.intrinsic",
        "trygg.Renderer",
        "trygg.RenderContext",
        "trygg.mount",
        "trygg/jsx-runtime.jsx",
        "trygg/jsx-dev-runtime.jsxDEV",
        "trygg.Signal.make",
        "trygg.Resource.fetch",
        "trygg.cx",
        "trygg/router.Route",
        "trygg/router.routeMake",
        "trygg/router.Router",
        "trygg/router.Link",
        "trygg/router.Outlet",
        "trygg/router.runPrefetch",
        "trygg/api.Handler",
        "trygg/testing.render",
        "trygg/config.defineConfig",
        "trygg/vite-plugin.trygg",
        "trygg.DevMode",
        "trygg.ErrorBoundary.catchAll",
        "trygg.Portal.make",
        "trygg.Head.browserHeadLayer",
        "trygg.Debug.withSpan",
        "trygg.Metrics.snapshot",
      ]) {
        assert.include(report.reachableExports, publicName);
      }
    }),
  );

  it.effect("reports undeclared reachable exports in full strict mode", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const fixtureRoot = yield* makeDocsFixture({
          indexSource: 'export { thing, legacy } from "./owner.js";\n',
          ownerSource: `${validOwnerSource}\nexport const legacy = "legacy";\n`,
        });

        const report = yield* checkDocsContract({ packageRoot: fixtureRoot });

        assert.deepStrictEqual(report.violations, [
          {
            code: "missing_summary",
            file: "src/owner.ts",
            message: "Missing summary for legacy",
            publicName: "trygg.legacy",
          },
        ]);
      }),
    ),
  );

  it.effect("tracks member exports reachable off a named primary export", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const fixtureRoot = yield* makeDocsFixture({
          docsContract: fixtureDocsContractWithMemberExports,
          ownerSource: [
            "/**",
            " * Fixture owner module.",
            " *",
            " * @remarks",
            " * Owns the migrated fixture surface.",
            " *",
            " * @see ./owner.docs.md - Source-owned topic guide",
            " * @module trygg",
            " */",
            "",
            "/**",
            " * Fixture helper.",
            " *",
            " * @remarks",
            " * `helper` stays reachable through `thing.helper`.",
            " *",
            " * @example",
            " * ```ts",
            " * const value = thing.helper",
            " * ```",
            " *",
            " * @category Fixtures",
            " * @public",
            " * @since 1.0.0",
            " */",
            'export const helper = "ok";',
            "",
            "/**",
            " * Fixture value.",
            " *",
            " * @remarks",
            " * `thing` is the migrated surface under test.",
            " *",
            " * @example",
            " * ```ts",
            " * const value = thing",
            " * ```",
            " *",
            " * @category Fixtures",
            " * @public",
            " * @since 1.0.0",
            " */",
            "export const thing = { helper };",
            "",
          ].join("\n"),
        });

        const report = yield* checkDocsContract({ packageRoot: fixtureRoot });

        assert.deepStrictEqual(report.violations, []);
        assert.include(report.reachableExports, "trygg.thing");
        assert.include(report.reachableExports, "trygg.thing.helper");
        assert.notInclude(report.reachableExports, "trygg.helper");
      }),
    ),
  );

  it.effect("reports missing visibility and remarks regressions", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const fixtureRoot = yield* makeDocsFixture({
          ownerSource: [
            "/**",
            " * Fixture owner module.",
            " *",
            " * @remarks",
            " * Owns the migrated fixture surface.",
            " *",
            " * @see ./owner.docs.md - Source-owned topic guide",
            " * @module trygg",
            " */",
            "",
            "/**",
            " * Fixture value.",
            " *",
            " * @example",
            " * ```ts",
            " * const value = thing",
            " * ```",
            " *",
            " * @category Fixtures",
            " * @since 1.0.0",
            " */",
            'export const thing = "ok";',
            "",
          ].join("\n"),
        });

        const report = yield* checkDocsContract({ packageRoot: fixtureRoot });

        assert.deepStrictEqual(report.violations, [
          {
            code: "visibility_tag",
            file: "src/owner.ts",
            message: "Expected exactly one visibility tag on thing",
            publicName: "trygg.thing",
          },
          {
            code: "missing_remarks",
            file: "src/owner.ts",
            message: "Missing @remarks for thing",
            publicName: "trygg.thing",
          },
        ]);
      }),
    ),
  );

  it.effect("reports missing examples on migrated public exports", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const fixtureRoot = yield* makeDocsFixture({
          ownerSource: [
            "/**",
            " * Fixture owner module.",
            " *",
            " * @remarks",
            " * Owns the migrated fixture surface.",
            " *",
            " * @see ./owner.docs.md - Source-owned topic guide",
            " * @module trygg",
            " */",
            "",
            "/**",
            " * Fixture value.",
            " *",
            " * @remarks",
            " * `thing` is the migrated surface under test.",
            " *",
            " * @category Fixtures",
            " * @public",
            " * @since 1.0.0",
            " */",
            'export const thing = "ok";',
            "",
          ].join("\n"),
        });

        const report = yield* checkDocsContract({ packageRoot: fixtureRoot });

        assert.deepStrictEqual(report.violations, [
          {
            code: "missing_example",
            file: "src/owner.ts",
            message: "Missing @example for thing",
            publicName: "trygg.thing",
          },
        ]);
      }),
    ),
  );

  it.effect("filters violations to touched owners when touched files are provided", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const fixtureRoot = yield* makeDocsFixture({
          ownerSource: [
            "/**",
            " * Fixture owner module.",
            " *",
            " * @remarks",
            " * Owns the migrated fixture surface.",
            " *",
            " * @see ./owner.docs.md - Source-owned topic guide",
            " * @module trygg",
            " */",
            "",
            "/**",
            " * Fixture value.",
            " *",
            " * @remarks",
            " * `thing` is the migrated surface under test.",
            " *",
            " * @category Fixtures",
            " * @public",
            " * @since 1.0.0",
            " */",
            'export const thing = "ok";',
            "",
          ].join("\n"),
        });

        const report = yield* checkDocsContract({
          packageRoot: fixtureRoot,
          touchedFiles: ["src/unrelated.ts"],
        });

        assert.deepStrictEqual(report.violations, []);
      }),
    ),
  );

  it.effect("reports category and unknown-tag regressions", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const fixtureRoot = yield* makeDocsFixture({
          ownerSource: [
            "/**",
            " * Fixture owner module.",
            " *",
            " * @remarks",
            " * Owns the migrated fixture surface.",
            " *",
            " * @see ./owner.docs.md - Source-owned topic guide",
            " * @module trygg",
            " */",
            "",
            "/**",
            " * Fixture value.",
            " *",
            " * @remarks",
            " * `thing` is the migrated surface under test.",
            " *",
            " * @example",
            " * ```ts",
            " * const value = thing",
            " * ```",
            " *",
            " * @category Wrong",
            " * @public",
            " * @banana nope",
            " * @since 1.0.0",
            " */",
            'export const thing = "ok";',
            "",
          ].join("\n"),
        });

        const report = yield* checkDocsContract({ packageRoot: fixtureRoot });

        assert.deepStrictEqual(report.violations, [
          {
            code: "wrong_category",
            file: "src/owner.ts",
            message: "Expected @category Fixtures on thing",
            publicName: "trygg.thing",
          },
          {
            code: "unknown_tag",
            file: "src/owner.ts",
            message: "Unknown tag @banana on thing",
            publicName: "trygg.thing",
          },
        ]);
      }),
    ),
  );

  it.effect("reports orphan sidecar regressions", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const fixtureRoot = yield* makeDocsFixture({ sidecarSource: null });

        const report = yield* checkDocsContract({ packageRoot: fixtureRoot });

        assert.deepStrictEqual(report.violations, [
          {
            code: "missing_sidecar",
            file: "src/owner.docs.md",
            message: "Missing sidecar guide for Fixture",
            publicName: "trygg.thing",
          },
        ]);
      }),
    ),
  );

  it.effect("fails owner-module taxonomy mismatches", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const fixtureRoot = yield* makeDocsFixture({
          docsContract: fixtureDocsContractWrongOwnerModule,
        });

        const error = yield* Effect.flip(checkDocsContract({ packageRoot: fixtureRoot }));

        assert.isTrue(Predicate.isTagged(error, "DocsContractConfigError"));
        if (Predicate.isTagged(error, "DocsContractConfigError")) {
          assert.strictEqual(error.detail, "missing category mapping for Fixtures -> src/owner.ts");
        }
      }),
    ),
  );
});
