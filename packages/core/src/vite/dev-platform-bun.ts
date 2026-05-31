/**
 * @since 1.0.0
 * Bun implementation of DevPlatform service
 *
 * Uses SSR-loaded handler factory for @effect/platform layer composition,
 * with web-standard Request/Response bridged to Node.js Connect middleware.
 *
 * Dynamic imports avoid hard dependencies on @effect/platform-bun
 * when running in Node mode.
 */
import { Effect, Exit, FileSystem, Layer, Match, Option, Ref, Schema, Scope } from "effect";
import type { IncomingMessage, ServerResponse } from "node:http";
import type { Connect } from "vite";
import {
  ApiInitError,
  type DevApiErrors,
  type DevApiHandle,
  type DevApiOptions,
  DevPlatform,
  type DevPlatformService,
  ImportError,
} from "./dev-platform.js";
import * as Trace from "../trace/index.js";

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

const ApiUnavailableBody = Schema.fromJsonString(
  Schema.Struct({
    error: Schema.String,
    message: Schema.String,
  }),
);
const encodeApiUnavailableBody = Schema.encodeEffect(ApiUnavailableBody);

// =============================================================================
// Node IncomingMessage → Web Request bridge
// =============================================================================

/**
 * Read the full body of a Node.js IncomingMessage as a Uint8Array.
 * Returns Option.none for bodyless methods.
 * @internal
 */
const getBody = (req: IncomingMessage): Effect.Effect<Option.Option<Uint8Array>, ApiInitError> =>
  Effect.callback((resume) => {
    const method = req.method ?? "GET";
    if (method === "GET" || method === "HEAD") {
      resume(Effect.succeed(Option.none()));
      return;
    }

    const chunks: Array<Uint8Array> = [];
    const onData = (chunk: Uint8Array): void => {
      chunks.push(chunk);
    };
    const onEnd = (): void => {
      const total = chunks.reduce((n, c) => n + c.length, 0);
      const buf = new Uint8Array(total);
      let offset = 0;
      for (const chunk of chunks) {
        buf.set(chunk, offset);
        offset += chunk.length;
      }
      resume(Effect.succeed(Option.some(buf)));
    };
    const onError = (cause: unknown): void => {
      resume(Effect.fail(new ApiInitError({ message: "Request body read failed", cause })));
    };
    req.on("data", onData);
    req.on("end", onEnd);
    req.on("error", onError);
    return Effect.sync(() => {
      req.off("data", onData);
      req.off("end", onEnd);
      req.off("error", onError);
    });
  });

/**
 * Convert Node.js IncomingMessage headers to a Headers object.
 * @internal
 */
const toWebHeaders = (nodeHeaders: IncomingMessage["headers"]): Headers => {
  const headers = new Headers();
  for (const [key, value] of Object.entries(nodeHeaders)) {
    if (value === undefined) continue;
    if (typeof value === "string") {
      headers.set(key, value);
    } else {
      headers.set(key, value.join(", "));
    }
  }
  return headers;
};

/**
 * Convert Node.js IncomingMessage to a web-standard Request.
 * @internal
 */
const fromNodeRequest: (req: IncomingMessage) => Effect.Effect<Request, ApiInitError> = Effect.fn(
  "BunDevPlatform.fromNodeRequest",
)(function* (req) {
  const protocol = "http";
  const host = req.headers.host ?? "localhost";
  const url = `${protocol}://${host}${req.url ?? "/"}`;
  const method = req.method ?? "GET";
  const headers = toWebHeaders(req.headers);
  const body = yield* getBody(req);

  const init: RequestInit = { method, headers };
  if (Option.isSome(body)) {
    const bytes = body.value;
    init.body = new ReadableStream({
      start(controller) {
        controller.enqueue(bytes);
        controller.close();
      },
    });
  }
  return yield* Effect.try({
    try: () => new Request(url, init),
    catch: (cause) => new ApiInitError({ message: "Failed to create web request", cause }),
  });
});

/**
 * Write a web-standard Response to a Node.js ServerResponse.
 * @internal
 */
const writeResponseChunk = (
  nodeRes: ServerResponse,
  value: Uint8Array,
): Effect.Effect<void, ApiInitError> =>
  Effect.callback((resume) => {
    nodeRes.write(value, (cause) => {
      if (cause !== undefined && cause !== null) {
        resume(Effect.fail(new ApiInitError({ message: "Failed to write response", cause })));
        return;
      }
      resume(Effect.void);
    });
  });

const toNodeResponse: (
  webRes: Response,
  nodeRes: ServerResponse,
) => Effect.Effect<void, ApiInitError> = Effect.fn("BunDevPlatform.toNodeResponse")(
  function* (webRes, nodeRes) {
    nodeRes.statusCode = webRes.status;
    webRes.headers.forEach((value, key) => {
      nodeRes.setHeader(key, value);
    });

    if (!webRes.body) {
      nodeRes.end();
      return;
    }

    const reader = webRes.body.getReader();
    let reading = true;
    while (reading) {
      const { done, value } = yield* Effect.tryPromise({
        try: () => reader.read(),
        catch: (cause) => new ApiInitError({ message: "Failed to read response body", cause }),
      });
      if (done) {
        reading = false;
      } else {
        yield* writeResponseChunk(nodeRes, value);
      }
    }
    nodeRes.end();
  },
);

// =============================================================================
// Internal State
// =============================================================================

interface HandlerState {
  readonly handler: Option.Option<(request: Request) => Promise<Response>>;
  readonly dispose: Option.Option<() => void>;
  readonly lastError: Option.Option<ApiInitError>;
}

const emptyState: HandlerState = {
  handler: Option.none(),
  dispose: Option.none(),
  lastError: Option.none(),
};

// =============================================================================
// Bun DevPlatform Implementation
// =============================================================================

export const BunDevPlatformLive: Layer.Layer<FileSystem.FileSystem | DevPlatform, ImportError> =
  Layer.unwrap(
    Effect.gen(function* () {
      const bunFs = yield* importBunFileSystem;
      const fileSystemLayer = bunFs.layer;

      const makeApi: (
        options: DevApiOptions,
      ) => Effect.Effect<DevApiHandle, DevApiErrors, Scope.Scope> = Effect.fn(
        "BunDevPlatform.makeApi",
      )(function* (options) {
        const context = yield* Effect.context<never>();
        const stateRef = yield* Ref.make<HandlerState>(emptyState);

        /** Dispose previous handler. */
        const disposeHandler = Effect.fn("BunDevPlatform.disposeHandler")(function* () {
          const { dispose } = yield* Ref.get(stateRef);
          if (Option.isSome(dispose)) {
            const disposeExit = yield* Effect.exit(
              Effect.try({
                try: () => dispose.value(),
                catch: (cause) =>
                  new ApiInitError({ message: "Failed to dispose previous handler", cause }),
              }),
            );
            if (Exit.isFailure(disposeExit)) {
              const error = new ApiInitError({ message: "Failed to dispose previous handler" });
              yield* Ref.set(stateRef, { ...emptyState, lastError: Option.some(error) });
              yield* options.onError(error);
            }
          }
          yield* Ref.set(stateRef, emptyState);
        });

        /** Build handler from API module using SSR-loaded factory. */
        const initHandler = Effect.fn("BunDevPlatform.initHandler")(function* () {
          yield* disposeHandler();

          yield* Trace.emit("api.handler.loading", () => ({ module_path: "app/api.ts" }));
          const mod = yield* options.loadApiModule().pipe(
            Effect.tapError((error) =>
              Effect.gen(function* () {
                yield* Ref.set(stateRef, { ...emptyState, lastError: Option.some(error) });
                yield* options.onError(error);
              }),
            ),
            Effect.option,
          );
          if (Option.isNone(mod)) return;

          yield* Trace.emit("api.handler.loaded", () => ({
            module_path: "app/api.ts",
            exports: Object.keys(mod.value),
          }));

          // Use SSR-loaded factory for layer detection and web handler creation
          const factory = options.handlerFactory;
          const apiLive = yield* factory.makeApiLayer(mod.value).pipe(
            Effect.mapError(
              (cause) => new ApiInitError({ message: "Failed to detect API layer", cause }),
            ),
            Effect.tapError((error) =>
              Effect.gen(function* () {
                yield* Ref.set(stateRef, { ...emptyState, lastError: Option.some(error) });
                yield* options.onError(error);
              }),
            ),
            Effect.option,
          );
          if (Option.isNone(apiLive)) return;

          const result = yield* Effect.try({
            try: () => factory.makeWebHandler(apiLive.value),
            catch: (cause) => new ApiInitError({ message: "Failed to create web handler", cause }),
          }).pipe(
            Effect.tapError((error) =>
              Effect.gen(function* () {
                yield* Ref.set(stateRef, { ...emptyState, lastError: Option.some(error) });
                yield* options.onError(error);
              }),
            ),
            Effect.option,
          );

          if (Option.isNone(result)) return;

          yield* Ref.set(stateRef, {
            handler: Option.some(result.value.handler),
            dispose: Option.some(result.value.dispose),
            lastError: Option.none(),
          });
        });

        yield* initHandler();
        yield* Effect.addFinalizer(() => disposeHandler());

        const middleware: Connect.NextHandleFunction = (req, res, next) => {
          if (!req.url?.startsWith("/api/")) {
            return next();
          }

          const effect = Effect.gen(function* () {
            yield* Trace.emit("api.request.received", () => ({
              method: req.method ?? "GET",
              url: req.url ?? "",
            }));

            const state = yield* Ref.get(stateRef);
            if (Option.isNone(state.handler)) {
              const errorMessage = Option.match(state.lastError, {
                onNone: () => "Check console for errors",
                onSome: (error) =>
                  Match.value(error).pipe(
                    Match.tag("ApiInitError", ({ message }) => message),
                    Match.exhaustive,
                  ),
              });
              yield* options.onError(new ApiInitError({ message: "Handler not available" }));
              const body = yield* encodeApiUnavailableBody({
                error: "API handler not available",
                message: errorMessage,
              }).pipe(
                Effect.mapError(
                  (cause) =>
                    new ApiInitError({ message: "Failed to encode error response", cause }),
                ),
              );
              res.statusCode = 500;
              res.setHeader("Content-Type", "application/json");
              res.end(body);
              return;
            }

            // Bridge: Node IncomingMessage → Web Request → handler → Web Response → Node ServerResponse
            const { value: handler } = state.handler;
            const webReq = yield* fromNodeRequest(req);
            const webRes = yield* Effect.tryPromise({
              try: () => handler(webReq),
              catch: (cause) => new ApiInitError({ message: "Request handling failed", cause }),
            });
            yield* toNodeResponse(webRes, res);
          }).pipe(
            Effect.catch((error: ApiInitError) =>
              Effect.gen(function* () {
                const message = Match.value(error).pipe(
                  Match.tag("ApiInitError", ({ message }) => message),
                  Match.exhaustive,
                );
                yield* Effect.logError(`[trygg] API handler failed: ${message}`);
                yield* options.onError(error);
                if (!res.headersSent) {
                  res.statusCode = 500;
                  res.end("Internal Server Error");
                }
              }),
            ),
          );

          Effect.runPromiseWith(context)(effect).catch((_error: unknown) => {
            if (!res.headersSent) {
              res.statusCode = 500;
              res.end("Internal Server Error");
            }
          });
        };

        return {
          middleware,
          reload: initHandler(),
          dispose: disposeHandler(),
        };
      });

      const service: DevPlatformService = {
        fileSystemLayer,
        makeApi,
      };

      return Layer.mergeAll(Layer.succeed(DevPlatform, service), fileSystemLayer);
    }),
  );
