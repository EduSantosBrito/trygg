import type { ResolvedConfig } from "vite";
import { Deferred, Effect, FileSystem, Layer, Ref } from "effect";
import * as Context from "effect/Context";
import * as nodePath from "node:path";
import type { Platform, TryggConfig } from "../config.js";
import { PluginBootstrapError, PluginFileSystemError } from "./errors.js";

interface BootstrapState {
  readonly config: ResolvedConfig;
  readonly appDir: string;
  readonly generatedDir: string;
  readonly routesFilePath: string | undefined;
}

type BootstrapFailure = PluginFileSystemError;

type BootstrapStatus =
  | { readonly _tag: "Pending" }
  | { readonly _tag: "Bootstrapping" }
  | { readonly _tag: "Ready"; readonly state: BootstrapState }
  | { readonly _tag: "Failed"; readonly error: BootstrapFailure };

export interface BootstrapService {
  readonly initialize: (
    resolvedConfig: ResolvedConfig,
  ) => Effect.Effect<void, PluginFileSystemError, FileSystem.FileSystem>;
  readonly awaitReady: Effect.Effect<BootstrapState, PluginBootstrapError | BootstrapFailure>;
}

interface Bootstrap extends Context.Service<Bootstrap, BootstrapService> {}

export const Bootstrap = Context.Service<Bootstrap, BootstrapService>("trygg/vite/Bootstrap");

interface BootstrapOptions {
  readonly appDirName: string;
  readonly generatedDirName: string;
  readonly platform: Platform;
  readonly output: NonNullable<TryggConfig["output"]>;
}

const makeState = (
  resolvedConfig: ResolvedConfig,
  options: BootstrapOptions,
): Effect.Effect<BootstrapState, PluginFileSystemError, FileSystem.FileSystem> =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const appDir = nodePath.resolve(resolvedConfig.root, options.appDirName);
    const generatedDir = nodePath.resolve(resolvedConfig.root, options.generatedDirName);

    const discoveredRoutesPath = nodePath.join(appDir, "routes.ts");
    const hasRoutes = yield* fs
      .exists(discoveredRoutesPath)
      .pipe(Effect.catchTag("PlatformError", () => Effect.succeed(false)));
    const routesFilePath = hasRoutes ? discoveredRoutesPath : undefined;

    yield* fs.makeDirectory(generatedDir, { recursive: true }).pipe(
      Effect.catchTag("PlatformError", (e) =>
        e.reason._tag === "AlreadyExists" ? Effect.void : Effect.fail(e),
      ),
      Effect.mapError(
        (cause) =>
          new PluginFileSystemError({
            operation: "mkdir",
            path: generatedDir,
            cause,
          }),
      ),
    );

    yield* Effect.logInfo("trygg configured");
    yield* Effect.logDebug(`  App directory: ${appDir}`);
    yield* Effect.logDebug(`  Generated directory: ${generatedDir}`);
    yield* Effect.logDebug(`  Platform: ${options.platform}`);
    yield* Effect.logDebug(`  Output: ${options.output}`);
    if (routesFilePath !== undefined) {
      yield* Effect.logDebug(`  Routes: ${routesFilePath}`);
    }

    return {
      config: resolvedConfig,
      appDir,
      generatedDir,
      routesFilePath,
    };
  });

export const makeBootstrapLayer = (options: BootstrapOptions): Layer.Layer<Bootstrap> =>
  Layer.effect(
    Bootstrap,
    Effect.gen(function* () {
      const statusRef = yield* Ref.make<BootstrapStatus>({ _tag: "Pending" });
      const ready = yield* Deferred.make<BootstrapState, BootstrapFailure>();

      const markReady = (state: BootstrapState): Effect.Effect<void> =>
        Effect.gen(function* () {
          yield* Ref.set(statusRef, { _tag: "Ready", state });
          yield* Deferred.succeed(ready, state).pipe(Effect.asVoid);
        });

      const markFailed = (error: BootstrapFailure): Effect.Effect<void> =>
        Effect.gen(function* () {
          yield* Ref.set(statusRef, { _tag: "Failed", error });
          yield* Deferred.fail(ready, error).pipe(Effect.asVoid);
        });

      const initialize = (
        resolvedConfig: ResolvedConfig,
      ): Effect.Effect<void, PluginFileSystemError, FileSystem.FileSystem> =>
        Effect.flatten(
          Ref.modify(
            statusRef,
            (
              status,
            ): readonly [
              Effect.Effect<void, PluginFileSystemError, FileSystem.FileSystem>,
              BootstrapStatus,
            ] => {
              switch (status._tag) {
                case "Pending":
                  return [
                    makeState(resolvedConfig, options).pipe(
                      Effect.tap(markReady),
                      Effect.tapError(markFailed),
                      Effect.asVoid,
                    ),
                    { _tag: "Bootstrapping" },
                  ];
                case "Bootstrapping":
                  return [Deferred.await(ready).pipe(Effect.asVoid), status];
                case "Ready":
                  return [Effect.void, status];
                case "Failed":
                  return [Effect.fail(status.error), status];
              }
            },
          ),
        );

      const awaitReady: Effect.Effect<BootstrapState, PluginBootstrapError | BootstrapFailure> =
        Effect.gen(function* () {
          const status = yield* Ref.get(statusRef);
          switch (status._tag) {
            case "Pending":
              return yield* PluginBootstrapError.notReady();
            case "Bootstrapping":
              return yield* Deferred.await(ready);
            case "Ready":
              return status.state;
            case "Failed":
              return yield* status.error;
          }
        });

      return {
        initialize,
        awaitReady,
      } satisfies BootstrapService;
    }),
  );
