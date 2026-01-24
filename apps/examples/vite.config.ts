import { defineConfig } from "vite";
import tailwindcss from "@tailwindcss/vite";
import { effectUI } from "trygg/vite-plugin";

export default defineConfig({
  plugins: [tailwindcss(), effectUI()],
});
