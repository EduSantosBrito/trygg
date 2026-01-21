import { defineConfig } from "vite";
import path from "path";
import effectUI from "../../packages/core/src/vite-plugin.js";

const src = path.resolve(__dirname, "../../packages/core/src");

export default defineConfig({
  root: __dirname,
  server: {
    fs: {
      // Allow serving files from the core src directory
      allow: [__dirname, src],
    },
  },
  plugins: [
    effectUI({
      // Enable file-based routing - routes directory at apps/examples/routes
      routes: "./routes",
      // Remove silent mode to see routing output
    }),
  ],
  resolve: {
    alias: [
      // JSX runtime aliases - must come before effect-ui
      { find: "effect-ui/jsx-runtime", replacement: path.join(src, "jsx-runtime.ts") },
      { find: "effect-ui/jsx-dev-runtime", replacement: path.join(src, "jsx-dev-runtime.ts") },
      // Router module alias
      { find: "effect-ui/router", replacement: path.join(src, "router/index.ts") },
      // Main effect-ui alias
      { find: "effect-ui", replacement: path.join(src, "index.ts") },
    ],
  },
  esbuild: {
    jsx: "automatic",
    jsxImportSource: "effect-ui",
  },
  optimizeDeps: {
    // Don't try to optimize our local source files
    exclude: [
      "effect-ui",
      "effect-ui/router",
      "effect-ui/jsx-runtime",
      "effect-ui/jsx-dev-runtime",
    ],
  },
});
