/**
 * @since 1.0.0
 * Vite plugin for effect-ui
 *
 * Configures Vite for effect-ui's JSX runtime and provides
 * an optimal development experience with helpful error messages.
 *
 * @example
 * ```ts
 * // vite.config.ts
 * import { defineConfig } from "vite"
 * import effectUI from "effect-ui/vite-plugin"
 *
 * export default defineConfig({
 *   plugins: [effectUI()]
 * })
 * ```
 *
 * @example
 * ```ts
 * // With file-based routing
 * import { defineConfig } from "vite"
 * import effectUI from "effect-ui/vite-plugin"
 *
 * export default defineConfig({
 *   plugins: [effectUI({ routes: "./src/routes" })]
 * })
 * ```
 */
import type { Plugin, ResolvedConfig } from "vite"
import * as fs from "fs"
import * as path from "path"

/**
 * Plugin options
 * @since 1.0.0
 */
export interface EffectUIPluginOptions {
  /**
   * Custom JSX import source path.
   * Defaults to "effect-ui" which uses the bundled jsx-runtime.
   */
  readonly jsxImportSource?: string

  /**
   * Suppress configuration warnings.
   * @default false
   */
  readonly silent?: boolean

  /**
   * Enable file-based routing.
   * Specify the directory containing route files (e.g., "./src/routes").
   * When enabled, generates the virtual module "virtual:effect-ui-routes".
   */
  readonly routes?: string
}

// Virtual module ID for routes
const VIRTUAL_ROUTES_ID = "virtual:effect-ui-routes"
const RESOLVED_VIRTUAL_ROUTES_ID = "\0" + VIRTUAL_ROUTES_ID

// ANSI colors for terminal output
const colors = {
  reset: "\x1b[0m",
  bold: "\x1b[1m",
  yellow: "\x1b[33m",
  cyan: "\x1b[36m",
  red: "\x1b[31m",
  green: "\x1b[32m",
  dim: "\x1b[2m"
}

/**
 * Log a warning message with effect-ui branding
 */
const warn = (message: string): void => {
  console.warn(
    `${colors.yellow}${colors.bold}[effect-ui]${colors.reset} ${colors.yellow}${message}${colors.reset}`
  )
}

/**
 * Log an info message with effect-ui branding
 */
const info = (message: string): void => {
  console.log(
    `${colors.cyan}${colors.bold}[effect-ui]${colors.reset} ${message}`
  )
}

/**
 * Route file info extracted from the file system
 * @internal - exported for testing
 */
export interface RouteFile {
  /** Absolute file path */
  readonly filePath: string
  /** Route path pattern (e.g., "/users/:id") */
  readonly routePath: string
  /** Whether this is a layout file */
  readonly isLayout: boolean
  /** Whether this is an index file */
  readonly isIndex: boolean
  /** Whether this is a loading file */
  readonly isLoading: boolean
  /** Whether this is an error file */
  readonly isError: boolean
}

/**
 * Scan routes directory and extract route files
 * @internal - exported for testing
 */
export const scanRoutes = (routesDir: string): RouteFile[] => {
  const routes: RouteFile[] = []
  
  const scanDir = (dir: string, parentPath: string = ""): void => {
    if (!fs.existsSync(dir)) {
      return
    }
    
    const entries = fs.readdirSync(dir, { withFileTypes: true })
    
    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name)
      
      if (entry.isDirectory()) {
        // Recurse into subdirectory
        // Convert [param] syntax in directory names to :param
        const dirName = entry.name
          .replace(/^\[\.\.\.(.+)\]$/, "*") // [...rest] -> *
          .replace(/^\[(.+)\]$/, ":$1")      // [param] -> :param
        const dirPath = parentPath + "/" + dirName
        scanDir(fullPath, dirPath)
      } else if (entry.isFile() && /\.(tsx|ts|jsx|js)$/.test(entry.name)) {
        // Process route file
        const basename = entry.name.replace(/\.(tsx|ts|jsx|js)$/, "")
        
        // Skip non-route special files except known ones
        const specialFiles = ["_layout", "_loading", "_error"]
        if (basename.startsWith("_") && !specialFiles.includes(basename)) {
          continue
        }
        
        const isLayout = basename === "_layout"
        const isLoading = basename === "_loading"
        const isError = basename === "_error"
        const isIndex = basename === "index"
        
        // Convert filename to route path
        let routePath: string
        if (isLayout || isLoading || isError) {
          routePath = parentPath || "/"
        } else if (isIndex) {
          routePath = parentPath || "/"
        } else {
          // Convert [param] to :param and [...rest] to *
          let segment = basename
            .replace(/^\[\.\.\.(.+)\]$/, "*") // [...rest] -> *
            .replace(/^\[(.+)\]$/, ":$1")      // [param] -> :param
          routePath = (parentPath || "") + "/" + segment
        }
        
        routes.push({
          filePath: fullPath,
          routePath,
          isLayout,
          isIndex,
          isLoading,
          isError
        })
      }
    }
  }
  
  scanDir(routesDir)
  return routes
}

/**
 * Generate the virtual module code for routes
 * @internal - exported for testing
 */
export const generateRoutesModule = (routes: RouteFile[], routesDir: string): string => {
  // Separate route types
  const pageRoutes = routes.filter(r => !r.isLayout && !r.isLoading && !r.isError)
  const layoutRoutes = routes.filter(r => r.isLayout)
  const loadingRoutes = routes.filter(r => r.isLoading)
  const errorRoutes = routes.filter(r => r.isError)
  
  // Sort routes by specificity (more specific first)
  pageRoutes.sort((a, b) => {
    // Static segments before dynamic
    const aScore = scoreRoutePath(a.routePath)
    const bScore = scoreRoutePath(b.routePath)
    return bScore - aScore
  })
  
  // Generate import paths relative to the routes directory
  const generateImportPath = (filePath: string): string => {
    // Use relative path from project root
    const relativePath = path.relative(path.dirname(routesDir), filePath)
    return "./" + relativePath.replace(/\\/g, "/")
  }
  
  // Helper to find matching special file (layout, loading, error)
  // Matches the most specific one (e.g., /settings/_loading.tsx for /settings/profile)
  const findSpecialFile = (routePath: string, specialFiles: RouteFile[]): RouteFile | undefined => {
    // Sort by path length descending to find most specific match first
    const sorted = [...specialFiles].sort((a, b) => b.routePath.length - a.routePath.length)
    
    return sorted.find(file => {
      // Root (/) matches all routes
      if (file.routePath === "/") {
        return true
      }
      // File at /foo matches /foo and /foo/*
      return routePath === file.routePath || 
             routePath.startsWith(file.routePath + "/")
    })
  }
  
  // Generate the routes array
  const routeEntries = pageRoutes.map(route => {
    const importPath = generateImportPath(route.filePath)
    
    // Find special files for this route
    const layout = findSpecialFile(route.routePath, layoutRoutes)
    const loading = findSpecialFile(route.routePath, loadingRoutes)
    const error = findSpecialFile(route.routePath, errorRoutes)
    
    let entry = `  {
    path: "${route.routePath}",
    component: () => import("${importPath}"),
    guard: () => import("${importPath}")`
    
    if (layout) {
      const layoutImportPath = generateImportPath(layout.filePath)
      entry += `,
    layout: () => import("${layoutImportPath}")`
    }
    
    if (loading) {
      const loadingImportPath = generateImportPath(loading.filePath)
      entry += `,
    loadingComponent: () => import("${loadingImportPath}")`
    }
    
    if (error) {
      const errorImportPath = generateImportPath(error.filePath)
      entry += `,
    errorComponent: () => import("${errorImportPath}")`
    }
    
    entry += `
  }`
    
    return entry
  })
  
  return `// Auto-generated by effect-ui vite plugin
// Routes from: ${routesDir}

export const routes = [
${routeEntries.join(",\n")}
];

export default routes;
`
}

/**
 * Extract param names from a route path
 * @internal - exported for testing
 */
export const extractParamNames = (routePath: string): string[] => {
  const params: string[] = []
  const segments = routePath.split("/").filter(Boolean)
  
  for (const segment of segments) {
    if (segment.startsWith(":")) {
      params.push(segment.slice(1))
    }
  }
  
  return params
}

/**
 * Generate TypeScript type declaration for route params
 * @internal - exported for testing
 */
export const generateParamType = (routePath: string): string => {
  const params = extractParamNames(routePath)
  if (params.length === 0) {
    return "{}"
  }
  return `{ ${params.map(p => `readonly ${p}: string`).join("; ")} }`
}

/**
 * Generate type declarations file for routes
 * This creates a .d.ts file that augments RouteMap with actual routes
 * @internal - exported for testing
 */
export const generateRouteTypes = (routes: RouteFile[]): string => {
  const pageRoutes = routes.filter(r => !r.isLayout && !r.isLoading && !r.isError)
  
  // Generate RouteMap entries
  const mapEntries = pageRoutes.map(route => {
    const paramType = generateParamType(route.routePath)
    return `    readonly "${route.routePath}": ${paramType}`
  })
  
  return `// Auto-generated by effect-ui vite plugin
// DO NOT EDIT - This file is regenerated when routes change

// Augment the RouteMap interface with actual routes for type-safe navigation
declare module "effect-ui/router" {
  interface RouteMap {
${mapEntries.join("\n")}
  }
}

export {}
`
}

/**
 * Score a route path for sorting (higher = more specific)
 * @internal - exported for testing
 */
export const scoreRoutePath = (routePath: string): number => {
  const segments = routePath.split("/").filter(Boolean)
  let score = 0
  
  for (const segment of segments) {
    if (segment === "*") {
      score += 1  // Wildcard least specific
    } else if (segment.startsWith(":")) {
      score += 2  // Dynamic param
    } else {
      score += 3  // Static segment most specific
    }
  }
  
  // Longer routes generally more specific
  score += segments.length * 0.1
  
  return score
}

/**
 * Vite plugin for effect-ui
 *
 * Automatically configures:
 * - JSX runtime to use effect-ui's jsx-runtime
 * - esbuild settings for optimal JSX compilation
 * - TypeScript JSX support
 * - File-based routing (optional)
 *
 * Also provides:
 * - Configuration validation with helpful error messages
 * - Detection of common misconfigurations
 * - Warnings for conflicting JSX settings
 * - Hot reload for route changes
 *
 * @example
 * ```ts
 * // vite.config.ts
 * import { defineConfig } from "vite"
 * import effectUI from "effect-ui/vite-plugin"
 *
 * export default defineConfig({
 *   plugins: [effectUI()]
 * })
 * ```
 *
 * @example
 * ```ts
 * // With file-based routing
 * import { defineConfig } from "vite"
 * import effectUI from "effect-ui/vite-plugin"
 *
 * export default defineConfig({
 *   plugins: [effectUI({ routes: "./src/routes" })]
 * })
 * ```
 *
 * @since 1.0.0
 */
export const effectUI = (options: EffectUIPluginOptions = {}): Plugin => {
  const jsxImportSource = options.jsxImportSource ?? "effect-ui"
  const silent = options.silent ?? false
  
  let resolvedRoutesDir: string | null = null
  let projectRoot: string = process.cwd()

  return {
    name: "vite-plugin-effect-ui",

    config(_config, { command }) {
      // Only include effect-ui in optimizeDeps for production builds
      // In dev with aliases (like examples), the user should exclude it themselves
      const base = {
        esbuild: {
          jsx: "automatic" as const,
          jsxImportSource
        }
      }
      
      // For build command, include effect for pre-bundling optimization
      if (command === "build") {
        return {
          ...base,
          optimizeDeps: {
            include: ["effect"]
          }
        }
      }
      
      return base
    },

    configResolved(config: ResolvedConfig) {
      projectRoot = config.root
      
      // Resolve routes directory if specified
      if (options.routes) {
        resolvedRoutesDir = path.resolve(projectRoot, options.routes)
        
        if (!fs.existsSync(resolvedRoutesDir)) {
          warn(`Routes directory not found: ${resolvedRoutesDir}`)
          resolvedRoutesDir = null
        } else {
          const routes = scanRoutes(resolvedRoutesDir)
          
          // Generate type declarations file
          const typesContent = generateRouteTypes(routes)
          const typesPath = path.resolve(projectRoot, "routes.d.ts")
          fs.writeFileSync(typesPath, typesContent)
          
          if (!silent) {
            info(`${colors.green}File-based routing enabled${colors.reset}`)
            info(`  Routes directory: ${options.routes}`)
            info(`  Found ${routes.length} route(s)`)
            info(`  ${colors.green}Generated routes.d.ts${colors.reset}`)
            routes.forEach(r => {
              const type = r.isLayout ? " (layout)" : r.isIndex ? " (index)" : ""
              info(`    ${colors.dim}${r.routePath}${type}${colors.reset}`)
            })
          }
        }
      }
      
      if (silent) return

      // Check for conflicting React plugins
      const hasReactPlugin = config.plugins.some(
        (p) => p.name.includes("react") || p.name.includes("preact")
      )
      if (hasReactPlugin) {
        warn(
          "Detected React/Preact plugin alongside effect-ui. " +
          "This may cause JSX conflicts. If you see errors, remove the React plugin."
        )
      }

      // Check esbuild JSX configuration
      const esbuildJsx = config.esbuild
      if (esbuildJsx && typeof esbuildJsx === "object") {
        const jsxConfig = esbuildJsx as { jsx?: string; jsxImportSource?: string; jsxFactory?: string }
        
        // Warn if using classic JSX mode
        if (jsxConfig.jsx === "transform" || jsxConfig.jsxFactory) {
          warn(
            "Detected classic JSX mode. effect-ui requires automatic JSX runtime. " +
            "Remove jsxFactory/jsxFragmentFactory from your config."
          )
        }

        // Warn if jsxImportSource is overridden to something unexpected
        if (jsxConfig.jsxImportSource && 
            jsxConfig.jsxImportSource !== "effect-ui" && 
            jsxConfig.jsxImportSource !== jsxImportSource) {
          warn(
            `jsxImportSource is set to "${jsxConfig.jsxImportSource}" but effect-ui expects "effect-ui". ` +
            `JSX may not work correctly.`
          )
        }
      }

      // Log successful configuration in dev mode
      if (config.command === "serve" && !options.routes) {
        info(`JSX configured with jsxImportSource: "${jsxImportSource}"`)
      }
    },

    configureServer(devServer) {
      // Watch routes directory for changes
      if (resolvedRoutesDir) {
        devServer.watcher.add(resolvedRoutesDir)
        
        const regenerateRoutes = () => {
          // Regenerate types file
          const routes = scanRoutes(resolvedRoutesDir!)
          const typesContent = generateRouteTypes(routes)
          const typesPath = path.resolve(projectRoot, "routes.d.ts")
          fs.writeFileSync(typesPath, typesContent)
          
          // Invalidate virtual module
          const module = devServer.moduleGraph.getModuleById(RESOLVED_VIRTUAL_ROUTES_ID)
          if (module) {
            devServer.moduleGraph.invalidateModule(module)
            devServer.ws.send({ type: "full-reload" })
          }
        }
        
        devServer.watcher.on("add", (file) => {
          if (file.startsWith(resolvedRoutesDir!) && /\.(tsx|ts|jsx|js)$/.test(file)) {
            if (!silent) info(`Route added: ${path.relative(resolvedRoutesDir!, file)}`)
            regenerateRoutes()
          }
        })
        
        devServer.watcher.on("unlink", (file) => {
          if (file.startsWith(resolvedRoutesDir!) && /\.(tsx|ts|jsx|js)$/.test(file)) {
            if (!silent) info(`Route removed: ${path.relative(resolvedRoutesDir!, file)}`)
            regenerateRoutes()
          }
        })
      }
    },

    resolveId(id) {
      // Handle virtual routes module
      if (id === VIRTUAL_ROUTES_ID) {
        if (!resolvedRoutesDir) {
          throw new Error(
            `Cannot import "${VIRTUAL_ROUTES_ID}" - routes option not configured. ` +
            `Add { routes: "./src/routes" } to the effectUI plugin options.`
          )
        }
        return RESOLVED_VIRTUAL_ROUTES_ID
      }
      
      // Handle effect-ui/jsx-runtime and effect-ui/jsx-dev-runtime
      if (id === "effect-ui/jsx-runtime" || id === "effect-ui/jsx-dev-runtime") {
        // Let Vite resolve these normally from node_modules
        return null
      }
      return null
    },

    load(id) {
      // Generate routes virtual module
      if (id === RESOLVED_VIRTUAL_ROUTES_ID && resolvedRoutesDir) {
        const routes = scanRoutes(resolvedRoutesDir)
        return generateRoutesModule(routes, resolvedRoutesDir)
      }
      return null
    },

    // Provide helpful error overlay for common issues
    transform(code, id) {
      // Only process TSX/JSX files
      if (!id.endsWith(".tsx") && !id.endsWith(".jsx")) {
        return null
      }

      // Check for common mistakes in user code (dev mode only)
      if (process.env.NODE_ENV !== "production" && !silent) {
        // Detect React imports that might conflict
        if (code.includes("from 'react'") || code.includes('from "react"')) {
          warn(
            `${id.split("/").pop()}: Detected React import. ` +
            "effect-ui has its own JSX runtime - React imports are not needed."
          )
        }

        // Detect createElement usage (classic JSX)
        if (code.includes("React.createElement") || code.includes("createElement(")) {
          warn(
            `${id.split("/").pop()}: Detected createElement usage. ` +
            "effect-ui uses automatic JSX transform - use JSX syntax instead."
          )
        }
      }

      return null
    }
  }
}

// Default export for convenient usage
export default effectUI
