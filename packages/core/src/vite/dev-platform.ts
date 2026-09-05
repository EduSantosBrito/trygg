/**
 * @since 1.0.0
 * DevPlatform service for abstracting platform-specific APIs
 *
 * Uses Context.Service pattern to provide platform-agnostic dev API handling
 * for both Bun and Node.js runtimes.
 */
import { FileSystem } from "effect";
import { Effect, Layer, Schema, Scope } from "effect";
import * as Context from "effect/Context";
import type { IncomingMessage, ServerResponse } from "node:http";
import type { Connect } from "vite";
import * as Trace from "../trace/index.js";

// =============================================================================
// Error Types
// =============================================================================

/**
 * Error when importing a platform module fails
 * @since 1.0.0
 */
export class ImportError extends Schema.TaggedError<ImportError>()("ImportError", {
  module: Schema.String,
  message: Schema.String,
  cause: Schema.optional(Schema.Unknown),
}) {}

/**
 * Error when API initialization fails
 * @since 1.0.0
 */
export class ApiInitError extends Schema.TaggedError<ApiInitError>()("ApiInitError", {
  message: Schema.String,
  cause: Schema.optional(Schema.Unknown),
}) {}

/** Error raised while adapting a development HTTP request or response. */
export class ApiRequestError extends Schema.TaggedError<ApiRequestError>()("ApiRequestError", {
  reason: Schema.Literals(["Aborted", "BodyTooLarge", "ReadFailed", "WriteFailed"]),
  message: Schema.String,
  cause: Schema.optional(Schema.Unknown),
  limit: Schema.optional(Schema.Number),
}) {}

/**
 * Union of all DevApi errors
 * @since 1.0.0
 */
export type DevApiErrors = ImportError | ApiInitError;

/** Maximum buffered request body accepted by development HTTP bridges. */
export const MAX_REQUEST_BODY_BYTES = 1024 * 1024;

/** Strip query and fragment data before a request URL enters routine telemetry. */
export const requestPathname = (url: string | undefined): string => {
  if (url === undefined) return "";
  const queryIndex = url.indexOf("?");
  const fragmentIndex = url.indexOf("#");
  const end =
    queryIndex === -1
      ? fragmentIndex
      : fragmentIndex === -1
        ? queryIndex
        : Math.min(queryIndex, fragmentIndex);
  const target = end === -1 ? url : url.slice(0, end);
  if (target === "*") return target;

  const schemeIndex = target.indexOf("://");
  const authorityStart = target.startsWith("//") ? 2 : schemeIndex === -1 ? -1 : schemeIndex + 3;
  if (authorityStart !== -1) {
    const pathStart = target.indexOf("/", authorityStart);
    return pathStart === -1 ? "/" : target.slice(pathStart);
  }

  return target.startsWith("/") ? target : "";
};

/** Emit the canonical request event without query or fragment data. */
export const traceApiRequestReceived = (
  method: string | undefined,
  url: string | undefined,
): Effect.Effect<void> =>
  Trace.emit("api.request.received", () => ({
    method: method ?? "GET",
    pathname: requestPathname(url),
  }));

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
  readonly makeApiLayer: (
    mod: Record<string, unknown>,
  ) => Effect.Effect<Layer.Layer<unknown>, unknown>;
  /** Create a Node.js handler from a composed API layer (Node platform only) */
  readonly makeNodeHandler?: (apiLive: Layer.Layer<unknown>) => Effect.Effect<
    {
      readonly handler: (req: IncomingMessage, res: ServerResponse) => void;
      readonly dispose: Effect.Effect<void>;
    },
    unknown,
    Scope.Scope
  >;
  /** Acquire a web-standard handler and all of its Layer resources eagerly. */
  readonly makeWebHandler: (apiLive: Layer.Layer<unknown>) => Effect.Effect<
    {
      readonly handler: (request: Request) => Promise<Response>;
      readonly dispose: Effect.Effect<void>;
    },
    unknown,
    Scope.Scope
  >;
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
 * Abstracts platform-specific file system and dev API construction
 * @since 1.0.0
 */
export interface DevPlatformService {
  /** Layer providing the platform's FileSystem implementation */
  readonly fileSystemLayer: Layer.Layer<FileSystem.FileSystem>;
  /**
   * Make a dev API instance
   * Returns a handle with middleware, reload, and dispose capabilities
   */
  readonly makeApi: (
    options: DevApiOptions,
  ) => Effect.Effect<DevApiHandle, DevApiErrors, Scope.Scope>;
}

// =============================================================================
// Service Keys
// =============================================================================

/**
 * Service key for the DevPlatform service
 * @since 1.0.0
 */
export interface DevPlatform extends Context.Service<
  DevPlatform,
  {
    readonly fileSystemLayer: Layer.Layer<FileSystem.FileSystem>;
    readonly makeApi: (
      options: DevApiOptions,
    ) => Effect.Effect<DevApiHandle, DevApiErrors, Scope.Scope>;
  }
> {}

export const DevPlatform = Context.Service<
  DevPlatform,
  {
    readonly fileSystemLayer: Layer.Layer<FileSystem.FileSystem>;
    readonly makeApi: (
      options: DevApiOptions,
    ) => Effect.Effect<DevApiHandle, DevApiErrors, Scope.Scope>;
  }
>("trygg/DevPlatform");

// =============================================================================
// ServerPlatform — codegen fragments for the production server entry
// =============================================================================

/**
 * Platform-specific code fragments for the generated production server.
 * Uses subpath imports to avoid barrel re-exports pulling in optional
 * dependencies (e.g. @effect/cluster via @effect/platform-node barrel).
 * @since 1.0.0
 */
export interface ServerPlatformService {
  /** Import statements for platform HTTP server + runtime */
  readonly imports: string;
  /** Expression: HTTP server layer binding PORT/HOST */
  readonly serverLayer: string;
  /** Module namespace for `*.runMain(...)` */
  readonly runtime: string;
}

/**
 * Service key for platform-specific production server codegen.
 * @since 1.0.0
 */
export interface ServerPlatform extends Context.Service<
  ServerPlatform,
  {
    readonly imports: string;
    readonly serverLayer: string;
    readonly runtime: string;
  }
> {}

export const ServerPlatform = Context.Service<
  ServerPlatform,
  {
    readonly imports: string;
    readonly serverLayer: string;
    readonly runtime: string;
  }
>("trygg/ServerPlatform");

/** Node.js server platform — @effect/platform-node subpath imports */
export const NodeServerPlatform = {
  layer: Layer.succeed(ServerPlatform, {
    imports: [
      'import * as NodeHttpServer from "@effect/platform-node/NodeHttpServer"',
      'import * as NodeRuntime from "@effect/platform-node/NodeRuntime"',
      'import { createServer } from "node:http"',
    ].join("\n"),
    serverLayer: "NodeHttpServer.layer(() => createServer(), { port: PORT, host: HOST })",
    runtime: "NodeRuntime",
  }),
};

/** Bun server platform — @effect/platform-bun subpath imports */
export const BunServerPlatform = {
  layer: Layer.succeed(ServerPlatform, {
    imports: [
      'import * as BunHttpServer from "@effect/platform-bun/BunHttpServer"',
      'import * as BunRuntime from "@effect/platform-bun/BunRuntime"',
    ].join("\n"),
    serverLayer: "makeBunServerLayer({ port: PORT, hostname: HOST })",
    runtime: "BunRuntime",
  }),
};
