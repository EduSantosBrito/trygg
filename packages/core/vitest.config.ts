import { defineConfig } from "vitest/config";
import { resolve } from "path";

export default defineConfig({
  test: {
    include: ["src/**/__tests__/**/*.test.{ts,tsx}"],
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
