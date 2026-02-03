/**
 * @since 1.0.0
 * DevPlatform service for abstracting platform-specific APIs
 *
 * Uses Context.Tag pattern to provide platform-agnostic dev API handling
 * for both Bun and Node.js runtimes.
 */
import { FileSystem } from "@effect/platform";
import { Context, Data, Effect, Layer, Scope } from "effect";
import type { IncomingMessage, ServerResponse } from "node:http";
import type { Connect } from "vite";

// =============================================================================
// Error Types
// =============================================================================

/**
 * Error when importing a platform module fails
 * @since 1.0.0
 */
export class ImportError extends Data.TaggedError("ImportError")<{
  readonly module: string;
  readonly message: string;
  readonly cause?: unknown;
}> {}

/**
 * Error when API initialization fails
 * @since 1.0.0
 */
export class ApiInitError extends Data.TaggedError("ApiInitError")<{
  readonly message: string;
  readonly cause?: unknown;
}> {}

/**
 * Union of all DevApi errors
 * @since 1.0.0
 */
export type DevApiErrors = ImportError | ApiInitError;

// =============================================================================
// Types
// =============================================================================

/**
 * DevApiHandle represents a running dev API instance
 * @since 1.0.0
 */
export interface DevApiHandle {
  /** Connect middleware for Vite integration */
  readonly middleware: Connect.NextHandleFunction;
  /** Reload the API (call after api.ts changes) */
  readonly reload: Effect.Effect<void, DevApiErrors>;
  /** Dispose of the API and cleanup resources */
  readonly dispose: Effect.Effect<void>;
}

/**
 * SSR-loaded handler factory functions.
 *
 * These are SSR-loaded via a virtual module so all @effect/platform imports
 * resolve from the project root — same module instance as the user's api.ts.
 * Prevents Router.Live reference identity mismatches across module boundaries.
 * @since 1.0.0
 */
export interface HandlerFactory {
  /** Extract default export from api module, validate as API layer */
  readonly detectAndComposeLayer: (
    mod: Record<string, unknown>,
  ) => Effect.Effect<Layer.Layer<unknown>, unknown>;
  /** Create a Node.js handler from a composed API layer (Node platform only) */
  readonly createNodeHandler?: (apiLive: Layer.Layer<unknown>) => Effect.Effect<
    {
      readonly handler: (req: IncomingMessage, res: ServerResponse) => void;
      readonly dispose: Effect.Effect<void>;
    },
    unknown,
    Scope.Scope
  >;
  /** Create a web-standard handler from a composed API layer */
  readonly createWebHandler: (apiLive: Layer.Layer<unknown>) => {
    readonly handler: (request: Request) => Promise<Response>;
    readonly dispose: () => void;
  };
}

/**
 * Options for creating a DevApi
 * @since 1.0.0
 */
export interface DevApiOptions {
  /** Load the API module (called on init and reload) */
  readonly loadApiModule: () => Effect.Effect<Record<string, unknown>, ApiInitError>;
  /** Called when handler errors occur */
  readonly onError: (error: unknown) => Effect.Effect<void>;
  /**
   * SSR-loaded handler factory. When provided, all @effect/platform layer
   * composition uses the SSR module graph's instances, avoiding cross-module
   * Router.Live identity mismatches with the bundled plugin.
   */
  readonly handlerFactory: HandlerFactory;
}

/**
 * DevPlatform service interface
 * Abstracts platform-specific file system and dev API creation
 * @since 1.0.0
 */
export interface DevPlatformService {
  /** Layer providing the platform's FileSystem implementation */
  readonly fileSystemLayer: Layer.Layer<FileSystem.FileSystem>;
  /**
   * Create a dev API instance
   * Returns a handle with middleware, reload, and dispose capabilities
   */
  readonly createDevApi: (
    options: DevApiOptions,
  ) => Effect.Effect<DevApiHandle, DevApiErrors, Scope.Scope>;
}

// =============================================================================
// Context Tag
// =============================================================================

/**
 * Context.Tag for the DevPlatform service
 * @since 1.0.0
 */
export class DevPlatform extends Context.Tag("trygg/DevPlatform")<
  DevPlatform,
  DevPlatformService
>() {}
