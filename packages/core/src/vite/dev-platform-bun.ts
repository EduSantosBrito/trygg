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
import {
  Cause,
  Effect,
  Exit,
  FileSystem,
  Layer,
  Option,
  Predicate,
  Ref,
  Schema,
  Scope,
} from "effect";
import type { IncomingMessage, ServerResponse } from "node:http";
import type { Connect } from "vite";
import {
  ApiInitError,
  ApiRequestError,
  type DevApiErrors,
  type DevApiHandle,
  type DevApiOptions,
  DevPlatform,
  type DevPlatformService,
  ImportError,
  MAX_REQUEST_BODY_BYTES,
  traceApiRequestReceived,
} from "./dev-platform.js";
import * as Trace from "../trace/index.js";
import * as CallbackRuntime from "./callback-runtime.js";

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
export const getBody = (
  req: IncomingMessage,
  signal?: AbortSignal,
): Effect.Effect<Option.Option<Uint8Array>, ApiRequestError> =>
  Effect.callback((resume) => {
    const method = req.method ?? "GET";
    if (method === "GET" || method === "HEAD") {
      resume(Effect.succeed(Option.none()));
      return;
    }

    const chunks: Array<Uint8Array> = [];
    let length = 0;
    let settled = false;
    const cleanup = (): void => {
      req.off("data", onData);
      req.off("end", onEnd);
      req.off("error", onError);
      req.off("aborted", onAborted);
      req.off("close", onClose);
      signal?.removeEventListener("abort", onAborted);
    };
    const finish = (effect: Effect.Effect<Option.Option<Uint8Array>, ApiRequestError>): void => {
      if (settled) return;
      settled = true;
      cleanup();
      resume(effect);
    };
    const onData = (chunk: Uint8Array): void => {
      length += chunk.byteLength;
      if (length > MAX_REQUEST_BODY_BYTES) {
        finish(
          Effect.fail(
            new ApiRequestError({
              reason: "BodyTooLarge",
              message: `Request body exceeds ${MAX_REQUEST_BODY_BYTES} bytes`,
              limit: MAX_REQUEST_BODY_BYTES,
            }),
          ),
        );
        req.resume();
        return;
      }
      chunks.push(new Uint8Array(chunk));
    };
    const onEnd = (): void => {
      const buf = new Uint8Array(length);
      let offset = 0;
      for (const chunk of chunks) {
        buf.set(chunk, offset);
        offset += chunk.length;
      }
      finish(Effect.succeed(Option.some(buf)));
    };
    const onError = (cause: unknown): void => {
      finish(
        Effect.fail(
          new ApiRequestError({ reason: "ReadFailed", message: "Request body read failed", cause }),
        ),
      );
    };
    const onAborted = (): void => {
      finish(
        Effect.fail(new ApiRequestError({ reason: "Aborted", message: "Request was aborted" })),
      );
    };
    const onClose = (): void => {
      if (!req.complete) onAborted();
    };
    req.on("data", onData);
    req.on("end", onEnd);
    req.on("error", onError);
    req.on("aborted", onAborted);
    req.on("close", onClose);
    signal?.addEventListener("abort", onAborted, { once: true });
    if (signal?.aborted) onAborted();
    return Effect.sync(() => {
      settled = true;
      cleanup();
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
export const fromNodeRequest: (
  req: IncomingMessage,
  signal?: AbortSignal,
) => Effect.Effect<Request, ApiInitError | ApiRequestError> = Effect.fn(
  "BunDevPlatform.fromNodeRequest",
)(function* (req, signal) {
  const protocol = "http";
  const host = req.headers.host ?? "localhost";
  const url = `${protocol}://${host}${req.url ?? "/"}`;
  const method = req.method ?? "GET";
  const headers = toWebHeaders(req.headers);
  const body = yield* getBody(req, signal);

  const init: RequestInit =
    signal === undefined ? { method, headers } : { method, headers, signal };
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
): Effect.Effect<void, ApiRequestError> =>
  Effect.callback((resume) => {
    let settled = false;
    const cleanup = (): void => {
      nodeRes.off("close", onClose);
    };
    const finish = (effect: Effect.Effect<void, ApiRequestError>): void => {
      if (settled) return;
      settled = true;
      cleanup();
      resume(effect);
    };
    const onClose = (): void => {
      finish(
        Effect.fail(
          new ApiRequestError({ reason: "Aborted", message: "Response connection closed" }),
        ),
      );
    };
    const onWrite = (cause?: Error | null): void => {
      if (cause !== undefined && cause !== null) {
        finish(
          Effect.fail(
            new ApiRequestError({
              reason: "WriteFailed",
              message: "Failed to write response",
              cause,
            }),
          ),
        );
        return;
      }
      finish(Effect.void);
    };
    nodeRes.on("close", onClose);
    Promise.resolve()
      .then(() => {
        if (!settled) nodeRes.write(value, onWrite);
      })
      .then(undefined, (cause) =>
        finish(
          Effect.fail(
            new ApiRequestError({
              reason: "WriteFailed",
              message: "Failed to write response",
              cause,
            }),
          ),
        ),
      );
    return Effect.sync(() => {
      settled = true;
      cleanup();
    });
  });

const readResponseChunk = (
  reader: ReadableStreamDefaultReader<Uint8Array>,
  nodeRes: ServerResponse,
): Effect.Effect<
  Awaited<ReturnType<ReadableStreamDefaultReader<Uint8Array>["read"]>>,
  ApiRequestError
> =>
  Effect.callback((resume) => {
    let settled = false;
    const cleanup = (): void => {
      nodeRes.off("close", onClose);
    };
    const finish = (
      effect: Effect.Effect<
        Awaited<ReturnType<ReadableStreamDefaultReader<Uint8Array>["read"]>>,
        ApiRequestError
      >,
    ): void => {
      if (settled) return;
      settled = true;
      cleanup();
      resume(effect);
    };
    const onClose = (): void =>
      finish(
        Effect.fail(
          new ApiRequestError({ reason: "Aborted", message: "Response connection closed" }),
        ),
      );
    nodeRes.on("close", onClose);
    Promise.resolve()
      .then(() => reader.read())
      .then(
        (chunk) => finish(Effect.succeed(chunk)),
        (cause) =>
          finish(
            Effect.fail(
              new ApiRequestError({
                reason: "ReadFailed",
                message: "Failed to read response body",
                cause,
              }),
            ),
          ),
      );
    return Effect.sync(() => {
      settled = true;
      cleanup();
    });
  });

export const toNodeResponse: (
  webRes: Response,
  nodeRes: ServerResponse,
) => Effect.Effect<void, ApiRequestError> = Effect.fn("BunDevPlatform.toNodeResponse")(
  function* (webRes, nodeRes) {
    yield* Effect.try({
      try: () => {
        nodeRes.statusCode = webRes.status;
        webRes.headers.forEach((value, key) => {
          if (key !== "set-cookie") nodeRes.setHeader(key, value);
        });
        const cookies = webRes.headers.getSetCookie();
        if (cookies.length > 0) nodeRes.setHeader("set-cookie", cookies);
      },
      catch: (cause) =>
        new ApiRequestError({
          reason: "WriteFailed",
          message: "Failed to write response headers",
          cause,
        }),
    });

    const responseBody = webRes.body;
    if (responseBody === null) {
      yield* Effect.try({
        try: () => nodeRes.end(),
        catch: (cause) =>
          new ApiRequestError({
            reason: "WriteFailed",
            message: "Failed to end response",
            cause,
          }),
      });
      return;
    }

    const reader = yield* Effect.try({
      try: () => responseBody.getReader(),
      catch: (cause) =>
        new ApiRequestError({
          reason: "ReadFailed",
          message: "Failed to acquire response body reader",
          cause,
        }),
    });
    yield* Effect.acquireUseRelease(
      Effect.succeed(reader),
      (activeReader) =>
        Effect.gen(function* () {
          let reading = true;
          while (reading) {
            const chunk = yield* readResponseChunk(activeReader, nodeRes);
            if (chunk.done) {
              reading = false;
            } else {
              yield* writeResponseChunk(nodeRes, chunk.value);
            }
          }
          yield* Effect.try({
            try: () => nodeRes.end(),
            catch: (cause) =>
              new ApiRequestError({
                reason: "WriteFailed",
                message: "Failed to end response",
                cause,
              }),
          });
        }),
      (activeReader, exit) =>
        Effect.gen(function* () {
          if (Exit.isFailure(exit)) {
            yield* Effect.exit(Effect.tryPromise(() => activeReader.cancel()));
          }
          yield* Effect.exit(Effect.try(() => activeReader.releaseLock()));
        }),
    );
  },
);

// =============================================================================
// Internal State
// =============================================================================

const requestAbortController = (
  req: IncomingMessage,
  res: ServerResponse,
): Effect.Effect<AbortController, never, Scope.Scope> =>
  Effect.acquireRelease(
    Effect.sync(() => {
      const controller = new AbortController();
      const abort = (): void => controller.abort();
      const abortIncompleteRequest = (): void => {
        if (!req.complete) abort();
      };
      const abortIncompleteResponse = (): void => {
        if (!res.writableEnded) abort();
      };
      req.on("aborted", abort);
      req.on("close", abortIncompleteRequest);
      res.on("close", abortIncompleteResponse);
      return { abort, abortIncompleteRequest, abortIncompleteResponse, controller };
    }),
    ({ abort, abortIncompleteRequest, abortIncompleteResponse, controller }) =>
      Effect.sync(() => {
        req.off("aborted", abort);
        req.off("close", abortIncompleteRequest);
        res.off("close", abortIncompleteResponse);
        controller.abort();
      }),
  ).pipe(Effect.map(({ controller }) => controller));

const awaitWebHandler = (
  handler: (request: Request) => Promise<Response>,
  request: Request,
  controller: AbortController,
): Effect.Effect<Response, ApiInitError> =>
  Effect.callback((resume, signal) => {
    if (request.signal.aborted) {
      resume(Effect.interrupt);
      return;
    }
    let settled = false;
    const cleanup = (): void => {
      request.signal.removeEventListener("abort", onRequestAbort);
      signal.removeEventListener("abort", onEffectAbort);
    };
    const finish = (effect: Effect.Effect<Response, ApiInitError>): void => {
      if (settled) return;
      settled = true;
      cleanup();
      resume(effect);
    };
    const onRequestAbort = (): void => finish(Effect.interrupt);
    const onEffectAbort = (): void => controller.abort();
    request.signal.addEventListener("abort", onRequestAbort, { once: true });
    signal.addEventListener("abort", onEffectAbort, { once: true });
    Promise.resolve()
      .then(() => handler(request))
      .then(
        (response) => finish(Effect.succeed(response)),
        (cause) =>
          finish(Effect.fail(new ApiInitError({ message: "Request handling failed", cause }))),
      );
    return Effect.sync(() => {
      settled = true;
      cleanup();
    });
  });

interface HandlerInstance {
  readonly handler: (request: Request) => Promise<Response>;
  readonly runRequest: (effect: Effect.Effect<void>) => void;
  readonly scope: Scope.Closeable;
}

interface HandlerState {
  readonly instance: Option.Option<HandlerInstance>;
}

const emptyState: HandlerState = {
  instance: Option.none(),
};

const reportApiInitFailures = (
  cause: Cause.Cause<ApiInitError>,
  report: DevApiOptions["onError"],
): Effect.Effect<void> => {
  const failures = cause.reasons.filter(Cause.isFailReason);
  if (failures.length === 0 || failures.length !== cause.reasons.length) return Effect.void;
  return Effect.forEach(failures, ({ error }) => report(error), { discard: true });
};

// =============================================================================
// Bun DevPlatform Implementation
// =============================================================================

export const layer: Layer.Layer<FileSystem.FileSystem | DevPlatform, ImportError> = Layer.unwrap(
  Effect.gen(function* () {
    const bunFs = yield* importBunFileSystem;
    const fileSystemLayer = bunFs.layer;

    const makeApi: (
      options: DevApiOptions,
    ) => Effect.Effect<DevApiHandle, DevApiErrors, Scope.Scope> = Effect.fn(
      "BunDevPlatform.makeApi",
    )(function* (options) {
      const ownerScope = yield* Scope.Scope;
      const stateRef = yield* Ref.make<HandlerState>(emptyState);
      const runAdmission = yield* CallbackRuntime.make();

      const disposeCurrent = Effect.fn("BunDevPlatform.disposeCurrent")(function* () {
        return yield* Effect.uninterruptible(
          Effect.gen(function* () {
            const current = yield* Ref.getAndSet(stateRef, emptyState);
            yield* Option.match(current.instance, {
              onNone: () => Effect.void,
              onSome: (instance) => Scope.close(instance.scope, Exit.void),
            });
          }),
        );
      });

      const acquireHandler = Effect.fn("BunDevPlatform.acquireHandler")(function* () {
        return yield* Effect.uninterruptibleMask((restore) =>
          Effect.gen(function* () {
            if (Predicate.isTagged(ownerScope.state, "Closed")) return yield* Effect.interrupt;
            const candidateScope = yield* Scope.fork(ownerScope);
            const candidate = Effect.gen(function* () {
              yield* Trace.emit("api.handler.loading", () => ({ module_path: "app/api.ts" }));
              if (Predicate.isTagged(candidateScope.state, "Closed"))
                return yield* Effect.interrupt;
              const mod = yield* options.loadApiModule();

              yield* Trace.emit("api.handler.loaded", () => ({
                module_path: "app/api.ts",
                module_type: Trace.valueType(mod),
              }));

              if (Predicate.isTagged(candidateScope.state, "Closed"))
                return yield* Effect.interrupt;
              const factory = options.handlerFactory;
              const apiLive = yield* factory
                .makeApiLayer(mod)
                .pipe(
                  Effect.mapError(
                    (cause) => new ApiInitError({ message: "Failed to detect API layer", cause }),
                  ),
                );
              if (Predicate.isTagged(candidateScope.state, "Closed"))
                return yield* Effect.interrupt;
              const result = yield* Effect.acquireRelease(
                factory
                  .makeWebHandler(apiLive)
                  .pipe(
                    Effect.mapError(
                      (cause) =>
                        new ApiInitError({ message: "Failed to create web handler", cause }),
                    ),
                  ),
                (result) => result.dispose,
              );
              if (Predicate.isTagged(candidateScope.state, "Closed"))
                return yield* Effect.interrupt;
              const runFork = yield* CallbackRuntime.make();
              return {
                handler: result.handler,
                runRequest: (effect) => {
                  runFork(effect);
                },
                scope: candidateScope,
              } satisfies HandlerInstance;
            }).pipe(Effect.tapCause((cause) => reportApiInitFailures(cause, options.onError)));

            const exit = yield* restore(Scope.provide(candidate, candidateScope)).pipe(Effect.exit);
            if (Exit.isSuccess(exit)) return exit.value;

            return yield* Effect.failCause(exit.cause).pipe(
              Effect.ensuring(Scope.close(candidateScope, exit)),
            );
          }),
        );
      });

      const installCandidate = Effect.fn("BunDevPlatform.installCandidate")(function* () {
        return yield* Effect.uninterruptibleMask((restore) =>
          Effect.gen(function* () {
            const candidate = yield* restore(acquireHandler());
            // Acquisition can suspend across shutdown. Decide owner liveness
            // and publication in the same synchronous state transition.
            const previous = yield* Ref.modify(
              stateRef,
              (current): readonly [Option.Option<HandlerState>, HandlerState] => {
                if (Predicate.isTagged(ownerScope.state, "Closed")) return [Option.none(), current];
                return [Option.some(current), { instance: Option.some(candidate) }];
              },
            );
            if (Option.isNone(previous)) return yield* Effect.interrupt;
            yield* Option.match(previous.value.instance, {
              onNone: () => Effect.void,
              onSome: (instance) => Scope.close(instance.scope, Exit.void),
            });
          }),
        );
      });

      yield* Effect.addFinalizer(() => disposeCurrent());
      yield* installCandidate();

      const middleware: Connect.NextHandleFunction = (req, res, next) => {
        if (!req.url?.startsWith("/api/")) {
          return next();
        }

        const effect = Effect.gen(function* () {
          yield* traceApiRequestReceived(req.method, req.url);

          const state = yield* Ref.get(stateRef);
          if (Option.isNone(state.instance)) {
            yield* options.onError(new ApiInitError({ message: "Handler not available" }));
            const body = yield* encodeApiUnavailableBody({
              error: "API handler not available",
              message: "The development API is shutting down",
            }).pipe(
              Effect.mapError(
                (cause) => new ApiInitError({ message: "Failed to encode error response", cause }),
              ),
            );
            res.statusCode = 500;
            res.setHeader("Content-Type", "application/json");
            res.end(body);
            return;
          }

          const instance = state.instance.value;
          instance.runRequest(
            Effect.gen(function* () {
              const controller = yield* requestAbortController(req, res);
              const webReq = yield* fromNodeRequest(req, controller.signal);
              const webRes = yield* awaitWebHandler(instance.handler, webReq, controller);
              yield* toNodeResponse(webRes, res);
            }).pipe(
              Effect.catch((error: ApiInitError | ApiRequestError) =>
                Effect.gen(function* () {
                  if (Predicate.isTagged(error, "ApiRequestError") && error.reason === "Aborted") {
                    return;
                  }
                  yield* Effect.logError(
                    Predicate.isTagged(error, "ApiRequestError")
                      ? `[trygg] API request bridge failed: ${error.reason}`
                      : "[trygg] API handler initialization failed",
                  );
                  yield* options.onError(error);
                  if (!res.headersSent) {
                    res.statusCode =
                      Predicate.isTagged(error, "ApiRequestError") &&
                      error.reason === "BodyTooLarge"
                        ? 413
                        : 500;
                    res.end(res.statusCode === 413 ? "Payload Too Large" : "Internal Server Error");
                  }
                }),
              ),
              Effect.catchCause((cause) =>
                Cause.hasInterruptsOnly(cause)
                  ? Effect.void
                  : options.onError(cause).pipe(
                      Effect.andThen(
                        Effect.sync(() => {
                          if (!res.headersSent) {
                            res.statusCode = 500;
                            res.end("Internal Server Error");
                          }
                        }),
                      ),
                    ),
              ),
              Effect.scoped,
            ),
          );
        }).pipe(
          Effect.catchCause((cause) =>
            options.onError(cause).pipe(
              Effect.andThen(
                Effect.sync(() => {
                  if (!res.headersSent) {
                    res.statusCode = 500;
                    res.end("Internal Server Error");
                  }
                }),
              ),
            ),
          ),
        );

        runAdmission(effect);
      };

      return {
        middleware,
        reload: installCandidate(),
        dispose: disposeCurrent(),
      };
    });

    const service: DevPlatformService = {
      fileSystemLayer,
      makeApi,
    };

    return Layer.mergeAll(Layer.succeed(DevPlatform, service), fileSystemLayer);
  }),
);
