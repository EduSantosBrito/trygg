/**
 * @since 1.0.0
 * Vite plugin for effect-ui
 *
 * Fully Effect-native implementation using:
 * - Data.TaggedError for yieldable errors
 * - FileSystem service from @effect/platform-node
 * - Match for exhaustive pattern matching
 * - Schema for dynamic validation
 * - Effect.forEach with concurrency for parallel operations
 *
 * @example
 * ```ts
 * // vite.config.ts
 * import { defineConfig } from "vite"
 * import { effectUI } from "effect-ui/vite"
 *
 * export default defineConfig({
 *   plugins: [effectUI()]
 * })
 * ```
 */
import type { Plugin, ResolvedConfig, ViteDevServer } from "vite"
import { FileSystem } from "@effect/platform"
import { layer as NodeFileSystemLayer } from "@effect/platform-node/NodeFileSystem"
import { Array, Data, Effect, Exit, HashMap, Layer, Logger, LogLevel, Match, Option, Runtime, Schema, Scope } from "effect"
import * as nodePath from "node:path"
import { ApiInitError, type ApiMiddleware, createApiMiddleware } from "./api-middleware.js"

// =============================================================================
// Constants
// =============================================================================

const APP_DIR = "app"
const GENERATED_DIR = ".effect-ui"
const SCAN_CONCURRENCY = 10

const VIRTUAL_ROUTES_ID = "virtual:effect-ui/routes"
const RESOLVED_VIRTUAL_ROUTES_ID = "\0" + VIRTUAL_ROUTES_ID
const VIRTUAL_CLIENT_ID = "virtual:effect-ui/client"
const RESOLVED_VIRTUAL_CLIENT_ID = "\0" + VIRTUAL_CLIENT_ID

// =============================================================================
// Types
// =============================================================================

/**
 * Route file type
 * @since 1.0.0
 */
export type RouteFileType = "page" | "layout" | "loading" | "error"

/**
 * Route file info extracted from the file system
 * @since 1.0.0
 */
export interface RouteFile {
  readonly filePath: string
  readonly routePath: string
  readonly type: RouteFileType
  readonly depth: number
}

// =============================================================================
// Error Types - Yieldable via Data.TaggedError
// =============================================================================

/**
 * Plugin validation error.
 * @since 1.0.0
 */
export class PluginValidationError extends Data.TaggedError("PluginValidationError")<{
  readonly reason: "MissingFile" | "MissingExport" | "RouteConflict" | "InvalidStructure"
  readonly message: string
  readonly file?: string | undefined
  readonly details?: string | undefined
}> {
  static missingFile(file: string, details?: string): PluginValidationError {
    return new PluginValidationError({
      reason: "MissingFile",
      message: `Required file missing: ${file}`,
      file,
      details,
    })
  }

  static missingExport(file: string, exportName: string): PluginValidationError {
    return new PluginValidationError({
      reason: "MissingExport",
      message: `${file} must export '${exportName}'`,
      file,
    })
  }

  static routeConflict(routePath: string, file: string): PluginValidationError {
    return new PluginValidationError({
      reason: "RouteConflict",
      message: `Route conflict: ${routePath}`,
      file,
      details: "Path defined both as page route and API endpoint",
    })
  }

  static invalidStructure(message: string, file?: string): PluginValidationError {
    return new PluginValidationError({
      reason: "InvalidStructure",
      message,
      file,
    })
  }
}

/**
 * Multiple plugin validation errors.
 * @since 1.0.0
 */
export class PluginValidationErrors extends Data.TaggedError("PluginValidationErrors")<{
  readonly errors: Array.NonEmptyArray<PluginValidationError>
}> {
  override get message(): string {
    return this.errors.map((e) => {
      const loc = e.file ? ` (${e.file})` : ""
      const detail = e.details ? `: ${e.details}` : ""
      return `${e.message}${loc}${detail}`
    }).join("\n")
  }
}

/**
 * Plugin file system error.
 * @since 1.0.0
 */
export class PluginFileSystemError extends Data.TaggedError("PluginFileSystemError")<{
  readonly operation: "read" | "write" | "mkdir" | "exists" | "readdir" | "stat"
  readonly path: string
  readonly cause: unknown
}> {}

/**
 * Plugin parse error.
 * @since 1.0.0
 */
export class PluginParseError extends Data.TaggedError("PluginParseError")<{
  readonly message: string
  readonly input: unknown
}> {}

// =============================================================================
// Logging (consola - async reporters, non-blocking I/O)
// =============================================================================

import { createConsola } from "consola"

const logger = createConsola({ defaults: { tag: "effect-ui" } })

/**
 * Plugin logger backed by consola.
 * Consola uses async reporters with buffered process.stdout.write,
 * so it won't block I/O like raw console.log calls.
 * @internal
 */
const PluginLogger = Logger.make(({ message, logLevel, annotations }) => {
  const text = String(message)
  const style = HashMap.get(annotations, "style").pipe(Option.getOrUndefined)

  if (LogLevel.greaterThanEqual(logLevel, LogLevel.Error)) {
    logger.error(text)
  } else if (LogLevel.greaterThanEqual(logLevel, LogLevel.Warning)) {
    logger.warn(text)
  } else if (style === "success") {
    logger.success(text)
  } else if (LogLevel.lessThanEqual(logLevel, LogLevel.Debug)) {
    logger.debug(text)
  } else {
    logger.info(text)
  }
})

/**
 * Plugin layer combining FileSystem, consola logger, and debug-level minimum.
 * @internal
 */
const PluginLayer = Layer.mergeAll(
  NodeFileSystemLayer,
  Logger.replace(Logger.defaultLogger, PluginLogger),
  Logger.minimumLogLevel(LogLevel.Debug)
)

/**
 * Log validation errors with details.
 * @internal
 */
const logValidationErrors = (e: PluginValidationErrors): Effect.Effect<void> =>
  Effect.forEach(e.errors, (error) =>
    Effect.gen(function* () {
      yield* Effect.logError(error.message)
      if (error.details) {
        yield* Effect.logDebug(`  ${error.details}`)
      }
    })
  ).pipe(Effect.asVoid)

/**
 * Log parse error.
 * @internal
 */
const logParseError = (e: PluginParseError): Effect.Effect<void> =>
  Effect.logError(`Failed to parse module: ${e.message}`)

/**
 * Log API validation errors (handles both validation and parse errors).
 * @internal
 */
const logApiValidationError = (e: PluginValidationErrors | PluginParseError): Effect.Effect<void> =>
  Match.value(e).pipe(
    Match.tag("PluginValidationErrors", logValidationErrors),
    Match.tag("PluginParseError", logParseError),
    Match.exhaustive
  )

// =============================================================================
// Schema for API Module Validation
// =============================================================================

const ApiModuleSchema = Schema.Struct({
  Api: Schema.optional(Schema.Unknown),
  api: Schema.optional(Schema.Unknown),
  ApiLive: Schema.optional(Schema.Unknown),
})

const ApiGroupsSchema = Schema.Struct({
  groups: Schema.optional(
    Schema.Record({
      key: Schema.String,
      value: Schema.Struct({
        endpoints: Schema.optional(
          Schema.Record({
            key: Schema.String,
            value: Schema.Struct({
              path: Schema.optional(Schema.String),
            }),
          })
        ),
      }),
    })
  ),
})

// =============================================================================
// Pure Helper Effects
// =============================================================================

/**
 * Convert backslashes to forward slashes for import paths.
 * @internal
 */
const generateImportPath = (filePath: string): Effect.Effect<string> =>
  Effect.succeed(filePath.replace(/\\/g, "/"))

/**
 * Extract param names from a route path.
 * @since 1.0.0
 */
export const extractParamNames = (routePath: string): Effect.Effect<ReadonlyArray<string>> =>
  Effect.gen(function* () {
    const segments = routePath.split("/").filter(Boolean)
    return Array.filterMap(segments, (segment) =>
      segment.startsWith(":") ? Option.some(segment.slice(1)) : Option.none()
    )
  })

/**
 * Generate TypeScript type for route params.
 * @since 1.0.0
 */
export const generateParamType = (routePath: string): Effect.Effect<string> =>
  Effect.gen(function* () {
    const params = yield* extractParamNames(routePath)
    if (params.length === 0) {
      return "{}"
    }
    const fields = params.map((p) => `readonly ${p}: string`)
    return `{ ${fields.join("; ")} }`
  })

/**
 * Convert directory/file name param syntax.
 * [param] -> :param, [...rest] -> *
 * @internal
 */
const convertParamSyntax = (name: string): Effect.Effect<string> =>
  Effect.succeed(
    name.replace(/^\[\.\.\.(.+)\]$/, "*").replace(/^\[(.+)\]$/, ":$1")
  )

// =============================================================================
// File System Operations
// =============================================================================

/**
 * Check if path exists.
 * @internal
 */
const pathExists = (filePath: string): Effect.Effect<boolean, never, FileSystem.FileSystem> =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem
    return yield* fs.exists(filePath).pipe(Effect.orElseSucceed(() => false))
  })

/**
 * Write file with directory creation.
 * @internal
 */
const writeFileSafe = (
  filePath: string,
  content: string
): Effect.Effect<void, PluginFileSystemError, FileSystem.FileSystem> =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem
    const dir = nodePath.dirname(filePath)

    yield* fs.makeDirectory(dir, { recursive: true }).pipe(
      Effect.catchTag("SystemError", (e) =>
        e.reason === "AlreadyExists" ? Effect.void : Effect.fail(e)
      ),
      Effect.mapError(
        (cause) =>
          new PluginFileSystemError({
            operation: "mkdir",
            path: dir,
            cause,
          })
      )
    )

    yield* fs.writeFileString(filePath, content).pipe(
      Effect.mapError(
        (cause) =>
          new PluginFileSystemError({
            operation: "write",
            path: filePath,
            cause,
          })
      )
    )
  })

// =============================================================================
// Route File Processing
// =============================================================================

/**
 * Determine route file type from basename using Match.
 * @internal
 */
const determineRouteType = (
  basename: string
): Effect.Effect<Option.Option<{ type: RouteFileType; isIndex: boolean }>> =>
  Effect.succeed(
    Match.value(basename).pipe(
      Match.when(
        (b) => b === "layout" || b === "_layout",
        () => Option.some({ type: "layout" as const, isIndex: false })
      ),
      Match.when(
        (b) => b === "_loading",
        () => Option.some({ type: "loading" as const, isIndex: false })
      ),
      Match.when(
        (b) => b === "_error",
        () => Option.some({ type: "error" as const, isIndex: false })
      ),
      Match.when(
        (b) => b === "index",
        () => Option.some({ type: "page" as const, isIndex: true })
      ),
      Match.when(
        (b) => b.startsWith("_"),
        () => Option.none()
      ),
      Match.orElse(() => Option.some({ type: "page" as const, isIndex: false }))
    )
  )

/**
 * Process a single route file and extract route info.
 * @internal
 */
const processRouteFile = (
  fullPath: string,
  fileName: string,
  parentPath: string,
  depth: number
): Effect.Effect<Option.Option<RouteFile>> =>
  Effect.gen(function* () {
    const basename = fileName.replace(/\.(tsx|ts|jsx|js)$/, "")
    const typeInfo = yield* determineRouteType(basename)

    if (Option.isNone(typeInfo)) {
      return Option.none()
    }

    const { type, isIndex } = typeInfo.value

    const routePath = yield* Effect.gen(function* () {
      if (type === "layout" || type === "loading" || type === "error" || isIndex) {
        return parentPath || "/"
      }
      const segment = yield* convertParamSyntax(basename)
      return (parentPath || "") + "/" + segment
    })

    return Option.some({
      filePath: fullPath,
      routePath,
      type,
      depth,
    })
  })

/**
 * Recursively scan a directory for route files.
 * Entry processing is inlined with Match for file type dispatch.
 * @internal
 */
const scanDir = (
  dir: string,
  parentPath: string,
  depth: number
): Effect.Effect<ReadonlyArray<RouteFile>, PluginFileSystemError, FileSystem.FileSystem> =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem
    const entries = yield* fs.readDirectory(dir).pipe(
      Effect.mapError(
        (cause) =>
          new PluginFileSystemError({
            operation: "readdir",
            path: dir,
            cause,
          })
      )
    )

    const results = yield* Effect.forEach(
      entries,
      (entryName) =>
        Effect.gen(function* () {
          const fullPath = nodePath.join(dir, entryName)
          const stat = yield* fs.stat(fullPath).pipe(
            Effect.mapError(
              (cause) =>
                new PluginFileSystemError({
                  operation: "stat",
                  path: fullPath,
                  cause,
                })
            )
          )

          return yield* Match.value(stat.type).pipe(
            Match.when("Directory", () =>
              Effect.gen(function* () {
                const dirName = yield* convertParamSyntax(entryName)
                return yield* scanDir(fullPath, parentPath + "/" + dirName, depth + 1)
              })
            ),
            Match.when("File", () =>
              /\.(tsx|ts|jsx|js)$/.test(entryName)
                ? processRouteFile(fullPath, entryName, parentPath, depth).pipe(
                    Effect.map((opt) => Option.isSome(opt) ? [opt.value] : [] as ReadonlyArray<RouteFile>)
                  )
                : Effect.succeed([] as ReadonlyArray<RouteFile>)
            ),
            Match.orElse(() => Effect.succeed([] as ReadonlyArray<RouteFile>))
          )
        }),
      { concurrency: SCAN_CONCURRENCY }
    )

    return Array.flatten(results)
  })

/**
 * Scan routes directory and extract route files.
 * Uses Effect.forEach with bounded concurrency for parallel scanning.
 * @since 1.0.0
 */
export const scanRoutes = (
  routesDir: string
): Effect.Effect<ReadonlyArray<RouteFile>, PluginFileSystemError, FileSystem.FileSystem> =>
  Effect.gen(function* () {
    const exists = yield* pathExists(routesDir)
    if (!exists) {
      return []
    }
    return yield* scanDir(routesDir, "", 0)
  })

// =============================================================================
// Validation
// =============================================================================

/**
 * Validate app structure.
 * @since 1.0.0
 */
export const validateAppStructure = (
  appDir: string
): Effect.Effect<void, PluginValidationErrors, FileSystem.FileSystem> =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem

    const layoutPathTsx = nodePath.join(appDir, "layout.tsx")
    const layoutPathTs = nodePath.join(appDir, "layout.ts")
    const routesDir = nodePath.join(appDir, "routes")

    const [hasLayoutTsx, hasLayoutTs, hasRoutesDir] = yield* Effect.all([
      fs.exists(layoutPathTsx).pipe(Effect.orElseSucceed(() => false)),
      fs.exists(layoutPathTs).pipe(Effect.orElseSucceed(() => false)),
      fs.exists(routesDir).pipe(Effect.orElseSucceed(() => false)),
    ])

    const errors: Array<PluginValidationError> = []

    if (!hasLayoutTsx && !hasLayoutTs) {
      errors.push(
        PluginValidationError.missingFile(
          layoutPathTsx,
          "Create app/layout.tsx with your root layout component (including <html> and <body>)"
        )
      )
    }

    if (!hasRoutesDir) {
      errors.push(
        PluginValidationError.missingFile(
          routesDir,
          "Create app/routes/ directory with your page components"
        )
      )
    }

    if (Array.isNonEmptyArray(errors)) {
      return yield* new PluginValidationErrors({ errors })
    }
  })

/**
 * Validate API exports using Schema.
 * @since 1.0.0
 */
export const validateApiExports = (
  apiPath: string,
  loadModule: (path: string) => Effect.Effect<Record<string, unknown>, PluginParseError>
): Effect.Effect<void, PluginValidationErrors | PluginParseError, FileSystem.FileSystem> =>
  Effect.gen(function* () {
    const hasApi = yield* pathExists(apiPath)
    if (!hasApi) {
      return
    }

    const mod = yield* loadModule(apiPath)
    const decoded = Schema.decodeUnknownOption(ApiModuleSchema)(mod)
    if (Option.isNone(decoded)) {
      return
    }

    const errors: Array<PluginValidationError> = []
    const { Api, api, ApiLive } = decoded.value

    if (Api === undefined && api === undefined) {
      errors.push(
        PluginValidationError.missingExport(apiPath, "Api")
      )
    }

    if (ApiLive === undefined) {
      errors.push(
        PluginValidationError.missingExport(apiPath, "ApiLive")
      )
    }

    if (Array.isNonEmptyArray(errors)) {
      return yield* new PluginValidationErrors({ errors })
    }
  })

/**
 * Check for route/API conflicts.
 * @since 1.0.0
 */
export const checkRouteApiConflicts = (
  routes: ReadonlyArray<RouteFile>,
  apiPath: string,
  loadModule: (path: string) => Effect.Effect<Record<string, unknown>, PluginParseError>
): Effect.Effect<void, PluginValidationErrors | PluginParseError, FileSystem.FileSystem> =>
  Effect.gen(function* () {
    const hasApi = yield* pathExists(apiPath)
    if (!hasApi) {
      return
    }

    const mod = yield* loadModule(apiPath)
    const api = mod.Api ?? mod.api
    if (api === undefined) return

    // Schema validates structure; returns None for non-matching shapes
    const decoded = Schema.decodeUnknownOption(ApiGroupsSchema)(api)
    if (Option.isNone(decoded)) return
    const { groups } = decoded.value
    if (groups === undefined) return

    // Collect all API endpoint paths (normalized) using declarative operations
    const apiPaths = new Set(
      Object.values(groups).flatMap((group) =>
        group.endpoints
          ? Array.filterMap(Object.values(group.endpoints), (ep) =>
              ep.path !== undefined
                ? Option.some(ep.path.replace(/:\w+/g, ":param"))
                : Option.none()
            )
          : []
      )
    )

    const errors = Array.filterMap(
      Array.filter(routes, (r) => r.type === "page"),
      (route) => {
        const normalized = route.routePath.replace(/:\w+/g, ":param")
        return apiPaths.has(normalized)
          ? Option.some(PluginValidationError.routeConflict(route.routePath, route.filePath))
          : Option.none()
      }
    )

    if (Array.isNonEmptyArray(errors)) {
      return yield* new PluginValidationErrors({ errors })
    }
  })

// =============================================================================
// Code Generation
// =============================================================================

/**
 * Find the most specific special file for a route.
 * @internal
 */
const findSpecialFile = (
  routePath: string,
  specialRoutes: ReadonlyArray<RouteFile>
): Effect.Effect<Option.Option<RouteFile>> =>
  Effect.gen(function* () {
    // Sort by depth descending to find most specific first
    const sorted = [...specialRoutes].sort((a, b) => b.depth - a.depth)

    return Array.findFirst(sorted, (special) => {
      if (special.routePath === "/") {
        return true
      }
      return routePath === special.routePath || routePath.startsWith(special.routePath + "/")
    })
  })

/**
 * Generate a single route entry.
 * @internal
 */
const generateRouteEntry = (
  route: RouteFile,
  layoutRoutes: ReadonlyArray<RouteFile>,
  loadingRoutes: ReadonlyArray<RouteFile>,
  errorRoutes: ReadonlyArray<RouteFile>
): Effect.Effect<string> =>
  Effect.gen(function* () {
    const importPath = yield* generateImportPath(route.filePath)
    const layout = yield* findSpecialFile(route.routePath, layoutRoutes)
    const loading = yield* findSpecialFile(route.routePath, loadingRoutes)
    const error = yield* findSpecialFile(route.routePath, errorRoutes)

    const parts: string[] = [
      `  {`,
      `    path: "${route.routePath}",`,
      `    component: () => import("${importPath}")`,
    ]

    // Guard uses the same module as the component - runtime checks for guard export
    parts.push(`,\n    guard: () => import("${importPath}")`)

    if (Option.isSome(layout)) {
      const layoutPath = yield* generateImportPath(layout.value.filePath)
      parts.push(`,\n    layout: () => import("${layoutPath}")`)
    }

    if (Option.isSome(loading)) {
      const loadingPath = yield* generateImportPath(loading.value.filePath)
      parts.push(`,\n    loadingComponent: () => import("${loadingPath}")`)
    }

    if (Option.isSome(error)) {
      const errorPath = yield* generateImportPath(error.value.filePath)
      parts.push(`,\n    errorComponent: () => import("${errorPath}")`)
    }

    parts.push(`\n  }`)
    return parts.join("")
  })

/**
 * Generate routes module.
 * @since 1.0.0
 */
export const generateRoutesModule = (
  routes: ReadonlyArray<RouteFile>,
  routesDir: string
): Effect.Effect<string> =>
  Effect.gen(function* () {
    const pageRoutes = Array.filter(routes, (r) => r.type === "page")
    const layoutRoutes = Array.filter(routes, (r) => r.type === "layout")
    const loadingRoutes = Array.filter(routes, (r) => r.type === "loading")
    const errorRoutes = Array.filter(routes, (r) => r.type === "error")

    const routeEntries = yield* Effect.forEach(
      pageRoutes,
      (route) => generateRouteEntry(route, layoutRoutes, loadingRoutes, errorRoutes),
      { concurrency: SCAN_CONCURRENCY }
    )

    // Template literals are the standard approach for code generation in the Effect ecosystem
    // (see @effect/cli shell completions, effect/scripts for precedent)
    return `// Auto-generated by effect-ui
// Routes from: ${routesDir}

export const routes = [
${Array.join(routeEntries, ",\n")}
];

export default routes;
`
  })

/**
 * Generate route type declarations.
 * @since 1.0.0
 */
export const generateRouteTypes = (
  routes: ReadonlyArray<RouteFile>
): Effect.Effect<string> =>
  Effect.gen(function* () {
    const pageRoutes = Array.filter(routes, (r) => r.type === "page")

    const mapEntries = yield* Effect.forEach(
      pageRoutes,
      (route) =>
        Effect.gen(function* () {
          const paramType = yield* generateParamType(route.routePath)
          return `    readonly "${route.routePath}": ${paramType}`
        }),
      { concurrency: SCAN_CONCURRENCY }
    )

    return `// Auto-generated by effect-ui
// DO NOT EDIT - This file is regenerated when routes change

declare module "virtual:effect-ui/routes" {
  export const routes: Array<{
    path: string
    component: () => Promise<{ default: unknown }>
    layout?: () => Promise<{ default: unknown }>
    loadingComponent?: () => Promise<{ default: unknown }>
    errorComponent?: () => Promise<{ default: unknown }>
  }>
  export default routes
}

declare module "effect-ui/router" {
  interface RouteMap {
${Array.join(mapEntries, "\n")}
  }
}

export {}
`
  })

/**
 * Generate API type declarations.
 * @since 1.0.0
 */
export const generateApiTypes = (
  appDir: string
): Effect.Effect<string, never, FileSystem.FileSystem> =>
  Effect.gen(function* () {
    const apiPath = nodePath.join(appDir, "api.ts")
    const hasApi = yield* pathExists(apiPath)

    if (!hasApi) {
      return `// Auto-generated by effect-ui
// No API file found at app/api.ts

declare module "virtual:effect-ui/client" {
  export const client: never
  export const resources: never
}

export {}
`
    }

    const relativePath =
      "./" +
      nodePath
        .relative(nodePath.dirname(apiPath), apiPath)
        .replace(/\\/g, "/")
        .replace(/\.ts$/, "")

    return `// Auto-generated by effect-ui
// DO NOT EDIT - This file is regenerated when API changes

declare module "virtual:effect-ui/client" {
  import type { HttpApiClient } from "@effect/platform"
  import type { Api } from "${relativePath}"

  export const client: ReturnType<typeof HttpApiClient.make<typeof Api>>

  // TODO: Generate typed resources
  export const resources: Record<string, unknown>
}

export {}
`
  })

/**
 * Generate client module.
 * @since 1.0.0
 */
export const generateClientModule = (
  appDir: string
): Effect.Effect<string, never, FileSystem.FileSystem> =>
  Effect.gen(function* () {
    const apiPath = nodePath.join(appDir, "api.ts")
    const hasApi = yield* pathExists(apiPath)

    if (!hasApi) {
      return `// Auto-generated by effect-ui
// No API file found

export const client = undefined;
export const resources = {};
`
    }

    const importPath = yield* generateImportPath(apiPath)

    return `// Auto-generated by effect-ui
import { HttpApiClient } from "@effect/platform";
import { Api } from "${importPath}";

export const client = HttpApiClient.make(Api, { baseUrl: "" });

// TODO: Generate typed resources with cache keys
export const resources = {};
`
  })

/**
 * Generate entry module.
 * @since 1.0.0
 */
export const generateEntryModule = (
  appDir: string,
  generatedDir: string
): Effect.Effect<string> =>
  Effect.gen(function* () {
    const relativeAppDir = nodePath.relative(generatedDir, appDir).replace(/\\/g, "/")

    return `// Auto-generated by effect-ui - DO NOT EDIT
import { mount, Component } from "effect-ui"
import * as Router from "effect-ui/router"
import { routes } from "virtual:effect-ui/routes"
import Layout from "${relativeAppDir}/layout"

const App = Component.gen(function* () {
  // Render Outlet directly - it handles async loading internally
  return <Layout><Router.Outlet routes={routes} /></Layout>
})

const container = document.getElementById("root")
if (container) {
  mount(container, <App />)
}
`
  })

/**
 * Generate HTML template.
 * @since 1.0.0
 */
export const generateHtmlTemplate = (generatedDir: string): Effect.Effect<string> =>
  Effect.gen(function* () {
    const entryPath = nodePath
      .relative(process.cwd(), nodePath.join(generatedDir, "entry.tsx"))
      .replace(/\\/g, "/")

    return `<!DOCTYPE html>
<html>
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>effect-ui</title>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/${entryPath}"></script>
  </body>
</html>`
  })

// =============================================================================
// Plugin
// =============================================================================

/**
 * Effect UI Vite plugin
 *
 * Provides:
 * - JSX configuration for effect-ui
 * - File-based routing from app/routes/
 * - Root layout from app/layout.tsx
 * - API handling from app/api.ts
 * - Auto-generated entry point
 *
 * --- Effect Service Design (future refactor) ---
 *
 * The plugin could be modeled as an Effect Service for better testability
 * and composition. The mutable `let` bindings would become Ref state inside
 * a service scope:
 *
 * ```ts
 * class PluginConfig extends Context.Tag("PluginConfig")<PluginConfig, {
 *   readonly appDir: string
 *   readonly routesDir: string
 *   readonly generatedDir: string
 *   readonly viteConfig: ResolvedConfig
 * }>() {}
 *
 * class PluginService extends Context.Tag("PluginService")<PluginService, {
 *   readonly scanAndGenerate: Effect.Effect<void, PluginFileSystemError>
 *   readonly reload: Effect.Effect<void, ApiInitError>
 * }>() {}
 *
 * const PluginServiceLive = Layer.effect(PluginService,
 *   Effect.gen(function* () {
 *     const config = yield* PluginConfig
 *     const fs = yield* FileSystem.FileSystem
 *     // ... build service methods using config and fs
 *     return { scanAndGenerate: ..., reload: ... }
 *   })
 * )
 *
 * // Plugin factory becomes a thin wrapper:
 * export const effectUI = (): Plugin => {
 *   const runtime = Effect.runSync(
 *     Layer.toRuntime(Layer.mergeAll(PluginServiceLive, PluginLayer))
 *   )
 *   return { name: "effect-ui", configureServer: (server) => ... }
 * }
 * ```
 *
 * Benefits: testable without Vite, composable layers, no mutable state.
 * Deferred until plugin API stabilizes.
 *
 * @since 1.0.0
 */
export const effectUI = (): Plugin => {
  let config: ResolvedConfig
  let appDir: string
  let routesDir: string
  let generatedDir: string

  return {
    name: "effect-ui",
    enforce: "pre",

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

    async configResolved(resolvedConfig) {
      config = resolvedConfig
      appDir = nodePath.resolve(config.root, APP_DIR)
      routesDir = nodePath.join(appDir, "routes")
      generatedDir = nodePath.resolve(config.root, GENERATED_DIR)

      await Effect.runPromise(
        Effect.gen(function* () {
          const fs = yield* FileSystem.FileSystem
          yield* fs.makeDirectory(generatedDir, { recursive: true }).pipe(
            Effect.catchTag("SystemError", (e) =>
              e.reason === "AlreadyExists" ? Effect.void : Effect.fail(e)
            ),
            Effect.mapError(
              (cause) =>
                new PluginFileSystemError({
                  operation: "mkdir",
                  path: generatedDir,
                  cause,
                })
            )
          )
          yield* Effect.logInfo("effect-ui configured")
          yield* Effect.logDebug(`  App directory: ${appDir}`)
          yield* Effect.logDebug(`  Routes directory: ${routesDir}`)
          yield* Effect.logDebug(`  Generated directory: ${generatedDir}`)
        }).pipe(Effect.provide(PluginLayer))
      )
    },

    async configureServer(server: ViteDevServer) {
      const effect = Effect.gen(function* () {
        // Extract runtime for use in non-Effect callbacks (Vite boundary)
        const runtime = yield* Effect.runtime<FileSystem.FileSystem>()
        const runPromise = Runtime.runPromise(runtime)

        const routeTypesPath = nodePath.join(generatedDir, "routes.d.ts")
        const apiTypesPath = nodePath.join(generatedDir, "api.d.ts")
        const entryPath = nodePath.join(generatedDir, "entry.tsx")
        const apiPath = nodePath.join(appDir, "api.ts")

        // Effect-based module loader for validation
        const loadModule = (path: string) =>
          Effect.tryPromise({
            try: () => server.ssrLoadModule(path),
            catch: (err) => new PluginParseError({ message: String(err), input: path }),
          })

        yield* validateAppStructure(appDir).pipe(
          Effect.tapError(logValidationErrors)
        )

        const routes = yield* scanRoutes(routesDir)

        // Validate API exports and check for route conflicts
        yield* validateApiExports(apiPath, loadModule).pipe(
          Effect.tapError(logApiValidationError)
        )

        yield* checkRouteApiConflicts(routes, apiPath, loadModule).pipe(
          Effect.tapError(logApiValidationError)
        )

        const routeTypesContent = yield* generateRouteTypes(routes)
        yield* writeFileSafe(routeTypesPath, routeTypesContent)

        const apiTypesContent = yield* generateApiTypes(appDir)
        yield* writeFileSafe(apiTypesPath, apiTypesContent)

        const entryContent = yield* generateEntryModule(appDir, generatedDir)
        yield* writeFileSafe(entryPath, entryContent)

        yield* Effect.logInfo(`Generated files in ${GENERATED_DIR}/`).pipe(Effect.annotateLogs("style", "success"))


        let apiMiddleware: Option.Option<ApiMiddleware> = Option.none()
        let apiScope: Option.Option<Scope.CloseableScope> = Option.none()
        const hasApi = yield* pathExists(apiPath)

        if (hasApi) {
          // Create scope for middleware lifecycle
          const scope = yield* Scope.make()

          // Create middleware with scope - use Scope.extend to bind finalizers to scope
          const mw = yield* Scope.extend(
            createApiMiddleware({
              // Use Effect-based loadModule with error mapping
              loadApiModule: () =>
                loadModule(apiPath).pipe(
                  Effect.mapError((err) =>
                    new ApiInitError({
                      message: "Failed to load API module",
                      cause: err,
                    })
                  )
                ),
              onError: (error) =>
                Effect.logError(`API handler error: ${error}`),
            }),
            scope
          )

          apiMiddleware = Option.some(mw)
          apiScope = Option.some(scope)

          yield* Effect.logInfo("API handlers loaded").pipe(Effect.annotateLogs("style", "success"))
        }

        // Vite boundary: file watcher callbacks use extracted runtime
        server.watcher.on("change", async (file) => {
          await runPromise(Effect.gen(function* () {
            if (file.startsWith(routesDir)) {
              const routes = yield* scanRoutes(routesDir)
              const content = yield* generateRouteTypes(routes)
              yield* writeFileSafe(routeTypesPath, content)
              yield* Effect.logDebug("Regenerated routes.d.ts")
            }

            if (file.endsWith("api.ts")) {
              const content = yield* generateApiTypes(appDir)
              yield* writeFileSafe(apiTypesPath, content)
              yield* Effect.logDebug("Regenerated api.d.ts")

              if (Option.isSome(apiMiddleware)) {
                yield* apiMiddleware.value.reload
                yield* Effect.logDebug("Reloaded API handlers")
              }
            }
          }))
        })

        server.watcher.on("add", async (file) => {
          await runPromise(Effect.gen(function* () {
            if (!file.startsWith(routesDir)) {
              return
            }
            const routes = yield* scanRoutes(routesDir)
            const content = yield* generateRouteTypes(routes)
            yield* writeFileSafe(routeTypesPath, content)
            yield* Effect.logDebug("Regenerated routes.d.ts")
          }))
        })

        // Vite boundary: close scope when server closes (triggers finalizer)
        server.httpServer?.on("close", () => {
          if (Option.isSome(apiScope)) {
            runPromise(Scope.close(apiScope.value, Exit.void))
          }
        })

        if (Option.isSome(apiMiddleware)) {
          server.middlewares.use(apiMiddleware.value.middleware)
        }

        return () => {
          server.middlewares.use((req, res, next) => {
            if (req.url && !req.url.includes(".") && req.method === "GET") {
              req.url = "/index.html"
            }
            next()
          })
        }
      }).pipe(Effect.provide(PluginLayer))

      return await Effect.runPromise(effect)
    },

    resolveId(id) {
      const effect = Effect.gen(function* () {
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
      });

      return Effect.runSync(effect);
    },

    async load(id) {
      const effect = Effect.gen(function* () {
        if (id === RESOLVED_VIRTUAL_ROUTES_ID) {
          const routes = yield* scanRoutes(routesDir)
          return yield* generateRoutesModule(routes, routesDir)
        }
        if (id === RESOLVED_VIRTUAL_CLIENT_ID) {
          return yield* generateClientModule(appDir)
        }
        return null
      }).pipe(Effect.provide(PluginLayer))

      return Effect.runPromise(effect)
    },

    async buildStart() {
      const effect = Effect.gen(function* () {
      const entryPath = nodePath.join(generatedDir, "entry.tsx")
      const indexPath = nodePath.join(config.root, "index.html")
      const hasEntry = yield* pathExists(entryPath)
      if (!hasEntry) {
        const content = yield* generateEntryModule(appDir, generatedDir)
        yield* writeFileSafe(entryPath, content)
      }

      const hasIndex = yield* pathExists(indexPath)
        if (!hasIndex) {
          const content = yield* generateHtmlTemplate(generatedDir)
          yield* writeFileSafe(indexPath, content)
          yield* Effect.logInfo("Generated index.html").pipe(Effect.annotateLogs("style", "success"))
        }
      }).pipe(Effect.provide(PluginLayer))

      await Effect.runPromise(effect)
    },

    async buildEnd() {
      const effect = validateAppStructure(appDir).pipe(
        Effect.provide(PluginLayer)
      )
      return Effect.runPromise(effect)
    },
  }
}

export default effectUI
