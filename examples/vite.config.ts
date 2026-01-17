import { defineConfig } from "vite"
import path from "path"

const src = path.resolve(__dirname, "../src")

export default defineConfig({
  root: __dirname,
  server: {
    fs: {
      // Allow serving files from the parent src directory
      allow: [__dirname, src]
    }
  },
  resolve: {
    alias: [
      // JSX runtime aliases - must come before effect-ui
      { find: "effect-ui/jsx-runtime", replacement: path.join(src, "jsx-runtime.ts") },
      { find: "effect-ui/jsx-dev-runtime", replacement: path.join(src, "jsx-dev-runtime.ts") },
      // Main effect-ui alias
      { find: "effect-ui", replacement: path.join(src, "index.ts") }
    ]
  },
  esbuild: {
    jsx: "automatic",
    jsxImportSource: "effect-ui"
  },
  optimizeDeps: {
    exclude: ["effect-ui"]
  }
})
