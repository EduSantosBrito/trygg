/**
 * @since 1.0.0
 * DevPlatform service for abstracting platform-specific APIs
 *
 * Uses Context.Tag pattern to provide platform-agnostic dev API handling
 * for both Bun and Node.js runtimes.
 */
import { FileSystem } from "@effect/platform";
import { Context, Data, Effect, Layer, Scope } from "effect";
import type { Connect } from "vite";

// =============================================================================
// Error Types
// =============================================================================

/**
 * Base error type for DevApi operations
 * @since 1.0.0
 */
export class DevApiError extends Data.TaggedError("DevApiError")<{
  readonly message: string;
  readonly cause?: unknown;
}> {}

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
 * Error when proxying requests fails
 * @since 1.0.0
 */
export class ProxyError extends Data.TaggedError("ProxyError")<{
  readonly message: string;
  readonly cause?: unknown;
}> {}

/**
 * Error when configuration is invalid
 * @since 1.0.0
 */
export class InvalidConfigError extends Data.TaggedError("InvalidConfigError")<{
  readonly message: string;
  readonly cause?: unknown;
}> {}

/**
 * Union of all DevApi errors
 * @since 1.0.0
 */
export type DevApiErrors = ImportError | ApiInitError | ProxyError | InvalidConfigError;

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
 * Options for creating a DevApi
 * @since 1.0.0
 */
export interface DevApiOptions {
  /** Load the API module (called on init and reload) */
  readonly loadApiModule: () => Effect.Effect<Record<string, unknown>, ApiInitError>;
  /** Called when handler errors occur */
  readonly onError: (error: unknown) => Effect.Effect<void>;
  /** Base URL for the dev server */
  readonly baseUrl: string;
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
