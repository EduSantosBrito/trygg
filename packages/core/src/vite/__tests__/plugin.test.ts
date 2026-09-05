/**
 * Tests for Vite plugin
 * @module
 */
import { assert, describe, it } from "@effect/vitest";
import { scoped } from "../../testing/effect-vitest.js";
import { layer as NodeFileSystemLayer } from "@effect/platform-node/NodeFileSystem";
import {
  Cause,
  Config,
  Context,
  Deferred,
  Effect,
  Exit,
  Fiber,
  FileSystem,
  Layer,
  Logger,
  Option,
  Predicate,
  Schema,
  Scope,
  Stream,
  Tracer,
} from "effect";
import * as Scheduler from "effect/Scheduler";
import * as References from "effect/References";
import {
  HttpEffect,
  HttpMiddleware,
  HttpRouter,
  HttpServerRequest,
  HttpServerResponse,
} from "effect/unstable/http";
import { createServer as createHttpServer, request as httpRequest } from "node:http";
import { EventEmitter } from "node:events";
import { execFile } from "node:child_process";
import { systemError, type PlatformError, type SystemErrorTag } from "effect/PlatformError";
import type { IncomingMessage, ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import * as path from "path";
import { createServer as createViteServer, transformWithEsbuild } from "vite";
import {
  ApiInitError,
  DevPlatform,
  MAX_REQUEST_BODY_BYTES,
  NodeServerPlatform,
  ServerPlatform,
} from "../dev-platform.js";
import * as NodeDevPlatform from "../dev-platform-node.js";
import * as BunDevPlatform from "../dev-platform-bun.js";
import {
  BuildArtifactPlanner,
  BuildArtifactOperation,
  GeneratedArtifactPlanner,
} from "../build-artifact-planner.js";
import type { Connect } from "vite";
import {
  trygg,
  transformRoutesForBuild,
  validateApiPlatform,
  ClientEntryModuleOwner,
  renderClientEntryModule,
  renderProductionServerEntryModule,
  renderApiClientModule,
  renderApiClientDeclarations,
  PluginBootstrapError,
  PluginFileSystemError,
  PluginParseError,
  PluginValidationError,
  PluginFiles,
  BuildOutput,
  PluginApi,
  ViteServer,
  HandlerFactoryLoader,
  transformHtmlForFallback,
  generateHtmlTemplate,
  isTryggMixedDynamicImportWarning,
  type ViteServerSource,
} from "../plugin.js";
import { transformTryggJsxForRequirements } from "../jsx-requirement-transform.js";

/**
 * Create a scoped temporary directory with route files.
 * Cleanup is handled by Effect's Scope (finalizer removes dir on scope close).
 */
const makeTempDir: (
  files: Record<string, string>,
) => Effect.Effect<string, PlatformError, FileSystem.FileSystem | Scope.Scope> = Effect.fn(
  "PluginTest.makeTempDir",
)(function* (files: Record<string, string>) {
  const fs = yield* FileSystem.FileSystem;
  const dir = yield* fs.makeTempDirectoryScoped({
    directory: process.cwd(),
    prefix: "trygg-test-",
  });
  yield* Effect.forEach(Object.entries(files), ([filePath, content]) =>
    Effect.gen(function* () {
      const fullPath = path.join(dir, filePath);
      yield* fs
        .makeDirectory(path.dirname(fullPath), { recursive: true })
        .pipe(
          Effect.catchTag("PlatformError", (e) =>
            Predicate.isTagged(e.reason, "AlreadyExists") ? Effect.void : Effect.fail(e),
          ),
        );
      yield* fs.writeFileString(fullPath, content);
    }),
  );
  return dir;
});

const STATIC_API_WARNING =
  '⚠ API routes in app/api.ts will not be included in static build.\n  Deploy your API separately or use output: "server".';

const PluginFilesTestLayer = PluginFiles.layer.pipe(Layer.provideMerge(NodeFileSystemLayer));

const makeFileSystemFailure = (
  tag: SystemErrorTag,
  method: string,
  filePath: string,
): PlatformError =>
  systemError({
    _tag: tag,
    module: "FileSystem",
    method,
    pathOrDescriptor: filePath,
  });

const makeControlledPluginFilesLayer = (
  fileSystem: Partial<FileSystem.FileSystem>,
): Layer.Layer<PluginFiles> =>
  PluginFiles.layer.pipe(
    Layer.provide(Layer.succeed(FileSystem.FileSystem, FileSystem.makeNoop(fileSystem))),
  );

const isAddressInfo = (address: AddressInfo | string | null): address is AddressInfo =>
  typeof address === "object" && address !== null;

const IncomingMessageSchema = Schema.declare((value: unknown): value is IncomingMessage =>
  Predicate.isObject(value),
);
const ServerResponseSchema = Schema.declare((value: unknown): value is ServerResponse =>
  Predicate.isObject(value),
);
const ResponseSchema = Schema.declare((value: unknown): value is Response =>
  Predicate.isObject(value),
);
const decodeIncomingMessage = Schema.decodeUnknownSync(IncomingMessageSchema);
const decodeServerResponse = Schema.decodeUnknownSync(ServerResponseSchema);
const decodeResponse = Schema.decodeUnknownSync(ResponseSchema);
const decodeResponseDefect = Schema.decodeUnknownSync(Schema.Never);

class BrowserScriptParseError extends Schema.TaggedError<BrowserScriptParseError>()(
  "BrowserScriptParseError",
  { cause: Schema.Unknown },
) {}

class UnexpectedPluginBootstrapRejection extends Schema.TaggedError<UnexpectedPluginBootstrapRejection>()(
  "UnexpectedPluginBootstrapRejection",
  { cause: Schema.Unknown },
) {}

class GeneratedBridgeRejection extends Schema.TaggedError<GeneratedBridgeRejection>()(
  "GeneratedBridgeRejection",
  { cause: Schema.Unknown },
) {}

class TestServerListenError extends Schema.TaggedError<TestServerListenError>()(
  "TestServerListenError",
  { cause: Schema.Unknown },
) {}

class ExpectedBuildFailure extends Schema.TaggedError<ExpectedBuildFailure>()(
  "ExpectedBuildFailure",
  {},
) {}

class ExpectedHtmlTransformFailure extends Schema.TaggedError<ExpectedHtmlTransformFailure>()(
  "ExpectedHtmlTransformFailure",
  {},
) {}

const isGeneratedApiRequestError = Schema.is(
  Schema.TaggedStruct("ApiRequestError", {
    reason: Schema.String,
  }),
);

const logTestCleanupError =
  (operation: string) =>
  (error: unknown): Effect.Effect<void> =>
    Effect.logDebug(
      `[test] cleanup failed during ${operation}: ${Cause.pretty(Cause.fail(error))}`,
    );

const failPromise = <A>(cause: unknown): Promise<A> =>
  Promise.resolve(cause).then(decodeResponseDefect);

interface HandlerFactoryBoundaryModule {
  readonly makeApiLayer: (
    mod: Record<string, unknown>,
  ) => Effect.Effect<Layer.Layer<unknown>, unknown>;
  readonly makeWebHandler: (apiLive: Layer.Layer<unknown>) => Effect.Effect<
    {
      readonly handler: (request: Request) => Promise<Response>;
      readonly dispose: Effect.Effect<void>;
    },
    unknown,
    Scope.Scope
  >;
  readonly makeNodeHandler: (apiLive: Layer.Layer<unknown>) => Effect.Effect<
    {
      readonly handler: (req: IncomingMessage, res: ServerResponse) => void;
      readonly dispose: Effect.Effect<void>;
    },
    unknown,
    Scope.Scope
  >;
  readonly fromNodeRequest: (req: IncomingMessage, signal?: AbortSignal) => Promise<Request>;
  readonly toNodeResponse: (
    response: Response,
    res: ServerResponse,
    signal?: AbortSignal,
  ) => Promise<void>;
  readonly getBody: (req: IncomingMessage, signal?: AbortSignal) => Promise<Uint8Array | undefined>;
}

interface HttpResult {
  readonly status: number;
  readonly bridgeHeader: string | undefined;
  readonly body: string;
}

interface ProcessResult {
  readonly code: number | string | null | undefined;
  readonly killed: boolean;
  readonly signal: string | null | undefined;
  readonly stderr: string;
  readonly stdout: string;
}

const runProcessToExit = (
  executable: string,
  entryPath: string,
  cwd: string,
  environment: NodeJS.ProcessEnv,
): Effect.Effect<ProcessResult> =>
  Effect.promise(
    () =>
      new Promise((resolve) => {
        execFile(
          executable,
          [entryPath],
          { cwd, encoding: "utf8", env: environment, timeout: 5_000 },
          (error, stdout, stderr) => {
            resolve({
              code: error?.code,
              killed: error?.killed ?? false,
              signal: error?.signal,
              stderr,
              stdout,
            });
          },
        );
      }),
  );

const runNodeToExit = (
  entryPath: string,
  cwd: string,
  environment: NodeJS.ProcessEnv,
): Effect.Effect<ProcessResult> => runProcessToExit(process.execPath, entryPath, cwd, environment);

const runBunToExit = Effect.fn("PluginTest.runBunToExit")(function* (
  entryPath: string,
  cwd: string,
  environment: NodeJS.ProcessEnv,
): Effect.fn.Return<ProcessResult, Config.ConfigError> {
  const executablePath = yield* Config.string("PATH");
  return yield* runProcessToExit("bun", entryPath, cwd, {
    ...environment,
    PATH: executablePath,
  });
});

const requestHttp = (options: {
  readonly port: number;
  readonly path: string;
  readonly headers?: Record<string, string>;
  readonly method?: string;
  readonly body?: string;
}): Effect.Effect<HttpResult> =>
  Effect.promise(
    () =>
      new Promise((resolve, reject) => {
        const req = httpRequest(
          {
            headers: options.headers,
            hostname: "127.0.0.1",
            method: options.method,
            path: options.path,
            port: options.port,
          },
          (res) => {
            const chunks: Array<string> = [];
            res.setEncoding("utf8");
            res.on("data", (chunk: string) => chunks.push(chunk));
            res.on("end", () => {
              const contentType = res.headers["content-type"];
              resolve({
                body: chunks.join(""),
                bridgeHeader: Array.isArray(contentType) ? contentType.join(", ") : contentType,
                status: res.statusCode ?? 0,
              });
            });
          },
        );
        req.on("error", reject);
        if (options.body !== undefined) req.write(options.body);
        req.end();
      }),
  );

interface CloudflareStaticWorkerModule {
  readonly default: {
    readonly fetch: (
      request: Request,
      env: { readonly ASSETS: { readonly fetch: (request: Request) => Promise<Response> } },
    ) => Promise<Response>;
  };
}

const decodeCloudflareStaticWorkerModule = Schema.decodeUnknownSync(
  Schema.Struct({
    default: Schema.Struct({
      fetch: Schema.declare(
        (value: unknown): value is CloudflareStaticWorkerModule["default"]["fetch"] =>
          typeof value === "function",
      ),
    }),
  }),
);

const DevPlatformLegacyConstructorSchema = Schema.Struct({
  createDevApi: Schema.optional(Schema.Unknown),
});

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

const BuildEndHookSchema = Schema.declare(
  (u: unknown): u is (error?: Error) => Promise<void> | void => typeof u === "function",
);

const ResolveIdHookSchema = Schema.declare(
  (u: unknown): u is (id: string) => string | null => typeof u === "function",
);

const LoadHookSchema = Schema.declare(
  (u: unknown): u is (id: string) => Promise<string | null> => typeof u === "function",
);

const TransformHookSchema = Schema.declare(
  (u: unknown): u is (code: string, id: string) => Promise<string | null> =>
    typeof u === "function",
);

const ConfigHookSchema = Schema.declare(
  (u: unknown): u is (...args: ReadonlyArray<unknown>) => unknown => typeof u === "function",
);

const EsbuildConfigSchema = Schema.Struct({
  esbuild: Schema.Struct({
    jsx: Schema.String,
    jsxImportSource: Schema.String,
  }),
});

const OptimizeDepsConfigSchema = Schema.Struct({
  optimizeDeps: Schema.Struct({
    esbuildOptions: Schema.Struct({
      jsx: Schema.String,
      jsxImportSource: Schema.String,
    }),
  }),
});

const BuildOnwarnConfigSchema = Schema.Struct({
  build: Schema.Struct({
    rollupOptions: Schema.Struct({
      onwarn: Schema.declare(
        (u: unknown): u is (warning: { readonly message?: string }, handler: () => void) => void =>
          typeof u === "function",
      ),
    }),
  }),
});

const ConfigEnvironmentHookSchema = Schema.declare(
  (
    u: unknown,
  ): u is (name: string, config: unknown, env: { readonly command: string }) => unknown =>
    typeof u === "function",
);

const BuildConfigSchema = Schema.Struct({
  build: Schema.optional(
    Schema.Struct({
      rollupOptions: Schema.optional(
        Schema.Struct({
          input: Schema.optional(Schema.Unknown),
        }),
      ),
    }),
  ),
});

const decodeDevPlatformLegacyConstructor = Schema.decodeUnknownSync(
  DevPlatformLegacyConstructorSchema,
);
const decodeHandlerFactoryBoundaryModule = Schema.decodeUnknownEffect(
  HandlerFactoryBoundaryModuleSchema,
);
const decodeBuildStartHook = Schema.decodeUnknownEffect(BuildStartHookSchema);
const decodeBuildStartHookSync = Schema.decodeUnknownSync(BuildStartHookSchema);
const decodeConfigResolvedHook = Schema.decodeUnknownEffect(ConfigResolvedHookSchema);
const decodeCloseBundleHook = Schema.decodeUnknownEffect(CloseBundleHookSchema);
const decodeBuildEndHook = Schema.decodeUnknownEffect(BuildEndHookSchema);
const decodeResolveIdHook = Schema.decodeUnknownEffect(ResolveIdHookSchema);
const decodeLoadHook = Schema.decodeUnknownEffect(LoadHookSchema);
const decodeTransformHook = Schema.decodeUnknownEffect(TransformHookSchema);
const decodeConfigHook = Schema.decodeUnknownSync(ConfigHookSchema);
const decodeEsbuildConfig = Schema.decodeUnknownSync(EsbuildConfigSchema);
const decodeOptimizeDepsConfig = Schema.decodeUnknownSync(OptimizeDepsConfigSchema);
const decodeBuildOnwarnConfig = Schema.decodeUnknownSync(BuildOnwarnConfigSchema);
const decodeConfigEnvironmentHook = Schema.decodeUnknownSync(ConfigEnvironmentHookSchema);
const decodeBuildConfig = Schema.decodeUnknownSync(BuildConfigSchema);

const loadPlannedCloudflareWorker = Effect.gen(function* () {
  const validationPlanner = BuildArtifactPlanner.make({ failOnWarnings: false });
  const artifactPlanner = GeneratedArtifactPlanner.make({ includeCleanupOperations: true });
  const validation = yield* validationPlanner.validateOutput({
    output: "static",
    platform: "cloudflare",
    hasApi: false,
    appDir: "app",
    generatedDir: ".trygg",
  });
  const plan = yield* artifactPlanner.planArtifacts(validation);
  const operation = plan.operations.find(
    (candidate) =>
      BuildArtifactOperation.$is("WriteFile")(candidate) &&
      candidate.path === ".trygg/worker-entry.js",
  );
  if (operation === undefined || !BuildArtifactOperation.$is("WriteFile")(operation)) {
    return assert.fail("Expected the planned Cloudflare Worker WriteFile operation");
  }
  const moduleUrl = `data:text/javascript,${encodeURIComponent(operation.contents)}`;
  const module = yield* Effect.promise(() => import(moduleUrl));
  return decodeCloudflareStaticWorkerModule(module);
});

const assertPromiseRejectsWith: (
  promiseFactory: () => Promise<unknown>,
  expected: string,
) => Effect.Effect<void> = Effect.fn("PluginTest.assertPromiseRejectsWith")(function* (
  promiseFactory: () => Promise<unknown>,
  expected: string,
) {
  const exit = yield* Effect.tryPromise(promiseFactory).pipe(Effect.exit);
  assert.isTrue(Exit.isFailure(exit));
  if (Exit.isFailure(exit)) {
    assert.include(Cause.pretty(exit.cause), expected);
  }
});

const loadHandlerFactoryModule = Effect.gen(function* () {
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
    (viteServer) =>
      Effect.tryPromise(() => viteServer.close()).pipe(
        Effect.catchTag("UnknownError", logTestCleanupError("handler factory vite close")),
      ),
  );
  const rawModule = yield* Effect.promise(() =>
    server.ssrLoadModule("virtual:trygg/handler-factory"),
  );
  return yield* decodeHandlerFactoryBoundaryModule(rawModule);
}).pipe(Effect.withSpan("PluginTest.loadHandlerFactoryModule"));

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

    it("should reject invalid runtime plugin configuration before creating a lifecycle", () => {
      // Test: should reject invalid runtime plugin configuration before creating a lifecycle
      // Scope: covers JavaScript callers that bypass the compile-time TryggConfig type.
      // Assertion: Schema decoding rejects an unsupported platform synchronously.
      const config: { platform: "node"; output: "server" } = {
        platform: "node",
        output: "server",
      };
      Reflect.set(config, "platform", "deno");

      assert.throws(() => trygg(config));
    });

    it.effect("should share one shutdown promise across build failure and close hooks", () =>
      Effect.gen(function* () {
        // Test: should share one shutdown promise across build failure and close hooks
        // Scope: covers concurrent Vite shutdown entrypoints after a failed build.
        // Assertion: every hook returns the same completion and a repeated close is idempotent.
        const plugin = trygg();
        const buildEnd = yield* decodeBuildEndHook(plugin.buildEnd);
        const closeBundle = yield* decodeCloseBundleHook(plugin.closeBundle);
        const failure = new ExpectedBuildFailure();

        const first = buildEnd(failure);
        const second = buildEnd(failure);
        assert.isDefined(first);
        assert.strictEqual(second, first);
        if (first !== undefined) yield* Effect.promise(() => first);

        const finalClose = closeBundle();
        assert.strictEqual(finalClose, first);
        yield* Effect.promise(() => finalClose);
      }),
    );

    for (const middlewareMode of [false, true]) {
      for (const entrypoint of ["closeBundle", "buildEnd"]) {
        scoped(
          `should await blocked API cleanup before runtime disposal in ${middlewareMode ? "middleware" : "normal"} mode through ${entrypoint}`,
          () =>
            Effect.gen(function* () {
              // Scope: real Vite setup acquires an API Layer whose finalizer is controlled via SSR exports.
              // Assertion: concurrent terminal hooks await one release and dispose the runtime afterwards.
              const root = yield* makeTempDir({
                "app/layout.tsx":
                  "export default function Layout() { return <html><body /></html> }",
                "app/routes.ts": "export const routes = { manifest: [] }",
                "app/api.ts": `
import { Deferred, Effect, Layer } from "effect";
const started = Deferred.makeUnsafe();
const gate = Deferred.makeUnsafe();
let releases = 0;
export const cleanupStarted = Deferred.await(started);
export const releaseCleanup = Deferred.succeed(gate, undefined).pipe(Effect.asVoid);
export const releaseCount = Effect.sync(() => releases);
export default Layer.effectDiscard(Effect.addFinalizer(() =>
  Deferred.succeed(started, undefined).pipe(
    Effect.andThen(Deferred.await(gate)),
    Effect.andThen(Effect.sync(() => { releases++; })),
  )
));`,
              });
              const plugin = trygg({ platform: "node", output: "server" });
              const server = yield* Effect.acquireRelease(
                Effect.promise(() =>
                  createViteServer({
                    configFile: false,
                    root,
                    server: { middlewareMode },
                    plugins: [plugin],
                  }),
                ),
                (viteServer) => Effect.promise(() => viteServer.close()),
              );
              const control = yield* Effect.promise(() =>
                server.ssrLoadModule(path.join(root, "app/api.ts")),
              ).pipe(
                Effect.flatMap(
                  Schema.decodeUnknownEffect(
                    Schema.Struct({
                      cleanupStarted: Schema.declare(
                        (value: unknown): value is Effect.Effect<void> => Effect.isEffect(value),
                      ),
                      releaseCleanup: Schema.declare(
                        (value: unknown): value is Effect.Effect<void> => Effect.isEffect(value),
                      ),
                      releaseCount: Schema.declare(
                        (value: unknown): value is Effect.Effect<number> => Effect.isEffect(value),
                      ),
                    }),
                  ),
                ),
              );
              yield* Effect.addFinalizer(() => control.releaseCleanup);
              const closeBundle = yield* decodeCloseBundleHook(plugin.closeBundle);
              const buildEnd = yield* decodeBuildEndHook(plugin.buildEnd);
              const transform = yield* decodeTransformHook(plugin.transform);
              const first =
                entrypoint === "closeBundle" ? closeBundle() : buildEnd(new ExpectedBuildFailure());
              if (first === undefined) return assert.fail("Expected an awaited shutdown");
              yield* control.cleanupStarted;
              assert.strictEqual(closeBundle(), first);
              assert.strictEqual(buildEnd(new ExpectedBuildFailure()), first);
              assert.strictEqual(yield* control.releaseCount, 0);
              // Transform uses pluginRuntime.runPromise, so this probes the actual runtime owner.
              yield* Effect.promise(() =>
                transform("export const value = 1", path.join(root, "probe.ts")),
              );
              yield* control.releaseCleanup;
              yield* Effect.promise(() => first);
              assert.strictEqual(yield* control.releaseCount, 1);
              yield* assertPromiseRejectsWith(
                () => transform("export const value = 2", path.join(root, "probe.ts")),
                "ManagedRuntime disposed",
              );
              assert.strictEqual(closeBundle(), first);
              yield* Effect.promise(() => server.close());
              assert.strictEqual(yield* control.releaseCount, 1);
            }).pipe(Effect.provide(NodeFileSystemLayer)),
        );
      }
    }

    scoped("should dispose the plugin lifecycle when a middleware-mode Vite server closes", () =>
      Effect.gen(function* () {
        // Test: should dispose the plugin lifecycle when a middleware-mode Vite server closes
        // Scope: covers Vite servers with no httpServer close event.
        // Assertion: server.close awaits closeBundle shutdown and subsequent close remains idempotent.
        const root = yield* makeTempDir({
          "app/layout.tsx": "export default function Layout() { return <html><body /></html> }",
          "app/routes.ts": "export const routes = { manifest: [] }",
        });
        const plugin = trygg();
        const server = yield* Effect.acquireRelease(
          Effect.promise(() =>
            createViteServer({
              configFile: false,
              root,
              server: { middlewareMode: true },
              plugins: [plugin],
            }),
          ),
          (viteServer) =>
            Effect.tryPromise(() => viteServer.close()).pipe(
              Effect.catchTag("UnknownError", logTestCleanupError("middleware server close")),
            ),
        );

        assert.isNull(server.httpServer);
        yield* Effect.promise(() => server.close());
        const closeBundle = yield* decodeCloseBundleHook(plugin.closeBundle);
        yield* Effect.promise(() => closeBundle());
      }).pipe(Effect.provide(NodeFileSystemLayer)),
    );

    scoped("should share one terminal promise across concurrent dev shutdown hooks", () =>
      Effect.gen(function* () {
        // Test: should share one terminal promise across concurrent dev shutdown hooks
        // Scope: invokes closeBundle twice and buildEnd while a middleware-mode server is active.
        // Assertion: all terminal plugin entrypoints return and await the exact same Promise.
        const root = yield* makeTempDir({
          "app/layout.tsx": "export default function Layout() { return <html><body /></html> }",
          "app/routes.ts": "export const routes = { manifest: [] }",
        });
        const plugin = trygg();
        yield* Effect.acquireRelease(
          Effect.promise(() =>
            createViteServer({
              configFile: false,
              root,
              server: { middlewareMode: true },
              plugins: [plugin],
            }),
          ),
          (server) =>
            Effect.tryPromise(() => server.close()).pipe(
              Effect.catchTag("UnknownError", logTestCleanupError("concurrent dev close")),
            ),
        );
        const closeBundle = yield* decodeCloseBundleHook(plugin.closeBundle);
        const buildEnd = yield* decodeBuildEndHook(plugin.buildEnd);

        const first = closeBundle();
        const second = closeBundle();
        const third = buildEnd(new ExpectedBuildFailure());

        assert.strictEqual(second, first);
        assert.strictEqual(third, first);
        yield* Effect.promise(() => first);
      }).pipe(Effect.provide(NodeFileSystemLayer)),
    );

    scoped("should transform TSX modules through JSX requirement lowering", () =>
      Effect.gen(function* () {
        // Test: should transform TSX modules through JSX requirement lowering
        // Scope: verifies the production plugin hook owns the hidden JSX lowering path.
        // Assertion: user-authored JSX becomes requirement-preserving runtime calls after config resolution.
        const root = yield* makeTempDir({
          "app/routes.ts": "export const routes = { manifest: [] }",
        });
        const plugin = trygg();
        const configResolved = yield* decodeConfigResolvedHook(plugin.configResolved);
        const transform = yield* decodeTransformHook(plugin.transform);

        yield* Effect.promise(() => configResolved({ root, command: "serve" }));
        const output = yield* Effect.promise(() =>
          transform(
            `const Child = () => <span />\nexport const App = () => <div><Child /><Child /></div>`,
            path.join(root, "app", "page.tsx"),
          ),
        );

        assert.isString(output);
        assert.include(output, 'from "trygg/jsx-runtime"');
        assert.include(output, "__tryggJsx(Child, null)");
        assert.include(output, '__tryggJsxs("div"');
      }).pipe(Effect.provide(NodeFileSystemLayer)),
    );

    it.effect(
      "should buildStart do not observe partial bootstrap while configResolved has not run",
      () =>
        Effect.gen(function* () {
          // Test: should buildStart do not observe partial bootstrap while configResolved has not run
          // Scope: guards the config-dependent hook boundary so plugin work cannot read uninitialized state.
          // Assertion: buildStart rejects with PluginBootstrapError instead of crashing with an untyped error.
          const plugin = trygg();
          const buildStart = decodeBuildStartHookSync(plugin.buildStart);

          const exit = yield* Effect.tryPromise({
            try: () => buildStart(),
            catch: (error) =>
              error instanceof PluginBootstrapError
                ? error
                : new UnexpectedPluginBootstrapRejection({ cause: error }),
          }).pipe(Effect.exit);
          assert.isTrue(Exit.isFailure(exit));
          if (Exit.isFailure(exit)) {
            const error = Cause.squash(exit.cause);
            if (!(error instanceof PluginBootstrapError)) {
              return assert.fail(
                `Expected PluginBootstrapError but got ${Cause.pretty(exit.cause)}`,
              );
            }
            assert.strictEqual(error.reason, "NotReady");
          }
        }),
    );

    scoped("should buildStart generate build files after configResolved", () =>
      Effect.gen(function* () {
        // Test: should buildStart generate build files after configResolved
        // Scope: verifies configResolved bootstraps shared plugin-instance state for buildStart.
        // Assertion: buildStart succeeds and writes the build entry files from resolved config state.
        const fs = yield* FileSystem.FileSystem;
        const root = yield* makeTempDir({
          "app/layout.tsx": "export default function Layout() { return <html><body /></html> }",
          "app/routes.ts": `
import { Schema } from "effect"
import { Route } from "trygg/router"

Route.make("/users/:id")
  ["params"](Schema.Struct({ id: Schema.NumberFromString }))
  .component(UsersPage)

export const routes = { manifest: [] }
`,
        });
        const plugin = trygg();
        const configResolved = yield* decodeConfigResolvedHook(plugin.configResolved);
        const buildStart = yield* decodeBuildStartHook(plugin.buildStart);

        yield* Effect.promise(() => configResolved({ root, command: "build" }));
        yield* Effect.promise(() => buildStart());

        const entry = yield* fs.readFileString(path.join(root, ".trygg", "entry.tsx"));
        const index = yield* fs.readFileString(path.join(root, ".trygg", "index.html"));
        const routeTypes = yield* fs.readFileString(path.join(root, ".trygg", "routes.d.ts"));

        assert.strictEqual(
          entry,
          renderClientEntryModule(
            ClientEntryModuleOwner.make({
              appDir: path.join(root, "app"),
              generatedDir: path.join(root, ".trygg"),
              routesFilePath: path.join(root, "app", "routes.ts"),
            }),
          ),
        );
        assert.include(index, '<script type="module" src="/.trygg/entry.tsx"></script>');
        assert.include(routeTypes, 'readonly "/users/:id": { readonly id: number; }');
        assert.include(routeTypes, "interface RouteInputMap");
        assert.include(routeTypes, 'readonly "/users/:id": { readonly id: string; }');
      }).pipe(Effect.provide(NodeFileSystemLayer)),
    );

    scoped("should buildStart reject Schema lookalikes in transpile-only routes", () =>
      Effect.gen(function* () {
        // Test: should buildStart reject Schema lookalikes in transpile-only routes
        // Scope: covers the Vite build boundary where esbuild does not run TypeScript checking.
        // Assertion: route declaration generation rejects with PluginParseError before emitting fallback types.
        const root = yield* makeTempDir({
          "app/layout.tsx": "export default function Layout() { return <html><body /></html> }",
          "app/routes.ts": `
import { Route } from "trygg/router"

const FakeSchema = { Type: { id: 1 }, Encoded: { id: "1" } }
Route.make("/users/:id").params(FakeSchema)
export const routes = { manifest: [] }
`,
        });
        const plugin = trygg();
        const configResolved = yield* decodeConfigResolvedHook(plugin.configResolved);
        const buildStart = yield* decodeBuildStartHook(plugin.buildStart);
        const buildEnd = yield* decodeBuildEndHook(plugin.buildEnd);

        yield* Effect.promise(() => configResolved({ root, command: "build" }));
        const exit = yield* Effect.tryPromise({
          try: () => buildStart(),
          catch: (cause) =>
            cause instanceof PluginParseError
              ? cause
              : new UnexpectedPluginBootstrapRejection({ cause }),
        }).pipe(Effect.exit);
        yield* Effect.promise(() => Promise.resolve(buildEnd(new ExpectedBuildFailure())));

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

    scoped("should buildStart reject unresolved dynamic route Schema calls", () =>
      Effect.gen(function* () {
        // Scope: covers any-typed mutable builder flow at Vite's transpile-only build boundary.
        // Assertion: production codegen returns PluginParseError rather than raw parameter types.
        const root = yield* makeTempDir({
          "app/layout.tsx": "export default function Layout() { return <html><body /></html> }",
          "app/routes.ts": `
import { Schema } from "effect"
import { Route } from "trygg/router"

const base: any = Route.make("/users/:id")
base["params"](Schema.Struct({ id: Schema.String }))
export const routes = { manifest: [] }
`,
        });
        const plugin = trygg();
        const configResolved = yield* decodeConfigResolvedHook(plugin.configResolved);
        const buildStart = yield* decodeBuildStartHook(plugin.buildStart);
        const buildEnd = yield* decodeBuildEndHook(plugin.buildEnd);

        yield* Effect.promise(() => configResolved({ root, command: "build" }));
        const exit = yield* Effect.tryPromise({
          try: () => buildStart(),
          catch: (cause) =>
            cause instanceof PluginParseError
              ? cause
              : new UnexpectedPluginBootstrapRejection({ cause }),
        }).pipe(Effect.exit);
        yield* Effect.promise(() => Promise.resolve(buildEnd(new ExpectedBuildFailure())));

        assert.isTrue(Exit.isFailure(exit));
        if (Exit.isFailure(exit)) {
          const error = Cause.squash(exit.cause);
          assert.instanceOf(error, PluginParseError);
          if (error instanceof PluginParseError) {
            assert.include(error.description, "cannot resolve the immutable builder");
          }
        }
      }).pipe(Effect.provide(NodeFileSystemLayer)),
    );

    scoped("should buildStart leave stylesheet imports to app modules", () =>
      Effect.gen(function* () {
        // Test: should buildStart leave stylesheet imports to app modules
        // Scope: guards against framework-owned filename magic in generated browser entry.
        // Assertion: .trygg/entry.tsx does not import unrelated root CSS by convention.
        const fs = yield* FileSystem.FileSystem;
        const root = yield* makeTempDir({
          "styles.css": '@import "tailwindcss";',
          "app/layout.tsx": "export default function Layout() { return <html><body /></html> }",
          "app/routes.ts": "export const routes = { manifest: [] }",
        });
        const plugin = trygg();
        const configResolved = yield* decodeConfigResolvedHook(plugin.configResolved);
        const buildStart = yield* decodeBuildStartHook(plugin.buildStart);

        yield* Effect.promise(() => configResolved({ root, command: "build" }));
        yield* Effect.promise(() => buildStart());

        const entry = yield* fs.readFileString(path.join(root, ".trygg", "entry.tsx"));
        assert.notInclude(entry, 'import "../styles.css"');
      }).pipe(Effect.provide(NodeFileSystemLayer)),
    );

    scoped("should build output write static files and skip server output", () =>
      Effect.gen(function* () {
        // Test: should build output write static files and skip server output
        // Scope: covers static production output at the build output service boundary.
        // Assertion: client build files exist and closeBundle does not emit a server entry.
        const fs = yield* FileSystem.FileSystem;
        const files = yield* PluginFiles;
        const serverPlatform = yield* ServerPlatform;
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
        const buildOutput = BuildOutput.make({
          buildServer: () => Effect.void,
          fileSystem: fs,
          files,
          serverPlatform,
        });

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
          platform: "node",
        });

        const indexExists = yield* fs.exists(path.join(generatedDir, "index.html"));
        const serverEntryExists = yield* fs.exists(path.join(generatedDir, "server-entry.ts"));

        assert.isTrue(indexExists);
        assert.isFalse(serverEntryExists);
        assert.deepStrictEqual(warnings, [STATIC_API_WARNING]);
      }).pipe(Effect.provide(Layer.mergeAll(PluginFilesTestLayer, NodeServerPlatform.layer))),
    );

    scoped("should promote Cloudflare static shell to public dist index", () =>
      Effect.gen(function* () {
        // Test: should promote Cloudflare static shell to public dist index
        // Scope: covers the public Cloudflare Static SPA shell output path.
        // Assertion: closeBundle moves Vite's nested HTML artifact to dist/index.html.
        const fs = yield* FileSystem.FileSystem;
        const files = yield* PluginFiles;
        const serverPlatform = yield* ServerPlatform;
        const root = yield* makeTempDir({
          "app/layout.tsx": "export default function Layout() { return <html><body /></html> }",
          "app/routes.ts": "export const routes = { manifest: [] }",
          "dist/.trygg/index.html": "<html><body>shell</body></html>",
        });
        const appDir = path.join(root, "app");
        const generatedDir = path.join(root, ".trygg");
        const buildOutput = BuildOutput.make({
          buildServer: () => Effect.void,
          fileSystem: fs,
          files,
          serverPlatform,
        });

        yield* buildOutput.closeBundle({
          appDir,
          generatedDir,
          config: { command: "build", root },
          output: "static",
          platform: "cloudflare",
        });

        const publicShell = yield* fs.readFileString(path.join(root, "dist", "index.html"));
        const internalShellExists = yield* fs.exists(path.join(root, "dist", ".trygg"));

        assert.strictEqual(publicShell, "<html><body>shell</body></html>");
        assert.isFalse(internalShellExists);
      }).pipe(Effect.provide(Layer.mergeAll(PluginFilesTestLayer, NodeServerPlatform.layer))),
    );

    scoped("should build output static without api file not warn", () =>
      Effect.gen(function* () {
        // Test: should build output static without api file not warn
        // Scope: covers the static build hook service path when app/api.ts is absent.
        // Assertion: client build files exist and no API exclusion warning is logged.
        const fs = yield* FileSystem.FileSystem;
        const files = yield* PluginFiles;
        const serverPlatform = yield* ServerPlatform;
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
        const buildOutput = BuildOutput.make({
          buildServer: () => Effect.void,
          fileSystem: fs,
          files,
          serverPlatform,
        });

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
      }).pipe(Effect.provide(Layer.mergeAll(PluginFilesTestLayer, NodeServerPlatform.layer))),
    );

    scoped("should build Cloudflare static worker entry and no public trygg contract", () =>
      Effect.gen(function* () {
        // Test: should build Cloudflare static worker entry and no public trygg contract
        // Scope: covers explicit Cloudflare Static SPA artifact generation.
        // Assertion: Worker entry exists under .trygg, public shell exists, and dist/.trygg is absent.
        const fs = yield* FileSystem.FileSystem;
        const files = yield* PluginFiles;
        const serverPlatform = yield* ServerPlatform;
        const root = yield* makeTempDir({
          "app/layout.tsx": "export default function Layout() { return <html><body /></html> }",
          "app/routes.ts": "export const routes = { manifest: [] }",
        });
        const appDir = path.join(root, "app");
        const generatedDir = path.join(root, ".trygg");
        const buildOutput = BuildOutput.make({
          buildServer: () => Effect.void,
          fileSystem: fs,
          files,
          serverPlatform,
        });

        yield* buildOutput.buildStart({
          appDir,
          generatedDir,
          config: { command: "build", root },
          output: "static",
          platform: "cloudflare",
        });
        yield* fs.makeDirectory(path.join(root, "dist"), { recursive: true });
        yield* fs.writeFileString(path.join(root, "dist", "index.html"), generateHtmlTemplate());

        const workerEntryExists = yield* fs.exists(path.join(generatedDir, "worker-entry.js"));
        const oldSsrEntryExists = yield* fs.exists(path.join(generatedDir, "ssr-entry.js"));
        const publicIndexExists = yield* fs.exists(path.join(root, "dist", "index.html"));
        const publicTryggExists = yield* fs.exists(path.join(root, "dist", ".trygg"));

        assert.isTrue(workerEntryExists);
        assert.isFalse(oldSsrEntryExists);
        assert.isTrue(publicIndexExists);
        assert.isFalse(publicTryggExists);
      }).pipe(Effect.provide(Layer.mergeAll(PluginFilesTestLayer, NodeServerPlatform.layer))),
    );

    scoped("should not generate Cloudflare worker for Node or Bun static", () =>
      Effect.gen(function* () {
        // Test: should not generate Cloudflare worker for Node or Bun static
        // Scope: prevents explicit Cloudflare platform behavior leaking into other runtimes.
        // Assertion: static builds for Node and Bun do not write worker-entry.js.
        const fs = yield* FileSystem.FileSystem;
        const files = yield* PluginFiles;
        const serverPlatform = yield* ServerPlatform;
        const root = yield* makeTempDir({
          "node/app/layout.tsx":
            "export default function Layout() { return <html><body /></html> }",
          "node/app/routes.ts": "export const routes = { manifest: [] }",
          "bun/app/layout.tsx": "export default function Layout() { return <html><body /></html> }",
          "bun/app/routes.ts": "export const routes = { manifest: [] }",
        });
        const buildOutput = BuildOutput.make({
          buildServer: () => Effect.void,
          fileSystem: fs,
          files,
          serverPlatform,
        });

        yield* buildOutput.buildStart({
          appDir: path.join(root, "node", "app"),
          generatedDir: path.join(root, "node", ".trygg"),
          config: { command: "build", root: path.join(root, "node") },
          output: "static",
          platform: "node",
        });
        yield* buildOutput.buildStart({
          appDir: path.join(root, "bun", "app"),
          generatedDir: path.join(root, "bun", ".trygg"),
          config: { command: "build", root: path.join(root, "bun") },
          output: "static",
          platform: "bun",
        });

        const nodeWorkerExists = yield* fs.exists(
          path.join(root, "node", ".trygg", "worker-entry.js"),
        );
        const bunWorkerExists = yield* fs.exists(
          path.join(root, "bun", ".trygg", "worker-entry.js"),
        );

        assert.isFalse(nodeWorkerExists);
        assert.isFalse(bunWorkerExists);
      }).pipe(Effect.provide(Layer.mergeAll(PluginFilesTestLayer, NodeServerPlatform.layer))),
    );

    scoped("should reject Cloudflare static API routes", () =>
      Effect.gen(function* () {
        // Test: should reject Cloudflare static API routes
        // Scope: covers early validation for unsupported Cloudflare Static SPA API files.
        // Assertion: buildStart fails with guidance toward server output.
        const fs = yield* FileSystem.FileSystem;
        const files = yield* PluginFiles;
        const serverPlatform = yield* ServerPlatform;
        const root = yield* makeTempDir({
          "app/layout.tsx": "export default function Layout() { return <html><body /></html> }",
          "app/routes.ts": "export const routes = { manifest: [] }",
          "app/api.ts": "export const Api = {}",
        });
        const buildOutput = BuildOutput.make({
          buildServer: () => Effect.void,
          fileSystem: fs,
          files,
          serverPlatform,
        });

        const exit = yield* Effect.exit(
          buildOutput.buildStart({
            appDir: path.join(root, "app"),
            generatedDir: path.join(root, ".trygg"),
            config: { command: "build", root },
            output: "static",
            platform: "cloudflare",
          }),
        );

        assert.isTrue(Exit.isFailure(exit));
        if (Exit.isFailure(exit)) {
          const error = Cause.squash(exit.cause);
          if (!(error instanceof PluginValidationError)) {
            return assert.fail(
              `Expected PluginValidationError but got ${Cause.pretty(exit.cause)}`,
            );
          }
          assert.include(error.description, 'output: "server"');
        }
      }).pipe(Effect.provide(Layer.mergeAll(PluginFilesTestLayer, NodeServerPlatform.layer))),
    );

    scoped("should reject Cloudflare server output", () =>
      Effect.gen(function* () {
        // Test: should reject Cloudflare server output
        // Scope: makes unsupported Cloudflare server builds explicit for this Static SPA slice.
        // Assertion: buildStart fails before any Node/Bun server artifact can be produced.
        const fs = yield* FileSystem.FileSystem;
        const files = yield* PluginFiles;
        const serverPlatform = yield* ServerPlatform;
        const root = yield* makeTempDir({
          "app/layout.tsx": "export default function Layout() { return <html><body /></html> }",
          "app/routes.ts": "export const routes = { manifest: [] }",
        });
        const buildOutput = BuildOutput.make({
          buildServer: () => Effect.void,
          fileSystem: fs,
          files,
          serverPlatform,
        });

        const exit = yield* Effect.exit(
          buildOutput.buildStart({
            appDir: path.join(root, "app"),
            generatedDir: path.join(root, ".trygg"),
            config: { command: "build", root },
            output: "server",
            platform: "cloudflare",
          }),
        );

        assert.isTrue(Exit.isFailure(exit));
        if (Exit.isFailure(exit)) {
          const error = Cause.squash(exit.cause);
          if (!(error instanceof PluginValidationError)) {
            return assert.fail(
              `Expected PluginValidationError but got ${Cause.pretty(exit.cause)}`,
            );
          }
          assert.include(error.description, "Cloudflare server output is not supported");
        }
      }).pipe(Effect.provide(Layer.mergeAll(PluginFilesTestLayer, NodeServerPlatform.layer))),
    );

    scoped("should build output write server entry and invoke server build", () =>
      Effect.gen(function* () {
        // Test: should build output write server entry and invoke server build
        // Scope: covers server production output at the build output service boundary.
        // Assertion: closeBundle emits the server entry with API wiring and invokes the server build once.
        const fs = yield* FileSystem.FileSystem;
        const files = yield* PluginFiles;
        const serverPlatform = yield* ServerPlatform;
        const root = yield* makeTempDir({
          "app/layout.tsx": "export default function Layout() { return <html><body /></html> }",
          "app/routes.ts": "export const routes = { manifest: [] }",
          "app/api.ts": "export default {}",
        });
        const appDir = path.join(root, "app");
        const generatedDir = path.join(root, ".trygg");
        const builtEntries: Array<string> = [];
        const buildOutput = BuildOutput.make({
          fileSystem: fs,
          files,
          serverPlatform,
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
          platform: "node",
        });

        const serverEntryPath = path.join(generatedDir, "server-entry.ts");
        const serverEntry = yield* fs.readFileString(serverEntryPath);

        assert.deepStrictEqual(builtEntries, [serverEntryPath]);
        assert.include(serverEntry, 'import ApiLive from "../app/api.js"');
        assert.include(serverEntry, "HttpRouter.serve(withHttpTelemetry(ApiLive)");
      }).pipe(Effect.provide(Layer.mergeAll(PluginFilesTestLayer, NodeServerPlatform.layer))),
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
        const configResolved = yield* decodeConfigResolvedHook(plugin.configResolved);
        const buildStart = yield* decodeBuildStartHook(plugin.buildStart);
        const closeBundle = yield* decodeCloseBundleHook(plugin.closeBundle);
        const clientFile = path.join(root, "dist", "client", "client.txt");

        yield* Effect.promise(() => configResolved({ root, command: "build" }));
        yield* Effect.promise(() => buildStart());
        yield* fs.makeDirectory(path.dirname(clientFile), { recursive: true });
        yield* fs.writeFileString(clientFile, "client artifact");

        yield* Effect.promise(() => closeBundle());

        const serverExists = yield* fs.exists(path.join(root, "dist", "server.js"));
        const clientExists = yield* fs.exists(clientFile);

        assert.isTrue(serverExists);
        assert.isTrue(clientExists);
      }).pipe(Effect.provide(NodeFileSystemLayer)),
    );

    for (const runtime of ["node", "bun"]) {
      scoped(`should project HTTP telemetry in the generated ${runtime} production server`, () =>
        Effect.gen(function* () {
          // Scope: a generated server, real platform listener, and application-provided tracer.
          // Assertion: transport data and distributed ancestry survive; exported attributes/Exit omit secrets.
          const isBun = runtime === "bun";
          const entry = renderProductionServerEntryModule({
            hasApi: true,
            platform: {
              imports: isBun
                ? 'import * as BunHttpServer from "@effect/platform-bun/BunHttpServer"\nimport * as BunRuntime from "./runtime.js"'
                : 'import * as NodeHttpServer from "@effect/platform-node/NodeHttpServer"\nimport * as NodeRuntime from "./runtime.js"\nimport { createServer } from "node:http"',
              serverLayer: isBun
                ? 'makeBunServerLayer({ port: 0, hostname: "127.0.0.1" })'
                : 'NodeHttpServer.layer(() => createServer(), { port: 0, host: "127.0.0.1" })',
              runtime: isBun ? "BunRuntime" : "NodeRuntime",
            },
          });
          const compiled = yield* Effect.promise(() => transformWithEsbuild(entry, "server.ts"));
          const root = yield* makeTempDir({
            "dist/server.js": compiled.code,
            "dist/client/.trygg/index.html": "<html><body>ready</body></html>",
            "control.js": `
import { Deferred, Effect, Tracer } from "effect";
export const address = Deferred.makeUnsafe();
export const ended = Deferred.makeUnsafe();
export const attributes = [];
class CapturingSpan extends Tracer.NativeSpan {
  attribute(key, value) { attributes.push([key, value]); super.attribute(key, value); }
  end(time, exit) {
    super.end(time, exit);
    if (this.kind === "server") Deferred.doneUnsafe(ended, Effect.succeed({
      exit, traceId: this.traceId, sampled: this.sampled,
    }));
  }
}
export const tracer = Tracer.make({ span: (options) => new CapturingSpan(options) });
`,
            "app/api.js": `
import { Deferred, Effect, Layer, Tracer } from "effect";
import { HttpRouter, HttpServer, HttpServerRequest, HttpServerResponse } from "effect/unstable/http";
import { address, tracer } from "../control.js";
export default Layer.mergeAll(
  Layer.succeed(Tracer.Tracer, tracer),
  Layer.effectDiscard(Effect.gen(function* () {
    const server = yield* HttpServer.HttpServer;
    yield* Deferred.succeed(address, server.address);
  })),
  HttpRouter.add("GET", "/api/telemetry", Effect.gen(function* () {
    const request = yield* HttpServerRequest.HttpServerRequest;
    return HttpServerResponse.text(JSON.stringify({ url: request.url, header: request.headers["x-private"] }), {
      status: 201, headers: { "x-private-response": "response-sentinel-789" },
    });
  })),
  HttpRouter.add("GET", "/api/failure", Effect.fail("failure-sentinel")),
);
`,
            "dist/runtime.js": `
import assert from "node:assert/strict";
import { Deferred, Effect, Fiber } from "effect";
import { address, ended, attributes } from "../control.js";
export const runMain = (main) => {
  Effect.runPromise(Effect.scoped(Effect.gen(function* () {
    const server = yield* Effect.forkScoped(main);
    const bound = yield* Deferred.await(address);
    assert.equal(bound._tag, "TcpAddress");
    const response = yield* Effect.tryPromise(() => fetch(
      "http://127.0.0.1:" + bound.port + "/api/telemetry?token=query-sentinel-123", {
        headers: { "x-private": "header-sentinel-456", traceparent: "00-0123456789abcdef0123456789abcdef-0123456789abcdef-01" },
      },
    ));
    assert.equal(response.status, 201);
    assert.equal(response.headers.get("x-private-response"), "response-sentinel-789");
    const body = yield* Effect.tryPromise(() => response.text());
    assert.ok(body.includes("query-sentinel-123"));
    assert.ok(body.includes("header-sentinel-456"));
    const terminal = yield* Deferred.await(ended);
    assert.equal(terminal.traceId, "0123456789abcdef0123456789abcdef");
    assert.equal(terminal.exit._tag, "Success");
    const facts = new Map(attributes);
    assert.equal(facts.get("http.request.method"), "GET");
    assert.equal(facts.get("url.path"), "/api/telemetry");
    assert.equal(facts.get("http.response.status_code"), 201);
    assert.ok(!JSON.stringify({ attributes, terminal }).includes("sentinel"));
    const failed = yield* Effect.tryPromise(() => fetch("http://127.0.0.1:" + bound.port + "/api/failure"));
    assert.equal(failed.status, 500);
    yield* Effect.tryPromise(() => failed.text());
    yield* Fiber.interrupt(server);
  }))).then(
    () => console.log("HTTP_TELEMETRY_PROBE_PASSED"),
    (error) => { console.error(error); process.exitCode = 1; },
  );
};
`,
          });
          const run = isBun ? runBunToExit : runNodeToExit;
          const result = yield* run(path.join(root, "dist/server.js"), root, {
            HOST: "127.0.0.1",
            PORT: "4173",
          });
          // execFile supplies no error/code when the process exits successfully.
          assert.isUndefined(result.code, `${result.stdout}\n${result.stderr}`);
          assert.isFalse(result.killed);
          assert.isUndefined(result.signal);
          assert.include(result.stdout, "HTTP_TELEMETRY_PROBE_PASSED");
          assert.lengthOf(result.stdout.match(/Sent HTTP response/g) ?? [], 1);
          assert.include(result.stdout, "HttpRequestFailure");
          assert.notInclude(`${result.stdout}\n${result.stderr}`, "failure-sentinel");
        }).pipe(Effect.provide(NodeFileSystemLayer)),
      );
    }

    for (const runtime of ["node", "bun"]) {
      scoped(
        `should fail generated ${runtime} server startup with project-owned errors before readiness`,
        () =>
          Effect.gen(function* () {
            // Test: should fail generated server startup with project-owned errors before readiness
            // Scope: executes the bundled Node artifact for invalid env, missing shell, and bind failure.
            // Assertion: each process exits with the owning error tag and never emits the listening event.
            const fs = yield* FileSystem.FileSystem;
            const root = yield* makeTempDir({
              "app/layout.tsx": "export default function Layout() { return <html><body /></html> }",
              "app/routes.ts": "export const routes = { manifest: [] }",
            });
            const plugin = trygg({
              platform: runtime === "node" ? "node" : "bun",
              output: "server",
            });
            const configResolved = yield* decodeConfigResolvedHook(plugin.configResolved);
            const buildStart = yield* decodeBuildStartHook(plugin.buildStart);
            const closeBundle = yield* decodeCloseBundleHook(plugin.closeBundle);

            yield* Effect.promise(() => configResolved({ root, command: "build" }));
            yield* Effect.promise(() => buildStart());
            yield* Effect.promise(() => closeBundle());

            const entryPath = path.join(root, "dist", "server.js");
            const baseEnvironment: NodeJS.ProcessEnv = { HOST: "127.0.0.1" };
            const run = runtime === "node" ? runNodeToExit : runBunToExit;
            for (const environment of [
              ...["0", "65536", "1.5", "NaN", ""].map((PORT) => ({ ...baseEnvironment, PORT })),
              { HOST: "", PORT: "4173" },
            ]) {
              const result = yield* run(entryPath, root, environment);
              assert.strictEqual(result.code, 1);
              assert.isFalse(result.killed);
              assert.isNull(result.signal);
              const output = `${result.stdout}\n${result.stderr}`;
              assert.include(output, "ServerConfigError");
              assert.notInclude(output, "Server listening on http://");
            }
            for (const PORT of ["1", "4173", "65535"]) {
              const result = yield* run(entryPath, root, { ...baseEnvironment, PORT });
              const output = `${result.stdout}\n${result.stderr}`;
              assert.strictEqual(result.code, 1);
              assert.isFalse(result.killed);
              assert.isNull(result.signal);
              // Inclusive port bounds pass configuration and reach the missing-shell boundary.
              assert.include(output, "ServerFileSystemError");
              assert.notInclude(output, "ServerConfigError");
              assert.notInclude(output, "Server listening on http://");
            }

            const occupiedServer = yield* Effect.acquireRelease(
              Effect.gen(function* () {
                const server = createHttpServer();
                yield* Effect.promise(
                  () => new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve)),
                );
                return server;
              }),
              (server) =>
                Effect.promise(() => new Promise<void>((resolve) => server.close(() => resolve()))),
            );
            const occupiedAddress = occupiedServer.address();
            if (!isAddressInfo(occupiedAddress)) {
              return assert.fail("Expected occupied test server to listen on a TCP port");
            }
            const shellPath = path.join(root, "dist", "client", ".trygg", "index.html");
            yield* fs.makeDirectory(path.dirname(shellPath), { recursive: true });
            yield* fs.writeFileString(shellPath, "<html><body>ready</body></html>");
            const occupiedPort = yield* run(entryPath, root, {
              ...baseEnvironment,
              PORT: String(occupiedAddress.port),
            });

            const output = `${occupiedPort.stdout}\n${occupiedPort.stderr}`;
            assert.strictEqual(occupiedPort.code, 1);
            assert.isFalse(occupiedPort.killed);
            assert.isNull(occupiedPort.signal);
            assert.include(output, "ServerStartupError");
            assert.notInclude(output, "Server listening on http://");
          }).pipe(Effect.provide(NodeFileSystemLayer)),
      );
    }

    scoped("should contain a bundled Bun occupied-port failure without leaking its socket", () =>
      Effect.gen(function* () {
        // Test: should contain a bundled Bun occupied-port failure without leaking its socket
        // Scope: executes the real dist/server.js while another process owns its loopback port.
        // Assertion: Bun exits 1 with ServerStartupError, never logs readiness, and the port rebinds.
        const fs = yield* FileSystem.FileSystem;
        const root = yield* makeTempDir({
          "app/layout.tsx": "export default function Layout() { return <html><body /></html> }",
          "app/routes.ts": "export const routes = { manifest: [] }",
        });
        const plugin = trygg({ platform: "bun", output: "server" });
        const configResolved = yield* decodeConfigResolvedHook(plugin.configResolved);
        const buildStart = yield* decodeBuildStartHook(plugin.buildStart);
        const closeBundle = yield* decodeCloseBundleHook(plugin.closeBundle);

        yield* Effect.promise(() => configResolved({ root, command: "build" }));
        yield* Effect.promise(() => buildStart());
        yield* Effect.promise(() => closeBundle());

        const entryPath = path.join(root, "dist", "server.js");
        const shellPath = path.join(root, "dist", "client", ".trygg", "index.html");
        yield* fs.makeDirectory(path.dirname(shellPath), { recursive: true });
        yield* fs.writeFileString(shellPath, "<html><body>ready</body></html>");

        const attempt = yield* Effect.scoped(
          Effect.gen(function* () {
            const occupiedServer = yield* Effect.acquireRelease(
              Effect.gen(function* () {
                const server = createHttpServer();
                yield* Effect.promise(
                  () => new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve)),
                );
                return server;
              }),
              (server) =>
                Effect.promise(() => new Promise<void>((resolve) => server.close(() => resolve()))),
            );
            const address = occupiedServer.address();
            if (!isAddressInfo(address)) {
              return assert.fail("Expected occupied Bun test server to listen on a TCP port");
            }
            const result = yield* runBunToExit(entryPath, root, {
              HOST: "127.0.0.1",
              PORT: String(address.port),
            });
            return { port: address.port, result };
          }),
        );

        const output = `${attempt.result.stdout}\n${attempt.result.stderr}`;
        assert.strictEqual(attempt.result.code, 1);
        assert.isFalse(attempt.result.killed);
        assert.isNull(attempt.result.signal);
        assert.include(
          output,
          "ServerStartupError: The configured server address is already in use.",
        );
        assert.include(output, '{"code":"EADDRINUSE","syscall":"listen"}');
        assert.notInclude(output, "Failed to start server. Is port");
        assert.notInclude(output, "Server listening on http://");

        const reboundServer = yield* Effect.acquireRelease(
          Effect.tryPromise({
            try: () =>
              new Promise<ReturnType<typeof createHttpServer>>((resolve, reject) => {
                const server = createHttpServer();
                server.once("error", reject);
                server.listen(attempt.port, "127.0.0.1", () => {
                  server.removeListener("error", reject);
                  resolve(server);
                });
              }),
            catch: (cause) => new TestServerListenError({ cause }),
          }),
          (server) =>
            Effect.promise(() => new Promise<void>((resolve) => server.close(() => resolve()))),
        );
        assert.isTrue(reboundServer.listening);
      }).pipe(Effect.provide(NodeFileSystemLayer)),
    );

    scoped(
      "should build production server entry with default import for default-only api module",
      () =>
        Effect.gen(function* () {
          // Test: should build production server entry with default import for default-only api module
          // Scope: covers the full plugin build path for legacy default-export API apps.
          // Assertion: server entry includes default import and API wiring, and no generated client declarations are written.
          const fs = yield* FileSystem.FileSystem;
          const root = yield* makeTempDir({
            "app/layout.tsx": "export default function Layout() { return <html><body /></html> }",
            "app/routes.ts": "export const routes = { manifest: [] }",
            "app/api.ts": "export default {}",
          });
          const plugin = trygg({ platform: "node", output: "server" });
          const configResolved = yield* decodeConfigResolvedHook(plugin.configResolved);
          const buildStart = yield* decodeBuildStartHook(plugin.buildStart);
          const closeBundle = yield* decodeCloseBundleHook(plugin.closeBundle);

          yield* Effect.promise(() => configResolved({ root, command: "build" }));
          yield* Effect.promise(() => buildStart());
          yield* Effect.promise(() => closeBundle());

          const serverEntryPath = path.join(root, ".trygg", "server-entry.ts");
          const serverEntry = yield* fs.readFileString(serverEntryPath);
          const apiTypesExists = yield* fs.exists(path.join(root, ".trygg", "api.d.ts"));

          assert.include(serverEntry, 'import ApiLive from "../app/api.js"');
          assert.include(serverEntry, "HttpRouter.serve(withHttpTelemetry(ApiLive)");
          assert.isFalse(apiTypesExists);
        }).pipe(Effect.provide(NodeFileSystemLayer)),
    );

    for (const runtime of ["node", "bun"]) {
      for (const failureCase of [
        {
          phase: "import",
          api: 'throw new Error("fixture-import-failure"); export default {};',
          expected: "fixture-import-failure",
          releases: 0,
        },
        {
          phase: "composition",
          api: "export default {};",
          expected: "must have a default export that is a composed Layer",
          releases: 0,
        },
        {
          phase: "acquisition",
          api: `import { Effect, Layer } from "effect";
export default Layer.effectDiscard(Effect.gen(function* () {
  yield* Effect.addFinalizer(() => Effect.sync(() => console.log("FIXTURE_PARTIAL_RELEASE")));
  return yield* Effect.fail("fixture-acquisition-failure");
}));`,
          expected: "fixture-acquisition-failure",
          releases: 1,
        },
      ]) {
        scoped(
          `should reject ${runtime} configureServer readiness after actual API ${failureCase.phase} failure`,
          () =>
            Effect.gen(function* () {
              // Scope: a fresh runtime process runs Vite, the published plugin and generated handler factory.
              // Assertion: startup rejects the actual API failure, releases partial acquisition once,
              // and its complete output contains no API readiness announcement.
              const root = yield* makeTempDir({
                "app/layout.tsx":
                  "export default function Layout() { return <html><body /></html> }",
                "app/routes.ts": "export const routes = { manifest: [] }",
                "app/api.ts": failureCase.api,
                "run.mjs": `import { createServer } from "vite";
import { trygg } from "trygg/vite-plugin";
let server;
let rejected = false;
try {
  await createServer({
    configFile: false,
    root: process.cwd(),
    server: { middlewareMode: true },
    plugins: [
      { name: "capture-owner", enforce: "pre", configureServer(value) { server = value; } },
      trygg({ platform: "${runtime}", output: "server" }),
    ],
  });
} catch (error) {
  rejected = true;
  console.log("FIXTURE_STARTUP_FAILED", String(error));
} finally {
  await server?.close();
}
process.exitCode = rejected ? 0 : 1;
`,
              });
              const run = runtime === "node" ? runNodeToExit : runBunToExit;
              const executablePath = yield* Config.string("PATH");
              const result = yield* run(path.join(root, "run.mjs"), root, { PATH: executablePath });
              const output = `${result.stdout}\n${result.stderr}`;
              assert.isUndefined(result.code, output);
              assert.isFalse(result.killed);
              assert.include(output, "FIXTURE_STARTUP_FAILED");
              assert.include(output, failureCase.expected);
              assert.notInclude(output, "API handlers loaded");
              assert.strictEqual(
                output.split("FIXTURE_PARTIAL_RELEASE").length - 1,
                failureCase.releases,
              );
            }).pipe(Effect.provide(NodeFileSystemLayer)),
        );
      }
    }

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
          (viteServer) =>
            Effect.tryPromise(() => viteServer.close()).pipe(
              Effect.catchTag("UnknownError", logTestCleanupError("dev server close")),
            ),
        );

        yield* Effect.promise(() => server.listen(0));
        const address = server.httpServer?.address() ?? null;
        if (!isAddressInfo(address)) {
          return assert.fail("Expected Vite dev server to listen on a TCP port");
        }

        const entry = yield* fs.readFileString(path.join(root, ".trygg", "entry.tsx"));
        const response = yield* requestHttp({
          headers: { accept: "text/html" },
          path: "/dashboard?tab=dev",
          port: address.port,
        });
        const html = response.body;

        assert.strictEqual(response.status, 200);
        assert.include(entry, 'import { routes } from "../app/routes"');
        assert.include(html, '<script type="module" src="/.trygg/entry.tsx"></script>');
      }).pipe(Effect.provide(NodeFileSystemLayer)),
    );

    scoped("should keep the replacement Vite server live across restart and terminal close", () =>
      Effect.gen(function* () {
        // Test: should keep the replacement Vite server live across restart and terminal close
        // Scope: covers Vite's create-replacement, close-old, and final-close lifecycle ordering.
        // Assertion: requests return 200 before and after restart, then the final close completes.
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
          (viteServer) =>
            Effect.tryPromise(() => viteServer.close()).pipe(
              Effect.catchTag("UnknownError", logTestCleanupError("restarted dev server close")),
            ),
        );
        yield* Effect.promise(() => server.listen(0));

        const initialAddress = server.httpServer?.address() ?? null;
        if (!isAddressInfo(initialAddress)) {
          return assert.fail("Expected initial Vite server to listen on a TCP port");
        }
        const initial = yield* requestHttp({
          headers: { accept: "text/html" },
          path: "/before-restart",
          port: initialAddress.port,
        });

        yield* Effect.promise(() => server.restart());
        const replacementAddress = server.httpServer?.address() ?? null;
        if (!isAddressInfo(replacementAddress)) {
          return assert.fail("Expected replacement Vite server to listen on a TCP port");
        }
        const replacement = yield* requestHttp({
          headers: { accept: "text/html" },
          path: "/after-restart",
          port: replacementAddress.port,
        });

        assert.strictEqual(initial.status, 200);
        assert.strictEqual(replacement.status, 200);

        yield* Effect.promise(() => server.close());
        assert.isFalse(server.httpServer?.listening ?? false);
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

        yield* ViteServer.make(source).mountApiMiddleware(middleware);

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

        yield* ViteServer.make(source).mountHtmlFallbackMiddleware(generateHtmlTemplate());
        const middleware = mounted[0];
        if (middleware === undefined) {
          return assert.fail("Expected HTML fallback middleware to mount");
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
          return assert.fail("Expected HTTP server to listen on a TCP port");
        }

        const response = yield* requestHttp({
          path: "/dashboard?tab=dev",
          port: address.port,
        });

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

        yield* ViteServer.make(source).mountHtmlFallbackMiddleware(generateHtmlTemplate());
        const middleware = mounted[0];
        if (middleware === undefined) {
          return assert.fail("Expected HTML fallback middleware to mount");
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
          return assert.fail("Expected HTTP server to listen on a TCP port");
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

    scoped("should call next only for a typed HTML transform failure before response commit", () =>
      Effect.gen(function* () {
        // Test: should call next only for a typed HTML transform failure before response commit
        // Scope: covers the expected transform rejection before status or headers are mutated.
        // Assertion: next runs once and no terminal Cause is reported.
        let middleware: Connect.NextHandleFunction | undefined;
        const reported = yield* Deferred.make<Cause.Cause<unknown>>();
        const source: ViteServerSource = {
          ssrLoadModule: () => Promise.resolve({}),
          watcher: { on: () => undefined },
          middlewares: {
            use: (handler) => {
              middleware = handler;
            },
          },
          transformIndexHtml: () => failPromise(new ExpectedHtmlTransformFailure()),
        };
        const owner = yield* Effect.acquireRelease(Scope.make(), (scope) =>
          Scope.close(scope, Exit.void),
        );
        yield* Scope.provide(
          ViteServer.make(source, (cause) =>
            Deferred.succeed(reported, cause).pipe(Effect.asVoid),
          ).mountHtmlFallbackMiddleware(generateHtmlTemplate()),
          owner,
        );
        if (middleware === undefined) {
          return assert.fail("Expected HTML fallback middleware to mount");
        }
        let resolveNext: (() => void) | undefined;
        const nextCalled = new Promise<void>((resolve) => {
          resolveNext = resolve;
        });
        let nextCount = 0;

        middleware(
          decodeIncomingMessage({ method: "GET", url: "/dashboard" }),
          decodeServerResponse({}),
          () => {
            nextCount += 1;
            resolveNext?.();
          },
        );
        yield* Effect.promise(() => nextCalled);

        assert.strictEqual(nextCount, 1);
        assert.isFalse(yield* Deferred.isDone(reported));
      }),
    );

    scoped("should preserve and report a response defect without calling next", () =>
      Effect.gen(function* () {
        // Test: should preserve and report a response defect without calling next
        // Scope: covers failure after transform succeeds and response commit begins.
        // Assertion: the reporter observes a Die Cause and downstream middleware is not entered.
        let middleware: Connect.NextHandleFunction | undefined;
        const reported = yield* Deferred.make<Cause.Cause<unknown>>();
        const source: ViteServerSource = {
          ssrLoadModule: () => Promise.resolve({}),
          watcher: { on: () => undefined },
          middlewares: {
            use: (handler) => {
              middleware = handler;
            },
          },
          transformIndexHtml: (_url, html) => Promise.resolve(html),
        };
        const owner = yield* Effect.acquireRelease(Scope.make(), (scope) =>
          Scope.close(scope, Exit.void),
        );
        yield* Scope.provide(
          ViteServer.make(source, (cause) =>
            Deferred.succeed(reported, cause).pipe(Effect.asVoid),
          ).mountHtmlFallbackMiddleware(generateHtmlTemplate()),
          owner,
        );
        if (middleware === undefined) {
          return assert.fail("Expected HTML fallback middleware to mount");
        }
        let nextCount = 0;

        middleware(
          decodeIncomingMessage({ method: "GET", url: "/dashboard" }),
          decodeServerResponse({
            statusCode: 0,
            setHeader: () => decodeResponseDefect("response defect"),
          }),
          () => {
            nextCount += 1;
          },
        );
        const cause = yield* Deferred.await(reported);

        assert.isTrue(Cause.hasDies(cause));
        assert.strictEqual(nextCount, 0);
      }),
    );

    scoped("should preserve fallback interruption without calling next", () =>
      Effect.gen(function* () {
        // Test: should preserve fallback interruption without calling next
        // Scope: covers server shutdown while Vite HTML transformation is pending.
        // Assertion: scope close awaits the callback, reports interruption, and never delegates.
        let middleware: Connect.NextHandleFunction | undefined;
        let startTransform: (() => void) | undefined;
        const transformStarted = new Promise<void>((resolve) => {
          startTransform = resolve;
        });
        const reported = yield* Deferred.make<Cause.Cause<unknown>>();
        const source: ViteServerSource = {
          ssrLoadModule: () => Promise.resolve({}),
          watcher: { on: () => undefined },
          middlewares: {
            use: (handler) => {
              middleware = handler;
            },
          },
          transformIndexHtml: () => {
            startTransform?.();
            return new Promise<string>(() => undefined);
          },
        };
        const owner = yield* Effect.acquireRelease(Scope.make(), (scope) =>
          Scope.close(scope, Exit.void),
        );
        yield* Scope.provide(
          ViteServer.make(source, (cause) =>
            Deferred.succeed(reported, cause).pipe(Effect.asVoid),
          ).mountHtmlFallbackMiddleware(generateHtmlTemplate()),
          owner,
        );
        if (middleware === undefined) {
          return assert.fail("Expected HTML fallback middleware to mount");
        }
        let nextCount = 0;

        middleware(
          decodeIncomingMessage({ method: "GET", url: "/dashboard" }),
          decodeServerResponse({}),
          () => {
            nextCount += 1;
          },
        );
        yield* Effect.promise(() => transformStarted);
        yield* Scope.close(owner, Exit.void);
        const cause = yield* Deferred.await(reported);

        assert.isTrue(Cause.hasInterrupts(cause));
        assert.strictEqual(nextCount, 0);
      }),
    );

    scoped("should recover only all-Fail transform Causes at the HTML fallback boundary", () =>
      Effect.gen(function* () {
        // Test: should recover only all-Fail transform Causes at the HTML fallback boundary
        // Scope: compares two expected transform failures with fail+die, fail+interrupt, and wrong-policy failure.
        // Assertion: only the all-expected Cause calls next; every other Cause is reemitted with all reasons intact.
        const first = new PluginFileSystemError({
          operation: "transform",
          path: "/index.html",
          cause: "first transform failure",
        });
        const second = new PluginFileSystemError({
          operation: "transform",
          path: "/index.html",
          cause: "second transform failure",
        });
        const wrongPolicy = new PluginFileSystemError({
          operation: "read",
          path: "/index.html",
          cause: "read failure",
        });
        let nextCalls = 0;

        const recovered = yield* transformHtmlForFallback(
          Effect.failCause(Cause.combine(Cause.fail(first), Cause.fail(second))),
          () => {
            nextCalls += 1;
          },
        );
        assert.isTrue(Option.isNone(recovered));
        assert.strictEqual(nextCalls, 1);

        const unrecoverable = [
          Cause.combine(Cause.fail(first), Cause.die("transform defect")),
          Cause.combine(Cause.fail(first), Cause.interrupt(91)),
          Cause.fail(wrongPolicy),
        ];
        for (const expectedCause of unrecoverable) {
          const exit = yield* transformHtmlForFallback(Effect.failCause(expectedCause), () => {
            nextCalls += 1;
          }).pipe(Effect.exit);

          assert.isTrue(Exit.isFailure(exit));
          if (Exit.isFailure(exit)) {
            assert.deepStrictEqual(
              exit.cause.reasons.map((reason) => reason._tag),
              expectedCause.reasons.map((reason) => reason._tag),
            );
          }
        }
        assert.strictEqual(nextCalls, 1);
      }),
    );

    scoped("should own watcher callbacks and remove admission on scope close", () =>
      Effect.gen(function* () {
        // Test: should own watcher callbacks and remove admission on scope close
        // Scope: covers native watcher callbacks whose Promise results are ignored by EventEmitter.
        // Assertion: callback failure is reported once and the listener is detached at shutdown.
        let changeHandler: ((file: string) => void) | undefined;
        let removed = 0;
        let reports = 0;
        const watcherCause = Cause.combine(Cause.fail("watch failed"), Cause.die("watch defect"));
        const reported = yield* Deferred.make<Cause.Cause<string>>();
        const source: ViteServerSource = {
          ssrLoadModule: () => Promise.resolve({}),
          watcher: {
            on: (_event, handler) => {
              changeHandler = handler;
            },
            off: () => {
              removed += 1;
            },
          },
          middlewares: { use: () => undefined },
          transformIndexHtml: (_url, html) => Promise.resolve(html),
        };
        const owner = yield* Scope.make();
        yield* Scope.provide(
          ViteServer.make(source).onFileChange(
            () => Effect.failCause(watcherCause),
            (cause) =>
              Effect.sync(() => {
                reports += 1;
              }).pipe(Effect.andThen(Deferred.succeed(reported, cause)), Effect.asVoid),
          ),
          owner,
        );
        if (changeHandler === undefined) {
          return assert.fail("Expected watcher change listener to be installed");
        }
        changeHandler("app/api.ts");
        const observedCause = yield* Deferred.await(reported);
        yield* Scope.close(owner, Exit.void);

        assert.strictEqual(reports, 1);
        assert.strictEqual(removed, 1);
        assert.deepStrictEqual(
          observedCause.reasons.map((reason) => reason._tag),
          ["Fail", "Die"],
        );
      }),
    );

    scoped("should interrupt and await active watcher work during scope close", () =>
      Effect.gen(function* () {
        // Test: should interrupt and await active watcher work during scope close
        // Scope: covers shutdown while a native file-change callback is still running.
        // Assertion: the callback exits interrupted, reports once, and listener removal is complete on return.
        let changeHandler: ((file: string) => void) | undefined;
        let removed = 0;
        let reports = 0;
        const started = yield* Deferred.make<void>();
        const completed = yield* Deferred.make<Exit.Exit<void, never>>();
        const source: ViteServerSource = {
          ssrLoadModule: () => Promise.resolve({}),
          watcher: {
            on: (_event, handler) => {
              changeHandler = handler;
            },
            off: () => {
              removed += 1;
            },
          },
          middlewares: { use: () => undefined },
          transformIndexHtml: (_url, html) => Promise.resolve(html),
        };
        const owner = yield* Effect.acquireRelease(Scope.make(), (scope) =>
          Scope.close(scope, Exit.void),
        );
        yield* Scope.provide(
          ViteServer.make(source).onFileChange(
            () =>
              Deferred.succeed(started, undefined).pipe(
                Effect.andThen(Effect.never),
                Effect.onExit((exit) => Deferred.succeed(completed, exit).pipe(Effect.asVoid)),
              ),
            () =>
              Effect.sync(() => {
                reports += 1;
              }),
          ),
          owner,
        );
        if (changeHandler === undefined) {
          return assert.fail("Expected watcher change listener to be installed");
        }

        changeHandler("app/api.ts");
        yield* Deferred.await(started);
        yield* Scope.close(owner, Exit.void);
        const exit = yield* Deferred.await(completed);

        assert.isTrue(Exit.isFailure(exit));
        if (Exit.isFailure(exit)) assert.isTrue(Cause.hasInterrupts(exit.cause));
        assert.strictEqual(reports, 1);
        assert.strictEqual(removed, 1);
      }),
    );

    scoped("should delegate one api.ts reload request to PluginApi", () =>
      Effect.gen(function* () {
        // Test: should delegate one api.ts reload request to PluginApi
        // Scope: covers the file-change boundary between the Vite watcher and active API handle.
        // Assertion: an api.ts change runs exactly one reload and unrelated files do not reload.
        let reloads = 0;
        const api = PluginApi.make({
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
        // Assertion: every typed reload failure is logged and the all-Fail Cause is recovered.
        const first = new ApiInitError({ message: "first reload failure" });
        const second = new ApiInitError({ message: "second reload failure" });
        const api = PluginApi.make({
          middleware: (_req, _res, next) => next(),
          reload: Effect.failCause(Cause.combine(Cause.fail(first), Cause.fail(second))),
          dispose: Effect.void,
        });

        const exit = yield* Effect.exit(api.reloadChangedFile(path.join("app", "api.ts")));

        assert.isTrue(Exit.isSuccess(exit));
      }),
    );

    scoped("should preserve mixed reload Causes at the PluginApi watcher facade", () =>
      Effect.gen(function* () {
        // Test: should preserve mixed reload Causes at the PluginApi watcher facade
        // Scope: covers fail+die and fail+interrupt reload termination before watcher recovery.
        // Assertion: neither mixed Cause is logged as an ordinary typed failure or converted to success.
        const error = new ApiInitError({ message: "reload failed" });
        const causes = [
          Cause.combine(Cause.fail(error), Cause.die("reload defect")),
          Cause.combine(Cause.fail(error), Cause.interrupt(92)),
        ];

        for (const expectedCause of causes) {
          const api = PluginApi.make({
            middleware: (_req, _res, next) => next(),
            reload: Effect.failCause(expectedCause),
            dispose: Effect.void,
          });
          const exit = yield* api.reloadChangedFile(path.join("app", "api.ts")).pipe(Effect.exit);

          assert.isTrue(Exit.isFailure(exit));
          if (Exit.isFailure(exit)) {
            assert.deepStrictEqual(
              exit.cause.reasons.map((reason) => reason._tag),
              expectedCause.reasons.map((reason) => reason._tag),
            );
          }
        }
      }),
    );

    scoped("should load handler factory virtual module with make vocabulary", () =>
      Effect.gen(function* () {
        // Test: should load handler factory virtual module with make vocabulary
        // Scope: validates the SSR-loaded virtual module contract at the plugin load boundary.
        // Assertion: generated module exports make/from/to/get names and omits superseded create/detect names.
        const plugin = trygg({ platform: "node", output: "server" });
        const resolveId = yield* decodeResolveIdHook(plugin.resolveId);
        const load = yield* decodeLoadHook(plugin.load);
        const resolvedId = resolveId("virtual:trygg/handler-factory");
        if (resolvedId === null) {
          return assert.fail("Expected handler factory virtual module to resolve");
        }

        const code = yield* Effect.promise(() => load(resolvedId));
        if (code === null) {
          return assert.fail("Expected handler factory virtual module to load");
        }

        const mod = yield* loadHandlerFactoryModule;
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

    for (const platform of [
      { name: "Node", layer: NodeDevPlatform.layer },
      { name: "Bun", layer: BunDevPlatform.layer },
    ]) {
      for (const phase of ["handler", "stream"]) {
        for (const action of ["reload", "disconnect"]) {
          scoped(
            `should await an active generated ${platform.name} ${phase} during ${action} before releasing its API layer`,
            () =>
              Effect.gen(function* () {
                // Scope: the real SSR-generated factory serves HTTP while its adapter replaces the API.
                // Assertion: the replacement serves immediately, but old services outlive request cleanup.
                const factory = yield* loadHandlerFactoryModule;
                const platformService = yield* DevPlatform;
                const requestStarted = yield* Deferred.make<void>();
                const cleanupStarted = yield* Deferred.make<void>();
                const cleanupFinished = yield* Deferred.make<void>();
                const releaseCleanup = yield* Deferred.make<void>();
                const events: Array<string> = [];
                const errors: Array<unknown> = [];
                let generation = 0;
                const apiScope = yield* Effect.acquireRelease(Scope.make(), (scope) =>
                  Scope.close(scope, Exit.void),
                );
                // Unblock the request before the API owner closes, including on assertion failure.
                yield* Effect.addFinalizer(() => Deferred.succeed(releaseCleanup, undefined));
                const handle = yield* platformService
                  .makeApi({
                    handlerFactory: factory,
                    onError: (error) =>
                      Effect.sync(() => {
                        errors.push(error);
                      }),
                    loadApiModule: () =>
                      Effect.sync(() => {
                        const current = ++generation;
                        const services = Layer.effectDiscard(
                          Effect.addFinalizer(() =>
                            Effect.sync(() => {
                              events.push(`release:${current}`);
                            }),
                          ),
                        );
                        const pending = HttpRouter.add(
                          "GET",
                          "/api/pending",
                          Effect.gen(function* () {
                            yield* Effect.addFinalizer(() =>
                              Deferred.succeed(cleanupStarted, undefined).pipe(
                                Effect.andThen(Deferred.await(releaseCleanup)),
                                Effect.andThen(
                                  Effect.sync(() => {
                                    events.push(`request-release:${current}`);
                                  }),
                                ),
                                Effect.andThen(Deferred.succeed(cleanupFinished, undefined)),
                              ),
                            );
                            if (phase === "stream") {
                              return HttpServerResponse.stream(
                                Stream.fromEffect(Deferred.succeed(requestStarted, undefined)).pipe(
                                  Stream.flatMap(() => Stream.never),
                                ),
                              );
                            }
                            yield* Deferred.succeed(requestStarted, undefined);
                            return yield* Effect.never;
                          }),
                        );
                        return {
                          default: Layer.mergeAll(
                            services,
                            pending,
                            HttpRouter.add(
                              "GET",
                              "/api/version",
                              HttpServerResponse.text(String(current)),
                            ),
                          ),
                        };
                      }),
                  })
                  .pipe(Scope.provide(apiScope));
                const server = yield* Effect.acquireRelease(
                  Effect.sync(() =>
                    createHttpServer((req, res) => handle.middleware(req, res, () => res.end())),
                  ),
                  (httpServer) =>
                    Effect.promise(
                      () => new Promise<void>((resolve) => httpServer.close(() => resolve())),
                    ),
                );
                yield* Effect.promise(
                  () => new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve)),
                );
                const address = server.address();
                if (!isAddressInfo(address)) return assert.fail("Expected a TCP server");
                const client = yield* Effect.acquireRelease(
                  Effect.sync(() => {
                    const request = httpRequest(
                      { hostname: "127.0.0.1", port: address.port, path: "/api/pending" },
                      (response) => response.resume(),
                    );
                    request.on("error", () => undefined);
                    request.end();
                    return request;
                  }),
                  (request) =>
                    Effect.sync(() => {
                      request.destroy();
                    }),
                );
                yield* Deferred.await(requestStarted);
                const operation = yield* (
                  action === "reload"
                    ? handle.reload
                    : Effect.sync(() => {
                        client.destroy();
                      })
                ).pipe(Effect.forkChild);
                yield* Deferred.await(cleanupStarted);
                const response = yield* requestHttp({ port: address.port, path: "/api/version" });
                assert.strictEqual(response.body, action === "reload" ? "2" : "1");
                assert.deepStrictEqual(events, []);
                if (action === "reload") assert.isUndefined(operation.pollUnsafe());
                yield* Deferred.succeed(releaseCleanup, undefined);
                yield* Deferred.await(cleanupFinished);
                yield* Fiber.join(operation);
                assert.deepStrictEqual(
                  events,
                  action === "reload" ? ["request-release:1", "release:1"] : ["request-release:1"],
                );
                yield* Scope.close(apiScope, Exit.void);
                assert.deepStrictEqual(
                  events,
                  action === "reload"
                    ? ["request-release:1", "release:1", "release:2"]
                    : ["request-release:1", "release:1"],
                );
                assert.deepStrictEqual(errors, []);
              }).pipe(Effect.provide(Layer.merge(NodeFileSystemLayer, platform.layer))),
          );
        }
      }
    }

    scoped("should preserve HTTP logging controls and scoped application loggers", () =>
      Effect.gen(function* () {
        // Scope: the automatic logger's private disable control and application logger overrides.
        // Assertion: only enabled HTTP responses log; application records retain their own sinks and values.
        const factory = yield* loadHandlerFactoryModule;
        for (const disabled of [false, true]) {
          const application: Array<unknown> = [];
          const subtree: Array<unknown> = [];
          const responses: Array<unknown> = [];
          const rootLogger = Logger.make((options) => {
            const annotations = options.fiber.getRef(References.CurrentLogAnnotations);
            if (Object.hasOwn(annotations, "http.status")) responses.push(options.message);
            else application.push(options.message);
          });
          const subtreeLogger = Logger.make((options) => {
            subtree.push(options.message);
          });
          const route = Effect.gen(function* () {
            const current = yield* Logger.CurrentLoggers;
            assert.isTrue(current.has(rootLogger));
            yield* Effect.log("application-owned-value");
            yield* Effect.log("subtree-owned-value").pipe(
              Effect.provide(Logger.layer([subtreeLogger])),
            );
            return HttpServerResponse.text("ok");
          });
          const layer = yield* factory.makeApiLayer({
            default: Layer.merge(
              Logger.layer([rootLogger]),
              HttpRouter.add(
                "GET",
                "/api/logger",
                disabled ? HttpMiddleware.withLoggerDisabled(route) : route,
              ),
            ),
          });
          const handler = yield* factory.makeWebHandler(layer);
          const response = yield* Effect.promise(() =>
            handler.handler(new Request("http://localhost/api/logger")),
          );
          assert.strictEqual(response.status, 200);
          yield* Effect.promise(() => response.text());
          yield* handler.dispose;
          assert.deepStrictEqual(application, [["application-owned-value"]]);
          assert.deepStrictEqual(subtree, [["subtree-owned-value"]]);
          assert.deepStrictEqual(responses, disabled ? [] : [["Sent HTTP response"]]);
        }
      }).pipe(Effect.provide(NodeFileSystemLayer)),
    );

    for (const outcome of ["success", "failure", "defect", "interruption", "mixed"]) {
      for (const sampled of [true, false]) {
        scoped(
          `should exclude request secrets before generated HTTP spans reach the tracer (${outcome}, sampled=${sampled})`,
          () =>
            Effect.gen(function* () {
              // Scope: the generated factory uses Effect's automatic HTTP server tracer.
              // Assertion: business inputs survive, while attributes delivered to the tracer omit secrets.
              const factory = yield* loadHandlerFactoryModule;
              const attributes: Array<readonly [string, unknown]> = [];
              const spans: Array<Tracer.NativeSpan> = [];
              const logs: Array<{
                readonly message: unknown;
                readonly cause: Cause.Cause<unknown>;
                readonly annotations: Readonly<Record<string, unknown>>;
              }> = [];
              const logger = Logger.make((options) => {
                const annotations = options.fiber.getRef(References.CurrentLogAnnotations);
                if (Object.hasOwn(annotations, "http.status")) {
                  logs.push({ message: options.message, cause: options.cause, annotations });
                }
              });
              const ended = yield* Deferred.make<Exit.Exit<unknown, unknown>>();
              const handled = yield* Deferred.make<Exit.Exit<unknown, unknown>>();
              const failure =
                outcome === "failure"
                  ? Cause.fail("failure-sentinel")
                  : outcome === "defect"
                    ? Cause.die("defect-sentinel")
                    : outcome === "interruption"
                      ? Cause.interrupt(42)
                      : Cause.combine(
                          Cause.combine(
                            Cause.fail("failure-sentinel"),
                            Cause.die("defect-sentinel"),
                          ),
                          Cause.interrupt(42),
                        );
              const tracer = Tracer.make({
                span: (options) => {
                  class CapturingSpan extends Tracer.NativeSpan {
                    override attribute(key: string, value: unknown): void {
                      attributes.push([key, value]);
                      super.attribute(key, value);
                    }
                    override end(time: bigint, exit: Exit.Exit<unknown, unknown>): void {
                      super.end(time, exit);
                      // The tracer callback is synchronous; signal the test without starting a runtime.
                      if (this.kind === "server") Deferred.doneUnsafe(ended, Effect.succeed(exit));
                    }
                  }
                  const span = new CapturingSpan(options);
                  spans.push(span);
                  return span;
                },
              });
              const layer = yield* factory.makeApiLayer({
                default: Layer.mergeAll(
                  Layer.succeed(Tracer.Tracer, tracer),
                  Logger.layer([logger]),
                  HttpRouter.add(
                    "GET",
                    "/api/telemetry",
                    Effect.gen(function* () {
                      const request = yield* HttpServerRequest.HttpServerRequest;
                      const activeLoggers = yield* Logger.CurrentLoggers;
                      assert.isTrue(activeLoggers.has(logger));
                      assert.include(request.url, "query-sentinel-123");
                      assert.strictEqual(request.headers["x-private"], "header-sentinel-456");
                      if (outcome !== "success") return yield* Effect.failCause(failure);
                      return HttpServerResponse.text("ok", {
                        status: 201,
                        headers: { "x-private-response": "response-sentinel-789" },
                      });
                    }).pipe(Effect.onExit((exit) => Deferred.succeed(handled, exit))),
                  ),
                ),
              });
              const handler = yield* factory.makeWebHandler(layer);
              const response = yield* Effect.promise(() =>
                handler.handler(
                  new Request("http://localhost/api/telemetry?token=query-sentinel-123", {
                    headers: {
                      "x-private": "header-sentinel-456",
                      traceparent: `00-0123456789abcdef0123456789abcdef-0123456789abcdef-${sampled ? "01" : "00"}`,
                    },
                  }),
                ),
              );
              const status = outcome === "success" ? 201 : outcome === "interruption" ? 503 : 500;
              assert.strictEqual(response.status, status);
              if (outcome === "success")
                assert.strictEqual(
                  response.headers.get("x-private-response"),
                  "response-sentinel-789",
                );
              yield* Effect.promise(() => response.text());
              yield* handler.dispose;
              const terminal = yield* Deferred.await(ended);
              const server = spans.filter((span) => span.kind === "server");
              assert.lengthOf(server, 1);
              assert.strictEqual(server[0]?.traceId, "0123456789abcdef0123456789abcdef");
              assert.strictEqual(server[0]?.status._tag, "Ended");
              assert.strictEqual(server[0]?.sampled, sampled);
              if (sampled)
                assert.includeDeepMembers(attributes, [
                  ["http.request.method", "GET"],
                  ["url.path", "/api/telemetry"],
                  ["http.response.status_code", status],
                ]);
              assert.notInclude(JSON.stringify(attributes), "sentinel");
              assert.notInclude(JSON.stringify(terminal), "sentinel");
              assert.lengthOf(logs, 1);
              assert.notInclude(JSON.stringify(logs), "sentinel");
              assert.strictEqual(logs[0]?.annotations["http.status"], status);
              const original = yield* Deferred.await(handled);
              assert.strictEqual(Exit.isSuccess(terminal), outcome === "success");
              if (outcome !== "success") {
                assert.isTrue(Exit.isFailure(original));
                if (Exit.isFailure(original)) assert.deepStrictEqual(original.cause, failure);
                assert.strictEqual(Exit.hasFails(terminal), Cause.hasFails(failure));
                assert.strictEqual(Exit.hasDies(terminal), Cause.hasDies(failure));
                // Effect's HTTP response conversion retains pure interrupts, but strips
                // interrupt reasons from mixed failures before handing them to its tracer.
                assert.strictEqual(Exit.hasInterrupts(terminal), outcome === "interruption");
              }
            }).pipe(Effect.provide(NodeFileSystemLayer)),
        );
      }
    }

    for (const shape of ["direct", "replaced", "HEAD"]) {
      scoped(
        `should close an unconsumed generated ${shape} response before releasing its API services`,
        () =>
          Effect.gen(function* () {
            // Scope: the Web response has been produced, but the bridge has not acquired its reader.
            // Assertion: disposal still closes the request Scope before its API Layer services.
            const factory = yield* loadHandlerFactoryModule;
            const events: Array<string> = [];
            const owner = yield* Effect.acquireRelease(Scope.make(), (scope) =>
              Scope.close(scope, Exit.void),
            );
            const layer = yield* factory.makeApiLayer({
              default: Layer.merge(
                Layer.effectDiscard(
                  Effect.addFinalizer(() =>
                    Effect.sync(() => {
                      events.push("service");
                    }),
                  ),
                ),
                HttpRouter.add(
                  "GET",
                  "/api/stream",
                  Effect.gen(function* () {
                    yield* Effect.addFinalizer(() =>
                      Effect.sync(() => {
                        events.push("request");
                      }),
                    );
                    const streamed = HttpServerResponse.stream(Stream.never, {
                      status: 201,
                      contentLength: 7,
                      headers: { "x-response": "preserved" },
                    });
                    if (shape === "replaced") {
                      yield* HttpEffect.appendPreResponseHandler(() => Effect.succeed(streamed));
                      return HttpServerResponse.text("replace");
                    }
                    return streamed;
                  }),
                ),
              ),
            });
            const handler = yield* factory.makeWebHandler(layer).pipe(Scope.provide(owner));
            const response = yield* Effect.acquireRelease(
              Effect.promise(() =>
                handler.handler(
                  new Request("http://localhost/api/stream", {
                    method: shape === "HEAD" ? "HEAD" : "GET",
                  }),
                ),
              ),
              (response) =>
                Effect.tryPromise(async () => {
                  await response.body?.cancel();
                }).pipe(
                  Effect.catchTag("UnknownError", logTestCleanupError("already canceled response")),
                ),
            );
            if (shape === "HEAD") assert.isNull(response.body);
            else assert.isNotNull(response.body);
            assert.strictEqual(response.status, 201);
            assert.strictEqual(response.headers.get("x-response"), "preserved");
            assert.strictEqual(response.headers.get("content-length"), "7");
            yield* handler.dispose;
            yield* Scope.close(owner, Exit.void);
            assert.deepStrictEqual(events, ["request", "service"]);
          }).pipe(Effect.provide(NodeFileSystemLayer)),
      );
    }

    scoped("should bridge node request and response at handler factory boundary", () =>
      Effect.gen(function* () {
        // Test: should bridge node request and response at handler factory boundary
        // Scope: covers generated Node factory helpers where IncomingMessage/ServerResponse meet web Request/Response.
        // Assertion: body, headers, URL, status, and response headers round-trip through fromNodeRequest/toNodeResponse.
        const mod = yield* loadHandlerFactoryModule;

        const server = yield* Effect.acquireRelease(
          Effect.sync(() =>
            createHttpServer((req, res) => {
              mod
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
          return assert.fail("Expected test HTTP server to listen on a TCP port");
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

    scoped("should bound and cancel generated Node bridge work without losing cookies", () =>
      Effect.gen(function* () {
        // Test: should bound and cancel generated Node bridge work without losing cookies
        // Scope: exercises the actual SSR-loaded Node bridge used by production dev handlers.
        // Assertion: overflow/abort clean listeners, disconnect cancels the reader, and cookies stay distinct.
        const mod = yield* loadHandlerFactoryModule;

        const overflowRequest = new EventEmitter();
        let resumeCount = 0;
        Object.assign(overflowRequest, {
          complete: false,
          headers: { host: "localhost" },
          method: "POST",
          pause: () => overflowRequest,
          resume: () => {
            resumeCount += 1;
            return overflowRequest;
          },
          url: "/api/upload",
        });
        const overflowPromise = mod.getBody(decodeIncomingMessage(overflowRequest));
        overflowRequest.emit("data", Buffer.alloc(MAX_REQUEST_BODY_BYTES));
        overflowRequest.emit("data", Buffer.alloc(1));
        const overflowExit = yield* Effect.tryPromise({
          try: () => overflowPromise,
          catch: (cause) => new GeneratedBridgeRejection({ cause }),
        }).pipe(Effect.exit);

        assert.isTrue(Exit.isFailure(overflowExit));
        if (Exit.isFailure(overflowExit)) {
          const rejection = Cause.squash(overflowExit.cause);
          assert.instanceOf(rejection, GeneratedBridgeRejection);
          if (rejection instanceof GeneratedBridgeRejection) {
            assert.isTrue(isGeneratedApiRequestError(rejection.cause));
            if (isGeneratedApiRequestError(rejection.cause)) {
              assert.strictEqual(rejection.cause.reason, "BodyTooLarge");
            }
          }
        }
        assert.strictEqual(resumeCount, 1);
        for (const event of ["data", "end", "error", "aborted", "close"]) {
          assert.strictEqual(overflowRequest.listenerCount(event), 0);
        }

        const abortedRequest = new EventEmitter();
        Object.assign(abortedRequest, {
          complete: false,
          headers: { host: "localhost" },
          method: "POST",
          pause: () => abortedRequest,
          resume: () => abortedRequest,
          url: "/api/upload",
        });
        const controller = new AbortController();
        const abortedPromise = mod.getBody(
          decodeIncomingMessage(abortedRequest),
          controller.signal,
        );
        controller.abort();
        const abortedExit = yield* Effect.tryPromise({
          try: () => abortedPromise,
          catch: (cause) => new GeneratedBridgeRejection({ cause }),
        }).pipe(Effect.exit);

        assert.isTrue(Exit.isFailure(abortedExit));
        if (Exit.isFailure(abortedExit)) {
          const rejection = Cause.squash(abortedExit.cause);
          assert.instanceOf(rejection, GeneratedBridgeRejection);
          if (rejection instanceof GeneratedBridgeRejection) {
            assert.isTrue(isGeneratedApiRequestError(rejection.cause));
            if (isGeneratedApiRequestError(rejection.cause)) {
              assert.strictEqual(rejection.cause.reason, "Aborted");
            }
          }
        }
        for (const event of ["data", "end", "error", "aborted", "close"]) {
          assert.strictEqual(abortedRequest.listenerCount(event), 0);
        }

        const responseEmitter = new EventEmitter();
        const responseHeaders = new Map<string, unknown>();
        Object.assign(responseEmitter, {
          statusCode: 200,
          writableEnded: false,
          end: () => {
            Reflect.set(responseEmitter, "writableEnded", true);
            return responseEmitter;
          },
          setHeader: (name: string, value: unknown) => {
            responseHeaders.set(name.toLowerCase(), value);
            return responseEmitter;
          },
          write: (_chunk: Uint8Array, callback: (error?: Error | null) => void) => {
            callback();
            return true;
          },
        });
        const cookieLines = [
          "session=one; Path=/; HttpOnly",
          "refresh=two; Expires=Wed, 21 Oct 2026 07:28:00 GMT; Path=/api",
        ];
        yield* Effect.promise(() =>
          mod.toNodeResponse(
            decodeResponse({
              body: null,
              headers: {
                forEach: () => undefined,
                getSetCookie: () => cookieLines,
              },
              status: 204,
            }),
            decodeServerResponse(responseEmitter),
          ),
        );
        assert.deepStrictEqual(responseHeaders.get("set-cookie"), cookieLines);

        let cancelCount = 0;
        const stream = new ReadableStream<Uint8Array>({
          cancel() {
            cancelCount += 1;
          },
        });
        const streamResponse = new EventEmitter();
        Object.assign(streamResponse, {
          statusCode: 200,
          writableEnded: false,
          end: () => streamResponse,
          setHeader: () => streamResponse,
          write: (_chunk: Uint8Array, callback: (error?: Error | null) => void) => {
            callback();
            return true;
          },
        });
        const writing = mod.toNodeResponse(
          decodeResponse({
            body: stream,
            headers: { forEach: () => undefined, getSetCookie: () => [] },
            status: 200,
          }),
          decodeServerResponse(streamResponse),
        );
        while (streamResponse.listenerCount("close") === 0) {
          yield* Effect.yieldNow;
        }
        streamResponse.emit("close");
        const writeExit = yield* Effect.tryPromise({
          try: () => writing,
          catch: (cause) => new GeneratedBridgeRejection({ cause }),
        }).pipe(Effect.exit);

        assert.isTrue(Exit.isFailure(writeExit));
        assert.strictEqual(cancelCount, 1);
        assert.strictEqual(streamResponse.listenerCount("close"), 0);
        const reader = stream.getReader();
        reader.releaseLock();
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
        const configResolved = yield* decodeConfigResolvedHook(plugin.configResolved);
        const resolveId = yield* decodeResolveIdHook(plugin.resolveId);
        const load = yield* decodeLoadHook(plugin.load);

        yield* Effect.promise(() => configResolved({ root, command: "serve" }));
        const resolved = resolveId("trygg/api");
        assert.strictEqual(resolved, "\0trygg/api");

        yield* assertPromiseRejectsWith(
          () => load(resolved ?? "trygg/api"),
          "app/api.ts must export Api",
        );
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
        const configResolved = yield* decodeConfigResolvedHook(plugin.configResolved);
        const resolveId = yield* decodeResolveIdHook(plugin.resolveId);
        const load = yield* decodeLoadHook(plugin.load);

        yield* Effect.promise(() => configResolved({ root, command: "serve" }));
        const resolved = resolveId("trygg/api");
        assert.strictEqual(resolved, "\0trygg/api");

        yield* assertPromiseRejectsWith(
          () => load(resolved ?? "trygg/api"),
          "app/api.ts must export Api",
        );
      }).pipe(Effect.provide(NodeFileSystemLayer)),
    );

    scoped("should importing trygg/api fail clearly for default-only legacy app api module", () =>
      Effect.gen(function* () {
        // Test: should importing trygg/api fail clearly for default-only legacy app api module
        // Scope: covers the legacy default-export API app boundary where explicit trygg/api import must fail.
        // Assertion: the user-visible error explains the required export.
        const root = yield* makeTempDir({
          "app/layout.tsx": "export default function Layout() { return <html><body /></html> }",
          "app/routes.ts": "export const routes = { manifest: [] }",
          "app/api.ts": "export default {}",
        });
        const plugin = trygg();
        const configResolved = yield* decodeConfigResolvedHook(plugin.configResolved);
        const resolveId = yield* decodeResolveIdHook(plugin.resolveId);
        const load = yield* decodeLoadHook(plugin.load);

        yield* Effect.promise(() => configResolved({ root, command: "serve" }));
        const resolved = resolveId("trygg/api");
        assert.strictEqual(resolved, "\0trygg/api");

        yield* assertPromiseRejectsWith(
          () => load(resolved ?? "trygg/api"),
          "app/api.ts must export Api",
        );
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
        const configResolved = yield* decodeConfigResolvedHook(plugin.configResolved);

        yield* Effect.promise(() => configResolved({ root, command: "serve" }));
      }).pipe(Effect.provide(NodeFileSystemLayer)),
    );

    scoped("should buildStart generate API client declarations when api exists", () =>
      Effect.gen(function* () {
        // Test: should buildStart generate API client declarations when api exists
        // Scope: verifies generated module declarations are written from the app API contract.
        // Assertion: .trygg/api.d.ts augments trygg/api and imports the app Api type.
        const fs = yield* FileSystem.FileSystem;
        const root = yield* makeTempDir({
          "app/layout.tsx": "export default function Layout() { return <html><body /></html> }",
          "app/routes.ts": "export const routes = { manifest: [] }",
          "app/api.ts": "export const Api = {}",
        });
        const plugin = trygg();
        const configResolved = yield* decodeConfigResolvedHook(plugin.configResolved);
        const buildStart = yield* decodeBuildStartHook(plugin.buildStart);

        yield* fs.makeDirectory(path.join(root, ".trygg"), { recursive: true });
        yield* fs.writeFileString(
          path.join(root, ".trygg", "api-types.ts"),
          "// stale legacy file",
        );

        yield* Effect.promise(() => configResolved({ root, command: "build" }));
        yield* Effect.promise(() => buildStart());

        const apiTypes = yield* fs.readFileString(path.join(root, ".trygg", "api.d.ts"));
        const legacyApiTypesExists = yield* fs.exists(path.join(root, ".trygg", "api-types.ts"));

        assert.include(apiTypes, 'declare module "trygg/api"');
        assert.include(apiTypes, 'import type { Api } from "../app/api"');
        assert.include(apiTypes, 'import type { Layer } from "effect/Layer"');
        assert.include(apiTypes, "type ApiClientService = HttpApiClient.ForApi<typeof Api>");
        assert.include(apiTypes, "export const ApiClient: Context.ServiceClass");
        assert.include(apiTypes, "export const ApiClientLive: Layer.Layer<ApiClient>");
        assert.include(apiTypes, "export { Api }");
        assert.isFalse(legacyApiTypesExists);
      }).pipe(Effect.provide(NodeFileSystemLayer)),
    );

    scoped("should buildStart skip API client declarations when api file is absent", () =>
      Effect.gen(function* () {
        // Test: should buildStart skip API client declarations when api file is absent
        // Scope: covers the no-API app boundary where generated client typings must not be emitted.
        // Assertion: buildStart succeeds and .trygg/api.d.ts is not created.
        const fs = yield* FileSystem.FileSystem;
        const root = yield* makeTempDir({
          "app/layout.tsx": "export default function Layout() { return <html><body /></html> }",
          "app/routes.ts": "export const routes = { manifest: [] }",
        });
        const plugin = trygg();
        const configResolved = yield* decodeConfigResolvedHook(plugin.configResolved);
        const buildStart = yield* decodeBuildStartHook(plugin.buildStart);

        yield* Effect.promise(() => configResolved({ root, command: "build" }));
        yield* Effect.promise(() => buildStart());

        const apiTypesExists = yield* fs.exists(path.join(root, ".trygg", "api.d.ts"));
        assert.isFalse(apiTypesExists);
      }).pipe(Effect.provide(NodeFileSystemLayer)),
    );

    scoped(
      "should buildStart skip API client declarations when app api module is default-only",
      () =>
        Effect.gen(function* () {
          // Test: should buildStart skip API client declarations when app api module is default-only
          // Scope: covers the legacy default-export API app boundary where generated client typings must not be emitted.
          // Assertion: buildStart succeeds and .trygg/api.d.ts is not created.
          const fs = yield* FileSystem.FileSystem;
          const root = yield* makeTempDir({
            "app/layout.tsx": "export default function Layout() { return <html><body /></html> }",
            "app/routes.ts": "export const routes = { manifest: [] }",
            "app/api.ts": "export default {}",
          });
          const plugin = trygg();
          const configResolved = yield* decodeConfigResolvedHook(plugin.configResolved);
          const buildStart = yield* decodeBuildStartHook(plugin.buildStart);

          yield* Effect.promise(() => configResolved({ root, command: "build" }));
          yield* Effect.promise(() => buildStart());

          const apiTypesExists = yield* fs.exists(path.join(root, ".trygg", "api.d.ts"));
          assert.isFalse(apiTypesExists);
        }).pipe(Effect.provide(NodeFileSystemLayer)),
    );

    scoped(
      "should buildStart remove stale API client declarations when app api module becomes default-only",
      () =>
        Effect.gen(function* () {
          // Test: should buildStart remove stale API client declarations when app api module becomes default-only
          // Scope: covers stale generated file cleanup when a legacy default-export API app is present.
          // Assertion: buildStart succeeds and any pre-existing .trygg/api.d.ts is removed.
          const fs = yield* FileSystem.FileSystem;
          const root = yield* makeTempDir({
            "app/layout.tsx": "export default function Layout() { return <html><body /></html> }",
            "app/routes.ts": "export const routes = { manifest: [] }",
            "app/api.ts": "export default {}",
          });
          // Pre-create a stale api.d.ts
          yield* fs.makeDirectory(path.join(root, ".trygg"), { recursive: true });
          yield* fs.writeFileString(
            path.join(root, ".trygg", "api.d.ts"),
            "// stale generated file",
          );
          const plugin = trygg();
          const configResolved = yield* decodeConfigResolvedHook(plugin.configResolved);
          const buildStart = yield* decodeBuildStartHook(plugin.buildStart);

          yield* Effect.promise(() => configResolved({ root, command: "build" }));
          yield* Effect.promise(() => buildStart());

          const apiTypesExists = yield* fs.exists(path.join(root, ".trygg", "api.d.ts"));
          assert.isFalse(apiTypesExists);
        }).pipe(Effect.provide(NodeFileSystemLayer)),
    );

    scoped("should resolve and load trygg/api virtual module", () =>
      Effect.gen(function* () {
        // Test: should resolve and load trygg/api virtual module
        // Scope: validates the API client virtual module contract at the plugin boundary.
        // Assertion: resolveId returns framework virtual id and load returns generated module code importing the absolute app API path.
        const root = yield* makeTempDir({
          "app/layout.tsx": "export default function Layout() { return <html><body /></html> }",
          "app/routes.ts": "export const routes = { manifest: [] }",
          "app/api.ts": "export const Api = {}",
        });
        const plugin = trygg({ platform: "node", output: "server" });
        const configResolved = yield* decodeConfigResolvedHook(plugin.configResolved);
        const resolveId = yield* decodeResolveIdHook(plugin.resolveId);
        const load = yield* decodeLoadHook(plugin.load);

        yield* Effect.promise(() => configResolved({ root, command: "serve" }));
        const resolvedId = resolveId("trygg/api");
        if (resolvedId === null) {
          return assert.fail("Expected trygg/api virtual module to resolve");
        }

        const code = yield* Effect.promise(() => load(resolvedId));
        if (code === null) {
          return assert.fail("Expected trygg/api virtual module to load");
        }

        assert.include(
          code,
          `import { Api } from "${path.join(root, "app", "api.ts").replace(/\\/g, "/")}"`,
        );
        assert.include(code, "export class ApiClient");
        assert.include(code, "export const ApiClientLive");
      }).pipe(Effect.provide(NodeFileSystemLayer)),
    );

    scoped("should importing trygg/api ignore Api export text in app api string literals", () =>
      Effect.gen(function* () {
        // Test: should importing trygg/api ignore Api export text in app api string literals
        // Scope: covers invalid API validation before generated code imports named exports.
        // Assertion: string contents do not bypass the actionable missing-export diagnostic.
        const root = yield* makeTempDir({
          "app/layout.tsx": "export default function Layout() { return <html><body /></html> }",
          "app/routes.ts": "export const routes = { manifest: [] }",
          "app/api.ts": 'const message = "export const Api"\nexport default {}',
        });
        const plugin = trygg();
        const configResolved = yield* decodeConfigResolvedHook(plugin.configResolved);
        const resolveId = yield* decodeResolveIdHook(plugin.resolveId);
        const load = yield* decodeLoadHook(plugin.load);

        yield* Effect.promise(() => configResolved({ root, command: "serve" }));
        const resolved = resolveId("trygg/api");
        assert.strictEqual(resolved, "\0trygg/api");

        yield* assertPromiseRejectsWith(
          () => load(resolved ?? "trygg/api"),
          "app/api.ts must export Api",
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
import { Schema } from "effect"
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
        assert.include(routeTypes, 'readonly "/users/:id": { readonly id: number; }');
        assert.include(routeTypes, 'readonly "/users/:id": { readonly id: string; }');
      }).pipe(Effect.provide(PluginFilesTestLayer)),
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
      }).pipe(Effect.provide(PluginFilesTestLayer)),
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
      }).pipe(Effect.provide(PluginFilesTestLayer)),
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
      }).pipe(Effect.provide(PluginFilesTestLayer)),
    );

    it.effect("should recover only NotFound from filesystem existence checks", () =>
      Effect.gen(function* () {
        // Test: should recover only NotFound from filesystem existence checks
        // Scope: covers exists failures before route/API path decisions are made.
        // Assertion: NotFound means absent; PermissionDenied and TimedOut remain typed failures.
        const paths = { appDir: "/workspace/app", generatedDir: "/workspace/.trygg" };
        const run = (tag: SystemErrorTag) =>
          Effect.gen(function* () {
            const files = yield* PluginFiles;
            return yield* files.routesFilePath(paths);
          }).pipe(
            Effect.provide(
              makeControlledPluginFilesLayer({
                exists: (filePath) => Effect.fail(makeFileSystemFailure(tag, "exists", filePath)),
              }),
            ),
            Effect.exit,
          );

        const notFound = yield* run("NotFound");
        const permission = yield* run("PermissionDenied");
        const transient = yield* run("TimedOut");

        assert.isTrue(Exit.isSuccess(notFound));
        if (Exit.isSuccess(notFound)) assert.isUndefined(notFound.value);
        for (const exit of [permission, transient]) {
          assert.isTrue(Exit.isFailure(exit));
          if (Exit.isFailure(exit)) {
            const error = Cause.squash(exit.cause);
            assert.instanceOf(error, PluginFileSystemError);
            if (error instanceof PluginFileSystemError) {
              assert.strictEqual(error.operation, "exists");
            }
          }
        }
      }),
    );

    it.effect("should recover only NotFound from filesystem stat checks", () =>
      Effect.gen(function* () {
        // Test: should recover only NotFound from filesystem stat checks
        // Scope: covers the file-kind check after app/api.ts existence succeeds.
        // Assertion: a stat race may mean absent, while permission/transient failures propagate.
        const paths = { appDir: "/workspace/app", generatedDir: "/workspace/.trygg" };
        const run = (tag: SystemErrorTag) =>
          Effect.gen(function* () {
            const files = yield* PluginFiles;
            return yield* files.appApiExists(paths);
          }).pipe(
            Effect.provide(
              makeControlledPluginFilesLayer({
                exists: () => Effect.succeed(true),
                stat: (filePath) => Effect.fail(makeFileSystemFailure(tag, "stat", filePath)),
              }),
            ),
            Effect.exit,
          );

        const notFound = yield* run("NotFound");
        const permission = yield* run("PermissionDenied");
        const transient = yield* run("TimedOut");

        assert.isTrue(Exit.isSuccess(notFound));
        if (Exit.isSuccess(notFound)) assert.isFalse(notFound.value);
        for (const exit of [permission, transient]) {
          assert.isTrue(Exit.isFailure(exit));
          if (Exit.isFailure(exit)) {
            const error = Cause.squash(exit.cause);
            assert.instanceOf(error, PluginFileSystemError);
            if (error instanceof PluginFileSystemError) {
              assert.strictEqual(error.operation, "stat");
            }
          }
        }
      }),
    );

    it.effect("should recover only NotFound from route source reads", () =>
      Effect.gen(function* () {
        // Test: should recover only NotFound from route source reads
        // Scope: covers the race between finding app/routes.ts and reading its contents.
        // Assertion: disappearance is benign; permission/transient failures remain read errors.
        const paths = { appDir: "/workspace/app", generatedDir: "/workspace/.trygg" };
        const run = (tag: SystemErrorTag) =>
          Effect.gen(function* () {
            const files = yield* PluginFiles;
            yield* files.writeGeneratedRouteTypes(paths);
          }).pipe(
            Effect.provide(
              makeControlledPluginFilesLayer({
                exists: () => Effect.succeed(true),
                readFileString: (filePath) =>
                  Effect.fail(makeFileSystemFailure(tag, "readFileString", filePath)),
              }),
            ),
            Effect.exit,
          );

        const notFound = yield* run("NotFound");
        const permission = yield* run("PermissionDenied");
        const transient = yield* run("TimedOut");

        assert.isTrue(Exit.isSuccess(notFound));
        for (const exit of [permission, transient]) {
          assert.isTrue(Exit.isFailure(exit));
          if (Exit.isFailure(exit)) {
            const error = Cause.squash(exit.cause);
            assert.instanceOf(error, PluginFileSystemError);
            if (error instanceof PluginFileSystemError) {
              assert.strictEqual(error.operation, "read");
            }
          }
        }
      }),
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
      const owner = ClientEntryModuleOwner.make({
        appDir: "/workspace/app",
        generatedDir: "/workspace/.trygg",
        routesFilePath: "/workspace/app/routes.ts",
      });

      assert.strictEqual(
        renderClientEntryModule(owner),
        `// Auto-generated by trygg - DO NOT EDIT
import { mountDocument, Component, Debug } from "trygg"
import { routes } from "../app/routes"
import Layout from "../app/layout"
// Pretty-print the trace flight recorder to the console.
// Tune per-subtree from app/layout.tsx with Component.provide(Debug.layer({ ... })).
const App = Component.gen(function* () {
  return <Layout />
}).pipe(Component.provide(Debug.layer({
  minLevel: import.meta.env.DEV ? "Debug" : "Info",
})))

mountDocument(<App />, { manifest: routes.manifest })
`,
      );
    });

    it("should render favicon link in generated html shell", () => {
      // Test: should render favicon link in generated html shell
      // Scope: covers browser favicon discovery before document head hydration.
      // Assertion: generated HTML links the SVG favicon to avoid browser fallback 404s.
      const html = generateHtmlTemplate();

      assert.include(html, '<link rel="icon" href="/favicon.svg" type="image/svg+xml" />');
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
      assert.include(output, "const makeServerLive = (ProductionMiddleware, PORT, HOST)");
      assert.include(output, "return HttpRouter.serve(withHttpTelemetry(ApiLive), {");
      assert.include(
        output,
        "Layer.provide(NodeHttpServer.layer(() => createServer(), { port: PORT, host: HOST }))",
      );
      assert.include(output, "NodeRuntime.runMain(");
      assert.include(output, "class ServerStartupError");
      assert.isBelow(
        output.indexOf("yield* Layer.build(ServerLive)"),
        output.indexOf("Server listening on http://"),
      );
    });

    it.effect("should render Cloudflare worker root fallback through ASSETS", () =>
      Effect.gen(function* () {
        // Test: should render Cloudflare worker root fallback through ASSETS
        // Scope: covers generated Worker request behavior without Cloudflare runtime internals.
        // Assertion: / asks ASSETS and returns the served shell directly.
        const worker = yield* loadPlannedCloudflareWorker;
        yield* Effect.promise(async () => {
          const requestedPaths: Array<string> = [];
          const env = {
            ASSETS: {
              fetch: (request: Request) => {
                const url = new URL(request.url);
                requestedPaths.push(url.pathname);
                if (url.pathname === "/") {
                  return Promise.resolve(new Response("<html>shell</html>", { status: 200 }));
                }
                return Promise.resolve(new Response("missing", { status: 404 }));
              },
            },
          };

          const response = await worker.default.fetch(
            new Request("https://example.com/", { headers: { Accept: "text/html" } }),
            env,
          );

          assert.strictEqual(response.status, 200);
          assert.strictEqual(await response.text(), "<html>shell</html>");
          assert.deepStrictEqual(requestedPaths, ["/"]);
        });
      }),
    );

    it.effect("should render Cloudflare worker deep route fallback through ASSETS", () =>
      Effect.gen(function* () {
        // Test: should render Cloudflare worker deep route fallback through ASSETS
        // Scope: covers client route refresh behavior after an asset miss.
        // Assertion: document-like deep routes fall back to the public SPA shell.
        const worker = yield* loadPlannedCloudflareWorker;
        yield* Effect.promise(async () => {
          const requestedPaths: Array<string> = [];
          const env = {
            ASSETS: {
              fetch: (request: Request) => {
                const url = new URL(request.url);
                requestedPaths.push(url.pathname);
                if (url.pathname === "/") {
                  return Promise.resolve(new Response("<html>shell</html>", { status: 200 }));
                }
                return Promise.resolve(new Response("missing", { status: 404 }));
              },
            },
          };

          const response = await worker.default.fetch(
            new Request("https://example.com/changelog/example", {
              headers: { Accept: "text/html", "Sec-Fetch-Dest": "document" },
            }),
            env,
          );

          assert.strictEqual(response.status, 200);
          assert.strictEqual(await response.text(), "<html>shell</html>");
          assert.deepStrictEqual(requestedPaths, ["/changelog/example", "/"]);
        });
      }),
    );

    it.effect("should render Cloudflare worker preserving successful ASSETS responses", () =>
      Effect.gen(function* () {
        // Test: should render Cloudflare worker preserving successful ASSETS responses
        // Scope: covers the assets-first contract.
        // Assertion: successful ASSETS responses return unchanged and skip shell fallback.
        const worker = yield* loadPlannedCloudflareWorker;
        yield* Effect.promise(async () => {
          const requestedPaths: Array<string> = [];
          const assetResponse = new Response("asset", {
            status: 201,
            headers: { "X-Asset": "yes" },
          });
          const env = {
            ASSETS: {
              fetch: (request: Request) => {
                requestedPaths.push(new URL(request.url).pathname);
                return Promise.resolve(assetResponse);
              },
            },
          };

          const response = await worker.default.fetch(
            new Request("https://example.com/assets/app.js", { headers: { Accept: "text/html" } }),
            env,
          );

          assert.strictEqual(response, assetResponse);
          assert.strictEqual(response.status, 201);
          assert.strictEqual(response.headers.get("X-Asset"), "yes");
          assert.deepStrictEqual(requestedPaths, ["/assets/app.js"]);
        });
      }),
    );

    it.effect("should render Cloudflare worker preserving asset 404s", () =>
      Effect.gen(function* () {
        // Test: should render Cloudflare worker preserving asset 404s
        // Scope: covers generated asset-like miss behavior.
        // Assertion: missing generated assets are not hidden behind the SPA shell.
        const worker = yield* loadPlannedCloudflareWorker;
        yield* Effect.promise(async () => {
          const requestedPaths: Array<string> = [];
          const env = {
            ASSETS: {
              fetch: (request: Request) => {
                requestedPaths.push(new URL(request.url).pathname);
                return Promise.resolve(new Response("missing", { status: 404 }));
              },
            },
          };

          const response = await worker.default.fetch(
            new Request("https://example.com/assets/app.js", { headers: { Accept: "text/html" } }),
            env,
          );

          assert.strictEqual(response.status, 404);
          assert.deepStrictEqual(requestedPaths, ["/assets/app.js"]);
        });
      }),
    );

    it.effect("should render Cloudflare worker preserving non-document and non-GET 404s", () =>
      Effect.gen(function* () {
        // Test: should render Cloudflare worker preserving non-document and non-GET 404s
        // Scope: covers request semantic gating for SPA fallback.
        // Assertion: script destinations and POST requests do not receive the SPA shell.
        const worker = yield* loadPlannedCloudflareWorker;
        yield* Effect.promise(async () => {
          const requestedPaths: Array<string> = [];
          const env = {
            ASSETS: {
              fetch: (request: Request) => {
                requestedPaths.push(new URL(request.url).pathname);
                return Promise.resolve(new Response("missing", { status: 404 }));
              },
            },
          };

          const scriptResponse = await worker.default.fetch(
            new Request("https://example.com/changelog/example", {
              headers: { Accept: "application/javascript" },
            }),
            env,
          );
          const postResponse = await worker.default.fetch(
            new Request("https://example.com/changelog/example", {
              method: "POST",
              headers: { Accept: "text/html", "Sec-Fetch-Dest": "document" },
            }),
            env,
          );

          assert.strictEqual(scriptResponse.status, 404);
          assert.strictEqual(postResponse.status, 404);
          assert.deepStrictEqual(requestedPaths, ["/changelog/example", "/changelog/example"]);
        });
      }),
    );

    it.effect("should render Cloudflare worker allowing /assets as an app route", () =>
      Effect.gen(function* () {
        // Test: should render Cloudflare worker allowing /assets as an app route
        // Scope: prevents generated asset routing from reserving user route space.
        // Assertion: extensionless /assets document requests fall back to the SPA shell.
        const worker = yield* loadPlannedCloudflareWorker;
        yield* Effect.promise(async () => {
          const requestedPaths: Array<string> = [];
          const env = {
            ASSETS: {
              fetch: (request: Request) => {
                const url = new URL(request.url);
                requestedPaths.push(url.pathname);
                if (url.pathname === "/") {
                  return Promise.resolve(new Response("<html>shell</html>", { status: 200 }));
                }
                return Promise.resolve(new Response("missing", { status: 404 }));
              },
            },
          };

          const response = await worker.default.fetch(
            new Request("https://example.com/assets", {
              headers: { Accept: "text/html", "Sec-Fetch-Dest": "document" },
            }),
            env,
          );

          assert.strictEqual(response.status, 200);
          assert.strictEqual(await response.text(), "<html>shell</html>");
          assert.deepStrictEqual(requestedPaths, ["/assets", "/"]);
        });
      }),
    );

    it.effect("should render Cloudflare worker SPA fallback that never requests /index.html", () =>
      Effect.gen(function* () {
        // Regression: with CF assets html_handling="auto-trailing-slash", a request
        // for /index.html receives a 307 to /, which the worker would propagate as
        // a top-level redirect and break every non-root document path. The fallback
        // must target /, which CF resolves to the index shell without redirecting.
        const worker = yield* loadPlannedCloudflareWorker;
        yield* Effect.promise(async () => {
          const requestedPaths: Array<string> = [];
          const env = {
            ASSETS: {
              fetch: (request: Request) => {
                const url = new URL(request.url);
                requestedPaths.push(url.pathname);
                if (url.pathname === "/index.html") {
                  return Promise.resolve(
                    new Response(null, { status: 307, headers: { Location: "/" } }),
                  );
                }
                if (url.pathname === "/") {
                  return Promise.resolve(new Response("<html>shell</html>", { status: 200 }));
                }
                return Promise.resolve(new Response("missing", { status: 404 }));
              },
            },
          };

          const response = await worker.default.fetch(
            new Request("https://example.com/docs", {
              headers: { Accept: "text/html", "Sec-Fetch-Dest": "document" },
            }),
            env,
          );

          assert.strictEqual(response.status, 200);
          assert.strictEqual(await response.text(), "<html>shell</html>");
          assert.notInclude(requestedPaths, "/index.html");
        });
      }),
    );
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // Scope: config hook
  // ─────────────────────────────────────────────────────────────────────────────
  describe("config hook", () => {
    it("should set esbuild jsx to automatic mode", () => {
      const plugin = trygg();
      const configHook = decodeConfigHook(plugin.config);
      const result = configHook({}, { command: "serve", mode: "development" });
      const config = decodeEsbuildConfig(result);
      assert.strictEqual(config.esbuild.jsx, "automatic");
      assert.strictEqual(config.esbuild.jsxImportSource, "trygg");
    });

    it("should configure optimizeDeps for trygg", () => {
      const plugin = trygg();
      const configHook = decodeConfigHook(plugin.config);
      const result = configHook({}, { command: "serve", mode: "development" });
      const config = decodeOptimizeDepsConfig(result);
      assert.strictEqual(config.optimizeDeps.esbuildOptions.jsx, "automatic");
      assert.strictEqual(config.optimizeDeps.esbuildOptions.jsxImportSource, "trygg");
    });

    it("should filter trygg-owned mixed dynamic import warnings", () => {
      const warning = {
        message:
          "(!) /repo/packages/core/dist/component.js is dynamically imported by /repo/packages/core/dist/observer.js but also statically imported by /repo/packages/core/dist/index.js, dynamic import will not move module into another chunk.",
      };

      assert.strictEqual(isTryggMixedDynamicImportWarning(warning), true);
      assert.strictEqual(
        isTryggMixedDynamicImportWarning({
          message:
            "(!) /repo/app/page.js is dynamically imported by /repo/app/routes.js but also statically imported by /repo/app/index.js, dynamic import will not move module into another chunk.",
        }),
        false,
      );
    });

    it("should preserve user onwarn for non-trygg warnings", () => {
      const plugin = trygg();
      const configHook = decodeConfigHook(plugin.config);
      let userWarnings = 0;
      let defaultWarnings = 0;
      const result = configHook(
        {
          build: {
            rollupOptions: {
              onwarn: (_warning: { readonly message?: string }, defaultHandler: () => void) => {
                userWarnings += 1;
                defaultHandler();
              },
            },
          },
        },
        { command: "build", mode: "production" },
      );
      const config = decodeBuildOnwarnConfig(result);

      config.build.rollupOptions.onwarn({ message: "user warning" }, () => {
        defaultWarnings += 1;
      });

      assert.strictEqual(userWarnings, 1);
      assert.strictEqual(defaultWarnings, 1);
    });
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // Scope: configEnvironment hook
  // ─────────────────────────────────────────────────────────────────────────────
  describe("configEnvironment hook", () => {
    it("should set rollupOptions.input for client builds", () => {
      const plugin = trygg();
      const hook = decodeConfigEnvironmentHook(plugin.configEnvironment);
      const result = hook("client", {}, { command: "build" });
      const config = decodeBuildConfig(result);
      assert.deepStrictEqual(config.build?.rollupOptions?.input, { index: ".trygg/index.html" });
    });

    it("should not set rollupOptions.input for client in dev mode", () => {
      const plugin = trygg();
      const hook = decodeConfigEnvironmentHook(plugin.configEnvironment);
      const result = hook("client", {}, { command: "serve" });
      assert.strictEqual(result, undefined);
    });

    it("should not set SSR input for non-Cloudflare static builds", () => {
      const plugin = trygg();
      const hook = decodeConfigEnvironmentHook(plugin.configEnvironment);
      const result = hook("ssr", {}, { command: "build" });
      assert.strictEqual(result, undefined);
    });

    it("should set Cloudflare static SSR input to worker entry", () => {
      const plugin = trygg({ platform: "cloudflare", output: "static" });
      const hook = decodeConfigEnvironmentHook(plugin.configEnvironment);
      const result = hook("ssr", {}, { command: "build" });
      const config = decodeBuildConfig(result);
      assert.strictEqual(config.build?.rollupOptions?.input, ".trygg/worker-entry.js");
    });
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

        assert.isTrue(Exit.isFailure(exit));
        if (Exit.isFailure(exit)) {
          const error = Cause.squash(exit.cause);
          if (!(error instanceof PluginValidationError)) {
            return assert.fail(
              `Expected PluginValidationError but got ${Cause.pretty(exit.cause)}`,
            );
          }

          assert.strictEqual(error.reason, "InvalidStructure");
        }
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

        const legacyConstructors = decodeDevPlatformLegacyConstructor(devPlatform);

        assert.isFunction(devPlatform.makeApi);
        assert.isUndefined(legacyConstructors.createDevApi);
      }).pipe(Effect.provide(NodeDevPlatform.layer)),
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
              makeWebHandler: () =>
                Effect.succeed({
                  handler: () => Promise.resolve(new Response(null, { status: 204 })),
                  dispose: Effect.void,
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
          return assert.fail("Expected HTTP server to listen on a TCP port");
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
      }).pipe(Effect.provide(NodeDevPlatform.layer)),
    );
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // Scope: PluginApi initial lifecycle
  // ─────────────────────────────────────────────────────────────────────────────
  describe("PluginApi", () => {
    const apiLayer = Layer.succeedContext(Context.makeUnsafe<unknown>(new Map()));
    const handlerFactory = {
      makeApiLayer: () => Effect.succeed(apiLayer),
      makeWebHandler: () =>
        Effect.succeed({
          handler: () => Promise.resolve(new Response(null, { status: 204 })),
          dispose: Effect.void,
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
          loadHandlerFactory: Effect.fail(
            new ApiInitError({ message: "handler factory should not load" }),
          ),
          makeApi: () => Effect.fail(new ApiInitError({ message: "api should not load" })),
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
        const stableHandlerFactory = HandlerFactoryLoader.make(
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
        if (!PluginApi.InitialState.$is("Ready")(state)) {
          return assert.fail("Expected ready API state");
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
        const stableHandlerFactory = HandlerFactoryLoader.make(
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
        if (!PluginApi.InitialState.$is("Ready")(state)) {
          return assert.fail("Expected ready API state");
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
        if (!PluginApi.InitialState.$is("Ready")(state)) {
          return assert.fail("Expected ready API state");
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

    scoped("should preserve mixed coalesced reload Causes for every waiter", () =>
      Effect.gen(function* () {
        // Test: should preserve mixed coalesced reload Causes for every waiter
        // Scope: covers overlapping reload callers for fail+die and fail+interrupt owner exits.
        // Assertion: both waiters see every reason, Failed is not published, and a later reload starts fresh.
        const error = new ApiInitError({ message: "mixed reload failure" });
        const causes = [
          Cause.combine(Cause.fail(error), Cause.die("coalesced reload defect")),
          Cause.combine(Cause.fail(error), Cause.interrupt(93)),
        ];

        for (const expectedCause of causes) {
          const started = yield* Deferred.make<void>();
          const release = yield* Deferred.make<void>();
          const seen: Array<PluginApi.InitialState["_tag"]> = [];
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
                    yield* Deferred.succeed(started, undefined).pipe(Effect.asVoid);
                    yield* Deferred.await(release);
                  }
                  return yield* Effect.failCause(expectedCause);
                }),
                dispose: Effect.void,
              }),
            observe: (nextState) => Effect.sync(() => seen.push(nextState._tag)),
          });
          if (!PluginApi.InitialState.$is("Ready")(state)) {
            return assert.fail("Expected ready API state");
          }

          const first = yield* state.handle.reload.pipe(Effect.forkChild);
          yield* Deferred.await(started);
          const second = yield* state.handle.reload.pipe(
            Effect.forkChild({ startImmediately: true }),
          );
          yield* Deferred.succeed(release, undefined).pipe(Effect.asVoid);
          const [firstExit, secondExit] = yield* Effect.all([
            Fiber.await(first),
            Fiber.await(second),
          ]);

          assert.strictEqual(runs, 1);
          for (const exit of [firstExit, secondExit]) {
            assert.isTrue(Exit.isFailure(exit));
            if (Exit.isFailure(exit)) {
              assert.deepStrictEqual(
                exit.cause.reasons.map((reason) => reason._tag),
                expectedCause.reasons.map((reason) => reason._tag),
              );
            }
          }
          assert.notInclude(seen, "Failed");

          const laterExit = yield* state.handle.reload.pipe(Effect.exit);
          assert.strictEqual(runs, 2);
          assert.isTrue(Exit.isFailure(laterExit));
          if (Exit.isFailure(laterExit)) {
            assert.deepStrictEqual(
              laterExit.cause.reasons.map((reason) => reason._tag),
              expectedCause.reasons.map((reason) => reason._tag),
            );
          }
          yield* PluginApi.closeInitial(state);
        }
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
        if (!PluginApi.InitialState.$is("Ready")(state)) {
          return assert.fail("Expected ready API state");
        }
        const api = PluginApi.make(state.handle);
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
          return assert.fail("Expected test HTTP server to listen on a TCP port");
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

    scoped("should recover a combined all-typed initial load Cause as Failed", () =>
      Effect.gen(function* () {
        // Test: should recover a combined all-typed initial load Cause as Failed
        // Scope: covers the initial-load policy when every Cause reason is an expected API failure.
        // Assertion: Failed publishes the first typed error and partial resources close exactly once.
        const first = new ApiInitError({ message: "first initialization failure" });
        const second = new ApiInitError({ message: "second initialization failure" });
        const seen: Array<PluginApi.InitialState["_tag"]> = [];
        let finalized = 0;
        const state = yield* PluginApi.loadInitial({
          apiPath: "/app/api.ts",
          hasApi: Effect.succeed(true),
          loadHandlerFactory: Effect.succeed(handlerFactory),
          makeApi: () =>
            Effect.gen(function* () {
              yield* Effect.addFinalizer(() =>
                Effect.sync(() => {
                  finalized += 1;
                }),
              );
              return yield* Effect.failCause(Cause.combine(Cause.fail(first), Cause.fail(second)));
            }),
          observe: (nextState) => Effect.sync(() => seen.push(nextState._tag)),
        });

        assert.deepStrictEqual(seen, ["Loading", "Failed"]);
        assert.isTrue(PluginApi.InitialState.$is("Failed")(state));
        if (PluginApi.InitialState.$is("Failed")(state)) assert.strictEqual(state.error, first);
        assert.strictEqual(finalized, 1);
      }),
    );

    scoped("should close initial resources and reemit mixed initialization Causes", () =>
      Effect.gen(function* () {
        // Test: should close initial resources and reemit mixed initialization Causes
        // Scope: covers fail+die and fail+interrupt during makeApi after partial acquisition.
        // Assertion: resources close once, no Failed state is published, and every Cause reason survives.
        const error = new ApiInitError({ message: "initialization failed" });
        const causes = [
          Cause.combine(Cause.fail(error), Cause.die("initialization defect")),
          Cause.combine(Cause.fail(error), Cause.interrupt(94)),
        ];

        for (const expectedCause of causes) {
          const seen: Array<PluginApi.InitialState["_tag"]> = [];
          let finalized = 0;
          const exit = yield* PluginApi.loadInitial({
            apiPath: "/app/api.ts",
            hasApi: Effect.succeed(true),
            loadHandlerFactory: Effect.succeed(handlerFactory),
            makeApi: () =>
              Effect.gen(function* () {
                yield* Effect.addFinalizer(() =>
                  Effect.sync(() => {
                    finalized += 1;
                  }),
                );
                return yield* Effect.failCause(expectedCause);
              }),
            observe: (nextState) => Effect.sync(() => seen.push(nextState._tag)),
          }).pipe(Effect.exit);

          assert.isTrue(Exit.isFailure(exit));
          if (Exit.isFailure(exit)) {
            assert.deepStrictEqual(
              exit.cause.reasons.map((reason) => reason._tag),
              expectedCause.reasons.map((reason) => reason._tag),
            );
          }
          assert.deepStrictEqual(seen, ["Loading"]);
          assert.strictEqual(finalized, 1);
        }
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
        if (!PluginApi.InitialState.$is("Ready")(state)) {
          return assert.fail("Expected ready API state");
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
        if (!PluginApi.InitialState.$is("Ready")(state)) {
          return assert.fail("Expected ready API state");
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

    scoped("should interrupt and await a recursive follow-up reload during shutdown", () =>
      Effect.gen(function* () {
        // Test: should interrupt and await a recursive follow-up reload during shutdown
        // Scope: closes the API owner while the coalesced second pass is active.
        // Assertion: the recursive pass is interruptible, cleanup is awaited, and all waiters settle.
        const firstStarted = yield* Deferred.make<void, never>();
        const secondStarted = yield* Deferred.make<void, never>();
        const releaseFirst = yield* Deferred.make<void, never>();
        const cleanupStarted = yield* Deferred.make<void, never>();
        const releaseCleanup = yield* Deferred.make<void, never>();
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
                  return yield* Effect.never.pipe(
                    Effect.ensuring(
                      Deferred.succeed(cleanupStarted, undefined).pipe(
                        Effect.andThen(Deferred.await(releaseCleanup)),
                      ),
                    ),
                  );
                }
              }),
              dispose: Effect.void,
            }),
        });
        if (!PluginApi.InitialState.$is("Ready")(state)) {
          return assert.fail("Expected ready API state");
        }
        const ready = state;

        const first = yield* ready.handle.reload.pipe(Effect.forkChild);
        yield* Deferred.await(firstStarted);
        const followUp = yield* ready.handle.reload.pipe(
          Effect.forkChild({ startImmediately: true }),
        );
        yield* Deferred.succeed(releaseFirst, undefined).pipe(Effect.asVoid);
        yield* Deferred.await(secondStarted);
        const closing = yield* PluginApi.closeInitial(ready).pipe(Effect.forkChild);
        yield* Deferred.await(cleanupStarted);

        assert.isUndefined(closing.pollUnsafe());

        yield* Deferred.succeed(releaseCleanup, undefined).pipe(Effect.asVoid);
        yield* Fiber.join(closing);
        const firstExit = yield* Fiber.await(first);
        const followUpExit = yield* Fiber.await(followUp);

        assert.strictEqual(runs, 2);
        assert.isTrue(Exit.isFailure(firstExit));
        assert.isTrue(Exit.isFailure(followUpExit));
        if (Exit.isFailure(firstExit)) assert.isTrue(Cause.hasInterrupts(firstExit.cause));
        if (Exit.isFailure(followUpExit)) assert.isTrue(Cause.hasInterrupts(followUpExit.cause));
      }),
    );

    scoped("should not orphan a reload claim interrupted immediately before owner execution", () =>
      Effect.gen(function* () {
        // Test: should not orphan a reload claim interrupted immediately before owner execution
        // Scope: uses a controlled scheduler at the Idle-to-Running owner handoff.
        // Assertion: the interrupted claim settles and a later caller starts a fresh reload owner.
        const baselineScheduler = new Scheduler.MixedScheduler();
        let baselineOperations = 0;
        let ownerStartOperation = 0;
        const countingScheduler: Scheduler.Scheduler = {
          executionMode: baselineScheduler.executionMode,
          makeDispatcher: () => baselineScheduler.makeDispatcher(),
          shouldYield: (fiber) => {
            baselineOperations += 1;
            return baselineScheduler.shouldYield(fiber);
          },
        };
        const baselineState = yield* PluginApi.loadInitial({
          apiPath: "/app/api.ts",
          hasApi: Effect.succeed(true),
          loadHandlerFactory: Effect.succeed(handlerFactory),
          makeApi: () =>
            Effect.succeed({
              middleware: (_req, _res, next) => next(),
              reload: Effect.sync(() => {
                ownerStartOperation = baselineOperations;
              }),
              dispose: Effect.void,
            }),
        });
        if (!PluginApi.InitialState.$is("Ready")(baselineState)) {
          return assert.fail("Expected baseline ready API state");
        }
        yield* baselineState.handle.reload.pipe(
          Effect.provideService(Scheduler.Scheduler, countingScheduler),
        );
        yield* PluginApi.closeInitial(baselineState);

        assert.isAbove(ownerStartOperation, 0);

        const controlledScheduler = new Scheduler.MixedScheduler();
        let operations = 0;
        let reloadCalls = 0;
        const interruptingScheduler: Scheduler.Scheduler = {
          executionMode: controlledScheduler.executionMode,
          makeDispatcher: () => controlledScheduler.makeDispatcher(),
          shouldYield: (fiber) => {
            operations += 1;
            if (operations === ownerStartOperation - 1) fiber.interruptUnsafe();
            return controlledScheduler.shouldYield(fiber);
          },
        };
        const state = yield* PluginApi.loadInitial({
          apiPath: "/app/api.ts",
          hasApi: Effect.succeed(true),
          loadHandlerFactory: Effect.succeed(handlerFactory),
          makeApi: () =>
            Effect.succeed({
              middleware: (_req, _res, next) => next(),
              reload: Effect.sync(() => {
                reloadCalls += 1;
              }),
              dispose: Effect.void,
            }),
        });
        if (!PluginApi.InitialState.$is("Ready")(state)) {
          return assert.fail("Expected ready API state");
        }

        const interruptedExit = yield* state.handle.reload.pipe(
          Effect.provideService(Scheduler.Scheduler, interruptingScheduler),
          Effect.exit,
        );
        assert.isTrue(Exit.isFailure(interruptedExit));
        if (Exit.isFailure(interruptedExit)) {
          assert.isTrue(Cause.hasInterruptsOnly(interruptedExit.cause));
        }

        yield* state.handle.reload;
        assert.strictEqual(reloadCalls, 1);
        yield* PluginApi.closeInitial(state);
      }),
    );

    scoped("should settle a reload submitted after its API owner has closed", () =>
      Effect.gen(function* () {
        // Test: should settle a reload submitted after its API owner has closed
        // Scope: submits work after forkIn can only return an already-interrupted owner fiber.
        // Assertion: the call exits interrupted without running the reload body or leaving Running orphaned.
        let reloadCalls = 0;
        const state = yield* PluginApi.loadInitial({
          apiPath: "/app/api.ts",
          hasApi: Effect.succeed(true),
          loadHandlerFactory: Effect.succeed(handlerFactory),
          makeApi: () =>
            Effect.succeed({
              middleware: (_req, _res, next) => next(),
              reload: Effect.sync(() => {
                reloadCalls += 1;
              }),
              dispose: Effect.void,
            }),
        });
        if (!PluginApi.InitialState.$is("Ready")(state)) {
          return assert.fail("Expected ready API state");
        }
        yield* PluginApi.closeInitial(state);

        const firstExit = yield* state.handle.reload.pipe(Effect.exit);
        const secondExit = yield* state.handle.reload.pipe(Effect.exit);

        assert.isTrue(Exit.isFailure(firstExit));
        assert.isTrue(Exit.isFailure(secondExit));
        if (Exit.isFailure(firstExit)) assert.isTrue(Cause.hasInterruptsOnly(firstExit.cause));
        if (Exit.isFailure(secondExit)) assert.isTrue(Cause.hasInterruptsOnly(secondExit.cause));
        assert.strictEqual(reloadCalls, 0);
      }),
    );
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // Scope: JSX requirement transform
  // ─────────────────────────────────────────────────────────────────────────────
  describe("transformTryggJsxForRequirements", () => {
    it("lowers nested JSX to requirement-preserving runtime calls", () => {
      const source = `
import { Component } from "trygg"

const ThemeButton = Component.gen(function* () {
  return <button>Toggle</button>
})

const ThemeExample = Component.gen(function* () {
  return (
    <div>
      <ThemeButton />
      <section className="card">Copy</section>
    </div>
  )
})
`;

      const result = transformTryggJsxForRequirements(source, "theme.tsx");

      assert.isTrue(result.transformed);
      assert.include(result.code, 'from "trygg/jsx-runtime"');
      assert.include(result.code, "__tryggJsx(ThemeButton, null)");
      assert.include(result.code, '__tryggJsxs("div"');
      assert.include(result.code, "children:");
    });

    it("preserves member component tags as expressions", () => {
      const source = `
const App = Component.gen(function* () {
  return <theme.Button />
})
`;
      const result = transformTryggJsxForRequirements(source, "member.tsx");

      assert.include(result.code, "__tryggJsx(theme.Button, null)");
      assert.notInclude(result.code, '"theme.Button"');
    });

    it("does not rewrite non-TSX source", () => {
      const source = `export const value = 1`;
      const result = transformTryggJsxForRequirements(source, "plain.ts");

      assert.isFalse(result.transformed);
      assert.strictEqual(result.code, source);
    });
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
  // Scope: API client generated modules
  // ─────────────────────────────────────────────────────────────────────────────
  describe("API client generated modules", () => {
    it.effect("should render API client runtime module from import path", () =>
      Effect.gen(function* () {
        // Test: should render API client runtime module from import path
        // Scope: covers the virtual module runtime code generation without Vite or filesystem effects.
        // Assertion: output imports Api, creates ApiClient, and provides FetchHttpClient.layer.
        const output = renderApiClientModule({ apiImportPath: "/app/api" });

        assert.include(output, 'import { Api } from "/app/api"');
        assert.include(output, 'import { HttpApiClient } from "effect/unstable/httpapi"');
        assert.include(output, 'import { FetchHttpClient } from "effect/unstable/http"');
        assert.include(output, 'HttpApiClient.make(Api, { baseUrl: "" })');
        assert.include(output, 'export class ApiClient extends Context.Service()("ApiClient") {}');
        assert.notInclude(output, "type ApiClientService");
        assert.notInclude(output, "Context.Service<ApiClient");
        assert.include(output, "export const ApiClientLive");
        assert.include(output, "Effect.provide(FetchHttpClient.layer)");

        const browserScript = output
          .split("\n")
          .filter((line) => !line.startsWith("import ") && !line.startsWith("export {"))
          .join("\n")
          .replaceAll("export class", "class")
          .replaceAll("export const", "const");

        const parseExit = yield* Effect.try({
          try: () => new Function(browserScript),
          catch: (cause) => new BrowserScriptParseError({ cause }),
        }).pipe(Effect.exit);
        if (Exit.isFailure(parseExit)) {
          assert.fail(
            `Expected generated runtime module to parse as browser JavaScript: ${Cause.pretty(parseExit.cause)}`,
          );
        }
      }),
    );

    it("should render API client declarations from type import path", () => {
      // Test: should render API client declarations from type import path
      // Scope: covers the generated .trygg/api.d.ts augmentation without Vite or filesystem effects.
      // Assertion: output augments trygg/api, imports typeof Api, and types ApiClientService correctly.
      const output = renderApiClientDeclarations({ apiTypeImportPath: "../app/api" });

      assert.include(output, 'declare module "trygg/api"');
      assert.include(output, 'import type { Api } from "../app/api"');
      assert.include(output, 'import type { Layer } from "effect/Layer"');
      assert.include(output, "type ApiClientService = HttpApiClient.ForApi<typeof Api>");
      assert.include(output, "export interface ApiClient {}");
      assert.include(
        output,
        'export const ApiClient: Context.ServiceClass<ApiClient, "ApiClient",',
      );
      assert.include(output, "export const ApiClientLive: Layer.Layer<ApiClient>");
      assert.include(output, "export { Api }");
    });
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
