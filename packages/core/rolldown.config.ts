import { defineConfig } from "rolldown";

export default defineConfig({
  input: {
    index: "src/index.ts",
    router: "src/router/index.ts",
    "vite-plugin": "src/vite/plugin.ts",
    "jsx-runtime": "src/jsx-runtime.ts",
    "jsx-dev-runtime": "src/jsx-dev-runtime.ts",
    api: "src/api/types.ts",
    config: "src/config.ts",
  },
  output: {
    dir: "dist",
    format: "esm",
    sourcemap: true,
  },
  external: [/^effect/, /^@effect\//, /^@effect-atom\//, /^node:/, /^bun:/, "vite", "consola"],
  resolve: {
    extensions: [".ts", ".tsx", ".js"],
  },
  jsx: {
    mode: "automatic",
    importSource: "#jsx",
  },
});
