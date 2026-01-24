/**
 * Generate vite.config.ts based on user selections
 * @since 1.0.0
 */
import { Effect } from "effect"

export interface ViteConfigOptions {
  readonly platform: "node" | "bun"
  readonly output: "server" | "static"
  readonly includeTailwind: boolean
}

export const generateViteConfig = (options: ViteConfigOptions): Effect.Effect<string> =>
  Effect.gen(function* () {
    const { platform, output, includeTailwind } = options

    const imports: string[] = ['import { defineConfig } from "vite"']

    if (includeTailwind) {
      imports.push('import tailwindcss from "@tailwindcss/vite"')
    }

    imports.push('import { effectUI } from "trygg/vite-plugin"')

    const plugins: string[] = []
    if (includeTailwind) {
      plugins.push("tailwindcss()")
    }

    // Add effectUI plugin configuration
    const hasOptions = platform !== "node" || output !== "server"
    if (hasOptions) {
      const options: string[] = []
      if (platform !== "node") {
        options.push(`platform: "${platform}"`)
      }
      if (output !== "server") {
        options.push(`output: "${output}"`)
      }
      plugins.push(`effectUI({ ${options.join(", ")} })`)
    } else {
      plugins.push("effectUI()")
    }

    return `${imports.join("\n")}

export default defineConfig({
  plugins: [${plugins.join(", ")}],
})
`
  })
