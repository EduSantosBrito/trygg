import type { ResolvedConfig } from "vite";
import { Cause, Data, Deferred, Effect, Exit, FileSystem, Layer, Predicate, Ref } from "effect";
import * as Context from "effect/Context";
import * as nodePath from "node:path";
import type { Platform, TryggConfig } from "../config.js";
import { PluginBootstrapError, PluginFileSystemError } from "./errors.js";

interface BootstrapState {
  readonly config: ResolvedConfig;
  readonly appDir: string;
  readonly generatedDir: string;
}

type BootstrapFailure = PluginBootstrapError | PluginFileSystemError;

type BootstrapStatus = Data.TaggedEnum<{
  readonly Pending: {};
  readonly Bootstrapping: {};
  readonly Ready: { readonly state: BootstrapState };
  readonly Failed: { readonly cause: Cause.Cause<BootstrapFailure> };
}>;

const BootstrapStatus = Data.taggedEnum<BootstrapStatus>();

export interface BootstrapService {
  readonly initialize: (
    resolvedConfig: ResolvedConfig,
  ) => Effect.Effect<void, BootstrapFailure, FileSystem.FileSystem>;
  readonly awaitReady: Effect.Effect<BootstrapState, BootstrapFailure>;
}

export class Bootstrap extends Context.Service<
  Bootstrap,
  {
    readonly initialize: (
      resolvedConfig: ResolvedConfig,
    ) => Effect.Effect<void, BootstrapFailure, FileSystem.FileSystem>;
    readonly awaitReady: Effect.Effect<BootstrapState, BootstrapFailure>;
  }
>()("trygg/vite/Bootstrap") {
  static readonly layer = (
    options: BootstrapOptions,
    initializeState: typeof makeState = makeState,
  ): Layer.Layer<Bootstrap> => makeLayer(options, initializeState);
}

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

const makeLayer = (
  options: BootstrapOptions,
  initializeState: typeof makeState = makeState,
): Layer.Layer<Bootstrap> =>
  Layer.effect(
    Bootstrap,
    Effect.gen(function* () {
      const statusRef = yield* Ref.make<BootstrapStatus>(BootstrapStatus.Pending());
      const ready = yield* Deferred.make<BootstrapState, BootstrapFailure>();

      const markReady = Effect.fn("Bootstrap.markReady")(function* (state: BootstrapState) {
        yield* Ref.set(statusRef, BootstrapStatus.Ready({ state }));
        yield* Deferred.succeed(ready, state).pipe(Effect.asVoid);
      });

      const markFailed = Effect.fn("Bootstrap.markFailed")(function* (
        cause: Cause.Cause<BootstrapFailure>,
      ) {
        yield* Ref.set(statusRef, BootstrapStatus.Failed({ cause }));
        yield* Deferred.failCause(ready, cause).pipe(Effect.asVoid);
      });

      const initialize = Effect.fn("Bootstrap.initialize")(function* (
        resolvedConfig: ResolvedConfig,
      ) {
        return yield* Effect.uninterruptibleMask((restore) =>
          Effect.gen(function* () {
            const previous = yield* Ref.modify(
              statusRef,
              (status): readonly [BootstrapStatus, BootstrapStatus] =>
                BootstrapStatus.$is("Pending")(status)
                  ? [status, BootstrapStatus.Bootstrapping()]
                  : [status, status],
            );

            if (BootstrapStatus.$is("Pending")(previous)) {
              const exit = yield* restore(initializeState(resolvedConfig, options)).pipe(
                Effect.exit,
              );
              if (Exit.isSuccess(exit)) {
                yield* markReady(exit.value);
                return;
              }
              yield* markFailed(exit.cause);
              return yield* Effect.failCause(exit.cause);
            }
            if (BootstrapStatus.$is("Bootstrapping")(previous)) {
              return yield* restore(Deferred.await(ready)).pipe(Effect.asVoid);
            }
            if (BootstrapStatus.$is("Ready")(previous)) return;
            return yield* Effect.failCause(previous.cause);
          }),
        );
      });

      const awaitReady: Effect.Effect<BootstrapState, BootstrapFailure> = Ref.get(statusRef).pipe(
        Effect.flatMap((status) =>
          BootstrapStatus.$match(status, {
            Pending: () => Effect.fail(PluginBootstrapError.notReady()),
            Bootstrapping: () => Deferred.await(ready),
            Ready: ({ state }) => Effect.succeed(state),
            Failed: ({ cause }) => Effect.failCause(cause),
          }),
        ),
      );

      return {
        initialize,
        awaitReady,
      } satisfies BootstrapService;
    }).pipe(Effect.annotateLogs({ service: "Bootstrap" })),
  );
