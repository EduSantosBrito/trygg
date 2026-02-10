import { defineConfig } from "vite";
import tailwindcss from "@tailwindcss/vite";
import { trygg } from "trygg/vite-plugin";

export default defineConfig({
  plugins: [tailwindcss(), trygg()],
  build: {
    target: "esnext",
    chunkSizeWarningLimit: 700, // Shiki WASM is ~622KB
  },
  esbuild: {
    target: "esnext",
  },
});
