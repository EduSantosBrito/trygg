/**
 * Generate package.json based on user selections
 * Uses PlatformConfig service for platform-specific values
 * @since 1.0.0
 */
import { Effect, Schema } from "effect";
import { PlatformConfig } from "../platform-config.js";
import {
  TRYGG_VERSION,
  EFFECT_VERSION,
  EFFECT_PLATFORM_BROWSER_VERSION,
  EFFECT_LANGUAGE_SERVICE_VERSION,
  TYPESCRIPT_VERSION,
  VITE_VERSION,
  OXLINT_VERSION,
  TAILWIND_VERSION,
  TAILWIND_VITE_VERSION,
} from "../versions.js";

export interface PackageJsonOptions {
  readonly name: string;
  readonly output: "server" | "static";
}

const StringRecord = Schema.Record(Schema.String, Schema.String);

const PackageJson = Schema.Struct({
  name: Schema.String,
  version: Schema.String,
  private: Schema.Boolean,
  type: Schema.Literal("module"),
  scripts: StringRecord,
  dependencies: StringRecord,
  devDependencies: StringRecord,
});

const PackageJsonString = Schema.fromJsonString(PackageJson);
const encodePackageJson = Schema.encodeEffect(PackageJsonString);
const packageType = "module";

export const generatePackageJson: (
  options: PackageJsonOptions,
) => Effect.Effect<string, Schema.SchemaError, PlatformConfig> = Effect.fn(
  "Cli.generatePackageJson",
)(function* (options: PackageJsonOptions) {
  const { name, output } = options;
  const platform = yield* PlatformConfig;

  const scripts: Record<string, string> = {
    dev: platform.devScript,
    build: "vite build",
    typecheck: "tsc --noEmit",
    lint: "oxlint .",
    "lint:fix": "oxlint . --fix",
    "effect:check": "effect-language-service diagnostics --project tsconfig.json",
    check: "bun run lint && bun run typecheck && bun run effect:check",
    prepare: "effect-language-service patch",
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
    "@effect/platform-browser": EFFECT_PLATFORM_BROWSER_VERSION,
    trygg: TRYGG_VERSION,
  };

  const devDependencies: Record<string, string> = {
    "@effect/language-service": EFFECT_LANGUAGE_SERVICE_VERSION,
    typescript: TYPESCRIPT_VERSION,
    vite: VITE_VERSION,
    oxlint: OXLINT_VERSION,
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

  const pkg: Schema.Schema.Type<typeof PackageJson> = {
    name,
    version: "0.1.0",
    private: true,
    type: packageType,
    scripts,
    dependencies,
    devDependencies,
  };

  const packageJson = yield* encodePackageJson(pkg);
  return `${packageJson}\n`;
});
