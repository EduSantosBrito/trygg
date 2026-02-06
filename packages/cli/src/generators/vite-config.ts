/**
 * Generate vite.config.ts based on user selections
 * @since 1.0.0
 */
import { Effect } from "effect";

export interface ViteConfigOptions {
  readonly platform: "node" | "bun";
  readonly output: "server" | "static";
}

export const generateViteConfig = (options: ViteConfigOptions): Effect.Effect<string> =>
  Effect.gen(function* () {
    const { platform, output } = options;

    return `import { defineConfig } from "vite"
import tailwindcss from "@tailwindcss/vite"
import { trygg } from "trygg/vite-plugin"

export default defineConfig({
  plugins: [tailwindcss(), trygg({ platform: "${platform}", output: "${output}" })],
})
`;
  });
