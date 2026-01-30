import { defineConfig } from "vite";
import tailwindcss from "@tailwindcss/vite";
import { trygg } from "trygg/vite-plugin";

export default defineConfig({
  plugins: [tailwindcss(), trygg()],
});
