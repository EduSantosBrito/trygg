#!/usr/bin/env bun
import { Command, Options } from "@effect/cli"
import { Console, Data, Effect, Layer } from "effect"
import { FileSystem } from "@effect/platform/FileSystem"
import { Path } from "@effect/platform/Path"
import { Terminal } from "@effect/platform/Terminal"
import * as BunFileSystem from "@effect/platform-bun/BunFileSystem"
import * as BunPath from "@effect/platform-bun/BunPath"
import * as BunTerminal from "@effect/platform-bun/BunTerminal"
import * as Extractor from "./typedoc-extractor.js"
import * as Transformer from "./transformer.js"
import * as Generator from "./generator.js"
import * as Validator from "./validator.js"
import { GenerationError } from "./errors.js"

/**
 * Format error with full context including cause chain
 */
const formatError = (error: unknown): string => {
  if (error && typeof error === "object" && "_tag" in error && "message" in error) {
    const tagged = error as { _tag: string; message: string; cause?: unknown }
    let msg = `${tagged._tag}: ${tagged.message}`
    if (tagged.cause) {
      msg += `\n  Caused by: ${formatError(tagged.cause)}`
    }
    return msg
  }
  if (error instanceof Error) {
    return `${error.name}: ${error.message}`
  }
  return String(error)
}

const validateOnly = Options.boolean("validate-only").pipe(
  Options.withAlias("V"),
  Options.withDescription("Only validate documentation coverage")
)

const entryPoints = Options.text("entryPoints").pipe(
  Options.withAlias("e"),
  Options.withDescription("Entry points for TypeDoc (comma-separated)"),
  Options.withDefault("packages/core/src/index.ts")
)

const tsconfig = Options.text("tsconfig").pipe(
  Options.withAlias("c"),
  Options.withDescription("Path to tsconfig.json"),
  Options.withDefault("packages/core/tsconfig.json")
)

const outputDir = Options.text("outputDir").pipe(
  Options.withAlias("o"),
  Options.withDescription("Output directory for generated docs"),
  Options.withDefault("apps/docs/src/generated")
)

const reflectionPath = Options.text("reflectionPath").pipe(
  Options.withAlias("r"),
  Options.withDescription("Path to save reflection.json"),
  Options.withDefault("tmp/reflection.json")
)

const strict = Options.boolean("strict").pipe(
  Options.withAlias("s"),
  Options.withDescription("Use strict validation rules"),
  Options.withDefault(false)
)

const generate = Command.make(
  "generate",
  { validateOnly, entryPoints, tsconfig, outputDir, reflectionPath, strict },
  ({ validateOnly: isValidateOnly, entryPoints: eps, tsconfig: ts, outputDir: out, reflectionPath: refl, strict: isStrict }) =>
    Effect.gen(function* () {
      yield* Console.log("📚 Generating documentation...")

      const project = yield* Extractor.extract({
        entryPoints: eps.split(",").map((e: string) => e.trim()).filter((e: string) => e.length > 0),
        tsconfig: ts,
        outputPath: refl,
        skipErrorChecking: true,
        excludePrivate: true,
        excludeExternals: true
      }).pipe(
        Effect.tap(() => Console.log("✅ TypeDoc extraction complete"))
      )

      const doc = yield* Transformer.transform(project).pipe(
        Effect.tap(() => Console.log("✅ Documentation transformation complete"))
      )

      if (isValidateOnly) {
        const result = yield* Validator.validate(doc, isStrict ? Validator.strictConfig : Validator.defaultConfig).pipe(
          Effect.tap((result) => Console.log(Validator.formatResult(result)))
        )

        if (!result.isValid) {
          yield* Effect.fail(new GenerationError({ message: "Documentation validation failed" }))
        }

        return
      }

      yield* Generator.generate(doc, {
        outputDir: out,
        format: "json"
      }).pipe(
        Effect.tap(() => Console.log("✅ Documentation generation complete"))
      )

      const validation = yield* Validator.validate(doc, isStrict ? Validator.strictConfig : Validator.defaultConfig).pipe(
        Effect.tap((result) => Console.log(Validator.formatResult(result)))
      )

      yield* Console.log("🎉 Documentation generation complete!")

      if (!validation.isValid) {
        yield* Console.log("⚠️  Some exports are missing documentation")
      }
    })
)

const app = Command.make("docs", {}, () =>
  Console.log("Documentation Generator for trygg\n\nUsage: docs generate [options]")
).pipe(
  Command.withSubcommands([generate])
)

const cli = Command.run(app, {
  name: "trygg-docs",
  version: "0.0.1"
})

const platformLayer: Layer.Layer<FileSystem | Path | Terminal> = Layer.mergeAll(
  BunFileSystem.layer,
  BunPath.layer,
  BunTerminal.layer
)

cli(process.argv).pipe(
  Effect.provide(platformLayer),
  Effect.tapError((error) => Console.error(`Error: ${formatError(error)}`)),
  Effect.orDie,
  Effect.runPromise
)
