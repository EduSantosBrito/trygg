/**
 * Generate vite.config.ts based on user selections
 * @since 1.0.0
 */
import { Effect } from "effect";

export const generateViteConfig = (): Effect.Effect<string> =>
  Effect.gen(function* () {
    return `import { defineConfig } from "vite"
import tailwindcss from "@tailwindcss/vite"
import { trygg } from "trygg/vite-plugin"
import tryggConfig from "./trygg.config"

export default defineConfig({
  plugins: [tailwindcss(), trygg(tryggConfig)],
})
`;
  });
