/**
 * Generate package.json based on user selections
 * Uses PlatformConfig service for platform-specific values
 * @since 1.0.0
 */
import { Effect } from "effect";
import { PlatformConfig } from "../platform-config.js";

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
      effect: "^3.19.15",
      "@effect/platform": "^0.94.1",
      "@effect/platform-browser": "^0.74.0",
      trygg: "workspace:*",
    };

    const devDependencies: Record<string, string> = {
      typescript: "^5.7.0",
      vite: "^6.0.0",
      "@tailwindcss/vite": "^4.0.0",
      tailwindcss: "^4.0.0",
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
