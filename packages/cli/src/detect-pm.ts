/**
 * Package manager detection
 * @since 1.0.0
 */
import { Effect } from "effect"

export type PackageManager = "bun" | "pnpm" | "yarn" | "npm"

/**
 * Detect which package manager invoked the CLI
 * Checks npm_config_user_agent set by package managers
 */
export const detectPackageManager = (): Effect.Effect<PackageManager> =>
  Effect.sync(() => {
    const userAgent = process.env.npm_config_user_agent
    
    if (!userAgent) {
      // Fallback: check if we're running under Bun runtime
      // This handles direct execution like: bun create effect-ui
      const execPath = process.argv[0]
      if (execPath?.includes("bun")) return "bun"
      return "npm"
    }
    
    if (userAgent.includes("bun")) return "bun"
    if (userAgent.includes("pnpm")) return "pnpm"
    if (userAgent.includes("yarn")) return "yarn"
    return "npm"
  })

/**
 * Get install command for a package manager
 */
export const getInstallCommand = (pm: PackageManager): string => {
  switch (pm) {
    case "bun":
      return "bun install"
    case "pnpm":
      return "pnpm install"
    case "yarn":
      return "yarn"
    case "npm":
      return "npm install"
  }
}

/**
 * Get run command for a package manager
 */
export const getRunCommand = (pm: PackageManager): string => {
  switch (pm) {
    case "bun":
      return "bun run"
    case "pnpm":
      return "pnpm"
    case "yarn":
      return "yarn"
    case "npm":
      return "npm run"
  }
}
