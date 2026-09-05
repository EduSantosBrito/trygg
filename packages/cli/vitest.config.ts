import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

export default defineConfig({
  test: {
    include: ["src/**/__tests__/**/*.test.{ts,tsx}"],
    environment: "node",
    testTimeout: 120000,
    hookTimeout: 120000,
  },
  esbuild: {
    jsx: "automatic",
    jsxImportSource: "trygg",
  },
  resolve: {
    alias: {
      "trygg/api": fileURLToPath(new URL("./test-fixtures/trygg-api.ts", import.meta.url)),
    },
  },
});
