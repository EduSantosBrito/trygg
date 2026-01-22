/**
 * @since 1.0.0
 * Vite plugin for effect-ui
 *
 * Configures Vite for effect-ui's JSX runtime and provides
 * file-based routing with automatic layout support.
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
 *
 * ## App Structure
 *
 * ```
 * app/
 *   api.ts              ← Single API file (exports Api, ApiLive)
 *   layout.tsx          ← Root layout (includes <html>, wraps all routes)
 *   routes/
 *     index.tsx         ← /
 *     users/
 *       index.tsx       ← /users
 *       [id].tsx        ← /users/:id
 *       layout.tsx      ← Nested layout for /users/*
 *     _loading.tsx      ← Loading fallback
 *     _error.tsx        ← Error boundary
 * .effect-ui/           ← Generated (add to .gitignore)
 *   client.ts           ← API client + Resources
 *   routes.d.ts         ← Route type declarations
 *   api.d.ts            ← API type declarations
 *   entry.tsx           ← Auto-generated entry point
 * ```
 */
import type { Plugin, ResolvedConfig, ViteDevServer } from "vite";
import * as fs from "fs";
import * as path from "path";
import { type ApiMiddleware, createApiMiddleware } from "./api-middleware.js";

// =============================================================================
// Constants
// =============================================================================

const APP_DIR = "app";
const GENERATED_DIR = ".effect-ui";

// Virtual module IDs
const VIRTUAL_ROUTES_ID = "virtual:effect-ui/routes";
const RESOLVED_VIRTUAL_ROUTES_ID = "\0" + VIRTUAL_ROUTES_ID;
const VIRTUAL_CLIENT_ID = "virtual:effect-ui/client";
const RESOLVED_VIRTUAL_CLIENT_ID = "\0" + VIRTUAL_CLIENT_ID;

// =============================================================================
// Types
// =============================================================================

/**
 * Route file info extracted from the file system
 * @internal
 */
export interface RouteFile {
  /** Absolute file path */
  readonly filePath: string;
  /** Route path pattern (e.g., "/users/:id") */
  readonly routePath: string;
  /** Type of route file */
  readonly type: "page" | "layout" | "loading" | "error";
  /** Depth in route hierarchy (for sorting) */
  readonly depth: number;
}

/**
 * Validation error
 * @internal
 */
export interface ValidationError {
  readonly type: "missing_file" | "missing_export" | "route_conflict" | "invalid_structure";
  readonly message: string;
  readonly file?: string;
  readonly details?: string;
}

// =============================================================================
// Logging
// =============================================================================

const colors = {
  reset: "\x1b[0m",
  bold: "\x1b[1m",
  yellow: "\x1b[33m",
  cyan: "\x1b[36m",
  red: "\x1b[31m",
  green: "\x1b[32m",
  dim: "\x1b[2m",
};

const log = {
  info: (message: string): void => {
    console.log(`${colors.cyan}${colors.bold}[effect-ui]${colors.reset} ${message}`);
  },
  success: (message: string): void => {
    console.log(
      `${colors.cyan}${colors.bold}[effect-ui]${colors.reset} ${colors.green}${message}${colors.reset}`,
    );
  },
  warn: (message: string): void => {
    console.warn(
      `${colors.yellow}${colors.bold}[effect-ui]${colors.reset} ${colors.yellow}${message}${colors.reset}`,
    );
  },
  error: (message: string): void => {
    console.error(
      `${colors.red}${colors.bold}[effect-ui]${colors.reset} ${colors.red}${message}${colors.reset}`,
    );
  },
  dim: (message: string): void => {
    console.log(
      `${colors.cyan}${colors.bold}[effect-ui]${colors.reset} ${colors.dim}${message}${colors.reset}`,
    );
  },
};

// =============================================================================
// File System Scanning
// =============================================================================

/**
 * Scan routes directory and extract route files
 * @internal
 */
export const scanRoutes = (routesDir: string): RouteFile[] => {
  const routes: RouteFile[] = [];

  const scanDir = (dir: string, parentPath: string = "", depth: number = 0): void => {
    if (!fs.existsSync(dir)) {
      return;
    }

    const entries = fs.readdirSync(dir, { withFileTypes: true });

    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);

      if (entry.isDirectory()) {
        // Convert [param] syntax in directory names to :param
        const dirName = entry.name
          .replace(/^\[\.\.\.(.+)\]$/, "*") // [...rest] -> *
          .replace(/^\[(.+)\]$/, ":$1"); // [param] -> :param
        const dirPath = parentPath + "/" + dirName;
        scanDir(fullPath, dirPath, depth + 1);
      } else if (entry.isFile() && /\.(tsx|ts|jsx|js)$/.test(entry.name)) {
        const basename = entry.name.replace(/\.(tsx|ts|jsx|js)$/, "");

        // Determine file type
        let type: RouteFile["type"];
        let routePath: string;

        if (basename === "layout" || basename === "_layout") {
          type = "layout";
          routePath = parentPath || "/";
        } else if (basename === "_loading") {
          type = "loading";
          routePath = parentPath || "/";
        } else if (basename === "_error") {
          type = "error";
          routePath = parentPath || "/";
        } else if (basename === "index") {
          type = "page";
          routePath = parentPath || "/";
        } else if (basename.startsWith("_")) {
          // Skip other underscore-prefixed files
          continue;
        } else {
          type = "page";
          // Convert [param] to :param and [...rest] to *
          const segment = basename.replace(/^\[\.\.\.(.+)\]$/, "*").replace(/^\[(.+)\]$/, ":$1");
          routePath = (parentPath || "") + "/" + segment;
        }

        routes.push({
          filePath: fullPath,
          routePath,
          type,
          depth,
        });
      }
    }
  };

  scanDir(routesDir);
  return routes;
};

/**
 * Extract param names from a route path
 * @internal
 */
export const extractParamNames = (routePath: string): string[] => {
  const params: string[] = [];
  const segments = routePath.split("/").filter(Boolean);

  for (const segment of segments) {
    if (segment.startsWith(":")) {
      params.push(segment.slice(1));
    }
  }

  return params;
};

/**
 * Generate TypeScript type for route params
 * @internal
 */
export const generateParamType = (routePath: string): string => {
  const params = extractParamNames(routePath);
  if (params.length === 0) {
    return "{}";
  }
  return `{ ${params.map((p) => `readonly ${p}: string`).join("; ")} }`;
};

// =============================================================================
// Validation
// =============================================================================

/**
 * Validate app structure
 * @internal
 */
export const validateAppStructure = (appDir: string): ValidationError[] => {
  const errors: ValidationError[] = [];

  // Check app/layout.tsx exists
  const layoutPath = path.join(appDir, "layout.tsx");
  const layoutPathTs = path.join(appDir, "layout.ts");
  if (!fs.existsSync(layoutPath) && !fs.existsSync(layoutPathTs)) {
    errors.push({
      type: "missing_file",
      message: "Root layout is required",
      file: layoutPath,
      details:
        "Create app/layout.tsx with your root layout component (including <html> and <body>)",
    });
  }

  // Check app/routes exists
  const routesDir = path.join(appDir, "routes");
  if (!fs.existsSync(routesDir)) {
    errors.push({
      type: "missing_file",
      message: "Routes directory is required",
      file: routesDir,
      details: "Create app/routes/ directory with your page components",
    });
  }

  return errors;
};

/**
 * Validate API exports
 * @internal
 */
export const validateApiExports = async (
  apiPath: string,
  loadModule: (path: string) => Promise<Record<string, unknown>>,
): Promise<ValidationError[]> => {
  const errors: ValidationError[] = [];

  if (!fs.existsSync(apiPath)) {
    // API is optional
    return errors;
  }

  try {
    const module = await loadModule(apiPath);

    if (!module.Api && !module.api) {
      errors.push({
        type: "missing_export",
        message: "app/api.ts must export 'Api' (HttpApi class)",
        file: apiPath,
        details: "Add: export class Api extends HttpApi.make('app').add(...) {}",
      });
    }

    if (!module.ApiLive) {
      errors.push({
        type: "missing_export",
        message: "app/api.ts must export 'ApiLive' (combined handler layer)",
        file: apiPath,
        details:
          "Add: export const ApiLive = HttpApiBuilder.api(Api).pipe(Layer.provide([...handlers]))",
      });
    }
  } catch (err) {
    errors.push({
      type: "invalid_structure",
      message: `Failed to load API module: ${err instanceof Error ? err.message : String(err)}`,
      file: apiPath,
    });
  }

  return errors;
};

/**
 * Check for route/API conflicts
 * @internal
 */
export const checkRouteApiConflicts = async (
  routes: RouteFile[],
  apiPath: string,
  loadModule: (path: string) => Promise<Record<string, unknown>>,
): Promise<ValidationError[]> => {
  const errors: ValidationError[] = [];

  if (!fs.existsSync(apiPath)) {
    return errors;
  }

  try {
    const module = await loadModule(apiPath);
    const api = module.Api || module.api;

    if (!api || typeof api !== "function") {
      return errors;
    }

    // Extract API paths from the HttpApi
    // This is a simplified check - we look at the groups and their prefixes
    const apiInstance = api as {
      groups?: Record<string, { endpoints?: Record<string, { path?: string }> }>;
    };

    if (apiInstance.groups) {
      const apiPaths = new Set<string>();

      for (const group of Object.values(apiInstance.groups)) {
        if (group.endpoints) {
          for (const endpoint of Object.values(group.endpoints)) {
            if (endpoint.path) {
              // Normalize path for comparison
              const normalizedPath = endpoint.path.replace(/:\w+/g, ":param");
              apiPaths.add(normalizedPath);
            }
          }
        }
      }

      // Check for conflicts with page routes
      for (const route of routes) {
        if (route.type !== "page") continue;

        const normalizedRoutePath = route.routePath.replace(/:\w+/g, ":param");
        if (apiPaths.has(normalizedRoutePath)) {
          errors.push({
            type: "route_conflict",
            message: `Route conflict: ${route.routePath}`,
            file: route.filePath,
            details: `This path is defined both as a page route and an API endpoint`,
          });
        }
      }
    }
  } catch {
    // Ignore errors here - API validation handles them
  }

  return errors;
};

// =============================================================================
// Code Generation
// =============================================================================

/**
 * Generate import path for a file
 * @internal
 */
const generateImportPath = (filePath: string): string => {
  return filePath.replace(/\\/g, "/");
};

/**
 * Generate routes module
 * @internal
 */
export const generateRoutesModule = (routes: RouteFile[], routesDir: string): string => {
  const pageRoutes = routes.filter((r) => r.type === "page");
  const layoutRoutes = routes.filter((r) => r.type === "layout");
  const loadingRoutes = routes.filter((r) => r.type === "loading");
  const errorRoutes = routes.filter((r) => r.type === "error");

  // Find the most specific special file for a route
  const findSpecialFile = (
    routePath: string,
    specialRoutes: RouteFile[],
  ): RouteFile | undefined => {
    // Sort by depth descending to find most specific first
    const sorted = [...specialRoutes].sort((a, b) => b.depth - a.depth);

    for (const special of sorted) {
      // Root layout/loading/error matches all routes
      if (special.routePath === "/") {
        return special;
      }
      if (routePath === special.routePath || routePath.startsWith(special.routePath + "/")) {
        return special;
      }
    }
    return undefined;
  };

  const routeEntries = pageRoutes.map((route) => {
    const importPath = generateImportPath(route.filePath);
    const layout = findSpecialFile(route.routePath, layoutRoutes);
    const loading = findSpecialFile(route.routePath, loadingRoutes);
    const error = findSpecialFile(route.routePath, errorRoutes);

    let entry = `  {
    path: "${route.routePath}",
    component: () => import("${importPath}")`;

    if (layout) {
      entry += `,
    layout: () => import("${generateImportPath(layout.filePath)}")`;
    }

    if (loading) {
      entry += `,
    loadingComponent: () => import("${generateImportPath(loading.filePath)}")`;
    }

    if (error) {
      entry += `,
    errorComponent: () => import("${generateImportPath(error.filePath)}")`;
    }

    entry += `
  }`;
    return entry;
  });

  return `// Auto-generated by effect-ui
// Routes from: ${routesDir}

export const routes = [
${routeEntries.join(",\n")}
];

export default routes;
`;
};

/**
 * Generate route type declarations
 * @internal
 */
export const generateRouteTypes = (routes: RouteFile[]): string => {
  const pageRoutes = routes.filter((r) => r.type === "page");

  const mapEntries = pageRoutes.map((route) => {
    const paramType = generateParamType(route.routePath);
    return `    readonly "${route.routePath}": ${paramType}`;
  });

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
${mapEntries.join("\n")}
  }
}

export {}
`;
};

/**
 * Generate API type declarations
 * @internal
 */
export const generateApiTypes = (appDir: string): string => {
  const apiPath = path.join(appDir, "api.ts");
  const hasApi = fs.existsSync(apiPath);

  if (!hasApi) {
    return `// Auto-generated by effect-ui
// No API file found at app/api.ts

declare module "virtual:effect-ui/client" {
  export const client: never
  export const resources: never
}

export {}
`;
  }

  const relativePath =
    "./" + path.relative(path.dirname(apiPath), apiPath).replace(/\\/g, "/").replace(/\.ts$/, "");

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
`;
};

/**
 * Generate client module
 * @internal
 */
export const generateClientModule = (appDir: string): string => {
  const apiPath = path.join(appDir, "api.ts");
  const hasApi = fs.existsSync(apiPath);

  if (!hasApi) {
    return `// Auto-generated by effect-ui
// No API file found

export const client = undefined;
export const resources = {};
`;
  }

  const importPath = generateImportPath(apiPath);

  return `// Auto-generated by effect-ui
import { HttpApiClient } from "@effect/platform";
import { Api } from "${importPath}";

export const client = HttpApiClient.make(Api, { baseUrl: "" });

// TODO: Generate typed resources with cache keys
export const resources = {};
`;
};

/**
 * Generate entry module (physical file)
 * @internal
 */
export const generateEntryModule = (appDir: string, generatedDir: string): string => {
  // Use relative path from .effect-ui/ to app/
  const relativeAppDir = path.relative(generatedDir, appDir).replace(/\\/g, "/");

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
`;
};

/**
 * Generate HTML template (replaces index.html)
 * @internal
 */
export const generateHtmlTemplate = (generatedDir: string): string => {
  const entryPath = path
    .relative(process.cwd(), path.join(generatedDir, "entry.tsx"))
    .replace(/\\/g, "/");
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
</html>`;
};

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
 * @since 1.0.0
 */
export const effectUI = (): Plugin => {
  let config: ResolvedConfig;
  let appDir: string;
  let routesDir: string;
  let generatedDir: string;

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
      };
    },

    configResolved(resolvedConfig) {
      config = resolvedConfig;
      appDir = path.resolve(config.root, APP_DIR);
      routesDir = path.join(appDir, "routes");
      generatedDir = path.resolve(config.root, GENERATED_DIR);

      // Ensure generated directory exists
      if (!fs.existsSync(generatedDir)) {
        fs.mkdirSync(generatedDir, { recursive: true });
      }

      // Log configuration
      log.info("effect-ui configured");
      log.dim(`  App directory: ${appDir}`);
      log.dim(`  Routes directory: ${routesDir}`);
      log.dim(`  Generated directory: ${generatedDir}`);
    },

    async configureServer(server: ViteDevServer) {
      // Validate app structure on startup
      const structureErrors = validateAppStructure(appDir);
      for (const error of structureErrors) {
        log.error(`${error.message}`);
        if (error.details) {
          log.dim(`  ${error.details}`);
        }
      }

      if (structureErrors.length > 0) {
        log.warn("Fix the above errors to continue");
      }

      // Generate type files and entry
      const routes = fs.existsSync(routesDir) ? scanRoutes(routesDir) : [];

      // Write routes.d.ts
      const routeTypesPath = path.join(generatedDir, "routes.d.ts");
      fs.writeFileSync(routeTypesPath, generateRouteTypes(routes));

      // Write api.d.ts
      const apiTypesPath = path.join(generatedDir, "api.d.ts");
      fs.writeFileSync(apiTypesPath, generateApiTypes(appDir));

      // Write entry.tsx (auto-generated app entry point)
      const entryPath = path.join(generatedDir, "entry.tsx");
      fs.writeFileSync(entryPath, generateEntryModule(appDir, generatedDir));

      log.success(`Generated files in ${GENERATED_DIR}/`);

      // Initialize API middleware if api.ts exists
      const apiPath = path.join(appDir, "api.ts");
      let apiMiddleware: ApiMiddleware | null = null;

      if (fs.existsSync(apiPath)) {
        const serverPort = server.config.server.port ?? 5173;
        apiMiddleware = await createApiMiddleware({
          loadApiModule: async () => {
            // Use Vite's SSR module loader for HMR support
            const mod = await server.ssrLoadModule(apiPath);
            if (!mod.ApiLive) {
              throw new Error("api.ts must export ApiLive");
            }
            return mod as { ApiLive: never };
          },
          onError: (error) => {
            log.error("API handler error:");
            console.error(error);
          },
          baseUrl: `http://localhost:${serverPort}`,
        });
        log.success("API handlers loaded");
      }

      // Watch for changes
      server.watcher.on("change", async (file) => {
        if (file.startsWith(routesDir)) {
          const routes = scanRoutes(routesDir);
          fs.writeFileSync(routeTypesPath, generateRouteTypes(routes));
          log.dim("Regenerated routes.d.ts");
        }
        if (file.endsWith("api.ts")) {
          fs.writeFileSync(apiTypesPath, generateApiTypes(appDir));
          log.dim("Regenerated api.d.ts");

          // Reload API handlers
          if (apiMiddleware) {
            await apiMiddleware.reload();
            log.dim("Reloaded API handlers");
          }
        }
      });

      // Add file creation handler
      server.watcher.on("add", (file) => {
        if (file.startsWith(routesDir)) {
          const routes = scanRoutes(routesDir);
          fs.writeFileSync(routeTypesPath, generateRouteTypes(routes));
          log.dim("Regenerated routes.d.ts");
        }
      });

      // Cleanup on server close
      server.httpServer?.on("close", () => {
        apiMiddleware?.dispose();
      });

      // Add API middleware BEFORE Vite's internal middleware
      // This ensures /api/* requests are handled before Vite serves HTML
      if (apiMiddleware) {
        server.middlewares.use(apiMiddleware.middleware);
      }

      // Return post hook - runs after Vite's internal middleware
      return () => {
        // SPA fallback - serve HTML for all non-asset routes
        server.middlewares.use((req, res, next) => {
          if (req.url && !req.url.includes(".") && req.method === "GET") {
            // Let Vite handle transforming our virtual HTML
            req.url = "/index.html";
          }
          next();
        });
      };
    },

    resolveId(id) {
      if (id === VIRTUAL_ROUTES_ID) {
        return RESOLVED_VIRTUAL_ROUTES_ID;
      }
      if (id === VIRTUAL_CLIENT_ID) {
        return RESOLVED_VIRTUAL_CLIENT_ID;
      }
      // Handle jsx-runtime
      if (id === "effect-ui/jsx-runtime" || id === "effect-ui/jsx-dev-runtime") {
        return null; // Let Vite resolve from node_modules
      }
      return null;
    },

    load(id) {
      if (id === RESOLVED_VIRTUAL_ROUTES_ID) {
        const routes = fs.existsSync(routesDir) ? scanRoutes(routesDir) : [];
        return generateRoutesModule(routes, routesDir);
      }
      if (id === RESOLVED_VIRTUAL_CLIENT_ID) {
        return generateClientModule(appDir);
      }
      return null;
    },

    // Provide fallback index.html
    buildStart() {
      // Generate entry.tsx if needed
      const entryPath = path.join(generatedDir, "entry.tsx");
      if (!fs.existsSync(entryPath)) {
        fs.writeFileSync(entryPath, generateEntryModule(appDir, generatedDir));
      }

      // Generate index.html if it doesn't exist
      const indexPath = path.join(config.root, "index.html");
      if (!fs.existsSync(indexPath)) {
        fs.writeFileSync(indexPath, generateHtmlTemplate(generatedDir));
        log.success("Generated index.html");
      }
    },

    // Validate on build
    async buildEnd() {
      // Validate app structure
      const structureErrors = validateAppStructure(appDir);
      if (structureErrors.length > 0) {
        for (const error of structureErrors) {
          log.error(`${error.message}`);
          if (error.details) {
            log.dim(`  ${error.details}`);
          }
        }
        throw new Error("Build failed due to app structure errors");
      }
    },
  };
};

// Default export
export default effectUI;
