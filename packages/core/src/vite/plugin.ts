/**
 * Vite integration entrypoint for trygg.
 *
 * @remarks
 * Owner module for `trygg/vite-plugin`. The supported consumer surface is the
 * `trygg` plugin factory plus the public option and plugin-shape types used by
 * `vite.config.ts`; the lower-level helpers in this file stay implementation
 * details even when they are exported for local tests.
 *
 * @see ./plugin.docs.md - Source-owned topic guide
 * @since 1.0.0
 * @module trygg/vite-plugin
 */
import type { Connect, ResolvedConfig, ViteDevServer } from "vite";
import { build } from "vite";
import {
  Cause,
  Data,
  Deferred,
  Effect,
  Exit,
  Fiber,
  FileSystem,
  Layer,
  Logger,
  LogLevel,
  ManagedRuntime,
  Match,
  Option,
  Predicate,
  References,
  Schema,
  Scope,
  SynchronizedRef,
} from "effect";
import type { Layer as LayerType } from "effect/Layer";
import * as Context from "effect/Context";
import * as nodePath from "node:path";
import { defineConfig, type TryggConfig, type Platform, type Output } from "../config.js";
import {
  DevPlatform,
  ServerPlatform,
  NodeServerPlatform,
  BunServerPlatform,
  type ServerPlatformService,
  type DevApiHandle,
  type DevApiErrors,
  type HandlerFactory,
  ApiInitError,
  ImportError,
} from "./dev-platform.js";
import * as Trace from "../trace/index.js";
import * as CallbackRuntime from "./callback-runtime.js";
import * as NodeDevPlatform from "./dev-platform-node.js";
import { Bootstrap } from "./bootstrap.js";
import {
  PluginBootstrapError as PluginBootstrapErrorImpl,
  PluginFileSystemError as PluginFileSystemErrorImpl,
  PluginParseError as PluginParseErrorImpl,
} from "./errors.js";
import {
  BuildArtifactPlanner,
  GeneratedArtifactPlanner,
  InvalidBuildOutputCombination,
  BuildArtifactOperation,
  BuildPlanDiagnostic,
  type GeneratedArtifactPlan,
} from "./build-artifact-planner.js";
import { generateRouteTypes } from "./route-codegen.js";
import { transformTryggJsxForRequirements } from "./jsx-requirement-transform.js";
import { unsafeAsUnrecoverableCause } from "../internal/unsafe.js";
// The Bun adapter is loaded dynamically to avoid loading @effect/platform-bun in Node.js.

// =============================================================================
// Constants
// =============================================================================

const APP_DIR = "app";
const GENERATED_DIR = ".trygg";

const VIRTUAL_HANDLER_FACTORY_ID = "virtual:trygg/handler-factory";
const RESOLVED_HANDLER_FACTORY_ID = "\0" + VIRTUAL_HANDLER_FACTORY_ID;
const VIRTUAL_API_ID = "trygg/api";
const RESOLVED_API_ID = "\0" + VIRTUAL_API_ID;
const API_EXPORT_MESSAGE =
  "app/api.ts must export Api for imports from trygg/api. Add `export const Api = ...` to app/api.ts.";
const ROUTE_TRANSFORM_METHODS: ReadonlyArray<"component" | "layout"> = ["component", "layout"];

type RollupWarning = {
  readonly message?: string;
};

type RollupWarningHandler = (
  warning: RollupWarning,
  defaultHandler: (warning: RollupWarning) => void,
) => void;

const isRecord = (value: unknown): value is { readonly [key: string]: unknown } =>
  typeof value === "object" && value !== null;

const isRollupWarningHandler = (value: unknown): value is RollupWarningHandler =>
  typeof value === "function";

const getUserRollupOnwarn = (config: unknown): RollupWarningHandler | undefined => {
  if (!isRecord(config)) return undefined;
  const build = config.build;
  if (!isRecord(build)) return undefined;
  const rollupOptions = build.rollupOptions;
  if (!isRecord(rollupOptions)) return undefined;
  const onwarn = rollupOptions.onwarn;
  if (!isRollupWarningHandler(onwarn)) return undefined;
  return onwarn;
};

/**
 * Detects Rollup mixed dynamic import warnings emitted by trygg's own build output.
 *
 * @remarks
 * Used by plugin warning filtering and exported only so local Vite plugin tests can
 * verify the exact warning predicate without constructing a full plugin instance.
 *
 * @internal
 * @since 1.0.0
 */
export const isTryggMixedDynamicImportWarning = (warning: RollupWarning): boolean => {
  const message = warning.message?.replace(/\\/g, "/");
  if (message === undefined) return false;
  if (!message.includes("is dynamically imported by")) return false;
  if (!message.includes("but also statically imported by")) return false;
  if (!message.includes("dynamic import will not move module into another chunk")) return false;
  return message.includes("/packages/core/dist/") || message.includes("/node_modules/trygg/dist/");
};

const makeRollupOnwarn =
  (userOnwarn: RollupWarningHandler | undefined): RollupWarningHandler =>
  (warning, defaultHandler) => {
    if (isTryggMixedDynamicImportWarning(warning)) return;
    if (userOnwarn !== undefined) {
      userOnwarn(warning, defaultHandler);
      return;
    }
    defaultHandler(warning);
  };

/**
 * Source paths that own generated browser entry imports.
 *
 * @remarks
 * These filesystem paths are parsed once into semantic import paths before
 * rendering the generated module.
 *
 * @internal
 * @since 1.0.0
 */
export interface ClientEntryModuleOwnerInput {
  readonly appDir: string;
  readonly generatedDir: string;
  readonly routesFilePath?: string | undefined;
}

/**
 * Semantic import paths for the generated browser entry module.
 *
 * @remarks
 * Renderer input only; callers should construct it with
 * `ClientEntryModuleOwner.make` so path normalization stays consistent.
 *
 * @internal
 * @since 1.0.0
 */
export interface ClientEntryModuleOwner {
  readonly layoutImportPath: string;
  readonly routesImportPath: string;
}

/**
 * Runtime choices that own generated production server module content.
 *
 * @remarks
 * Couples the API presence decision with platform-specific code fragments so
 * server rendering does not reach back into plugin state.
 *
 * @internal
 * @since 1.0.0
 */
export interface ProductionServerEntryModuleOwner {
  readonly hasApi: boolean;
  readonly platform: ServerPlatformService;
}

// Shared by development factories and standalone production server bundles.
// Project before delegating: exporters may consume attributes immediately.
const renderHttpTelemetry = (): string => `
const projectHttpCause = (cause) => Cause.fromReasons(cause.reasons.map((reason) =>
  reason._tag === "Fail" ? Cause.makeFailReason("HttpRequestFailure") :
  reason._tag === "Die" ? Cause.makeDieReason("HttpRequestDefect") :
  Cause.makeInterruptReason()
));

// Methods live on the prototype; requests allocate only a delegate instance.
class HttpTelemetrySpan {
  constructor(span) { this.span = span; }
  get _tag() { return "Span"; }
  get name() { return this.span.name; }
  get spanId() { return this.span.spanId; }
  get traceId() { return this.span.traceId; }
  get parent() { return this.span.parent; }
  get annotations() { return this.span.annotations; }
  get status() { return this.span.status; }
  get attributes() { return this.span.attributes; }
  get links() { return this.span.links; }
  get sampled() { return this.span.sampled; }
  get kind() { return this.span.kind; }
  attribute(key, value) {
    if (key === "url.full" || key === "url.query" ||
        key === "user_agent.original" || key === "client.address" ||
        key.startsWith("http.request.header.") ||
        key.startsWith("http.response.header.")) return;
    this.span.attribute(key, value);
  }
  end(time, exit) {
    // HTTP success values contain the entire response; failure values may
    // contain request bodies and Causes. Preserve outcome without those values.
    const safeExit = Exit.isSuccess(exit) ? Exit.void : Exit.failCause(projectHttpCause(exit.cause));
    this.span.end(time, safeExit);
  }
  event(name, time, attributes) { this.span.event(name, time, attributes); }
  addLinks(links) { this.span.addLinks(links); }
}

const makeHttpTracer = (tracer) => Tracer.make({
  context: tracer.context?.bind(tracer),
  span(options) {
    const span = tracer.span(options);
    return options.kind === "server" ? new HttpTelemetrySpan(span) : span;
  },
});

const withHttpTelemetry = (layer) => Layer.flatMap(layer, (services) =>
  Layer.effectContext(Effect.map(Tracer.Tracer, (inherited) => {
    const tracer = Context.get(Context.merge(Context.make(Tracer.Tracer, inherited), services), Tracer.Tracer);
    return Context.add(services, Tracer.Tracer, makeHttpTracer(tracer));
  }))
);

const httpLogger = HttpMiddleware.make((app) => {
  // Reuse the middleware graph for each scoped logger configuration. Weak keys
  // do not retain configurations that disappear with a request or API generation.
  const loggedByLoggers = new WeakMap();
  return Effect.withFiber((fiber) => {
    const original = fiber.getRef(Logger.CurrentLoggers);
    let logged = loggedByLoggers.get(original);
    if (logged === undefined) {
      const projected = new Set();
      for (const logger of original) {
        projected.add(Logger.make((options) => logger.log(options.cause.reasons.length === 0
          ? options
          : { ...options, cause: projectHttpCause(options.cause) }
        )));
      }
      // Only the automatic HTTP logger sees the projection. Application code
      // retains the original logger identities and scoped override semantics.
      logged = HttpMiddleware.logger(Effect.provideService(app, Logger.CurrentLoggers, original)).pipe(
        Effect.provideService(Logger.CurrentLoggers, projected)
      );
      loggedByLoggers.set(original, logged);
    }
    return logged;
  });
});
`;

const HandlerFactoryModule = {
  /**
   * Shared handler factory logic for virtual modules.
   * Requires the user module to have a default export that is a composed Layer.
   * No platform-specific imports — only effect http/httpapi modules.
   * @internal
   */
  makeShared: (): string => `
import { HttpBody, HttpEffect, HttpMiddleware, HttpRouter, HttpServer, HttpServerResponse } from "effect/unstable/http";
import { Cause, Context, Data, Effect, Exit, Fiber, Layer, Logger, Scope, Stream, Tracer } from "effect";

${renderHttpTelemetry()}

class FactoryError extends Data.TaggedError("FactoryError") {}

// Trust boundary: TypeScript enforces Layer<HttpApi.Api> in user code.
// At the SSR module boundary types are erased — Layer.isLayer is the
// strongest runtime check possible (Layer type params are phantom).
export const makeApiLayer = (mod) =>
  Effect.gen(function* () {
    if (!("default" in mod) || !Layer.isLayer(mod.default)) {
      return yield* new FactoryError({
        message: "app/api.ts must have a default export that is a composed Layer (e.g. export default HttpApiBuilder.layer(Api).pipe(Layer.provide(handlers)))",
      });
    }

    return mod.default;
  });

export const makeWebHandler = (apiLive) => Effect.gen(function* () {
  const apiLayer = Layer.mergeAll(apiLive, HttpServer.layerServices);
  const services = yield* Layer.build(withHttpTelemetry(Layer.provideMerge(apiLayer, HttpRouter.layer)));
  const router = Context.get(services, HttpRouter.HttpRouter);
  const requests = yield* Scope.fork(yield* Effect.scope);
  const middleware = HttpMiddleware.make((app) => {
    const logged = httpLogger(app);
    return Effect.withFiber((fiber) => {
      if (requests.state._tag === "Closed") return Effect.interrupt;
      // The Web response Promise can settle before request finalizers. Attach
      // the actual HTTP fiber before user code so services outlive its cleanup.
      Fiber.runIn(fiber, requests);
      return logged;
    });
  });
  const ownResponse = (request, response) => Effect.sync(() => {
    if (response.body._tag !== "Stream") return response;
    const body = response.body;
    // HEAD never starts a body stream. Keep its metadata without transferring
    // request cleanup to a stream that the HTTP converter will discard.
    if (request.method === "HEAD") {
      return HttpServerResponse.setBody(response, HttpBody.raw(undefined, {
        contentType: body.contentType,
        contentLength: body.contentLength,
      }));
    }
    // HttpEffect transfers request cleanup to the body stream. Own that
    // fiber too, even when no bridge reader has consumed the Response yet.
    const stream = Stream.onStart(body.stream, Effect.withFiber((streamFiber) => {
      if (requests.state._tag === "Closed") return Effect.interrupt;
      Fiber.runIn(streamFiber, requests);
      return Effect.void;
    }));
    return HttpServerResponse.setBody(response, HttpBody.stream(stream, body.contentType, body.contentLength));
  });
  // Register last so a user's pre-response handler can replace the body before
  // ownership is attached, including on failure and interruption responses.
  const app = router.asHttpEffect().pipe(
    Effect.onExit(() => HttpEffect.appendPreResponseHandler(ownResponse)),
  );
  const handler = HttpEffect.toWebHandlerWith(services)(app, middleware);
  return {
    handler: (request) => requests.state._tag === "Closed"
      ? Promise.resolve(new Response("Service Unavailable", { status: 503 }))
      : handler(request),
    dispose: Scope.close(requests, Exit.void),
  };
});
`,

  /**
   * Node handler factory — extends shared code with Request/Response bridge.
   * @internal
   */
  makeNode: (): string =>
    HandlerFactoryModule.makeShared() +
    `
const MAX_REQUEST_BODY_BYTES = 1024 * 1024;

class ApiRequestError extends Data.TaggedError("ApiRequestError") {}

export const getBody = (req, signal) => {
  const method = req.method ?? "GET";
  if (method === "GET" || method === "HEAD") {
    return Promise.resolve(undefined);
  }

  return new Promise((resolve, reject) => {
    const chunks = [];
    let length = 0;
    let settled = false;
    const cleanup = () => {
      req.off("data", onData);
      req.off("end", onEnd);
      req.off("error", onError);
      req.off("aborted", onAborted);
      req.off("close", onClose);
      signal?.removeEventListener("abort", onAborted);
    };
    const succeed = (value) => {
      if (settled) return;
      settled = true;
      cleanup();
      resolve(value);
    };
    const fail = (error) => {
      if (settled) return;
      settled = true;
      cleanup();
      reject(error);
    };
    const onData = (chunk) => {
      length += chunk.byteLength;
      if (length > MAX_REQUEST_BODY_BYTES) {
        fail(new ApiRequestError({
          reason: "BodyTooLarge",
          message: "Request body exceeds " + MAX_REQUEST_BODY_BYTES + " bytes",
          limit: MAX_REQUEST_BODY_BYTES,
        }));
        req.resume();
        return;
      }
      chunks.push(new Uint8Array(chunk));
    };
    const onEnd = () => {
      const body = new Uint8Array(length);
      let offset = 0;
      for (const chunk of chunks) {
        body.set(chunk, offset);
        offset += chunk.length;
      }
      succeed(body);
    };
    const onError = (cause) => fail(new ApiRequestError({
      reason: "ReadFailed",
      message: "Request body read failed",
      cause,
    }));
    const onAborted = () => fail(new ApiRequestError({
      reason: "Aborted",
      message: "Request was aborted",
    }));
    const onClose = () => {
      if (!req.complete) onAborted();
    };
    req.on("data", onData);
    req.on("end", onEnd);
    req.on("error", onError);
    req.on("aborted", onAborted);
    req.on("close", onClose);
    signal?.addEventListener("abort", onAborted, { once: true });
    if (signal?.aborted) onAborted();
  });
};

export const fromNodeRequest = async (req, signal) => {
  const headers = new Headers();
  for (const [key, value] of Object.entries(req.headers)) {
    if (value === undefined) continue;
    headers.set(key, Array.isArray(value) ? value.join(", ") : value);
  }

  const body = await getBody(req, signal);
  const init = { method: req.method ?? "GET", headers, signal };
  if (body !== undefined) {
    init.body = body;
  }

  return new Request("http://" + (req.headers.host ?? "localhost") + (req.url ?? "/"), init);
};

const abortedRequestError = () => new ApiRequestError({
  reason: "Aborted",
  message: "Request was aborted",
});

const awaitWebHandler = (handler, request, signal) => new Promise((resolve, reject) => {
  let settled = false;
  const cleanup = () => signal.removeEventListener("abort", onAbort);
  const succeed = (response) => {
    if (settled) return;
    settled = true;
    cleanup();
    resolve(response);
  };
  const fail = (cause) => {
    if (settled) return;
    settled = true;
    cleanup();
    reject(cause);
  };
  const onAbort = () => fail(abortedRequestError());
  signal.addEventListener("abort", onAbort, { once: true });
  if (signal.aborted) {
    onAbort();
    return;
  }
  Promise.resolve().then(() => handler(request)).then(succeed, fail);
});

export const toNodeResponse = async (response, res, signal) => {
  if (signal?.aborted) throw abortedRequestError();
  res.statusCode = response.status;
  response.headers.forEach((value, key) => {
    if (key !== "set-cookie") res.setHeader(key, value);
  });
  const cookies = response.headers.getSetCookie();
  if (cookies.length > 0) res.setHeader("set-cookie", cookies);

  if (!response.body) {
    if (signal?.aborted) throw abortedRequestError();
    res.end();
    return;
  }

  const reader = response.body.getReader();
  const readChunk = () => new Promise((resolve, reject) => {
    let settled = false;
    const cleanup = () => {
      res.off("close", onClose);
      signal?.removeEventListener("abort", onAbort);
    };
    const succeed = (chunk) => {
      if (settled) return;
      settled = true;
      cleanup();
      resolve(chunk);
    };
    const fail = (cause) => {
      if (settled) return;
      settled = true;
      cleanup();
      reject(cause);
    };
    const onClose = () => fail(new ApiRequestError({
      reason: "Aborted",
      message: "Response connection closed",
    }));
    const onAbort = () => fail(abortedRequestError());
    res.on("close", onClose);
    signal?.addEventListener("abort", onAbort, { once: true });
    if (signal?.aborted) {
      onAbort();
      return;
    }
    Promise.resolve().then(() => reader.read()).then(
      succeed,
      (cause) => fail(new ApiRequestError({
        reason: "ReadFailed",
        message: "Failed to read response body",
        cause,
      })),
    );
  });
  let completed = false;
  try {
    for (;;) {
      const chunk = await readChunk();
      if (chunk.done) {
        completed = true;
        break;
      }
      await new Promise((resolve, reject) => {
        let settled = false;
        const cleanup = () => {
          res.off("close", onClose);
          signal?.removeEventListener("abort", onAbort);
        };
        const succeed = () => {
          if (settled) return;
          settled = true;
          cleanup();
          resolve();
        };
        const fail = (cause) => {
          if (settled) return;
          settled = true;
          cleanup();
          reject(cause);
        };
        const onClose = () => fail(new ApiRequestError({
          reason: "Aborted",
          message: "Response connection closed",
        }));
        const onAbort = () => fail(abortedRequestError());
        res.on("close", onClose);
        signal?.addEventListener("abort", onAbort, { once: true });
        if (signal?.aborted) {
          onAbort();
          return;
        }
        try {
          res.write(chunk.value, (error) => error
            ? fail(new ApiRequestError({
                reason: "WriteFailed",
                message: "Failed to write response",
                cause: error,
              }))
            : succeed());
        } catch (cause) {
          fail(new ApiRequestError({
            reason: "WriteFailed",
            message: "Failed to write response",
            cause,
          }));
        }
      });
    }
    res.end();
  } finally {
    if (!completed) {
      await reader.cancel().catch(() => undefined);
    }
    reader.releaseLock();
  }
};

export const makeNodeHandler = (apiLive) =>
  Effect.gen(function* () {
    const webHandler = yield* makeWebHandler(apiLive);
    const activeRequests = new Map();
    let disposed = false;

    const dispose = Effect.gen(function* () {
      yield* Effect.promise(async () => {
        if (disposed) return;
        disposed = true;
        for (const controller of activeRequests.keys()) controller.abort();
        await Promise.allSettled(activeRequests.values());
      });
      yield* webHandler.dispose;
    });

    return {
      handler: (req, res) => {
        if (disposed) {
          res.statusCode = 503;
          res.end("Service Unavailable");
          return;
        }
        const controller = new AbortController();
        const abort = () => controller.abort();
        const abortIncompleteRequest = () => {
          if (!req.complete) abort();
        };
        const abortIncompleteResponse = () => {
          if (!res.writableEnded) abort();
        };
        req.on("aborted", abort);
        req.on("close", abortIncompleteRequest);
        res.on("close", abortIncompleteResponse);

        const request = fromNodeRequest(req, controller.signal)
          .then((request) => awaitWebHandler(webHandler.handler, request, controller.signal))
          .then((response) => toNodeResponse(response, res, controller.signal))
          .catch((error) => {
            if (error?._tag === "ApiRequestError" && error.reason === "Aborted") return;
            if (!res.headersSent) {
              res.statusCode = error?._tag === "ApiRequestError" && error.reason === "BodyTooLarge"
                ? 413
                : 500;
              res.end(res.statusCode === 413 ? "Payload Too Large" : "Internal Server Error");
            }
          })
          .finally(() => {
            req.off("aborted", abort);
            req.off("close", abortIncompleteRequest);
            res.off("close", abortIncompleteResponse);
            activeRequests.delete(controller);
          });
        activeRequests.set(controller, request);
      },
      dispose,
    };
  });
`,

  /**
   * Bun handler factory — shared code only (no @effect/platform-node).
   * Uses makeWebHandler for handler creation.
   * @internal
   */
  makeBun: (): string => HandlerFactoryModule.makeShared(),
};

// =============================================================================
// Types
// =============================================================================

// =============================================================================
// Error Types - Yieldable via Schema.TaggedError
// =============================================================================

/**
 * Plugin validation error.
 *
 * @remarks
 * Internal validation helpers raise this when app structure or generated input
 * files do not match what the Vite integration expects.
 *
 * @internal
 * @since 1.0.0
 */
export class PluginValidationError extends Schema.TaggedError<PluginValidationError>()(
  "PluginValidationError",
  {
    reason: Schema.Union([
      Schema.Literal("MissingFile"),
      Schema.Literal("MissingExport"),
      Schema.Literal("RouteConflict"),
      Schema.Literal("InvalidStructure"),
    ]),
    description: Schema.String,
    file: Schema.optional(Schema.String),
    details: Schema.optional(Schema.String),
  },
) {
  static missingFile(file: string, details?: string): PluginValidationError {
    return new PluginValidationError({
      reason: "MissingFile",
      description: `Required file missing: ${file}`,
      file,
      details,
    });
  }

  static missingExport(file: string, exportName: string): PluginValidationError {
    return new PluginValidationError({
      reason: "MissingExport",
      description: `${file} must export '${exportName}'`,
      file,
    });
  }

  static routeConflict(routePath: string, file: string): PluginValidationError {
    return new PluginValidationError({
      reason: "RouteConflict",
      description: `Route conflict: ${routePath}`,
      file,
      details: "Path defined both as page route and API endpoint",
    });
  }

  static invalidStructure(message: string, file?: string): PluginValidationError {
    return new PluginValidationError({
      reason: "InvalidStructure",
      description: message,
      file,
    });
  }

  override get message(): string {
    return this.description;
  }
}

class RollupPluginError extends Schema.TaggedError<RollupPluginError>()("RollupPluginError", {
  message: Schema.String,
  cause: Schema.Unknown,
}) {}

/**
 * Multiple plugin validation errors.
 *
 * @remarks
 * Batches several `PluginValidationError` values so the plugin can report the
 * full set of structural problems from one validation pass.
 *
 * @internal
 * @since 1.0.0
 */
export class PluginValidationErrors extends Schema.TaggedError<PluginValidationErrors>()(
  "PluginValidationErrors",
  {
    errors: Schema.NonEmptyArray(Schema.instanceOf(PluginValidationError)),
  },
) {
  override get message(): string {
    return this.errors
      .map((e) => {
        const loc = e.file ? ` (${e.file})` : "";
        const detail = e.details ? `: ${e.details}` : "";
        return `${e.description}${loc}${detail}`;
      })
      .join("\n");
  }
}

/**
 * Plugin parse error.
 *
 * @remarks
 * Used by route and schema parsing helpers when source text cannot be turned
 * into the intermediate structures the plugin needs.
 *
 * @internal
 * @since 1.0.0
 */
export const PluginParseError = PluginParseErrorImpl;

/**
 * Plugin file system error.
 *
 * @remarks
 * Wraps file-system failures from generated file reads, writes, and directory
 * creation while keeping the original cause attached for logs and tests.
 *
 * @internal
 * @since 1.0.0
 */
export const PluginFileSystemError = PluginFileSystemErrorImpl;

/**
 * Plugin bootstrap error.
 *
 * @remarks
 * Raised when a Vite hook that depends on resolved configuration executes
 * before plugin bootstrap has completed.
 *
 * @internal
 * @since 1.0.0
 */
export const PluginBootstrapError = PluginBootstrapErrorImpl;

type PluginFileSystemError = PluginFileSystemErrorImpl;
type PluginParseError = PluginParseErrorImpl;

// =============================================================================
// Logging (consola - async reporters, non-blocking I/O)
// =============================================================================

import { createConsola } from "consola";

const logger = createConsola({ defaults: { tag: "trygg" } });

const renderLogMessage = (message: unknown): string =>
  Array.isArray(message) ? message.map((part) => String(part)).join(" ") : String(message);

const logToConsola = (logLevel: Logger.Options<unknown>["logLevel"], text: string): void => {
  if (LogLevel.isGreaterThanOrEqualTo(logLevel, "Error")) {
    logger.error(text);
  } else if (LogLevel.isGreaterThanOrEqualTo(logLevel, "Warn")) {
    logger.warn(text);
  } else if (LogLevel.isLessThanOrEqualTo(logLevel, "Debug")) {
    logger.debug(text);
  } else {
    logger.info(text);
  }
};

/**
 * Plugin logger backed by consola.
 * Consola uses async reporters with buffered process.stdout.write,
 * so it won't block I/O like raw console.log calls.
 * @internal
 */
const PluginLogger = Logger.make((options) => {
  logToConsola(options.logLevel, renderLogMessage(options.message));
});

/**
 * Dynamically import the Bun dev-platform Layer to avoid loading @effect/platform-bun in Node.js.
 * @internal
 */
const importBunDevPlatform = Effect.tryPromise({
  try: () => import("./dev-platform-bun.js").then((module) => module.layer),
  catch: (cause) =>
    new ImportError({
      module: "./dev-platform-bun.js",
      message: "Failed to import Bun dev-platform Layer",
      cause,
    }),
});

/**
 * Create plugin layer for given platform.
 * Uses DevPlatform to get platform-specific FileSystem.
 * @internal
 */
const makePluginLayer = (
  devPlatform: Platform,
  productionPlatform: Platform,
): LayerType<
  FileSystem.FileSystem | DevPlatform | ServerPlatform | PluginFiles | BuildOutput,
  ImportError
> => {
  const devLayer =
    devPlatform === "bun" ? Layer.unwrap(importBunDevPlatform) : NodeDevPlatform.layer;
  const serverLayer =
    productionPlatform === "bun" ? BunServerPlatform.layer : NodeServerPlatform.layer;

  const platformLayer = Layer.mergeAll(devLayer, serverLayer);
  const pluginFilesLayer = PluginFiles.layer.pipe(Layer.provideMerge(platformLayer));
  const buildOutputLayer = BuildOutput.layer.pipe(Layer.provideMerge(pluginFilesLayer));

  return Layer.mergeAll(
    buildOutputLayer,
    Logger.layer([PluginLogger]),
    Layer.succeed(References.MinimumLogLevel, "Debug"),
  );
};

/**
 * Log validation errors with details.
 * @internal
 */
const logValidationErrors = (e: PluginValidationErrors): Effect.Effect<void> =>
  Effect.forEach(e.errors, (error) =>
    Effect.gen(function* () {
      yield* Effect.logError(error.description);
      if (error.details) {
        yield* Effect.logDebug(`  ${error.details}`);
      }
    }),
  ).pipe(Effect.asVoid);

/**
 * Log single validation error.
 * @internal
 */
const logValidationError: (e: PluginValidationError) => Effect.Effect<void> = Effect.fn(
  "VitePlugin.logValidationError",
)(function* (e: PluginValidationError) {
  yield* Effect.logError(e.description);
  if (e.details) {
    yield* Effect.logDebug(`  ${e.details}`);
  }
});

/**
 * Log file system errors.
 * @internal
 */
const logFileSystemError = (e: PluginFileSystemError): Effect.Effect<void> =>
  Effect.logError(`File system ${e.operation} failed for ${e.path}`);

/**
 * Log parse error.
 * @internal
 */
const logParseError = (e: PluginParseError): Effect.Effect<void> =>
  Effect.logError(`Failed to parse module: ${e.description}`);

/**
 * Log API validation errors (handles both validation and parse errors).
 * @internal
 */
const logApiValidationError = (
  e: PluginValidationErrors | PluginValidationError | PluginParseError | PluginFileSystemError,
): Effect.Effect<void> =>
  Match.value(e).pipe(
    Match.tag("PluginValidationErrors", logValidationErrors),
    Match.tag("PluginValidationError", logValidationError),
    Match.tag("PluginParseError", logParseError),
    Match.tag("PluginFileSystemError", logFileSystemError),
    Match.exhaustive,
  );

/**
 * Collected import info for route transform.
 * @internal
 */
interface ImportedComponent {
  readonly localName: string;
  readonly importPath: string;
  readonly isDefault: boolean;
}

/**
 * Transform routes.ts for production build.
 * Replaces direct component references in .component() with lazy imports.
 *
 * @remarks
 * Internal production-build transform. It rewrites route component and layout
 * references to lazy imports unless the surrounding route tree opts into eager
 * rendering.
 *
 * @example
 * ```ts
 * // Input:
 * import { UserProfile } from "./pages/users/profile"
 * Route.make("/users/:id").component(UserProfile)
 *
 * // Output:
 * Route.make("/users/:id").component(() => import("./pages/users/profile").then(m => m.UserProfile))
 * ```
 *
 * @internal
 * @since 1.0.0
 */
export const transformRoutesForBuild: (
  source: string,
  routesFilePath: string,
) => Effect.Effect<string> = Effect.fn("VitePlugin.transformRoutesForBuild")(function* (
  source: string,
  routesFilePath: string,
) {
  // 1. Collect all named/default imports with their source paths
  const imports = collectImports(source, routesFilePath);

  // 2. Neutralize strings/comments for position-accurate paren matching
  const clean = neutralizeSource(source);

  // 3. Transform .component(X) and .layout(X) to lazy imports.
  //    Each occurrence is checked against Eager context (own chain + ancestors).
  //    Boundary components (.loading, .error, .notFound, .forbidden) are NOT
  //    transformed — they must be available synchronously as fallback UI.
  let transformed = source;

  for (const imp of imports) {
    for (const method of ROUTE_TRANSFORM_METHODS) {
      const methodRegex = new RegExp(
        `\\.${method}\\(\\s*${escapeRegex(imp.localName)}\\s*\\)`,
        "g",
      );
      const replacement = imp.isDefault
        ? `.${method}(() => import("${imp.importPath}"))`
        : `.${method}(() => import("${imp.importPath}").then(m => m.${imp.localName}))`;

      // Per-occurrence: only transform if NOT in Eager context
      transformed = transformed.replace(methodRegex, (fullMatch, offset: number) =>
        isInEagerContext(clean, offset) ? fullMatch : replacement,
      );
    }
  }

  return transformed;
});

// =============================================================================
// Eager Context Detection — Ancestor-Aware
// =============================================================================

/**
 * Replace string/comment contents with spaces, preserving character positions.
 * Prevents parens in strings or `RenderStrategy.Eager` in comments from
 * causing false matches during balanced-paren scanning.
 * @internal
 */
const neutralizeSource = (source: string): string =>
  source.replace(
    /\/\/.*$|\/\*[\s\S]*?\*\/|"(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'|`(?:[^`\\]|\\.)*`/gm,
    (m) => {
      if (m.startsWith("//") || m.startsWith("/*")) {
        return m.replace(/[^\n]/g, " ");
      }
      if (m.length <= 2) return m;
      return m.charAt(0) + m.slice(1, -1).replace(/[^\n]/g, " ") + m.charAt(m.length - 1);
    },
  );

/**
 * Check if the open paren at `openParenPos` belongs to a `.children(` call.
 * Returns the position of `.` in `.children`, or undefined.
 * @internal
 */
const isChildrenOpenParen = (clean: string, openParenPos: number): number | undefined => {
  let j = openParenPos - 1;
  while (j >= 0 && " \t\n\r".includes(clean.charAt(j))) j--;
  const keyword = ".children";
  const start = j - keyword.length + 1;
  if (start >= 0 && clean.slice(start, j + 1) === keyword) {
    return start;
  }
  return undefined;
};

/**
 * Find the `.children(` call that encloses position `pos`.
 * Scans backward with balanced paren tracking. When an unmatched `(`
 * is found, checks if it belongs to `.children(`. Continues if not.
 * @internal
 */
const findEnclosingChildrenCall = (clean: string, pos: number): number | undefined => {
  let depth = 0;
  for (let i = pos - 1; i >= 0; i--) {
    const ch = clean.charAt(i);
    if (ch === ")") {
      depth++;
    } else if (ch === "(") {
      if (depth > 0) {
        depth--;
      } else {
        const dotPos = isChildrenOpenParen(clean, i);
        if (dotPos !== undefined) return dotPos;
        // Not .children — keep searching outward
      }
    }
  }
  return undefined;
};

/**
 * Find the matching close paren for an open paren at `openPos`.
 * @internal
 */
const findMatchingCloseParen = (clean: string, openPos: number): number | undefined => {
  let depth = 1;
  for (let i = openPos + 1; i < clean.length; i++) {
    const ch = clean.charAt(i);
    if (ch === "(") depth++;
    else if (ch === ")") {
      depth--;
      if (depth === 0) return i;
    }
  }
  return undefined;
};

/**
 * Find the start of the route chain containing `pos`.
 * Scans backward for the nearest `Route.make(` or `Route.index(`.
 * @internal
 */
const findRouteChainStart = (clean: string, pos: number): number => {
  const before = clean.slice(0, pos);
  let latest = 0;
  for (const pattern of [/Route\.make\s*\(/g, /Route\.index\s*\(/g]) {
    let m: RegExpExecArray | null = pattern.exec(before);
    while (m !== null) {
      if (m.index > latest) latest = m.index;
      m = pattern.exec(before);
    }
  }
  return latest;
};

/**
 * Find the end of a route chain from `pos`.
 * Chain ends at `,` or `)` at depth 0 (parent argument boundary).
 * @internal
 */
const findRouteChainEnd = (clean: string, pos: number): number => {
  let depth = 0;
  for (let i = pos; i < clean.length; i++) {
    const ch = clean.charAt(i);
    if (ch === "(") depth++;
    else if (ch === ")") {
      if (depth === 0) return i;
      depth--;
    } else if (ch === "," && depth === 0) {
      return i;
    }
  }
  return clean.length;
};

/**
 * Extract parent route chain text, EXCLUDING the children body.
 * Given `.children(` at `childrenDotPos`, concatenates:
 *   [parentStart..openParen) + [closeParen+1..parentEnd)
 * This prevents a child's strategy from being attributed to the parent.
 * @internal
 */
const getParentChainText = (clean: string, childrenDotPos: number): string => {
  const afterKeyword = childrenDotPos + ".children".length;
  let openParen = afterKeyword;
  while (openParen < clean.length && clean.charAt(openParen) !== "(") openParen++;

  const closeParen = findMatchingCloseParen(clean, openParen);
  if (closeParen === undefined) return "";

  const parentStart = findRouteChainStart(clean, childrenDotPos);
  const parentEnd = findRouteChainEnd(clean, closeParen + 1);

  return clean.slice(parentStart, openParen) + clean.slice(closeParen + 1, parentEnd);
};

/**
 * Determine if `.component(X)` at `componentPos` is in an Eager context.
 *
 * 1. Check own route chain for explicit strategy (nearest wins).
 * 2. Walk up ancestor `.children()` calls checking parent chains.
 * 3. No ancestor strategy → not eager (default = lazy).
 * @internal
 */
const isInEagerContext = (clean: string, componentPos: number): boolean => {
  // 1. Own route chain
  const ownStart = findRouteChainStart(clean, componentPos);
  const ownEnd = findRouteChainEnd(clean, componentPos);
  const ownChain = clean.slice(ownStart, ownEnd);

  if (ownChain.includes("RenderStrategy.Eager")) return true;
  if (ownChain.includes("RenderStrategy.Lazy")) return false;

  // 2. Ancestor walk
  let searchPos = componentPos;
  for (;;) {
    const childrenDotPos = findEnclosingChildrenCall(clean, searchPos);
    if (childrenDotPos === undefined) return false;

    const parentChain = getParentChainText(clean, childrenDotPos);
    if (parentChain.includes("RenderStrategy.Eager")) return true;
    if (parentChain.includes("RenderStrategy.Lazy")) return false;

    searchPos = childrenDotPos;
  }
};

/**
 * Collect component imports from a routes file source.
 * Only includes imports from relative paths (not packages).
 * @internal
 */
const collectImports = (
  source: string,
  _routesFilePath: string,
): ReadonlyArray<ImportedComponent> => {
  const imports: Array<ImportedComponent> = [];

  // Named imports: import { A, B } from "./path"
  const namedImportRegex = /import\s*\{([^}]+)\}\s*from\s*["']([^"']+)["']/g;
  let namedMatch: RegExpExecArray | null = namedImportRegex.exec(source);
  while (namedMatch !== null) {
    const names = namedMatch[1];
    const importPath = namedMatch[2];
    if (names !== undefined && importPath !== undefined && importPath.startsWith(".")) {
      for (const name of names.split(",")) {
        const trimmed = name.trim();
        // Handle "Foo as Bar" aliases
        const aliasMatch = trimmed.match(/^(\w+)\s+as\s+(\w+)$/);
        if (aliasMatch !== null && aliasMatch[2] !== undefined) {
          imports.push({ localName: aliasMatch[2], importPath, isDefault: false });
        } else if (trimmed.length > 0) {
          imports.push({ localName: trimmed, importPath, isDefault: false });
        }
      }
    }
    namedMatch = namedImportRegex.exec(source);
  }

  // Default imports: import Foo from "./path"
  const defaultImportRegex = /import\s+(\w+)\s+from\s*["']([^"']+)["']/g;
  let defaultMatch: RegExpExecArray | null = defaultImportRegex.exec(source);
  while (defaultMatch !== null) {
    const name = defaultMatch[1];
    const importPath = defaultMatch[2];
    if (name !== undefined && importPath !== undefined && importPath.startsWith(".")) {
      imports.push({ localName: name, importPath, isDefault: true });
    }
    defaultMatch = defaultImportRegex.exec(source);
  }

  return imports;
};

/** Escape special regex characters in a string. @internal */
const escapeRegex = (str: string): string => str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const stripComments = (source: string): string =>
  source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");

const nodePlatformImportPattern =
  /\b(?:import|export)\s+(?:[^"']+from\s+)?["']@effect\/platform-node(?:\/[^"']*)?["']/;

const apiExportPattern = /(?:^|[;\n\r])\s*export\s+const\s+Api\b/;

const isTypeScriptJsxModule = (id: string): boolean => {
  const [modulePath] = id.split("?");
  if (modulePath === undefined) return false;
  const normalized = modulePath.replace(/\\/g, "/");
  return normalized.endsWith(".tsx") && !normalized.includes("/node_modules/");
};

const stripNonCodeText = (source: string): string => {
  let output = "";
  let index = 0;

  while (index < source.length) {
    const current = source[index];
    const next = source[index + 1];

    if (current === undefined) {
      break;
    }

    if (current === "/" && next === "/") {
      output += "  ";
      index += 2;
      while (index < source.length && source[index] !== "\n") {
        output += " ";
        index += 1;
      }
      continue;
    }

    if (current === "/" && next === "*") {
      output += "  ";
      index += 2;
      while (index < source.length) {
        const blockCurrent = source[index];
        const blockNext = source[index + 1];
        if (blockCurrent === "*" && blockNext === "/") {
          output += "  ";
          index += 2;
          break;
        }
        output += blockCurrent === "\n" ? "\n" : " ";
        index += 1;
      }
      continue;
    }

    if (current === '"' || current === "'" || current === "`") {
      const quote = current;
      output += " ";
      index += 1;
      while (index < source.length) {
        const quotedCurrent = source[index];
        if (quotedCurrent === undefined) {
          break;
        }
        if (quotedCurrent === "\\") {
          output += "  ";
          index += 2;
          continue;
        }
        output += quotedCurrent === "\n" ? "\n" : " ";
        index += 1;
        if (quotedCurrent === quote) {
          break;
        }
      }
      continue;
    }

    output += current;
    index += 1;
  }

  return output;
};

// =============================================================================
// File System Operations
// =============================================================================

/**
 * Check if path exists.
 * @internal
 */
const pathExists: (
  filePath: string,
) => Effect.Effect<boolean, PluginFileSystemError, FileSystem.FileSystem> = Effect.fn(
  "VitePlugin.pathExists",
)(function* (filePath: string) {
  const fs = yield* FileSystem.FileSystem;
  return yield* fs
    .exists(filePath)
    .pipe(
      Effect.catchTag("PlatformError", (error) =>
        Predicate.isTagged(error.reason, "NotFound")
          ? Effect.succeed(false)
          : Effect.fail(
              new PluginFileSystemError({ operation: "exists", path: filePath, cause: error }),
            ),
      ),
    );
});

/**
 * Write file with directory creation.
 * @internal
 */
const writeFileSafe: (
  filePath: string,
  content: string,
) => Effect.Effect<void, PluginFileSystemError, FileSystem.FileSystem> = Effect.fn(
  "VitePlugin.writeFileSafe",
)(function* (filePath: string, content: string) {
  const fs = yield* FileSystem.FileSystem;
  const dir = nodePath.dirname(filePath);

  yield* fs.makeDirectory(dir, { recursive: true }).pipe(
    Effect.catchTag("PlatformError", (e) =>
      Predicate.isTagged(e.reason, "AlreadyExists") ? Effect.void : Effect.fail(e),
    ),
    Effect.mapError(
      (cause) =>
        new PluginFileSystemError({
          operation: "mkdir",
          path: dir,
          cause,
        }),
    ),
  );

  yield* fs.writeFileString(filePath, content).pipe(
    Effect.mapError(
      (cause) =>
        new PluginFileSystemError({
          operation: "write",
          path: filePath,
          cause,
        }),
    ),
  );
});

// =============================================================================
// Validation
// =============================================================================

/**
 * Validate that api.ts does not import @effect/platform-node when platform is bun.
 *
 * @remarks
 * Internal guard that prevents Bun builds from depending on the Node platform
 * package through `app/api.ts`.
 *
 * @internal
 * @since 1.0.0
 */
export const validateApiPlatform: (
  apiPath: string,
  platform: Platform,
) => Effect.Effect<void, PluginValidationError | PluginFileSystemError, FileSystem.FileSystem> =
  Effect.fn("VitePlugin.validateApiPlatform")(function* (apiPath: string, platform: Platform) {
    if (platform !== "bun") {
      return;
    }

    const hasApi = yield* pathExists(apiPath);
    if (!hasApi) {
      return;
    }

    const fs = yield* FileSystem.FileSystem;
    const source = yield* fs.readFileString(apiPath).pipe(
      Effect.mapError(
        (cause) =>
          new PluginFileSystemError({
            operation: "read",
            path: apiPath,
            cause,
          }),
      ),
    );

    const stripped = stripComments(source);
    if (nodePlatformImportPattern.test(stripped)) {
      return yield* PluginValidationError.invalidStructure(
        '@effect/platform-node imports are not allowed in app/api.ts when platform is "bun"',
        apiPath,
      );
    }
  });

type ApiClientContract = Data.TaggedEnum<{
  readonly Absent: {};
  readonly ServerOnly: {};
  readonly ClientEnabled: {};
}>;

const ApiClientContract = Data.taggedEnum<ApiClientContract>();

const readApiClientContract: (
  apiPath: string,
) => Effect.Effect<ApiClientContract, PluginFileSystemError, FileSystem.FileSystem> = Effect.fn(
  "VitePlugin.readApiClientContract",
)(function* (apiPath: string) {
  const hasApi = yield* pathExists(apiPath);
  if (!hasApi) {
    return ApiClientContract.Absent();
  }

  const fs = yield* FileSystem.FileSystem;
  const source = yield* fs.readFileString(apiPath).pipe(
    Effect.mapError(
      (cause) =>
        new PluginFileSystemError({
          operation: "read",
          path: apiPath,
          cause,
        }),
    ),
  );

  if (apiExportPattern.test(stripNonCodeText(source))) {
    return ApiClientContract.ClientEnabled();
  }

  return ApiClientContract.ServerOnly();
});

const validateGeneratedApiClient: (
  apiPath: string,
) => Effect.Effect<void, PluginValidationError | PluginFileSystemError, FileSystem.FileSystem> =
  Effect.fn("VitePlugin.validateGeneratedApiClient")(function* (apiPath: string) {
    const contract = yield* readApiClientContract(apiPath);
    if (ApiClientContract.$is("ClientEnabled")(contract)) {
      return;
    }
    return yield* PluginValidationError.invalidStructure(API_EXPORT_MESSAGE, apiPath);
  });

const generateApiClientModule = (apiPath: string): string =>
  renderApiClientModule({ apiImportPath: apiPath.replace(/\\/g, "/") });

// =============================================================================
// Code Generation
// =============================================================================

const toModuleImportPath = (fromDir: string, toFileOrDir: string): string => {
  const relative = nodePath.relative(fromDir, toFileOrDir).replace(/\\/g, "/");
  return relative.startsWith(".") ? relative : `./${relative}`;
};

const stripTypeScriptExtension = (modulePath: string): string => modulePath.replace(/\.tsx?$/, "");

/**
 * Build semantic owner paths for the generated browser entry module.
 *
 * @remarks
 * Keeps path derivation separate from module text rendering so Vite hooks can
 * share one owner contract for dev and build output.
 *
 * @internal
 * @since 1.0.0
 */
export const ClientEntryModuleOwner = {
  make: ({
    appDir,
    generatedDir,
    routesFilePath,
  }: ClientEntryModuleOwnerInput): ClientEntryModuleOwner => {
    const appImportPath = toModuleImportPath(generatedDir, appDir);
    const routesImportPath =
      routesFilePath === undefined
        ? `${appImportPath}/routes`
        : stripTypeScriptExtension(toModuleImportPath(generatedDir, routesFilePath));

    return {
      layoutImportPath: `${appImportPath}/layout`,
      routesImportPath,
    };
  },
};

/**
 * Render the generated browser entry module from semantic owner paths.
 *
 * @remarks
 * Pure renderer used by dev and build paths; generated text must stay stable
 * for existing virtual module consumers.
 *
 * @internal
 * @since 1.0.0
 */
export const renderClientEntryModule = (owner: ClientEntryModuleOwner): string =>
  `// Auto-generated by trygg - DO NOT EDIT
import { mountDocument, Component, Debug } from "trygg"
import { routes } from "${owner.routesImportPath}"
import Layout from "${owner.layoutImportPath}"
// Pretty-print the trace flight recorder to the console.
// Tune per-subtree from app/layout.tsx with Component.provide(Debug.layer({ ... })).
const App = Component.gen(function* () {
  return <Layout />
}).pipe(Component.provide(Debug.layer({
  minLevel: import.meta.env.DEV ? "Debug" : "Info",
})))

mountDocument(<App />, { manifest: routes.manifest })
`;

/**
 * Generate entry module.
 *
 * Uses `mountDocument` to mount the root layout as the document owner.
 * The layout renders `<html>`, `<head>`, `<body>` which map to existing DOM.
 * Routes manifest is passed so `<Router.Outlet />` works without props.
 *
 * @remarks
 * Internal codegen step that writes the browser entry module under `.trygg/`.
 *
 * @internal
 * @since 1.0.0
 */
export const generateEntryModule = (
  appDir: string,
  generatedDir: string,
  routesFile?: string,
): Effect.Effect<string> =>
  Effect.succeed(
    renderClientEntryModule(
      ClientEntryModuleOwner.make({
        appDir,
        generatedDir,
        routesFilePath: routesFile,
      }),
    ),
  );

/**
 * Generate HTML shell.
 * Pure function — no Effect, no file I/O.
 * No `<title>` or `<meta>` beyond charset/viewport — HeadManager owns all head content.
 *
 * @remarks
 * Internal template used for generated app HTML before runtime head content is
 * hoisted into place.
 *
 * @internal
 * @since 1.0.0
 */
export const generateHtmlTemplate = (): string => `<!DOCTYPE html>
<html>
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <link rel="icon" href="/favicon.svg" type="image/svg+xml" />
    <script type="module" src="/${GENERATED_DIR}/entry.tsx"></script>
  </head>
  <body></body>
</html>`;

interface PluginFilePaths {
  readonly appDir: string;
  readonly generatedDir: string;
}

interface PluginFilesService {
  readonly appApiPath: (paths: PluginFilePaths) => string;
  readonly appApiExists: (paths: PluginFilePaths) => Effect.Effect<boolean, PluginFileSystemError>;
  readonly routesFilePath: (
    paths: PluginFilePaths,
  ) => Effect.Effect<string | undefined, PluginFileSystemError>;
  readonly isRoutesFile: (
    paths: PluginFilePaths,
    filePath: string,
  ) => Effect.Effect<boolean, PluginFileSystemError>;
  readonly writeEntryFile: (paths: PluginFilePaths) => Effect.Effect<void, PluginFileSystemError>;
  readonly writeGeneratedRouteTypes: (
    paths: PluginFilePaths,
  ) => Effect.Effect<void, PluginFileSystemError | PluginParseError>;
  readonly regenerateGeneratedRouteTypes: (
    paths: PluginFilePaths,
  ) => Effect.Effect<void, PluginFileSystemError | PluginParseError>;
  readonly writeClientEntryFiles: (
    paths: PluginFilePaths,
  ) => Effect.Effect<void, PluginFileSystemError | PluginParseError>;
  readonly executeArtifactOperations: (
    operations: ReadonlyArray<BuildArtifactOperation>,
  ) => Effect.Effect<void, PluginFileSystemError>;
  readonly writeProductionServerEntry: (
    paths: PluginFilePaths,
  ) => Effect.Effect<string, PluginFileSystemError, ServerPlatform>;
}

/**
 * Owns generated plugin file path discovery and writes.
 *
 * @remarks
 * Internal service boundary that keeps generated route and entry file work out
 * of Vite hook orchestration.
 *
 * @internal
 * @since 1.0.0
 */
export class PluginFiles extends Context.Service<
  PluginFiles,
  {
    readonly appApiPath: (paths: PluginFilePaths) => string;
    readonly appApiExists: (
      paths: PluginFilePaths,
    ) => Effect.Effect<boolean, PluginFileSystemError>;
    readonly routesFilePath: (
      paths: PluginFilePaths,
    ) => Effect.Effect<string | undefined, PluginFileSystemError>;
    readonly isRoutesFile: (
      paths: PluginFilePaths,
      filePath: string,
    ) => Effect.Effect<boolean, PluginFileSystemError>;
    readonly writeEntryFile: (paths: PluginFilePaths) => Effect.Effect<void, PluginFileSystemError>;
    readonly writeGeneratedRouteTypes: (
      paths: PluginFilePaths,
    ) => Effect.Effect<void, PluginFileSystemError | PluginParseError>;
    readonly regenerateGeneratedRouteTypes: (
      paths: PluginFilePaths,
    ) => Effect.Effect<void, PluginFileSystemError | PluginParseError>;
    readonly writeClientEntryFiles: (
      paths: PluginFilePaths,
    ) => Effect.Effect<void, PluginFileSystemError | PluginParseError>;
    readonly executeArtifactOperations: (
      operations: ReadonlyArray<BuildArtifactOperation>,
    ) => Effect.Effect<void, PluginFileSystemError>;
    readonly writeProductionServerEntry: (
      paths: PluginFilePaths,
    ) => Effect.Effect<string, PluginFileSystemError, ServerPlatform>;
  }
>()("trygg/vite/PluginFiles") {}

const routeSourcePath = (paths: PluginFilePaths): string =>
  nodePath.join(paths.appDir, "routes.ts");

const appApiPath = (paths: PluginFilePaths): string => nodePath.join(paths.appDir, "api.ts");

const generatedRouteTypesPath = (paths: PluginFilePaths): string =>
  nodePath.join(paths.generatedDir, "routes.d.ts");

const generatedEntryPath = (paths: PluginFilePaths): string =>
  nodePath.join(paths.generatedDir, "entry.tsx");

const sameFilePath = (left: string, right: string): boolean =>
  nodePath.resolve(left) === nodePath.resolve(right);

/**
 * Creates the live generated plugin file service.
 *
 * @remarks
 * Derives route and generated file paths from canonical plugin directories at
 * call time instead of storing duplicate path state.
 *
 * @internal
 * @since 1.0.0
 */
const pluginFilesLayer: Layer.Layer<PluginFiles, never, FileSystem.FileSystem> = Layer.effect(
  PluginFiles,
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;

    const pathExists = (filePath: string): Effect.Effect<boolean, PluginFileSystemError> =>
      fs.exists(filePath).pipe(
        Effect.catchTag("PlatformError", (error) =>
          Predicate.isTagged(error.reason, "NotFound")
            ? Effect.succeed(false)
            : Effect.fail(
                new PluginFileSystemError({
                  operation: "exists",
                  path: filePath,
                  cause: error,
                }),
              ),
        ),
      );

    const writeFileSafe: (
      filePath: string,
      content: string,
    ) => Effect.Effect<void, PluginFileSystemError> = Effect.fn("PluginFiles.writeFileSafe")(
      function* (filePath: string, content: string) {
        const dir = nodePath.dirname(filePath);

        yield* fs.makeDirectory(dir, { recursive: true }).pipe(
          Effect.catchTag("PlatformError", (e) =>
            Predicate.isTagged(e.reason, "AlreadyExists") ? Effect.void : Effect.fail(e),
          ),
          Effect.mapError(
            (cause) =>
              new PluginFileSystemError({
                operation: "mkdir",
                path: dir,
                cause,
              }),
          ),
        );

        yield* fs.writeFileString(filePath, content).pipe(
          Effect.mapError(
            (cause) =>
              new PluginFileSystemError({
                operation: "write",
                path: filePath,
                cause,
              }),
          ),
        );
      },
    );

    const routesFilePath: (
      paths: PluginFilePaths,
    ) => Effect.Effect<string | undefined, PluginFileSystemError> = Effect.fn(
      "PluginFiles.routesFilePath",
    )(function* (paths: PluginFilePaths) {
      const filePath = routeSourcePath(paths);
      const exists = yield* pathExists(filePath);
      return exists ? filePath : undefined;
    });

    const writeRouteTypesFromRoutesWithFs: (
      routesFilePath: string,
      routeTypesPath: string,
    ) => Effect.Effect<boolean, PluginFileSystemError | PluginParseError> = Effect.fn(
      "PluginFiles.writeRouteTypesFromRoutesWithFs",
    )(function* (routesFilePath: string, routeTypesPath: string) {
      const routeSource = yield* fs.readFileString(routesFilePath).pipe(
        Effect.catchTag("PlatformError", (error) =>
          Predicate.isTagged(error.reason, "NotFound")
            ? Effect.succeed("")
            : Effect.fail(
                new PluginFileSystemError({
                  operation: "read",
                  path: routesFilePath,
                  cause: error,
                }),
              ),
        ),
      );
      if (routeSource.length === 0) {
        return false;
      }

      const content = yield* generateRouteTypes(routeSource, routesFilePath, routeTypesPath);
      yield* writeFileSafe(routeTypesPath, content);
      return true;
    });

    const writeEntryFile: (paths: PluginFilePaths) => Effect.Effect<void, PluginFileSystemError> =
      Effect.fn("PluginFiles.writeEntryFile")(function* (paths: PluginFilePaths) {
        const routesFile = yield* routesFilePath(paths);
        const content = yield* generateEntryModule(paths.appDir, paths.generatedDir, routesFile);
        yield* writeFileSafe(generatedEntryPath(paths), content);
      });

    const writeRouteTypesWithLog: (
      paths: PluginFilePaths,
      message: string,
    ) => Effect.Effect<void, PluginFileSystemError | PluginParseError> = Effect.fn(
      "PluginFiles.writeRouteTypesWithLog",
    )(function* (paths: PluginFilePaths, message: string) {
      const routesFile = yield* routesFilePath(paths);
      if (routesFile !== undefined) {
        const wroteTypes = yield* writeRouteTypesFromRoutesWithFs(
          routesFile,
          generatedRouteTypesPath(paths),
        );
        if (wroteTypes) {
          yield* Effect.logDebug(message);
        }
      }
    });

    const writeGeneratedRouteTypes = (paths: PluginFilePaths) =>
      writeRouteTypesWithLog(paths, "Generated route types");

    return {
      appApiPath,
      appApiExists: (paths) =>
        pathExists(appApiPath(paths)).pipe(
          Effect.flatMap((exists) =>
            exists
              ? fs.stat(appApiPath(paths)).pipe(
                  Effect.map((info) => info.type === "File"),
                  Effect.catchTag("PlatformError", (error) =>
                    Predicate.isTagged(error.reason, "NotFound")
                      ? Effect.succeed(false)
                      : Effect.fail(
                          new PluginFileSystemError({
                            operation: "stat",
                            path: appApiPath(paths),
                            cause: error,
                          }),
                        ),
                  ),
                )
              : Effect.succeed(false),
          ),
        ),
      routesFilePath,
      isRoutesFile: Effect.fn("PluginFiles.isRoutesFile")(function* (
        paths: PluginFilePaths,
        filePath: string,
      ) {
        const routesFile = yield* routesFilePath(paths);
        return routesFile !== undefined && sameFilePath(filePath, routesFile);
      }),
      writeEntryFile,
      writeGeneratedRouteTypes,
      regenerateGeneratedRouteTypes: (paths) =>
        writeRouteTypesWithLog(paths, "Regenerated routes.d.ts"),
      writeClientEntryFiles: Effect.fn("PluginFiles.writeClientEntryFiles")(function* (
        paths: PluginFilePaths,
      ) {
        const entryPath = generatedEntryPath(paths);
        const hasEntry = yield* pathExists(entryPath);
        const routesFile = yield* routesFilePath(paths);

        if (!hasEntry || routesFile !== undefined) {
          yield* writeEntryFile(paths);
        }

        yield* writeGeneratedRouteTypes(paths);
      }),
      executeArtifactOperations: (operations) =>
        Effect.forEach(
          operations,
          (operation) => {
            return BuildArtifactOperation.$match(operation, {
              WriteFile: (writeFile) => writeFileSafe(writeFile.path, writeFile.contents),
              RemoveFile: (removeFile) =>
                pathExists(removeFile.path).pipe(
                  Effect.flatMap((exists) =>
                    exists
                      ? fs.remove(removeFile.path).pipe(
                          Effect.mapError(
                            (cause) =>
                              new PluginFileSystemError({
                                operation: "remove",
                                path: removeFile.path,
                                cause,
                              }),
                          ),
                        )
                      : Effect.void,
                  ),
                ),
              RunNestedBuild: () => Effect.void,
            });
          },
          { discard: true },
        ),
      writeProductionServerEntry: Effect.fn("PluginFiles.writeProductionServerEntry")(function* (
        paths: PluginFilePaths,
      ) {
        const hasApi = yield* pathExists(nodePath.join(paths.appDir, "api.ts"));
        const serverEntryPath = nodePath.join(paths.generatedDir, "server-entry.ts");
        const content = yield* generateServerEntry(hasApi);

        yield* writeFileSafe(serverEntryPath, content);
        return serverEntryPath;
      }),
    } satisfies PluginFilesService;
  }).pipe(Effect.annotateLogs({ service: "PluginFiles" })),
);

export namespace PluginFiles {
  export const layer: Layer.Layer<PluginFiles, never, FileSystem.FileSystem> = pluginFilesLayer;
}

const generatedApiClientTypesPath = (generatedDir: string): string =>
  nodePath.join(generatedDir, "api.d.ts");

const legacyGeneratedApiClientTypesPath = (generatedDir: string): string =>
  nodePath.join(generatedDir, "api-types.ts");

const removeFileIfExists: (
  filePath: string,
) => Effect.Effect<void, PluginFileSystemError, FileSystem.FileSystem> = Effect.fn(
  "VitePlugin.removeFileIfExists",
)(function* (filePath: string) {
  const fs = yield* FileSystem.FileSystem;
  const exists = yield* pathExists(filePath);
  if (!exists) {
    return;
  }

  yield* fs.remove(filePath).pipe(
    Effect.mapError(
      (cause) =>
        new PluginFileSystemError({
          operation: "remove",
          path: filePath,
          cause,
        }),
    ),
  );
});

const writeGeneratedApiClientTypes: (
  appDir: string,
  generatedDir: string,
) => Effect.Effect<void, PluginFileSystemError, FileSystem.FileSystem> = Effect.fn(
  "VitePlugin.writeGeneratedApiClientTypes",
)(function* (appDir: string, generatedDir: string) {
  const apiPath = nodePath.join(appDir, "api.ts");
  const contract = yield* readApiClientContract(apiPath);

  yield* removeFileIfExists(legacyGeneratedApiClientTypesPath(generatedDir));

  if (ApiClientContract.$is("ClientEnabled")(contract)) {
    const appImportPath = toModuleImportPath(generatedDir, appDir);
    const content = renderApiClientDeclarations({
      apiTypeImportPath: `${appImportPath}/api`,
    });
    yield* writeFileSafe(generatedApiClientTypesPath(generatedDir), content);
    return;
  }

  // Remove stale generated declarations for Absent and ServerOnly
  const typesPath = generatedApiClientTypesPath(generatedDir);
  yield* removeFileIfExists(typesPath);
});

/**
 * Render the generated API client runtime module.
 *
 * @remarks
 * Pure renderer used by the virtual module `trygg/api`. Imports the app's
 * exported `Api` and builds `ApiClient` + `ApiClientLive` from it.
 *
 * @internal
 * @since 1.0.0
 */
export const renderApiClientModule = ({
  apiImportPath,
}: {
  readonly apiImportPath: string;
}): string =>
  `// Auto-generated by trygg - DO NOT EDIT
import { HttpApiClient } from "effect/unstable/httpapi"
import { Effect, Layer } from "effect"
import * as Context from "effect/Context"
import { FetchHttpClient } from "effect/unstable/http"
import { Api } from ${JSON.stringify(apiImportPath)}

const client = HttpApiClient.make(Api, { baseUrl: "" })

export class ApiClient extends Context.Service()("ApiClient") {}

export const ApiClientLive = Layer.effect(
  ApiClient,
  client.pipe(Effect.provide(FetchHttpClient.layer)),
)

export { Api }
`;

/**
 * Render the generated API client type declarations.
 *
 * @remarks
 * Produces the ambient `trygg/api` module augmentation written to the
 * generated `.trygg/api.d.ts` file.
 *
 * @internal
 * @since 1.0.0
 */
export const renderApiClientDeclarations = ({
  apiTypeImportPath,
}: {
  readonly apiTypeImportPath: string;
}): string =>
  `// Auto-generated by trygg\nimport type * as Context from "effect/Context"\nimport type { Layer } from "effect/Layer"\nimport type { HttpApiClient } from "effect/unstable/httpapi"\nimport type { Api } from "${apiTypeImportPath}"\n\ntype ApiClientService = HttpApiClient.ForApi<typeof Api>\n\ndeclare module "trygg/api" {\n  export interface ApiClient {}\n  export const ApiClient: Context.ServiceClass<ApiClient, "ApiClient", ApiClientService>\n  export const ApiClientLive: Layer.Layer<ApiClient>\n  export { Api }\n}\n`;

const renderProductionServerLive = ({
  hasApi,
  platform,
}: ProductionServerEntryModuleOwner): string =>
  hasApi
    ? `{
  return HttpRouter.serve(withHttpTelemetry(ApiLive), {
  disableLogger: true,
  middleware: flow(ProductionMiddleware, httpLogger)
}).pipe(
  Layer.provide(HttpServer.layerServices),
  Layer.provide(${platform.serverLayer})
 )
}`
    : `{
  const NotFoundApp = Effect.succeed(HttpServerResponse.empty({ status: 404 }))

  return HttpServer.serve(
  flow(ProductionMiddleware, httpLogger)
)(NotFoundApp).pipe(
  Layer.provide(withHttpTelemetry(Layer.empty)),
  Layer.provide(${platform.serverLayer})
 )
}`;

const renderProductionMiddleware =
  (): string => `// Single composed middleware: static → API passthrough → SPA fallback
const makeProductionMiddleware = (indexHtml) => HttpMiddleware.make((app) =>
  Effect.gen(function* () {
    const request = yield* HttpServerRequest.HttpServerRequest
    const url = new URL(request.url, "http://localhost")
    const pathname = url.pathname

    // 1. Static files (has extension, not API)
    if (pathname.includes(".") && !pathname.startsWith("/api/")) {
      const filePath = nodePath.resolve(clientDir, pathname.slice(1))
      // Path traversal guard — trailing separator prevents sibling dir bypass
      if (!filePath.startsWith(clientDir + "/")) {
        return yield* HttpServerResponse.text("Forbidden", { status: 403 })
      }
      return yield* readServerFile("read", filePath).pipe(
        Effect.map((buf) => {
          const ext = nodePath.extname(pathname).toLowerCase()
          const ct = MIME[ext] ?? "application/octet-stream"
          const cache = pathname.startsWith("/assets/")
            ? "public, max-age=31536000, immutable"
            : "public, max-age=3600"
          return HttpServerResponse.uint8Array(new Uint8Array(buf), {
            headers: { "content-type": ct, "cache-control": cache }
          })
        }),
        Effect.catch((error) => error.reason === "NotFound" ? app : Effect.fail(error))
      )
    }

    // 2. API routes — delegate to HttpApi handler
    if (pathname.startsWith("/api/")) {
      return yield* app
    }

    // 3. SPA fallback — serve cached shell for navigation requests
    if (request.method === "GET") {
      return yield* HttpServerResponse.text(indexHtml, {
        status: 200,
        headers: { "content-type": "text/html; charset=utf-8" }
      })
    }

    return yield* app
  })
)`;

const renderBunServerStartupAdapter = (): string => `
const BunServeStartupFailureSchema = Schema.Struct({
  code: Schema.Literals([
    "EADDRINUSE",
    "EACCES",
    "EPERM",
    "EADDRNOTAVAIL",
    "EAFNOSUPPORT",
    "EINVAL"
  ]),
  syscall: Schema.Literal("listen")
})
const decodeBunServeStartupFailure = Schema.decodeUnknownOption(BunServeStartupFailureSchema)
const BunStartupReasons = {
  EADDRINUSE: "AddressInUse",
  EACCES: "PermissionDenied",
  EPERM: "PermissionDenied",
  EADDRNOTAVAIL: "AddressNotAvailable",
  EAFNOSUPPORT: "AddressFamilyUnsupported",
  EINVAL: "InvalidAddress"
} as const
const BunStartupDetails = {
  EADDRINUSE: "The configured server address is already in use.",
  EACCES: "The server process is not allowed to bind the configured address.",
  EPERM: "The server process is not allowed to bind the configured address.",
  EADDRNOTAVAIL: "The configured server address is not available on this host.",
  EAFNOSUPPORT: "The configured server address family is not supported.",
  EINVAL: "The configured server address cannot be bound."
} as const

const makeBunServer = Effect.fn("GeneratedServer.makeBunServer")(function* (options) {
  const scope = yield* Effect.scope
  return yield* Effect.try({
    try: () =>
      Effect.runSync(
        BunHttpServer.make(options).pipe(
          Effect.provideService(Scope.Scope, scope)
        )
      ),
    catch: (cause) => cause
  }).pipe(
    Effect.catch((cause) => {
      const failure = decodeBunServeStartupFailure(cause)
      if (Option.isNone(failure)) return Effect.die(cause)

      const { code, syscall } = failure.value
      return Effect.fail(new ServerStartupError({
        reason: BunStartupReasons[code],
        details: BunStartupDetails[code],
        cause: { code, syscall }
      }))
    })
  )
})

const makeBunServerLayer = (options) => Layer.mergeAll(
  Layer.effect(HttpServer.HttpServer, makeBunServer(options)),
  BunHttpServer.layerHttpServices
)
`;

/**
 * Render the generated production server entry module from owner state.
 *
 * @remarks
 * Keeps platform and API-specific branches named outside the Effectful Vite
 * hook so generated server content can be tested directly.
 *
 * @internal
 * @since 1.0.0
 */
export const renderProductionServerEntryModule = (
  owner: ProductionServerEntryModuleOwner,
): string => {
  const apiImport = owner.hasApi ? `import ApiLive from "../app/api.js"` : "";
  const isBun = owner.platform.runtime === "BunRuntime";
  const effectImports = isBun
    ? "Cause, Context, Effect, Exit, Layer, Logger, Option, Schema, Scope, Tracer, flow"
    : "Cause, Context, Effect, Exit, Layer, Logger, Option, Schema, Tracer, flow";
  const serverStartupAdapter = isBun ? renderBunServerStartupAdapter() : "";

  return `/**
 * Production server entry point
 * Auto-generated by trygg — DO NOT EDIT
 */
import { HttpMiddleware, HttpRouter, HttpServer, HttpServerRequest, HttpServerResponse } from "effect/unstable/http"
${owner.platform.imports}
import { ${effectImports} } from "effect"
import * as nodePath from "node:path"
import * as nodeFs from "node:fs"
import { fileURLToPath } from "node:url"
${apiImport}

${renderHttpTelemetry()}

const __dirname = nodePath.dirname(fileURLToPath(import.meta.url))
const clientDir = nodePath.join(__dirname, "client")

const ServerConfigSchema = Schema.Struct({
  PORT: Schema.NumberFromString.check(
    Schema.isInt(),
    Schema.isBetween({ minimum: 1, maximum: 65535 })
  ),
  HOST: Schema.NonEmptyString
})

class ServerConfigError extends Schema.TaggedError<ServerConfigError>()("ServerConfigError", {
  cause: Schema.Unknown
}) {}

class ServerStartupError extends Schema.TaggedError<ServerStartupError>()("ServerStartupError", {
  reason: Schema.optional(Schema.Literals([
    "AddressInUse",
    "PermissionDenied",
    "AddressNotAvailable",
    "AddressFamilyUnsupported",
    "InvalidAddress"
  ])),
  details: Schema.optional(Schema.String),
  cause: Schema.Unknown
}) {
  override get message(): string {
    return this.details ?? ""
  }
}

${serverStartupAdapter}

class ServerFileSystemError extends Schema.TaggedError<ServerFileSystemError>()(
  "ServerFileSystemError",
  {
    operation: Schema.String,
    path: Schema.String,
    reason: Schema.Literals(["NotFound", "Other"]),
    cause: Schema.Unknown
  }
) {}

const NodeErrorSchema = Schema.Struct({ code: Schema.String })
const decodeNodeError = Schema.decodeUnknownOption(NodeErrorSchema)
const readServerFile = (operation, path) => Effect.tryPromise({
  try: () => nodeFs.promises.readFile(path),
  catch: (cause) => new ServerFileSystemError({
    operation,
    path,
    reason: Option.match(decodeNodeError(cause), {
      onNone: () => "Other",
      onSome: (error) => error.code === "ENOENT" ? "NotFound" : "Other"
    }),
    cause
  })
})

// MIME types for static assets
const MIME = /** @type {Record<string, string>} */ ({
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".mjs": "application/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".ico": "image/x-icon",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".webp": "image/webp",
  ".avif": "image/avif",
  ".map": "application/json",
})

${renderProductionMiddleware()}

const makeServerLive = (ProductionMiddleware, PORT, HOST) => ${renderProductionServerLive(owner)}

// Launch server
${owner.platform.runtime}.runMain(
  Effect.scoped(Effect.gen(function* () {
    const { HOST, PORT } = yield* Schema.decodeUnknownEffect(ServerConfigSchema)({
      PORT: process.env.PORT ?? "4173",
      HOST: process.env.HOST ?? "0.0.0.0"
    }).pipe(Effect.mapError((cause) => new ServerConfigError({ cause })))
    const shellPath = nodePath.join(clientDir, ".trygg", "index.html")
    const indexHtml = yield* readServerFile("read", shellPath).pipe(
      Effect.map((contents) => contents.toString("utf8"))
    )
    const ProductionMiddleware = makeProductionMiddleware(indexHtml)
    const ServerLive = makeServerLive(ProductionMiddleware, PORT, HOST)
    yield* Layer.build(ServerLive).pipe(
      Effect.mapError((cause) => cause instanceof ServerStartupError
        ? cause
        : new ServerStartupError({ cause }))
    )
    yield* Effect.log(\`Server listening on http://\${HOST}:\${PORT}\`)
    yield* Effect.never
  }))
)
`;
};

/**
 * Generate server entry point for production builds.
 *
 * Produces a single composed middleware that handles:
 *   1. Static files — serves from `dist/client/` with MIME detection
 *   2. API routes — delegates to HttpApi handler (when `hasApi`)
 *   3. SPA fallback — serves `.trygg/index.html` for navigation requests
 *
 * @remarks
 * Internal codegen step that emits the production server source used for the
 * generated server bundle.
 *
 * @internal
 * @since 1.0.0
 */
export const generateServerEntry: (
  hasApi: boolean,
) => Effect.Effect<string, never, ServerPlatform> = Effect.fn("VitePlugin.generateServerEntry")(
  function* (hasApi: boolean) {
    const platform = yield* ServerPlatform;
    return renderProductionServerEntryModule({ hasApi, platform });
  },
);

interface BuildOutputConfig {
  readonly command: string;
  readonly root: string;
}

interface BuildOutputStartInput {
  readonly appDir: string;
  readonly generatedDir: string;
  readonly config: BuildOutputConfig;
  readonly output: Output;
  readonly platform: Platform;
}

interface BuildOutputCloseInput {
  readonly appDir: string;
  readonly generatedDir: string;
  readonly config: BuildOutputConfig;
  readonly output: Output;
  readonly platform: Platform;
}

interface BuildOutputService {
  readonly buildStart: (
    input: BuildOutputStartInput,
  ) => Effect.Effect<void, PluginValidationError | PluginFileSystemError | PluginParseError>;
  readonly closeBundle: (
    input: BuildOutputCloseInput,
  ) => Effect.Effect<void, PluginValidationError | PluginFileSystemError | PluginParseError>;
}

interface BuildOutputDeps {
  readonly buildServer: (
    serverEntryPath: string,
    config: BuildOutputConfig,
  ) => Effect.Effect<void, PluginFileSystemError>;
  readonly fileSystem: FileSystem.FileSystem;
  readonly files: PluginFilesService;
  readonly serverPlatform: ServerPlatformService;
}

/**
 * Build-output hook capability owned by the Vite plugin lifecycle.
 *
 * @remarks
 * Keeps validation, generated artifact publication, and nested server builds
 * behind one replaceable seam for plugin orchestration and focused tests.
 *
 * @internal
 * @category Vite Plugin
 * @since 1.0.0
 */
export class BuildOutput extends Context.Service<
  BuildOutput,
  {
    readonly buildStart: (
      input: BuildOutputStartInput,
    ) => Effect.Effect<void, PluginValidationError | PluginFileSystemError | PluginParseError>;
    readonly closeBundle: (
      input: BuildOutputCloseInput,
    ) => Effect.Effect<void, PluginValidationError | PluginFileSystemError | PluginParseError>;
  }
>()("trygg/vite/BuildOutput") {
  static readonly make = (dependencies: BuildOutputDeps): BuildOutputService =>
    makeService(dependencies);
}

/**
 * Create build output hook operations.
 *
 * @remarks
 * Test seam for replacing the production server build while preserving the
 * same Effect-owned build output orchestration used by Vite hooks.
 *
 * @internal
 */
const makeService = ({
  buildServer,
  fileSystem,
  files,
  serverPlatform,
}: BuildOutputDeps): BuildOutputService => {
  const planner = BuildArtifactPlanner.make({ failOnWarnings: false });
  const generatedArtifactPlanner = GeneratedArtifactPlanner.make({
    includeCleanupOperations: true,
  });
  const emitDiagnostic = (diagnostic: BuildPlanDiagnostic) =>
    BuildPlanDiagnostic.$is("Warning")(diagnostic)
      ? Effect.logWarning(diagnostic.message)
      : Effect.void;
  const validatePlan = (input: {
    readonly output: Output;
    readonly platform: Platform;
    readonly hasApi: boolean;
    readonly appDir: string;
    readonly generatedDir: string;
  }) =>
    planner.validateOutput(input).pipe(
      Effect.tap((plan) => Effect.forEach(plan.diagnostics, emitDiagnostic, { discard: true })),
      Effect.catchTag("InvalidBuildOutputCombination", (error: InvalidBuildOutputCombination) =>
        Effect.fail(
          PluginValidationError.invalidStructure(error.diagnostic.message, error.input.appDir),
        ),
      ),
    );
  const planArtifacts: (input: {
    readonly output: Output;
    readonly platform: Platform;
    readonly hasApi: boolean;
    readonly appDir: string;
    readonly generatedDir: string;
  }) => Effect.Effect<GeneratedArtifactPlan, PluginValidationError> = Effect.fn(
    "BuildOutput.planArtifacts",
  )(function* (input) {
    const validation = yield* validatePlan(input);
    return yield* generatedArtifactPlanner
      .planArtifacts(validation)
      .pipe(
        Effect.mapError((error) =>
          PluginValidationError.invalidStructure(
            `Failed to plan build artifacts during ${error.operation}`,
            input.appDir,
          ),
        ),
      );
  });
  const hasOperation = (
    plan: GeneratedArtifactPlan,
    tag: BuildArtifactOperation["_tag"],
    path: string,
  ) =>
    plan.operations.some((operation) =>
      BuildArtifactOperation.$match(operation, {
        WriteFile: (writeFile) =>
          tag === "WriteFile" && nodePath.resolve(writeFile.path) === nodePath.resolve(path),
        RemoveFile: (removeFile) =>
          tag === "RemoveFile" && nodePath.resolve(removeFile.path) === nodePath.resolve(path),
        RunNestedBuild: () => false,
      }),
    );

  return {
    buildStart: Effect.fn("BuildOutput.buildStart")(function* ({
      appDir,
      generatedDir,
      config,
      output,
      platform,
    }: BuildOutputStartInput) {
      const paths = { appDir, generatedDir };
      const apiPath = files.appApiPath(paths);

      yield* validateApiPlatform(apiPath, platform).pipe(
        Effect.provideService(FileSystem.FileSystem, fileSystem),
        Effect.tapError(logApiValidationError),
      );

      if (config.command !== "build") {
        return;
      }

      const hasApi = yield* files.appApiExists(paths);
      const artifactPlan = yield* planArtifacts({
        appDir,
        generatedDir,
        output,
        platform,
        hasApi,
      });
      yield* files.writeClientEntryFiles(paths);
      yield* files.executeArtifactOperations(
        artifactPlan.operations.filter(
          (operation) => !BuildArtifactOperation.$is("RunNestedBuild")(operation),
        ),
      );
    }),
    closeBundle: ({ appDir, generatedDir, config, output, platform }) =>
      config.command !== "build"
        ? Effect.void
        : Effect.gen(function* () {
            const paths = { appDir, generatedDir };
            const hasApi = yield* files.appApiExists(paths);
            const artifactPlan = yield* planArtifacts({
              appDir,
              generatedDir,
              output,
              platform,
              hasApi,
            });

            if (
              hasOperation(
                artifactPlan,
                "WriteFile",
                nodePath.join(generatedDir, "worker-entry.js"),
              )
            ) {
              const internalShellDir = nodePath.join(config.root, "dist", GENERATED_DIR);
              const internalShellPath = nodePath.join(internalShellDir, "index.html");
              const publicShellPath = nodePath.join(config.root, "dist", "index.html");
              const shell = yield* fileSystem.readFileString(internalShellPath).pipe(
                Effect.mapError(
                  (cause) =>
                    new PluginFileSystemError({
                      operation: "read",
                      path: internalShellPath,
                      cause,
                    }),
                ),
              );

              yield* fileSystem.writeFileString(publicShellPath, shell).pipe(
                Effect.mapError(
                  (cause) =>
                    new PluginFileSystemError({
                      operation: "write",
                      path: publicShellPath,
                      cause,
                    }),
                ),
              );
              yield* removeFileIfExists(internalShellPath).pipe(
                Effect.provideService(FileSystem.FileSystem, fileSystem),
              );
              yield* fileSystem.remove(internalShellDir, { recursive: true }).pipe(
                Effect.mapError(
                  (cause) =>
                    new PluginFileSystemError({
                      operation: "remove",
                      path: internalShellDir,
                      cause,
                    }),
                ),
              );
              return;
            }

            const nestedBuild = artifactPlan.operations.find(
              (operation) =>
                BuildArtifactOperation.$is("RunNestedBuild")(operation) &&
                operation.name === "production-server",
            );
            if (nestedBuild === undefined) {
              return;
            }

            const serverEntryPath = yield* files
              .writeProductionServerEntry(paths)
              .pipe(Effect.provideService(ServerPlatform, serverPlatform));

            yield* Effect.logInfo("Building production server...");
            yield* buildServer(serverEntryPath, config);
            yield* Effect.logInfo("Server build complete").pipe(
              Effect.annotateLogs("style", "success"),
            );
          }),
  };
};

const viteServerBuild = (
  serverEntryPath: string,
  config: BuildOutputConfig,
): Effect.Effect<void, PluginFileSystemError> =>
  Effect.tryPromise({
    try: () =>
      build({
        configFile: false,
        root: config.root,
        build: {
          ssr: serverEntryPath,
          outDir: nodePath.join(config.root, "dist"),
          emptyOutDir: false,
          rollupOptions: {
            output: { entryFileNames: "server.js" },
            external: ["effect", /^@effect\//, /^node:/, /^bun:/],
          },
        },
      }),
    catch: (err) =>
      new PluginFileSystemError({
        operation: "transform",
        path: serverEntryPath,
        cause: err,
      }),
  }).pipe(Effect.asVoid);

const buildOutputLayer: Layer.Layer<
  BuildOutput,
  never,
  FileSystem.FileSystem | PluginFiles | ServerPlatform
> = Layer.effect(
  BuildOutput,
  Effect.gen(function* () {
    const fileSystem = yield* FileSystem.FileSystem;
    const files = yield* PluginFiles;
    const serverPlatform = yield* ServerPlatform;
    return BuildOutput.make({ buildServer: viteServerBuild, fileSystem, files, serverPlatform });
  }).pipe(Effect.annotateLogs({ service: "BuildOutput" })),
);

export namespace BuildOutput {
  export const layer: Layer.Layer<
    BuildOutput,
    never,
    FileSystem.FileSystem | PluginFiles | ServerPlatform
  > = buildOutputLayer;
}

// =============================================================================
// Plugin
// =============================================================================

/**
 * trygg Vite plugin
 *
 * Provides:
 * - JSX configuration for trygg
 * - File-based routing from app/routes/
 * - Root layout from app/layout.tsx
 * - API handling from app/api.ts
 * - Auto-generated entry point
 *
 * --- Effect Service Design (future refactor) ---
 *
 * The plugin could be modeled as an Effect Service for better testability
 * and composition. The mutable `let` bindings would become Ref state inside
 * a service scope:
 *
 * ```ts
 * class PluginConfig extends Context.Tag("PluginConfig")<PluginConfig, {
 *   readonly appDir: string
 *   readonly routesDir: string
 *   readonly generatedDir: string
 *   readonly viteConfig: ResolvedConfig
 * }>() {}
 *
 * class PluginService extends Context.Tag("PluginService")<PluginService, {
 *   readonly scanAndGenerate: Effect.Effect<void, PluginFileSystemError>
 *   readonly reload: Effect.Effect<void, ApiInitError>
 * }>() {}
 *
 * const PluginServiceLive = Layer.effect(PluginService,
 *   Effect.gen(function* () {
 *     const config = yield* PluginConfig
 *     const fs = yield* FileSystem.FileSystem
 *     // ... build service methods using config and fs
 *     return { scanAndGenerate: ..., reload: ... }
 *   })
 * )
 *
 * // Plugin factory becomes a thin wrapper:
 * export const trygg = (): Plugin => {
 *   const runtime = Effect.runSync(
 *     Layer.toRuntime(Layer.mergeAll(PluginServiceLive, PluginLayer))
 *   )
 *   return { name: "trygg", configureServer: (server) => ... }
 * }
 * ```
 *
 * Benefits: testable without Vite, composable layers, no mutable state.
 * Deferred until plugin API stabilizes.
 *
 * @since 1.0.0
 */
/**
 * Plugin options for trygg.
 *
 * @remarks
 * `TryggOptions` reuses the `trygg/config` contract so Vite setup and app
 * configuration stay aligned.
 *
 * @example
 * ```ts
 * const options: TryggOptions = { platform: "node", output: "server" }
 * ```
 *
 * @category Vite Plugin
 * @public
 * @since 1.0.0
 */
export interface TryggOptions extends TryggConfig {}

/**
 * Public plugin type deliberately avoids direct `vite` type coupling.
 *
 * @remarks
 * This shape prevents cross-install type identity conflicts when trygg and the
 * app resolve `vite` from different paths.
 *
 * @example
 * ```ts
 * const plugin: TryggPlugin = trygg()
 * ```
 *
 * @category Vite Plugin
 * @public
 * @since 1.0.0
 */
export interface TryggPlugin {
  readonly name: string;
  readonly [key: string]: unknown;
}

interface PreviewRequestLike {
  method?: string;
  url?: string;
}

interface PreviewServerLike {
  readonly middlewares: {
    use: (handler: (req: PreviewRequestLike, _res: unknown, next: () => void) => void) => void;
  };
}

/**
 * Minimal Vite dev server surface consumed by the internal adapter.
 *
 * @remarks
 * Keeps direct `ViteDevServer` coupling at the plugin hook boundary while tests
 * exercise the adapter through a structural source.
 *
 * @internal
 * @category Vite Plugin
 * @since 1.0.0
 */
export interface ViteServerSource {
  readonly ssrLoadModule: (id: string) => Promise<Record<string, unknown>>;
  readonly watcher: {
    readonly on: (event: "change", handler: (file: string) => void) => void;
    readonly off?: ((event: "change", handler: (file: string) => void) => void) | undefined;
  };
  readonly httpServer?:
    | {
        readonly on: (event: "close", handler: () => void) => unknown;
      }
    | null
    | undefined;
  readonly middlewares: {
    readonly use: (middleware: Connect.NextHandleFunction) => void;
  };
  readonly transformIndexHtml: (url: string, html: string) => Promise<string>;
}

/**
 * Named adapter operations for Vite dev server effects.
 *
 * @remarks
 * API mount and close cleanup use explicit operations so lifecycle ownership is
 * isolated from the rest of `configureServer`.
 *
 * @internal
 * @category Vite Plugin
 * @since 1.0.0
 */
export interface ViteServer {
  readonly loadModule: (
    id: string,
    message: string,
  ) => Effect.Effect<Record<string, unknown>, ApiInitError>;
  readonly onFileChange: <E, R>(
    handler: (file: string) => Effect.Effect<void, E, R>,
    report: (cause: Cause.Cause<E>) => Effect.Effect<void>,
  ) => Effect.Effect<void, never, R | Scope.Scope>;
  readonly mountApiMiddleware: (middleware: Connect.NextHandleFunction) => Effect.Effect<void>;
  readonly useMiddleware: (middleware: Connect.NextHandleFunction) => Effect.Effect<void>;
  readonly transformIndexHtml: (
    url: string,
    html: string,
  ) => Effect.Effect<string, PluginFileSystemError>;
  readonly mountHtmlFallbackMiddleware: (html: string) => Effect.Effect<void, never, Scope.Scope>;
}

const isDevApiError = (error: unknown): error is DevApiErrors =>
  Predicate.isTagged(error, "ApiInitError") || Predicate.isTagged(error, "ImportError");

const allDevApiFailures = (
  cause: Cause.Cause<DevApiErrors>,
): ReadonlyArray<DevApiErrors> | undefined => {
  const failures = cause.reasons.filter(Cause.isFailReason);
  if (failures.length === 0 || failures.length !== cause.reasons.length) return undefined;
  const errors = failures.map(({ error }) => error);
  return errors.every(isDevApiError) ? errors : undefined;
};

export namespace PluginApi {
  export type InitialState = Data.TaggedEnum<{
    readonly Absent: { readonly apiPath: string };
    readonly Loading: { readonly apiPath: string };
    readonly Ready: {
      readonly apiPath: string;
      readonly handle: DevApiHandle;
      readonly scope: Scope.Closeable;
    };
    readonly Reloading: {
      readonly apiPath: string;
      readonly handle: DevApiHandle;
      readonly scope: Scope.Closeable;
    };
    readonly Failed: {
      readonly apiPath: string;
      readonly error: ImportError | ApiInitError;
    };
  }>;

  export const InitialState = Data.taggedEnum<InitialState>();

  export type Absent = Extract<InitialState, { readonly _tag: "Absent" }>;
  export type Loading = Extract<InitialState, { readonly _tag: "Loading" }>;
  export type Ready = Extract<InitialState, { readonly _tag: "Ready" }>;
  export type Reloading = Extract<InitialState, { readonly _tag: "Reloading" }>;
  export type Failed = Extract<InitialState, { readonly _tag: "Failed" }>;

  /**
   * Active dev API facade owned by the plugin layer.
   *
   * @remarks
   * Keeps api.ts change handling beside the active dev API handle so Vite watcher
   * code delegates reload requests instead of knowing reload semantics directly.
   *
   * @internal
   * @category Vite Plugin
   * @since 1.0.0
   */
  export interface Active {
    readonly middleware: Connect.NextHandleFunction;
    readonly reloadChangedFile: (file: string) => Effect.Effect<void>;
  }

  type ReloadState = Data.TaggedEnum<{
    readonly Idle: {};
    readonly Running: {
      readonly followUp: boolean;
      readonly done: Deferred.Deferred<void, DevApiErrors>;
      readonly owner: Fiber.Fiber<void, DevApiErrors>;
    };
  }>;

  const ReloadState = Data.taggedEnum<ReloadState>();

  const reloadIdle = ReloadState.Idle();

  export interface InitialLoadOptions<RHasApi> {
    readonly apiPath: string;
    readonly hasApi: Effect.Effect<boolean, PluginFileSystemError, RHasApi>;
    readonly loadHandlerFactory: Effect.Effect<HandlerFactory, ApiInitError>;
    readonly makeApi: (
      handlerFactory: HandlerFactory,
    ) => Effect.Effect<DevApiHandle, ImportError | ApiInitError, Scope.Scope>;
    readonly ownerScope?: Scope.Scope | undefined;
    readonly observe?: (state: InitialState) => Effect.Effect<void>;
  }

  const observe = <RHasApi>(
    options: InitialLoadOptions<RHasApi>,
    state: InitialState,
  ): Effect.Effect<void> => options.observe?.(state) ?? Effect.void;

  const coalesceReload: <RHasApi>(
    options: InitialLoadOptions<RHasApi>,
    reload: DevApiHandle["reload"],
    getReady: () => Ready,
    ownerScope: Scope.Scope,
  ) => Effect.Effect<DevApiHandle["reload"]> = Effect.fn("PluginApi.coalesceReload")(function* <
    RHasApi,
  >(
    options: InitialLoadOptions<RHasApi>,
    reload: DevApiHandle["reload"],
    getReady: () => Ready,
    ownerScope: Scope.Scope,
  ) {
    const reloadState = yield* SynchronizedRef.make<ReloadState>(reloadIdle);

    const takeFollowUp = (done: Deferred.Deferred<void, DevApiErrors>): Effect.Effect<boolean> =>
      SynchronizedRef.modifyEffect(reloadState, (state) => {
        if (ReloadState.$is("Running")(state) && state.done === done && state.followUp) {
          const next = ReloadState.Running({
            followUp: false,
            done: state.done,
            owner: state.owner,
          });
          const result: readonly [boolean, ReloadState] = [true, next];
          return Effect.succeed(result);
        }

        const result: readonly [boolean, ReloadState] = [false, state];
        return Effect.succeed(result);
      });

    const settleReload = (
      done: Deferred.Deferred<void, DevApiErrors>,
      exit: Exit.Exit<void, DevApiErrors>,
    ): Effect.Effect<void> =>
      SynchronizedRef.modifyEffect(reloadState, (state) => {
        const next = ReloadState.$is("Running")(state) && state.done === done ? reloadIdle : state;
        const result: readonly [void, ReloadState] = [undefined, next];
        return Deferred.done(done, exit).pipe(Effect.as(result));
      });

    const runReload = (
      done: Deferred.Deferred<void, DevApiErrors>,
    ): Effect.Effect<void, DevApiErrors> =>
      Effect.uninterruptibleMask((restore) => {
        const loop: () => Effect.Effect<void, DevApiErrors> = Effect.fnUntraced(function* () {
          const ready = getReady();
          const reloading = InitialState.Reloading({
            apiPath: ready.apiPath,
            handle: ready.handle,
            scope: ready.scope,
          });
          const exit = yield* restore(
            observe(options, reloading).pipe(Effect.andThen(reload)),
          ).pipe(Effect.exit);
          if (Exit.isFailure(exit)) {
            const failures = allDevApiFailures(exit.cause);
            if (failures === undefined) {
              return yield* Effect.failCause(exit.cause);
            }

            const error = failures[0];
            if (error === undefined) {
              return yield* Effect.failCause(exit.cause);
            }
            yield* restore(
              observe(options, InitialState.Failed({ apiPath: ready.apiPath, error })),
            );
            if (yield* takeFollowUp(done)) return yield* loop();
            return yield* Effect.failCause(exit.cause);
          }

          if (yield* takeFollowUp(done)) return yield* loop();
          yield* restore(observe(options, ready));
        });

        return loop().pipe(Effect.onExit((exit) => settleReload(done, exit)));
      });

    return yield* Effect.succeed(
      Effect.uninterruptibleMask((restore) =>
        Effect.gen(function* () {
          const claim = yield* SynchronizedRef.modifyEffect(reloadState, (state) =>
            Effect.gen(function* () {
              if (ReloadState.$is("Running")(state)) {
                const next = ReloadState.Running({
                  done: state.done,
                  followUp: true,
                  owner: state.owner,
                });
                const result: readonly [
                  {
                    readonly done: Deferred.Deferred<void, DevApiErrors>;
                    readonly owner: Fiber.Fiber<void, DevApiErrors>;
                  },
                  ReloadState,
                ] = [{ done: state.done, owner: state.owner }, next];
                return result;
              }

              const done = yield* Deferred.make<void, DevApiErrors>();
              const owner = yield* Effect.forkIn(runReload(done), ownerScope);
              const next = ReloadState.Running({ followUp: false, done, owner });
              const result: readonly [
                {
                  readonly done: Deferred.Deferred<void, DevApiErrors>;
                  readonly owner: Fiber.Fiber<void, DevApiErrors>;
                },
                ReloadState,
              ] = [{ done, owner }, next];
              return result;
            }),
          );

          const ownerExit = claim.owner.pollUnsafe();
          if (ownerExit !== undefined) {
            yield* settleReload(claim.done, ownerExit);
          }
          return yield* restore(Deferred.await(claim.done));
        }),
      ).pipe(Effect.withSpan("PluginApi.reloadApi")),
    );
  });

  export const loadInitial: <RHasApi>(
    options: InitialLoadOptions<RHasApi>,
  ) => Effect.Effect<Absent | Ready | Failed, PluginFileSystemError, RHasApi> = Effect.fn(
    "PluginApi.loadInitial",
  )(function* <RHasApi>(options: InitialLoadOptions<RHasApi>) {
    const hasApi = yield* options.hasApi;
    if (!hasApi) {
      const state = InitialState.Absent({ apiPath: options.apiPath });
      yield* observe(options, state);
      return state;
    }

    const loading = InitialState.Loading({ apiPath: options.apiPath });
    yield* observe(options, loading);
    const scope =
      options.ownerScope === undefined
        ? yield* Scope.make()
        : yield* Scope.fork(options.ownerScope);

    return yield* Effect.gen(function* () {
      const handlerFactory = yield* options.loadHandlerFactory;
      const handle = yield* Scope.provide(options.makeApi(handlerFactory), scope);
      const initialReady = InitialState.Ready({
        apiPath: options.apiPath,
        handle,
        scope,
      });
      let readyState = initialReady;
      const reload = yield* coalesceReload(options, handle.reload, () => readyState, scope);
      const readyHandle: DevApiHandle = { ...handle, reload };
      const ready = InitialState.Ready({
        apiPath: initialReady.apiPath,
        handle: readyHandle,
        scope: initialReady.scope,
      });
      readyState = ready;
      yield* observe(options, ready);
      return ready;
    }).pipe(
      Effect.onExit((exit) => (Exit.isFailure(exit) ? Scope.close(scope, exit) : Effect.void)),
      Effect.catchCause((cause) => {
        const failures = allDevApiFailures(cause);
        const error = failures?.[0];
        if (error === undefined) {
          return Effect.failCause(unsafeAsUnrecoverableCause(cause));
        }
        return Effect.gen(function* () {
          const failed = InitialState.Failed({ apiPath: options.apiPath, error });
          yield* observe(options, failed);
          return failed;
        });
      }),
    );
  });

  export const closeInitial = (state: InitialState): Effect.Effect<void> =>
    InitialState.$is("Ready")(state) ? Scope.close(state.scope, Exit.void) : Effect.void;
}

const devApiErrorTag = (error: DevApiErrors): DevApiErrors["_tag"] =>
  Predicate.isTagged(error, "ApiInitError") ? "ApiInitError" : "ImportError";

const logPluginApiReloadError = (error: DevApiErrors): Effect.Effect<void> =>
  Effect.logError(`[api] reload.failed: ${Cause.pretty(Cause.fail(error))}`).pipe(
    Effect.annotateLogs("error_tag", devApiErrorTag(error)),
  );

/**
 * Create a plugin-owned facade for an active dev API handle.
 *
 * @remarks
 * The facade preserves existing dev reload behavior: one api.ts change requests
 * one scoped handle reload, successful reloads log debug output, and typed reload
 * failures are logged without failing unrelated watcher work.
 *
 * @internal
 * @category Vite Plugin
 * @since 1.0.0
 */
export namespace PluginApi {
  export const make = (handle: DevApiHandle): Active => ({
    middleware: handle.middleware,
    reloadChangedFile: (file) => {
      if (!file.endsWith("api.ts")) {
        return Effect.void;
      }

      return handle.reload.pipe(
        Effect.tap(() => Effect.logDebug("Reloaded API handlers")),
        Effect.catchCause((cause) => {
          const failures = allDevApiFailures(cause);
          if (failures === undefined) {
            return Effect.failCause(unsafeAsUnrecoverableCause(cause));
          }
          return Effect.forEach(failures, logPluginApiReloadError, { discard: true });
        }),
      );
    },
  });
}

/**
 * Recover an expected pre-commit HTML transform failure by delegating to Vite.
 *
 * @remarks
 * Delegation is valid only when every Cause reason is a typed transform failure.
 * Defects, interruptions, mixed Causes, and failures from other operations are
 * preserved for the server-owned terminal reporter.
 *
 * @internal
 * @category Vite Plugin
 * @since 1.0.0
 */
export const transformHtmlForFallback = (
  transform: Effect.Effect<string, PluginFileSystemError>,
  next: () => void,
): Effect.Effect<Option.Option<string>, PluginFileSystemError> =>
  transform.pipe(
    Effect.map(Option.some),
    Effect.catchCause((cause) => {
      const failures = cause.reasons.filter(Cause.isFailReason);
      const expected =
        failures.length > 0 &&
        failures.length === cause.reasons.length &&
        failures.every(
          ({ error }) =>
            Predicate.isTagged(error, "PluginFileSystemError") && error.operation === "transform",
        );
      return expected
        ? Effect.sync(next).pipe(Effect.as(Option.none<string>()))
        : Effect.failCause(cause);
    }),
  );

/**
 * Build the short-lived Vite server adapter for dev-server hooks.
 *
 * @remarks
 * The adapter is created per Vite server configuration and should not outlive
 * that server instance.
 *
 * @internal
 * @category Vite Plugin
 * @since 1.0.0
 */
export namespace ViteServer {
  export const make = (
    server: ViteServerSource,
    reportCause: (cause: Cause.Cause<unknown>) => Effect.Effect<void> = (cause) =>
      Effect.logError(`[vite] callback.failed: ${Cause.pretty(cause)}`),
  ): ViteServer => {
    const reportSafely = <E>(
      report: (cause: Cause.Cause<E>) => Effect.Effect<void>,
      cause: Cause.Cause<E>,
    ): Effect.Effect<void> => report(cause).pipe(Effect.catchCause(() => Effect.void));

    const transformIndexHtml: ViteServer["transformIndexHtml"] = (url, html) =>
      Effect.tryPromise({
        try: () => server.transformIndexHtml(url, html),
        catch: (cause) =>
          new PluginFileSystemError({
            operation: "transform",
            path: "bootstrap-shell",
            cause,
          }),
      });

    const onFileChange: ViteServer["onFileChange"] = Effect.fn("ViteServer.onFileChange")(
      function* <E, R>(
        handler: (file: string) => Effect.Effect<void, E, R>,
        report: (cause: Cause.Cause<E>) => Effect.Effect<void>,
      ) {
        const runFork = yield* CallbackRuntime.make<R>();
        const listener = (file: string): void => {
          runFork(
            Effect.suspend(() => handler(file)).pipe(
              Effect.onExit((exit) =>
                Exit.isFailure(exit) ? reportSafely(report, exit.cause) : Effect.void,
              ),
            ),
          );
        };
        yield* Effect.acquireRelease(
          Effect.sync(() => server.watcher.on("change", listener)),
          () => Effect.sync(() => server.watcher.off?.("change", listener)),
        );
      },
    );

    return {
      loadModule: (id, message) =>
        Effect.tryPromise({
          try: () => server.ssrLoadModule(id),
          catch: (cause) => new ApiInitError({ message, cause }),
        }),
      onFileChange,
      mountApiMiddleware: (middleware) => Effect.sync(() => server.middlewares.use(middleware)),
      useMiddleware: (middleware) => Effect.sync(() => server.middlewares.use(middleware)),
      transformIndexHtml,
      mountHtmlFallbackMiddleware: (htmlTemplate) =>
        Effect.gen(function* () {
          const runFork = yield* CallbackRuntime.make();
          yield* Effect.sync(() =>
            server.middlewares.use((req, res, next) => {
              if (
                !req.url ||
                req.url.includes(".") ||
                req.method !== "GET" ||
                req.url.startsWith("/api/")
              ) {
                return next();
              }

              const requestUrl = req.url;
              const effect = Effect.gen(function* () {
                const transformed = yield* transformHtmlForFallback(
                  transformIndexHtml(requestUrl, htmlTemplate),
                  next,
                );
                if (Option.isNone(transformed)) {
                  return;
                }
                res.statusCode = 200;
                res.setHeader("Content-Type", "text/html");
                res.end(transformed.value);
              }).pipe(
                Effect.onExit((exit) =>
                  Exit.isFailure(exit) ? reportSafely(reportCause, exit.cause) : Effect.void,
                ),
              );

              runFork(effect);
            }),
          );
        }),
    };
  };
}

const loadHandlerFactory: (viteServer: ViteServer) => Effect.Effect<HandlerFactory, ApiInitError> =
  Effect.fn("VitePlugin.loadHandlerFactory")(function* (viteServer: ViteServer) {
    // SSR-load handler factory — resolves @effect/platform from project root,
    // same module instance as user's api.ts, preventing Router.Live identity mismatches.
    const rawFactoryMod = yield* viteServer.loadModule(
      VIRTUAL_HANDLER_FACTORY_ID,
      "Failed to SSR-load handler factory",
    );
    if (
      typeof rawFactoryMod.makeApiLayer !== "function" ||
      typeof rawFactoryMod.makeWebHandler !== "function"
    ) {
      return yield* new ApiInitError({
        message: "Handler factory module missing required exports (makeApiLayer, makeWebHandler)",
      });
    }
    const makeApiLayer = rawFactoryMod.makeApiLayer;
    const makeWebHandler = rawFactoryMod.makeWebHandler;
    const baseFactoryMod: HandlerFactory = {
      makeApiLayer: (mod: Record<string, unknown>) => makeApiLayer(mod),
      makeWebHandler: (apiLive: Layer.Layer<unknown>) => makeWebHandler(apiLive),
    };
    if (typeof rawFactoryMod.makeNodeHandler !== "function") {
      return baseFactoryMod;
    }
    const makeNodeHandler = rawFactoryMod.makeNodeHandler;
    return {
      ...baseFactoryMod,
      makeNodeHandler: (apiLive: Layer.Layer<unknown>) => makeNodeHandler(apiLive),
    };
  });

/**
 * Memoize the dev API handler factory load for one plugin lifecycle.
 *
 * @remarks
 * The handler factory is framework-owned and stable; API reloads should reuse it
 * so Vite only reloads user API modules after bootstrap.
 *
 * @internal
 * @category Vite Plugin
 * @since 1.0.0
 */
export namespace HandlerFactoryLoader {
  export const make = (
    load: Effect.Effect<HandlerFactory, ApiInitError>,
  ): Effect.Effect<HandlerFactory, ApiInitError> => Effect.runSync(Effect.cached(load));
}

/**
 * Configure trygg's JSX, generated routes, build output, and dev API lifecycle
 * with one Vite plugin.
 *
 * @remarks
 * Configuration is decoded when the plugin is created. If `app/api.ts` exists,
 * dev setup waits for a usable handler before reporting readiness; reloads keep
 * the last healthy handler until a replacement is ready. Vite shutdown awaits
 * plugin-owned watcher, API, and request cleanup.
 *
 * @example
 * ```ts
 * import { defineConfig } from "vite";
 * import { trygg } from "trygg/vite-plugin";
 *
 * export default defineConfig({
 *   plugins: [trygg({ platform: "node", output: "server" })],
 * });
 * ```
 *
 * @param tryggConfig - Production platform and output mode. Defaults to Node server output.
 * @returns The configured Vite plugin.
 * @see ./plugin.docs.md - Source-owned Vite plugin guide
 * @category Vite Plugin
 * @public
 * @since 1.0.0
 */
export const trygg = (tryggConfig?: TryggConfig): TryggPlugin => {
  const decodedConfig = defineConfig(tryggConfig ?? { platform: "node", output: "server" });
  const configPlatform = decodedConfig.platform;
  const output = decodedConfig.output;

  // Dev server always runs in Node.js (Vite), so use node platform for dev
  // regardless of config platform which is for production runtime
  const devPlatform = typeof Bun === "undefined" ? "node" : configPlatform;

  // Create platform-specific plugin layer for dev server
  const pluginLayer = makePluginLayer(devPlatform, configPlatform);
  const pluginRuntime = ManagedRuntime.make(
    Layer.mergeAll(
      pluginLayer,
      Bootstrap.layer({
        appDirName: APP_DIR,
        generatedDirName: GENERATED_DIR,
        platform: configPlatform,
        output,
      }),
    ),
  );
  const lifecycleScope = Scope.makeUnsafe("sequential");
  interface DevServerOwner {
    readonly scope: Scope.Closeable;
    legacyClaimed: boolean;
    closePromise?: Promise<void> | undefined;
  }

  const environmentOwners = new WeakMap<object, DevServerOwner>();
  const serverOwners: Array<DevServerOwner> = [];
  let latestServerOwner: DevServerOwner | undefined;
  let shutdownPromise: Promise<void> | undefined;
  let buildClosePromise: Promise<void> | undefined;
  const shutdown = (): Promise<void> => {
    shutdownPromise ??= Effect.runPromise(
      Scope.close(lifecycleScope, Exit.void).pipe(Effect.ensuring(pluginRuntime.disposeEffect)),
    );
    return shutdownPromise;
  };
  const closeServerOwner = (owner: DevServerOwner): Promise<void> => {
    owner.closePromise ??= Effect.runPromise(Scope.close(owner.scope, Exit.void));
    return owner.closePromise;
  };
  const claimLegacyServerOwner = (): DevServerOwner | undefined => {
    const owner = serverOwners.find((candidate) => !candidate.legacyClaimed);
    if (owner !== undefined) owner.legacyClaimed = true;
    return owner;
  };

  const plugin = {
    name: "trygg",
    enforce: "pre",

    // For static output, only apply to the client environment.
    // Multi-environment builds (e.g. alchemy's Cloudflare.Worker) create
    // an SSR environment whose rollupOptions.input must not be an HTML file.
    applyToEnvironment(environment: { readonly name: string }) {
      if (output === "static") return environment.name === "client";
      return true;
    },

    config(userConfig: unknown, env: { readonly command: string }) {
      /*
       * The SSR build environment receives this config from the plugin's config hook.
       * `applyToEnvironment` above prevents the plugin from running hooks in the SSR
       * environment, but the resolved config values (e.g. build.rollupOptions.input)
       * are already baked in during the shared resolution phase.  Because Vite will
       * fall back to `resolve("index.html")` whenever no input is present, and that
       * file likely doesn't exist in a typical trygg project, we avoid the fallback
       * by providing an explicit non-HTML input for SSR builds.  The value itself is
       * irrelevant since the Worker entry is produced by the Cloudflare plugin; this
       * merely silences Vite's HTML-in-SSR guard.
       */

      return {
        appType: "custom",
        esbuild: {
          jsx: "automatic",
          jsxImportSource: "trygg",
        },
        optimizeDeps: {
          esbuildOptions: {
            jsx: "automatic",
            jsxImportSource: "trygg",
          },
        },
        // Ensure effect packages are externalized in SSR so that both the
        // bundled plugin code and user modules loaded via ssrLoadModule
        // resolve to the same module instances. Without this, Layer
        // memoization fails across module boundaries (e.g. Router.Live).
        ssr: {
          external: [
            "effect",
            "effect/unstable/http",
            "effect/unstable/httpapi",
            "@effect/platform-node",
            "@effect/platform-bun",
            "@effect/platform-browser",
          ],
        },
        build: {
          outDir: output === "server" ? "dist/client" : "dist",
          rollupOptions:
            env.command === "build"
              ? {
                  input: `${GENERATED_DIR}/index.html`,
                  onwarn: makeRollupOnwarn(getUserRollupOnwarn(userConfig)),
                }
              : {},
        },
      };
    },

    configEnvironment(name: string, _config: unknown, env: { readonly command: string }) {
      if (env.command !== "build") return;
      if (name === "client") {
        return {
          build: {
            rollupOptions: { input: { index: `${GENERATED_DIR}/index.html` } },
          },
        };
      }
      if (configPlatform !== "cloudflare" || output !== "static") {
        return;
      }
      // For the SSR environment, provide a non-HTML file as input so Vite's
      // SSR guard does not trigger when Cloudflare runs a Worker build.
      return {
        build: {
          rollupOptions: { input: `${GENERATED_DIR}/worker-entry.js` },
        },
      };
    },

    async configResolved(resolvedConfig: ResolvedConfig) {
      await pluginRuntime.runPromise(
        Effect.flatMap(Effect.service(Bootstrap), (bootstrap) =>
          bootstrap
            .initialize(resolvedConfig)
            .pipe(
              Effect.tapError((error) =>
                Predicate.isTagged(error, "PluginFileSystemError")
                  ? logFileSystemError(error)
                  : Effect.void,
              ),
            ),
        ),
      );
    },

    async configureServer(server: ViteDevServer) {
      const serverScope = Scope.forkUnsafe(lifecycleScope, "sequential");
      const serverOwner: DevServerOwner = { scope: serverScope, legacyClaimed: false };
      serverOwners.push(serverOwner);
      latestServerOwner = serverOwner;
      for (const environment of Object.values(server.environments ?? {})) {
        environmentOwners.set(environment, serverOwner);
      }
      const viteServer = ViteServer.make(server);
      server.httpServer?.once("close", () => {
        closeServerOwner(serverOwner).then(
          () => undefined,
          () => undefined,
        );
      });
      const effect = Effect.gen(function* () {
        const runPostHook = yield* CallbackRuntime.make<Scope.Scope>();
        const bootstrap = yield* Bootstrap;
        const { appDir, generatedDir } = yield* bootstrap.awaitReady;
        const paths = { appDir, generatedDir };
        const files = yield* PluginFiles;

        // Get DevPlatform service
        const devPlatform = yield* DevPlatform;

        const apiPath = files.appApiPath(paths);

        // Validate API imports
        yield* validateApiPlatform(apiPath, configPlatform).pipe(
          Effect.tapError(logApiValidationError),
        );

        yield* files.writeGeneratedRouteTypes(paths);
        yield* files.writeEntryFile(paths);
        yield* writeGeneratedApiClientTypes(appDir, generatedDir);

        yield* Effect.logInfo(`Generated files in ${GENERATED_DIR}/`).pipe(
          Effect.annotateLogs("style", "success"),
        );

        const stableHandlerFactory = HandlerFactoryLoader.make(loadHandlerFactory(viteServer));
        const apiState = yield* PluginApi.loadInitial({
          apiPath,
          hasApi: pathExists(apiPath),
          loadHandlerFactory: stableHandlerFactory,
          makeApi: (handlerFactory) =>
            devPlatform.makeApi({
              loadApiModule: () => viteServer.loadModule(apiPath, "Failed to load API module"),
              onError: (error) =>
                Effect.logError(`[api] middleware.error: ${Cause.pretty(Cause.fail(error))}`),
              handlerFactory,
            }),
          ownerScope: serverScope,
        });

        const pluginApi = PluginApi.InitialState.$is("Ready")(apiState)
          ? PluginApi.make(apiState.handle)
          : undefined;

        if (PluginApi.InitialState.$is("Ready")(apiState)) {
          yield* Effect.logInfo("API handlers loaded").pipe(
            Effect.annotateLogs("style", "success"),
          );
          yield* Trace.emit("api.middleware.mounted", () => ({
            platform: configPlatform,
          }));
        }

        if (PluginApi.InitialState.$is("Failed")(apiState)) {
          return yield* apiState.error;
        }

        yield* viteServer.onFileChange(
          (file) =>
            Effect.gen(function* () {
              const isRoutesFile = yield* files.isRoutesFile(paths, file);
              if (isRoutesFile) {
                yield* files.regenerateGeneratedRouteTypes(paths);
              }

              if (pluginApi !== undefined) {
                yield* writeGeneratedApiClientTypes(appDir, generatedDir);
                yield* pluginApi.reloadChangedFile(file);
              }
            }),
          (cause) => Effect.logError(`[watcher] change.failed: ${Cause.pretty(cause)}`),
        );

        if (pluginApi !== undefined) {
          yield* viteServer.mountApiMiddleware(pluginApi.middleware);
        }

        return (): void => {
          runPostHook(
            viteServer.mountHtmlFallbackMiddleware(generateHtmlTemplate()).pipe(
              Effect.catchCause((cause) =>
                Effect.logError(`[vite] post-hook.failed: ${Cause.pretty(cause)}`).pipe(
                  Effect.catchCause(() => Effect.void),
                  Effect.andThen(Effect.failCause(cause)),
                ),
              ),
            ),
          );
        };
      });

      return await pluginRuntime.runPromise(
        Scope.provide(effect, serverScope).pipe(
          Effect.onExit((exit) =>
            Exit.isFailure(exit) ? Scope.close(serverScope, exit) : Effect.void,
          ),
        ),
      );
    },

    configurePreviewServer(server: PreviewServerLike) {
      // `vite preview` is a static file server (sirv). When output is
      // "server", the production artifact is `dist/server.js` which handles
      // static files, API routes, and SPA fallback in one process. Warn
      // users that `vite preview` cannot serve API routes.
      if (output === "server") {
        const runtime = configPlatform === "bun" ? "bun" : "node";
        console.warn(
          `\n  trygg: output is "server" — use \`${runtime} dist/server.js\` for production preview with API support.` +
            "\n  `vite preview` serves static files only. API routes will 404.\n",
        );
      }

      // Pre-hook (no return): runs BEFORE sirv. Rewrites non-file GET
      // requests to the SPA shell so sirv serves `.trygg/index.html`.
      // /api/* routes are NOT rewritten — they 404 via sirv. For API
      // support in production, run `dist/server.js` instead.
      server.middlewares.use((req, _res, next) => {
        if (
          req.method === "GET" &&
          req.url &&
          !req.url.includes(".") &&
          !req.url.startsWith("/api/")
        ) {
          req.url = "/.trygg/index.html";
        }
        next();
      });
    },

    resolveId(id: string) {
      if (id === VIRTUAL_HANDLER_FACTORY_ID) {
        return RESOLVED_HANDLER_FACTORY_ID;
      }
      if (id === VIRTUAL_API_ID) {
        return RESOLVED_API_ID;
      }
      if (id === "trygg/jsx-runtime" || id === "trygg/jsx-dev-runtime") {
        return null;
      }
      return null;
    },

    async load(id: string) {
      if (id === RESOLVED_HANDLER_FACTORY_ID) {
        return devPlatform === "node"
          ? HandlerFactoryModule.makeNode()
          : HandlerFactoryModule.makeBun();
      }
      if (id === RESOLVED_API_ID) {
        return await pluginRuntime.runPromise(
          Effect.gen(function* () {
            const bootstrap = yield* Bootstrap;
            const { appDir } = yield* bootstrap.awaitReady;
            const apiPath = nodePath.join(appDir, "api.ts");
            yield* validateGeneratedApiClient(apiPath);
            return generateApiClientModule(apiPath);
          }).pipe(
            Effect.mapError(
              // Rollup appends import context by assigning to `error.message`.
              (cause) =>
                new RollupPluginError({
                  message: Match.value(cause).pipe(
                    Match.tag("PluginValidationError", ({ description }) => description),
                    Match.tag("PluginBootstrapError", () => "Plugin bootstrap is not ready"),
                    Match.tag(
                      "PluginFileSystemError",
                      ({ operation, path }) => `Failed to ${operation} ${path}`,
                    ),
                    Match.exhaustive,
                  ),
                  cause,
                }),
            ),
          ),
        );
      }
      return null;
    },

    async transform(code: string, id: string) {
      const result = await pluginRuntime.runPromise(
        Effect.gen(function* () {
          const bootstrap = yield* Bootstrap;
          const { appDir, generatedDir, config } = yield* bootstrap.awaitReady;
          const files = yield* PluginFiles;
          const paths = { appDir, generatedDir };
          const isRoutesFile = yield* files.isRoutesFile(paths, id);

          let transformed = code;

          // Only transform the routes file in production builds
          if (isRoutesFile && config.command === "build") {
            transformed = yield* transformRoutesForBuild(transformed, id);
          }

          if (isTypeScriptJsxModule(id)) {
            const jsxResult = transformTryggJsxForRequirements(transformed, id);
            transformed = jsxResult.code;
          }

          return transformed;
        }),
      );
      return result !== code ? result : null;
    },

    async buildStart() {
      const effect = Effect.gen(function* () {
        const bootstrap = yield* Bootstrap;
        const { appDir, generatedDir, config } = yield* bootstrap.awaitReady;
        const buildOutput = yield* BuildOutput;

        yield* writeGeneratedApiClientTypes(appDir, generatedDir);

        yield* buildOutput.buildStart({
          appDir,
          generatedDir,
          config,
          output,
          platform: configPlatform,
        });
      });

      await pluginRuntime.runPromise(effect);
    },

    buildEnd(error?: Error) {
      if (error !== undefined) return buildClosePromise ?? shutdown();
    },

    closeBundle(this: { readonly environment?: object } | undefined) {
      const serverOwner =
        this?.environment === undefined
          ? claimLegacyServerOwner()
          : environmentOwners.get(this.environment);
      if (serverOwner !== undefined) {
        return serverOwner === latestServerOwner ? shutdown() : closeServerOwner(serverOwner);
      }

      if (buildClosePromise !== undefined) return buildClosePromise;
      if (shutdownPromise !== undefined) return shutdownPromise;
      const effect = Effect.gen(function* () {
        const bootstrap = yield* Bootstrap;
        const { config, appDir, generatedDir } = yield* bootstrap.awaitReady;
        const buildOutput = yield* BuildOutput;

        yield* buildOutput.closeBundle({
          appDir,
          generatedDir,
          config,
          output,
          platform: configPlatform,
        });
      });

      buildClosePromise = pluginRuntime.runPromise(effect).then(
        () => shutdown(),
        (cause) => shutdown().then(() => Effect.runPromise(Effect.fail(cause))),
      );
      return buildClosePromise;
    },
  };

  return plugin;
};

export default trygg;
