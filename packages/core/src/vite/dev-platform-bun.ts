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
import { FileSystem } from "@effect/platform";
import { Effect, Layer, Option, Ref, Runtime, Schema, Scope } from "effect";
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

// =============================================================================
// Node IncomingMessage → Web Request bridge
// =============================================================================

/**
 * Read the full body of a Node.js IncomingMessage as a Uint8Array.
 * Returns Option.none for bodyless methods.
 * @internal
 */
const collectBody = (req: IncomingMessage): Promise<Option.Option<Uint8Array>> => {
  const method = req.method ?? "GET";
  if (method === "GET" || method === "HEAD") {
    return Promise.resolve(Option.none());
  }
  return new Promise((resolve, reject) => {
    const chunks: Array<Uint8Array> = [];
    req.on("data", (chunk: Uint8Array) => chunks.push(chunk));
    req.on("end", () => {
      const total = chunks.reduce((n, c) => n + c.length, 0);
      const buf = new Uint8Array(total);
      let offset = 0;
      for (const chunk of chunks) {
        buf.set(chunk, offset);
        offset += chunk.length;
      }
      resolve(Option.some(buf));
    });
    req.on("error", reject);
  });
};

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
const toWebRequest = async (req: IncomingMessage): Promise<Request> => {
  const protocol = "http";
  const host = req.headers.host ?? "localhost";
  const url = `${protocol}://${host}${req.url ?? "/"}`;
  const method = req.method ?? "GET";
  const headers = toWebHeaders(req.headers);
  const body = await collectBody(req);

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
  return new Request(url, init);
};

/**
 * Write a web-standard Response to a Node.js ServerResponse.
 * @internal
 */
const writeWebResponse = async (webRes: Response, nodeRes: ServerResponse): Promise<void> => {
  nodeRes.statusCode = webRes.status;
  webRes.headers.forEach((value, key) => {
    nodeRes.setHeader(key, value);
  });

  if (!webRes.body) {
    nodeRes.end();
    return;
  }

  const reader = webRes.body.getReader();
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    await new Promise<void>((resolve, reject) => {
      nodeRes.write(value, (err) => (err ? reject(err) : resolve()));
    });
  }
  nodeRes.end();
};

// =============================================================================
// Internal State
// =============================================================================

interface HandlerState {
  readonly handler: Option.Option<(request: Request) => Promise<Response>>;
  readonly dispose: Option.Option<() => void>;
  readonly lastError: Option.Option<unknown>;
}

const emptyState: HandlerState = {
  handler: Option.none(),
  dispose: Option.none(),
  lastError: Option.none(),
};

// =============================================================================
// Bun DevPlatform Implementation
// =============================================================================

export const BunDevPlatformLive: Layer.Layer<DevPlatform | FileSystem.FileSystem, ImportError> =
  Layer.unwrapEffect(
    Effect.gen(function* () {
      const bunFs = yield* importBunFileSystem;
      const fileSystemLayer: Layer.Layer<FileSystem.FileSystem> = bunFs.layer;

      const createDevApi = (
        options: DevApiOptions,
      ): Effect.Effect<DevApiHandle, DevApiErrors, Scope.Scope> =>
        Effect.gen(function* () {
          const stateRef = yield* Ref.make<HandlerState>(emptyState);

          /** Dispose previous handler. */
          const disposeHandler = Effect.gen(function* () {
            const { dispose } = yield* Ref.get(stateRef);
            if (Option.isSome(dispose)) {
              yield* Effect.try({
                try: () => dispose.value(),
                catch: () => new ApiInitError({ message: "Failed to dispose previous handler" }),
              }).pipe(Effect.ignore);
            }
            yield* Ref.set(stateRef, emptyState);
          });

          /** Build handler from API module using SSR-loaded factory. */
          const initHandler = Effect.gen(function* () {
            yield* disposeHandler;

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

            // Use SSR-loaded factory for layer detection and web handler creation
            const factory = options.handlerFactory;
            const apiLive = yield* factory.detectAndComposeLayer(mod.value).pipe(
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
              try: () => factory.createWebHandler(apiLive.value),
              catch: (cause) =>
                new ApiInitError({ message: "Failed to create web handler", cause }),
            }).pipe(Effect.option);

            if (Option.isNone(result)) return;

            yield* Ref.set(stateRef, {
              handler: Option.some(result.value.handler),
              dispose: Option.some(result.value.dispose),
              lastError: Option.none(),
            });
          });

          yield* initHandler;
          yield* Effect.addFinalizer(() => disposeHandler);

          const runtime = yield* Effect.runtime<never>();

          const middleware: Connect.NextHandleFunction = (req, res, next) => {
            if (!req.url?.startsWith("/api/")) {
              return next();
            }

            const effect = Effect.gen(function* () {
              const state = yield* Ref.get(stateRef);
              if (Option.isNone(state.handler)) {
                const errorMessage = Option.match(state.lastError, {
                  onNone: () => "Check console for errors",
                  onSome: (e) => (e instanceof Error ? e.message : String(e)),
                });
                yield* options.onError(new ApiInitError({ message: "Handler not available" }));
                const ErrorResponseJson = Schema.parseJson(
                  Schema.Struct({ error: Schema.String, message: Schema.String }),
                );
                const body = yield* Schema.encode(ErrorResponseJson)({
                  error: "API handler not available",
                  message: errorMessage,
                });
                res.statusCode = 500;
                res.setHeader("Content-Type", "application/json");
                res.end(body);
                return;
              }

              // Bridge: Node IncomingMessage → Web Request → handler → Web Response → Node ServerResponse
              const { value: handler } = state.handler;
              yield* Effect.tryPromise({
                try: async () => {
                  const webReq = await toWebRequest(req);
                  const webRes = await handler(webReq);
                  await writeWebResponse(webRes, res);
                },
                catch: (cause) => new ApiInitError({ message: "Request handling failed", cause }),
              });
            }).pipe(
              Effect.catchAll((error) =>
                Effect.gen(function* () {
                  yield* Effect.logError(`[trygg] API handler failed: ${String(error)}`);
                  yield* options.onError(error);
                  if (!res.headersSent) {
                    res.statusCode = 500;
                    res.end("Internal Server Error");
                  }
                }),
              ),
            );

            void Runtime.runPromise(runtime)(effect).catch((_error: unknown) => {
              if (!res.headersSent) {
                res.statusCode = 500;
                res.end("Internal Server Error");
              }
            });
          };

          return {
            middleware,
            reload: initHandler,
            dispose: disposeHandler,
          };
        });

      const service: DevPlatformService = {
        fileSystemLayer,
        createDevApi,
      };

      return Layer.mergeAll(Layer.succeed(DevPlatform, service), fileSystemLayer);
    }),
  );
