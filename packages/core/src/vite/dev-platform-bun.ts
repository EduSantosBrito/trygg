/**
 * @since 1.0.0
 * Bun implementation of DevPlatform service
 *
 * Uses dynamic imports to avoid hard dependencies on @effect/platform-bun
 * when running in Node mode.
 */
import { FileSystem, HttpApi, HttpApiBuilder, HttpApiGroup, HttpServer } from "@effect/platform";
import { Effect, Exit, Layer, Option, Ref, Runtime, Scope, Schema } from "effect";
import type { Connect } from "vite";
import type { IncomingMessage, ServerResponse } from "node:http";
import {
  DevPlatform,
  type DevPlatformService,
  type DevApiOptions,
  type DevApiHandle,
  ImportError,
  ApiInitError,
  ProxyError,
  type DevApiErrors,
} from "./dev-platform.js";

// =============================================================================
// Dynamic Imports
// =============================================================================

const importBunFileSystem = Effect.tryPromise({
  try: () => import("@effect/platform-bun/BunFileSystem"),
  catch: (cause) =>
    new ImportError({
      module: "@effect/platform-bun/BunFileSystem",
      message: "Failed to import BunFileSystem. Is @effect/platform-bun installed?",
      cause,
    }),
});

const importBunHttpServer = Effect.tryPromise({
  try: () => import("@effect/platform-bun/BunHttpServer"),
  catch: (cause) =>
    new ImportError({
      module: "@effect/platform-bun/BunHttpServer",
      message: "Failed to import BunHttpServer. Is @effect/platform-bun installed?",
      cause,
    }),
});

// =============================================================================
// HttpApi Detection
// =============================================================================

const HttpApiValueSchema = Schema.declare(
  (
    u: unknown,
  ): u is HttpApi.HttpApi<string, HttpApiGroup.HttpApiGroup.AnyWithProps, never, never> =>
    HttpApi.isHttpApi(u),
  { identifier: "HttpApiValue", description: "An HttpApi definition" },
);

const ComposedApiLayerSchema = Schema.declare(
  (u: unknown): u is Layer.Layer<HttpApi.Api> => Layer.isLayer(u),
  { identifier: "ComposedApiLayer", description: "A composed Layer providing HttpApi.Api" },
);

const detectApiLayer = (
  mod: Record<string, unknown>,
): Effect.Effect<Layer.Layer<HttpApi.Api>, ApiInitError> =>
  Effect.gen(function* () {
    const values = Object.values(mod);
    const httpApis = values.filter(HttpApi.isHttpApi);

    if (httpApis.length === 0) {
      return yield* new ApiInitError({
        message: "API module must export an HttpApi definition",
      });
    }

    if (httpApis.length > 1) {
      return yield* new ApiInitError({
        message: `API module must export exactly one HttpApi, found ${httpApis.length}`,
      });
    }

    const api = yield* Schema.decodeUnknown(HttpApiValueSchema)(httpApis[0]).pipe(
      Effect.mapError((cause) => new ApiInitError({ message: "Invalid HttpApi type", cause })),
    );

    const handlerLayers = values.filter(
      (v): v is Layer.Layer<unknown, unknown, unknown> => Layer.isLayer(v) && !HttpApi.isHttpApi(v),
    );

    const baseLayer = HttpApiBuilder.api(api);
    const composed = handlerLayers.reduce<Layer.Layer<never, unknown, unknown>>(
      (acc, layer) => Layer.provide(acc, layer),
      baseLayer,
    );

    return yield* Schema.decodeUnknown(ComposedApiLayerSchema)(composed).pipe(
      Effect.mapError(
        (cause) => new ApiInitError({ message: "Failed to compose API layer", cause }),
      ),
    );
  });

// =============================================================================
// Proxy Helpers
// =============================================================================

const readRequestBody = (req: IncomingMessage): Effect.Effect<Uint8Array, ProxyError> =>
  Effect.async((resume) => {
    const chunks: Array<Uint8Array> = [];

    req.on("data", (chunk: Uint8Array) => {
      chunks.push(chunk);
    });

    req.on("end", () => {
      const total = chunks.reduce((size, chunk) => size + chunk.length, 0);
      const buffer = new Uint8Array(total);
      let offset = 0;

      for (const chunk of chunks) {
        buffer.set(chunk, offset);
        offset += chunk.length;
      }

      resume(Effect.succeed(buffer));
    });

    req.on("error", (error) => {
      resume(
        Effect.fail(
          new ProxyError({
            message: "Failed to read request body",
            cause: error,
          }),
        ),
      );
    });
  });

const toHeaders = (headers: IncomingMessage["headers"]): Record<string, string> => {
  const result: Record<string, string> = {};
  for (const [key, value] of Object.entries(headers)) {
    if (value === undefined) continue;
    if (typeof value === "string") {
      result[key] = value;
    } else {
      result[key] = value.join(",");
    }
  }
  return result;
};

const streamResponseBody = (
  response: Response,
  res: ServerResponse,
): Effect.Effect<void, ProxyError> =>
  Effect.async((resume) => {
    if (!response.body) {
      res.end();
      resume(Effect.void);
      return;
    }

    const reader = response.body.getReader();

    const pump = (): void => {
      reader
        .read()
        .then(({ done, value }) => {
          if (done) {
            res.end();
            resume(Effect.void);
            return;
          }

          res.write(value, (error) => {
            if (error) {
              resume(
                Effect.fail(
                  new ProxyError({ message: "Failed to write response chunk", cause: error }),
                ),
              );
              return;
            }
            pump();
          });
        })
        .catch((error) => {
          resume(
            Effect.fail(new ProxyError({ message: "Failed to read response body", cause: error })),
          );
        });
    };

    pump();
  });

const proxyRequest = (
  targetUrl: string,
  method: string,
  headers: IncomingMessage["headers"],
  body: Option.Option<Uint8Array>,
  res: ServerResponse,
): Effect.Effect<void, ProxyError> =>
  Effect.gen(function* () {
    const fetchInit: RequestInit = {
      method,
      headers: toHeaders(headers),
    };

    if (Option.isSome(body)) {
      const safeBody = new Uint8Array(body.value.byteLength);
      safeBody.set(body.value);
      fetchInit.body = safeBody;
    }

    const response = yield* Effect.tryPromise({
      try: () => fetch(targetUrl, fetchInit),
      catch: (cause) =>
        new ProxyError({
          message: `Failed to proxy request to ${targetUrl}`,
          cause,
        }),
    });

    res.statusCode = response.status;
    response.headers.forEach((value, key) => {
      res.setHeader(key, value);
    });

    yield* streamResponseBody(response, res);
  });

// =============================================================================
// Bun DevPlatform Implementation
// =============================================================================

export const BunDevPlatformLive: Layer.Layer<DevPlatform | FileSystem.FileSystem, ImportError> =
  Layer.unwrapEffect(
    Effect.gen(function* () {
      const bunFs = yield* importBunFileSystem;
      const bunHttp = yield* importBunHttpServer;
      const fileSystemLayer: Layer.Layer<FileSystem.FileSystem> = bunFs.layer;

      const createDevApi = (
        options: DevApiOptions,
      ): Effect.Effect<DevApiHandle, DevApiErrors, Scope.Scope> =>
        Effect.gen(function* () {
          const scopeRef = yield* Ref.make<Option.Option<Scope.CloseableScope>>(Option.none());
          const baseUrlRef = yield* Ref.make("");

          const closeCurrentScope = Effect.gen(function* () {
            const current = yield* Ref.get(scopeRef);
            if (Option.isSome(current)) {
              yield* Scope.close(current.value, Exit.void);
            }
            yield* Ref.set(scopeRef, Option.none());
            yield* Ref.set(baseUrlRef, "");
          });

          const startServer = Effect.gen(function* () {
            const scope = yield* Scope.make();

            const apiModule = yield* options.loadApiModule();
            const apiLayer = yield* detectApiLayer(apiModule);

            const serverLayer = bunHttp.layer({ port: 0, hostname: "127.0.0.1" });
            const fullLayer = Layer.mergeAll(
              apiLayer,
              HttpApiBuilder.Router.Live,
              HttpApiBuilder.Middleware.layer,
              HttpServer.layerContext,
              serverLayer,
            );

            const runtime = yield* Layer.toRuntime(fullLayer).pipe(Scope.extend(scope));
            const httpApp = yield* Effect.provide(HttpApiBuilder.httpApp, runtime);

            yield* HttpServer.serveEffect(httpApp).pipe(
              Effect.provide(runtime),
              Scope.extend(scope),
            );

            const address = yield* HttpServer.addressWith((addr) => Effect.succeed(addr)).pipe(
              Effect.provide(runtime),
            );

            if (address._tag !== "TcpAddress") {
              yield* Scope.close(scope, Exit.void);
              return yield* new ApiInitError({
                message: "Expected TCP address for Bun HTTP server",
              });
            }

            const hostname = address.hostname === "0.0.0.0" ? "127.0.0.1" : address.hostname;
            const baseUrl = `http://${hostname}:${address.port}`;

            yield* Ref.set(scopeRef, Option.some(scope));
            yield* Ref.set(baseUrlRef, baseUrl);
          });

          yield* closeCurrentScope;
          yield* startServer;

          yield* Effect.addFinalizer(() => closeCurrentScope);

          const runtime = yield* Effect.runtime<never>();

          const middleware: Connect.NextHandleFunction = (req, res, next) => {
            if (!req.url?.startsWith("/api/")) {
              return next();
            }

            const effect = Effect.gen(function* () {
              const baseUrl = yield* Ref.get(baseUrlRef);
              if (baseUrl.length === 0) {
                res.statusCode = 503;
                res.end("API server not ready");
                return;
              }

              const method = req.method ?? "GET";
              const body =
                method === "GET" || method === "HEAD"
                  ? Option.none<Uint8Array>()
                  : Option.some(yield* readRequestBody(req));

              yield* proxyRequest(`${baseUrl}${req.url}`, method, req.headers, body, res);
            }).pipe(
              Effect.catchAll((error) =>
                Effect.gen(function* () {
                  yield* options.onError(error);
                  res.statusCode = 500;
                  res.end("Internal Server Error");
                }),
              ),
            );

            // Fork the effect into the parent scope to avoid floating effects
            Runtime.runFork(runtime)(effect.pipe(Effect.scoped));
          };

          return {
            middleware,
            reload: Effect.gen(function* () {
              yield* closeCurrentScope;
              yield* startServer;
            }),
            dispose: closeCurrentScope,
          };
        });

      const service: DevPlatformService = {
        fileSystemLayer,
        createDevApi,
      };

      return Layer.mergeAll(Layer.succeed(DevPlatform, service), fileSystemLayer);
    }),
  );
