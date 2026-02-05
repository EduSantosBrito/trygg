/**
 * Generate package.json based on user selections
 * Uses PlatformConfig service for platform-specific values
 * @since 1.0.0
 */
import { Effect } from "effect";
import { PlatformConfig } from "../platform-config.js";
import {
  TRYGG_VERSION,
  EFFECT_VERSION,
  EFFECT_PLATFORM_VERSION,
  EFFECT_PLATFORM_BROWSER_VERSION,
  TYPESCRIPT_VERSION,
  VITE_VERSION,
  TAILWIND_VERSION,
  TAILWIND_VITE_VERSION,
} from "../versions.js";

export interface PackageJsonOptions {
  readonly name: string;
  readonly output: "server" | "static";
}

export const generatePackageJson = (
  options: PackageJsonOptions,
): Effect.Effect<string, never, PlatformConfig> =>
  Effect.gen(function* () {
    const { name, output } = options;
    const platform = yield* PlatformConfig;

    const scripts: Record<string, string> = {
      dev: platform.devScript,
      build: "vite build",
      typecheck: "tsc --noEmit",
    };

    // Add platform-specific scripts for server output
    if (output === "server") {
      const runtime = platform.name;
      scripts.preview = `${runtime} dist/server.js`;
      scripts.start = `${runtime} dist/server.js`;
    } else {
      scripts.preview = "vite preview";
    }

    const dependencies: Record<string, string> = {
      effect: EFFECT_VERSION,
      "@effect/platform": EFFECT_PLATFORM_VERSION,
      "@effect/platform-browser": EFFECT_PLATFORM_BROWSER_VERSION,
      trygg: TRYGG_VERSION,
    };

    const devDependencies: Record<string, string> = {
      typescript: TYPESCRIPT_VERSION,
      vite: VITE_VERSION,
      "@tailwindcss/vite": TAILWIND_VITE_VERSION,
      tailwindcss: TAILWIND_VERSION,
    };

    // Add platform devDependencies only for static output (dev-only)
    // For server output, platform package goes in dependencies instead
    if (output === "static") {
      Object.assign(devDependencies, platform.devDependencies);
    }

    // Add runtime dependency for server output
    if (output === "server") {
      dependencies[platform.runtimeDependencyName] = platform.runtimeVersion;
    }

    const pkg = {
      name,
      version: "0.1.0",
      private: true,
      type: "module",
      scripts,
      dependencies,
      devDependencies,
    };

    return JSON.stringify(pkg, null, 2) + "\n";
  });
