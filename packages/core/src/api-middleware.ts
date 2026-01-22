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
import { HttpApi, HttpApiBuilder, HttpServer } from "@effect/platform"
import * as NodeHttpServer from "@effect/platform-node/NodeHttpServer"
import { Data, Effect, Either, Exit, Layer, Option, Ref, Runtime, Schema, Scope } from "effect"
import type { IncomingMessage, ServerResponse } from "node:http"
import type { Connect } from "vite"

// =============================================================================
// Error Types - Yieldable via Data.TaggedError
// =============================================================================

/**
 * API middleware initialization error.
 * Thrown when the API module fails to load or initialize.
 * @since 1.0.0
 */
export class ApiInitError extends Data.TaggedError("ApiInitError")<{
  readonly message: string
  readonly cause?: unknown
}> {}

// =============================================================================
// Schema for Dynamic Module Validation
// =============================================================================

/**
 * Schema for validating that a dynamic import's ApiLive export is a Layer.
 * Uses Layer.isLayer for runtime validation and declares the expected type
 * (Layer<never>) at compile time. If the user exports a Layer with
 * unsatisfied requirements, it will fail at runtime when building the runtime.
 * @internal
 */
const ApiLiveSchema = Schema.declare(
  (u: unknown): u is Layer.Layer<HttpApi.Api> => Layer.isLayer(u),
  { identifier: "ApiLive", description: "A Layer providing HttpApi.Api" }
)

// =============================================================================
// Internal State Type
// =============================================================================

/**
 * Internal state for API middleware.
 * Uses Option for nullable fields to avoid null checks.
 * @internal
 */
interface MiddlewareState {
  readonly handler: Option.Option<(req: IncomingMessage, res: ServerResponse) => void>
  readonly dispose: Option.Option<Effect.Effect<void>>
  readonly lastError: Option.Option<unknown>
}

// =============================================================================
// Public Types
// =============================================================================

/**
 * Options for creating API middleware
 * @since 1.0.0
 */
export interface ApiMiddlewareOptions {
  /** Load the API module (called on init and reload). Returns the module record with ApiLive. */
  readonly loadApiModule: () => Effect.Effect<Record<string, unknown>, ApiInitError>
  /** Called when handler errors occur (for logging/observation) */
  readonly onError: (error: unknown) => Effect.Effect<void>
}

/**
 * API Middleware interface
 * @since 1.0.0
 */
export interface ApiMiddleware {
  /** Connect middleware function (Vite boundary - must be callback) */
  readonly middleware: Connect.NextHandleFunction
  /** Reload handlers (call after api.ts changes) */
  readonly reload: Effect.Effect<void, ApiInitError>
  /** Cleanup resources */
  readonly dispose: Effect.Effect<void>
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
  message: string
): Effect.Effect<void> =>
  Effect.try({
    try: () => {
      res.statusCode = statusCode
      res.setHeader("Content-Type", "application/json")
      res.end(JSON.stringify({ error, message }))
    },
    catch: () => {
      // Fallback if JSON.stringify throws (e.g. circular references in message)
      res.statusCode = statusCode
      res.setHeader("Content-Type", "text/plain")
      res.end(error)
    },
  }).pipe(Effect.ignore)

/**
 * Initialize or reinitialize the API handler.
 * Uses Effect's NodeHttpServer.makeHandler for native Node.js request handling.
 * @internal
 */
const initHandler = (
  state: Ref.Ref<MiddlewareState>,
  options: ApiMiddlewareOptions
): Effect.Effect<void, ApiInitError> =>
  Effect.gen(function* () {
    // Dispose previous handler if exists
    const currentState = yield* Ref.get(state)
    if (Option.isSome(currentState.dispose)) {
      yield* currentState.dispose.value.pipe(Effect.ignore)
    }

    // Load API module
    const loadResult = yield* options.loadApiModule().pipe(Effect.either)

    // Module failed to load - record error and bail out
    if (Either.isLeft(loadResult)) {
      yield* Ref.set(state, {
        handler: Option.none(),
        dispose: Option.none(),
        lastError: Option.some(loadResult.left),
      })
      yield* options.onError(loadResult.left)
      return
    }

    // Validate ApiLive export exists and is a Layer using Schema
    const apiLiveResult = yield* Schema.decodeUnknown(ApiLiveSchema)(loadResult.right.ApiLive).pipe(
      Effect.mapError((cause) => new ApiInitError({
        message: "API module must export ApiLive as a Layer",
        cause,
      })),
      Effect.either
    )

    if (Either.isLeft(apiLiveResult)) {
      yield* Ref.set(state, {
        handler: Option.none(),
        dispose: Option.none(),
        lastError: Option.some(apiLiveResult.left),
      })
      yield* options.onError(apiLiveResult.left)
      return
    }

    // Build the full layer with API handlers and required services
    const apiLayer = Layer.mergeAll(
      apiLiveResult.right,
      HttpApiBuilder.Router.Live,
      HttpApiBuilder.Middleware.layer,
      HttpServer.layerContext
    )

    // Create a scope for this handler's lifecycle
    const handlerScope = yield* Scope.make()

    // Build runtime from layer and create handler
    const handlerResult = yield* Effect.gen(function* () {
      const runtime = yield* Layer.toRuntime(apiLayer)
      const httpApp = yield* Effect.provide(HttpApiBuilder.httpApp, runtime)
      return yield* NodeHttpServer.makeHandler(httpApp).pipe(
        Effect.provide(runtime)
      )
    }).pipe(
      Scope.extend(handlerScope),
      Effect.either
    )

    if (Either.isLeft(handlerResult)) {
      yield* Scope.close(handlerScope, Exit.fail(handlerResult.left))
      const error = new ApiInitError({
        message: "Failed to initialize API handler",
        cause: handlerResult.left,
      })
      yield* Ref.set(state, {
        handler: Option.none(),
        dispose: Option.none(),
        lastError: Option.some(error),
      })
      yield* options.onError(error)
      return
    }

    yield* Ref.set(state, {
      handler: Option.some(handlerResult.right),
      dispose: Option.some(
        Scope.close(handlerScope, Exit.void).pipe(Effect.ignore)
      ),
      lastError: Option.none(),
    })
    return
  })

/**
 * Dispose middleware resources.
 * @internal
 */
const disposeEffect = (
  state: Ref.Ref<MiddlewareState>
): Effect.Effect<void> =>
  Effect.gen(function* () {
    const currentState = yield* Ref.get(state)
    yield* Option.match(currentState.dispose, {
      onNone: () => Effect.void,
      onSome: (dispose) => dispose,
    })
    yield* Ref.set(state, {
      handler: Option.none(),
      dispose: Option.none(),
      lastError: Option.none(),
    })
  })

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
  options: ApiMiddlewareOptions
): Effect.Effect<ApiMiddleware, ApiInitError, Scope.Scope> =>
  Effect.gen(function* () {
    // Capture runtime for use in middleware callback (Vite boundary)
    const runtime = yield* Effect.runtime<never>()

    // Create state ref
    const state = yield* Ref.make<MiddlewareState>({
      handler: Option.none(),
      dispose: Option.none(),
      lastError: Option.none(),
    })

    // Initialize handler
    yield* initHandler(state, options)

    // Register cleanup finalizer - Effect executes the returned effect when Scope closes.
    // No need to yield disposeEffect here; addFinalizer defers execution to scope teardown.
    yield* Effect.addFinalizer(() => disposeEffect(state))

    /**
     * Connect middleware function.
     * This is the Vite/Connect boundary where Effect meets non-Effect.
     * The inner logic is wrapped in an Effect for consistency.
     */
    const middleware: Connect.NextHandleFunction = (req, res, next) => {
      if (!req.url?.startsWith("/api/")) {
        return next()
      }

      const effect = Effect.gen(function* () {
        const currentState = yield* Ref.get(state)

        if (Option.isNone(currentState.handler)) {
          const errorMessage = Option.match(currentState.lastError, {
            onNone: () => "Check console for errors",
            onSome: (e) => (e instanceof Error ? e.message : String(e)),
          })
          yield* options.onError(new ApiInitError({ message: "Handler not available" }))
          yield* sendErrorResponse(res, 500, "API handler not available", errorMessage)
          return
        }

        // Effect's NodeHttpServer.makeHandler handles all request/response streaming
        currentState.handler.value(req, res)
      })

      Runtime.runSync(runtime)(effect)
    }

    return {
      middleware,
      reload: initHandler(state, options),
      dispose: disposeEffect(state),
    }
  })
