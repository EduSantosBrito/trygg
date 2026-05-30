import { defineConfig } from "vitest/config";

import { docsHighlightsPlugin } from "./vite-plugins/docs-highlights";

export default defineConfig({
  plugins: [docsHighlightsPlugin()],
  test: {
    globals: false,
    environment: "node",
  },
});
