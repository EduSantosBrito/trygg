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
    // Force full reload when core package files change
    watch: {
      ignored: ["!**/packages/core/src/**"],
    },
  },
  plugins: [effectUI()],
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
  optimizeDeps: {
    // Force re-optimization on every server start to pick up changes
    force: true,
  },
  esbuild: {
    jsx: "automatic",
    jsxImportSource: "effect-ui",
  },
});
