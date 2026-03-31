import { describe, expect, it } from "@effect/vitest";
import { Effect } from "effect";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import assert from "node:assert/strict";

import { checkDocsContract, DocsContractConfigError } from "../docs-contract.js";

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

const makeTempPackage = (files: Record<string, string>) =>
  Effect.gen(function* () {
    const tempRoot = yield* Effect.tryPromise(() =>
      mkdtemp(join(tmpdir(), "trygg-docs-contract-")),
    );

    yield* Effect.addFinalizer(() =>
      Effect.tryPromise(() => rm(tempRoot, { force: true, recursive: true })).pipe(Effect.ignore),
    );

    yield* Effect.forEach(
      Object.entries(files),
      ([filePath, content]) =>
        Effect.tryPromise(async () => {
          const fullPath = join(tempRoot, filePath);
          await mkdir(dirname(fullPath), { recursive: true });
          await writeFile(fullPath, content);
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

  return makeTempPackage(files);
};

describe("docs contract", () => {
  it.effect("validates current migrated public surface", () =>
    Effect.gen(function* () {
      const report = yield* checkDocsContract({ packageRoot });

      assert.deepStrictEqual(report.violations, []);

      for (const publicName of [
        "trygg.Component",
        "trygg.PropsMarker",
        "trygg.Element",
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
        expect(report.reachableExports).toContain(publicName);
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

        expect(error instanceof DocsContractConfigError).toBe(true);
        assert.strictEqual(
          error.message,
          "Docs contract config error: missing category mapping for Fixtures -> src/owner.ts",
        );
      }),
    ),
  );
});
