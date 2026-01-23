import { defineConfig } from "vite";
import tailwindcss from "@tailwindcss/vite";
import { effectUI } from "effect-ui/vite-plugin";

export default defineConfig({
  plugins: [tailwindcss(), effectUI()],
});
