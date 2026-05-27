import type { ResolvedConfig } from "vite";
import { Data, Deferred, Effect, FileSystem, Layer, Predicate, Ref } from "effect";
import * as Context from "effect/Context";
import * as nodePath from "node:path";
import type { Platform, TryggConfig } from "../config.js";
import { PluginBootstrapError, PluginFileSystemError } from "./errors.js";

interface BootstrapState {
  readonly config: ResolvedConfig;
  readonly appDir: string;
  readonly generatedDir: string;
}

type BootstrapFailure = PluginFileSystemError;

type BootstrapStatus = Data.TaggedEnum<{
  readonly Pending: {};
  readonly Bootstrapping: {};
  readonly Ready: { readonly state: BootstrapState };
  readonly Failed: { readonly error: BootstrapFailure };
}>;

const BootstrapStatus = Data.taggedEnum<BootstrapStatus>();

export interface BootstrapService {
  readonly initialize: (
    resolvedConfig: ResolvedConfig,
  ) => Effect.Effect<void, PluginFileSystemError, FileSystem.FileSystem>;
  readonly awaitReady: Effect.Effect<BootstrapState, PluginBootstrapError | BootstrapFailure>;
}

export class Bootstrap extends Context.Service<
  Bootstrap,
  {
    readonly initialize: (
      resolvedConfig: ResolvedConfig,
    ) => Effect.Effect<void, PluginFileSystemError, FileSystem.FileSystem>;
    readonly awaitReady: Effect.Effect<BootstrapState, PluginBootstrapError | BootstrapFailure>;
  }
>()("trygg/vite/Bootstrap") {}

interface BootstrapOptions {
  readonly appDirName: string;
  readonly generatedDirName: string;
  readonly platform: Platform;
  readonly output: NonNullable<TryggConfig["output"]>;
}

const makeState: (
  resolvedConfig: ResolvedConfig,
  options: BootstrapOptions,
) => Effect.Effect<BootstrapState, PluginFileSystemError, FileSystem.FileSystem> = Effect.fn(
  "Bootstrap.makeState",
)(function* (resolvedConfig: ResolvedConfig, options: BootstrapOptions) {
  const fs = yield* FileSystem.FileSystem;
  const appDir = nodePath.resolve(resolvedConfig.root, options.appDirName);
  const generatedDir = nodePath.resolve(resolvedConfig.root, options.generatedDirName);

  yield* fs.makeDirectory(generatedDir, { recursive: true }).pipe(
    Effect.catchTag("PlatformError", (e) =>
      Predicate.isTagged(e.reason, "AlreadyExists") ? Effect.void : Effect.fail(e),
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

  return {
    config: resolvedConfig,
    appDir,
    generatedDir,
  };
});

export const makeBootstrapLayer = (options: BootstrapOptions): Layer.Layer<Bootstrap> =>
  Layer.effect(
    Bootstrap,
    Effect.gen(function* () {
      const statusRef = yield* Ref.make<BootstrapStatus>(BootstrapStatus.Pending());
      const ready = yield* Deferred.make<BootstrapState, BootstrapFailure>();

      const markReady = Effect.fn("Bootstrap.markReady")(function* (state: BootstrapState) {
        yield* Ref.set(statusRef, BootstrapStatus.Ready({ state }));
        yield* Deferred.succeed(ready, state).pipe(Effect.asVoid);
      });

      const markFailed = Effect.fn("Bootstrap.markFailed")(function* (error: BootstrapFailure) {
        yield* Ref.set(statusRef, BootstrapStatus.Failed({ error }));
        yield* Deferred.fail(ready, error).pipe(Effect.asVoid);
      });

      const transition = (
        effect: Effect.Effect<void, PluginFileSystemError, FileSystem.FileSystem>,
        status: BootstrapStatus,
      ): readonly [
        Effect.Effect<void, PluginFileSystemError, FileSystem.FileSystem>,
        BootstrapStatus,
      ] => [effect, status];

      const initialize = Effect.fn("Bootstrap.initialize")(function* (
        resolvedConfig: ResolvedConfig,
      ) {
        yield* Effect.flatten(
          Ref.modify(
            statusRef,
            (
              status,
            ): readonly [
              Effect.Effect<void, PluginFileSystemError, FileSystem.FileSystem>,
              BootstrapStatus,
            ] =>
              BootstrapStatus.$match(status, {
                Pending: () =>
                  transition(
                    makeState(resolvedConfig, options).pipe(
                      Effect.tap(markReady),
                      Effect.tapError(markFailed),
                      Effect.asVoid,
                    ),
                    BootstrapStatus.Bootstrapping(),
                  ),
                Bootstrapping: () => transition(Deferred.await(ready).pipe(Effect.asVoid), status),
                Ready: () => transition(Effect.void, status),
                Failed: ({ error }) => transition(Effect.fail(error), status),
              }),
          ),
        );
      });

      const awaitReady: Effect.Effect<BootstrapState, PluginBootstrapError | BootstrapFailure> =
        Ref.get(statusRef).pipe(
          Effect.flatMap((status) =>
            BootstrapStatus.$match(status, {
              Pending: () => Effect.fail(PluginBootstrapError.notReady()),
              Bootstrapping: () => Deferred.await(ready),
              Ready: ({ state }) => Effect.succeed(state),
              Failed: ({ error }) => Effect.fail(error),
            }),
          ),
        );

      return {
        initialize,
        awaitReady,
      } satisfies BootstrapService;
    }).pipe(Effect.annotateLogs({ service: "Bootstrap" })),
  );
