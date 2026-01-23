/**
 * API Middleware for Vite Dev Server
 *
 * Routes `/api/*` requests to Effect HttpApi handlers using Effect's
 * native Node.js HTTP server utilities.
 *
 * Effect-native implementation:
 * - Data.TaggedError for yieldable errors
 * - NodeHttpServer.makeHandler for Node-native request handling
 * - Ref for mutable state
 * - Scope for resource management
 *
 * @since 1.0.0
 */
import { HttpApi, HttpApiBuilder, HttpApiGroup, HttpServer } from "@effect/platform";
import * as NodeHttpServer from "@effect/platform-node/NodeHttpServer";
import { Data, Effect, Exit, Layer, Option, Ref, Runtime, Schema, Scope } from "effect";
import type { IncomingMessage, ServerResponse } from "node:http";
import type { Connect } from "vite";

// =============================================================================
// Error Types - Yieldable via Data.TaggedError
// =============================================================================

/**
 * API middleware initialization error.
 * Thrown when the API module fails to load or initialize.
 * @since 1.0.0
 */
export class ApiInitError extends Data.TaggedError("ApiInitError")<{
  readonly message: string;
  readonly cause?: unknown;
}> {}

// =============================================================================
// Runtime Type Detection
// =============================================================================

/**
 * Detect HttpApi definitions from module exports at runtime.
 * Uses HttpApi.isHttpApi (checks for @effect/platform/HttpApi TypeId).
 * Narrows to the type expected by HttpApiBuilder.api via Schema.declare.
 * @internal
 */
const HttpApiValueSchema = Schema.declare(
  (
    u: unknown,
  ): u is HttpApi.HttpApi<string, HttpApiGroup.HttpApiGroup.AnyWithProps, never, never> =>
    HttpApi.isHttpApi(u),
  { identifier: "HttpApiValue", description: "An HttpApi definition" },
);

/**
 * Narrows a dynamically composed Layer to the expected Layer<HttpApi.Api> type.
 * The runtime check verifies Layer.isLayer; the type narrowing is trusted based
 * on correct composition of HttpApiBuilder.api + handler layers.
 * @internal
 */
const ComposedApiLayerSchema = Schema.declare(
  (u: unknown): u is Layer.Layer<HttpApi.Api> => Layer.isLayer(u),
  { identifier: "ComposedApiLayer", description: "A composed Layer providing HttpApi.Api" },
);

/**
 * Detect and compose the API layer from a dynamically imported module.
 *
 * Scans all exports for:
 * - Exactly one HttpApi definition (detected via HttpApi.isHttpApi)
 * - Zero or more handler Layers (detected via Layer.isLayer)
 *
 * Composes them into a single Layer<HttpApi.Api> using HttpApiBuilder.api.
 * @internal
 */
const detectApiLayer = (
  mod: Record<string, unknown>,
): Effect.Effect<Layer.Layer<HttpApi.Api>, ApiInitError> =>
  Effect.gen(function* () {
    const values = Object.values(mod);

    // Find all HttpApi definitions
    const httpApis = values.filter(HttpApi.isHttpApi);
    if (httpApis.length === 0) {
      return yield* new ApiInitError({
        message: "API module must export an HttpApi definition (created via HttpApi.make)",
      });
    }
    if (httpApis.length > 1) {
      return yield* new ApiInitError({
        message:
          "API module must export exactly one HttpApi definition, found " + String(httpApis.length),
      });
    }

    // Narrow the HttpApi to the type expected by HttpApiBuilder.api
    const api = yield* Schema.decodeUnknown(HttpApiValueSchema)(httpApis[0]).pipe(
      Effect.mapError(
        (cause) => new ApiInitError({ message: "Failed to validate HttpApi export", cause }),
      ),
    );

    // Find all handler Layers (exclude the HttpApi itself — HttpApi is a function, not a Layer)
    const handlerLayers = values.filter(
      (v): v is Layer.Layer<unknown, unknown, unknown> => Layer.isLayer(v) && !HttpApi.isHttpApi(v),
    );

    // Compose: HttpApiBuilder.api creates base layer requiring handler group services.
    // Layer.provide eliminates requirements satisfied by each handler layer.
    // Layer<never, unknown, unknown> is the "any layer" type via variance:
    //   - ROut=never (contravariant): any output is assignable
    //   - E=unknown (covariant): widest error
    //   - RIn=unknown (covariant): widest requirement
    // ComposedApiLayerSchema narrows the result to Layer<HttpApi.Api> after composition.
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
// Internal State Type
// =============================================================================

/**
 * Internal state for API middleware.
 * Uses Option for nullable fields to avoid null checks.
 * @internal
 */
interface MiddlewareState {
  readonly handler: Option.Option<(req: IncomingMessage, res: ServerResponse) => void>;
  readonly dispose: Option.Option<Effect.Effect<void>>;
  readonly lastError: Option.Option<unknown>;
}

// =============================================================================
// Public Types
// =============================================================================

/**
 * Options for creating API middleware
 * @since 1.0.0
 */
export interface ApiMiddlewareOptions {
  /** Load the API module (called on init and reload). Returns the module record with HttpApi + handler Layers. */
  readonly loadApiModule: () => Effect.Effect<Record<string, unknown>, ApiInitError>;
  /** Called when handler errors occur (for logging/observation) */
  readonly onError: (error: unknown) => Effect.Effect<void>;
}

/**
 * API Middleware interface
 * @since 1.0.0
 */
export interface ApiMiddleware {
  /** Connect middleware function (Vite boundary - must be callback) */
  readonly middleware: Connect.NextHandleFunction;
  /** Reload handlers (call after api.ts changes) */
  readonly reload: Effect.Effect<void, ApiInitError>;
  /** Cleanup resources */
  readonly dispose: Effect.Effect<void>;
}

// =============================================================================
// Internal Helper Effects
// =============================================================================

/**
 * Send JSON error response.
 * @internal
 */
const sendErrorResponse = (
  res: ServerResponse,
  statusCode: number,
  error: string,
  message: string,
): Effect.Effect<void> =>
  Effect.try({
    try: () => {
      res.statusCode = statusCode;
      res.setHeader("Content-Type", "application/json");
      res.end(JSON.stringify({ error, message }));
    },
    catch: () => {
      // Fallback if JSON.stringify throws (e.g. circular references in message)
      res.statusCode = statusCode;
      res.setHeader("Content-Type", "text/plain");
      res.end(error);
    },
  }).pipe(Effect.ignore);

/** Set error state and notify. @internal */
const setErrorState = (
  state: Ref.Ref<MiddlewareState>,
  options: ApiMiddlewareOptions,
  error: unknown,
): Effect.Effect<void> =>
  Ref.set(state, {
    handler: Option.none(),
    dispose: Option.none(),
    lastError: Option.some(error),
  }).pipe(Effect.flatMap(() => options.onError(error)));

/**
 * Initialize or reinitialize the API handler.
 * Detects HttpApi + handler Layers from module exports, composes them,
 * and creates a Node.js request handler via NodeHttpServer.makeHandler.
 * @internal
 */
const initHandler = (
  state: Ref.Ref<MiddlewareState>,
  options: ApiMiddlewareOptions,
): Effect.Effect<void, ApiInitError> =>
  Effect.gen(function* () {
    // Dispose previous handler if exists
    const currentState = yield* Ref.get(state);
    yield* Option.match(currentState.dispose, {
      onNone: () => Effect.void,
      onSome: (dispose) => dispose.pipe(Effect.ignore),
    });

    // Load API module
    const mod = yield* options.loadApiModule().pipe(
      Effect.tapError((error) => setErrorState(state, options, error)),
      Effect.option,
    );
    if (Option.isNone(mod)) return;

    // Detect HttpApi + handler Layers from module exports and compose
    const apiLive = yield* detectApiLayer(mod.value).pipe(
      Effect.tapError((error) => setErrorState(state, options, error)),
      Effect.option,
    );
    if (Option.isNone(apiLive)) return;

    // Build the full layer with API handlers and required services
    const apiLayer = Layer.mergeAll(
      apiLive.value,
      HttpApiBuilder.Router.Live,
      HttpApiBuilder.Middleware.layer,
      HttpServer.layerContext,
    );

    // Create a scope for this handler's lifecycle
    const handlerScope = yield* Scope.make();

    // Build runtime from layer and create handler
    const handler = yield* Effect.gen(function* () {
      const runtime = yield* Layer.toRuntime(apiLayer);
      const httpApp = yield* Effect.provide(HttpApiBuilder.httpApp, runtime);
      return yield* NodeHttpServer.makeHandler(httpApp).pipe(Effect.provide(runtime));
    }).pipe(
      Scope.extend(handlerScope),
      Effect.tapError((cause) =>
        Scope.close(handlerScope, Exit.fail(cause)).pipe(
          Effect.flatMap(() =>
            setErrorState(
              state,
              options,
              new ApiInitError({ message: "Failed to initialize API handler", cause }),
            ),
          ),
        ),
      ),
      Effect.option,
    );
    if (Option.isNone(handler)) return;

    yield* Ref.set(state, {
      handler: Option.some(handler.value),
      dispose: Option.some(Scope.close(handlerScope, Exit.void).pipe(Effect.ignore)),
      lastError: Option.none(),
    });
  });

/**
 * Dispose middleware resources.
 * @internal
 */
const disposeEffect = (state: Ref.Ref<MiddlewareState>): Effect.Effect<void> =>
  Effect.gen(function* () {
    const currentState = yield* Ref.get(state);
    yield* Option.match(currentState.dispose, {
      onNone: () => Effect.void,
      onSome: (dispose) => dispose,
    });
    yield* Ref.set(state, {
      handler: Option.none(),
      dispose: Option.none(),
      lastError: Option.none(),
    });
  });

// =============================================================================
// Middleware Factory (Effect-native)
// =============================================================================

/**
 * Create API middleware for Vite dev server.
 *
 * Intercepts `/api/*` requests and routes them to Effect HttpApi handlers.
 * Supports hot reloading when api.ts changes.
 *
 * Uses Effect's NodeHttpServer.makeHandler for native Node.js request handling,
 * eliminating manual Node.js ↔ Web API conversions.
 *
 * @since 1.0.0
 */
export const createApiMiddleware = (
  options: ApiMiddlewareOptions,
): Effect.Effect<ApiMiddleware, ApiInitError, Scope.Scope> =>
  Effect.gen(function* () {
    // Capture runtime for use in middleware callback (Vite boundary)
    const runtime = yield* Effect.runtime<never>();

    // Create state ref
    const state = yield* Ref.make<MiddlewareState>({
      handler: Option.none(),
      dispose: Option.none(),
      lastError: Option.none(),
    });

    // Initialize handler
    yield* initHandler(state, options);

    // Register cleanup finalizer - Effect executes the returned effect when Scope closes.
    // No need to yield disposeEffect here; addFinalizer defers execution to scope teardown.
    yield* Effect.addFinalizer(() => disposeEffect(state));

    /**
     * Connect middleware function.
     * This is the Vite/Connect boundary where Effect meets non-Effect.
     * The inner logic is wrapped in an Effect for consistency.
     */
    const middleware: Connect.NextHandleFunction = (req, res, next) => {
      if (!req.url?.startsWith("/api/")) {
        return next();
      }

      const effect = Effect.gen(function* () {
        const currentState = yield* Ref.get(state);

        if (Option.isNone(currentState.handler)) {
          const errorMessage = Option.match(currentState.lastError, {
            onNone: () => "Check console for errors",
            onSome: (e) => (e instanceof Error ? e.message : String(e)),
          });
          yield* options.onError(new ApiInitError({ message: "Handler not available" }));
          yield* sendErrorResponse(res, 500, "API handler not available", errorMessage);
          return;
        }

        // Effect's NodeHttpServer.makeHandler handles all request/response streaming
        currentState.handler.value(req, res);
      });

      Runtime.runSync(runtime)(effect);
    };

    return {
      middleware,
      reload: initHandler(state, options),
      dispose: disposeEffect(state),
    };
  });
