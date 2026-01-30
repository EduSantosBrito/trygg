/**
 * Generate trygg.config.ts based on user selections
 * @since 1.0.0
 */
import { Effect } from "effect";

export interface TryggConfigOptions {
  readonly platform: "node" | "bun";
  readonly output: "server" | "static";
}

export const generateTryggConfig = (options: TryggConfigOptions): Effect.Effect<string> =>
  Effect.gen(function* () {
    const { platform, output } = options;

    return `import { defineConfig } from "trygg/config"

export default defineConfig({
  platform: "${platform}",
  output: "${output}",
})
`;
  });
