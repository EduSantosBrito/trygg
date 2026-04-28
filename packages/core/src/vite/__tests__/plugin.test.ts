/**
 * Tests for Vite plugin
 * @module
 */
import { assert, describe, it } from "@effect/vitest";
import { scoped } from "../../testing/effect-vitest.js";
import { layer as NodeFileSystemLayer } from "@effect/platform-node/NodeFileSystem";
import { Cause, Effect, Exit, FileSystem, Layer, Schema, Scope } from "effect";
import { createServer as createHttpServer, request as httpRequest } from "node:http";
import type { IncomingMessage, ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import * as path from "path";
import { createServer as createViteServer } from "vite";
import {
  trygg,
  extractParamNames,
  generateParamType,
  parseRoutes,
  generateRouteTypes,
  transformRoutesForBuild,
  validateApiPlatform,
  makeClientEntryModuleOwner,
  renderClientEntryModule,
  renderProductionServerEntryModule,
  PluginBootstrapError,
  PluginValidationError,
  schemaToType,
  parseSchemaStruct,
  resolveRoutePaths,
  PluginFiles,
  makePluginFilesLayer,
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
    const dir = yield* fs
      .makeTempDirectory({ directory: process.cwd(), prefix: "trygg-test-" })
      .pipe(Effect.orDie);
    yield* Effect.addFinalizer(() => fs.remove(dir, { recursive: true }).pipe(Effect.ignore));
    yield* Effect.forEach(Object.entries(files), ([filePath, content]) =>
      Effect.gen(function* () {
        const fullPath = path.join(dir, filePath);
        yield* fs.makeDirectory(path.dirname(fullPath), { recursive: true }).pipe(
          Effect.catchTag("PlatformError", (e) =>
            e.reason._tag === "AlreadyExists" ? Effect.void : Effect.fail(e),
          ),
          Effect.orDie,
        );
        yield* fs.writeFileString(fullPath, content).pipe(Effect.orDie);
      }),
    );
    return dir;
  });

const isAddressInfo = (address: AddressInfo | string | null): address is AddressInfo =>
  typeof address === "object" && address !== null;

const LoadHookSchema = Schema.declare(
  (u: unknown): u is (id: string) => Promise<string | null> => typeof u === "function",
);

const ResolveIdHookSchema = Schema.declare(
  (u: unknown): u is (id: string) => string | null => typeof u === "function",
);

interface HandlerFactoryBoundaryModule {
  readonly makeApiLayer: (
    mod: Record<string, unknown>,
  ) => Effect.Effect<Layer.Layer<unknown>, unknown>;
  readonly makeWebHandler: (apiLive: Layer.Layer<unknown>) => {
    readonly handler: (request: Request) => Promise<Response>;
    readonly dispose: () => void;
  };
  readonly makeNodeHandler: (apiLive: Layer.Layer<unknown>) => Effect.Effect<unknown, unknown>;
  readonly fromNodeRequest: (req: IncomingMessage) => Promise<Request>;
  readonly toNodeResponse: (response: Response, res: ServerResponse) => Promise<void>;
  readonly getBody: (req: IncomingMessage) => Promise<Uint8Array | undefined>;
}

interface HttpResult {
  readonly status: number;
  readonly bridgeHeader: string | undefined;
  readonly body: string;
}

const HandlerFactoryBoundaryModuleSchema = Schema.Struct({
  makeApiLayer: Schema.declare(
    (u: unknown): u is HandlerFactoryBoundaryModule["makeApiLayer"] => typeof u === "function",
  ),
  makeWebHandler: Schema.declare(
    (u: unknown): u is HandlerFactoryBoundaryModule["makeWebHandler"] => typeof u === "function",
  ),
  makeNodeHandler: Schema.declare(
    (u: unknown): u is HandlerFactoryBoundaryModule["makeNodeHandler"] => typeof u === "function",
  ),
  fromNodeRequest: Schema.declare(
    (u: unknown): u is HandlerFactoryBoundaryModule["fromNodeRequest"] => typeof u === "function",
  ),
  toNodeResponse: Schema.declare(
    (u: unknown): u is HandlerFactoryBoundaryModule["toNodeResponse"] => typeof u === "function",
  ),
  getBody: Schema.declare(
    (u: unknown): u is HandlerFactoryBoundaryModule["getBody"] => typeof u === "function",
  ),
});

const loadHandlerFactoryModule = (): Effect.Effect<
  HandlerFactoryBoundaryModule,
  Error,
  FileSystem.FileSystem | Scope.Scope
> =>
  Effect.gen(function* () {
    const root = yield* makeTempDir({
      "app/layout.tsx": "export default function Layout() { return <html><body /></html> }",
      "app/routes.ts": "export const routes = { manifest: [] }",
    });
    const server = yield* Effect.acquireRelease(
      Effect.promise(() =>
        createViteServer({
          root,
          configFile: false,
          plugins: [trygg({ platform: "node", output: "server" })],
        }),
      ),
      (viteServer) => Effect.promise(() => viteServer.close()).pipe(Effect.ignore),
    );
    const rawModule = yield* Effect.promise(() =>
      server.ssrLoadModule("virtual:trygg/handler-factory"),
    );
    return Schema.decodeUnknownSync(HandlerFactoryBoundaryModuleSchema)(rawModule);
  });

describe("Vite Plugin", () => {
  // ─────────────────────────────────────────────────────────────────────────────
  // Scope: Plugin initialization
  // ─────────────────────────────────────────────────────────────────────────────
  describe("trygg function", () => {
    const BuildStartHookSchema = Schema.declare(
      (u: unknown): u is () => Promise<void> => typeof u === "function",
    );

    const ConfigResolvedHookSchema = Schema.declare(
      (
        u: unknown,
      ): u is (config: { readonly root: string; readonly command: string }) => Promise<void> =>
        typeof u === "function",
    );

    it("should return a valid Vite plugin", () => {
      const plugin = trygg();

      assert.isDefined(plugin);
      assert.isString(plugin.name);
      assert.strictEqual(plugin.name, "trygg");
      assert.isDefined(plugin.config);
    });

    it("should buildStart do not observe partial bootstrap while configResolved has not run", async () => {
      // Test: should buildStart do not observe partial bootstrap while configResolved has not run
      // Scope: guards the config-dependent hook boundary so plugin work cannot read uninitialized state.
      // Assertion: buildStart rejects with PluginBootstrapError instead of crashing with an untyped error.
      const plugin = trygg();
      const buildStart = Schema.decodeUnknownSync(BuildStartHookSchema)(plugin.buildStart);

      try {
        await buildStart();
        throw new Error("Expected buildStart to fail before configResolved");
      } catch (error) {
        if (!(error instanceof PluginBootstrapError)) {
          throw error;
        }
        assert.strictEqual(error.reason, "NotReady");
      }
    });

    scoped("should buildStart generate build files after configResolved", () =>
      Effect.gen(function* () {
        // Test: should buildStart generate build files after configResolved
        // Scope: verifies configResolved bootstraps shared plugin-instance state for buildStart.
        // Assertion: buildStart succeeds and writes the build entry files from resolved config state.
        const fs = yield* FileSystem.FileSystem;
        const root = yield* makeTempDir({
          "app/layout.tsx": "export default function Layout() { return <html><body /></html> }",
          "app/routes.ts": `
import { Route } from "trygg/router"

Route.make("/users/:id")
  .params(Schema.Struct({ id: Schema.NumberFromString }))
  .component(UsersPage)

export const routes = { manifest: [] }
`,
        });
        const plugin = trygg();
        const configResolved = Schema.decodeUnknownSync(ConfigResolvedHookSchema)(
          plugin.configResolved,
        );
        const buildStart = Schema.decodeUnknownSync(BuildStartHookSchema)(plugin.buildStart);

        yield* Effect.promise(() => configResolved({ root, command: "build" }));
        yield* Effect.promise(() => buildStart());

        const entry = yield* fs.readFileString(path.join(root, ".trygg", "entry.tsx"));
        const index = yield* fs.readFileString(path.join(root, ".trygg", "index.html"));
        const routeTypes = yield* fs.readFileString(path.join(root, ".trygg", "routes.d.ts"));

        assert.strictEqual(
          entry,
          renderClientEntryModule(
            makeClientEntryModuleOwner({
              appDir: path.join(root, "app"),
              generatedDir: path.join(root, ".trygg"),
              routesFilePath: path.join(root, "app", "routes.ts"),
            }),
          ),
        );
        assert.include(index, '<script type="module" src="/.trygg/entry.tsx"></script>');
        assert.include(routeTypes, 'readonly "/users/:id": { readonly id: number }');
      }).pipe(Effect.provide(NodeFileSystemLayer)),
    );

    scoped("should configureServer generate dev entry and serve SPA shell through Vite", () =>
      Effect.gen(function* () {
        // Test: should configureServer generate dev entry and serve SPA shell through Vite
        // Scope: covers the real dev-server hook path from Vite bootstrap to middleware response.
        // Assertion: generated entry exists and a non-file GET returns the transformed SPA shell.
        const fs = yield* FileSystem.FileSystem;
        const root = yield* makeTempDir({
          "app/layout.tsx": "export default function Layout() { return <html><body /></html> }",
          "app/routes.ts": "export const routes = { manifest: [] }",
        });
        const server = yield* Effect.acquireRelease(
          Effect.promise(() =>
            createViteServer({
              root,
              configFile: false,
              server: { host: "127.0.0.1", port: 0 },
              plugins: [trygg()],
            }),
          ),
          (viteServer) => Effect.promise(() => viteServer.close()).pipe(Effect.ignore),
        );

        yield* Effect.promise(() => server.listen(0));
        const address = server.httpServer?.address() ?? null;
        if (!isAddressInfo(address)) {
          throw new Error("Expected Vite dev server to listen on a TCP port");
        }

        const entry = yield* fs.readFileString(path.join(root, ".trygg", "entry.tsx"));
        const response = yield* Effect.promise(() =>
          fetch(`http://127.0.0.1:${address.port}/dashboard?tab=dev`, {
            headers: { accept: "text/html" },
          }),
        );
        const html = yield* Effect.promise(() => response.text());

        assert.strictEqual(response.status, 200);
        assert.include(entry, 'import { routes } from "../app/routes"');
        assert.include(html, '<script type="module" src="/.trygg/entry.tsx"></script>');
      }).pipe(Effect.provide(NodeFileSystemLayer)),
    );

    scoped("should load handler factory virtual module with make vocabulary", () =>
      Effect.gen(function* () {
        // Test: should load handler factory virtual module with make vocabulary
        // Scope: validates the SSR-loaded virtual module contract at the plugin load boundary.
        // Assertion: generated module exports make/from/to/get names and omits superseded create/detect names.
        const plugin = trygg({ platform: "node", output: "server" });
        const resolveId = Schema.decodeUnknownSync(ResolveIdHookSchema)(plugin.resolveId);
        const load = Schema.decodeUnknownSync(LoadHookSchema)(plugin.load);
        const resolvedId = resolveId("virtual:trygg/handler-factory");
        if (resolvedId === null) {
          return yield* Effect.die(new Error("Expected handler factory virtual module to resolve"));
        }

        const code = yield* Effect.promise(() => load(resolvedId));
        if (code === null) {
          return yield* Effect.die(new Error("Expected handler factory virtual module to load"));
        }

        const mod = yield* loadHandlerFactoryModule();
        assert.isFunction(mod.makeApiLayer);
        assert.isFunction(mod.makeWebHandler);
        assert.isFunction(mod.makeNodeHandler);
        assert.isFunction(mod.fromNodeRequest);
        assert.isFunction(mod.toNodeResponse);
        assert.isFunction(mod.getBody);
        assert.notInclude(code, "detectAndComposeLayer");
        assert.notInclude(code, "createWebHandler");
        assert.notInclude(code, "createNodeHandler");
      }).pipe(Effect.provide(NodeFileSystemLayer)),
    );

    scoped("should bridge node request and response at handler factory boundary", () =>
      Effect.gen(function* () {
        // Test: should bridge node request and response at handler factory boundary
        // Scope: covers generated Node factory helpers where IncomingMessage/ServerResponse meet web Request/Response.
        // Assertion: body, headers, URL, status, and response headers round-trip through fromNodeRequest/toNodeResponse.
        const mod = yield* loadHandlerFactoryModule();

        const server = yield* Effect.acquireRelease(
          Effect.sync(() =>
            createHttpServer((req, res) => {
              void mod
                .fromNodeRequest(req)
                .then(async (request) => {
                  const body = await request.text();
                  const response = new Response(`${request.method} ${request.url} ${body}`, {
                    status: 201,
                    headers: { "x-bridge": request.headers.get("x-repeat") ?? "" },
                  });
                  await mod.toNodeResponse(response, res);
                })
                .catch(() => {
                  res.statusCode = 500;
                  res.end("bridge failed");
                });
            }),
          ),
          (httpServer) =>
            Effect.promise<void>(
              () =>
                new Promise((resolve) => {
                  httpServer.close(() => resolve());
                }),
            ),
        );
        yield* Effect.promise<void>(
          () =>
            new Promise((resolve) => {
              server.listen(0, "127.0.0.1", () => resolve());
            }),
        );
        const address = server.address();
        if (!isAddressInfo(address)) {
          return yield* Effect.die(new Error("Expected test HTTP server to listen on a TCP port"));
        }

        const response = yield* Effect.promise<HttpResult>(
          () =>
            new Promise((resolve, reject) => {
              const req = httpRequest(
                {
                  hostname: "127.0.0.1",
                  port: address.port,
                  path: "/api/widgets?debug=1",
                  method: "POST",
                  headers: { "x-repeat": "alpha, beta" },
                },
                (res) => {
                  const chunks: Array<string> = [];
                  res.setEncoding("utf8");
                  res.on("data", (chunk: string) => chunks.push(chunk));
                  res.on("end", () => {
                    const bridgeHeader = res.headers["x-bridge"];
                    resolve({
                      status: res.statusCode ?? 0,
                      bridgeHeader: Array.isArray(bridgeHeader)
                        ? bridgeHeader.join(", ")
                        : bridgeHeader,
                      body: chunks.join(""),
                    });
                  });
                },
              );
              req.on("error", reject);
              req.end("payload");
            }),
        );

        assert.strictEqual(response.status, 201);
        assert.strictEqual(response.bridgeHeader, "alpha, beta");
        assert.strictEqual(
          response.body,
          `POST http://127.0.0.1:${address.port}/api/widgets?debug=1 payload`,
        );
      }).pipe(Effect.provide(NodeFileSystemLayer)),
    );
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // Scope: PluginFiles service
  // ─────────────────────────────────────────────────────────────────────────────
  describe("PluginFiles", () => {
    scoped("should write generated route types from canonical app routes path", () =>
      Effect.gen(function* () {
        // Test: should write generated route types from canonical app routes path
        // Scope: verifies route generation at the PluginFiles service boundary.
        // Assertion: writes unchanged route type content to the generated routes path.
        const fs = yield* FileSystem.FileSystem;
        const root = yield* makeTempDir({
          "app/routes.ts": `
import { Route } from "trygg/router"

Route.make("/users/:id")
  .params(Schema.Struct({ id: Schema.NumberFromString }))
  .component(UsersPage)
`,
        });
        const files = yield* PluginFiles;
        const paths = { appDir: path.join(root, "app"), generatedDir: path.join(root, ".trygg") };

        yield* files.writeGeneratedRouteTypes(paths);

        const routeTypes = yield* fs.readFileString(path.join(root, ".trygg", "routes.d.ts"));
        assert.include(routeTypes, 'readonly "/users/:id": { readonly id: number }');
      }).pipe(Effect.provide(Layer.mergeAll(NodeFileSystemLayer, makePluginFilesLayer()))),
    );

    scoped("should derive routes file path from canonical app directory", () =>
      Effect.gen(function* () {
        // Test: should derive routes file path from canonical app directory
        // Scope: verifies path behavior at the PluginFiles service boundary.
        // Assertion: app/routes.ts is reported only when it exists under the provided appDir.
        const root = yield* makeTempDir({
          "app/routes.ts": "export const routes = { manifest: [] }",
        });
        const files = yield* PluginFiles;

        const existing = yield* files.routesFilePath({
          appDir: path.join(root, "app"),
          generatedDir: path.join(root, ".trygg"),
        });
        const missing = yield* files.routesFilePath({
          appDir: path.join(root, "other-app"),
          generatedDir: path.join(root, ".trygg"),
        });

        assert.strictEqual(existing, path.join(root, "app", "routes.ts"));
        assert.isUndefined(missing);
      }).pipe(Effect.provide(Layer.mergeAll(NodeFileSystemLayer, makePluginFilesLayer()))),
    );

    scoped("should match routes file by normalized path", () =>
      Effect.gen(function* () {
        // Test: should match routes file by normalized path
        // Scope: verifies semantic route path matching at the PluginFiles boundary.
        // Assertion: equivalent paths identify the canonical app/routes.ts file.
        const root = yield* makeTempDir({
          "app/routes.ts": "export const routes = { manifest: [] }",
        });
        const files = yield* PluginFiles;
        const paths = { appDir: path.join(root, "app"), generatedDir: path.join(root, ".trygg") };
        const equivalentPath = path.join(root, "app", "..", "app", "routes.ts");

        const matches = yield* files.isRoutesFile(paths, equivalentPath);

        assert.isTrue(matches);
      }).pipe(Effect.provide(Layer.mergeAll(NodeFileSystemLayer, makePluginFilesLayer()))),
    );
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // Scope: Generated module owners
  // ─────────────────────────────────────────────────────────────────────────────
  describe("generated module owners", () => {
    it("should render client entry module from semantic owner paths", () => {
      // Test: should render client entry module from semantic owner paths
      // Scope: covers owner-oriented entry module output without Vite or filesystem effects.
      // Assertion: output keeps the existing imports and mount semantics unchanged.
      const owner = makeClientEntryModuleOwner({
        appDir: "/workspace/app",
        generatedDir: "/workspace/.trygg",
        routesFilePath: "/workspace/app/routes.ts",
      });

      assert.strictEqual(
        renderClientEntryModule(owner),
        `// Auto-generated by trygg - DO NOT EDIT
import { mountDocument, Component } from "trygg"
import { routes } from "../app/routes"
import Layout from "../app/layout"

const App = Component.gen(function* () {
  return <Layout />
})

mountDocument(<App />, { manifest: routes.manifest })
`,
      );
    });

    it("should render production server entry module from owner state", () => {
      // Test: should render production server entry module from owner state
      // Scope: covers platform/API server codegen decisions without Vite or filesystem effects.
      // Assertion: output keeps platform imports, API wiring, and server layer selection stable.
      const output = renderProductionServerEntryModule({
        hasApi: true,
        platform: {
          imports: [
            'import * as NodeHttpServer from "@effect/platform-node/NodeHttpServer"',
            'import * as NodeRuntime from "@effect/platform-node/NodeRuntime"',
            'import { createServer } from "node:http"',
          ].join("\n"),
          serverLayer: "NodeHttpServer.layer(() => createServer(), { port: PORT, host: HOST })",
          runtime: "NodeRuntime",
        },
      });

      assert.include(output, 'import ApiLive from "../app/api.js"');
      assert.include(output, "const ServerLive = HttpRouter.serve(ApiLive, {");
      assert.include(
        output,
        "Layer.provide(NodeHttpServer.layer(() => createServer(), { port: PORT, host: HOST }))",
      );
      assert.include(output, "NodeRuntime.runMain(");
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
    scoped("should reject platform-node imports when platform is bun", () =>
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

    scoped("should allow platform-node imports when platform is node", () =>
      Effect.gen(function* () {
        const dir = yield* makeTempDir({
          "app/api.ts":
            'import { NodeHttpServer } from "@effect/platform-node"\nexport const Api = {}',
        });
        const apiPath = path.join(dir, "app", "api.ts");

        yield* validateApiPlatform(apiPath, "node");
      }).pipe(Effect.provide(NodeFileSystemLayer)),
    );

    scoped("should allow bun platform when no node imports", () =>
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
