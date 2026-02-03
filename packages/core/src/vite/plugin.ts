/**
 * @since 1.0.0
 * Vite plugin for trygg
 *
 * Fully Effect-native implementation using:
 * - Data.TaggedError for yieldable errors
 * - FileSystem service via DevPlatform abstraction
 * - Match for exhaustive pattern matching
 * - Schema for dynamic validation
 * - Effect.forEach with concurrency for parallel operations
 *
 * @example
 * ```ts
 * // vite.config.ts
 * import { defineConfig } from "vite"
 * import { trygg } from "trygg/vite-plugin"
 * import tryggConfig from "./trygg.config"
 *
 * export default defineConfig({
 *   plugins: [trygg(tryggConfig)]
 * })
 * ```
 */
import type { Plugin, ResolvedConfig, ViteDevServer } from "vite";
import { build } from "vite";
import { FileSystem } from "@effect/platform";
import {
  Array,
  Data,
  Effect,
  Exit,
  HashMap,
  Layer,
  Logger,
  LogLevel,
  Match,
  Option,
  Runtime,
  Scope,
} from "effect";
import * as nodePath from "node:path";
import type { TryggConfig, Platform } from "../config.js";
import {
  DevPlatform,
  type DevApiHandle,
  type HandlerFactory,
  ApiInitError,
  ImportError,
} from "./dev-platform.js";
import * as Debug from "../debug/debug.js";
import { NodeDevPlatformLive } from "./dev-platform-node.js";
// BunDevPlatformLive is loaded dynamically to avoid loading @effect/platform-bun in Node.js

// =============================================================================
// Constants
// =============================================================================

const APP_DIR = "app";
const GENERATED_DIR = ".trygg";

const VIRTUAL_HANDLER_FACTORY_ID = "virtual:trygg/handler-factory";
const RESOLVED_HANDLER_FACTORY_ID = "\0" + VIRTUAL_HANDLER_FACTORY_ID;

/**
 * Shared handler factory logic for virtual modules.
 * Requires the user module to have a default export that is a composed Layer.
 * No platform-specific imports — only @effect/platform and effect.
 * @internal
 */
const SHARED_FACTORY_CODE = `
import { HttpApiBuilder, HttpServer } from "@effect/platform";
import { Data, Effect, Layer, Scope, Exit } from "effect";

class FactoryError extends Data.TaggedError("FactoryError") {}

// Trust boundary: TypeScript enforces Layer<HttpApi.Api> in user code.
// At the SSR module boundary types are erased — Layer.isLayer is the
// strongest runtime check possible (Layer type params are phantom).
export const detectAndComposeLayer = (mod) =>
  Effect.gen(function* () {
    if (!("default" in mod) || !Layer.isLayer(mod.default)) {
      return yield* new FactoryError({
        message: "app/api.ts must have a default export that is a composed Layer (e.g. export default HttpApiBuilder.api(Api).pipe(Layer.provide(handlers)))",
      });
    }

    return mod.default;
  });

export const createWebHandler = (apiLive) => {
  const apiLayer = Layer.mergeAll(apiLive, HttpServer.layerContext);
  return HttpApiBuilder.toWebHandler(apiLayer);
};
`;

/**
 * Node handler factory — extends shared code with NodeHttpServer.makeHandler.
 * @internal
 */
const NODE_HANDLER_FACTORY_CODE =
  SHARED_FACTORY_CODE +
  `
import * as NodeHttpServer from "@effect/platform-node/NodeHttpServer";

export const createNodeHandler = (apiLive) =>
  Effect.gen(function* () {
    const apiLayer = Layer.mergeAll(
      apiLive,
      HttpApiBuilder.Router.Live,
      HttpApiBuilder.Middleware.layer,
      HttpServer.layerContext,
    );

    const handlerScope = yield* Scope.make();
    const runtime = yield* Layer.toRuntime(apiLayer).pipe(Scope.extend(handlerScope));
    const httpApp = yield* Effect.provide(HttpApiBuilder.httpApp, runtime);
    const handler = yield* NodeHttpServer.makeHandler(httpApp).pipe(
      Effect.provide(runtime),
      Scope.extend(handlerScope),
    );

    return {
      handler,
      dispose: Scope.close(handlerScope, Exit.void).pipe(Effect.ignore),
    };
  });
`;

/**
 * Bun handler factory — shared code only (no @effect/platform-node).
 * Uses createWebHandler for handler creation.
 * @internal
 */
const BUN_HANDLER_FACTORY_CODE = SHARED_FACTORY_CODE;

// =============================================================================
// Types
// =============================================================================

// =============================================================================
// Error Types - Yieldable via Data.TaggedError
// =============================================================================

/**
 * Plugin validation error.
 * @since 1.0.0
 */
export class PluginValidationError extends Data.TaggedError("PluginValidationError")<{
  readonly reason: "MissingFile" | "MissingExport" | "RouteConflict" | "InvalidStructure";
  readonly message: string;
  readonly file?: string | undefined;
  readonly details?: string | undefined;
}> {
  static missingFile(file: string, details?: string): PluginValidationError {
    return new PluginValidationError({
      reason: "MissingFile",
      message: `Required file missing: ${file}`,
      file,
      details,
    });
  }

  static missingExport(file: string, exportName: string): PluginValidationError {
    return new PluginValidationError({
      reason: "MissingExport",
      message: `${file} must export '${exportName}'`,
      file,
    });
  }

  static routeConflict(routePath: string, file: string): PluginValidationError {
    return new PluginValidationError({
      reason: "RouteConflict",
      message: `Route conflict: ${routePath}`,
      file,
      details: "Path defined both as page route and API endpoint",
    });
  }

  static invalidStructure(message: string, file?: string): PluginValidationError {
    return new PluginValidationError({
      reason: "InvalidStructure",
      message,
      file,
    });
  }
}

/**
 * Multiple plugin validation errors.
 * @since 1.0.0
 */
export class PluginValidationErrors extends Data.TaggedError("PluginValidationErrors")<{
  readonly errors: Array.NonEmptyArray<PluginValidationError>;
}> {
  override get message(): string {
    return this.errors
      .map((e) => {
        const loc = e.file ? ` (${e.file})` : "";
        const detail = e.details ? `: ${e.details}` : "";
        return `${e.message}${loc}${detail}`;
      })
      .join("\n");
  }
}

/**
 * Plugin file system error.
 * @since 1.0.0
 */
export class PluginFileSystemError extends Data.TaggedError("PluginFileSystemError")<{
  readonly operation: "read" | "write" | "mkdir" | "exists" | "readdir" | "stat" | "transform";
  readonly path: string;
  readonly cause: unknown;
}> {}

/**
 * Plugin parse error.
 * @since 1.0.0
 */
export class PluginParseError extends Data.TaggedError("PluginParseError")<{
  readonly message: string;
  readonly input: unknown;
}> {}

// =============================================================================
// Logging (consola - async reporters, non-blocking I/O)
// =============================================================================

import { createConsola } from "consola";

const logger = createConsola({ defaults: { tag: "trygg" } });

/**
 * Plugin logger backed by consola.
 * Consola uses async reporters with buffered process.stdout.write,
 * so it won't block I/O like raw console.log calls.
 * @internal
 */
const PluginLogger = Logger.make(({ message, logLevel, annotations }) => {
  const text = String(message);
  const style = HashMap.get(annotations, "style").pipe(Option.getOrUndefined);

  if (LogLevel.greaterThanEqual(logLevel, LogLevel.Error)) {
    logger.error(text);
  } else if (LogLevel.greaterThanEqual(logLevel, LogLevel.Warning)) {
    logger.warn(text);
  } else if (style === "success") {
    logger.success(text);
  } else if (LogLevel.lessThanEqual(logLevel, LogLevel.Debug)) {
    logger.debug(text);
  } else {
    logger.info(text);
  }
});

/**
 * Dynamically import BunDevPlatformLive to avoid loading @effect/platform-bun in Node.js.
 * @internal
 */
const importBunDevPlatform = Effect.tryPromise({
  try: () => import("./dev-platform-bun.js").then((m) => m.BunDevPlatformLive),
  catch: (cause) =>
    new ImportError({
      module: "./dev-platform-bun.js",
      message: "Failed to import BunDevPlatformLive",
      cause,
    }),
});

/**
 * Create plugin layer for given platform.
 * Uses DevPlatform to get platform-specific FileSystem.
 * @internal
 */
const makePluginLayer = (
  platform: Platform,
): Layer.Layer<FileSystem.FileSystem | DevPlatform, ImportError> => {
  const platformLayer =
    platform === "bun" ? Layer.unwrapEffect(importBunDevPlatform) : NodeDevPlatformLive;

  return Layer.mergeAll(
    platformLayer,
    Logger.replace(Logger.defaultLogger, PluginLogger),
    Logger.minimumLogLevel(LogLevel.Debug),
  );
};

/**
 * Log validation errors with details.
 * @internal
 */
const logValidationErrors = (e: PluginValidationErrors): Effect.Effect<void> =>
  Effect.forEach(e.errors, (error) =>
    Effect.gen(function* () {
      yield* Effect.logError(error.message);
      if (error.details) {
        yield* Effect.logDebug(`  ${error.details}`);
      }
    }),
  ).pipe(Effect.asVoid);

/**
 * Log single validation error.
 * @internal
 */
const logValidationError = (e: PluginValidationError): Effect.Effect<void> =>
  Effect.gen(function* () {
    yield* Effect.logError(e.message);
    if (e.details) {
      yield* Effect.logDebug(`  ${e.details}`);
    }
  });

/**
 * Log file system errors.
 * @internal
 */
const logFileSystemError = (e: PluginFileSystemError): Effect.Effect<void> =>
  Effect.logError(`File system ${e.operation} failed for ${e.path}`);

/**
 * Log parse error.
 * @internal
 */
const logParseError = (e: PluginParseError): Effect.Effect<void> =>
  Effect.logError(`Failed to parse module: ${e.message}`);

/**
 * Log API validation errors (handles both validation and parse errors).
 * @internal
 */
const logApiValidationError = (
  e: PluginValidationErrors | PluginValidationError | PluginParseError | PluginFileSystemError,
): Effect.Effect<void> =>
  Match.value(e).pipe(
    Match.tag("PluginValidationErrors", logValidationErrors),
    Match.tag("PluginValidationError", logValidationError),
    Match.tag("PluginParseError", logParseError),
    Match.tag("PluginFileSystemError", logFileSystemError),
    Match.exhaustive,
  );

// =============================================================================
// Pure Helper Effects
// =============================================================================

/**
 * Extract param names from a route path.
 * @since 1.0.0
 */
export const extractParamNames = (routePath: string): Effect.Effect<ReadonlyArray<string>> =>
  Effect.gen(function* () {
    const segments = routePath.split("/").filter(Boolean);
    return Array.filterMap(segments, (segment) =>
      segment.startsWith(":") ? Option.some(segment.slice(1)) : Option.none(),
    );
  });

/**
 * Generate TypeScript type for route params.
 * @since 1.0.0
 */
export const generateParamType = (routePath: string): Effect.Effect<string> =>
  Effect.gen(function* () {
    const params = yield* extractParamNames(routePath);
    if (params.length === 0) {
      return "{}";
    }
    const fields = params.map((p) => `readonly ${p}: string`);
    return `{ ${fields.join("; ")} }`;
  });

// =============================================================================
// Route Parsing & Type Generation
// =============================================================================

/**
 * Parsed route info extracted from a routes.ts source file.
 * @since 1.0.0
 */
export interface ParsedRoute {
  readonly path: string;
  readonly params: ReadonlyArray<ParsedParam>;
  readonly query: ReadonlyArray<ParsedParam>;
  readonly children: ReadonlyArray<ParsedRoute>;
  readonly isIndex: boolean;
}

/**
 * Parsed parameter with name and TypeScript type.
 * @since 1.0.0
 */
export interface ParsedParam {
  readonly name: string;
  readonly type: string;
  readonly optional: boolean;
}

/**
 * Map a Schema type expression to its TypeScript output type.
 * @since 1.0.0
 */
export const schemaToType = (schemaExpr: string): string => {
  const trimmed = schemaExpr.trim();

  // Schema.optional(inner) -> inner type | undefined
  const optionalMatch = trimmed.match(/^Schema\.optional\((.+)\)$/);
  if (optionalMatch !== null && optionalMatch[1] !== undefined) {
    const innerType = schemaToType(optionalMatch[1]);
    return `${innerType} | undefined`;
  }

  // Schema.NumberFromString -> number
  if (trimmed === "Schema.NumberFromString") return "number";

  // Schema.Number -> number
  if (trimmed === "Schema.Number") return "number";

  // Schema.String -> string
  if (trimmed === "Schema.String") return "string";

  // Schema.Boolean -> boolean
  if (trimmed === "Schema.Boolean") return "boolean";

  // Schema.Literal("a", "b") -> "a" | "b"
  const literalMatch = trimmed.match(/^Schema\.Literal\((.+)\)$/);
  if (literalMatch !== null && literalMatch[1] !== undefined) {
    const values = literalMatch[1].split(",").map((v) => v.trim());
    return values.join(" | ");
  }

  // Fallback to string for unknown types
  return "string";
};

/**
 * Parse a Schema.Struct({ ... }) expression to extract field names and types.
 * @since 1.0.0
 */
export const parseSchemaStruct = (structBody: string): ReadonlyArray<ParsedParam> => {
  const params: Array<ParsedParam> = [];
  // Match field: Type patterns (handles nested parens for Schema.optional(Schema.X))
  const fieldRegex = /(\w+)\s*:\s*(Schema\.\w+(?:\([^)]*(?:\([^)]*\))*[^)]*\))?|Schema\.\w+)/g;
  let match: RegExpExecArray | null = fieldRegex.exec(structBody);
  while (match !== null) {
    const name = match[1];
    const schemaExpr = match[2];
    if (name !== undefined && schemaExpr !== undefined) {
      const optional = schemaExpr.startsWith("Schema.optional(");
      params.push({
        name,
        type: schemaToType(schemaExpr),
        optional,
      });
    }
    match = fieldRegex.exec(structBody);
  }
  return params;
};

/**
 * Parse routes from a routes.ts source string.
 * Extracts Route.make() paths, .params() schemas, .query() schemas, and children.
 * @since 1.0.0
 */
export const parseRoutes = (source: string): Effect.Effect<ReadonlyArray<ParsedRoute>> =>
  Effect.gen(function* () {
    const routes: Array<ParsedRoute> = [];

    // Extract all Route.make("path") occurrences with their chained methods
    // Strategy: find Route.make or Route.index calls and capture the chain
    const routeMakeRegex = /Route\.make\(\s*"([^"]+)"\s*\)/g;
    const routeIndexRegex = /Route\.index\(\s*\w+\s*\)/g;

    let routeMatch: RegExpExecArray | null = routeMakeRegex.exec(source);
    while (routeMatch !== null) {
      const path = routeMatch[1];
      if (path !== undefined) {
        // Get the chain after Route.make("path")
        const chainStart = routeMatch.index + routeMatch[0].length;
        const chain = extractChain(source, chainStart);

        const params = extractParamsFromChain(chain);
        const query = extractQueryFromChain(chain);
        const children = yield* extractChildrenFromChain(chain);

        routes.push({ path, params, query, children, isIndex: false });
      }
      routeMatch = routeMakeRegex.exec(source);
    }

    // Extract Route.index() calls (index routes don't have paths)
    let indexMatch: RegExpExecArray | null = routeIndexRegex.exec(source);
    while (indexMatch !== null) {
      routes.push({ path: "", params: [], query: [], children: [], isIndex: true });
      indexMatch = routeIndexRegex.exec(source);
    }

    return routes;
  });

/**
 * Extract the method chain following a Route.make() call.
 * Captures up to the next top-level statement boundary.
 * @internal
 */
const extractChain = (source: string, startIndex: number): string => {
  let depth = 0;
  let i = startIndex;
  const len = source.length;

  while (i < len) {
    const ch = source[i];
    if (ch === "(") depth++;
    else if (ch === ")") {
      if (depth === 0) break;
      depth--;
    } else if (ch === "\n" && depth === 0) {
      // Check if next non-whitespace is a dot (continuation)
      let j = i + 1;
      while (j < len && (source[j] === " " || source[j] === "\t")) j++;
      if (source[j] !== ".") break;
    }
    i++;
  }

  return source.slice(startIndex, i);
};

/**
 * Extract .params(Schema.Struct({...})) from a method chain.
 * @internal
 */
const extractParamsFromChain = (chain: string): ReadonlyArray<ParsedParam> => {
  const paramsMatch = chain.match(/\.params\(\s*Schema\.Struct\(\s*\{([^}]*)\}\s*\)\s*\)/);
  if (paramsMatch === null || paramsMatch[1] === undefined) return [];
  return parseSchemaStruct(paramsMatch[1]);
};

/**
 * Extract .query(Schema.Struct({...})) from a method chain.
 * @internal
 */
const extractQueryFromChain = (chain: string): ReadonlyArray<ParsedParam> => {
  const queryMatch = chain.match(/\.query\(\s*Schema\.Struct\(\s*\{([^}]*)\}\s*\)\s*\)/);
  if (queryMatch === null || queryMatch[1] === undefined) return [];
  return parseSchemaStruct(queryMatch[1]);
};

/**
 * Extract .children(...) nested routes from a method chain.
 * @internal
 */
const extractChildrenFromChain = (chain: string): Effect.Effect<ReadonlyArray<ParsedRoute>> =>
  Effect.gen(function* () {
    const childrenMatch = chain.match(/\.children\(\s*\n?([\s\S]*?)\n?\s*\)/);
    if (childrenMatch === null || childrenMatch[1] === undefined) return [];
    return yield* parseRoutes(childrenMatch[1]);
  });

/**
 * Resolve child routes against parent path to produce absolute paths.
 * @since 1.0.0
 */
export const resolveRoutePaths = (
  routes: ReadonlyArray<ParsedRoute>,
  parentPath?: string,
): ReadonlyArray<{ readonly path: string; readonly params: ReadonlyArray<ParsedParam> }> => {
  const result: Array<{ readonly path: string; readonly params: ReadonlyArray<ParsedParam> }> = [];

  for (const route of routes) {
    const absolutePath = route.isIndex
      ? (parentPath ?? "/")
      : parentPath !== undefined
        ? `${parentPath}${route.path}`
        : route.path;

    result.push({ path: absolutePath, params: route.params });

    if (route.children.length > 0) {
      const childResults = resolveRoutePaths(route.children, absolutePath);
      for (const child of childResults) {
        result.push(child);
      }
    }
  }

  return result;
};

/**
 * Generate RouteMap type declarations from parsed routes.
 * @since 1.0.0
 */
export const generateRouteTypes = (
  parsedRoutes: ReadonlyArray<ParsedRoute>,
): Effect.Effect<string> =>
  Effect.gen(function* () {
    const resolved = resolveRoutePaths(parsedRoutes);

    const mapEntries = resolved.map(({ path, params }) => {
      if (params.length === 0) {
        return `    readonly "${path}": {}`;
      }
      const fields = params.filter((p) => !p.optional).map((p) => `readonly ${p.name}: ${p.type}`);
      return `    readonly "${path}": { ${fields.join("; ")} }`;
    });

    return `// Auto-generated by trygg
export type Routes = never

declare module "trygg/router" {
  interface RouteMap {
${mapEntries.join("\n")}
  }
}

export {}
`;
  });

/**
 * Collected import info for route transform.
 * @internal
 */
interface ImportedComponent {
  readonly localName: string;
  readonly importPath: string;
  readonly isDefault: boolean;
}

/**
 * Transform routes.ts for production build.
 * Replaces direct component references in .component() with lazy imports.
 *
 * @example
 * ```ts
 * // Input:
 * import { UserProfile } from "./pages/users/profile"
 * Route.make("/users/:id").component(UserProfile)
 *
 * // Output:
 * Route.make("/users/:id").component(() => import("./pages/users/profile").then(m => m.UserProfile))
 * ```
 *
 * @since 1.0.0
 */
export const transformRoutesForBuild = (
  source: string,
  routesFilePath: string,
): Effect.Effect<string> =>
  Effect.gen(function* () {
    // 1. Collect all named/default imports with their source paths
    const imports = collectImports(source, routesFilePath);

    // 2. Identify component identifiers used in Eager routes (skip these)
    const eagerComponents = findEagerRouteComponents(source, imports);

    // 3. Find all .component(Identifier) usages and replace with lazy imports
    //    Skip components that are part of Eager routes.
    let transformed = source;

    for (const imp of imports) {
      if (eagerComponents.has(imp.localName)) continue;

      const componentRegex = new RegExp(
        `\\.component\\(\\s*${escapeRegex(imp.localName)}\\s*\\)`,
        "g",
      );

      const replacement = imp.isDefault
        ? `.component(() => import("${imp.importPath}"))`
        : `.component(() => import("${imp.importPath}").then(m => m.${imp.localName}))`;

      transformed = transformed.replace(componentRegex, replacement);
    }

    // 4. Also transform .layout(), .loading(), .error(), .notFound(), .forbidden()
    //    These are always transformed (Eager only affects .component())
    for (const imp of imports) {
      for (const method of ["layout", "loading", "error", "notFound", "forbidden"]) {
        const methodRegex = new RegExp(
          `\\.${method}\\(\\s*${escapeRegex(imp.localName)}\\s*\\)`,
          "g",
        );
        const replacement = imp.isDefault
          ? `.${method}(() => import("${imp.importPath}"))`
          : `.${method}(() => import("${imp.importPath}").then(m => m.${imp.localName}))`;
        transformed = transformed.replace(methodRegex, replacement);
      }
    }

    return transformed;
  });

/**
 * Find component identifiers used in routes with RenderStrategy.Eager.
 * Detects `.component(X)` calls in route chains that contain `RenderStrategy.Eager`.
 *
 * Strategy: For each `.component(X)` occurrence, find the enclosing route chain
 * (from the nearest preceding `Route.make(` or `Route.index(` to the chain end)
 * and check if it contains `RenderStrategy.Eager`.
 *
 * @internal
 */
const findEagerRouteComponents = (
  source: string,
  imports: ReadonlyArray<ImportedComponent>,
): Set<string> => {
  const eager = new Set<string>();
  const importNames = new Set(imports.map((i) => i.localName));

  // Find each .component(X) and check if its route chain has RenderStrategy.Eager
  const componentCallRegex = /\.component\(\s*(\w+)\s*\)/g;
  let match: RegExpExecArray | null = componentCallRegex.exec(source);

  while (match !== null) {
    const name = match[1];
    if (name !== undefined && importNames.has(name)) {
      const pos = match.index;
      if (isInEagerRouteChain(source, pos)) {
        eager.add(name);
      }
    }
    match = componentCallRegex.exec(source);
  }

  return eager;
};

/**
 * Check if a position in source is within a route chain that contains RenderStrategy.Eager.
 * Looks backward for the start of the route chain (Route.make/Route.index/.add()
 * and forward for the end, checking for RenderStrategy.Eager in the range.
 * @internal
 */
const isInEagerRouteChain = (source: string, pos: number): boolean => {
  // Find the start of this route chain - look backward for Route.make( or Route.index( or .add(
  const before = source.slice(0, pos);
  const chainStartPatterns = [/Route\.make\s*\(/g, /Route\.index\s*\(/g, /\.add\s*\(/g];

  let chainStart = 0;
  for (const pattern of chainStartPatterns) {
    let m: RegExpExecArray | null = pattern.exec(before);
    while (m !== null) {
      if (m.index > chainStart) {
        chainStart = m.index;
      }
      m = pattern.exec(before);
    }
  }

  // Find the end of this route chain - look forward for the next .add( or Route.make(
  // or end of file. Use a reasonable window (2000 chars) to avoid scanning entire file.
  const after = source.slice(pos, Math.min(source.length, pos + 2000));
  const chainEndMatch = after.search(/\.add\s*\(|Routes\.make\s*\(/);
  const chainEnd = chainEndMatch === -1 ? pos + after.length : pos + chainEndMatch;

  // Check if RenderStrategy.Eager appears in this range
  const chainText = source.slice(chainStart, chainEnd);
  return chainText.includes("RenderStrategy.Eager");
};

/**
 * Collect component imports from a routes file source.
 * Only includes imports from relative paths (not packages).
 * @internal
 */
const collectImports = (
  source: string,
  _routesFilePath: string,
): ReadonlyArray<ImportedComponent> => {
  const imports: Array<ImportedComponent> = [];

  // Named imports: import { A, B } from "./path"
  const namedImportRegex = /import\s*\{([^}]+)\}\s*from\s*["']([^"']+)["']/g;
  let namedMatch: RegExpExecArray | null = namedImportRegex.exec(source);
  while (namedMatch !== null) {
    const names = namedMatch[1];
    const importPath = namedMatch[2];
    if (names !== undefined && importPath !== undefined && importPath.startsWith(".")) {
      for (const name of names.split(",")) {
        const trimmed = name.trim();
        // Handle "Foo as Bar" aliases
        const aliasMatch = trimmed.match(/^(\w+)\s+as\s+(\w+)$/);
        if (aliasMatch !== null && aliasMatch[2] !== undefined) {
          imports.push({ localName: aliasMatch[2], importPath, isDefault: false });
        } else if (trimmed.length > 0) {
          imports.push({ localName: trimmed, importPath, isDefault: false });
        }
      }
    }
    namedMatch = namedImportRegex.exec(source);
  }

  // Default imports: import Foo from "./path"
  const defaultImportRegex = /import\s+(\w+)\s+from\s*["']([^"']+)["']/g;
  let defaultMatch: RegExpExecArray | null = defaultImportRegex.exec(source);
  while (defaultMatch !== null) {
    const name = defaultMatch[1];
    const importPath = defaultMatch[2];
    if (name !== undefined && importPath !== undefined && importPath.startsWith(".")) {
      imports.push({ localName: name, importPath, isDefault: true });
    }
    defaultMatch = defaultImportRegex.exec(source);
  }

  return imports;
};

/** Escape special regex characters in a string. @internal */
const escapeRegex = (str: string): string => str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const stripComments = (source: string): string =>
  source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");

const nodePlatformImportPattern =
  /\b(?:import|export)\s+(?:[^"']+from\s+)?["']@effect\/platform-node(?:\/[^"']*)?["']/;

// =============================================================================
// File System Operations
// =============================================================================

/**
 * Check if path exists.
 * @internal
 */
const pathExists = (filePath: string): Effect.Effect<boolean, never, FileSystem.FileSystem> =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    return yield* fs.exists(filePath).pipe(Effect.orElseSucceed(() => false));
  });

/**
 * Write file with directory creation.
 * @internal
 */
const writeFileSafe = (
  filePath: string,
  content: string,
): Effect.Effect<void, PluginFileSystemError, FileSystem.FileSystem> =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const dir = nodePath.dirname(filePath);

    yield* fs.makeDirectory(dir, { recursive: true }).pipe(
      Effect.catchTag("SystemError", (e) =>
        e.reason === "AlreadyExists" ? Effect.void : Effect.fail(e),
      ),
      Effect.mapError(
        (cause) =>
          new PluginFileSystemError({
            operation: "mkdir",
            path: dir,
            cause,
          }),
      ),
    );

    yield* fs.writeFileString(filePath, content).pipe(
      Effect.mapError(
        (cause) =>
          new PluginFileSystemError({
            operation: "write",
            path: filePath,
            cause,
          }),
      ),
    );
  });

// =============================================================================
// Validation
// =============================================================================

/**
 * Validate that api.ts does not import @effect/platform-node when platform is bun.
 * @since 1.0.0
 */
export const validateApiPlatform = (
  apiPath: string,
  platform: Platform,
): Effect.Effect<void, PluginValidationError | PluginFileSystemError, FileSystem.FileSystem> =>
  Effect.gen(function* () {
    if (platform !== "bun") {
      return;
    }

    const hasApi = yield* pathExists(apiPath);
    if (!hasApi) {
      return;
    }

    const fs = yield* FileSystem.FileSystem;
    const source = yield* fs.readFileString(apiPath).pipe(
      Effect.mapError(
        (cause) =>
          new PluginFileSystemError({
            operation: "read",
            path: apiPath,
            cause,
          }),
      ),
    );

    const stripped = stripComments(source);
    if (nodePlatformImportPattern.test(stripped)) {
      return yield* PluginValidationError.invalidStructure(
        '@effect/platform-node imports are not allowed in app/api.ts when platform is "bun"',
        apiPath,
      );
    }
  });

// =============================================================================
// Code Generation
// =============================================================================

/**
 * Generate entry module.
 *
 * Uses `mountDocument` to mount the root layout as the document owner.
 * The layout renders `<html>`, `<head>`, `<body>` which map to existing DOM.
 * Routes manifest is passed so `<Router.Outlet />` works without props.
 *
 * @since 1.0.0
 */
export const generateEntryModule = (
  appDir: string,
  generatedDir: string,
  routesFile?: string,
): Effect.Effect<string> =>
  Effect.gen(function* () {
    const relativeAppDir = nodePath.relative(generatedDir, appDir).replace(/\\/g, "/");

    // Compute relative import path from .trygg/ to the routes file
    const routesImport =
      routesFile !== undefined
        ? nodePath
            .relative(generatedDir, routesFile)
            .replace(/\\/g, "/")
            .replace(/\.tsx?$/, "")
        : `${relativeAppDir}/routes`;

    return `// Auto-generated by trygg - DO NOT EDIT
import { mountDocument, Component } from "trygg"
import { routes } from "${routesImport}"
import Layout from "${relativeAppDir}/layout"

const App = Component.gen(function* () {
  return <Layout />
})

mountDocument(<App />, { manifest: routes.manifest })
`;
  });

/**
 * Generate HTML shell.
 * Pure function — no Effect, no file I/O.
 * No `<title>` or `<meta>` beyond charset/viewport — HeadManager owns all head content.
 * @since 1.0.0
 */
export const generateHtmlTemplate = (): string => `<!DOCTYPE html>
<html>
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <script type="module" src="/${GENERATED_DIR}/entry.tsx"></script>
  </head>
  <body></body>
</html>`;

/**
 * Generate server entry point for production builds.
 * @since 1.0.0
 */
export const generateServerEntry = (
  platform: "node" | "bun",
  hasApi: boolean,
): Effect.Effect<string> =>
  Effect.gen(function* () {
    const platformImport =
      platform === "bun"
        ? 'import { BunHttpServer, BunRuntime } from "@effect/platform-bun"'
        : 'import { NodeHttpServer, NodeRuntime } from "@effect/platform-node"\nimport { createServer } from "node:http"';

    const platformServerLayer =
      platform === "bun"
        ? "BunHttpServer.layer({ port: PORT, hostname: HOST })"
        : "NodeHttpServer.layer(() => createServer(), { port: PORT, host: HOST })";

    const platformRuntime = platform === "bun" ? "BunRuntime" : "NodeRuntime";

    const apiImport = hasApi ? `import ApiLive from "../app/api.js"` : "";

    // Build server composition based on whether API exists
    const serverLive = hasApi
      ? `// Build server layer with API
const ServerLive = HttpApiBuilder.serve(HttpMiddleware.logger).pipe(
  Layer.provide(ApiLive),
  Layer.provide(
    Layer.mergeAll(
      HttpServer.layerContext,
      Layer.succeed(HttpMiddleware.HttpMiddleware, StaticFilesMiddleware),
      Layer.succeed(HttpMiddleware.HttpMiddleware, SpaFallbackMiddleware),
      Layer.succeed(HttpMiddleware.HttpMiddleware, HealthMiddleware)
    )
  ),
  Layer.provide(${platformServerLayer})
)`
      : `// Build server layer without API
const ServerLive = Layer.mergeAll(
  HttpServer.layerContext,
  Layer.succeed(HttpMiddleware.HttpMiddleware, StaticFilesMiddleware),
  Layer.succeed(HttpMiddleware.HttpMiddleware, SpaFallbackMiddleware),
  Layer.succeed(HttpMiddleware.HttpMiddleware, HealthMiddleware)
).pipe(
  Layer.provide(${platformServerLayer})
)`;

    return `/**
 * Production server entry point
 * Auto-generated by trygg - DO NOT EDIT
 */
import { HttpApiBuilder, HttpMiddleware, HttpServer, HttpServerRequest, HttpServerResponse } from "@effect/platform"
${platformImport}
import { Layer, Effect } from "effect"
import * as nodePath from "node:path"
import { fileURLToPath } from "node:url"
${apiImport}

const __dirname = nodePath.dirname(fileURLToPath(import.meta.url))
const clientDir = nodePath.join(__dirname, "client")

const PORT = Number(process.env.PORT ?? 3000)
const HOST = process.env.HOST ?? "0.0.0.0"

// Static file serving middleware (placeholder - files in client/ directory)
const StaticFilesMiddleware = HttpMiddleware.make((app) =>
  Effect.gen(function* () {
    const request = yield* HttpServerRequest.HttpServerRequest
    const url = new URL(request.url, "http://localhost")
    const pathname = url.pathname

    // Skip non-file requests and API routes
    if (!pathname.includes(".") || pathname.startsWith("/api/")) {
      return yield* app
    }

    // For now, pass through - static files will be handled by reverse proxy in production
    // or you can add proper file serving here
    return yield* app
  })
)

// SPA fallback middleware
const SpaFallbackMiddleware = HttpMiddleware.make((app) =>
  Effect.gen(function* () {
    const request = yield* HttpServerRequest.HttpServerRequest
    const url = new URL(request.url, "http://localhost")
    const pathname = url.pathname

    // Only handle GET requests for non-file, non-API routes
    if (request.method !== "GET" || pathname.includes(".") || pathname.startsWith("/api/")) {
      return yield* app
    }

    // Return a simple HTML response
    // In production, you would read the actual index.html from clientDir
    const html = "<!DOCTYPE html><html><body>SPA Placeholder</body></html>"
    return yield* HttpServerResponse.text(html, { 
      status: 200,
      headers: { "content-type": "text/html; charset=utf-8" }
    })
  })
)

// Health check middleware
const HealthMiddleware = HttpMiddleware.make((app) =>
  Effect.gen(function* () {
    const request = yield* HttpServerRequest.HttpServerRequest
    const url = new URL(request.url, "http://localhost")

    if (url.pathname === "/healthz" && request.method === "GET") {
      return yield* HttpServerResponse.text("OK", { status: 200 })
    }

    return yield* app
  })
)

${serverLive}

// Launch server
${platformRuntime}.runMain(
  Effect.gen(function* () {
    yield* Effect.log(\`Server listening on http://\${HOST}:\${PORT}\`)
    yield* Layer.launch(ServerLive)
  })
)
`;
  });

// =============================================================================
// Plugin
// =============================================================================

/**
 * Effect UI Vite plugin
 *
 * Provides:
 * - JSX configuration for trygg
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
 * export const trygg = (): Plugin => {
 *   const runtime = Effect.runSync(
 *     Layer.toRuntime(Layer.mergeAll(PluginServiceLive, PluginLayer))
 *   )
 *   return { name: "trygg", configureServer: (server) => ... }
 * }
 * ```
 *
 * Benefits: testable without Vite, composable layers, no mutable state.
 * Deferred until plugin API stabilizes.
 *
 * @since 1.0.0
 */
/**
 * Plugin options for trygg.
 * Uses TryggConfig for type-safe configuration.
 * @since 1.0.0
 */
export interface TryggOptions extends TryggConfig {}

/**
 * Create trygg Vite plugin with platform-aware dev API.
 *
 * @example
 * ```ts
 * import { trygg } from "trygg/vite-plugin"
 * import tryggConfig from "./trygg.config"
 *
 * export default defineConfig({
 *   plugins: [trygg(tryggConfig)]
 * })
 * ```
 *
 * @since 1.0.0
 */
export const trygg = (tryggConfig?: TryggConfig): Plugin => {
  const configPlatform = tryggConfig?.platform ?? "node";
  const output = tryggConfig?.output ?? "server";

  // Dev server always runs in Node.js (Vite), so use node platform for dev
  // regardless of config platform which is for production runtime
  const devPlatform = typeof Bun === "undefined" ? "node" : configPlatform;

  // Create platform-specific plugin layer for dev server
  const pluginLayer = makePluginLayer(devPlatform);

  let config: ResolvedConfig;
  // Initialize with process.cwd() as fallback for early hooks
  let appDir: string = nodePath.resolve(process.cwd(), APP_DIR);
  let generatedDir: string = nodePath.resolve(process.cwd(), GENERATED_DIR);
  let routesFilePath: string | undefined;

  return {
    name: "trygg",
    enforce: "pre",

    config() {
      return {
        appType: "custom",
        esbuild: {
          jsx: "automatic",
          jsxImportSource: "trygg",
        },
        optimizeDeps: {
          esbuildOptions: {
            jsx: "automatic",
            jsxImportSource: "trygg",
          },
        },
        // Ensure effect packages are externalized in SSR so that both the
        // bundled plugin code and user modules loaded via ssrLoadModule
        // resolve to the same module instances. Without this, Layer
        // memoization fails across module boundaries (e.g. Router.Live).
        ssr: {
          external: [
            "effect",
            "@effect/platform",
            "@effect/platform-node",
            "@effect/platform-bun",
            "@effect/platform-browser",
          ],
        },
        build: {
          outDir: output === "server" ? "dist/client" : "dist",
          rollupOptions: {
            input: `${GENERATED_DIR}/index.html`,
          },
        },
      };
    },

    async configResolved(resolvedConfig) {
      config = resolvedConfig;
      appDir = nodePath.resolve(config.root, APP_DIR);
      generatedDir = nodePath.resolve(config.root, GENERATED_DIR);

      await Effect.runPromise(
        Effect.gen(function* () {
          const fs = yield* FileSystem.FileSystem;

          // Auto-discover app/routes.ts
          const discoveredRoutesPath = nodePath.join(appDir, "routes.ts");
          const hasRoutes = yield* pathExists(discoveredRoutesPath);
          if (hasRoutes) {
            routesFilePath = discoveredRoutesPath;
          }

          yield* fs.makeDirectory(generatedDir, { recursive: true }).pipe(
            Effect.catchTag("SystemError", (e) =>
              e.reason === "AlreadyExists" ? Effect.void : Effect.fail(e),
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
          yield* Effect.logDebug(`  Platform: ${configPlatform}`);
          yield* Effect.logDebug(`  Output: ${output}`);
          if (routesFilePath !== undefined) {
            yield* Effect.logDebug(`  Routes: ${routesFilePath}`);
          }
        }).pipe(Effect.provide(pluginLayer)),
      );
    },

    async configureServer(server: ViteDevServer) {
      const effect = Effect.gen(function* () {
        // Extract runtime for use in non-Effect callbacks (Vite boundary)
        const runtime = yield* Effect.runtime<FileSystem.FileSystem>();

        // Get DevPlatform service
        const devPlatform = yield* DevPlatform;

        const routeTypesPath = nodePath.join(generatedDir, "routes.d.ts");
        const entryPath = nodePath.join(generatedDir, "entry.tsx");
        const apiPath = nodePath.join(appDir, "api.ts");

        // Validate API imports
        yield* validateApiPlatform(apiPath, configPlatform).pipe(
          Effect.tapError(logApiValidationError),
        );

        // Generate route types from routes file
        if (routesFilePath !== undefined) {
          const fs = yield* FileSystem.FileSystem;
          const routeSource = yield* fs
            .readFileString(routesFilePath)
            .pipe(Effect.orElseSucceed(() => ""));
          if (routeSource.length > 0) {
            const parsed = yield* parseRoutes(routeSource);
            const content = yield* generateRouteTypes(parsed);
            yield* writeFileSafe(routeTypesPath, content);
            yield* Effect.logDebug("Generated route types");
          }
        }

        const entryContent = yield* generateEntryModule(appDir, generatedDir, routesFilePath);
        yield* writeFileSafe(entryPath, entryContent);

        yield* Effect.logInfo(`Generated files in ${GENERATED_DIR}/`).pipe(
          Effect.annotateLogs("style", "success"),
        );

        let apiHandle: Option.Option<DevApiHandle> = Option.none();
        let apiScope: Option.Option<Scope.CloseableScope> = Option.none();
        const hasApi = yield* pathExists(apiPath);

        if (hasApi) {
          // Create scope for API lifecycle
          const scope = yield* Scope.make();

          // SSR-load handler factory — resolves @effect/platform from project root,
          // same module instance as user's api.ts, preventing Router.Live identity mismatches.
          const rawFactoryMod = yield* Effect.tryPromise({
            try: () => server.ssrLoadModule(VIRTUAL_HANDLER_FACTORY_ID),
            catch: (cause) =>
              new ApiInitError({
                message: "Failed to SSR-load handler factory",
                cause,
              }),
          });
          // Validate factory shape at runtime instead of using `as` cast
          if (
            typeof rawFactoryMod.detectAndComposeLayer !== "function" ||
            typeof rawFactoryMod.createWebHandler !== "function"
          ) {
            return yield* new ApiInitError({
              message:
                "Handler factory module missing required exports (detectAndComposeLayer, createWebHandler)",
            });
          }
          const factoryMod: HandlerFactory = {
            detectAndComposeLayer: rawFactoryMod.detectAndComposeLayer,
            createWebHandler: rawFactoryMod.createWebHandler,
            createNodeHandler:
              typeof rawFactoryMod.createNodeHandler === "function"
                ? rawFactoryMod.createNodeHandler
                : undefined,
          };

          // Create dev API using platform-specific implementation
          const handle = yield* Scope.extend(
            devPlatform.createDevApi({
              loadApiModule: () =>
                Effect.tryPromise({
                  try: () => server.ssrLoadModule(apiPath),
                  catch: (cause) =>
                    new ApiInitError({
                      message: "Failed to load API module",
                      cause,
                    }),
                }),
              onError: (error) =>
                Effect.logError(
                  `[api] middleware.error: ${error instanceof Error ? error.message : String(error)}`,
                ),
              handlerFactory: factoryMod,
            }),
            scope,
          );

          apiHandle = Option.some(handle);
          apiScope = Option.some(scope);

          yield* Effect.logInfo("API handlers loaded").pipe(
            Effect.annotateLogs("style", "success"),
          );
          yield* Debug.log({
            event: "api.middleware.mounted",
            platform: configPlatform,
          });
        }

        // Vite boundary: file watcher callbacks use extracted runtime
        server.watcher.on("change", async (file) => {
          await Runtime.runPromise(runtime)(
            Effect.gen(function* () {
              // Routes file changed - regenerate types
              if (routesFilePath !== undefined && file === routesFilePath) {
                const fs = yield* FileSystem.FileSystem;
                const routeSource = yield* fs
                  .readFileString(routesFilePath)
                  .pipe(Effect.orElseSucceed(() => ""));
                if (routeSource.length > 0) {
                  const parsed = yield* parseRoutes(routeSource);
                  const content = yield* generateRouteTypes(parsed);
                  yield* writeFileSafe(routeTypesPath, content);
                  yield* Effect.logDebug("Regenerated routes.d.ts");
                }
              }

              if (file.endsWith("api.ts") && Option.isSome(apiHandle)) {
                yield* apiHandle.value.reload;
                yield* Effect.logDebug("Reloaded API handlers");
              }
            }),
          );
        });

        // Vite boundary: close scope when server closes (triggers finalizer)
        server.httpServer?.on("close", () => {
          if (Option.isSome(apiScope)) {
            void Runtime.runPromise(runtime)(Scope.close(apiScope.value, Exit.void));
          }
        });

        if (Option.isSome(apiHandle)) {
          server.middlewares.use(apiHandle.value.middleware);
        }

        return () => {
          server.middlewares.use((req, res, next) => {
            if (!req.url || req.url.includes(".") || req.method !== "GET") {
              return next();
            }

            const requestUrl = req.url;
            const effect = Effect.gen(function* () {
              const html = yield* Effect.tryPromise({
                try: () => server.transformIndexHtml(requestUrl, generateHtmlTemplate()),
                catch: (err) =>
                  new PluginFileSystemError({
                    operation: "transform",
                    path: "bootstrap-shell",
                    cause: err,
                  }),
              });
              res.statusCode = 200;
              res.setHeader("Content-Type", "text/html");
              res.end(html);
            }).pipe(Effect.catchAllCause(() => Effect.sync(() => next())));

            void Runtime.runPromise(runtime)(effect);
          });
        };
      }).pipe(Effect.provide(pluginLayer));

      return await Effect.runPromise(effect);
    },

    resolveId(id) {
      if (id === VIRTUAL_HANDLER_FACTORY_ID) {
        return RESOLVED_HANDLER_FACTORY_ID;
      }
      if (id === "trygg/jsx-runtime" || id === "trygg/jsx-dev-runtime") {
        return null;
      }
      return null;
    },

    async load(id) {
      if (id === RESOLVED_HANDLER_FACTORY_ID) {
        return devPlatform === "node" ? NODE_HANDLER_FACTORY_CODE : BUN_HANDLER_FACTORY_CODE;
      }
      return null;
    },

    async transform(code, id) {
      // Only transform the routes file in production builds
      if (routesFilePath === undefined) return null;
      if (id !== routesFilePath) return null;
      if (config.command !== "build") return null;

      const result = await Effect.runPromise(
        transformRoutesForBuild(code, id).pipe(Effect.provide(pluginLayer)),
      );
      return result !== code ? result : null;
    },

    async buildStart() {
      const effect = Effect.gen(function* () {
        const entryPath = nodePath.join(generatedDir, "entry.tsx");
        const apiPath = nodePath.join(appDir, "api.ts");

        yield* validateApiPlatform(apiPath, configPlatform).pipe(
          Effect.tapError(logApiValidationError),
        );

        // Always regenerate entry when routes file is configured
        const hasEntry = yield* pathExists(entryPath);
        if (!hasEntry || routesFilePath !== undefined) {
          const content = yield* generateEntryModule(appDir, generatedDir, routesFilePath);
          yield* writeFileSafe(entryPath, content);
        }

        // Only write index.html for production builds (Rollup needs physical input)
        if (config.command === "build") {
          const indexPath = nodePath.join(generatedDir, "index.html");
          yield* writeFileSafe(indexPath, generateHtmlTemplate());

          // Warn if API exists with static output
          const hasApi = yield* pathExists(apiPath);
          if (hasApi && output === "static") {
            yield* Effect.logWarning(
              '⚠ API routes in app/api.ts will not be included in static build.\n  Deploy your API separately or use output: "server".',
            );
          }
        }
      }).pipe(Effect.provide(pluginLayer));

      await Effect.runPromise(effect);
    },

    async closeBundle() {
      // Only build server in production mode with server output
      if (config.command !== "build" || output !== "server") {
        return;
      }

      const effect = Effect.gen(function* () {
        const apiPath = nodePath.join(appDir, "api.ts");
        const hasApi = yield* pathExists(apiPath);

        // Generate server entry
        const serverEntryPath = nodePath.join(generatedDir, "server-entry.ts");
        const serverEntryContent = yield* generateServerEntry(configPlatform, hasApi);
        yield* writeFileSafe(serverEntryPath, serverEntryContent);

        yield* Effect.logInfo("Building production server...");

        // Build server with Vite SSR
        yield* Effect.tryPromise({
          try: () =>
            build({
              configFile: false,
              root: config.root,
              build: {
                ssr: serverEntryPath,
                outDir: nodePath.join(config.root, "dist"),
                emptyOutDir: false, // Don't delete client files
                rollupOptions: {
                  output: { entryFileNames: "server.js" },
                  external: ["effect", /^@effect\//, /^node:/, /^bun:/],
                },
              },
            }),
          catch: (err) =>
            new PluginFileSystemError({
              operation: "transform",
              path: serverEntryPath,
              cause: err,
            }),
        });

        yield* Effect.logInfo("Server build complete").pipe(
          Effect.annotateLogs("style", "success"),
        );
      }).pipe(Effect.provide(pluginLayer));

      await Effect.runPromise(effect);
    },
  };
};

export default trygg;
