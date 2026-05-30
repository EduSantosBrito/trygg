import { defineConfig } from "vite";
import tailwindcss from "@tailwindcss/vite";
import { trygg } from "trygg/vite-plugin";

import { docsHighlightsPlugin } from "./vite-plugins/docs-highlights";

export default defineConfig({
  plugins: [
    tailwindcss(),
    docsHighlightsPlugin(),
    trygg({ output: "static", platform: "cloudflare" }),
  ],
  build: {
    target: "esnext",
    chunkSizeWarningLimit: 700, // Shiki WASM is ~622KB
  },
  esbuild: {
    target: "esnext",
  },
});
