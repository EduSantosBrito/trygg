import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["src/**/__tests__/**/*.test.{ts,tsx}"],
    environment: "node",
    testTimeout: 10000,
    hookTimeout: 10000,
  },
});
