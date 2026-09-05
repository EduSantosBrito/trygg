/**
 * @since 1.0.0
 * Node.js implementation of DevPlatform service
 *
 * Uses SSR-loaded handler factory for @effect/platform layer composition,
 * ensuring Router.Live identity matches between plugin and user code.
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
  type DevApiErrors,
  type DevApiHandle,
  type DevApiOptions,
  DevPlatform,
  type DevPlatformService,
  ImportError,
  traceApiRequestReceived,
} from "./dev-platform.js";
import * as Trace from "../trace/index.js";
import * as CallbackRuntime from "./callback-runtime.js";

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

const ApiUnavailableBody = Schema.fromJsonString(
  Schema.Struct({
    error: Schema.String,
    message: Schema.String,
  }),
);
const encodeApiUnavailableBody = Schema.encodeEffect(ApiUnavailableBody);

// =============================================================================
// Internal State
// =============================================================================

interface HandlerInstance {
  readonly handler: (req: IncomingMessage, res: ServerResponse) => void;
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
// Handler Initialization
// =============================================================================

/**
 * Initialize handler using SSR-loaded factory.
 * All @effect/platform layer composition happens inside the factory,
 * which was SSR-loaded from the same module graph as the user's api.ts.
 * @internal
 */
const acquireHandler: (
  ownerScope: Scope.Scope,
  options: DevApiOptions,
) => Effect.Effect<HandlerInstance, ApiInitError> = Effect.fn("NodeDevPlatform.acquireHandler")(
  function* (ownerScope, options) {
    return yield* Effect.uninterruptibleMask((restore) =>
      Effect.gen(function* () {
        if (Predicate.isTagged(ownerScope.state, "Closed")) return yield* Effect.interrupt;
        const candidateScope = yield* Scope.fork(ownerScope);
        const candidate = Effect.gen(function* () {
          yield* Trace.emit("api.handler.loading", () => ({ module_path: "app/api.ts" }));
          if (Predicate.isTagged(candidateScope.state, "Closed")) return yield* Effect.interrupt;
          const mod = yield* options.loadApiModule();

          yield* Trace.emit("api.handler.loaded", () => ({
            module_path: "app/api.ts",
            module_type: Trace.valueType(mod),
          }));

          if (Predicate.isTagged(candidateScope.state, "Closed")) return yield* Effect.interrupt;
          const factory = options.handlerFactory;
          const apiLive = yield* factory
            .makeApiLayer(mod)
            .pipe(
              Effect.mapError(
                (cause) => new ApiInitError({ message: "Failed to detect API layer", cause }),
              ),
            );
          if (Predicate.isTagged(candidateScope.state, "Closed")) return yield* Effect.interrupt;
          if (factory.makeNodeHandler === undefined) {
            return yield* new ApiInitError({
              message: "makeNodeHandler not available in handler factory",
            });
          }

          const result = yield* Effect.acquireRelease(
            factory
              .makeNodeHandler(apiLive)
              .pipe(
                Effect.mapError(
                  (cause) => new ApiInitError({ message: "Failed to create API handler", cause }),
                ),
              ),
            (result) => result.dispose,
          );
          if (Predicate.isTagged(candidateScope.state, "Closed")) return yield* Effect.interrupt;
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
  },
);

// =============================================================================
// Node DevPlatform Implementation
// =============================================================================

export const layer: Layer.Layer<DevPlatform | FileSystem.FileSystem, ImportError> = Layer.unwrap(
  Effect.gen(function* () {
    const nodeFs = yield* importNodeFileSystem;
    const fileSystemLayer = nodeFs.layer;

    const makeApi: (
      options: DevApiOptions,
    ) => Effect.Effect<DevApiHandle, DevApiErrors, Scope.Scope> = Effect.fn(
      "NodeDevPlatform.makeApi",
    )(function* (options) {
      const ownerScope = yield* Scope.Scope;
      const state = yield* Ref.make<HandlerState>(emptyState);
      const runAdmission = yield* CallbackRuntime.make();

      const disposeCurrent = Effect.fn("NodeDevPlatform.disposeCurrent")(function* () {
        return yield* Effect.uninterruptible(
          Effect.gen(function* () {
            const current = yield* Ref.getAndSet(state, emptyState);
            yield* Option.match(current.instance, {
              onNone: () => Effect.void,
              onSome: (instance) => Scope.close(instance.scope, Exit.void),
            });
          }),
        );
      });

      const installCandidate = Effect.fn("NodeDevPlatform.installCandidate")(function* () {
        return yield* Effect.uninterruptibleMask((restore) =>
          Effect.gen(function* () {
            const candidate = yield* restore(acquireHandler(ownerScope, options));
            // Acquisition can suspend across shutdown. Decide owner liveness
            // and publication in the same synchronous state transition.
            const previous = yield* Ref.modify(
              state,
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

          const currentState = yield* Ref.get(state);

          if (Option.isNone(currentState.instance)) {
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

          const instance = currentState.instance.value;
          instance.runRequest(
            Effect.sync(() => instance.handler(req, res)).pipe(
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
