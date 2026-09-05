import * as nodePath from "node:path";
import { fileURLToPath } from "node:url";
import { layer as NodeFileSystemLayer } from "@effect/platform-node/NodeFileSystem";
import { assert, describe, it } from "@effect/vitest";
import { Cause, Effect, Exit, FileSystem, Predicate, Scope } from "effect";
import * as ts from "typescript";
import { scoped } from "../../testing/effect-vitest.js";
import { PluginParseError } from "../errors.js";
import { generateRouteTypes, normalizeImportTypeSpecifier, parseRoutes } from "../route-codegen.js";

interface RouteFixture {
  readonly root: string;
  readonly source: string;
  readonly sourcePath: string;
  readonly declarationPath: string;
}

const makeRouteFixture: (
  source: string,
  files?: Readonly<Record<string, string>>,
) => Effect.Effect<RouteFixture, unknown, FileSystem.FileSystem | Scope.Scope> = Effect.fn(
  "RouteCodegenTest.makeRouteFixture",
)(function* (source: string, files: Readonly<Record<string, string>> = {}) {
  const fs = yield* FileSystem.FileSystem;
  const root = yield* fs.makeTempDirectoryScoped({
    directory: process.cwd(),
    prefix: "trygg-route-codegen-",
  });
  const sourcePath = `${root}/app/routes.ts`;
  const declarationPath = `${root}/.trygg/routes.d.ts`;
  yield* fs
    .makeDirectory(`${root}/app`, { recursive: true })
    .pipe(
      Effect.catchTag("PlatformError", (error) =>
        Predicate.isTagged(error.reason, "AlreadyExists") ? Effect.void : Effect.fail(error),
      ),
    );
  yield* fs.writeFileString(sourcePath, source);
  for (const [relativePath, contents] of Object.entries(files)) {
    const filePath = nodePath.join(root, relativePath);
    yield* fs
      .makeDirectory(nodePath.dirname(filePath), { recursive: true })
      .pipe(
        Effect.catchTag("PlatformError", (error) =>
          Predicate.isTagged(error.reason, "AlreadyExists") ? Effect.void : Effect.fail(error),
        ),
      );
    yield* fs.writeFileString(filePath, contents);
  }
  return { root, source, sourcePath, declarationPath };
});

const coreDir = nodePath.resolve(nodePath.dirname(fileURLToPath(import.meta.url)), "../../..");

const compileGeneratedConsumer = Effect.fn("RouteCodegenTest.compileGeneratedConsumer")(function* (
  fixture: RouteFixture,
  declarations: string,
  consumer: string,
) {
  const fs = yield* FileSystem.FileSystem;
  const consumerPath = nodePath.join(fixture.root, "consumer.ts");
  yield* fs.makeDirectory(nodePath.dirname(fixture.declarationPath), { recursive: true });
  yield* fs.writeFileString(fixture.declarationPath, declarations);
  yield* fs.writeFileString(consumerPath, consumer);

  return yield* Effect.sync(() => {
    const configPath = nodePath.join(coreDir, "tsconfig.json");
    const config = ts.readConfigFile(configPath, ts.sys.readFile);
    if (config.error !== undefined) return [config.error];
    const parsed = ts.parseJsonConfigFileContent(
      config.config,
      ts.sys,
      coreDir,
      undefined,
      configPath,
    );
    const program = ts.createProgram({
      rootNames: [fixture.declarationPath, consumerPath],
      options: {
        ...parsed.options,
        noEmit: true,
        noUnusedLocals: false,
        noUnusedParameters: false,
      },
    });
    const roots = new Set(
      [fixture.declarationPath, consumerPath].map((filePath) => nodePath.resolve(filePath)),
    );
    return [
      ...parsed.errors,
      ...ts
        .getPreEmitDiagnostics(program)
        .filter(
          (diagnostic) =>
            diagnostic.file !== undefined && roots.has(nodePath.resolve(diagnostic.file.fileName)),
        ),
    ].filter((diagnostic) => diagnostic.category === ts.DiagnosticCategory.Error);
  });
});

describe("route declaration codegen", () => {
  it("should make generated node_modules import types portable", () => {
    // Scope: covers TypeScript 5's absolute import path for external branded Schema outputs.
    // Assertion: pnpm-style nested paths become package exports and never retain workspace paths.
    assert.strictEqual(
      normalizeImportTypeSpecifier(
        "/workspace/node_modules/.pnpm/effect@4/node_modules/effect/dist/Brand",
        "/workspace/app/routes.ts",
        "/workspace/.trygg/routes.d.ts",
      ),
      "effect/Brand",
    );
  });

  scoped("should separate decoded params from encoded URL inputs", () =>
    Effect.gen(function* () {
      // Scope: covers aliases, referenced schemas, brands, BigInt, and Date transforms.
      // Assertion: RouteMap contains decoded values while RouteInputMap contains URL strings.
      const fixture = yield* makeRouteFixture(`
import { Schema as S } from "effect"
import { Route } from "trygg/router"

const ItemId = S.NumberFromString.pipe(S.brand("ItemId"))
export const Params = S.Struct({
  id: ItemId,
  createdAt: S.DateFromString,
  count: S.BigIntFromString,
})

Route.make("/items/:id/:createdAt/:count")
  .params(Params)
`);

      const output = yield* generateRouteTypes(
        fixture.source,
        fixture.sourcePath,
        fixture.declarationPath,
      );

      assert.include(output, 'readonly "/items/:id/:createdAt/:count"');
      assert.include(output, 'readonly id: number & import("effect/Brand").Brand<"ItemId">');
      assert.include(output, "readonly createdAt: Date");
      assert.include(output, "readonly count: bigint");
      assert.include(output, "interface RouteInputMap");
      assert.include(
        output,
        "readonly id: string; readonly createdAt: string; readonly count: string;",
      );
    }).pipe(Effect.provide(NodeFileSystemLayer)),
  );

  scoped("should derive inline params and query Schema outputs", () =>
    Effect.gen(function* () {
      // Scope: covers inline Struct parsing and optional query input without source regexes.
      // Assertion: decoded and encoded query maps agree with runtime string transport.
      const fixture = yield* makeRouteFixture(`
import { Schema as S } from "effect"
import { Route } from "trygg/router"

Route.make("/events/:at")
  .params(S.Struct({ at: S.DateFromString }))
  .query(S.Struct({ since: S.DateFromString, page: S.optional(S.NumberFromString) }))
`);

      const routes = yield* parseRoutes(
        fixture.source,
        fixture.sourcePath,
        fixture.declarationPath,
      );
      const output = yield* generateRouteTypes(
        fixture.source,
        fixture.sourcePath,
        fixture.declarationPath,
      );

      assert.include(output, 'readonly "/events/:at": { readonly at: Date; }');
      assert.include(output, 'readonly "/events/:at": { readonly at: string; }');
      assert.include(output, "interface RouteQueryMap");
      assert.include(output, "readonly since: Date");
      assert.include(routes[0]?.queryType ?? "", "readonly page?: number | undefined");
      assert.include(routes[0]?.queryInputType ?? "", "readonly page?: string | undefined");
    }).pipe(Effect.provide(NodeFileSystemLayer)),
  );

  scoped("should resolve statically named computed Schema methods", () =>
    Effect.gen(function* () {
      // Scope: covers literal and checker-resolved element access on immutable builders.
      // Assertion: computed params/query calls generate distinct decoded and encoded maps.
      const fixture = yield* makeRouteFixture(`
import { Schema } from "effect"
import { Route } from "trygg/router"

const queryMethod = "query" as const
const base = Route.make("/computed/:id")
const withParams = base["params"](Schema.Struct({ id: Schema.NumberFromString }))
withParams[queryMethod](Schema.Struct({ page: Schema.NumberFromString }))
`);

      const output = yield* generateRouteTypes(
        fixture.source,
        fixture.sourcePath,
        fixture.declarationPath,
      );

      assert.include(output, 'readonly "/computed/:id": { readonly id: number; }');
      assert.include(output, 'readonly "/computed/:id": { readonly id: string; }');
      assert.include(output, 'readonly "/computed/:id": { readonly page: number; }');
      assert.include(output, 'readonly "/computed/:id": { readonly page: string; }');
    }).pipe(Effect.provide(NodeFileSystemLayer)),
  );

  scoped("should preserve raw string params when no Schema is attached", () =>
    Effect.gen(function* () {
      // Scope: distinguishes the runtime raw-param contract from unsupported Schema fallback.
      // Assertion: a schema-less dynamic path gets string, while no schema inference is attempted.
      const fixture = yield* makeRouteFixture(`
import { Route } from "trygg/router"

Route.make("/users/:id")
let dynamicBase: any = Route.make("/legacy/:slug")
dynamicBase.component(LegacyPage)
`);

      const output = yield* generateRouteTypes(
        fixture.source,
        fixture.sourcePath,
        fixture.declarationPath,
      );

      assert.include(output, 'readonly "/users/:id": { readonly "id": string }');
      assert.include(output, 'readonly "/users/:id": { readonly "id": string | number }');
      assert.include(output, 'readonly "/legacy/:slug": { readonly "slug": string }');
      assert.include(output, 'readonly "/legacy/:slug": { readonly "slug": string | number }');
    }).pipe(Effect.provide(NodeFileSystemLayer)),
  );

  scoped(
    "should compile generated declarations with Link and navigate consumers",
    () =>
      Effect.gen(function* () {
        // Scope: crosses codegen, module augmentation, and public URL-construction APIs.
        // Assertion: encoded strings compile while decoded Date and bigint values remain rejected.
        const fixture = yield* makeRouteFixture(`
import { Schema } from "effect"
import { Route } from "trygg/router"

Route.make("/events/:at/:count")
  .params(Schema.Struct({ at: Schema.DateFromString, count: Schema.BigIntFromString }))
  .query(Schema.Struct({ page: Schema.optional(Schema.NumberFromString) }))
`);
        const declarations = yield* generateRouteTypes(
          fixture.source,
          fixture.sourcePath,
          fixture.declarationPath,
        );
        const diagnostics = yield* compileGeneratedConsumer(
          fixture,
          declarations,
          `
import { Link, navigate } from "trygg/router"

Link({
  to: "/events/:at/:count",
  params: { at: "2026-08-27", count: "42" },
  query: { page: "2" },
})
const navigation = navigate("/events/:at/:count", {
  params: { at: "2026-08-27", count: "42" },
  query: { page: undefined },
})
void navigation

// @ts-expect-error decoded Schema outputs are not URL inputs
Link({ to: "/events/:at/:count", params: { at: new Date(), count: 42n } })
`,
        );

        assert.deepStrictEqual(
          diagnostics.map((diagnostic) =>
            ts.flattenDiagnosticMessageText(diagnostic.messageText, "\n"),
          ),
          [],
        );
      }).pipe(Effect.provide(NodeFileSystemLayer)),
    15_000,
  );

  scoped("should identify only the canonical Trygg Route factory symbol", () =>
    Effect.gen(function* () {
      // Scope: covers import aliases, namespace access, const aliases, local re-exports, and shadows.
      // Assertion: checker-proven Trygg owners emit routes; spelling-compatible lookalikes emit none.
      const fixture = yield* makeRouteFixture(
        `
import { Route as TryggRoute } from "trygg/router"
import * as Router from "trygg/router"
import { ReExportedRoute } from "./router-barrel.js"

const R = TryggRoute
const NamespaceRoute = Router.Route
const { Route: DestructuredRoute } = Router
const ElementRoute = Router["Route"]
const EquivalentAlias = ElementRoute
TryggRoute.make("/direct")
R.make("/const-alias")
Router.Route.make("/namespace")
NamespaceRoute.make("/namespace-alias")
DestructuredRoute.make("/destructured")
ElementRoute.make("/element-alias")
EquivalentAlias.make("/equivalent-alias")
ReExportedRoute.make("/re-export")

const localRoute = {
  make: (_path: string) => ({
    _tag: "RouteBuilder" as const,
    params: (_schema: unknown) => undefined,
  }),
}
const Route = localRoute
Route.make("/local/:id").params({})
const localNamespace = { Route: localRoute }
const { Route: LocalDestructuredRoute } = localNamespace
const LocalElementRoute = localNamespace["Route"]
LocalDestructuredRoute.make("/local-destructured")
LocalElementRoute.make("/local-element")
const forgedNamespace = localNamespace as unknown as typeof Router
const { Route: ForgedDestructuredRoute } = forgedNamespace
const ForgedElementRoute = forgedNamespace["Route"]
forgedNamespace.Route.make("/forged-namespace")
ForgedDestructuredRoute.make("/forged-destructured")
ForgedElementRoute.make("/forged-element")
const shadowed = (Route: typeof localRoute) => Route.make("/shadowed")
shadowed(localRoute)
`,
        {
          "app/router-barrel.ts": `export { Route as ReExportedRoute } from "trygg/router"`,
        },
      );

      const routes = yield* parseRoutes(
        fixture.source,
        fixture.sourcePath,
        fixture.declarationPath,
      );

      assert.deepStrictEqual(
        routes.map((route) => route.path),
        [
          "/direct",
          "/const-alias",
          "/namespace",
          "/namespace-alias",
          "/destructured",
          "/element-alias",
          "/equivalent-alias",
          "/re-export",
        ],
      );
    }).pipe(Effect.provide(NodeFileSystemLayer)),
  );

  scoped("should fail explicitly when a Schema output cannot be resolved", () =>
    Effect.gen(function* () {
      // Scope: covers unsupported schema expressions at the generated declaration boundary.
      // Assertion: codegen fails with PluginParseError and never invents a string field type.
      const fixture = yield* makeRouteFixture(`
import { Route } from "trygg/router"

declare const CustomThing: unknown
Route.make("/users/:id").params(CustomThing)
`);

      const exit = yield* Effect.exit(
        generateRouteTypes(fixture.source, fixture.sourcePath, fixture.declarationPath),
      );

      assert.isTrue(Exit.isFailure(exit));
      if (Exit.isFailure(exit)) {
        const error = Cause.squash(exit.cause);
        assert.instanceOf(error, PluginParseError);
        if (error instanceof PluginParseError) {
          assert.include(error.description, "Unsupported params Schema");
        }
      }
    }).pipe(Effect.provide(NodeFileSystemLayer)),
  );

  scoped("should resolve immutable route builder chains through const variables", () =>
    Effect.gen(function* () {
      // Scope: covers checker-symbol resolution across immutable builder aliases.
      // Assertion: a referenced .params() call generates Schema types instead of raw fallback.
      const fixture = yield* makeRouteFixture(`
import { Schema } from "effect"
import { Route } from "trygg/router"

const Params = Schema.Struct({ id: Schema.NumberFromString })
const base = Route.make("/users/:id")
const typed = base.params(Params)
typed.component(UserPage)
`);

      const output = yield* generateRouteTypes(
        fixture.source,
        fixture.sourcePath,
        fixture.declarationPath,
      );

      assert.include(output, 'readonly "/users/:id": { readonly id: number; }');
      assert.include(output, 'readonly "/users/:id": { readonly id: string; }');
      assert.notInclude(output, 'readonly "/users/:id": { readonly "id": string }');
    }).pipe(Effect.provide(NodeFileSystemLayer)),
  );

  scoped(
    "should fail unresolved dynamic Schema builder chains",
    () =>
      Effect.gen(function* () {
        // Scope: covers any, reassigned, conditional, and dynamically wrapped route receivers.
        // Assertion: every route-associated Schema call fails instead of emitting raw string fallback.
        const cases = [
          `
import { Schema } from "effect"
import { Route } from "trygg/router"

let base: any = Route.make("/users/:id")
base.params(Schema.Struct({ id: Schema.String }))
`,
          `
import { Schema } from "effect"
import { Route } from "trygg/router"

const base: any = Route.make("/users/:id")
base["params"](Schema.Struct({ id: Schema.String }))
`,
          `
import { Schema } from "effect"
import { Route } from "trygg/router"

(Route.make("/users/:id") as any)["params"](Schema.Struct({ id: Schema.String }))
`,
          `
import { Schema } from "effect"
import { Route } from "trygg/router"

let base = Route.make("/users/:id")
base = Route.make("/users/:id")
base.params(Schema.Struct({ id: Schema.String }))
`,
          `
import { Schema } from "effect"
import { Route } from "trygg/router"

declare const condition: boolean
const base = condition ? Route.make("/users/:id") : Route.make("/users/:id")
base.query(Schema.Struct({ filter: Schema.String }))
`,
          `
import { Schema } from "effect"
import { Route } from "trygg/router"

const select = (builder: unknown): any => builder
select(Route.make("/users/:id")).params(Schema.Struct({ id: Schema.String }))
`,
          `
import { Schema } from "effect"
import { Route } from "trygg/router"

declare const method: "params" | "query"
Route.make("/users/:id")[method](Schema.Struct({ id: Schema.String }))
`,
        ];

        for (const source of cases) {
          const fixture = yield* makeRouteFixture(source);
          const exit = yield* Effect.exit(
            generateRouteTypes(fixture.source, fixture.sourcePath, fixture.declarationPath),
          );

          assert.isTrue(Exit.isFailure(exit));
          if (Exit.isFailure(exit)) {
            const error = Cause.squash(exit.cause);
            assert.instanceOf(error, PluginParseError);
            if (error instanceof PluginParseError) {
              assert.include(error.description, "cannot resolve the immutable builder");
            }
          }
        }
      }).pipe(Effect.provide(NodeFileSystemLayer)),
    15_000,
  );

  scoped("should reject values that only imitate Schema type members", () =>
    Effect.gen(function* () {
      // Scope: covers transpile-only inputs with Type and Encoded lookalike properties.
      // Assertion: only values assignable to the installed Schema.Struct contract are accepted.
      const fixture = yield* makeRouteFixture(`
import { Route } from "trygg/router"

const FakeSchema = {
  Type: { id: 1 },
  Encoded: { id: "1" },
}
Route.make("/users/:id").params(FakeSchema)
`);
      const exit = yield* Effect.exit(
        generateRouteTypes(fixture.source, fixture.sourcePath, fixture.declarationPath),
      );

      assert.isTrue(Exit.isFailure(exit));
      if (Exit.isFailure(exit)) {
        const error = Cause.squash(exit.cause);
        assert.instanceOf(error, PluginParseError);
        if (error instanceof PluginParseError) {
          assert.include(error.description, "installed Schema.Struct contract");
        }
      }
    }).pipe(Effect.provide(NodeFileSystemLayer)),
  );

  scoped(
    "should reject Schema encodings that cannot round-trip through URL strings",
    () =>
      Effect.gen(function* () {
        // Scope: covers arrays and optional path fields plus array-valued query transport.
        // Assertion: every unsupported transport shape fails codegen with PluginParseError.
        const cases = [
          {
            source: `Route.make("/tags/:tags").params(Schema.Struct({ tags: Schema.Array(Schema.String) }))`,
            message: "encoded path field tags must be a string",
          },
          {
            source: `Route.make("/users/:id").params(Schema.Struct({ id: Schema.optional(Schema.String) }))`,
            message: "path field id cannot be optional",
          },
          {
            source: `Route.make("/users/:id").params(Schema.Struct({ id: Schema.Number }))`,
            message: "encoded path field id must be a string",
          },
          {
            source: `Route.make("/search").query(Schema.Struct({ tags: Schema.Array(Schema.String) }))`,
            message: "encoded query field tags must be a string",
          },
          {
            source: `Route.make("/search").query(Schema.Struct({ page: Schema.Number }))`,
            message: "encoded query field page must be a string",
          },
          {
            source: `Route.make("/search").query(Schema.Struct({ page: Schema.Union([Schema.String, Schema.Undefined]) }))`,
            message: "encoded query field page must be a string",
          },
        ];

        for (const testCase of cases) {
          const fixture = yield* makeRouteFixture(`
import { Schema } from "effect"
import { Route } from "trygg/router"
${testCase.source}
`);
          const exit = yield* Effect.exit(
            generateRouteTypes(fixture.source, fixture.sourcePath, fixture.declarationPath),
          );
          assert.isTrue(Exit.isFailure(exit));
          if (Exit.isFailure(exit)) {
            const error = Cause.squash(exit.cause);
            assert.instanceOf(error, PluginParseError);
            if (error instanceof PluginParseError) {
              assert.include(error.description, testCase.message);
            }
          }
        }
      }).pipe(Effect.provide(NodeFileSystemLayer)),
    15_000,
  );
});
