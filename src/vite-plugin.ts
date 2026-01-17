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
 */
import type { Plugin, ResolvedConfig } from "vite"

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
}

// ANSI colors for terminal output
const colors = {
  reset: "\x1b[0m",
  bold: "\x1b[1m",
  yellow: "\x1b[33m",
  cyan: "\x1b[36m",
  red: "\x1b[31m",
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
 * Vite plugin for effect-ui
 *
 * Automatically configures:
 * - JSX runtime to use effect-ui's jsx-runtime
 * - esbuild settings for optimal JSX compilation
 * - TypeScript JSX support
 *
 * Also provides:
 * - Configuration validation with helpful error messages
 * - Detection of common misconfigurations
 * - Warnings for conflicting JSX settings
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
 * @since 1.0.0
 */
export const effectUI = (options: EffectUIPluginOptions = {}): Plugin => {
  const jsxImportSource = options.jsxImportSource ?? "effect-ui"
  const silent = options.silent ?? false

  return {
    name: "vite-plugin-effect-ui",

    config() {
      return {
        esbuild: {
          jsx: "automatic",
          jsxImportSource
        },
        optimizeDeps: {
          // Include effect-ui and effect for pre-bundling
          include: ["effect-ui", "effect"]
        }
      }
    },

    configResolved(config: ResolvedConfig) {
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
      if (config.command === "serve") {
        info(`JSX configured with jsxImportSource: "${jsxImportSource}"`)
      }
    },

    // Provide virtual module for jsx-runtime if using default source
    resolveId(id) {
      // Handle effect-ui/jsx-runtime and effect-ui/jsx-dev-runtime
      if (id === "effect-ui/jsx-runtime" || id === "effect-ui/jsx-dev-runtime") {
        // Let Vite resolve these normally from node_modules
        return null
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
