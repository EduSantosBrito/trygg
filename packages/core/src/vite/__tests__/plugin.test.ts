/**
 * Tests for Vite plugin
 * @module
 */
import { assert, describe, it } from "@effect/vitest";
import { scoped } from "../../testing/effect-vitest.js";
import { layer as NodeFileSystemLayer } from "@effect/platform-node/NodeFileSystem";
import {
  Cause,
  Context,
  Deferred,
  Effect,
  Exit,
  Fiber,
  FileSystem,
  Layer,
  Logger,
  Schema,
  Scope,
} from "effect";
import { createServer as createHttpServer, request as httpRequest } from "node:http";
import type { IncomingMessage, ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import * as path from "path";
import { createServer as createViteServer } from "vite";
import { ApiInitError, DevPlatform, NodeServerPlatform } from "../dev-platform.js";
import { NodeDevPlatformLive } from "../dev-platform-node.js";
import type { Connect } from "vite";
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
  PluginApi,
  makePluginFilesLayer,
  makePluginApi,
  makeViteServer,
  makeStableHandlerFactoryLoader,
  generateHtmlTemplate,
  makeBuildOutput,
  type ParsedRoute,
  type ViteServerSource,
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

const STATIC_API_WARNING =
  '⚠ API routes in app/api.ts will not be included in static build.\n  Deploy your API separately or use output: "server".';

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

    const CloseBundleHookSchema = Schema.declare(
      (u: unknown): u is () => Promise<void> => typeof u === "function",
    );

    const ResolveIdHookSchema = Schema.declare(
      (u: unknown): u is (id: string) => string | null => typeof u === "function",
    );

    const LoadHookSchema = Schema.declare(
      (u: unknown): u is (id: string) => Promise<string | null> => typeof u === "function",
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

    scoped("should build output write static files and skip server output", () =>
      Effect.gen(function* () {
        // Test: should build output write static files and skip server output
        // Scope: covers static production output at the build output service boundary.
        // Assertion: client build files exist and closeBundle does not emit a server entry.
        const fs = yield* FileSystem.FileSystem;
        const root = yield* makeTempDir({
          "app/layout.tsx": "export default function Layout() { return <html><body /></html> }",
          "app/routes.ts": "export const routes = { manifest: [] }",
          "app/api.ts": "export default {}",
        });
        const appDir = path.join(root, "app");
        const generatedDir = path.join(root, ".trygg");
        const warnings: Array<string> = [];
        const warningLogger = Logger.make<unknown, void>(({ logLevel, message }) => {
          if (logLevel === "Warn") {
            warnings.push(String(message));
          }
        });
        const buildOutput = makeBuildOutput({ buildServer: () => Effect.void });

        yield* buildOutput
          .buildStart({
            appDir,
            generatedDir,
            config: { command: "build", root },
            output: "static",
            platform: "node",
          })
          .pipe(Effect.provide(Logger.layer([warningLogger])));
        yield* buildOutput.closeBundle({
          appDir,
          generatedDir,
          config: { command: "build", root },
          output: "static",
        });

        const indexExists = yield* fs.exists(path.join(generatedDir, "index.html"));
        const serverEntryExists = yield* fs.exists(path.join(generatedDir, "server-entry.ts"));

        assert.isTrue(indexExists);
        assert.isFalse(serverEntryExists);
        assert.deepStrictEqual(warnings, [STATIC_API_WARNING]);
      }).pipe(
        Effect.provide(
          Layer.mergeAll(NodeFileSystemLayer, makePluginFilesLayer(), NodeServerPlatform),
        ),
      ),
    );

    scoped("should build output static without api file not warn", () =>
      Effect.gen(function* () {
        // Test: should build output static without api file not warn
        // Scope: covers the static build hook service path when app/api.ts is absent.
        // Assertion: client build files exist and no API exclusion warning is logged.
        const fs = yield* FileSystem.FileSystem;
        const root = yield* makeTempDir({
          "app/layout.tsx": "export default function Layout() { return <html><body /></html> }",
          "app/routes.ts": "export const routes = { manifest: [] }",
        });
        const appDir = path.join(root, "app");
        const generatedDir = path.join(root, ".trygg");
        const warnings: Array<string> = [];
        const warningLogger = Logger.make<unknown, void>(({ logLevel, message }) => {
          if (logLevel === "Warn") {
            warnings.push(String(message));
          }
        });
        const buildOutput = makeBuildOutput({ buildServer: () => Effect.void });

        yield* buildOutput
          .buildStart({
            appDir,
            generatedDir,
            config: { command: "build", root },
            output: "static",
            platform: "node",
          })
          .pipe(Effect.provide(Logger.layer([warningLogger])));

        const indexExists = yield* fs.exists(path.join(generatedDir, "index.html"));

        assert.isTrue(indexExists);
        assert.deepStrictEqual(warnings, []);
      }).pipe(
        Effect.provide(
          Layer.mergeAll(NodeFileSystemLayer, makePluginFilesLayer(), NodeServerPlatform),
        ),
      ),
    );

    scoped("should build output write server entry and invoke server build", () =>
      Effect.gen(function* () {
        // Test: should build output write server entry and invoke server build
        // Scope: covers server production output at the build output service boundary.
        // Assertion: closeBundle emits the server entry with API wiring and invokes the server build once.
        const fs = yield* FileSystem.FileSystem;
        const root = yield* makeTempDir({
          "app/layout.tsx": "export default function Layout() { return <html><body /></html> }",
          "app/routes.ts": "export const routes = { manifest: [] }",
          "app/api.ts": "export default {}",
        });
        const appDir = path.join(root, "app");
        const generatedDir = path.join(root, ".trygg");
        const builtEntries: Array<string> = [];
        const buildOutput = makeBuildOutput({
          buildServer: (serverEntryPath) =>
            Effect.sync(() => {
              builtEntries.push(serverEntryPath);
            }),
        });

        yield* buildOutput.closeBundle({
          appDir,
          generatedDir,
          config: { command: "build", root },
          output: "server",
        });

        const serverEntryPath = path.join(generatedDir, "server-entry.ts");
        const serverEntry = yield* fs.readFileString(serverEntryPath);

        assert.deepStrictEqual(builtEntries, [serverEntryPath]);
        assert.include(serverEntry, 'import ApiLive from "../app/api.js"');
        assert.include(serverEntry, "HttpRouter.serve(ApiLive");
      }).pipe(
        Effect.provide(
          Layer.mergeAll(NodeFileSystemLayer, makePluginFilesLayer(), NodeServerPlatform),
        ),
      ),
    );

    scoped("should closeBundle build production server without deleting client files", () =>
      Effect.gen(function* () {
        // Test: should closeBundle build production server without deleting client files
        // Scope: covers the production server build through the real plugin hook path.
        // Assertion: dist/server.js is emitted and an existing dist/client file remains.
        const fs = yield* FileSystem.FileSystem;
        const root = yield* makeTempDir({
          "app/layout.tsx": "export default function Layout() { return <html><body /></html> }",
          "app/routes.ts": "export const routes = { manifest: [] }",
        });
        const plugin = trygg({ platform: "node", output: "server" });
        const configResolved = Schema.decodeUnknownSync(ConfigResolvedHookSchema)(
          plugin.configResolved,
        );
        const buildStart = Schema.decodeUnknownSync(BuildStartHookSchema)(plugin.buildStart);
        const closeBundle = Schema.decodeUnknownSync(CloseBundleHookSchema)(plugin.closeBundle);
        const clientFile = path.join(root, "dist", "client", "client.txt");

        yield* Effect.promise(() => configResolved({ root, command: "build" }));
        yield* Effect.promise(() => buildStart());
        yield* fs.makeDirectory(path.dirname(clientFile), { recursive: true }).pipe(Effect.orDie);
        yield* fs.writeFileString(clientFile, "client artifact").pipe(Effect.orDie);

        yield* Effect.promise(() => closeBundle());

        const serverExists = yield* fs.exists(path.join(root, "dist", "server.js"));
        const clientExists = yield* fs.exists(clientFile);

        assert.isTrue(serverExists);
        assert.isTrue(clientExists);
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

    scoped("should mount API middleware through ViteServer adapter", () =>
      Effect.gen(function* () {
        // Test: should mount API middleware through ViteServer adapter
        // Scope: covers the adapter boundary where dev API middleware is installed into Vite.
        // Assertion: the named API mount operation registers the exact middleware with Vite.
        const mounted: Array<Connect.NextHandleFunction> = [];
        const middleware: Connect.NextHandleFunction = (_req, _res, next) => next();
        const source: ViteServerSource = {
          ssrLoadModule: () => Promise.resolve({}),
          watcher: { on: () => undefined },
          httpServer: undefined,
          middlewares: {
            use: (handler) => {
              mounted.push(handler);
            },
          },
          transformIndexHtml: (_url, html) => Promise.resolve(html),
        };

        yield* makeViteServer(source).mountApiMiddleware(middleware);

        assert.strictEqual(mounted.length, 1);
        assert.strictEqual(mounted[0], middleware);
      }),
    );

    scoped("should serve transformed HTML fallback through ViteServer adapter", () =>
      Effect.gen(function* () {
        // Test: should serve transformed HTML fallback through ViteServer adapter
        // Scope: covers the dev SPA fallback adapter path for non-file GET navigations.
        // Assertion: the response uses Vite HTML transforms and returns the SPA shell.
        const mounted: Array<Connect.NextHandleFunction> = [];
        const source: ViteServerSource = {
          ssrLoadModule: () => Promise.resolve({}),
          watcher: { on: () => undefined },
          httpServer: undefined,
          middlewares: {
            use: (handler) => {
              mounted.push(handler);
            },
          },
          transformIndexHtml: (url, html) =>
            Promise.resolve(`${html}\n<!-- transformed:${url} -->`),
        };

        yield* makeViteServer(source).mountHtmlFallbackMiddleware(generateHtmlTemplate());
        const middleware = mounted[0];
        if (middleware === undefined) {
          return yield* Effect.die(new Error("Expected HTML fallback middleware to mount"));
        }

        const server = yield* Effect.acquireRelease(
          Effect.sync(() =>
            createHttpServer((req, res) =>
              middleware(req, res, () => {
                res.statusCode = 404;
                res.end("next");
              }),
            ),
          ),
          (httpServer) =>
            Effect.promise(() => new Promise<void>((resolve) => httpServer.close(() => resolve()))),
        );
        yield* Effect.promise(
          () => new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve)),
        );
        const address = server.address();
        if (!isAddressInfo(address)) {
          return yield* Effect.die(new Error("Expected HTTP server to listen on a TCP port"));
        }

        const response = yield* Effect.promise<HttpResult>(
          () =>
            new Promise((resolve, reject) => {
              const req = httpRequest(
                { hostname: "127.0.0.1", port: address.port, path: "/dashboard?tab=dev" },
                (res) => {
                  const chunks: Array<string> = [];
                  res.setEncoding("utf8");
                  res.on("data", (chunk: string) => chunks.push(chunk));
                  res.on("end", () => {
                    const contentType = res.headers["content-type"];
                    resolve({
                      status: res.statusCode ?? 0,
                      bridgeHeader: Array.isArray(contentType)
                        ? contentType.join(", ")
                        : contentType,
                      body: chunks.join(""),
                    });
                  });
                },
              );
              req.on("error", reject);
              req.end();
            }),
        );

        assert.strictEqual(response.status, 200);
        assert.strictEqual(response.bridgeHeader, "text/html");
        assert.include(response.body, '<script type="module" src="/.trygg/entry.tsx"></script>');
        assert.include(response.body, "<!-- transformed:/dashboard?tab=dev -->");
      }),
    );

    scoped("should pass API and asset routes through HTML fallback adapter", () =>
      Effect.gen(function* () {
        // Test: should pass API and asset routes through HTML fallback adapter
        // Scope: covers route boundaries the dev SPA fallback must not rewrite.
        // Assertion: /api/* and file-like asset URLs call next instead of returning HTML.
        const mounted: Array<Connect.NextHandleFunction> = [];
        const source: ViteServerSource = {
          ssrLoadModule: () => Promise.resolve({}),
          watcher: { on: () => undefined },
          httpServer: undefined,
          middlewares: {
            use: (handler) => {
              mounted.push(handler);
            },
          },
          transformIndexHtml: (_url, html) => Promise.resolve(html),
        };

        yield* makeViteServer(source).mountHtmlFallbackMiddleware(generateHtmlTemplate());
        const middleware = mounted[0];
        if (middleware === undefined) {
          return yield* Effect.die(new Error("Expected HTML fallback middleware to mount"));
        }

        const server = yield* Effect.acquireRelease(
          Effect.sync(() =>
            createHttpServer((req, res) =>
              middleware(req, res, () => {
                res.statusCode = 204;
                res.end();
              }),
            ),
          ),
          (httpServer) =>
            Effect.promise(() => new Promise<void>((resolve) => httpServer.close(() => resolve()))),
        );
        yield* Effect.promise(
          () => new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve)),
        );
        const address = server.address();
        if (!isAddressInfo(address)) {
          return yield* Effect.die(new Error("Expected HTTP server to listen on a TCP port"));
        }

        const requestStatus = (pathName: string) =>
          Effect.promise<number>(
            () =>
              new Promise((resolve, reject) => {
                const req = httpRequest(
                  { hostname: "127.0.0.1", port: address.port, path: pathName },
                  (res) => {
                    res.resume();
                    res.on("end", () => resolve(res.statusCode ?? 0));
                  },
                );
                req.on("error", reject);
                req.end();
              }),
          );

        assert.strictEqual(yield* requestStatus("/api/users"), 204);
        assert.strictEqual(yield* requestStatus("/.trygg/entry.tsx"), 204);
      }),
    );

    scoped("should close API scope when Vite server closes", () =>
      Effect.gen(function* () {
        // Test: should close API scope when Vite server closes
        // Scope: covers cleanup ownership at the Vite server adapter boundary.
        // Assertion: triggering the registered Vite close handler runs API scope finalizers.
        const closeHandlers: Array<() => void> = [];
        const cleaned = yield* Deferred.make<void>();
        const source: ViteServerSource = {
          ssrLoadModule: () => Promise.resolve({}),
          watcher: { on: () => undefined },
          httpServer: {
            on: (_event, handler) => {
              closeHandlers.push(handler);
            },
          },
          middlewares: { use: () => undefined },
          transformIndexHtml: (_url, html) => Promise.resolve(html),
        };
        const scope = yield* Scope.make();
        let closeRuns = 0;
        const runPromise = (effect: Effect.Effect<void>) => {
          closeRuns += 1;
          return Effect.runPromise(effect);
        };
        yield* Scope.addFinalizer(scope, Deferred.succeed(cleaned, undefined).pipe(Effect.asVoid));

        yield* makeViteServer(source, runPromise).closeApiScopeOnServerClose(scope);
        for (const handler of closeHandlers) {
          handler();
        }

        assert.strictEqual(closeHandlers.length, 1);
        assert.strictEqual(closeRuns, 1);
        yield* Deferred.await(cleaned);
      }),
    );

    scoped("should delegate one api.ts reload request to PluginApi", () =>
      Effect.gen(function* () {
        // Test: should delegate one api.ts reload request to PluginApi
        // Scope: covers the file-change boundary between the Vite watcher and active API handle.
        // Assertion: an api.ts change runs exactly one reload and unrelated files do not reload.
        let reloads = 0;
        const api = makePluginApi({
          middleware: (_req, _res, next) => next(),
          reload: Effect.sync(() => {
            reloads += 1;
          }),
          dispose: Effect.void,
        });

        yield* api.reloadChangedFile(path.join("app", "api.ts"));
        yield* api.reloadChangedFile(path.join("app", "routes.ts"));

        assert.strictEqual(reloads, 1);
      }),
    );

    scoped("should keep dev middleware alive when PluginApi reload fails", () =>
      Effect.gen(function* () {
        // Test: should keep dev middleware alive when PluginApi reload fails
        // Scope: covers reload failure isolation at the dev watcher boundary.
        // Assertion: a typed reload failure is logged and does not fail the surrounding effect.
        const api = makePluginApi({
          middleware: (_req, _res, next) => next(),
          reload: Effect.fail(new ApiInitError({ message: "reload failed" })),
          dispose: Effect.void,
        });

        const exit = yield* Effect.exit(api.reloadChangedFile(path.join("app", "api.ts")));

        assert.isTrue(Exit.isSuccess(exit));
      }),
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

    scoped("should importing trygg/api fail clearly when app api module is missing", () =>
      Effect.gen(function* () {
        // Test: should importing trygg/api fail clearly when app api module is missing
        // Scope: covers the Vite virtual-module import boundary for generated API client loading.
        // Assertion: the user-visible error explains that app/api.ts must export Api.
        const root = yield* makeTempDir({
          "app/layout.tsx": "export default function Layout() { return <html><body /></html> }",
          "app/routes.ts": "export const routes = { manifest: [] }",
        });
        const plugin = trygg();
        const configResolved = Schema.decodeUnknownSync(ConfigResolvedHookSchema)(
          plugin.configResolved,
        );
        const resolveId = Schema.decodeUnknownSync(ResolveIdHookSchema)(plugin.resolveId);
        const load = Schema.decodeUnknownSync(LoadHookSchema)(plugin.load);

        yield* Effect.promise(() => configResolved({ root, command: "serve" }));
        const resolved = resolveId("trygg/api");
        assert.strictEqual(resolved, "\0trygg/api");

        const error = yield* Effect.promise(() =>
          load(resolved ?? "trygg/api").then(
            () => new Error("Expected trygg/api import to fail"),
            (cause) => cause,
          ),
        );

        assert.instanceOf(error, Error);
        assert.include(error.message, "app/api.ts must export Api");
      }).pipe(Effect.provide(NodeFileSystemLayer)),
    );

    scoped("should importing trygg/api fail clearly when app api module lacks Api export", () =>
      Effect.gen(function* () {
        // Test: should importing trygg/api fail clearly when app api module lacks Api export
        // Scope: covers validation before the generated client imports the app API module.
        // Assertion: the user-visible error explains the required export.
        const root = yield* makeTempDir({
          "app/layout.tsx": "export default function Layout() { return <html><body /></html> }",
          "app/routes.ts": "export const routes = { manifest: [] }",
          "app/api.ts": "const Api = {}\nexport default {}",
        });
        const plugin = trygg();
        const configResolved = Schema.decodeUnknownSync(ConfigResolvedHookSchema)(
          plugin.configResolved,
        );
        const resolveId = Schema.decodeUnknownSync(ResolveIdHookSchema)(plugin.resolveId);
        const load = Schema.decodeUnknownSync(LoadHookSchema)(plugin.load);

        yield* Effect.promise(() => configResolved({ root, command: "serve" }));
        const resolved = resolveId("trygg/api");
        assert.strictEqual(resolved, "\0trygg/api");

        const error = yield* Effect.promise(() =>
          load(resolved ?? "trygg/api").then(
            () => new Error("Expected trygg/api import to fail"),
            (cause) => cause,
          ),
        );

        assert.instanceOf(error, Error);
        assert.include(error.message, "app/api.ts must export Api");
      }).pipe(Effect.provide(NodeFileSystemLayer)),
    );

    scoped("should not validate app api when trygg/api is not imported", () =>
      Effect.gen(function* () {
        // Test: should not validate app api when trygg/api is not imported
        // Scope: guards apps that only use routing/layout and never request the generated API client.
        // Assertion: configResolved succeeds even without app/api.ts.
        const root = yield* makeTempDir({
          "app/layout.tsx": "export default function Layout() { return <html><body /></html> }",
          "app/routes.ts": "export const routes = { manifest: [] }",
        });
        const plugin = trygg();
        const configResolved = Schema.decodeUnknownSync(ConfigResolvedHookSchema)(
          plugin.configResolved,
        );

        yield* Effect.promise(() => configResolved({ root, command: "serve" }));
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

    scoped("should detect app api only when canonical path is a file", () =>
      Effect.gen(function* () {
        // Test: should detect app api only when canonical path is a file
        // Scope: verifies API path behavior at the PluginFiles service boundary.
        // Assertion: app/api.ts is reported for regular files, not missing paths or directories.
        const fs = yield* FileSystem.FileSystem;
        const root = yield* makeTempDir({
          "app/api.ts": "export default {}",
        });
        const directoryAppDir = path.join(root, "directory-app");
        yield* fs.makeDirectory(path.join(directoryAppDir, "api.ts"), { recursive: true });
        const files = yield* PluginFiles;
        const generatedDir = path.join(root, ".trygg");

        const existing = yield* files.appApiExists({
          appDir: path.join(root, "app"),
          generatedDir,
        });
        const directory = yield* files.appApiExists({ appDir: directoryAppDir, generatedDir });
        const missing = yield* files.appApiExists({
          appDir: path.join(root, "missing-app"),
          generatedDir,
        });

        assert.strictEqual(
          files.appApiPath({ appDir: path.join(root, "app"), generatedDir }),
          path.join(root, "app", "api.ts"),
        );
        assert.isTrue(existing);
        assert.isFalse(directory);
        assert.isFalse(missing);
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
  // Scope: DevPlatform service
  // ─────────────────────────────────────────────────────────────────────────────
  describe("DevPlatform", () => {
    scoped("should expose makeApi constructor naming on Node", () =>
      Effect.gen(function* () {
        // Test: should expose makeApi constructor naming on Node
        // Scope: covers the internal DevPlatform service contract used by API middleware setup.
        // Assertion: makeApi is present and the old createDevApi constructor name is absent.
        const devPlatform = yield* DevPlatform;

        assert.isFunction(devPlatform.makeApi);
        assert.strictEqual("createDevApi" in devPlatform, false);
      }).pipe(Effect.provide(NodeDevPlatformLive)),
    );

    scoped("should makeApi handle API middleware requests on Node", () =>
      Effect.gen(function* () {
        // Test: should makeApi handle API middleware requests on Node
        // Scope: verifies the platform API creation boundary through observable middleware behavior.
        // Assertion: a request under /api/ is handled by the generated middleware response.
        const devPlatform = yield* DevPlatform;
        const scope = yield* Effect.acquireRelease(Scope.make(), (apiScope) =>
          Scope.close(apiScope, Exit.void),
        );
        const apiLayer = Layer.succeedContext(Context.makeUnsafe<unknown>(new Map()));
        const module = { default: apiLayer };
        const handle = yield* Scope.provide(
          devPlatform.makeApi({
            loadApiModule: () => Effect.succeed(module),
            onError: () => Effect.void,
            handlerFactory: {
              makeApiLayer: () => Effect.succeed(apiLayer),
              makeNodeHandler: () =>
                Effect.succeed({
                  handler: (_req, res) => {
                    res.statusCode = 204;
                    res.end();
                  },
                  dispose: Effect.void,
                }),
              makeWebHandler: () => ({
                handler: () => Promise.resolve(new Response(null, { status: 204 })),
                dispose: () => undefined,
              }),
            },
          }),
          scope,
        );
        const server = yield* Effect.acquireRelease(
          Effect.sync(() =>
            createHttpServer((req, res) =>
              handle.middleware(req, res, () => {
                res.statusCode = 404;
                res.end();
              }),
            ),
          ),
          (httpServer) =>
            Effect.promise(() => new Promise<void>((resolve) => httpServer.close(() => resolve()))),
        );

        yield* Effect.promise(
          () => new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve)),
        );
        const address = server.address();
        if (!isAddressInfo(address)) {
          throw new Error("Expected HTTP server to listen on a TCP port");
        }

        const status = yield* Effect.promise(
          () =>
            new Promise<number>((resolve, reject) => {
              const req = httpRequest(
                { hostname: "127.0.0.1", port: address.port, path: "/api/health" },
                (res) => {
                  res.resume();
                  res.on("end", () => resolve(res.statusCode ?? 0));
                },
              );
              req.on("error", reject);
              req.end();
            }),
        );

        assert.strictEqual(status, 204);
      }).pipe(Effect.provide(NodeDevPlatformLive)),
    );
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // Scope: PluginApi initial lifecycle
  // ─────────────────────────────────────────────────────────────────────────────
  describe("PluginApi", () => {
    const apiLayer = Layer.succeedContext(Context.makeUnsafe<unknown>(new Map()));
    const handlerFactory = {
      makeApiLayer: () => Effect.succeed(apiLayer),
      makeWebHandler: () => ({
        handler: () => Promise.resolve(new Response(null, { status: 204 })),
        dispose: () => undefined,
      }),
    };

    scoped("should loadInitial expose absent state when api file is missing", () =>
      Effect.gen(function* () {
        // Test: should loadInitial expose absent state when api file is missing
        // Scope: covers the no-api boundary before any handler factory or platform API work starts.
        // Assertion: returns Absent and does not call API construction dependencies.
        const state = yield* PluginApi.loadInitial({
          apiPath: "/app/api.ts",
          hasApi: Effect.succeed(false),
          loadHandlerFactory: Effect.die(new Error("handler factory should not load")),
          makeApi: () => Effect.die(new Error("api should not load")),
        });

        assert.strictEqual(state._tag, "Absent");
      }),
    );

    scoped("should loadInitial expose ready state after successful api load", () =>
      Effect.gen(function* () {
        // Test: should loadInitial expose ready state after successful api load
        // Scope: covers the initial API construction boundary and loading observation.
        // Assertion: observes Loading before returning Ready with a middleware handle.
        const seen: Array<PluginApi.InitialState["_tag"]> = [];
        const state = yield* PluginApi.loadInitial({
          apiPath: "/app/api.ts",
          hasApi: Effect.succeed(true),
          loadHandlerFactory: Effect.succeed(handlerFactory),
          makeApi: () =>
            Effect.succeed({
              middleware: (_req, _res, next) => next(),
              reload: Effect.void,
              dispose: Effect.void,
            }),
          observe: (nextState) => Effect.sync(() => seen.push(nextState._tag)),
        });

        assert.deepStrictEqual(seen, ["Loading", "Ready"]);
        assert.strictEqual(state._tag, "Ready");
      }),
    );

    scoped("should load stable handler factory once while reloads reload api code", () =>
      Effect.gen(function* () {
        // Test: should load stable handler factory once while reloads reload api code
        // Scope: covers the dev API bootstrap/reload boundary owned by the plugin lifecycle.
        // Assertion: factory loading happens once, while initial load plus reloads run user API work.
        let factoryLoads = 0;
        let apiLoads = 0;
        const stableHandlerFactory = makeStableHandlerFactoryLoader(
          Effect.sync(() => {
            factoryLoads += 1;
            return handlerFactory;
          }),
        );

        const state = yield* PluginApi.loadInitial({
          apiPath: "/app/api.ts",
          hasApi: Effect.succeed(true),
          loadHandlerFactory: stableHandlerFactory,
          makeApi: () =>
            Effect.sync(() => {
              apiLoads += 1;
              return {
                middleware: (_req, _res, next) => next(),
                reload: Effect.sync(() => {
                  apiLoads += 1;
                }),
                dispose: Effect.void,
              };
            }),
        });
        if (state._tag !== "Ready") {
          return yield* Effect.die(new Error("Expected ready API state"));
        }

        yield* state.handle.reload;
        yield* state.handle.reload;
        yield* stableHandlerFactory;

        assert.strictEqual(factoryLoads, 1);
        assert.strictEqual(apiLoads, 3);
      }),
    );

    scoped("should share one stable handler factory load across overlapping callers", () =>
      Effect.gen(function* () {
        // Test: should share one stable handler factory load across overlapping callers
        // Scope: covers rapid repeated bootstrap consumers before the first load completes.
        // Assertion: overlapping calls await the same load and receive the same factory value.
        const loadStarted = yield* Deferred.make<void, never>();
        const releaseLoad = yield* Deferred.make<void, never>();
        let factoryLoads = 0;
        const stableHandlerFactory = makeStableHandlerFactoryLoader(
          Effect.gen(function* () {
            factoryLoads += 1;
            yield* Deferred.succeed(loadStarted, undefined).pipe(Effect.asVoid);
            yield* Deferred.await(releaseLoad);
            return handlerFactory;
          }),
        );

        const first = yield* stableHandlerFactory.pipe(Effect.forkChild);
        yield* Deferred.await(loadStarted);
        const second = yield* stableHandlerFactory.pipe(Effect.forkChild);
        yield* Effect.yieldNow;

        assert.strictEqual(factoryLoads, 1);

        yield* Deferred.succeed(releaseLoad, undefined).pipe(Effect.asVoid);
        const [firstFactory, secondFactory] = yield* Effect.all([
          Fiber.join(first),
          Fiber.join(second),
        ]);

        assert.strictEqual(firstFactory, handlerFactory);
        assert.strictEqual(secondFactory, handlerFactory);
        assert.strictEqual(factoryLoads, 1);
      }),
    );

    scoped("should expose reloading failed and ready states across reload recovery", () =>
      Effect.gen(function* () {
        // Test: should expose reloading failed and ready states across reload recovery
        // Scope: covers the explicit dev API lifecycle during failed and recovered reloads.
        // Assertion: observes Reloading/Failed for a failed pass and Reloading/Ready for recovery.
        const seen: Array<PluginApi.InitialState["_tag"]> = [];
        const error = new ApiInitError({ message: "reload failed" });
        let runs = 0;
        const state = yield* PluginApi.loadInitial({
          apiPath: "/app/api.ts",
          hasApi: Effect.succeed(true),
          loadHandlerFactory: Effect.succeed(handlerFactory),
          makeApi: () =>
            Effect.succeed({
              middleware: (_req, _res, next) => next(),
              reload: Effect.gen(function* () {
                runs += 1;
                if (runs === 1) {
                  return yield* error;
                }
              }),
              dispose: Effect.void,
            }),
          observe: (nextState) => Effect.sync(() => seen.push(nextState._tag)),
        });
        if (state._tag !== "Ready") {
          return yield* Effect.die(new Error("Expected ready API state"));
        }

        yield* state.handle.reload.pipe(Effect.exit);
        yield* state.handle.reload;

        assert.deepStrictEqual(seen, [
          "Loading",
          "Ready",
          "Reloading",
          "Failed",
          "Reloading",
          "Ready",
        ]);
      }),
    );

    scoped("should run coalesced follow-up after active reload fails", () =>
      Effect.gen(function* () {
        // Test: should run coalesced follow-up after active reload fails
        // Scope: covers rapid api.ts changes where the active reload fails after another request queues.
        // Assertion: the queued request produces one recovery pass and both callers complete successfully.
        const firstStarted = yield* Deferred.make<void, never>();
        const releaseFirst = yield* Deferred.make<void, never>();
        const secondStarted = yield* Deferred.make<void, never>();
        const seen: Array<PluginApi.InitialState["_tag"]> = [];
        const error = new ApiInitError({ message: "reload failed" });
        let runs = 0;
        const state = yield* PluginApi.loadInitial({
          apiPath: "/app/api.ts",
          hasApi: Effect.succeed(true),
          loadHandlerFactory: Effect.succeed(handlerFactory),
          makeApi: () =>
            Effect.succeed({
              middleware: (_req, _res, next) => next(),
              reload: Effect.gen(function* () {
                runs += 1;
                if (runs === 1) {
                  yield* Deferred.succeed(firstStarted, undefined).pipe(Effect.asVoid);
                  yield* Deferred.await(releaseFirst);
                  return yield* error;
                }
                if (runs === 2) {
                  yield* Deferred.succeed(secondStarted, undefined).pipe(Effect.asVoid);
                }
              }),
              dispose: Effect.void,
            }),
          observe: (nextState) => Effect.sync(() => seen.push(nextState._tag)),
        });
        if (state._tag !== "Ready") {
          return yield* Effect.die(new Error("Expected ready API state"));
        }

        const first = yield* state.handle.reload.pipe(Effect.forkChild);
        yield* Deferred.await(firstStarted);
        const followUp = yield* state.handle.reload.pipe(Effect.forkChild);
        yield* Effect.yieldNow;

        assert.strictEqual(runs, 1);

        yield* Deferred.succeed(releaseFirst, undefined).pipe(Effect.asVoid);
        yield* Deferred.await(secondStarted);
        yield* Effect.all([Fiber.join(first), Fiber.join(followUp)]);

        assert.strictEqual(runs, 2);
        assert.deepStrictEqual(seen, [
          "Loading",
          "Ready",
          "Reloading",
          "Failed",
          "Reloading",
          "Ready",
        ]);
      }),
    );

    scoped("should keep middleware available while reload is active", () =>
      Effect.gen(function* () {
        // Test: should keep middleware available while reload is active
        // Scope: covers request handling availability while the API lifecycle is Reloading.
        // Assertion: mounted middleware continues serving requests before the reload completes.
        const reloadStarted = yield* Deferred.make<void, never>();
        const finishReload = yield* Deferred.make<void, never>();
        const state = yield* PluginApi.loadInitial({
          apiPath: "/app/api.ts",
          hasApi: Effect.succeed(true),
          loadHandlerFactory: Effect.succeed(handlerFactory),
          makeApi: () =>
            Effect.succeed({
              middleware: (_req, res, _next) => {
                res.statusCode = 204;
                res.end();
              },
              reload: Effect.gen(function* () {
                yield* Deferred.succeed(reloadStarted, undefined).pipe(Effect.asVoid);
                yield* Deferred.await(finishReload);
              }),
              dispose: Effect.void,
            }),
        });
        if (state._tag !== "Ready") {
          return yield* Effect.die(new Error("Expected ready API state"));
        }
        const api = makePluginApi(state.handle);
        const reload = yield* api
          .reloadChangedFile(path.join("app", "api.ts"))
          .pipe(Effect.forkChild);
        yield* Deferred.await(reloadStarted);

        const server = yield* Effect.acquireRelease(
          Effect.sync(() =>
            createHttpServer((req, res) =>
              api.middleware(req, res, () => {
                res.statusCode = 404;
                res.end();
              }),
            ),
          ),
          (httpServer) =>
            Effect.promise(() => new Promise<void>((resolve) => httpServer.close(() => resolve()))),
        );
        yield* Effect.promise(
          () => new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve)),
        );
        const address = server.address();
        if (!isAddressInfo(address)) {
          return yield* Effect.die(new Error("Expected test HTTP server to listen on a TCP port"));
        }

        const status = yield* Effect.promise(
          () =>
            new Promise<number>((resolve, reject) => {
              const req = httpRequest(
                { hostname: "127.0.0.1", port: address.port, path: "/api/health" },
                (res) => {
                  res.resume();
                  res.on("end", () => resolve(res.statusCode ?? 0));
                },
              );
              req.on("error", reject);
              req.end();
            }),
        );

        yield* Deferred.succeed(finishReload, undefined).pipe(Effect.asVoid);
        yield* Fiber.join(reload);

        assert.strictEqual(status, 204);
      }),
    );

    scoped("should loadInitial expose failed state and close initial scope on failure", () =>
      Effect.gen(function* () {
        // Test: should loadInitial expose failed state and close initial scope on failure
        // Scope: covers resource cleanup when initial API construction fails after scope allocation.
        // Assertion: observes Loading then Failed and runs the scope finalizer exactly once.
        let finalized = 0;
        const seen: Array<PluginApi.InitialState["_tag"]> = [];
        const error = new ApiInitError({ message: "boom" });
        const state = yield* PluginApi.loadInitial({
          apiPath: "/app/api.ts",
          hasApi: Effect.succeed(true),
          loadHandlerFactory: Effect.succeed(handlerFactory),
          makeApi: () =>
            Effect.gen(function* () {
              yield* Effect.addFinalizer(() => Effect.sync(() => (finalized += 1)));
              return yield* error;
            }),
          observe: (nextState) => Effect.sync(() => seen.push(nextState._tag)),
        });

        assert.deepStrictEqual(seen, ["Loading", "Failed"]);
        assert.strictEqual(state._tag, "Failed");
        assert.strictEqual(finalized, 1);
      }),
    );

    scoped("should closeInitial close ready initial api scope", () =>
      Effect.gen(function* () {
        // Test: should closeInitial close ready initial api scope
        // Scope: covers dev-server shutdown cleanup for the initial API handle.
        // Assertion: closing a Ready state closes its scope and runs registered finalizers once.
        let finalized = 0;
        const state = yield* PluginApi.loadInitial({
          apiPath: "/app/api.ts",
          hasApi: Effect.succeed(true),
          loadHandlerFactory: Effect.succeed(handlerFactory),
          makeApi: () =>
            Effect.gen(function* () {
              yield* Effect.addFinalizer(() => Effect.sync(() => (finalized += 1)));
              return {
                middleware: (_req, _res, next) => next(),
                reload: Effect.void,
                dispose: Effect.void,
              };
            }),
        });

        yield* PluginApi.closeInitial(state);

        assert.strictEqual(state._tag, "Ready");
        assert.strictEqual(finalized, 1);
      }),
    );

    scoped("should serialize overlapping reload requests", () =>
      Effect.gen(function* () {
        // Test: should serialize overlapping reload requests
        // Scope: covers concurrent file-change reload calls against one dev API handle.
        // Assertion: no reload body overlaps, and both callers complete after both passes finish.
        const firstStarted = yield* Deferred.make<void, never>();
        const releaseFirst = yield* Deferred.make<void, never>();
        const secondStarted = yield* Deferred.make<void, never>();
        let active = 0;
        let maxActive = 0;
        let runs = 0;

        const state = yield* PluginApi.loadInitial({
          apiPath: "/app/api.ts",
          hasApi: Effect.succeed(true),
          loadHandlerFactory: Effect.succeed(handlerFactory),
          makeApi: () =>
            Effect.succeed({
              middleware: (_req, _res, next) => next(),
              reload: Effect.gen(function* () {
                runs += 1;
                const run = runs;
                active += 1;
                maxActive = Math.max(maxActive, active);

                if (run === 1) {
                  yield* Deferred.succeed(firstStarted, undefined).pipe(Effect.asVoid);
                  yield* Deferred.await(releaseFirst);
                }
                if (run === 2) {
                  yield* Deferred.succeed(secondStarted, undefined).pipe(Effect.asVoid);
                }

                active -= 1;
              }),
              dispose: Effect.void,
            }),
        });
        if (state._tag !== "Ready") {
          return yield* Effect.die(new Error("Expected ready API state"));
        }
        const ready = state;

        const first = yield* ready.handle.reload.pipe(Effect.forkChild);
        yield* Deferred.await(firstStarted);
        const second = yield* ready.handle.reload.pipe(Effect.forkChild);
        yield* Effect.yieldNow;

        assert.strictEqual(runs, 1);
        assert.strictEqual(maxActive, 1);

        yield* Deferred.succeed(releaseFirst, undefined).pipe(Effect.asVoid);
        yield* Deferred.await(secondStarted);
        yield* Effect.all([Fiber.join(first), Fiber.join(second)]);

        assert.strictEqual(runs, 2);
        assert.strictEqual(maxActive, 1);
      }),
    );

    scoped("should preserve one follow-up reload for many requests during active reload", () =>
      Effect.gen(function* () {
        // Test: should preserve one follow-up reload for many requests during active reload
        // Scope: covers rapid file changes while one reload is already running.
        // Assertion: many overlapping calls produce exactly one additional reload pass.
        const firstStarted = yield* Deferred.make<void, never>();
        const releaseFirst = yield* Deferred.make<void, never>();
        const secondStarted = yield* Deferred.make<void, never>();
        let runs = 0;

        const state = yield* PluginApi.loadInitial({
          apiPath: "/app/api.ts",
          hasApi: Effect.succeed(true),
          loadHandlerFactory: Effect.succeed(handlerFactory),
          makeApi: () =>
            Effect.succeed({
              middleware: (_req, _res, next) => next(),
              reload: Effect.gen(function* () {
                runs += 1;
                if (runs === 1) {
                  yield* Deferred.succeed(firstStarted, undefined).pipe(Effect.asVoid);
                  yield* Deferred.await(releaseFirst);
                }
                if (runs === 2) {
                  yield* Deferred.succeed(secondStarted, undefined).pipe(Effect.asVoid);
                }
              }),
              dispose: Effect.void,
            }),
        });
        if (state._tag !== "Ready") {
          return yield* Effect.die(new Error("Expected ready API state"));
        }
        const ready = state;

        const first = yield* ready.handle.reload.pipe(Effect.forkChild);
        yield* Deferred.await(firstStarted);
        const followUps = yield* Effect.all(
          [ready.handle.reload, ready.handle.reload, ready.handle.reload],
          { concurrency: "unbounded" },
        ).pipe(Effect.forkChild);
        yield* Effect.yieldNow;

        assert.strictEqual(runs, 1);

        yield* Deferred.succeed(releaseFirst, undefined).pipe(Effect.asVoid);
        yield* Deferred.await(secondStarted);
        yield* Effect.all([Fiber.join(first), Fiber.join(followUps)]);

        assert.strictEqual(runs, 2);
      }),
    );

    scoped("should reset reload coalescing state when active reload is interrupted", () =>
      Effect.gen(function* () {
        // Test: should reset reload coalescing state when active reload is interrupted
        // Scope: covers cleanup of the synchronized reload state under fiber interruption.
        // Assertion: a reload after interruption starts a fresh pass instead of awaiting stale state.
        const firstStarted = yield* Deferred.make<void, never>();
        const secondStarted = yield* Deferred.make<void, never>();
        const blockFirst = yield* Deferred.make<void, never>();
        let runs = 0;

        const state = yield* PluginApi.loadInitial({
          apiPath: "/app/api.ts",
          hasApi: Effect.succeed(true),
          loadHandlerFactory: Effect.succeed(handlerFactory),
          makeApi: () =>
            Effect.succeed({
              middleware: (_req, _res, next) => next(),
              reload: Effect.gen(function* () {
                runs += 1;
                if (runs === 1) {
                  yield* Deferred.succeed(firstStarted, undefined).pipe(Effect.asVoid);
                  yield* Deferred.await(blockFirst);
                }
                if (runs === 2) {
                  yield* Deferred.succeed(secondStarted, undefined).pipe(Effect.asVoid);
                }
              }),
              dispose: Effect.void,
            }),
        });
        if (state._tag !== "Ready") {
          return yield* Effect.die(new Error("Expected ready API state"));
        }
        const ready = state;

        const first = yield* ready.handle.reload.pipe(Effect.forkChild);
        yield* Deferred.await(firstStarted);
        yield* Fiber.interrupt(first);

        const second = yield* ready.handle.reload.pipe(Effect.forkChild);
        yield* Deferred.await(secondStarted);
        yield* Fiber.join(second);

        assert.strictEqual(runs, 2);
      }),
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
