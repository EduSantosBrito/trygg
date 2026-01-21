import { defineConfig } from "vitest/config";
import { resolve } from "path";

export default defineConfig({
  test: {
    include: ["tests/**/*.test.ts", "tests/**/*.test.tsx"],
    // Exclude tests that use bun:test (run with `bun test` instead)
    exclude: ["tests/test-server.test.ts"],
    environment: "happy-dom",
    testTimeout: 5000,
    hookTimeout: 5000,
    setupFiles: ["./vitest.setup.ts"],
  },
  resolve: {
    alias: {
      "#jsx": resolve(__dirname, "./src"),
    },
  },
  esbuild: {
    jsx: "automatic",
    jsxImportSource: "#jsx",
  },
});
