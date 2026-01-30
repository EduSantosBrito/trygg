/**
 * @since 1.0.0
 * Node.js implementation of DevPlatform service
 *
 * Uses dynamic imports to avoid hard dependencies on @effect/platform-node
 * when running in Bun mode.
 */
import { FileSystem } from "@effect/platform";
import { Effect, Layer, Scope } from "effect";
import {
  DevPlatform,
  type DevPlatformService,
  type DevApiOptions,
  type DevApiHandle,
  ImportError,
  ApiInitError,
  type DevApiErrors,
} from "./dev-platform.js";

// =============================================================================
// Dynamic Imports
// =============================================================================

/**
 * Dynamically import NodeFileSystem layer
 * Prevents hard dependency on @effect/platform-node in Bun mode
 */
const importNodeFileSystem = Effect.tryPromise({
  try: () => import("@effect/platform-node/NodeFileSystem"),
  catch: (cause) =>
    new ImportError({
      module: "@effect/platform-node/NodeFileSystem",
      message: "Failed to import NodeFileSystem. Is @effect/platform-node installed?",
      cause,
    }),
});

const importApiMiddleware = Effect.tryPromise({
  try: () => import("../api/middleware.js"),
  catch: (cause) =>
    new ImportError({
      module: "@effect/platform-node/NodeHttpServer",
      message: "Failed to import API middleware. Is @effect/platform-node installed?",
      cause,
    }),
});

// =============================================================================
// Node DevPlatform Implementation
// =============================================================================

/**
 * Create the Node.js DevPlatform layer
 * @since 1.0.0
 */
export const NodeDevPlatformLive: Layer.Layer<DevPlatform | FileSystem.FileSystem, ImportError> =
  Layer.unwrapEffect(
    Effect.gen(function* () {
      const nodeFs = yield* importNodeFileSystem;
      const fileSystemLayer: Layer.Layer<FileSystem.FileSystem> = nodeFs.layer;

      const createDevApi = (
        options: DevApiOptions,
      ): Effect.Effect<DevApiHandle, DevApiErrors, Scope.Scope> =>
        Effect.gen(function* () {
          const apiMiddleware = yield* importApiMiddleware;

          const middleware = yield* apiMiddleware
            .createApiMiddleware({
              loadApiModule: options.loadApiModule,
              onError: options.onError,
            })
            .pipe(
              Effect.mapError(
                (cause) =>
                  new ApiInitError({
                    message: "Failed to initialize API middleware",
                    cause,
                  }),
              ),
            );

          return {
            middleware: middleware.middleware,
            reload: middleware.reload.pipe(
              Effect.mapError(
                (cause) =>
                  new ApiInitError({
                    message: "Failed to reload API handlers",
                    cause,
                  }),
              ),
            ),
            dispose: middleware.dispose,
          };
        });

      const service: DevPlatformService = {
        fileSystemLayer,
        createDevApi,
      };

      return Layer.mergeAll(Layer.succeed(DevPlatform, service), fileSystemLayer);
    }),
  );
