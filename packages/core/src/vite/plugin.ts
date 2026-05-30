/**
 * Vite integration entrypoint for trygg.
 *
 * @remarks
 * Owner module for `trygg/vite-plugin`. The supported consumer surface is the
 * `trygg` plugin factory plus the public option and plugin-shape types used by
 * `vite.config.ts`; the lower-level helpers in this file stay implementation
 * details even when they are exported for local tests.
 *
 * @see ./plugin.docs.md - Source-owned topic guide
 * @since 1.0.0
 * @module trygg/vite-plugin
 */
import type { Connect, ResolvedConfig, ViteDevServer } from "vite";
import { build } from "vite";
import {
  Array,
  Cause,
  Data,
  Deferred,
  Effect,
  Exit,
  FileSystem,
  Layer,
  Logger,
  LogLevel,
  ManagedRuntime,
  Match,
  Option,
  Predicate,
  References,
  Result,
  Schema,
  Scope,
  SynchronizedRef,
} from "effect";
import type { Layer as LayerType } from "effect/Layer";
import * as Context from "effect/Context";
import * as nodePath from "node:path";
import type { TryggConfig, Platform, Output } from "../config.js";
import {
  DevPlatform,
  ServerPlatform,
  NodeServerPlatform,
  BunServerPlatform,
  type ServerPlatformService,
  type DevApiHandle,
  type DevApiErrors,
  type HandlerFactory,
  ApiInitError,
  ImportError,
} from "./dev-platform.js";
import * as Trace from "../trace/index.js";
import { NodeDevPlatformLive } from "./dev-platform-node.js";
import { Bootstrap, makeBootstrapLayer } from "./bootstrap.js";
import {
  PluginBootstrapError as PluginBootstrapErrorImpl,
  PluginFileSystemError as PluginFileSystemErrorImpl,
} from "./errors.js";
import {
  InvalidBuildOutputCombination,
  makeBuildArtifactPlanner,
  makeGeneratedArtifactPlanner,
  BuildArtifactOperation,
  BuildPlanDiagnostic,
  type GeneratedArtifactPlan,
} from "./build-artifact-planner.js";
import { transformTryggJsxForRequirements } from "./jsx-requirement-transform.js";
// BunDevPlatformLive is loaded dynamically to avoid loading @effect/platform-bun in Node.js

// =============================================================================
// Constants
// =============================================================================

const APP_DIR = "app";
const GENERATED_DIR = ".trygg";

const VIRTUAL_HANDLER_FACTORY_ID = "virtual:trygg/handler-factory";
const RESOLVED_HANDLER_FACTORY_ID = "\0" + VIRTUAL_HANDLER_FACTORY_ID;
const VIRTUAL_API_ID = "trygg/api";
const RESOLVED_API_ID = "\0" + VIRTUAL_API_ID;
const API_EXPORT_MESSAGE =
  "app/api.ts must export Api for imports from trygg/api. Add `export const Api = ...` to app/api.ts.";
const ROUTE_TRANSFORM_METHODS: ReadonlyArray<"component" | "layout"> = ["component", "layout"];

type RollupWarning = {
  readonly message?: string;
};

type RollupWarningHandler = (
  warning: RollupWarning,
  defaultHandler: (warning: RollupWarning) => void,
) => void;

const isRecord = (value: unknown): value is { readonly [key: string]: unknown } =>
  typeof value === "object" && value !== null;

const isRollupWarningHandler = (value: unknown): value is RollupWarningHandler =>
  typeof value === "function";

const getUserRollupOnwarn = (config: unknown): RollupWarningHandler | undefined => {
  if (!isRecord(config)) return undefined;
  const build = config.build;
  if (!isRecord(build)) return undefined;
  const rollupOptions = build.rollupOptions;
  if (!isRecord(rollupOptions)) return undefined;
  const onwarn = rollupOptions.onwarn;
  if (!isRollupWarningHandler(onwarn)) return undefined;
  return onwarn;
};

/**
 * Detects Rollup mixed dynamic import warnings emitted by trygg's own build output.
 *
 * @remarks
 * Used by plugin warning filtering and exported only so local Vite plugin tests can
 * verify the exact warning predicate without constructing a full plugin instance.
 *
 * @internal
 * @since 1.0.0
 */
export const isTryggMixedDynamicImportWarning = (warning: RollupWarning): boolean => {
  const message = warning.message?.replace(/\\/g, "/");
  if (message === undefined) return false;
  if (!message.includes("is dynamically imported by")) return false;
  if (!message.includes("but also statically imported by")) return false;
  if (!message.includes("dynamic import will not move module into another chunk")) return false;
  return message.includes("/packages/core/dist/") || message.includes("/node_modules/trygg/dist/");
};

const makeRollupOnwarn =
  (userOnwarn: RollupWarningHandler | undefined): RollupWarningHandler =>
  (warning, defaultHandler) => {
    if (isTryggMixedDynamicImportWarning(warning)) return;
    if (userOnwarn !== undefined) {
      userOnwarn(warning, defaultHandler);
      return;
    }
    defaultHandler(warning);
  };

/**
 * Source paths that own generated browser entry imports.
 *
 * @remarks
 * These filesystem paths are parsed once into semantic import paths before
 * rendering the generated module.
 *
 * @internal
 * @since 1.0.0
 */
export interface ClientEntryModuleOwnerInput {
  readonly appDir: string;
  readonly generatedDir: string;
  readonly routesFilePath?: string | undefined;
}

/**
 * Semantic import paths for the generated browser entry module.
 *
 * @remarks
 * Renderer input only; callers should construct it with
 * `makeClientEntryModuleOwner` so path normalization stays consistent.
 *
 * @internal
 * @since 1.0.0
 */
export interface ClientEntryModuleOwner {
  readonly layoutImportPath: string;
  readonly routesImportPath: string;
}

/**
 * Runtime choices that own generated production server module content.
 *
 * @remarks
 * Couples the API presence decision with platform-specific code fragments so
 * server rendering does not reach back into plugin state.
 *
 * @internal
 * @since 1.0.0
 */
export interface ProductionServerEntryModuleOwner {
  readonly hasApi: boolean;
  readonly platform: ServerPlatformService;
}

const HandlerFactoryModule = {
  /**
   * Shared handler factory logic for virtual modules.
   * Requires the user module to have a default export that is a composed Layer.
   * No platform-specific imports — only effect http/httpapi modules.
   * @internal
   */
  makeShared: (): string => `
import { HttpRouter, HttpServer } from "effect/unstable/http";
import { Data, Effect, Layer } from "effect";

class FactoryError extends Data.TaggedError("FactoryError") {}

// Trust boundary: TypeScript enforces Layer<HttpApi.Api> in user code.
// At the SSR module boundary types are erased — Layer.isLayer is the
// strongest runtime check possible (Layer type params are phantom).
export const makeApiLayer = (mod) =>
  Effect.gen(function* () {
    if (!("default" in mod) || !Layer.isLayer(mod.default)) {
      return yield* new FactoryError({
        message: "app/api.ts must have a default export that is a composed Layer (e.g. export default HttpApiBuilder.layer(Api).pipe(Layer.provide(handlers)))",
      });
    }

    return mod.default;
  });

export const makeWebHandler = (apiLive) => {
  // Decision (#120): pure constructor. This only composes layer values and
  // builds the handler facade; resource acquisition is owned by handler usage
  // and the returned dispose callback.
  const apiLayer = Layer.mergeAll(apiLive, HttpServer.layerServices);
  return HttpRouter.toWebHandler(apiLayer);
};
`,

  /**
   * Node handler factory — extends shared code with Request/Response bridge.
   * @internal
   */
  makeNode: (): string =>
    HandlerFactoryModule.makeShared() +
    `
export const getBody = (req) => {
  const method = req.method ?? "GET";
  if (method === "GET" || method === "HEAD") {
    return Promise.resolve(undefined);
  }

  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on("data", (chunk) => chunks.push(new Uint8Array(chunk)));
    req.on("end", () => {
      const total = chunks.reduce((n, chunk) => n + chunk.length, 0);
      const body = new Uint8Array(total);
      let offset = 0;
      for (const chunk of chunks) {
        body.set(chunk, offset);
        offset += chunk.length;
      }
      resolve(body);
    });
    req.on("error", reject);
  });
};

export const fromNodeRequest = async (req) => {
  const headers = new Headers();
  for (const [key, value] of Object.entries(req.headers)) {
    if (value === undefined) continue;
    headers.set(key, Array.isArray(value) ? value.join(", ") : value);
  }

  const body = await getBody(req);
  const init = { method: req.method ?? "GET", headers };
  if (body !== undefined) {
    init.body = body;
  }

  return new Request("http://" + (req.headers.host ?? "localhost") + (req.url ?? "/"), init);
};

export const toNodeResponse = async (response, res) => {
  res.statusCode = response.status;
  response.headers.forEach((value, key) => {
    res.setHeader(key, value);
  });

  if (!response.body) {
    res.end();
    return;
  }

  const reader = response.body.getReader();
  for (;;) {
    const chunk = await reader.read();
    if (chunk.done) break;
    await new Promise((resolve, reject) => {
      res.write(chunk.value, (error) => (error ? reject(error) : resolve()));
    });
  }

  res.end();
};

export const makeNodeHandler = (apiLive) =>
  Effect.succeed((() => {
    const webHandler = makeWebHandler(apiLive);

    return {
      handler: (req, res) => {
        void fromNodeRequest(req)
          .then((request) => webHandler.handler(request))
          .then((response) => toNodeResponse(response, res))
          .catch(() => {
            if (!res.headersSent) {
              res.statusCode = 500;
              res.end("Internal Server Error");
            }
          });
      },
      dispose: Effect.tryPromise({
        try: () => webHandler.dispose(),
        catch: (cause) => cause,
      }).pipe(Effect.orDie),
    };
  })());
`,

  /**
   * Bun handler factory — shared code only (no @effect/platform-node).
   * Uses makeWebHandler for handler creation.
   * @internal
   */
  makeBun: (): string => HandlerFactoryModule.makeShared(),
};

// =============================================================================
// Types
// =============================================================================

// =============================================================================
// Error Types - Yieldable via Schema.TaggedErrorClass
// =============================================================================

/**
 * Plugin validation error.
 *
 * @remarks
 * Internal validation helpers raise this when app structure or generated input
 * files do not match what the Vite integration expects.
 *
 * @internal
 * @since 1.0.0
 */
export class PluginValidationError extends Schema.TaggedErrorClass<PluginValidationError>()(
  "PluginValidationError",
  {
    reason: Schema.Union([
      Schema.Literal("MissingFile"),
      Schema.Literal("MissingExport"),
      Schema.Literal("RouteConflict"),
      Schema.Literal("InvalidStructure"),
    ]),
    description: Schema.String,
    file: Schema.optional(Schema.String),
    details: Schema.optional(Schema.String),
  },
) {
  static missingFile(file: string, details?: string): PluginValidationError {
    return new PluginValidationError({
      reason: "MissingFile",
      description: `Required file missing: ${file}`,
      file,
      details,
    });
  }

  static missingExport(file: string, exportName: string): PluginValidationError {
    return new PluginValidationError({
      reason: "MissingExport",
      description: `${file} must export '${exportName}'`,
      file,
    });
  }

  static routeConflict(routePath: string, file: string): PluginValidationError {
    return new PluginValidationError({
      reason: "RouteConflict",
      description: `Route conflict: ${routePath}`,
      file,
      details: "Path defined both as page route and API endpoint",
    });
  }

  static invalidStructure(message: string, file?: string): PluginValidationError {
    return new PluginValidationError({
      reason: "InvalidStructure",
      description: message,
      file,
    });
  }

  override get message(): string {
    return this.description;
  }
}

/**
 * Multiple plugin validation errors.
 *
 * @remarks
 * Batches several `PluginValidationError` values so the plugin can report the
 * full set of structural problems from one validation pass.
 *
 * @internal
 * @since 1.0.0
 */
export class PluginValidationErrors extends Schema.TaggedErrorClass<PluginValidationErrors>()(
  "PluginValidationErrors",
  {
    errors: Schema.NonEmptyArray(Schema.instanceOf(PluginValidationError)),
  },
) {
  override get message(): string {
    return this.errors
      .map((e) => {
        const loc = e.file ? ` (${e.file})` : "";
        const detail = e.details ? `: ${e.details}` : "";
        return `${e.description}${loc}${detail}`;
      })
      .join("\n");
  }
}

/**
 * Plugin parse error.
 *
 * @remarks
 * Used by route and schema parsing helpers when source text cannot be turned
 * into the intermediate structures the plugin needs.
 *
 * @internal
 * @since 1.0.0
 */
export class PluginParseError extends Schema.TaggedErrorClass<PluginParseError>()(
  "PluginParseError",
  {
    description: Schema.String,
    input: Schema.Unknown,
  },
) {
  override get message(): string {
    return this.description;
  }
}

/**
 * Plugin file system error.
 *
 * @remarks
 * Wraps file-system failures from generated file reads, writes, and directory
 * creation while keeping the original cause attached for logs and tests.
 *
 * @internal
 * @since 1.0.0
 */
export const PluginFileSystemError = PluginFileSystemErrorImpl;

/**
 * Plugin bootstrap error.
 *
 * @remarks
 * Raised when a Vite hook that depends on resolved configuration executes
 * before plugin bootstrap has completed.
 *
 * @internal
 * @since 1.0.0
 */
export const PluginBootstrapError = PluginBootstrapErrorImpl;

type PluginFileSystemError = PluginFileSystemErrorImpl;

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
const PluginLogger = Logger.make(({ message, logLevel }) => {
  const text = String(message);

  if (LogLevel.isGreaterThanOrEqualTo(logLevel, "Error")) {
    logger.error(text);
  } else if (LogLevel.isGreaterThanOrEqualTo(logLevel, "Warn")) {
    logger.warn(text);
  } else if (LogLevel.isLessThanOrEqualTo(logLevel, "Debug")) {
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
): LayerType<
  FileSystem.FileSystem | DevPlatform | ServerPlatform | PluginFiles | BuildOutput,
  ImportError
> => {
  const devLayer = platform === "bun" ? Layer.unwrap(importBunDevPlatform) : NodeDevPlatformLive;
  const serverLayer = platform === "bun" ? BunServerPlatform : NodeServerPlatform;

  const platformLayer = Layer.mergeAll(devLayer, serverLayer);
  const pluginFilesLayer = makePluginFilesLayer().pipe(Layer.provideMerge(platformLayer));
  const buildOutputLayer = makeBuildOutputLayer().pipe(Layer.provideMerge(pluginFilesLayer));

  return Layer.mergeAll(
    buildOutputLayer,
    Logger.layer([PluginLogger]),
    Layer.succeed(References.MinimumLogLevel, "Debug"),
  );
};

/**
 * Log validation errors with details.
 * @internal
 */
const logValidationErrors = (e: PluginValidationErrors): Effect.Effect<void> =>
  Effect.forEach(e.errors, (error) =>
    Effect.gen(function* () {
      yield* Effect.logError(error.description);
      if (error.details) {
        yield* Effect.logDebug(`  ${error.details}`);
      }
    }),
  ).pipe(Effect.asVoid);

/**
 * Log single validation error.
 * @internal
 */
const logValidationError: (e: PluginValidationError) => Effect.Effect<void> = Effect.fn(
  "VitePlugin.logValidationError",
)(function* (e: PluginValidationError) {
  yield* Effect.logError(e.description);
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
  Effect.logError(`Failed to parse module: ${e.description}`);

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
 *
 * @remarks
 * Internal helper for route typing codegen. It keeps only colon-prefixed path
 * segments and strips the leading `:`.
 *
 * @internal
 * @since 1.0.0
 */
export const extractParamNames: (routePath: string) => Effect.Effect<ReadonlyArray<string>> =
  Effect.fn("VitePlugin.extractParamNames")(function* (routePath: string) {
    const segments = routePath.split("/").filter(Boolean);
    return Array.filterMap(segments, (segment) =>
      segment.startsWith(":") ? Result.succeed(segment.slice(1)) : Result.failVoid,
    );
  });

/**
 * Generate TypeScript type for route params.
 *
 * @remarks
 * Builds the stringified object type written into generated route maps from a
 * route path's extracted params.
 *
 * @internal
 * @since 1.0.0
 */
export const generateParamType: (routePath: string) => Effect.Effect<string> = Effect.fn(
  "VitePlugin.generateParamType",
)(function* (routePath: string) {
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
 *
 * @remarks
 * Internal intermediate shape used between textual route parsing and final
 * route-type generation.
 *
 * @internal
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
 *
 * @remarks
 * Internal description of one decoded param or query field recovered from a
 * route schema expression.
 *
 * @internal
 * @since 1.0.0
 */
export interface ParsedParam {
  readonly name: string;
  readonly type: string;
  readonly optional: boolean;
}

/**
 * Map a Schema type expression to its TypeScript output type.
 *
 * @remarks
 * Internal mapper used by route codegen. It intentionally handles only the
 * schema forms emitted in route param and query definitions.
 *
 * @internal
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
 *
 * @remarks
 * Internal regex-based parser for simple route schema structs used during
 * route-type generation.
 *
 * @internal
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
 *
 * @remarks
 * Internal parser that recovers enough route metadata from source text to feed
 * generated type declarations and build transforms.
 *
 * @internal
 * @since 1.0.0
 */
export const parseRoutes: (source: string) => Effect.Effect<ReadonlyArray<ParsedRoute>> = Effect.fn(
  "VitePlugin.parseRoutes",
)(function* (source: string) {
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
const extractChildrenFromChain: (chain: string) => Effect.Effect<ReadonlyArray<ParsedRoute>> =
  Effect.fn("VitePlugin.extractChildrenFromChain")(function* (chain: string) {
    const childrenMatch = chain.match(/\.children\(\s*\n?([\s\S]*?)\n?\s*\)/);
    if (childrenMatch === null || childrenMatch[1] === undefined) return [];
    return yield* parseRoutes(childrenMatch[1]);
  });

/**
 * Resolve child routes against parent path to produce absolute paths.
 *
 * @remarks
 * Flattens nested parsed routes into absolute route records before codegen.
 *
 * @internal
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
 *
 * @remarks
 * Produces the ambient `trygg/router` RouteMap augmentation written to the
 * generated `.trygg/routes.d.ts` file.
 *
 * @internal
 * @since 1.0.0
 */
export const generateRouteTypes: (
  parsedRoutes: ReadonlyArray<ParsedRoute>,
) => Effect.Effect<string> = Effect.fn("VitePlugin.generateRouteTypes")(function* (
  parsedRoutes: ReadonlyArray<ParsedRoute>,
) {
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
 * @remarks
 * Internal production-build transform. It rewrites route component and layout
 * references to lazy imports unless the surrounding route tree opts into eager
 * rendering.
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
 * @internal
 * @since 1.0.0
 */
export const transformRoutesForBuild: (
  source: string,
  routesFilePath: string,
) => Effect.Effect<string> = Effect.fn("VitePlugin.transformRoutesForBuild")(function* (
  source: string,
  routesFilePath: string,
) {
  // 1. Collect all named/default imports with their source paths
  const imports = collectImports(source, routesFilePath);

  // 2. Neutralize strings/comments for position-accurate paren matching
  const clean = neutralizeSource(source);

  // 3. Transform .component(X) and .layout(X) to lazy imports.
  //    Each occurrence is checked against Eager context (own chain + ancestors).
  //    Boundary components (.loading, .error, .notFound, .forbidden) are NOT
  //    transformed — they must be available synchronously as fallback UI.
  let transformed = source;

  for (const imp of imports) {
    for (const method of ROUTE_TRANSFORM_METHODS) {
      const methodRegex = new RegExp(
        `\\.${method}\\(\\s*${escapeRegex(imp.localName)}\\s*\\)`,
        "g",
      );
      const replacement = imp.isDefault
        ? `.${method}(() => import("${imp.importPath}"))`
        : `.${method}(() => import("${imp.importPath}").then(m => m.${imp.localName}))`;

      // Per-occurrence: only transform if NOT in Eager context
      transformed = transformed.replace(methodRegex, (fullMatch, offset: number) =>
        isInEagerContext(clean, offset) ? fullMatch : replacement,
      );
    }
  }

  return transformed;
});

// =============================================================================
// Eager Context Detection — Ancestor-Aware
// =============================================================================

/**
 * Replace string/comment contents with spaces, preserving character positions.
 * Prevents parens in strings or `RenderStrategy.Eager` in comments from
 * causing false matches during balanced-paren scanning.
 * @internal
 */
const neutralizeSource = (source: string): string =>
  source.replace(
    /\/\/.*$|\/\*[\s\S]*?\*\/|"(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'|`(?:[^`\\]|\\.)*`/gm,
    (m) => {
      if (m.startsWith("//") || m.startsWith("/*")) {
        return m.replace(/[^\n]/g, " ");
      }
      if (m.length <= 2) return m;
      return m.charAt(0) + m.slice(1, -1).replace(/[^\n]/g, " ") + m.charAt(m.length - 1);
    },
  );

/**
 * Check if the open paren at `openParenPos` belongs to a `.children(` call.
 * Returns the position of `.` in `.children`, or undefined.
 * @internal
 */
const isChildrenOpenParen = (clean: string, openParenPos: number): number | undefined => {
  let j = openParenPos - 1;
  while (j >= 0 && " \t\n\r".includes(clean.charAt(j))) j--;
  const keyword = ".children";
  const start = j - keyword.length + 1;
  if (start >= 0 && clean.slice(start, j + 1) === keyword) {
    return start;
  }
  return undefined;
};

/**
 * Find the `.children(` call that encloses position `pos`.
 * Scans backward with balanced paren tracking. When an unmatched `(`
 * is found, checks if it belongs to `.children(`. Continues if not.
 * @internal
 */
const findEnclosingChildrenCall = (clean: string, pos: number): number | undefined => {
  let depth = 0;
  for (let i = pos - 1; i >= 0; i--) {
    const ch = clean.charAt(i);
    if (ch === ")") {
      depth++;
    } else if (ch === "(") {
      if (depth > 0) {
        depth--;
      } else {
        const dotPos = isChildrenOpenParen(clean, i);
        if (dotPos !== undefined) return dotPos;
        // Not .children — keep searching outward
      }
    }
  }
  return undefined;
};

/**
 * Find the matching close paren for an open paren at `openPos`.
 * @internal
 */
const findMatchingCloseParen = (clean: string, openPos: number): number | undefined => {
  let depth = 1;
  for (let i = openPos + 1; i < clean.length; i++) {
    const ch = clean.charAt(i);
    if (ch === "(") depth++;
    else if (ch === ")") {
      depth--;
      if (depth === 0) return i;
    }
  }
  return undefined;
};

/**
 * Find the start of the route chain containing `pos`.
 * Scans backward for the nearest `Route.make(` or `Route.index(`.
 * @internal
 */
const findRouteChainStart = (clean: string, pos: number): number => {
  const before = clean.slice(0, pos);
  let latest = 0;
  for (const pattern of [/Route\.make\s*\(/g, /Route\.index\s*\(/g]) {
    let m: RegExpExecArray | null = pattern.exec(before);
    while (m !== null) {
      if (m.index > latest) latest = m.index;
      m = pattern.exec(before);
    }
  }
  return latest;
};

/**
 * Find the end of a route chain from `pos`.
 * Chain ends at `,` or `)` at depth 0 (parent argument boundary).
 * @internal
 */
const findRouteChainEnd = (clean: string, pos: number): number => {
  let depth = 0;
  for (let i = pos; i < clean.length; i++) {
    const ch = clean.charAt(i);
    if (ch === "(") depth++;
    else if (ch === ")") {
      if (depth === 0) return i;
      depth--;
    } else if (ch === "," && depth === 0) {
      return i;
    }
  }
  return clean.length;
};

/**
 * Extract parent route chain text, EXCLUDING the children body.
 * Given `.children(` at `childrenDotPos`, concatenates:
 *   [parentStart..openParen) + [closeParen+1..parentEnd)
 * This prevents a child's strategy from being attributed to the parent.
 * @internal
 */
const getParentChainText = (clean: string, childrenDotPos: number): string => {
  const afterKeyword = childrenDotPos + ".children".length;
  let openParen = afterKeyword;
  while (openParen < clean.length && clean.charAt(openParen) !== "(") openParen++;

  const closeParen = findMatchingCloseParen(clean, openParen);
  if (closeParen === undefined) return "";

  const parentStart = findRouteChainStart(clean, childrenDotPos);
  const parentEnd = findRouteChainEnd(clean, closeParen + 1);

  return clean.slice(parentStart, openParen) + clean.slice(closeParen + 1, parentEnd);
};

/**
 * Determine if `.component(X)` at `componentPos` is in an Eager context.
 *
 * 1. Check own route chain for explicit strategy (nearest wins).
 * 2. Walk up ancestor `.children()` calls checking parent chains.
 * 3. No ancestor strategy → not eager (default = lazy).
 * @internal
 */
const isInEagerContext = (clean: string, componentPos: number): boolean => {
  // 1. Own route chain
  const ownStart = findRouteChainStart(clean, componentPos);
  const ownEnd = findRouteChainEnd(clean, componentPos);
  const ownChain = clean.slice(ownStart, ownEnd);

  if (ownChain.includes("RenderStrategy.Eager")) return true;
  if (ownChain.includes("RenderStrategy.Lazy")) return false;

  // 2. Ancestor walk
  let searchPos = componentPos;
  for (;;) {
    const childrenDotPos = findEnclosingChildrenCall(clean, searchPos);
    if (childrenDotPos === undefined) return false;

    const parentChain = getParentChainText(clean, childrenDotPos);
    if (parentChain.includes("RenderStrategy.Eager")) return true;
    if (parentChain.includes("RenderStrategy.Lazy")) return false;

    searchPos = childrenDotPos;
  }
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

const apiExportPattern = /(?:^|[;\n\r])\s*export\s+const\s+Api\b/;

const isTypeScriptJsxModule = (id: string): boolean => {
  const [modulePath] = id.split("?");
  if (modulePath === undefined) return false;
  const normalized = modulePath.replace(/\\/g, "/");
  return normalized.endsWith(".tsx") && !normalized.includes("/node_modules/");
};

const stripNonCodeText = (source: string): string => {
  let output = "";
  let index = 0;

  while (index < source.length) {
    const current = source[index];
    const next = source[index + 1];

    if (current === undefined) {
      break;
    }

    if (current === "/" && next === "/") {
      output += "  ";
      index += 2;
      while (index < source.length && source[index] !== "\n") {
        output += " ";
        index += 1;
      }
      continue;
    }

    if (current === "/" && next === "*") {
      output += "  ";
      index += 2;
      while (index < source.length) {
        const blockCurrent = source[index];
        const blockNext = source[index + 1];
        if (blockCurrent === "*" && blockNext === "/") {
          output += "  ";
          index += 2;
          break;
        }
        output += blockCurrent === "\n" ? "\n" : " ";
        index += 1;
      }
      continue;
    }

    if (current === '"' || current === "'" || current === "`") {
      const quote = current;
      output += " ";
      index += 1;
      while (index < source.length) {
        const quotedCurrent = source[index];
        if (quotedCurrent === undefined) {
          break;
        }
        if (quotedCurrent === "\\") {
          output += "  ";
          index += 2;
          continue;
        }
        output += quotedCurrent === "\n" ? "\n" : " ";
        index += 1;
        if (quotedCurrent === quote) {
          break;
        }
      }
      continue;
    }

    output += current;
    index += 1;
  }

  return output;
};

// =============================================================================
// File System Operations
// =============================================================================

/**
 * Check if path exists.
 * @internal
 */
const pathExists: (filePath: string) => Effect.Effect<boolean, never, FileSystem.FileSystem> =
  Effect.fn("VitePlugin.pathExists")(function* (filePath: string) {
    const fs = yield* FileSystem.FileSystem;
    return yield* fs.exists(filePath).pipe(Effect.orElseSucceed(() => false));
  });

/**
 * Write file with directory creation.
 * @internal
 */
const writeFileSafe: (
  filePath: string,
  content: string,
) => Effect.Effect<void, PluginFileSystemError, FileSystem.FileSystem> = Effect.fn(
  "VitePlugin.writeFileSafe",
)(function* (filePath: string, content: string) {
  const fs = yield* FileSystem.FileSystem;
  const dir = nodePath.dirname(filePath);

  yield* fs.makeDirectory(dir, { recursive: true }).pipe(
    Effect.catchTag("PlatformError", (e) =>
      Predicate.isTagged(e.reason, "AlreadyExists") ? Effect.void : Effect.fail(e),
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
 *
 * @remarks
 * Internal guard that prevents Bun builds from depending on the Node platform
 * package through `app/api.ts`.
 *
 * @internal
 * @since 1.0.0
 */
export const validateApiPlatform: (
  apiPath: string,
  platform: Platform,
) => Effect.Effect<void, PluginValidationError | PluginFileSystemError, FileSystem.FileSystem> =
  Effect.fn("VitePlugin.validateApiPlatform")(function* (apiPath: string, platform: Platform) {
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

type ApiClientContract = Data.TaggedEnum<{
  readonly Absent: {};
  readonly ServerOnly: {};
  readonly ClientEnabled: {};
}>;

const ApiClientContract = Data.taggedEnum<ApiClientContract>();

const readApiClientContract: (
  apiPath: string,
) => Effect.Effect<ApiClientContract, PluginFileSystemError, FileSystem.FileSystem> = Effect.fn(
  "VitePlugin.readApiClientContract",
)(function* (apiPath: string) {
  const hasApi = yield* pathExists(apiPath);
  if (!hasApi) {
    return ApiClientContract.Absent();
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

  if (apiExportPattern.test(stripNonCodeText(source))) {
    return ApiClientContract.ClientEnabled();
  }

  return ApiClientContract.ServerOnly();
});

const validateGeneratedApiClient: (
  apiPath: string,
) => Effect.Effect<void, PluginValidationError | PluginFileSystemError, FileSystem.FileSystem> =
  Effect.fn("VitePlugin.validateGeneratedApiClient")(function* (apiPath: string) {
    const contract = yield* readApiClientContract(apiPath);
    if (ApiClientContract.$is("ClientEnabled")(contract)) {
      return;
    }
    return yield* PluginValidationError.invalidStructure(API_EXPORT_MESSAGE, apiPath);
  });

const generateApiClientModule = (apiPath: string): string =>
  renderApiClientModule({ apiImportPath: apiPath.replace(/\\/g, "/") });

// =============================================================================
// Code Generation
// =============================================================================

const toModuleImportPath = (fromDir: string, toFileOrDir: string): string => {
  const relative = nodePath.relative(fromDir, toFileOrDir).replace(/\\/g, "/");
  return relative.startsWith(".") ? relative : `./${relative}`;
};

const stripTypeScriptExtension = (modulePath: string): string => modulePath.replace(/\.tsx?$/, "");

/**
 * Build semantic owner paths for the generated browser entry module.
 *
 * @remarks
 * Keeps path derivation separate from module text rendering so Vite hooks can
 * share one owner contract for dev and build output.
 *
 * @internal
 * @since 1.0.0
 */
export const makeClientEntryModuleOwner = ({
  appDir,
  generatedDir,
  routesFilePath,
}: ClientEntryModuleOwnerInput): ClientEntryModuleOwner => {
  const appImportPath = toModuleImportPath(generatedDir, appDir);
  const routesImportPath =
    routesFilePath === undefined
      ? `${appImportPath}/routes`
      : stripTypeScriptExtension(toModuleImportPath(generatedDir, routesFilePath));

  return {
    layoutImportPath: `${appImportPath}/layout`,
    routesImportPath,
  };
};

/**
 * Render the generated browser entry module from semantic owner paths.
 *
 * @remarks
 * Pure renderer used by dev and build paths; generated text must stay stable
 * for existing virtual module consumers.
 *
 * @internal
 * @since 1.0.0
 */
export const renderClientEntryModule = (owner: ClientEntryModuleOwner): string =>
  `// Auto-generated by trygg - DO NOT EDIT
import { mountDocument, Component, Debug } from "trygg"
import { routes } from "${owner.routesImportPath}"
import Layout from "${owner.layoutImportPath}"
// Pretty-print the trace flight recorder to the console. Dev drops the minimum
// level to "Debug" so cost events show; production stays at Effect's "Info"
// default. Tune per-subtree from app/layout.tsx with Component.provide(Debug.layer({ ... })).
const App = Component.gen(function* () {
  return <Layout />
}).pipe(Component.provide(Debug.layer({ minLevel: import.meta.env.DEV ? "Debug" : "Info" })))

mountDocument(<App />, { manifest: routes.manifest })
`;

/**
 * Generate entry module.
 *
 * Uses `mountDocument` to mount the root layout as the document owner.
 * The layout renders `<html>`, `<head>`, `<body>` which map to existing DOM.
 * Routes manifest is passed so `<Router.Outlet />` works without props.
 *
 * @remarks
 * Internal codegen step that writes the browser entry module under `.trygg/`.
 *
 * @internal
 * @since 1.0.0
 */
export const generateEntryModule = (
  appDir: string,
  generatedDir: string,
  routesFile?: string,
): Effect.Effect<string> =>
  Effect.succeed(
    renderClientEntryModule(
      makeClientEntryModuleOwner({
        appDir,
        generatedDir,
        routesFilePath: routesFile,
      }),
    ),
  );

/**
 * Generate HTML shell.
 * Pure function — no Effect, no file I/O.
 * No `<title>` or `<meta>` beyond charset/viewport — HeadManager owns all head content.
 *
 * @remarks
 * Internal template used for generated app HTML before runtime head content is
 * hoisted into place.
 *
 * @internal
 * @since 1.0.0
 */
export const generateHtmlTemplate = (): string => `<!DOCTYPE html>
<html>
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <link rel="icon" href="/favicon.svg" type="image/svg+xml" />
    <script type="module" src="/${GENERATED_DIR}/entry.tsx"></script>
  </head>
  <body></body>
</html>`;

interface PluginFilePaths {
  readonly appDir: string;
  readonly generatedDir: string;
}

interface PluginFilesService {
  readonly appApiPath: (paths: PluginFilePaths) => string;
  readonly appApiExists: (paths: PluginFilePaths) => Effect.Effect<boolean>;
  readonly routesFilePath: (paths: PluginFilePaths) => Effect.Effect<string | undefined>;
  readonly isRoutesFile: (paths: PluginFilePaths, filePath: string) => Effect.Effect<boolean>;
  readonly writeEntryFile: (paths: PluginFilePaths) => Effect.Effect<void, PluginFileSystemError>;
  readonly writeGeneratedRouteTypes: (
    paths: PluginFilePaths,
  ) => Effect.Effect<void, PluginFileSystemError>;
  readonly regenerateGeneratedRouteTypes: (
    paths: PluginFilePaths,
  ) => Effect.Effect<void, PluginFileSystemError>;
  readonly writeClientEntryFiles: (
    paths: PluginFilePaths,
  ) => Effect.Effect<void, PluginFileSystemError>;
  readonly executeArtifactOperations: (
    operations: ReadonlyArray<BuildArtifactOperation>,
  ) => Effect.Effect<void, PluginFileSystemError>;
  readonly writeBuildEntryFiles: (
    paths: PluginFilePaths,
    options: { readonly output: Output; readonly platform: Platform },
  ) => Effect.Effect<void, PluginFileSystemError>;
  readonly writeProductionServerEntry: (
    paths: PluginFilePaths,
  ) => Effect.Effect<string, PluginFileSystemError, ServerPlatform>;
}

/**
 * Owns generated plugin file path discovery and writes.
 *
 * @remarks
 * Internal service boundary that keeps generated route and entry file work out
 * of Vite hook orchestration.
 *
 * @internal
 * @since 1.0.0
 */
export class PluginFiles extends Context.Service<
  PluginFiles,
  {
    readonly appApiPath: (paths: PluginFilePaths) => string;
    readonly appApiExists: (paths: PluginFilePaths) => Effect.Effect<boolean>;
    readonly routesFilePath: (paths: PluginFilePaths) => Effect.Effect<string | undefined>;
    readonly isRoutesFile: (paths: PluginFilePaths, filePath: string) => Effect.Effect<boolean>;
    readonly writeEntryFile: (paths: PluginFilePaths) => Effect.Effect<void, PluginFileSystemError>;
    readonly writeGeneratedRouteTypes: (
      paths: PluginFilePaths,
    ) => Effect.Effect<void, PluginFileSystemError>;
    readonly regenerateGeneratedRouteTypes: (
      paths: PluginFilePaths,
    ) => Effect.Effect<void, PluginFileSystemError>;
    readonly writeClientEntryFiles: (
      paths: PluginFilePaths,
    ) => Effect.Effect<void, PluginFileSystemError>;
    readonly executeArtifactOperations: (
      operations: ReadonlyArray<BuildArtifactOperation>,
    ) => Effect.Effect<void, PluginFileSystemError>;
    readonly writeBuildEntryFiles: (
      paths: PluginFilePaths,
      options: { readonly output: Output; readonly platform: Platform },
    ) => Effect.Effect<void, PluginFileSystemError>;
    readonly writeProductionServerEntry: (
      paths: PluginFilePaths,
    ) => Effect.Effect<string, PluginFileSystemError, ServerPlatform>;
  }
>()("trygg/vite/PluginFiles") {}

const routeSourcePath = (paths: PluginFilePaths): string =>
  nodePath.join(paths.appDir, "routes.ts");

const appApiPath = (paths: PluginFilePaths): string => nodePath.join(paths.appDir, "api.ts");

const generatedRouteTypesPath = (paths: PluginFilePaths): string =>
  nodePath.join(paths.generatedDir, "routes.d.ts");

const generatedEntryPath = (paths: PluginFilePaths): string =>
  nodePath.join(paths.generatedDir, "entry.tsx");

const sameFilePath = (left: string, right: string): boolean =>
  nodePath.resolve(left) === nodePath.resolve(right);

/**
 * Creates the live generated plugin file service.
 *
 * @remarks
 * Derives route and generated file paths from canonical plugin directories at
 * call time instead of storing duplicate path state.
 *
 * @internal
 * @since 1.0.0
 */
export const makePluginFilesLayer = (): Layer.Layer<PluginFiles, never, FileSystem.FileSystem> =>
  Layer.effect(
    PluginFiles,
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;

      const pathExists = (filePath: string): Effect.Effect<boolean> =>
        fs.exists(filePath).pipe(Effect.orElseSucceed(() => false));

      const writeFileSafe: (
        filePath: string,
        content: string,
      ) => Effect.Effect<void, PluginFileSystemError> = Effect.fn("PluginFiles.writeFileSafe")(
        function* (filePath: string, content: string) {
          const dir = nodePath.dirname(filePath);

          yield* fs.makeDirectory(dir, { recursive: true }).pipe(
            Effect.catchTag("PlatformError", (e) =>
              Predicate.isTagged(e.reason, "AlreadyExists") ? Effect.void : Effect.fail(e),
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
        },
      );

      const routesFilePath: (paths: PluginFilePaths) => Effect.Effect<string | undefined> =
        Effect.fn("PluginFiles.routesFilePath")(function* (paths: PluginFilePaths) {
          const filePath = routeSourcePath(paths);
          const exists = yield* pathExists(filePath);
          return exists ? filePath : undefined;
        });

      const writeRouteTypesFromRoutesWithFs: (
        routesFilePath: string,
        routeTypesPath: string,
      ) => Effect.Effect<boolean, PluginFileSystemError> = Effect.fn(
        "PluginFiles.writeRouteTypesFromRoutesWithFs",
      )(function* (routesFilePath: string, routeTypesPath: string) {
        const routeSource = yield* fs
          .readFileString(routesFilePath)
          .pipe(Effect.orElseSucceed(() => ""));
        if (routeSource.length === 0) {
          return false;
        }

        const parsed = yield* parseRoutes(routeSource);
        const content = yield* generateRouteTypes(parsed);
        yield* writeFileSafe(routeTypesPath, content);
        return true;
      });

      const writeEntryFile: (paths: PluginFilePaths) => Effect.Effect<void, PluginFileSystemError> =
        Effect.fn("PluginFiles.writeEntryFile")(function* (paths: PluginFilePaths) {
          const routesFile = yield* routesFilePath(paths);
          const content = yield* generateEntryModule(paths.appDir, paths.generatedDir, routesFile);
          yield* writeFileSafe(generatedEntryPath(paths), content);
        });

      const writeRouteTypesWithLog: (
        paths: PluginFilePaths,
        message: string,
      ) => Effect.Effect<void, PluginFileSystemError> = Effect.fn(
        "PluginFiles.writeRouteTypesWithLog",
      )(function* (paths: PluginFilePaths, message: string) {
        const routesFile = yield* routesFilePath(paths);
        if (routesFile !== undefined) {
          const wroteTypes = yield* writeRouteTypesFromRoutesWithFs(
            routesFile,
            generatedRouteTypesPath(paths),
          );
          if (wroteTypes) {
            yield* Effect.logDebug(message);
          }
        }
      });

      const writeGeneratedRouteTypes = (paths: PluginFilePaths) =>
        writeRouteTypesWithLog(paths, "Generated route types");

      return {
        appApiPath,
        appApiExists: (paths) =>
          pathExists(appApiPath(paths)).pipe(
            Effect.flatMap((exists) =>
              exists
                ? fs.stat(appApiPath(paths)).pipe(
                    Effect.map((info) => info.type === "File"),
                    Effect.orElseSucceed(() => false),
                  )
                : Effect.succeed(false),
            ),
          ),
        routesFilePath,
        isRoutesFile: Effect.fn("PluginFiles.isRoutesFile")(function* (
          paths: PluginFilePaths,
          filePath: string,
        ) {
          const routesFile = yield* routesFilePath(paths);
          return routesFile !== undefined && sameFilePath(filePath, routesFile);
        }),
        writeEntryFile,
        writeGeneratedRouteTypes,
        regenerateGeneratedRouteTypes: (paths) =>
          writeRouteTypesWithLog(paths, "Regenerated routes.d.ts"),
        writeClientEntryFiles: Effect.fn("PluginFiles.writeClientEntryFiles")(function* (
          paths: PluginFilePaths,
        ) {
          const entryPath = generatedEntryPath(paths);
          const hasEntry = yield* pathExists(entryPath);
          const routesFile = yield* routesFilePath(paths);

          if (!hasEntry || routesFile !== undefined) {
            yield* writeEntryFile(paths);
          }

          yield* writeGeneratedRouteTypes(paths);
        }),
        executeArtifactOperations: (operations) =>
          Effect.forEach(
            operations,
            (operation) => {
              return BuildArtifactOperation.$match(operation, {
                WriteFile: (writeFile) => writeFileSafe(writeFile.path, writeFile.contents),
                RemoveFile: (removeFile) =>
                  pathExists(removeFile.path).pipe(
                    Effect.flatMap((exists) =>
                      exists
                        ? fs.remove(removeFile.path).pipe(
                            Effect.mapError(
                              (cause) =>
                                new PluginFileSystemError({
                                  operation: "remove",
                                  path: removeFile.path,
                                  cause,
                                }),
                            ),
                          )
                        : Effect.void,
                    ),
                  ),
                RunNestedBuild: () => Effect.void,
              });
            },
            { discard: true },
          ),
        writeBuildEntryFiles: Effect.fn("PluginFiles.writeBuildEntryFiles")(function* (
          paths: PluginFilePaths,
          options: { readonly output: Output; readonly platform: Platform },
        ) {
          const entryPath = generatedEntryPath(paths);
          const hasEntry = yield* pathExists(entryPath);
          const routesFile = yield* routesFilePath(paths);

          if (!hasEntry || routesFile !== undefined) {
            yield* writeEntryFile(paths);
          }

          yield* writeGeneratedRouteTypes(paths);

          yield* writeFileSafe(
            nodePath.join(paths.generatedDir, "index.html"),
            generateHtmlTemplate(),
          );

          if (options.platform === "cloudflare" && options.output === "static") {
            yield* writeFileSafe(
              nodePath.join(paths.generatedDir, "worker-entry.js"),
              renderCloudflareStaticWorkerEntryModule(),
            );
          }
        }),
        writeProductionServerEntry: Effect.fn("PluginFiles.writeProductionServerEntry")(function* (
          paths: PluginFilePaths,
        ) {
          const hasApi = yield* pathExists(nodePath.join(paths.appDir, "api.ts"));
          const serverEntryPath = nodePath.join(paths.generatedDir, "server-entry.ts");
          const content = yield* generateServerEntry(hasApi);

          yield* writeFileSafe(serverEntryPath, content);
          return serverEntryPath;
        }),
      } satisfies PluginFilesService;
    }).pipe(Effect.annotateLogs({ service: "PluginFiles" })),
  );

const generatedApiClientTypesPath = (generatedDir: string): string =>
  nodePath.join(generatedDir, "api.d.ts");

const legacyGeneratedApiClientTypesPath = (generatedDir: string): string =>
  nodePath.join(generatedDir, "api-types.ts");

const removeFileIfExists: (
  filePath: string,
) => Effect.Effect<void, PluginFileSystemError, FileSystem.FileSystem> = Effect.fn(
  "VitePlugin.removeFileIfExists",
)(function* (filePath: string) {
  const fs = yield* FileSystem.FileSystem;
  const exists = yield* pathExists(filePath);
  if (!exists) {
    return;
  }

  yield* fs.remove(filePath).pipe(
    Effect.mapError(
      (cause) =>
        new PluginFileSystemError({
          operation: "remove",
          path: filePath,
          cause,
        }),
    ),
  );
});

const writeGeneratedApiClientTypes: (
  appDir: string,
  generatedDir: string,
) => Effect.Effect<void, PluginFileSystemError, FileSystem.FileSystem> = Effect.fn(
  "VitePlugin.writeGeneratedApiClientTypes",
)(function* (appDir: string, generatedDir: string) {
  const apiPath = nodePath.join(appDir, "api.ts");
  const contract = yield* readApiClientContract(apiPath);

  yield* removeFileIfExists(legacyGeneratedApiClientTypesPath(generatedDir));

  if (ApiClientContract.$is("ClientEnabled")(contract)) {
    const appImportPath = toModuleImportPath(generatedDir, appDir);
    const content = renderApiClientDeclarations({
      apiTypeImportPath: `${appImportPath}/api`,
    });
    yield* writeFileSafe(generatedApiClientTypesPath(generatedDir), content);
    return;
  }

  // Remove stale generated declarations for Absent and ServerOnly
  const typesPath = generatedApiClientTypesPath(generatedDir);
  yield* removeFileIfExists(typesPath);
});

/**
 * Render the generated Cloudflare Static SPA Worker entry.
 *
 * @remarks
 * The Worker is a generated build artifact for `platform: "cloudflare"` with
 * `output: "static"`. It asks the Cloudflare `ASSETS` binding first and falls
 * back eligible document requests to public `/index.html`.
 *
 * @category Vite Plugin
 * @internal
 * @since 1.0.0
 */
export const renderCloudflareStaticWorkerEntryModule = (): string =>
  [
    `const GENERATED_ASSET_EXTENSIONS = new Set([`,
    `  ".avif",`,
    `  ".css",`,
    `  ".gif",`,
    `  ".ico",`,
    `  ".jpeg",`,
    `  ".jpg",`,
    `  ".js",`,
    `  ".json",`,
    `  ".map",`,
    `  ".mjs",`,
    `  ".png",`,
    `  ".svg",`,
    `  ".wasm",`,
    `  ".webp",`,
    `  ".woff",`,
    `  ".woff2",`,
    `]);`,
    ``,
    `const isDocumentRequest = (request) => {`,
    `  if (request.method !== "GET" && request.method !== "HEAD") {`,
    `    return false;`,
    `  }`,
    ``,
    `  const destination = request.headers.get("Sec-Fetch-Dest");`,
    `  if (destination === "document") {`,
    `    return true;`,
    `  }`,
    `  if (destination !== null && destination !== "") {`,
    `    return false;`,
    `  }`,
    ``,
    `  const accept = request.headers.get("Accept") ?? "";`,
    `  return accept.includes("text/html") || accept.includes("*/*");`,
    `};`,
    ``,
    `const isGeneratedAssetLike = (pathname) => {`,
    `  const dot = pathname.lastIndexOf(".");`,
    `  if (dot === -1) {`,
    `    return false;`,
    `  }`,
    `  return GENERATED_ASSET_EXTENSIONS.has(pathname.slice(dot).toLowerCase());`,
    `};`,
    ``,
    `export default {`,
    `  async fetch(request, env) {`,
    `    const assetResponse = await env.ASSETS.fetch(request);`,
    `    if (assetResponse.status !== 404) {`,
    `      return assetResponse;`,
    `    }`,
    ``,
    `    const url = new URL(request.url);`,
    `    if (!isDocumentRequest(request) || isGeneratedAssetLike(url.pathname)) {`,
    `      return assetResponse;`,
    `    }`,
    ``,
    `    const shell = new URL(request.url);`,
    `    shell.pathname = "/";`,
    `    shell.search = "";`,
    `    return env.ASSETS.fetch(new Request(shell, request));`,
    `  },`,
    `};`,
  ].join("\n");

/**
 * Render the generated API client runtime module.
 *
 * @remarks
 * Pure renderer used by the virtual module `trygg/api`. Imports the app's
 * exported `Api` and builds `ApiClient` + `ApiClientLive` from it.
 *
 * @internal
 * @since 1.0.0
 */
export const renderApiClientModule = ({
  apiImportPath,
}: {
  readonly apiImportPath: string;
}): string =>
  `// Auto-generated by trygg - DO NOT EDIT
import { HttpApiClient } from "effect/unstable/httpapi"
import { Effect, Layer } from "effect"
import * as Context from "effect/Context"
import { FetchHttpClient } from "effect/unstable/http"
import { Api } from ${JSON.stringify(apiImportPath)}

const client = HttpApiClient.make(Api, { baseUrl: "" })

export class ApiClient extends Context.Service()("ApiClient") {}

export const ApiClientLive = Layer.effect(
  ApiClient,
  client.pipe(Effect.provide(FetchHttpClient.layer)),
)

export { Api }
`;

/**
 * Render the generated API client type declarations.
 *
 * @remarks
 * Produces the ambient `trygg/api` module augmentation written to the
 * generated `.trygg/api.d.ts` file.
 *
 * @internal
 * @since 1.0.0
 */
export const renderApiClientDeclarations = ({
  apiTypeImportPath,
}: {
  readonly apiTypeImportPath: string;
}): string =>
  `// Auto-generated by trygg\nimport type * as Context from "effect/Context"\nimport type { Layer } from "effect/Layer"\nimport type { HttpApiClient } from "effect/unstable/httpapi"\nimport type { Api } from "${apiTypeImportPath}"\n\ntype ApiClientService = HttpApiClient.ForApi<typeof Api>\n\ndeclare module "trygg/api" {\n  export interface ApiClient {}\n  export const ApiClient: Context.ServiceClass<ApiClient, "ApiClient", ApiClientService>\n  export const ApiClientLive: Layer.Layer<ApiClient>\n  export { Api }\n}\n`;

const renderProductionServerLive = ({
  hasApi,
  platform,
}: ProductionServerEntryModuleOwner): string =>
  hasApi
    ? `const ServerLive = HttpRouter.serve(ApiLive, {
  middleware: flow(ProductionMiddleware, HttpMiddleware.logger)
}).pipe(
  Layer.provide(HttpServer.layerServices),
  Layer.provide(${platform.serverLayer})
)`
    : `const NotFoundApp = Effect.succeed(HttpServerResponse.empty({ status: 404 }))

const ServerLive = HttpServer.serve(
  flow(ProductionMiddleware, HttpMiddleware.logger)
)(NotFoundApp).pipe(
  Layer.provide(${platform.serverLayer})
)`;

const renderProductionMiddleware =
  (): string => `// Single composed middleware: static → API passthrough → SPA fallback
const ProductionMiddleware = HttpMiddleware.make((app) =>
  Effect.gen(function* () {
    const request = yield* HttpServerRequest.HttpServerRequest
    const url = new URL(request.url, "http://localhost")
    const pathname = url.pathname

    // 1. Static files (has extension, not API)
    if (pathname.includes(".") && !pathname.startsWith("/api/")) {
      const filePath = nodePath.resolve(clientDir, pathname.slice(1))
      // Path traversal guard — trailing separator prevents sibling dir bypass
      if (!filePath.startsWith(clientDir + "/")) {
        return yield* HttpServerResponse.text("Forbidden", { status: 403 })
      }
      return yield* Effect.tryPromise({
        try: () => nodeFs.promises.readFile(filePath),
        catch: () => "not-found"
      }).pipe(
        Effect.map((buf) => {
          const ext = nodePath.extname(pathname).toLowerCase()
          const ct = MIME[ext] ?? "application/octet-stream"
          const cache = pathname.startsWith("/assets/")
            ? "public, max-age=31536000, immutable"
            : "public, max-age=3600"
          return HttpServerResponse.uint8Array(new Uint8Array(buf), {
            headers: { "content-type": ct, "cache-control": cache }
          })
        }),
        Effect.catch(() => app)
      )
    }

    // 2. API routes — delegate to HttpApi handler
    if (pathname.startsWith("/api/")) {
      return yield* app
    }

    // 3. SPA fallback — serve cached shell for navigation requests
    if (request.method === "GET") {
      return yield* HttpServerResponse.text(indexHtml, {
        status: 200,
        headers: { "content-type": "text/html; charset=utf-8" }
      })
    }

    return yield* app
  })
)`;

/**
 * Render the generated production server entry module from owner state.
 *
 * @remarks
 * Keeps platform and API-specific branches named outside the Effectful Vite
 * hook so generated server content can be tested directly.
 *
 * @internal
 * @since 1.0.0
 */
export const renderProductionServerEntryModule = (
  owner: ProductionServerEntryModuleOwner,
): string => {
  const apiImport = owner.hasApi ? `import ApiLive from "../app/api.js"` : "";

  return `/**
 * Production server entry point
 * Auto-generated by trygg — DO NOT EDIT
 */
import { HttpMiddleware, HttpRouter, HttpServer, HttpServerRequest, HttpServerResponse } from "effect/unstable/http"
${owner.platform.imports}
import { Layer, Effect, flow } from "effect"
import * as nodePath from "node:path"
import * as nodeFs from "node:fs"
import { fileURLToPath } from "node:url"
${apiImport}

const __dirname = nodePath.dirname(fileURLToPath(import.meta.url))
const clientDir = nodePath.join(__dirname, "client")

const PORT = Number(process.env.PORT ?? 4173)
const HOST = process.env.HOST ?? "0.0.0.0"

// SPA shell — read once at startup
const indexHtml = nodeFs.readFileSync(
  nodePath.join(clientDir, ".trygg", "index.html"),
  "utf-8"
)

// MIME types for static assets
const MIME = /** @type {Record<string, string>} */ ({
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".mjs": "application/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".ico": "image/x-icon",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".webp": "image/webp",
  ".avif": "image/avif",
  ".map": "application/json",
})

${renderProductionMiddleware()}

${renderProductionServerLive(owner)}

// Launch server
${owner.platform.runtime}.runMain(
  Effect.gen(function* () {
    yield* Effect.log(\`Server listening on http://\${HOST}:\${PORT}\`)
    yield* Layer.launch(ServerLive)
  })
)
`;
};

/**
 * Generate server entry point for production builds.
 *
 * Produces a single composed middleware that handles:
 *   1. Static files — serves from `dist/client/` with MIME detection
 *   2. API routes — delegates to HttpApi handler (when `hasApi`)
 *   3. SPA fallback — serves `.trygg/index.html` for navigation requests
 *
 * @remarks
 * Internal codegen step that emits the production server source used for the
 * generated server bundle.
 *
 * @internal
 * @since 1.0.0
 */
export const generateServerEntry: (
  hasApi: boolean,
) => Effect.Effect<string, never, ServerPlatform> = Effect.fn("VitePlugin.generateServerEntry")(
  function* (hasApi: boolean) {
    const platform = yield* ServerPlatform;
    return renderProductionServerEntryModule({ hasApi, platform });
  },
);

interface BuildOutputConfig {
  readonly command: string;
  readonly root: string;
}

interface BuildOutputStartInput {
  readonly appDir: string;
  readonly generatedDir: string;
  readonly config: BuildOutputConfig;
  readonly output: Output;
  readonly platform: Platform;
}

interface BuildOutputCloseInput {
  readonly appDir: string;
  readonly generatedDir: string;
  readonly config: BuildOutputConfig;
  readonly output: Output;
  readonly platform: Platform;
}

interface BuildOutputService {
  readonly buildStart: (
    input: BuildOutputStartInput,
  ) => Effect.Effect<void, PluginValidationError | PluginFileSystemError>;
  readonly closeBundle: (
    input: BuildOutputCloseInput,
  ) => Effect.Effect<void, PluginValidationError | PluginFileSystemError>;
}

interface BuildOutputDeps {
  readonly buildServer: (
    serverEntryPath: string,
    config: BuildOutputConfig,
  ) => Effect.Effect<void, PluginFileSystemError>;
  readonly fileSystem: FileSystem.FileSystem;
  readonly files: PluginFilesService;
  readonly serverPlatform: ServerPlatformService;
}

class BuildOutput extends Context.Service<
  BuildOutput,
  {
    readonly buildStart: (
      input: BuildOutputStartInput,
    ) => Effect.Effect<void, PluginValidationError | PluginFileSystemError>;
    readonly closeBundle: (
      input: BuildOutputCloseInput,
    ) => Effect.Effect<void, PluginValidationError | PluginFileSystemError>;
  }
>()("trygg/vite/BuildOutput") {}

/**
 * Create build output hook operations.
 *
 * @remarks
 * Test seam for replacing the production server build while preserving the
 * same Effect-owned build output orchestration used by Vite hooks.
 *
 * @internal
 */
export const makeBuildOutput = ({
  buildServer,
  fileSystem,
  files,
  serverPlatform,
}: BuildOutputDeps): BuildOutputService => {
  const planner = makeBuildArtifactPlanner({ failOnWarnings: false });
  const generatedArtifactPlanner = makeGeneratedArtifactPlanner({ includeCleanupOperations: true });
  const emitDiagnostic = (diagnostic: BuildPlanDiagnostic) =>
    BuildPlanDiagnostic.$is("Warning")(diagnostic)
      ? Effect.logWarning(diagnostic.message)
      : Effect.void;
  const validatePlan = (input: {
    readonly output: Output;
    readonly platform: Platform;
    readonly hasApi: boolean;
    readonly appDir: string;
    readonly generatedDir: string;
  }) =>
    planner.validateOutput(input).pipe(
      Effect.tap((plan) => Effect.forEach(plan.diagnostics, emitDiagnostic, { discard: true })),
      Effect.catchTag("InvalidBuildOutputCombination", (error: InvalidBuildOutputCombination) =>
        Effect.fail(
          PluginValidationError.invalidStructure(error.diagnostic.message, error.input.appDir),
        ),
      ),
    );
  const planArtifacts: (input: {
    readonly output: Output;
    readonly platform: Platform;
    readonly hasApi: boolean;
    readonly appDir: string;
    readonly generatedDir: string;
  }) => Effect.Effect<GeneratedArtifactPlan, PluginValidationError> = Effect.fn(
    "BuildOutput.planArtifacts",
  )(function* (input) {
    const validation = yield* validatePlan(input);
    return yield* generatedArtifactPlanner
      .planArtifacts(validation)
      .pipe(
        Effect.mapError((error) =>
          PluginValidationError.invalidStructure(
            `Failed to plan build artifacts during ${error.operation}`,
            input.appDir,
          ),
        ),
      );
  });
  const hasOperation = (
    plan: GeneratedArtifactPlan,
    tag: BuildArtifactOperation["_tag"],
    path: string,
  ) =>
    plan.operations.some((operation) =>
      BuildArtifactOperation.$match(operation, {
        WriteFile: (writeFile) =>
          tag === "WriteFile" && nodePath.resolve(writeFile.path) === nodePath.resolve(path),
        RemoveFile: (removeFile) =>
          tag === "RemoveFile" && nodePath.resolve(removeFile.path) === nodePath.resolve(path),
        RunNestedBuild: () => false,
      }),
    );

  return {
    buildStart: Effect.fn("BuildOutput.buildStart")(function* ({
      appDir,
      generatedDir,
      config,
      output,
      platform,
    }: BuildOutputStartInput) {
      const paths = { appDir, generatedDir };
      const apiPath = files.appApiPath(paths);

      yield* validateApiPlatform(apiPath, platform).pipe(
        Effect.provideService(FileSystem.FileSystem, fileSystem),
        Effect.tapError(logApiValidationError),
      );

      if (config.command !== "build") {
        return;
      }

      const hasApi = yield* files.appApiExists(paths);
      const artifactPlan = yield* planArtifacts({
        appDir,
        generatedDir,
        output,
        platform,
        hasApi,
      });
      yield* files.writeClientEntryFiles(paths);
      yield* files.executeArtifactOperations(
        artifactPlan.operations.filter(
          (operation) => !BuildArtifactOperation.$is("RunNestedBuild")(operation),
        ),
      );
    }),
    closeBundle: ({ appDir, generatedDir, config, output, platform }) =>
      config.command !== "build"
        ? Effect.void
        : Effect.gen(function* () {
            const paths = { appDir, generatedDir };
            const hasApi = yield* files.appApiExists(paths);
            const artifactPlan = yield* planArtifacts({
              appDir,
              generatedDir,
              output,
              platform,
              hasApi,
            });

            if (
              hasOperation(
                artifactPlan,
                "WriteFile",
                nodePath.join(generatedDir, "worker-entry.js"),
              )
            ) {
              const internalShellDir = nodePath.join(config.root, "dist", GENERATED_DIR);
              const internalShellPath = nodePath.join(internalShellDir, "index.html");
              const publicShellPath = nodePath.join(config.root, "dist", "index.html");
              const shell = yield* fileSystem.readFileString(internalShellPath).pipe(
                Effect.mapError(
                  (cause) =>
                    new PluginFileSystemError({
                      operation: "read",
                      path: internalShellPath,
                      cause,
                    }),
                ),
              );

              yield* fileSystem.writeFileString(publicShellPath, shell).pipe(
                Effect.mapError(
                  (cause) =>
                    new PluginFileSystemError({
                      operation: "write",
                      path: publicShellPath,
                      cause,
                    }),
                ),
              );
              yield* removeFileIfExists(internalShellPath).pipe(
                Effect.provideService(FileSystem.FileSystem, fileSystem),
              );
              yield* fileSystem.remove(internalShellDir, { recursive: true }).pipe(
                Effect.mapError(
                  (cause) =>
                    new PluginFileSystemError({
                      operation: "remove",
                      path: internalShellDir,
                      cause,
                    }),
                ),
              );
              return;
            }

            const nestedBuild = artifactPlan.operations.find(
              (operation) =>
                BuildArtifactOperation.$is("RunNestedBuild")(operation) &&
                operation.name === "production-server",
            );
            if (nestedBuild === undefined) {
              return;
            }

            const serverEntryPath = yield* files
              .writeProductionServerEntry(paths)
              .pipe(Effect.provideService(ServerPlatform, serverPlatform));

            yield* Effect.logInfo("Building production server...");
            yield* buildServer(serverEntryPath, config);
            yield* Effect.logInfo("Server build complete").pipe(
              Effect.annotateLogs("style", "success"),
            );
          }),
  };
};

const viteServerBuild = (
  serverEntryPath: string,
  config: BuildOutputConfig,
): Effect.Effect<void, PluginFileSystemError> =>
  Effect.tryPromise({
    try: () =>
      build({
        configFile: false,
        root: config.root,
        build: {
          ssr: serverEntryPath,
          outDir: nodePath.join(config.root, "dist"),
          emptyOutDir: false,
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
  }).pipe(Effect.asVoid);

const makeBuildOutputLayer = (): Layer.Layer<
  BuildOutput,
  never,
  FileSystem.FileSystem | PluginFiles | ServerPlatform
> =>
  Layer.effect(
    BuildOutput,
    Effect.gen(function* () {
      const fileSystem = yield* FileSystem.FileSystem;
      const files = yield* PluginFiles;
      const serverPlatform = yield* ServerPlatform;
      return makeBuildOutput({ buildServer: viteServerBuild, fileSystem, files, serverPlatform });
    }).pipe(Effect.annotateLogs({ service: "BuildOutput" })),
  );

// =============================================================================
// Plugin
// =============================================================================

/**
 * trygg Vite plugin
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
 *
 * @remarks
 * `TryggOptions` reuses the `trygg/config` contract so Vite setup and app
 * configuration stay aligned.
 *
 * @example
 * ```ts
 * const options: TryggOptions = { platform: "node", output: "server" }
 * ```
 *
 * @category Vite Plugin
 * @public
 * @since 1.0.0
 */
export interface TryggOptions extends TryggConfig {}

/**
 * Public plugin type deliberately avoids direct `vite` type coupling.
 *
 * @remarks
 * This shape prevents cross-install type identity conflicts when trygg and the
 * app resolve `vite` from different paths.
 *
 * @example
 * ```ts
 * const plugin: TryggPlugin = trygg()
 * ```
 *
 * @category Vite Plugin
 * @public
 * @since 1.0.0
 */
export interface TryggPlugin {
  readonly name: string;
  readonly [key: string]: unknown;
}

interface PreviewRequestLike {
  method?: string;
  url?: string;
}

interface PreviewServerLike {
  readonly middlewares: {
    use: (handler: (req: PreviewRequestLike, _res: unknown, next: () => void) => void) => void;
  };
}

/**
 * Minimal Vite dev server surface consumed by the internal adapter.
 *
 * @remarks
 * Keeps direct `ViteDevServer` coupling at the plugin hook boundary while tests
 * exercise the adapter through a structural source.
 *
 * @internal
 * @category Vite Plugin
 * @since 1.0.0
 */
export interface ViteServerSource {
  readonly ssrLoadModule: (id: string) => Promise<Record<string, unknown>>;
  readonly watcher: {
    readonly on: (event: "change", handler: (file: string) => void | Promise<void>) => void;
  };
  readonly httpServer?:
    | {
        readonly on: (event: "close", handler: () => void) => unknown;
      }
    | null
    | undefined;
  readonly middlewares: {
    readonly use: (middleware: Connect.NextHandleFunction) => void;
  };
  readonly transformIndexHtml: (url: string, html: string) => Promise<string>;
}

/**
 * Named adapter operations for Vite dev server effects.
 *
 * @remarks
 * API mount and close cleanup use explicit operations so lifecycle ownership is
 * isolated from the rest of `configureServer`.
 *
 * @internal
 * @category Vite Plugin
 * @since 1.0.0
 */
export interface ViteServer {
  readonly loadModule: (
    id: string,
    message: string,
  ) => Effect.Effect<Record<string, unknown>, ApiInitError>;
  readonly onFileChange: (handler: (file: string) => void | Promise<void>) => Effect.Effect<void>;
  readonly closeApiScopeOnServerClose: (scope: Scope.Closeable) => Effect.Effect<void>;
  readonly mountApiMiddleware: (middleware: Connect.NextHandleFunction) => Effect.Effect<void>;
  readonly useMiddleware: (middleware: Connect.NextHandleFunction) => Effect.Effect<void>;
  readonly transformIndexHtml: (
    url: string,
    html: string,
  ) => Effect.Effect<string, PluginFileSystemError>;
  readonly mountHtmlFallbackMiddleware: (html: string) => Effect.Effect<void>;
}

export namespace PluginApi {
  export type InitialState = Data.TaggedEnum<{
    readonly Absent: { readonly apiPath: string };
    readonly Loading: { readonly apiPath: string };
    readonly Ready: {
      readonly apiPath: string;
      readonly handle: DevApiHandle;
      readonly scope: Scope.Closeable;
    };
    readonly Reloading: {
      readonly apiPath: string;
      readonly handle: DevApiHandle;
      readonly scope: Scope.Closeable;
    };
    readonly Failed: {
      readonly apiPath: string;
      readonly error: ImportError | ApiInitError;
    };
  }>;

  export const InitialState = Data.taggedEnum<InitialState>();

  export type Absent = Extract<InitialState, { readonly _tag: "Absent" }>;
  export type Loading = Extract<InitialState, { readonly _tag: "Loading" }>;
  export type Ready = Extract<InitialState, { readonly _tag: "Ready" }>;
  export type Reloading = Extract<InitialState, { readonly _tag: "Reloading" }>;
  export type Failed = Extract<InitialState, { readonly _tag: "Failed" }>;

  /**
   * Active dev API facade owned by the plugin layer.
   *
   * @remarks
   * Keeps api.ts change handling beside the active dev API handle so Vite watcher
   * code delegates reload requests instead of knowing reload semantics directly.
   *
   * @internal
   * @category Vite Plugin
   * @since 1.0.0
   */
  export interface Active {
    readonly middleware: Connect.NextHandleFunction;
    readonly reloadChangedFile: (file: string) => Effect.Effect<void>;
  }

  type ReloadState = Data.TaggedEnum<{
    readonly Idle: {};
    readonly Running: {
      readonly followUp: boolean;
      readonly done: Deferred.Deferred<void, DevApiErrors>;
    };
  }>;

  const ReloadState = Data.taggedEnum<ReloadState>();

  type ReloadDecision = Data.TaggedEnum<{
    readonly Run: { readonly done: Deferred.Deferred<void, DevApiErrors> };
    readonly Await: { readonly done: Deferred.Deferred<void, DevApiErrors> };
  }>;

  const ReloadDecision = Data.taggedEnum<ReloadDecision>();

  const reloadIdle = ReloadState.Idle();

  const isDevApiError = (error: unknown): error is DevApiErrors =>
    Predicate.isTagged(error, "ApiInitError") || Predicate.isTagged(error, "ImportError");
  export interface InitialLoadOptions<RHasApi> {
    readonly apiPath: string;
    readonly hasApi: Effect.Effect<boolean, never, RHasApi>;
    readonly loadHandlerFactory: Effect.Effect<HandlerFactory, ApiInitError>;
    readonly makeApi: (
      handlerFactory: HandlerFactory,
    ) => Effect.Effect<DevApiHandle, ImportError | ApiInitError, Scope.Scope>;
    readonly observe?: (state: InitialState) => Effect.Effect<void>;
  }

  const observe = <RHasApi>(
    options: InitialLoadOptions<RHasApi>,
    state: InitialState,
  ): Effect.Effect<void> => options.observe?.(state) ?? Effect.void;

  const coalesceReload: <RHasApi>(
    options: InitialLoadOptions<RHasApi>,
    reload: DevApiHandle["reload"],
    getReady: () => Ready,
  ) => Effect.Effect<DevApiHandle["reload"]> = Effect.fn("PluginApi.coalesceReload")(function* <
    RHasApi,
  >(options: InitialLoadOptions<RHasApi>, reload: DevApiHandle["reload"], getReady: () => Ready) {
    const reloadState = yield* SynchronizedRef.make<ReloadState>(reloadIdle);

    const runReload = (
      done: Deferred.Deferred<void, DevApiErrors>,
    ): Effect.Effect<void, DevApiErrors, Scope.Scope> =>
      Effect.suspend(() =>
        Effect.uninterruptibleMask((restore) =>
          Effect.gen(function* () {
            const ready = getReady();
            const reloading = InitialState.Reloading({
              apiPath: ready.apiPath,
              handle: ready.handle,
              scope: ready.scope,
            });
            yield* observe(options, reloading);
            const exit = yield* restore(reload).pipe(Effect.exit);
            if (Exit.isFailure(exit)) {
              const foundError = Cause.findErrorOption(exit.cause);
              const canRetry = yield* Option.match(foundError, {
                onNone: () => Effect.succeed(false),
                onSome: (error) => {
                  if (!isDevApiError(error)) {
                    return Effect.succeed(false);
                  }

                  const failed = InitialState.Failed({ apiPath: ready.apiPath, error });
                  return observe(options, failed).pipe(Effect.as(true));
                },
              });

              if (canRetry) {
                const shouldReload = yield* SynchronizedRef.modifyEffect(reloadState, (state) => {
                  if (ReloadState.$is("Running")(state) && state.followUp) {
                    const next = ReloadState.Running({ followUp: false, done });
                    const result: readonly [boolean, ReloadState] = [true, next];
                    return Effect.succeed(result);
                  }

                  const result: readonly [boolean, ReloadState] = [false, reloadIdle];
                  return Effect.succeed(result);
                });

                if (shouldReload) {
                  return yield* runReload(done);
                }
              }

              yield* SynchronizedRef.set(reloadState, reloadIdle);
              yield* Deferred.done(done, exit).pipe(Effect.asVoid);
              return yield* Effect.failCause(exit.cause);
            }

            const shouldReload = yield* SynchronizedRef.modifyEffect(reloadState, (state) => {
              if (ReloadState.$is("Running")(state) && state.followUp) {
                const next = ReloadState.Running({ followUp: false, done });
                const result: readonly [boolean, ReloadState] = [true, next];
                return Effect.succeed(result);
              }

              const result: readonly [boolean, ReloadState] = [false, reloadIdle];
              return Effect.succeed(result);
            });

            if (shouldReload) {
              return yield* runReload(done);
            }

            yield* observe(options, ready);
            yield* Deferred.succeed(done, undefined).pipe(Effect.asVoid);
          }),
        ),
      );

    return yield* Effect.succeed(
      Effect.gen(function* () {
        const decision = yield* SynchronizedRef.modifyEffect(reloadState, (state) =>
          Effect.gen(function* () {
            if (ReloadState.$is("Running")(state)) {
              const next = ReloadState.Running({ done: state.done, followUp: true });
              const result: readonly [ReloadDecision, ReloadState] = [
                ReloadDecision.Await({ done: state.done }),
                next,
              ];
              return result;
            }

            const done = yield* Deferred.make<void, DevApiErrors>();
            const next = ReloadState.Running({ followUp: false, done });
            const result: readonly [ReloadDecision, ReloadState] = [
              ReloadDecision.Run({ done }),
              next,
            ];
            return result;
          }),
        );

        if (ReloadDecision.$is("Await")(decision)) {
          return yield* Deferred.await(decision.done);
        }

        return yield* runReload(decision.done);
      }).pipe(Effect.withSpan("PluginApi.reloadApi")),
    );
  });

  export const loadInitial: <RHasApi>(
    options: InitialLoadOptions<RHasApi>,
  ) => Effect.Effect<Absent | Ready | Failed, never, RHasApi> = Effect.fn("PluginApi.loadInitial")(
    function* <RHasApi>(options: InitialLoadOptions<RHasApi>) {
      const hasApi = yield* options.hasApi;
      if (!hasApi) {
        const state = InitialState.Absent({ apiPath: options.apiPath });
        yield* observe(options, state);
        return state;
      }

      const loading = InitialState.Loading({ apiPath: options.apiPath });
      yield* observe(options, loading);
      const scope = yield* Scope.make();

      return yield* Effect.gen(function* () {
        const handlerFactory = yield* options.loadHandlerFactory;
        const handle = yield* Scope.provide(options.makeApi(handlerFactory), scope);
        const initialReady = InitialState.Ready({
          apiPath: options.apiPath,
          handle,
          scope,
        });
        let readyState = initialReady;
        const reload = yield* coalesceReload(options, handle.reload, () => readyState);
        const readyHandle: DevApiHandle = { ...handle, reload };
        const ready = InitialState.Ready({
          apiPath: initialReady.apiPath,
          handle: readyHandle,
          scope: initialReady.scope,
        });
        readyState = ready;
        yield* observe(options, ready);
        return ready;
      }).pipe(
        Effect.catch((error: ImportError | ApiInitError) =>
          Effect.gen(function* () {
            yield* Scope.close(scope, Exit.fail(error));
            const failed = InitialState.Failed({ apiPath: options.apiPath, error });
            yield* observe(options, failed);
            return failed;
          }),
        ),
      );
    },
  );

  export const closeInitial = (state: InitialState): Effect.Effect<void> =>
    InitialState.$is("Ready")(state) ? Scope.close(state.scope, Exit.void) : Effect.void;
}

const devApiErrorTag = (error: DevApiErrors): DevApiErrors["_tag"] =>
  Predicate.isTagged(error, "ApiInitError") ? "ApiInitError" : "ImportError";

const logPluginApiReloadError = (error: DevApiErrors): Effect.Effect<void> =>
  Effect.logError(`[api] reload.failed: ${Cause.pretty(Cause.fail(error))}`).pipe(
    Effect.annotateLogs("error_tag", devApiErrorTag(error)),
  );

/**
 * Create a plugin-owned facade for an active dev API handle.
 *
 * @remarks
 * The facade preserves existing dev reload behavior: one api.ts change requests
 * one scoped handle reload, successful reloads log debug output, and typed reload
 * failures are logged without failing unrelated watcher work.
 *
 * @internal
 * @category Vite Plugin
 * @since 1.0.0
 */
export const makePluginApi = (handle: DevApiHandle): PluginApi.Active => ({
  middleware: handle.middleware,
  reloadChangedFile: (file) => {
    if (!file.endsWith("api.ts")) {
      return Effect.void;
    }

    return Effect.scoped(handle.reload).pipe(
      Effect.tap(() => Effect.logDebug("Reloaded API handlers")),
      Effect.catchTags({
        ApiInitError: logPluginApiReloadError,
        ImportError: logPluginApiReloadError,
      }),
    );
  },
});
type ViteServerRunPromise = (effect: Effect.Effect<void>) => Promise<void>;

/**
 * Build the short-lived Vite server adapter for dev-server hooks.
 *
 * @remarks
 * The adapter is created per Vite server configuration and should not outlive
 * that server instance.
 *
 * @internal
 * @category Vite Plugin
 * @since 1.0.0
 */
export const makeViteServer = (
  server: ViteServerSource,
  runPromise: ViteServerRunPromise = Effect.runPromise,
): ViteServer => {
  const transformIndexHtml: ViteServer["transformIndexHtml"] = (url, html) =>
    Effect.tryPromise({
      try: () => server.transformIndexHtml(url, html),
      catch: (cause) =>
        new PluginFileSystemError({
          operation: "transform",
          path: "bootstrap-shell",
          cause,
        }),
    });

  return {
    loadModule: (id, message) =>
      Effect.tryPromise({
        try: () => server.ssrLoadModule(id),
        catch: (cause) => new ApiInitError({ message, cause }),
      }),
    onFileChange: (handler) =>
      Effect.sync(() => server.watcher.on("change", handler)).pipe(Effect.asVoid),
    closeApiScopeOnServerClose: (scope) =>
      Effect.sync(() =>
        server.httpServer?.on("close", () => {
          runPromise(Scope.close(scope, Exit.void)).catch(() => undefined);
        }),
      ).pipe(Effect.asVoid),
    mountApiMiddleware: (middleware) => Effect.sync(() => server.middlewares.use(middleware)),
    useMiddleware: (middleware) => Effect.sync(() => server.middlewares.use(middleware)),
    transformIndexHtml,
    mountHtmlFallbackMiddleware: (htmlTemplate) =>
      Effect.sync(() =>
        server.middlewares.use((req, res, next) => {
          if (
            !req.url ||
            req.url.includes(".") ||
            req.method !== "GET" ||
            req.url.startsWith("/api/")
          ) {
            return next();
          }

          const requestUrl = req.url;
          const effect = Effect.gen(function* () {
            const html = yield* transformIndexHtml(requestUrl, htmlTemplate);
            res.statusCode = 200;
            res.setHeader("Content-Type", "text/html");
            res.end(html);
          }).pipe(Effect.catchCause(() => Effect.sync(() => next())));

          runPromise(effect).catch(() => undefined);
        }),
      ),
  };
};

const loadHandlerFactory: (viteServer: ViteServer) => Effect.Effect<HandlerFactory, ApiInitError> =
  Effect.fn("VitePlugin.loadHandlerFactory")(function* (viteServer: ViteServer) {
    // SSR-load handler factory — resolves @effect/platform from project root,
    // same module instance as user's api.ts, preventing Router.Live identity mismatches.
    const rawFactoryMod = yield* viteServer.loadModule(
      VIRTUAL_HANDLER_FACTORY_ID,
      "Failed to SSR-load handler factory",
    );
    if (
      typeof rawFactoryMod.makeApiLayer !== "function" ||
      typeof rawFactoryMod.makeWebHandler !== "function"
    ) {
      return yield* new ApiInitError({
        message: "Handler factory module missing required exports (makeApiLayer, makeWebHandler)",
      });
    }
    const makeApiLayer = rawFactoryMod.makeApiLayer;
    const makeWebHandler = rawFactoryMod.makeWebHandler;
    const baseFactoryMod: HandlerFactory = {
      makeApiLayer: (mod: Record<string, unknown>) => makeApiLayer(mod),
      makeWebHandler: (apiLive: Layer.Layer<unknown>) => makeWebHandler(apiLive),
    };
    if (typeof rawFactoryMod.makeNodeHandler !== "function") {
      return baseFactoryMod;
    }
    const makeNodeHandler = rawFactoryMod.makeNodeHandler;
    return {
      ...baseFactoryMod,
      makeNodeHandler: (apiLive: Layer.Layer<unknown>) => makeNodeHandler(apiLive),
    };
  });

/**
 * Memoize the dev API handler factory load for one plugin lifecycle.
 *
 * @remarks
 * The handler factory is framework-owned and stable; API reloads should reuse it
 * so Vite only reloads user API modules after bootstrap.
 *
 * @internal
 * @category Vite Plugin
 * @since 1.0.0
 */
export const makeStableHandlerFactoryLoader = (
  load: Effect.Effect<HandlerFactory, ApiInitError>,
): Effect.Effect<HandlerFactory, ApiInitError> => Effect.runSync(Effect.cached(load));

/**
 * Create trygg Vite plugin with platform-aware dev API.
 *
 * @remarks
 * `trygg` wires JSX transforms, generated entry modules, route types, and the
 * optional dev API bridge behind one Vite plugin instance.
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
 * @category Vite Plugin
 * @public
 * @since 1.0.0
 */
export const trygg = (tryggConfig?: TryggConfig): TryggPlugin => {
  const configPlatform = tryggConfig?.platform ?? "node";
  const output = tryggConfig?.output ?? "server";

  // Dev server always runs in Node.js (Vite), so use node platform for dev
  // regardless of config platform which is for production runtime
  const devPlatform = typeof Bun === "undefined" ? "node" : configPlatform;

  // Create platform-specific plugin layer for dev server
  const pluginLayer = makePluginLayer(devPlatform);
  const pluginRuntime = ManagedRuntime.make(
    Layer.mergeAll(
      pluginLayer,
      makeBootstrapLayer({
        appDirName: APP_DIR,
        generatedDirName: GENERATED_DIR,
        platform: configPlatform,
        output,
      }),
    ),
  );

  const plugin = {
    name: "trygg",
    enforce: "pre",

    // For static output, only apply to the client environment.
    // Multi-environment builds (e.g. alchemy's Cloudflare.Worker) create
    // an SSR environment whose rollupOptions.input must not be an HTML file.
    applyToEnvironment(environment: { readonly name: string }) {
      if (output === "static") return environment.name === "client";
      return true;
    },

    config(userConfig: unknown, env: { readonly command: string }) {
      /*
       * The SSR build environment receives this config from the plugin's config hook.
       * `applyToEnvironment` above prevents the plugin from running hooks in the SSR
       * environment, but the resolved config values (e.g. build.rollupOptions.input)
       * are already baked in during the shared resolution phase.  Because Vite will
       * fall back to `resolve("index.html")` whenever no input is present, and that
       * file likely doesn't exist in a typical trygg project, we avoid the fallback
       * by providing an explicit non-HTML input for SSR builds.  The value itself is
       * irrelevant since the Worker entry is produced by the Cloudflare plugin; this
       * merely silences Vite's HTML-in-SSR guard.
       */

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
            "effect/unstable/http",
            "effect/unstable/httpapi",
            "@effect/platform-node",
            "@effect/platform-bun",
            "@effect/platform-browser",
          ],
        },
        build: {
          outDir: output === "server" ? "dist/client" : "dist",
          rollupOptions:
            env.command === "build"
              ? {
                  input: `${GENERATED_DIR}/index.html`,
                  onwarn: makeRollupOnwarn(getUserRollupOnwarn(userConfig)),
                }
              : {},
        },
      };
    },

    configEnvironment(name: string, _config: unknown, env: { readonly command: string }) {
      if (env.command !== "build") return;
      if (name === "client") {
        return {
          build: {
            rollupOptions: { input: { index: `${GENERATED_DIR}/index.html` } },
          },
        };
      }
      if (configPlatform !== "cloudflare" || output !== "static") {
        return;
      }
      // For the SSR environment, provide a non-HTML file as input so Vite's
      // SSR guard does not trigger when Cloudflare runs a Worker build.
      return {
        build: {
          rollupOptions: { input: `${GENERATED_DIR}/worker-entry.js` },
        },
      };
    },

    async configResolved(resolvedConfig: ResolvedConfig) {
      await pluginRuntime.runPromise(
        Effect.flatMap(Bootstrap.asEffect(), (bootstrap) =>
          bootstrap.initialize(resolvedConfig).pipe(Effect.tapError(logFileSystemError)),
        ),
      );
    },

    async configureServer(server: ViteDevServer) {
      const viteServer = makeViteServer(server, (effect) => pluginRuntime.runPromise(effect));
      const effect = Effect.gen(function* () {
        const bootstrap = yield* Bootstrap;
        const { appDir, generatedDir } = yield* bootstrap.awaitReady;
        const paths = { appDir, generatedDir };
        const files = yield* PluginFiles;

        // Get DevPlatform service
        const devPlatform = yield* DevPlatform;

        const apiPath = files.appApiPath(paths);

        // Validate API imports
        yield* validateApiPlatform(apiPath, configPlatform).pipe(
          Effect.tapError(logApiValidationError),
        );

        yield* files.writeGeneratedRouteTypes(paths);
        yield* files.writeEntryFile(paths);
        yield* writeGeneratedApiClientTypes(appDir, generatedDir);

        yield* Effect.logInfo(`Generated files in ${GENERATED_DIR}/`).pipe(
          Effect.annotateLogs("style", "success"),
        );

        const stableHandlerFactory = makeStableHandlerFactoryLoader(loadHandlerFactory(viteServer));
        const apiState = yield* PluginApi.loadInitial({
          apiPath,
          hasApi: pathExists(apiPath),
          loadHandlerFactory: stableHandlerFactory,
          makeApi: (handlerFactory) =>
            devPlatform.makeApi({
              loadApiModule: () => viteServer.loadModule(apiPath, "Failed to load API module"),
              onError: (error) =>
                Effect.logError(`[api] middleware.error: ${Cause.pretty(Cause.fail(error))}`),
              handlerFactory,
            }),
        });

        const pluginApi = PluginApi.InitialState.$is("Ready")(apiState)
          ? makePluginApi(apiState.handle)
          : undefined;

        if (PluginApi.InitialState.$is("Ready")(apiState)) {
          yield* viteServer.closeApiScopeOnServerClose(apiState.scope);
          yield* Effect.logInfo("API handlers loaded").pipe(
            Effect.annotateLogs("style", "success"),
          );
          yield* Trace.emit("api.middleware.mounted", () => ({
            platform: configPlatform,
          }));
        }

        if (PluginApi.InitialState.$is("Failed")(apiState)) {
          return yield* apiState.error;
        }

        // Vite boundary: file watcher callbacks use extracted runtime
        yield* viteServer.onFileChange(async (file) => {
          await pluginRuntime.runPromise(
            Effect.scoped(
              Effect.gen(function* () {
                const isRoutesFile = yield* files.isRoutesFile(paths, file);
                if (isRoutesFile) {
                  yield* files.regenerateGeneratedRouteTypes(paths);
                }

                if (pluginApi !== undefined) {
                  yield* writeGeneratedApiClientTypes(appDir, generatedDir);
                  yield* pluginApi.reloadChangedFile(file);
                }
              }),
            ),
          );
        });

        if (pluginApi !== undefined) {
          yield* viteServer.mountApiMiddleware(pluginApi.middleware);
        }

        return () => {
          pluginRuntime
            .runPromise(viteServer.mountHtmlFallbackMiddleware(generateHtmlTemplate()))
            .catch(() => undefined);
        };
      });

      return await pluginRuntime.runPromise(effect);
    },

    configurePreviewServer(server: PreviewServerLike) {
      // `vite preview` is a static file server (sirv). When output is
      // "server", the production artifact is `dist/server.js` which handles
      // static files, API routes, and SPA fallback in one process. Warn
      // users that `vite preview` cannot serve API routes.
      if (output === "server") {
        const runtime = configPlatform === "bun" ? "bun" : "node";
        console.warn(
          `\n  trygg: output is "server" — use \`${runtime} dist/server.js\` for production preview with API support.` +
            "\n  `vite preview` serves static files only. API routes will 404.\n",
        );
      }

      // Pre-hook (no return): runs BEFORE sirv. Rewrites non-file GET
      // requests to the SPA shell so sirv serves `.trygg/index.html`.
      // /api/* routes are NOT rewritten — they 404 via sirv. For API
      // support in production, run `dist/server.js` instead.
      server.middlewares.use((req, _res, next) => {
        if (
          req.method === "GET" &&
          req.url &&
          !req.url.includes(".") &&
          !req.url.startsWith("/api/")
        ) {
          req.url = "/.trygg/index.html";
        }
        next();
      });
    },

    resolveId(id: string) {
      if (id === VIRTUAL_HANDLER_FACTORY_ID) {
        return RESOLVED_HANDLER_FACTORY_ID;
      }
      if (id === VIRTUAL_API_ID) {
        return RESOLVED_API_ID;
      }
      if (id === "trygg/jsx-runtime" || id === "trygg/jsx-dev-runtime") {
        return null;
      }
      return null;
    },

    async load(id: string) {
      if (id === RESOLVED_HANDLER_FACTORY_ID) {
        return devPlatform === "node"
          ? HandlerFactoryModule.makeNode()
          : HandlerFactoryModule.makeBun();
      }
      if (id === RESOLVED_API_ID) {
        return await pluginRuntime.runPromise(
          Effect.gen(function* () {
            const bootstrap = yield* Bootstrap;
            const { appDir } = yield* bootstrap.awaitReady;
            const apiPath = nodePath.join(appDir, "api.ts");
            yield* validateGeneratedApiClient(apiPath);
            return generateApiClientModule(apiPath);
          }),
        );
      }
      return null;
    },

    async transform(code: string, id: string) {
      const result = await pluginRuntime.runPromise(
        Effect.gen(function* () {
          const bootstrap = yield* Bootstrap;
          const { appDir, generatedDir, config } = yield* bootstrap.awaitReady;
          const files = yield* PluginFiles;
          const paths = { appDir, generatedDir };
          const isRoutesFile = yield* files.isRoutesFile(paths, id);

          let transformed = code;

          // Only transform the routes file in production builds
          if (isRoutesFile && config.command === "build") {
            transformed = yield* transformRoutesForBuild(transformed, id);
          }

          if (isTypeScriptJsxModule(id)) {
            const jsxResult = transformTryggJsxForRequirements(transformed, id);
            transformed = jsxResult.code;
          }

          return transformed;
        }),
      );
      return result !== code ? result : null;
    },

    async buildStart() {
      const effect = Effect.gen(function* () {
        const bootstrap = yield* Bootstrap;
        const { appDir, generatedDir, config } = yield* bootstrap.awaitReady;
        const buildOutput = yield* BuildOutput;

        yield* writeGeneratedApiClientTypes(appDir, generatedDir);

        yield* buildOutput.buildStart({
          appDir,
          generatedDir,
          config,
          output,
          platform: configPlatform,
        });
      });

      await pluginRuntime.runPromise(effect);
    },

    async closeBundle() {
      const effect = Effect.gen(function* () {
        const bootstrap = yield* Bootstrap;
        const { config, appDir, generatedDir } = yield* bootstrap.awaitReady;
        const buildOutput = yield* BuildOutput;

        yield* buildOutput.closeBundle({
          appDir,
          generatedDir,
          config,
          output,
          platform: configPlatform,
        });
      });

      await pluginRuntime.runPromise(effect);
    },
  };

  return plugin;
};

export default trygg;
