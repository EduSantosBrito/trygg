# Promise to Effect Migration

Comprehensive migration of Promise-based code to Effect-native patterns throughout effect-ui's tooling layer.

## Overview

This document details the migration of `vite-plugin.ts` and `api-middleware.ts` from imperative Promise-based patterns to fully Effect-native code. The goal is reliability, proper error handling, and consistency with effect-ui's core philosophy.

### Migration Scope

| File | Lines | Current | Target |
|------|-------|---------|--------|
| `api-middleware.ts` | 209 | async/await, try/catch, mutable state | Effect.gen, Stream, Ref |
| `vite-plugin.ts` | 844 | sync fs.*, console.log, imperative loops | FileSystem service, Logger.batched |

### Core Principles

1. **Effect at maximum** - Only Vite plugin hook boundaries bridge to non-Effect
2. **Yieldable errors** - `Data.TaggedError` instead of `throw` or `Effect.fail`
3. **Non-blocking logging** - `Logger.batched` instead of sync `console.log`
4. **Services over direct I/O** - `FileSystem` service instead of `fs.*`
5. **Ref over mutation** - `Ref<State>` instead of `let` variables

---

## Key Findings

### Logger Blocking Behavior

Effect's default logger uses `console.log` **synchronously**:

```ts
// effect/packages/effect/src/internal/fiberRuntime.ts:1479
export const defaultLogger: Logger<unknown, void> = globalValue(
  Symbol.for("effect/Logger/defaultLogger"),
  () => loggerWithConsoleLog(internalLogger.stringLogger)  // ← sync console.log
)
```

For non-blocking I/O, use `Logger.batched`:

```ts
// effect/packages/effect/src/internal/fiberRuntime.ts:1578
export const batchedLogger = dual<...>(3, <Message, Output, R>(
  self: Logger<Message, Output>,
  window: Duration.DurationInput,
  f: (messages: Array<NoInfer<Output>>) => Effect.Effect<void, never, R>
): Effect.Effect<Logger<Message, void>, never, Scope.Scope | R> =>
  // Creates daemon fiber that flushes buffer every `window` duration
)
```

### Vite load() Hook is Async

From Rollup documentation, the `load` hook is `async, first`:

```ts
// Can return Promise - no need to cache!
load(id) {
  if (id === RESOLVED_VIRTUAL_ROUTES_ID) {
    return Runtime.runPromise(runtime)(scanAndGenerate())
  }
}
```

This eliminates the need for caching route scanning results.

---

## Architecture

### Effect Boundary

```
┌─────────────────────────────────────────────────────────────────┐
│                      Vite Plugin Boundary                       │
│  (Only place where Effect meets non-Effect via Runtime.run*)    │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  effectUI(): Plugin                                             │
│    │                                                            │
│    ├── Runtime<FileSystem | Logger> (built once at creation)   │
│    │                                                            │
│    ├── config()        → sync, pure object (no Effect needed)  │
│    ├── configResolved() → Runtime.runPromise(effect)            │
│    ├── configureServer()→ Runtime.runPromise(effect)            │
│    ├── resolveId()     → sync, pure (no I/O needed)            │
│    ├── load()          → Runtime.runPromise(effect)             │
│    ├── buildStart()    → Runtime.runPromise(effect)             │
│    └── buildEnd()      → Runtime.runPromise(effect)             │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                    Pure Effect Layer                            │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  Services:                                                      │
│  ├── FileSystem (from @effect/platform-node)                    │
│  └── Logger (batched, colored output)                           │
│                                                                 │
│  Operations (all return Effect):                                │
│  ├── scanRoutes(dir) → Effect<RouteFile[], PlatformError, FS>   │
│  ├── validateStructure(dir) → Effect<ValidationError[], ...>    │
│  ├── generateFiles(...) → Effect<void, PlatformError, FS>       │
│  └── createApiMiddleware(...) → Effect<ApiMiddleware, ...>      │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

### Service Dependencies

```ts
// Plugin runtime requirements
type PluginRequirements = FileSystem | Logger

// Built once at plugin creation
const PluginRuntime = Layer.mergeAll(
  NodeFileSystem.layer,
  PluginLoggerLive
)
```

---

## Error Types

### Yieldable Errors Pattern

From Effect codebase (`effect/packages/effect/src/Data.ts:585`):

```ts
export const TaggedError = <Tag extends string>(tag: Tag): new<A extends Record<string, any> = {}>(
  args: Types.Equals<A, {}> extends true ? void
    : { readonly [P in keyof A as P extends "_tag" ? never : P]: A[P] }
) => Cause.YieldableError & { readonly _tag: Tag } & Readonly<A>
```

Yieldable errors can be yielded directly in `Effect.gen`:

```ts
class MyError extends Data.TaggedError("MyError")<{
  readonly message: string
}> {}

// Usage - no Effect.fail needed!
Effect.gen(function* () {
  if (condition) {
    return yield* new MyError({ message: "Something went wrong" })
  }
})
```

### Plugin Errors

```ts
// packages/core/src/vite-plugin.ts

/**
 * Plugin validation error.
 * Thrown when app structure is invalid or required files are missing.
 * @since 1.0.0
 */
class PluginValidationError extends Data.TaggedError("PluginValidationError")<{
  readonly reason: "MissingFile" | "MissingExport" | "RouteConflict" | "InvalidStructure"
  readonly message: string
  readonly file?: string
  readonly details?: string
}> {
  /**
   * Create error for missing required file.
   */
  static missingFile(file: string, details?: string): PluginValidationError {
    return new PluginValidationError({
      reason: "MissingFile",
      message: `Required file missing: ${file}`,
      file,
      details
    })
  }

  /**
   * Create error for missing required export.
   */
  static missingExport(file: string, exportName: string): PluginValidationError {
    return new PluginValidationError({
      reason: "MissingExport",
      message: `${file} must export '${exportName}'`,
      file
    })
  }

  /**
   * Create error for route conflict.
   */
  static routeConflict(path: string, file: string): PluginValidationError {
    return new PluginValidationError({
      reason: "RouteConflict",
      message: `Route conflict: ${path}`,
      file,
      details: "Path defined both as page route and API endpoint"
    })
  }

  /**
   * Create error for invalid structure.
   */
  static invalidStructure(message: string, file?: string): PluginValidationError {
    return new PluginValidationError({
      reason: "InvalidStructure",
      message,
      file
    })
  }
}

/**
 * Plugin file system error.
 * Wraps PlatformError with plugin context.
 * @since 1.0.0
 */
class PluginFileSystemError extends Data.TaggedError("PluginFileSystemError")<{
  readonly operation: "read" | "write" | "mkdir" | "exists" | "readdir" | "stat"
  readonly path: string
  readonly cause: unknown
}> {}

/**
 * Plugin generation error.
 * Thrown when code generation fails.
 * @since 1.0.0
 */
class PluginGenerationError extends Data.TaggedError("PluginGenerationError")<{
  readonly target: "routes" | "types" | "entry" | "client"
  readonly message: string
  readonly cause?: unknown
}> {}
```

### API Middleware Errors

```ts
// packages/core/src/api-middleware.ts

/**
 * API middleware initialization error.
 * Thrown when the API module fails to load or initialize.
 * @since 1.0.0
 */
class ApiInitError extends Data.TaggedError("ApiInitError")<{
  readonly message: string
  readonly cause?: unknown
}> {}

/**
 * API handler execution error.
 * Thrown when the Effect HttpApi handler fails.
 * @since 1.0.0
 */
class ApiHandlerError extends Data.TaggedError("ApiHandlerError")<{
  readonly method: string
  readonly path: string
  readonly cause: unknown
}> {}

/**
 * API response streaming error.
 * Thrown when streaming the response body to Node.js fails.
 * @since 1.0.0
 */
class ApiStreamError extends Data.TaggedError("ApiStreamError")<{
  readonly message: string
  readonly cause?: unknown
}> {}

/**
 * Union type for all API middleware errors.
 * @since 1.0.0
 */
type ApiMiddlewareError = ApiInitError | ApiHandlerError | ApiStreamError
```

---

## Logger Implementation

### Batched Logger with Colors

```ts
// packages/core/src/vite-plugin.ts

import { Logger, Effect, Duration, Layer, Scope } from "effect"

/**
 * ANSI color codes for terminal output.
 * @internal
 */
const colors = {
  reset: "\x1b[0m",
  bold: "\x1b[1m",
  dim: "\x1b[2m",
  cyan: "\x1b[36m",
  green: "\x1b[32m",
  yellow: "\x1b[33m",
  red: "\x1b[31m",
} as const

/**
 * Format log message with effect-ui prefix and colors.
 * @internal
 */
const formatMessage = (level: "info" | "success" | "warn" | "error" | "dim", message: string): string => {
  const prefix = `${colors.cyan}${colors.bold}[effect-ui]${colors.reset}`
  
  switch (level) {
    case "info":
      return `${prefix} ${message}`
    case "success":
      return `${prefix} ${colors.green}${message}${colors.reset}`
    case "warn":
      return `${prefix} ${colors.yellow}${message}${colors.reset}`
    case "error":
      return `${prefix} ${colors.red}${message}${colors.reset}`
    case "dim":
      return `${prefix} ${colors.dim}${message}${colors.reset}`
  }
}

/**
 * Plugin logger that outputs colored messages.
 * Uses Effect's Logger.batched for non-blocking I/O.
 * 
 * Log levels map to colors:
 * - Debug → dim (gray)
 * - Info → default (white)
 * - Warning → yellow
 * - Error → red
 * 
 * @since 1.0.0
 */
const PluginLogger: Effect.Effect<Logger.Logger<unknown, void>, never, Scope.Scope> = 
  Logger.stringLogger.pipe(
    Logger.map((output) => {
      // Extract level from stringLogger output format
      // Format: "timestamp=... level=INFO message=..."
      const levelMatch = output.match(/level=(\w+)/)
      const level = levelMatch?.[1]?.toLowerCase() ?? "info"
      
      // Extract message
      const messageMatch = output.match(/message="([^"]*)"/) ?? output.match(/message=(\S+)/)
      const message = messageMatch?.[1] ?? output
      
      switch (level) {
        case "debug":
          return formatMessage("dim", message)
        case "info":
          return formatMessage("info", message)
        case "warning":
          return formatMessage("warn", message)
        case "error":
          return formatMessage("error", message)
        default:
          return formatMessage("info", message)
      }
    }),
    Logger.batched(Duration.millis(50), (messages) =>
      Effect.sync(() => {
        for (const msg of messages) {
          console.log(msg)
        }
      })
    )
  )

/**
 * Layer that provides the batched plugin logger.
 * Replaces the default logger with colored, non-blocking output.
 * @since 1.0.0
 */
const PluginLoggerLive: Layer.Layer<never, never, Scope.Scope> = 
  Logger.replaceScoped(Logger.defaultLogger, PluginLogger)
```

### Usage in Effects

```ts
// Instead of log.info("message"), use Effect.log
yield* Effect.log("effect-ui configured")

// For different levels
yield* Effect.logDebug("Scanning routes...")  // → dim
yield* Effect.logInfo("Routes loaded")         // → default  
yield* Effect.logWarning("Deprecated option")  // → yellow
yield* Effect.logError("Failed to load API")   // → red

// With annotations for context
yield* Effect.log("Generated files").pipe(
  Effect.annotateLogs("directory", GENERATED_DIR)
)
```

---

## FileSystem Operations

### Service-Based File Operations

```ts
// packages/core/src/vite-plugin.ts

import { FileSystem } from "@effect/platform"
import { NodeFileSystem } from "@effect/platform-node"
import { Effect, Option } from "effect"

/**
 * Check if a path exists.
 * Returns boolean instead of throwing.
 * @internal
 */
const pathExists = (path: string): Effect.Effect<boolean, never, FileSystem.FileSystem> =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem
    return yield* fs.exists(path)
  })

/**
 * Read directory contents.
 * Returns empty array if directory doesn't exist.
 * @internal
 */
const readDirectorySafe = (
  path: string
): Effect.Effect<ReadonlyArray<string>, PluginFileSystemError, FileSystem.FileSystem> =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem
    const exists = yield* fs.exists(path)
    if (!exists) {
      return []
    }
    return yield* fs.readDirectory(path).pipe(
      Effect.mapError((cause) => new PluginFileSystemError({
        operation: "readdir",
        path,
        cause
      }))
    )
  })

/**
 * Write file with directory creation.
 * Creates parent directories if they don't exist.
 * @internal
 */
const writeFileSafe = (
  path: string,
  content: string
): Effect.Effect<void, PluginFileSystemError, FileSystem.FileSystem> =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem
    const dir = nodePath.dirname(path)
    
    // Ensure directory exists
    yield* fs.makeDirectory(dir, { recursive: true }).pipe(
      Effect.catchTag("SystemError", (e) =>
        e.reason === "AlreadyExists" ? Effect.void : Effect.fail(e)
      ),
      Effect.mapError((cause) => new PluginFileSystemError({
        operation: "mkdir",
        path: dir,
        cause
      }))
    )
    
    // Write file
    yield* fs.writeFileString(path, content).pipe(
      Effect.mapError((cause) => new PluginFileSystemError({
        operation: "write",
        path,
        cause
      }))
    )
  })

/**
 * Get file stats.
 * Returns Option.none if file doesn't exist.
 * @internal
 */
const statSafe = (
  path: string
): Effect.Effect<Option.Option<FileSystem.File.Info>, PluginFileSystemError, FileSystem.FileSystem> =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem
    const exists = yield* fs.exists(path)
    if (!exists) {
      return Option.none()
    }
    const stat = yield* fs.stat(path).pipe(
      Effect.mapError((cause) => new PluginFileSystemError({
        operation: "stat",
        path,
        cause
      }))
    )
    return Option.some(stat)
  })
```

---

## Route Scanning

### Current Implementation (Imperative)

```ts
// Current: Sync fs with imperative loops
export const scanRoutes = (routesDir: string): RouteFile[] => {
  const routes: RouteFile[] = [];

  const scanDir = (dir: string, parentPath: string = "", depth: number = 0): void => {
    if (!fs.existsSync(dir)) {
      return;
    }

    const entries = fs.readdirSync(dir, { withFileTypes: true });

    for (const entry of entries) {
      // ... imperative processing
    }
  };

  scanDir(routesDir);
  return routes;
};
```

### Migrated Implementation (Effect)

```ts
/**
 * Scan routes directory and extract route files.
 * Uses FileSystem service for non-blocking I/O.
 * 
 * @param routesDir - Absolute path to routes directory
 * @returns Effect yielding array of RouteFile
 * @since 1.0.0
 * @internal
 */
const scanRoutes = (
  routesDir: string
): Effect.Effect<ReadonlyArray<RouteFile>, PluginFileSystemError, FileSystem.FileSystem> =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem
    
    // Check if routes directory exists
    const exists = yield* fs.exists(routesDir)
    if (!exists) {
      return []
    }

    /**
     * Recursively scan a directory for route files.
     * @internal
     */
    const scanDir = (
      dir: string,
      parentPath: string,
      depth: number
    ): Effect.Effect<ReadonlyArray<RouteFile>, PluginFileSystemError, FileSystem.FileSystem> =>
      Effect.gen(function* () {
        const entries = yield* fs.readDirectory(dir).pipe(
          Effect.mapError((cause) => new PluginFileSystemError({
            operation: "readdir",
            path: dir,
            cause
          }))
        )

        const routes: RouteFile[] = []

        for (const entryName of entries) {
          const fullPath = nodePath.join(dir, entryName)
          const stat = yield* fs.stat(fullPath).pipe(
            Effect.mapError((cause) => new PluginFileSystemError({
              operation: "stat",
              path: fullPath,
              cause
            }))
          )

          if (stat.type === "Directory") {
            // Convert [param] syntax to :param
            const dirName = entryName
              .replace(/^\[\.\.\.(.+)\]$/, "*")   // [...rest] -> *
              .replace(/^\[(.+)\]$/, ":$1")       // [param] -> :param
            const dirPath = parentPath + "/" + dirName
            
            // Recurse into subdirectory
            const nestedRoutes = yield* scanDir(fullPath, dirPath, depth + 1)
            routes.push(...nestedRoutes)
          } else if (stat.type === "File" && /\.(tsx|ts|jsx|js)$/.test(entryName)) {
            const route = yield* processRouteFile(fullPath, entryName, parentPath, depth)
            if (Option.isSome(route)) {
              routes.push(route.value)
            }
          }
        }

        return routes
      })

    return yield* scanDir(routesDir, "", 0)
  })

/**
 * Process a single route file and extract route info.
 * Returns None for files that should be skipped (underscore-prefixed non-special files).
 * @internal
 */
const processRouteFile = (
  fullPath: string,
  fileName: string,
  parentPath: string,
  depth: number
): Effect.Effect<Option.Option<RouteFile>, never, never> =>
  Effect.sync(() => {
    const basename = fileName.replace(/\.(tsx|ts|jsx|js)$/, "")

    // Determine file type and route path
    let type: RouteFile["type"]
    let routePath: string

    if (basename === "layout" || basename === "_layout") {
      type = "layout"
      routePath = parentPath || "/"
    } else if (basename === "_loading") {
      type = "loading"
      routePath = parentPath || "/"
    } else if (basename === "_error") {
      type = "error"
      routePath = parentPath || "/"
    } else if (basename === "index") {
      type = "page"
      routePath = parentPath || "/"
    } else if (basename.startsWith("_")) {
      // Skip other underscore-prefixed files
      return Option.none()
    } else {
      type = "page"
      // Convert [param] to :param and [...rest] to *
      const segment = basename
        .replace(/^\[\.\.\.(.+)\]$/, "*")
        .replace(/^\[(.+)\]$/, ":$1")
      routePath = (parentPath || "") + "/" + segment
    }

    return Option.some({
      filePath: fullPath,
      routePath,
      type,
      depth,
    })
  })
```

---

## Validation

### Current Implementation (Imperative)

```ts
// Current: Returns error array, uses sync fs
export const validateAppStructure = (appDir: string): ValidationError[] => {
  const errors: ValidationError[] = [];

  const layoutPath = path.join(appDir, "layout.tsx");
  if (!fs.existsSync(layoutPath)) {
    errors.push({
      type: "missing_file",
      message: "Root layout is required",
      // ...
    });
  }

  return errors;
};
```

### Migrated Implementation (Effect)

```ts
/**
 * Validate app structure.
 * Checks for required files and directories.
 * 
 * @param appDir - Absolute path to app directory
 * @returns Effect yielding array of validation errors (empty if valid)
 * @since 1.0.0
 * @internal
 */
const validateAppStructure = (
  appDir: string
): Effect.Effect<ReadonlyArray<PluginValidationError>, PluginFileSystemError, FileSystem.FileSystem> =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem
    const errors: PluginValidationError[] = []

    // Check app/layout.tsx exists
    const layoutPathTsx = nodePath.join(appDir, "layout.tsx")
    const layoutPathTs = nodePath.join(appDir, "layout.ts")
    const hasLayoutTsx = yield* fs.exists(layoutPathTsx)
    const hasLayoutTs = yield* fs.exists(layoutPathTs)
    
    if (!hasLayoutTsx && !hasLayoutTs) {
      errors.push(PluginValidationError.missingFile(
        layoutPathTsx,
        "Create app/layout.tsx with your root layout component (including <html> and <body>)"
      ))
    }

    // Check app/routes exists
    const routesDir = nodePath.join(appDir, "routes")
    const hasRoutesDir = yield* fs.exists(routesDir)
    
    if (!hasRoutesDir) {
      errors.push(PluginValidationError.missingFile(
        routesDir,
        "Create app/routes/ directory with your page components"
      ))
    }

    return errors
  })

/**
 * Validate API module exports.
 * Checks that api.ts exports required Api and ApiLive.
 * 
 * @param apiPath - Absolute path to api.ts
 * @param loadModule - Function to dynamically load the module
 * @returns Effect yielding array of validation errors (empty if valid)
 * @since 1.0.0
 * @internal
 */
const validateApiExports = (
  apiPath: string,
  loadModule: (path: string) => Promise<Record<string, unknown>>
): Effect.Effect<ReadonlyArray<PluginValidationError>, never, FileSystem.FileSystem> =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem
    const errors: PluginValidationError[] = []

    // API is optional
    const hasApi = yield* fs.exists(apiPath)
    if (!hasApi) {
      return errors
    }

    // Load and validate module
    const moduleResult = yield* Effect.tryPromise({
      try: () => loadModule(apiPath),
      catch: (error) => error
    }).pipe(Effect.either)

    if (Either.isLeft(moduleResult)) {
      errors.push(PluginValidationError.invalidStructure(
        `Failed to load API module: ${moduleResult.left instanceof Error ? moduleResult.left.message : String(moduleResult.left)}`,
        apiPath
      ))
      return errors
    }

    const module = moduleResult.right

    if (!module.Api && !module.api) {
      errors.push(PluginValidationError.missingExport(apiPath, "Api"))
    }

    if (!module.ApiLive) {
      errors.push(PluginValidationError.missingExport(apiPath, "ApiLive"))
    }

    return errors
  })
```

---

## API Middleware

### Current Implementation (Promise-based)

```ts
// Current: async/await with try/catch, mutable state
export async function createApiMiddleware(options: ApiMiddlewareOptions): Promise<ApiMiddleware> {
  let handler: ((req: Request) => Promise<Response>) | null = null;
  let disposeHandler: (() => Promise<void>) | null = null;
  let lastError: unknown = null;

  const initHandler = async (): Promise<void> => {
    try {
      const apiModule = await loadApiModule();
      // ...
    } catch (error) {
      handler = null;
      lastError = error;
      onError(error);
    }
  };

  await initHandler();

  const middleware: Connect.NextHandleFunction = async (req, res, next) => {
    try {
      const webRequest = nodeToWebRequest(req, baseUrl);
      const webResponse = await handler(webRequest);
      await webResponseToNode(webResponse, res);
    } catch (error) {
      // ...
    }
  };

  return { middleware, reload, dispose };
}
```

### Migrated Implementation (Effect)

```ts
import { Effect, Ref, Option, Runtime, Stream, Scope } from "effect"
import type { Connect } from "vite"

// =============================================================================
// Types
// =============================================================================

/**
 * Internal state for API middleware.
 * Uses Option for nullable fields to avoid null checks.
 * @internal
 */
interface MiddlewareState {
  readonly handler: Option.Option<(req: Request) => Promise<Response>>
  readonly dispose: Option.Option<Effect.Effect<void>>
  readonly lastError: Option.Option<unknown>
}

/**
 * Options for creating API middleware.
 * @since 1.0.0
 */
interface ApiMiddlewareOptions {
  /**
   * Load the API module.
   * Called on init and reload.
   */
  readonly loadApiModule: () => Promise<{ ApiLive: Layer.Layer<unknown, unknown, unknown> }>
  
  /**
   * Called when handler errors occur.
   * Effect-based for consistent error handling.
   */
  readonly onError: (error: unknown) => Effect.Effect<void>
  
  /**
   * Base URL for request construction.
   * @default "http://localhost:5173"
   */
  readonly baseUrl?: string
}

/**
 * API Middleware interface.
 * @since 1.0.0
 */
interface ApiMiddleware {
  /** Connect middleware function */
  readonly middleware: Connect.NextHandleFunction
  /** Reload handlers (call after api.ts changes) */
  readonly reload: () => Promise<void>
  /** Cleanup resources */
  readonly dispose: () => Promise<void>
}

// =============================================================================
// Request/Response Conversion
// =============================================================================

/**
 * Convert Node.js IncomingMessage to Web API Request.
 * Pure function - no Effect needed.
 * 
 * @param req - Node.js incoming message
 * @param baseUrl - Base URL for constructing full URL
 * @returns Web API Request
 * @since 1.0.0
 */
const nodeToWebRequest = (req: IncomingMessage, baseUrl: string): Request => {
  const url = new URL(req.url ?? "/", baseUrl)

  const headers = new Headers()
  for (const [key, value] of Object.entries(req.headers)) {
    if (value !== undefined) {
      headers.set(key, Array.isArray(value) ? value.join(", ") : value)
    }
  }

  const method = req.method ?? "GET"
  const hasBody = !["GET", "HEAD"].includes(method)

  let body: ReadableStream<Uint8Array> | undefined
  if (hasBody) {
    body = Readable.toWeb(req) as unknown as ReadableStream<Uint8Array>
  }

  return new Request(url, {
    method,
    headers,
    body,
    // @ts-expect-error - duplex required for streaming request body in Node
    duplex: hasBody ? "half" : undefined,
  })
}

/**
 * Stream Web API Response to Node.js ServerResponse.
 * Uses Effect Stream for proper resource management.
 * 
 * @param webRes - Web API Response
 * @param nodeRes - Node.js ServerResponse
 * @returns Effect that streams the response
 * @since 1.0.0
 */
const webResponseToNode = (
  webRes: Response,
  nodeRes: ServerResponse
): Effect.Effect<void, ApiStreamError> =>
  Effect.gen(function* () {
    // Set status and headers (sync operations)
    nodeRes.statusCode = webRes.status
    nodeRes.statusMessage = webRes.statusText

    webRes.headers.forEach((value, key) => {
      if (!key.startsWith(":")) {
        nodeRes.setHeader(key, value)
      }
    })

    // Stream body if present
    if (webRes.body) {
      yield* Stream.fromReadableStream(
        () => webRes.body!,
        (error) => new ApiStreamError({
          message: "Failed to read response body stream",
          cause: error
        })
      ).pipe(
        Stream.runForEach((chunk) =>
          Effect.sync(() => {
            nodeRes.write(chunk)
          })
        )
      )
    }

    // End response
    yield* Effect.sync(() => {
      nodeRes.end()
    })
  })

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
  Effect.sync(() => {
    res.statusCode = statusCode
    res.setHeader("Content-Type", "application/json")
    res.end(JSON.stringify({ error, message }))
  })

// =============================================================================
// Middleware Factory
// =============================================================================

/**
 * Create API middleware for Vite dev server.
 * 
 * Intercepts `/api/*` requests and routes them to Effect HttpApi handlers.
 * Supports hot reloading when api.ts changes.
 * 
 * @param options - Middleware configuration
 * @returns Effect yielding ApiMiddleware
 * @since 1.0.0
 */
const createApiMiddleware = (
  options: ApiMiddlewareOptions
): Effect.Effect<ApiMiddleware, ApiInitError, Scope.Scope> =>
  Effect.gen(function* () {
    const { loadApiModule, onError, baseUrl = "http://localhost:5173" } = options

    // Create mutable state via Ref
    const state = yield* Ref.make<MiddlewareState>({
      handler: Option.none(),
      dispose: Option.none(),
      lastError: Option.none()
    })

    /**
     * Initialize or reinitialize the API handler.
     * @internal
     */
    const initHandler: Effect.Effect<void> = Effect.gen(function* () {
      // Dispose previous handler if exists
      const currentState = yield* Ref.get(state)
      if (Option.isSome(currentState.dispose)) {
        yield* currentState.dispose.value.pipe(Effect.ignore)
      }

      // Load new handler
      const loadResult = yield* Effect.tryPromise({
        try: () => loadApiModule(),
        catch: (error) => new ApiInitError({
          message: "Failed to load API module",
          cause: error
        })
      }).pipe(Effect.either)

      if (Either.isLeft(loadResult)) {
        yield* Ref.set(state, {
          handler: Option.none(),
          dispose: Option.none(),
          lastError: Option.some(loadResult.left)
        })
        yield* onError(loadResult.left)
        return
      }

      const apiModule = loadResult.right

      // Build handler from ApiLive layer
      // Note: Cast to never is unavoidable with dynamic imports
      const apiLayer = Layer.provide(
        apiModule.ApiLive,
        HttpServer.layerContext
      ) as Layer.Layer<never, never, never>

      const result = HttpApiBuilder.toWebHandler(apiLayer)

      yield* Ref.set(state, {
        handler: Option.some(result.handler),
        dispose: Option.some(Effect.promise(() => result.dispose())),
        lastError: Option.none()
      })
    })

    // Initialize on creation
    yield* initHandler

    // Get runtime for running effects in callbacks
    const runtime = yield* Effect.runtime<never>()

    /**
     * Handle an API request.
     * @internal
     */
    const handleRequest = (
      req: IncomingMessage,
      res: ServerResponse
    ): Effect.Effect<void, ApiMiddlewareError> =>
      Effect.gen(function* () {
        const currentState = yield* Ref.get(state)

        // Check if handler is available
        if (Option.isNone(currentState.handler)) {
          const errorMessage = Option.match(currentState.lastError, {
            onNone: () => "Check console for errors",
            onSome: (e) => e instanceof Error ? e.message : String(e)
          })
          
          yield* sendErrorResponse(res, 500, "API handler not available", errorMessage)
          return
        }

        // Execute handler
        const webRequest = nodeToWebRequest(req, baseUrl)
        
        const webResponse = yield* Effect.tryPromise({
          try: () => currentState.handler.value(webRequest),
          catch: (error) => new ApiHandlerError({
            method: req.method ?? "GET",
            path: req.url ?? "/",
            cause: error
          })
        })

        // Stream response to Node
        yield* webResponseToNode(webResponse, res)
      })

    /**
     * Connect middleware function.
     * This is the boundary where Effect meets non-Effect.
     */
    const middleware: Connect.NextHandleFunction = (req, res, next) => {
      // Only handle /api/* requests
      if (!req.url?.startsWith("/api/")) {
        return next()
      }

      // Run Effect in callback
      Runtime.runPromise(runtime)(
        handleRequest(req, res).pipe(
          Effect.catchAll((error) =>
            Effect.gen(function* () {
              yield* onError(error)
              yield* sendErrorResponse(
                res,
                500,
                "Internal Server Error",
                error instanceof Error ? error.message : "Unknown error"
              )
            })
          )
        )
      )
    }

    /**
     * Reload API handlers.
     */
    const reload = (): Promise<void> =>
      Runtime.runPromise(runtime)(initHandler)

    /**
     * Dispose resources.
     */
    const dispose = (): Promise<void> =>
      Runtime.runPromise(runtime)(
        Effect.gen(function* () {
          const currentState = yield* Ref.get(state)
          if (Option.isSome(currentState.dispose)) {
            yield* currentState.dispose.value
          }
          yield* Ref.set(state, {
            handler: Option.none(),
            dispose: Option.none(),
            lastError: Option.none()
          })
        })
      )

    return { middleware, reload, dispose }
  })
```

---

## Plugin Runtime

### Building the Runtime

```ts
// packages/core/src/vite-plugin.ts

import { Effect, Layer, Runtime, Scope } from "effect"
import { FileSystem } from "@effect/platform"
import { NodeFileSystem } from "@effect/platform-node"

/**
 * Plugin runtime requirements.
 * @internal
 */
type PluginContext = FileSystem.FileSystem

/**
 * Build plugin runtime with all required services.
 * Called once at plugin creation.
 * @internal
 */
const buildPluginRuntime = (): Promise<{
  runtime: Runtime.Runtime<PluginContext>
  scope: Scope.CloseableScope
}> =>
  Effect.gen(function* () {
    const scope = yield* Scope.make()
    
    // Build runtime with FileSystem and batched Logger
    const runtime = yield* Layer.toRuntime(
      Layer.mergeAll(
        NodeFileSystem.layer,
        // Logger layer is scoped due to batching daemon fiber
        Layer.scoped(
          Logger.replaceScoped(Logger.defaultLogger, PluginLogger)
        )
      )
    ).pipe(Scope.extend(scope))

    return { runtime, scope }
  }).pipe(Effect.runPromise)
```

### Plugin Factory

```ts
/**
 * Effect UI Vite plugin.
 * 
 * Provides:
 * - JSX configuration for effect-ui
 * - File-based routing from app/routes/
 * - Root layout from app/layout.tsx
 * - API handling from app/api.ts
 * - Auto-generated entry point
 * 
 * @since 1.0.0
 */
export const effectUI = (): Plugin => {
  // Runtime state - initialized in configResolved
  let runtime: Runtime.Runtime<PluginContext>
  let runtimeScope: Scope.CloseableScope
  
  // Config state
  let config: ResolvedConfig
  let appDir: string
  let routesDir: string
  let generatedDir: string

  return {
    name: "effect-ui",
    enforce: "pre",

    // =======================================================================
    // config - Sync, pure object
    // =======================================================================
    config() {
      return {
        esbuild: {
          jsx: "automatic",
          jsxImportSource: "effect-ui",
        },
        optimizeDeps: {
          include: ["effect-ui"],
          esbuildOptions: {
            jsx: "automatic",
            jsxImportSource: "effect-ui",
          },
        },
      }
    },

    // =======================================================================
    // configResolved - Build runtime, validate structure
    // =======================================================================
    async configResolved(resolvedConfig) {
      config = resolvedConfig
      appDir = nodePath.resolve(config.root, APP_DIR)
      routesDir = nodePath.join(appDir, "routes")
      generatedDir = nodePath.resolve(config.root, GENERATED_DIR)

      // Build runtime once
      const result = await buildPluginRuntime()
      runtime = result.runtime
      runtimeScope = result.scope

      // Run initialization in Effect
      await Runtime.runPromise(runtime)(
        Effect.gen(function* () {
          const fs = yield* FileSystem.FileSystem

          // Ensure generated directory exists
          yield* fs.makeDirectory(generatedDir, { recursive: true }).pipe(
            Effect.catchTag("SystemError", (e) =>
              e.reason === "AlreadyExists" ? Effect.void : Effect.fail(e)
            ),
            Effect.mapError((cause) => new PluginFileSystemError({
              operation: "mkdir",
              path: generatedDir,
              cause
            }))
          )

          // Log configuration
          yield* Effect.log("effect-ui configured")
          yield* Effect.logDebug(`App directory: ${appDir}`)
          yield* Effect.logDebug(`Routes directory: ${routesDir}`)
          yield* Effect.logDebug(`Generated directory: ${generatedDir}`)
        })
      )
    },

    // =======================================================================
    // configureServer - Setup dev server, API middleware, file watching
    // =======================================================================
    async configureServer(server: ViteDevServer) {
      await Runtime.runPromise(runtime)(
        Effect.gen(function* () {
          // Validate app structure
          const structureErrors = yield* validateAppStructure(appDir)
          
          for (const error of structureErrors) {
            yield* Effect.logError(error.message)
            if (error.details) {
              yield* Effect.logDebug(error.details)
            }
          }

          if (structureErrors.length > 0) {
            yield* Effect.logWarning("Fix the above errors to continue")
          }

          // Generate type files and entry
          const routes = yield* scanRoutes(routesDir)

          // Write routes.d.ts
          const routeTypesPath = nodePath.join(generatedDir, "routes.d.ts")
          yield* writeFileSafe(routeTypesPath, generateRouteTypes(routes))

          // Write api.d.ts
          const apiTypesPath = nodePath.join(generatedDir, "api.d.ts")
          yield* writeFileSafe(apiTypesPath, generateApiTypes(appDir))

          // Write entry.tsx
          const entryPath = nodePath.join(generatedDir, "entry.tsx")
          yield* writeFileSafe(entryPath, generateEntryModule(appDir, generatedDir))

          yield* Effect.log(`Generated files in ${GENERATED_DIR}/`)
        })
      )

      // Initialize API middleware if api.ts exists
      const apiPath = nodePath.join(appDir, "api.ts")
      let apiMiddleware: ApiMiddleware | null = null

      if (fs.existsSync(apiPath)) {
        const serverPort = server.config.server.port ?? 5173
        
        apiMiddleware = await Runtime.runPromise(runtime)(
          createApiMiddleware({
            loadApiModule: async () => {
              const mod = await server.ssrLoadModule(apiPath)
              if (!mod.ApiLive) {
                throw new Error("api.ts must export ApiLive")
              }
              return mod as { ApiLive: never }
            },
            onError: (error) => Effect.logError("API handler error", Cause.fail(error)),
            baseUrl: `http://localhost:${serverPort}`,
          }).pipe(Scope.extend(runtimeScope))
        )
        
        await Runtime.runPromise(runtime)(
          Effect.log("API handlers loaded")
        )
      }

      // Watch for changes
      server.watcher.on("change", async (file) => {
        if (file.startsWith(routesDir)) {
          await Runtime.runPromise(runtime)(
            Effect.gen(function* () {
              const routes = yield* scanRoutes(routesDir)
              const routeTypesPath = nodePath.join(generatedDir, "routes.d.ts")
              yield* writeFileSafe(routeTypesPath, generateRouteTypes(routes))
              yield* Effect.logDebug("Regenerated routes.d.ts")
            })
          )
        }
        if (file.endsWith("api.ts")) {
          await Runtime.runPromise(runtime)(
            Effect.gen(function* () {
              const apiTypesPath = nodePath.join(generatedDir, "api.d.ts")
              yield* writeFileSafe(apiTypesPath, generateApiTypes(appDir))
              yield* Effect.logDebug("Regenerated api.d.ts")
            })
          )

          if (apiMiddleware) {
            await apiMiddleware.reload()
            await Runtime.runPromise(runtime)(
              Effect.logDebug("Reloaded API handlers")
            )
          }
        }
      })

      // Watch for new files
      server.watcher.on("add", async (file) => {
        if (file.startsWith(routesDir)) {
          await Runtime.runPromise(runtime)(
            Effect.gen(function* () {
              const routes = yield* scanRoutes(routesDir)
              const routeTypesPath = nodePath.join(generatedDir, "routes.d.ts")
              yield* writeFileSafe(routeTypesPath, generateRouteTypes(routes))
              yield* Effect.logDebug("Regenerated routes.d.ts")
            })
          )
        }
      })

      // Cleanup on server close
      server.httpServer?.on("close", async () => {
        await apiMiddleware?.dispose()
        await Scope.close(runtimeScope, Exit.void)
      })

      // Add API middleware before Vite's internal middleware
      if (apiMiddleware) {
        server.middlewares.use(apiMiddleware.middleware)
      }

      // Return post hook for SPA fallback
      return () => {
        server.middlewares.use((req, res, next) => {
          if (req.url && !req.url.includes(".") && req.method === "GET") {
            req.url = "/index.html"
          }
          next()
        })
      }
    },

    // =======================================================================
    // resolveId - Sync, pure (no I/O)
    // =======================================================================
    resolveId(id) {
      if (id === VIRTUAL_ROUTES_ID) {
        return RESOLVED_VIRTUAL_ROUTES_ID
      }
      if (id === VIRTUAL_CLIENT_ID) {
        return RESOLVED_VIRTUAL_CLIENT_ID
      }
      if (id === "effect-ui/jsx-runtime" || id === "effect-ui/jsx-dev-runtime") {
        return null
      }
      return null
    },

    // =======================================================================
    // load - Async! Can run Effect directly
    // =======================================================================
    async load(id) {
      if (id === RESOLVED_VIRTUAL_ROUTES_ID) {
        return Runtime.runPromise(runtime)(
          Effect.gen(function* () {
            const routes = yield* scanRoutes(routesDir)
            return generateRoutesModule(routes, routesDir)
          })
        )
      }
      if (id === RESOLVED_VIRTUAL_CLIENT_ID) {
        // Client module generation is sync/pure
        return generateClientModule(appDir)
      }
      return null
    },

    // =======================================================================
    // buildStart - Generate entry if needed
    // =======================================================================
    async buildStart() {
      await Runtime.runPromise(runtime)(
        Effect.gen(function* () {
          const fs = yield* FileSystem.FileSystem
          
          // Generate entry.tsx if needed
          const entryPath = nodePath.join(generatedDir, "entry.tsx")
          const hasEntry = yield* fs.exists(entryPath)
          if (!hasEntry) {
            yield* writeFileSafe(entryPath, generateEntryModule(appDir, generatedDir))
          }

          // Generate index.html if it doesn't exist
          const indexPath = nodePath.join(config.root, "index.html")
          const hasIndex = yield* fs.exists(indexPath)
          if (!hasIndex) {
            yield* writeFileSafe(indexPath, generateHtmlTemplate(generatedDir))
            yield* Effect.log("Generated index.html")
          }
        })
      )
    },

    // =======================================================================
    // buildEnd - Validate before build completes
    // =======================================================================
    async buildEnd() {
      await Runtime.runPromise(runtime)(
        Effect.gen(function* () {
          const structureErrors = yield* validateAppStructure(appDir)
          
          if (structureErrors.length > 0) {
            for (const error of structureErrors) {
              yield* Effect.logError(error.message)
              if (error.details) {
                yield* Effect.logDebug(error.details)
              }
            }
            // Throw to fail the build
            return yield* Effect.fail(
              new PluginValidationError({
                reason: "InvalidStructure",
                message: "Build failed due to app structure errors"
              })
            )
          }
        })
      )
    },
  }
}
```

---

## Type Cast Fixes

### TraceContext Building

```ts
// packages/core/src/debug/debug.ts

// BEFORE: Mutating with casts
const ctx: TraceContext = {};
if (traceId !== undefined) (ctx as { traceId: string }).traceId = traceId;
if (spanId !== undefined) (ctx as { spanId: string }).spanId = spanId;
if (parentSpanId !== undefined) (ctx as { parentSpanId: string }).parentSpanId = parentSpanId;

// AFTER: Conditional object building
export const getTraceContext: Effect.Effect<TraceContext> = Effect.gen(function* () {
  const traceId = yield* FiberRef.get(CurrentTraceId)
  const spanId = yield* FiberRef.get(CurrentSpanId)
  const parentSpanId = yield* FiberRef.get(CurrentParentSpanId)

  // Build object conditionally - no casts needed
  const ctx: TraceContext = {
    ...(traceId !== undefined && { traceId }),
    ...(spanId !== undefined && { spanId }),
    ...(parentSpanId !== undefined && { parentSpanId }),
  }
  
  return ctx
})
```

### Database Row Decoding

```ts
// packages/core/src/debug/test-server.ts

// BEFORE: Direct cast
const rows = stmt.all(...params, limit) as Array<{...}>

// AFTER: Schema decoding
import { Schema } from "effect"

const EventRow = Schema.Struct({
  id: Schema.String,
  timestamp: Schema.Number,
  type: Schema.String,
  // ... other fields
})

const decodeEventRows = Schema.decodeUnknown(Schema.Array(EventRow))

// Usage
const rows = stmt.all(...params, limit)
const decoded = yield* decodeEventRows(rows).pipe(
  Effect.mapError((error) => new DatabaseDecodeError({ cause: error }))
)
```

---

## Defects Documentation

### Intentional Throws

Some errors are **defects** (programmer errors), not recoverable failures. These remain as `throw`:

```ts
// packages/core/src/component.ts:338
// DEFECT: Invalid API usage - caught during development
/**
 * @throws {Error} If called with invalid arguments.
 * This is a defect - Component.gen must receive a generator function.
 */
export const gen: Gen = function <P extends object>(f?: unknown): any {
  // ...
  throw new Error("Component.gen: expected a generator function or call with type parameter first")
}

// packages/core/src/signal.ts:937-939
// DEFECT: Module initialization error - should never happen in properly configured app
/**
 * @throws {Error} If Signal module not initialized.
 * This is a defect - element.ts must be imported before using signalElement.
 */
if (!_signalElementImpl) {
  throw new Error("Signal module not initialized - element.ts must be imported first")
}

// packages/core/src/signal.ts:1036-1044
// DEFECT: Module initialization error
/**
 * @throws {Error} If Signal.each not initialized.
 * This is a defect - effect-ui must be imported before using Signal.each.
 */
if (_eachImpl === null) {
  throw new Error(
    "Signal.each is not initialized.\n\n" +
    "This usually means you imported Signal directly from 'effect-ui/Signal' " +
    "before the main 'effect-ui' module was loaded.\n\n" +
    "Fix: Import from 'effect-ui' instead:\n" +
    "  import { Signal } from 'effect-ui'\n\n" +
    "Or ensure 'effect-ui' is imported before using Signal.each."
  )
}
```

### Rationale

| Error | Type | Reason |
|-------|------|--------|
| Invalid `Component.gen` args | Defect | Type system should prevent; runtime check is safety net |
| Module not initialized | Defect | Import order issue; fix is code change, not error handling |
| Circular dependency | Defect | Architecture issue; not recoverable at runtime |

These are not wrapped in `Effect.fail` because:
1. They indicate programmer error, not runtime failure
2. They should be caught during development
3. There's no meaningful recovery strategy
4. `throw` provides clear stack trace to fix the issue

---

## Dependencies

### Package.json Changes

```json
// packages/core/package.json
{
  "dependencies": {
    "@effect/platform": "^0.x.x",
    "@effect/platform-node": "^0.x.x",
    "effect": "^3.x.x"
  }
}
```

### Imports Structure

```ts
// packages/core/src/vite-plugin.ts
import { Effect, Layer, Runtime, Scope, Ref, Option, Either, Duration, Logger, Cause, Exit } from "effect"
import { FileSystem } from "@effect/platform"
import { NodeFileSystem } from "@effect/platform-node"
import * as nodePath from "node:path"
import type { Plugin, ResolvedConfig, ViteDevServer } from "vite"

// packages/core/src/api-middleware.ts
import { Effect, Ref, Option, Either, Runtime, Stream, Scope, Layer, Cause } from "effect"
import { HttpApiBuilder, HttpServer } from "@effect/platform"
import type { IncomingMessage, ServerResponse } from "node:http"
import { Readable } from "node:stream"
import type { Connect } from "vite"
```

---

## Implementation Phases

| Phase | Scope | Tasks | Estimated |
|-------|-------|-------|-----------|
| **1** | Errors | Define `PluginValidationError`, `PluginFileSystemError`, `PluginGenerationError` | 30m |
| **2** | Errors | Define `ApiInitError`, `ApiHandlerError`, `ApiStreamError` | 30m |
| **3** | Logger | Implement `PluginLogger` with batching and colors | 1h |
| **4** | api-middleware | Convert `webResponseToNode` to Effect + Stream | 1h |
| **5** | api-middleware | Convert `createApiMiddleware` to Effect + Ref | 2h |
| **6** | vite-plugin | Add `@effect/platform-node` dependency | 15m |
| **7** | vite-plugin | Implement FileSystem helper functions | 1h |
| **8** | vite-plugin | Convert `scanRoutes` to Effect | 1.5h |
| **9** | vite-plugin | Convert `validateAppStructure` to Effect | 1h |
| **10** | vite-plugin | Build plugin runtime in factory | 1h |
| **11** | vite-plugin | Convert `configResolved` hook | 30m |
| **12** | vite-plugin | Convert `configureServer` hook | 1.5h |
| **13** | vite-plugin | Convert `load` hook (async!) | 30m |
| **14** | vite-plugin | Convert `buildStart` and `buildEnd` hooks | 30m |
| **15** | Types | Fix TraceContext cast in debug.ts | 15m |
| **16** | Types | Add Schema decoding for database rows | 30m |
| **17** | Docs | Document defects (thrown errors) | 15m |
| **18** | Test | Run typecheck and test suite | 30m |

**Total: ~13 hours**

---

## Testing Strategy

### Unit Tests

```ts
// Test error types are yieldable
it("PluginValidationError is yieldable", () =>
  Effect.gen(function* () {
    const error = new PluginValidationError({
      reason: "MissingFile",
      message: "test"
    })
    return yield* Effect.fail(error)
  }).pipe(
    Effect.flip,
    Effect.map((e) => expect(e._tag).toBe("PluginValidationError")),
    Effect.runPromise
  )
)

// Test scanRoutes returns correct structure
it("scanRoutes finds route files", () =>
  Effect.gen(function* () {
    const routes = yield* scanRoutes("/path/to/routes")
    expect(routes.length).toBeGreaterThan(0)
    expect(routes[0]).toHaveProperty("filePath")
    expect(routes[0]).toHaveProperty("routePath")
  }).pipe(
    Effect.provide(TestFileSystem),
    Effect.runPromise
  )
)
```

### Integration Tests

```ts
// Test full plugin lifecycle
it("plugin generates files on configResolved", async () => {
  const plugin = effectUI()
  
  await plugin.configResolved({
    root: "/test/project",
    // ...
  })
  
  // Check generated files exist
  expect(fs.existsSync("/test/project/.effect-ui/routes.d.ts")).toBe(true)
})
```

---

## Rollback Strategy

If issues arise during migration:

1. **Git revert** - Each phase should be a separate commit
2. **Feature flag** - Could add `useEffect: boolean` option to plugin
3. **Parallel implementation** - Keep old code until new code is stable

---

## Success Criteria

- [ ] All `async/await` replaced with `Effect.gen`
- [ ] All `try/catch` replaced with `Effect.catchAll` / `Effect.either`
- [ ] All `let` mutable state replaced with `Ref`
- [ ] All `fs.*` sync calls replaced with `FileSystem` service
- [ ] All `console.log` replaced with `Effect.log*` via batched logger
- [ ] All type casts (`as`) removed or documented
- [ ] `bun run typecheck` passes
- [ ] `bun run test` passes
- [ ] Examples work with migrated code
