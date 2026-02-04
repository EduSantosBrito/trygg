/**
 * Tests for Vite plugin
 * @module
 */
import { assert, describe, it } from "@effect/vitest";
import { FileSystem } from "@effect/platform";
import { layer as NodeFileSystemLayer } from "@effect/platform-node/NodeFileSystem";
import { Cause, Effect, Exit, Schema, Scope } from "effect";
import * as path from "path";
import {
  trygg,
  extractParamNames,
  generateParamType,
  parseRoutes,
  generateRouteTypes,
  transformRoutesForBuild,
  validateApiPlatform,
  PluginValidationError,
  schemaToType,
  parseSchemaStruct,
  resolveRoutePaths,
  type ParsedRoute,
} from "../plugin.js";

/**
 * Create a scoped temporary directory with route files.
 * Cleanup is handled by Effect's Scope (finalizer removes dir on scope close).
 */
const makeTempDir = (
  files: Record<string, string>,
): Effect.Effect<string, never, FileSystem.FileSystem | Scope.Scope> =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const dir = yield* fs.makeTempDirectory({ prefix: "trygg-test-" }).pipe(Effect.orDie);
    yield* Effect.addFinalizer(() => fs.remove(dir, { recursive: true }).pipe(Effect.ignore));
    yield* Effect.forEach(Object.entries(files), ([filePath, content]) =>
      Effect.gen(function* () {
        const fullPath = path.join(dir, filePath);
        yield* fs.makeDirectory(path.dirname(fullPath), { recursive: true }).pipe(
          Effect.catchTag("SystemError", (e) =>
            e.reason === "AlreadyExists" ? Effect.void : Effect.fail(e),
          ),
          Effect.orDie,
        );
        yield* fs.writeFileString(fullPath, content).pipe(Effect.orDie);
      }),
    );
    return dir;
  });

describe("Vite Plugin", () => {
  // ─────────────────────────────────────────────────────────────────────────────
  // Scope: Plugin initialization
  // ─────────────────────────────────────────────────────────────────────────────
  describe("trygg function", () => {
    it("should return a valid Vite plugin", () => {
      const plugin = trygg();

      assert.isDefined(plugin);
      assert.isString(plugin.name);
      assert.strictEqual(plugin.name, "trygg");
      assert.isDefined(plugin.config);
    });
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // Scope: config hook
  // ─────────────────────────────────────────────────────────────────────────────
  describe("config hook", () => {
    // Schema for validating the config hook is a callable function
    const ConfigHookSchema = Schema.declare(
      (u: unknown): u is (...args: ReadonlyArray<unknown>) => unknown => typeof u === "function",
    );

    // Schema for the expected esbuild config shape
    const EsbuildConfigSchema = Schema.Struct({
      esbuild: Schema.Struct({
        jsx: Schema.String,
        jsxImportSource: Schema.String,
      }),
    });

    // Schema for the expected optimizeDeps config shape
    const OptimizeDepsConfigSchema = Schema.Struct({
      optimizeDeps: Schema.Struct({
        esbuildOptions: Schema.Struct({
          jsx: Schema.String,
          jsxImportSource: Schema.String,
        }),
      }),
    });

    it("should set esbuild jsx to automatic mode", () => {
      const plugin = trygg();
      const configHook = Schema.decodeUnknownSync(ConfigHookSchema)(plugin.config);
      const result = configHook({}, { command: "serve", mode: "development" });
      const config = Schema.decodeUnknownSync(EsbuildConfigSchema)(result);
      assert.strictEqual(config.esbuild.jsx, "automatic");
      assert.strictEqual(config.esbuild.jsxImportSource, "trygg");
    });

    it("should configure optimizeDeps for trygg", () => {
      const plugin = trygg();
      const configHook = Schema.decodeUnknownSync(ConfigHookSchema)(plugin.config);
      const result = configHook({}, { command: "serve", mode: "development" });
      const config = Schema.decodeUnknownSync(OptimizeDepsConfigSchema)(result);
      assert.strictEqual(config.optimizeDeps.esbuildOptions.jsx, "automatic");
      assert.strictEqual(config.optimizeDeps.esbuildOptions.jsxImportSource, "trygg");
    });
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // Scope: Param extraction
  // ─────────────────────────────────────────────────────────────────────────────
  describe("extractParamNames", () => {
    it.effect("should return empty array for static route", () =>
      Effect.gen(function* () {
        const params = yield* extractParamNames("/users/profile");
        assert.deepStrictEqual([...params], []);
      }),
    );

    it.effect("should extract single param", () =>
      Effect.gen(function* () {
        const params = yield* extractParamNames("/users/:id");
        assert.deepStrictEqual([...params], ["id"]);
      }),
    );

    it.effect("should extract multiple params", () =>
      Effect.gen(function* () {
        const params = yield* extractParamNames("/users/:userId/posts/:postId");
        assert.deepStrictEqual([...params], ["userId", "postId"]);
      }),
    );
  });

  describe("generateParamType", () => {
    it.effect("should return empty object for static route", () =>
      Effect.gen(function* () {
        const type = yield* generateParamType("/users/profile");
        assert.strictEqual(type, "{}");
      }),
    );

    it.effect("should generate type for single param", () =>
      Effect.gen(function* () {
        const type = yield* generateParamType("/users/:id");
        assert.strictEqual(type, "{ readonly id: string }");
      }),
    );

    it.effect("should generate type for multiple params", () =>
      Effect.gen(function* () {
        const type = yield* generateParamType("/users/:userId/posts/:postId");
        assert.strictEqual(type, "{ readonly userId: string; readonly postId: string }");
      }),
    );
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // Scope: API platform guard
  // ─────────────────────────────────────────────────────────────────────────────
  describe("validateApiPlatform", () => {
    it.scoped("should reject platform-node imports when platform is bun", () =>
      Effect.gen(function* () {
        const dir = yield* makeTempDir({
          "app/api.ts":
            'import { NodeHttpServer } from "@effect/platform-node"\nexport const Api = {}',
        });
        const apiPath = path.join(dir, "app", "api.ts");

        const exit = yield* Effect.exit(validateApiPlatform(apiPath, "bun"));

        if (Exit.isSuccess(exit)) {
          throw new Error("Expected failure but got success");
        }

        const error = Cause.squash(exit.cause);
        if (!(error instanceof PluginValidationError)) {
          throw new Error(`Expected PluginValidationError but got ${error}`);
        }

        assert.strictEqual(error.reason, "InvalidStructure");
      }).pipe(Effect.provide(NodeFileSystemLayer)),
    );

    it.scoped("should allow platform-node imports when platform is node", () =>
      Effect.gen(function* () {
        const dir = yield* makeTempDir({
          "app/api.ts":
            'import { NodeHttpServer } from "@effect/platform-node"\nexport const Api = {}',
        });
        const apiPath = path.join(dir, "app", "api.ts");

        yield* validateApiPlatform(apiPath, "node");
      }).pipe(Effect.provide(NodeFileSystemLayer)),
    );

    it.scoped("should allow bun platform when no node imports", () =>
      Effect.gen(function* () {
        const dir = yield* makeTempDir({
          "app/api.ts": "export const Api = {}",
        });
        const apiPath = path.join(dir, "app", "api.ts");

        yield* validateApiPlatform(apiPath, "bun");
      }).pipe(Effect.provide(NodeFileSystemLayer)),
    );
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // Scope: Schema type mapping
  // ─────────────────────────────────────────────────────────────────────────────
  describe("schemaToType", () => {
    it("should map Schema.NumberFromString to number", () => {
      assert.strictEqual(schemaToType("Schema.NumberFromString"), "number");
    });

    it("should map Schema.String to string", () => {
      assert.strictEqual(schemaToType("Schema.String"), "string");
    });

    it("should map Schema.Number to number", () => {
      assert.strictEqual(schemaToType("Schema.Number"), "number");
    });

    it("should map Schema.Boolean to boolean", () => {
      assert.strictEqual(schemaToType("Schema.Boolean"), "boolean");
    });

    it("should map Schema.Literal to union type", () => {
      assert.strictEqual(schemaToType('Schema.Literal("asc", "desc")'), '"asc" | "desc"');
    });

    it("should map Schema.optional to T | undefined", () => {
      assert.strictEqual(
        schemaToType("Schema.optional(Schema.NumberFromString)"),
        "number | undefined",
      );
    });

    it("should map Schema.optional(Schema.Literal) to union | undefined", () => {
      assert.strictEqual(
        schemaToType('Schema.optional(Schema.Literal("asc", "desc"))'),
        '"asc" | "desc" | undefined',
      );
    });

    it("should fall back to string for unknown schema types", () => {
      assert.strictEqual(schemaToType("Schema.CustomThing"), "string");
    });
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // Scope: parseSchemaStruct
  // ─────────────────────────────────────────────────────────────────────────────
  describe("parseSchemaStruct", () => {
    it("should parse single field", () => {
      const result = parseSchemaStruct("id: Schema.NumberFromString");
      assert.strictEqual(result.length, 1);
      assert.strictEqual(result[0]?.name, "id");
      assert.strictEqual(result[0]?.type, "number");
      assert.isFalse(result[0]?.optional);
    });

    it("should parse multiple fields", () => {
      const result = parseSchemaStruct(
        "year: Schema.NumberFromString, month: Schema.NumberFromString, slug: Schema.String",
      );
      assert.strictEqual(result.length, 3);
      assert.strictEqual(result[0]?.name, "year");
      assert.strictEqual(result[0]?.type, "number");
      assert.strictEqual(result[1]?.name, "month");
      assert.strictEqual(result[2]?.name, "slug");
      assert.strictEqual(result[2]?.type, "string");
    });

    it("should handle optional fields", () => {
      const result = parseSchemaStruct(
        "q: Schema.String, page: Schema.optional(Schema.NumberFromString)",
      );
      assert.strictEqual(result.length, 2);
      assert.strictEqual(result[0]?.name, "q");
      assert.isFalse(result[0]?.optional);
      assert.strictEqual(result[1]?.name, "page");
      assert.strictEqual(result[1]?.type, "number | undefined");
      assert.isTrue(result[1]?.optional);
    });

    it("should return empty array for empty struct", () => {
      assert.strictEqual(parseSchemaStruct("").length, 0);
    });
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // Scope: parseRoutes
  // ─────────────────────────────────────────────────────────────────────────────
  describe("parseRoutes", () => {
    it.effect("should extract route paths from Route.make", () =>
      Effect.gen(function* () {
        const source = `
          Route.make("/users")
            .component(UsersList)
          Route.make("/about")
            .component(About)
        `;
        const routes = yield* parseRoutes(source);
        assert.strictEqual(routes.length, 2);
        assert.strictEqual(routes[0]?.path, "/users");
        assert.strictEqual(routes[1]?.path, "/about");
      }),
    );

    it.effect("should extract params schema", () =>
      Effect.gen(function* () {
        const source = `
          Route.make("/users/:id")
            .params(Schema.Struct({ id: Schema.NumberFromString }))
            .component(UserProfile)
        `;
        const routes = yield* parseRoutes(source);
        assert.strictEqual(routes.length, 1);
        assert.strictEqual(routes[0]?.params.length, 1);
        assert.strictEqual(routes[0]?.params[0]?.name, "id");
        assert.strictEqual(routes[0]?.params[0]?.type, "number");
      }),
    );

    it.effect("should extract query schema", () =>
      Effect.gen(function* () {
        const source = `
          Route.make("/search")
            .query(Schema.Struct({ q: Schema.String, page: Schema.optional(Schema.NumberFromString) }))
            .component(SearchPage)
        `;
        const routes = yield* parseRoutes(source);
        assert.strictEqual(routes.length, 1);
        assert.strictEqual(routes[0]?.query.length, 2);
        assert.strictEqual(routes[0]?.query[0]?.name, "q");
        assert.strictEqual(routes[0]?.query[0]?.type, "string");
        assert.strictEqual(routes[0]?.query[1]?.name, "page");
        assert.isTrue(routes[0]?.query[1]?.optional);
      }),
    );

    it.effect("should extract Route.index as index route", () =>
      Effect.gen(function* () {
        const source = `
          Route.index(SettingsIndex)
        `;
        const routes = yield* parseRoutes(source);
        assert.strictEqual(routes.length, 1);
        assert.isTrue(routes[0]?.isIndex);
      }),
    );

    it.effect("should handle routes with no params", () =>
      Effect.gen(function* () {
        const source = `
          Route.make("/about")
            .component(AboutPage)
        `;
        const routes = yield* parseRoutes(source);
        assert.strictEqual(routes[0]?.params.length, 0);
        assert.strictEqual(routes[0]?.query.length, 0);
      }),
    );

    it.effect("should handle empty source", () =>
      Effect.gen(function* () {
        const routes = yield* parseRoutes("");
        assert.strictEqual(routes.length, 0);
      }),
    );
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // Scope: resolveRoutePaths
  // ─────────────────────────────────────────────────────────────────────────────
  describe("resolveRoutePaths", () => {
    it("should resolve top-level routes as absolute", () => {
      const routes: ReadonlyArray<ParsedRoute> = [
        { path: "/users", params: [], query: [], children: [], isIndex: false },
        { path: "/about", params: [], query: [], children: [], isIndex: false },
      ];
      const resolved = resolveRoutePaths(routes);
      assert.strictEqual(resolved.length, 2);
      assert.strictEqual(resolved[0]?.path, "/users");
      assert.strictEqual(resolved[1]?.path, "/about");
    });

    it("should resolve children against parent path", () => {
      const routes: ReadonlyArray<ParsedRoute> = [
        {
          path: "/settings",
          params: [],
          query: [],
          isIndex: false,
          children: [
            { path: "/profile", params: [], query: [], children: [], isIndex: false },
            { path: "/security", params: [], query: [], children: [], isIndex: false },
          ],
        },
      ];
      const resolved = resolveRoutePaths(routes);
      assert.strictEqual(resolved.length, 3);
      assert.strictEqual(resolved[0]?.path, "/settings");
      assert.strictEqual(resolved[1]?.path, "/settings/profile");
      assert.strictEqual(resolved[2]?.path, "/settings/security");
    });

    it("should resolve index routes to parent path", () => {
      const routes: ReadonlyArray<ParsedRoute> = [
        {
          path: "/settings",
          params: [],
          query: [],
          isIndex: false,
          children: [
            { path: "", params: [], query: [], children: [], isIndex: true },
            { path: "/profile", params: [], query: [], children: [], isIndex: false },
          ],
        },
      ];
      const resolved = resolveRoutePaths(routes);
      assert.strictEqual(resolved.length, 3);
      assert.strictEqual(resolved[1]?.path, "/settings");
    });

    it("should resolve deeply nested routes", () => {
      const routes: ReadonlyArray<ParsedRoute> = [
        {
          path: "/a",
          params: [],
          query: [],
          isIndex: false,
          children: [
            {
              path: "/b",
              params: [],
              query: [],
              isIndex: false,
              children: [{ path: "/c", params: [], query: [], children: [], isIndex: false }],
            },
          ],
        },
      ];
      const resolved = resolveRoutePaths(routes);
      assert.strictEqual(resolved[2]?.path, "/a/b/c");
    });
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // Scope: generateRouteTypes
  // ─────────────────────────────────────────────────────────────────────────────
  describe("generateRouteTypes", () => {
    it.effect("should generate RouteMap from parsed routes", () =>
      Effect.gen(function* () {
        const routes: ReadonlyArray<ParsedRoute> = [
          { path: "/", params: [], query: [], children: [], isIndex: false },
          {
            path: "/users/:id",
            params: [{ name: "id", type: "number", optional: false }],
            query: [],
            children: [],
            isIndex: false,
          },
        ];
        const output = yield* generateRouteTypes(routes);
        assert.isTrue(output.includes('readonly "/": {}'));
        assert.isTrue(output.includes('readonly "/users/:id": { readonly id: number }'));
      }),
    );

    it.effect("should extract NumberFromString as number in RouteMap", () =>
      Effect.gen(function* () {
        const routes: ReadonlyArray<ParsedRoute> = [
          {
            path: "/users/:id",
            params: [{ name: "id", type: "number", optional: false }],
            query: [],
            children: [],
            isIndex: false,
          },
        ];
        const output = yield* generateRouteTypes(routes);
        assert.isTrue(output.includes("readonly id: number"));
      }),
    );

    it.effect("should handle routes with no params as empty object", () =>
      Effect.gen(function* () {
        const routes: ReadonlyArray<ParsedRoute> = [
          { path: "/about", params: [], query: [], children: [], isIndex: false },
        ];
        const output = yield* generateRouteTypes(routes);
        assert.isTrue(output.includes('readonly "/about": {}'));
      }),
    );

    it.effect("should generate module augmentation format", () =>
      Effect.gen(function* () {
        const routes: ReadonlyArray<ParsedRoute> = [
          { path: "/", params: [], query: [], children: [], isIndex: false },
        ];
        const output = yield* generateRouteTypes(routes);
        assert.isTrue(output.includes('declare module "trygg/router"'));
        assert.isTrue(output.includes("interface RouteMap"));
        assert.isTrue(output.includes("export {}"));
      }),
    );
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // Scope: transformRoutesForBuild
  // ─────────────────────────────────────────────────────────────────────────────
  describe("transformRoutesForBuild", () => {
    it.effect("should transform component imports to lazy", () =>
      Effect.gen(function* () {
        const source = `
import { UserProfile } from "./pages/users/profile"
import { About } from "./pages/about"

Route.make("/users/:id").component(UserProfile)
Route.make("/about").component(About)
`;
        const result = yield* transformRoutesForBuild(source, "/app/routes.ts");
        assert.isTrue(
          result.includes(
            '.component(() => import("./pages/users/profile").then(m => m.UserProfile))',
          ),
        );
        assert.isTrue(
          result.includes('.component(() => import("./pages/about").then(m => m.About))'),
        );
      }),
    );

    it.effect("should preserve imports in dev mode (no transform for non-routes files)", () =>
      Effect.gen(function* () {
        const source = `
import { UserProfile } from "./pages/users/profile"
Route.make("/users/:id").component(UserProfile)
`;
        // When source has no relative imports that match, it stays unchanged
        const result = yield* transformRoutesForBuild(source, "/app/routes.ts");
        // Verify the transform DID fire (it should transform the import)
        assert.isTrue(result.includes("import("));
      }),
    );

    it.effect("should transform default imports", () =>
      Effect.gen(function* () {
        const source = `
import HomePage from "./pages/home"
Route.make("/").component(HomePage)
`;
        const result = yield* transformRoutesForBuild(source, "/app/routes.ts");
        assert.isTrue(result.includes('.component(() => import("./pages/home"))'));
      }),
    );

    it.effect("should not transform non-relative imports", () =>
      Effect.gen(function* () {
        const source = `
import { Schema } from "effect"
import { Route } from "trygg/router"
Route.make("/users").component(Route)
`;
        const result = yield* transformRoutesForBuild(source, "/app/routes.ts");
        // "Route" from "trygg/router" is not relative, so not transformed
        assert.isTrue(result.includes(".component(Route)"));
      }),
    );

    it.effect("should transform layout imports", () =>
      Effect.gen(function* () {
        const source = `
import { SettingsLayout } from "./pages/settings/layout"
Route.make("/settings").layout(SettingsLayout)
`;
        const result = yield* transformRoutesForBuild(source, "/app/routes.ts");
        assert.isTrue(
          result.includes(
            '.layout(() => import("./pages/settings/layout").then(m => m.SettingsLayout))',
          ),
        );
      }),
    );

    it.effect("should NOT transform boundary components (loading/error/notFound/forbidden)", () =>
      Effect.gen(function* () {
        const source = `
import { ErrorComp } from "./components/error"
import { LoadingComp } from "./components/loading"
Route.make("/users").error(ErrorComp).loading(LoadingComp)
`;
        const result = yield* transformRoutesForBuild(source, "/app/routes.ts");
        // Boundary components must stay static — they are fallback UI
        assert.isTrue(result.includes(".error(ErrorComp)"));
        assert.isTrue(result.includes(".loading(LoadingComp)"));
        assert.isFalse(result.includes('import("./components/error")'));
        assert.isFalse(result.includes('import("./components/loading")'));
      }),
    );

    it.effect("should handle empty source", () =>
      Effect.gen(function* () {
        const result = yield* transformRoutesForBuild("", "/app/routes.ts");
        assert.strictEqual(result, "");
      }),
    );

    // ─────────────────────────────────────────────────────────────────────────
    // RenderStrategy.Eager detection
    // ─────────────────────────────────────────────────────────────────────────

    it.effect("should NOT transform Eager route components", () =>
      Effect.gen(function* () {
        const source = `
import HomePage from "./pages/home"
import AboutPage from "./pages/about"

Route.make("/").component(HomePage).pipe(Route.provide(RenderStrategy.Eager))
Route.make("/about").component(AboutPage)
`;
        const result = yield* transformRoutesForBuild(source, "/app/routes.ts");
        assert.isTrue(result.includes(".component(HomePage)"));
        assert.isTrue(result.includes('import("./pages/about")'));
      }),
    );

    it.effect("child inherits Eager from parent via .children()", () =>
      Effect.gen(function* () {
        const source = `
import UsersPage from "./pages/users"

Route.make("/admin")
  .pipe(Route.provide(RenderStrategy.Eager))
  .children(
    Route.make("/users").component(UsersPage),
  )
`;
        const result = yield* transformRoutesForBuild(source, "/app/routes.ts");
        assert.isTrue(result.includes(".component(UsersPage)"));
        assert.isFalse(result.includes('import("./pages/users")'));
      }),
    );

    it.effect("child Lazy override transforms despite Eager parent", () =>
      Effect.gen(function* () {
        const source = `
import AnalyticsPage from "./pages/analytics"

Route.make("/admin")
  .pipe(Route.provide(RenderStrategy.Eager))
  .children(
    Route.make("/analytics")
      .component(AnalyticsPage)
      .pipe(Route.provide(RenderStrategy.Lazy)),
  )
`;
        const result = yield* transformRoutesForBuild(source, "/app/routes.ts");
        assert.isTrue(result.includes('import("./pages/analytics")'));
      }),
    );

    it.effect("detects Eager when .pipe() follows .children()", () =>
      Effect.gen(function* () {
        const source = `
import UsersPage from "./pages/users"

Route.make("/admin")
  .children(
    Route.make("/users").component(UsersPage),
  )
  .pipe(Route.provide(RenderStrategy.Eager))
`;
        const result = yield* transformRoutesForBuild(source, "/app/routes.ts");
        assert.isTrue(result.includes(".component(UsersPage)"));
      }),
    );

    it.effect("grandchild inherits Eager through nested .children()", () =>
      Effect.gen(function* () {
        const source = `
import ProfilePage from "./pages/profile"

Route.make("/admin")
  .pipe(Route.provide(RenderStrategy.Eager))
  .children(
    Route.make("/settings")
      .children(
        Route.make("/profile").component(ProfilePage),
      ),
  )
`;
        const result = yield* transformRoutesForBuild(source, "/app/routes.ts");
        assert.isTrue(result.includes(".component(ProfilePage)"));
      }),
    );

    it.effect("sibling Eager does not affect other siblings", () =>
      Effect.gen(function* () {
        const source = `
import UsersPage from "./pages/users"
import LogsPage from "./pages/logs"

Route.make("/admin")
  .children(
    Route.make("/users").component(UsersPage).pipe(Route.provide(RenderStrategy.Eager)),
    Route.make("/logs").component(LogsPage),
  )
`;
        const result = yield* transformRoutesForBuild(source, "/app/routes.ts");
        assert.isTrue(result.includes(".component(UsersPage)"));
        assert.isTrue(result.includes('import("./pages/logs")'));
      }),
    );

    it.effect("ignores RenderStrategy.Eager in comments", () =>
      Effect.gen(function* () {
        const source = `
import HomePage from "./pages/home"

// RenderStrategy.Eager was considered but removed
Route.make("/").component(HomePage)
`;
        const result = yield* transformRoutesForBuild(source, "/app/routes.ts");
        assert.isTrue(result.includes('import("./pages/home")'));
      }),
    );

    it.effect("parent Lazy blocks grandparent Eager", () =>
      Effect.gen(function* () {
        const source = `
import ProfilePage from "./pages/profile"

Route.make("/admin")
  .pipe(Route.provide(RenderStrategy.Eager))
  .children(
    Route.make("/settings")
      .pipe(Route.provide(RenderStrategy.Lazy))
      .children(
        Route.make("/profile").component(ProfilePage),
      ),
  )
`;
        const result = yield* transformRoutesForBuild(source, "/app/routes.ts");
        assert.isTrue(result.includes('import("./pages/profile")'));
      }),
    );

    it.effect("mixed children: Eager parent, one child overrides to Lazy", () =>
      Effect.gen(function* () {
        const source = `
import UsersPage from "./pages/users"
import LogsPage from "./pages/logs"
import AnalyticsPage from "./pages/analytics"

Route.make("/admin")
  .pipe(Route.provide(RenderStrategy.Eager))
  .children(
    Route.make("/users").component(UsersPage),
    Route.make("/logs").component(LogsPage),
    Route.make("/analytics")
      .component(AnalyticsPage)
      .pipe(Route.provide(RenderStrategy.Lazy)),
  )
`;
        const result = yield* transformRoutesForBuild(source, "/app/routes.ts");
        assert.isTrue(result.includes(".component(UsersPage)"));
        assert.isTrue(result.includes(".component(LogsPage)"));
        assert.isTrue(result.includes('import("./pages/analytics")'));
      }),
    );

    it.effect("layout inherits Eager from parent (not transformed)", () =>
      Effect.gen(function* () {
        const source = `
import AdminLayout from "./layouts/admin"

Route.make("/admin")
  .layout(AdminLayout)
  .pipe(Route.provide(RenderStrategy.Eager))
`;
        const result = yield* transformRoutesForBuild(source, "/app/routes.ts");
        assert.isTrue(result.includes(".layout(AdminLayout)"));
      }),
    );
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // Scope: Plugin options
  // ─────────────────────────────────────────────────────────────────────────────
  describe("trygg with options", () => {
    it("should accept platform and output options", () => {
      const plugin = trygg({ platform: "bun", output: "server" });
      assert.isDefined(plugin);
      assert.strictEqual(plugin.name, "trygg");
    });

    it("should work without options", () => {
      const plugin = trygg();
      assert.isDefined(plugin);
      assert.strictEqual(plugin.name, "trygg");
    });
  });
});
