import { defineConfig } from "vite"
import tailwindcss from "@tailwindcss/vite"
import { trygg } from "trygg/vite-plugin"
import tryggConfig from "./trygg.config"

export default defineConfig({
  plugins: [tailwindcss(), trygg(tryggConfig)],
})
