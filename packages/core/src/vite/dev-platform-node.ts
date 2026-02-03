/**
 * @since 1.0.0
 * Node.js implementation of DevPlatform service
 *
 * Uses SSR-loaded handler factory for @effect/platform layer composition,
 * ensuring Router.Live identity matches between plugin and user code.
 */
import { FileSystem } from "@effect/platform";
import { Effect, Exit, Layer, Option, Ref, Runtime, Schema, Scope } from "effect";
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
import * as Debug from "../debug/debug.js";

// =============================================================================
// Dynamic Imports
// =============================================================================

const importNodeFileSystem = Effect.tryPromise({
  try: () => import("@effect/platform-node/NodeFileSystem"),
  catch: (cause) =>
    new ImportError({
      module: "@effect/platform-node/NodeFileSystem",
      message: "Failed to import NodeFileSystem. Is @effect/platform-node installed?",
      cause,
    }),
});

// =============================================================================
// Internal State
// =============================================================================

interface HandlerState {
  readonly handler: Option.Option<(req: IncomingMessage, res: ServerResponse) => void>;
  readonly dispose: Option.Option<Effect.Effect<void>>;
  readonly lastError: Option.Option<unknown>;
}

const emptyState: HandlerState = {
  handler: Option.none(),
  dispose: Option.none(),
  lastError: Option.none(),
};

// =============================================================================
// Handler Initialization
// =============================================================================

/**
 * Initialize handler using SSR-loaded factory.
 * All @effect/platform layer composition happens inside the factory,
 * which was SSR-loaded from the same module graph as the user's api.ts.
 * @internal
 */
const initHandler = (
  state: Ref.Ref<HandlerState>,
  options: DevApiOptions,
): Effect.Effect<void, ApiInitError> =>
  Effect.gen(function* () {
    // Dispose previous handler
    const current = yield* Ref.get(state);
    yield* Option.match(current.dispose, {
      onNone: () => Effect.void,
      onSome: (dispose) => dispose.pipe(Effect.ignore),
    });

    // Load API module
    yield* Debug.log({ event: "api.handler.loading", module_path: "app/api.ts" });
    const mod = yield* options.loadApiModule().pipe(
      Effect.tapError((error) =>
        Effect.gen(function* () {
          yield* Ref.set(state, { ...emptyState, lastError: Option.some(error) });
          yield* options.onError(error);
        }),
      ),
      Effect.option,
    );
    if (Option.isNone(mod)) return;

    yield* Debug.log({
      event: "api.handler.loaded",
      module_path: "app/api.ts",
      exports: Object.keys(mod.value),
    });

    // Detect and compose API layer using SSR-loaded factory
    const factory = options.handlerFactory;
    const apiLive = yield* factory.detectAndComposeLayer(mod.value).pipe(
      Effect.mapError(
        (cause) => new ApiInitError({ message: "Failed to detect API layer", cause }),
      ),
      Effect.tapError((error) =>
        Effect.gen(function* () {
          yield* Ref.set(state, { ...emptyState, lastError: Option.some(error) });
          yield* options.onError(error);
        }),
      ),
      Effect.option,
    );
    if (Option.isNone(apiLive)) return;

    // Create Node handler using SSR-loaded factory
    if (factory.createNodeHandler === undefined) {
      return yield* new ApiInitError({
        message: "createNodeHandler not available in handler factory",
      });
    }
    const handlerScope = yield* Scope.make();
    const result = yield* factory.createNodeHandler(apiLive.value).pipe(
      Scope.extend(handlerScope),
      Effect.mapError(
        (cause) => new ApiInitError({ message: "Failed to create API handler", cause }),
      ),
      Effect.tapError((cause) =>
        Scope.close(handlerScope, Exit.fail(cause)).pipe(
          Effect.flatMap(() =>
            Effect.gen(function* () {
              yield* Ref.set(state, { ...emptyState, lastError: Option.some(cause) });
              yield* options.onError(cause);
            }),
          ),
        ),
      ),
      Effect.option,
    );
    if (Option.isNone(result)) return;

    yield* Ref.set(state, {
      handler: Option.some(result.value.handler),
      dispose: Option.some(Scope.close(handlerScope, Exit.void).pipe(Effect.ignore)),
      lastError: Option.none(),
    });
  });

// =============================================================================
// Node DevPlatform Implementation
// =============================================================================

export const NodeDevPlatformLive: Layer.Layer<DevPlatform | FileSystem.FileSystem, ImportError> =
  Layer.unwrapEffect(
    Effect.gen(function* () {
      const nodeFs = yield* importNodeFileSystem;
      const fileSystemLayer: Layer.Layer<FileSystem.FileSystem> = nodeFs.layer;

      const createDevApi = (
        options: DevApiOptions,
      ): Effect.Effect<DevApiHandle, DevApiErrors, Scope.Scope> =>
        Effect.gen(function* () {
          const runtime = yield* Effect.runtime<never>();
          const state = yield* Ref.make<HandlerState>(emptyState);

          yield* initHandler(state, options);
          yield* Effect.addFinalizer(() =>
            Effect.gen(function* () {
              const current = yield* Ref.get(state);
              yield* Option.match(current.dispose, {
                onNone: () => Effect.void,
                onSome: (dispose) => dispose,
              });
              yield* Ref.set(state, emptyState);
            }),
          );

          const middleware: Connect.NextHandleFunction = (req, res, next) => {
            if (!req.url?.startsWith("/api/")) {
              return next();
            }

            const effect = Effect.gen(function* () {
              yield* Debug.log({
                event: "api.request.received",
                method: req.method ?? "GET",
                url: req.url ?? "",
              });

              const currentState = yield* Ref.get(state);

              if (Option.isNone(currentState.handler)) {
                const errorMessage = Option.match(currentState.lastError, {
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

              currentState.handler.value(req, res);
            });

            void Runtime.runPromise(runtime)(effect).catch((_error: unknown) => {
              if (!res.headersSent) {
                res.statusCode = 500;
                res.end("Internal Server Error");
              }
            });
          };

          return {
            middleware,
            reload: initHandler(state, options),
            dispose: Effect.gen(function* () {
              const current = yield* Ref.get(state);
              yield* Option.match(current.dispose, {
                onNone: () => Effect.void,
                onSome: (dispose) => dispose,
              });
              yield* Ref.set(state, emptyState);
            }),
          };
        });

      const service: DevPlatformService = {
        fileSystemLayer,
        createDevApi,
      };

      return Layer.mergeAll(Layer.succeed(DevPlatform, service), fileSystemLayer);
    }),
  );
