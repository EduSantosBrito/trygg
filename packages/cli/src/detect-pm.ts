/**
 * Package manager detection
 * @since 1.0.0
 */
import { Config, Effect, Match } from "effect";

export type PackageManager = "bun" | "pnpm" | "yarn" | "npm";

/**
 * Detect which package manager invoked the CLI
 * Checks npm_config_user_agent set by package managers
 */
export const detectPackageManager: Effect.Effect<PackageManager, Config.ConfigError> = Effect.gen(
  function* () {
    const userAgent = yield* Config.string("npm_config_user_agent").pipe(
      Config.orElse(() => Config.succeed("")),
    );

    if (userAgent === "") {
      // Fallback: check if we're running under Bun runtime
      // This handles direct execution like: bun create trygg
      const execPath = process.argv[0];
      if (execPath?.includes("bun")) return "bun";
      return "npm";
    }

    if (userAgent.includes("bun")) return "bun";
    if (userAgent.includes("pnpm")) return "pnpm";
    if (userAgent.includes("yarn")) return "yarn";
    return "npm";
  },
);

/**
 * Get install command for a package manager
 */
export const getInstallCommand = (pm: PackageManager): string =>
  Match.value(pm).pipe(
    Match.when("bun", () => "bun install"),
    Match.when("pnpm", () => "pnpm install"),
    Match.when("yarn", () => "yarn"),
    Match.when("npm", () => "npm install"),
    Match.exhaustive,
  );

/**
 * Get run command for a package manager
 */
export const getRunCommand = (pm: PackageManager): string =>
  Match.value(pm).pipe(
    Match.when("bun", () => "bun run"),
    Match.when("pnpm", () => "pnpm"),
    Match.when("yarn", () => "yarn"),
    Match.when("npm", () => "npm run"),
    Match.exhaustive,
  );
