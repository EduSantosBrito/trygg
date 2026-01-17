/**
 * @since 1.0.0
 * Vite plugin for effect-ui
 *
 * Configures Vite for effect-ui's JSX runtime and provides
 * an optimal development experience.
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
import type { Plugin } from "vite"

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
}

/**
 * Vite plugin for effect-ui
 *
 * Automatically configures:
 * - JSX runtime to use effect-ui's jsx-runtime
 * - esbuild settings for optimal JSX compilation
 * - TypeScript JSX support
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

    // Provide virtual module for jsx-runtime if using default source
    resolveId(id) {
      // Handle effect-ui/jsx-runtime and effect-ui/jsx-dev-runtime
      if (id === "effect-ui/jsx-runtime" || id === "effect-ui/jsx-dev-runtime") {
        // Let Vite resolve these normally from node_modules
        return null
      }
      return null
    }
  }
}

// Default export for convenient usage
export default effectUI
