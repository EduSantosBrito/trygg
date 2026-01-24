/**
 * Generate package.json based on user selections
 * @since 1.0.0
 */
import { Effect } from "effect"

export interface PackageJsonOptions {
  readonly name: string
  readonly platform: "node" | "bun"
  readonly output: "server" | "static"
  readonly includeTailwind: boolean
}

export const generatePackageJson = (
  options: PackageJsonOptions,
): Effect.Effect<string> =>
  Effect.gen(function* () {
    const { name, platform, output, includeTailwind } = options

    const scripts: Record<string, string> = {
      dev: "vite",
      build: "vite build",
      typecheck: "tsc --noEmit",
    }

    // Add platform-specific scripts
    if (output === "server") {
      const runtime = platform === "bun" ? "bun" : "node"
      scripts.preview = `${runtime} dist/server.js`
      scripts.start = `${runtime} dist/server.js`
    } else {
      scripts.preview = "vite preview"
    }

    const dependencies: Record<string, string> = {
      effect: "^3.19.15",
      "@effect/platform": "^0.94.1",
      "@effect/platform-browser": "^0.74.0",
      "effect-ui": "^0.1.0",
    }

    // Add platform-specific runtime
    if (output === "server") {
      if (platform === "bun") {
        dependencies["@effect/platform-bun"] = "^0.87.0"
      } else {
        dependencies["@effect/platform-node"] = "^0.87.0"
      }
    }

    const devDependencies: Record<string, string> = {
      typescript: "^5.7.0",
      vite: "^6.0.0",
    }

    if (includeTailwind) {
      devDependencies["@tailwindcss/vite"] = "^4.0.0"
      devDependencies["tailwindcss"] = "^4.0.0"
    }

    const pkg = {
      name,
      version: "0.1.0",
      private: true,
      type: "module",
      scripts,
      dependencies,
      devDependencies,
    }

    return JSON.stringify(pkg, null, 2) + "\n"
  })
