import type { ProjectReflection } from "typedoc"
import { Effect, Layer } from "effect"
import { FileSystem } from "@effect/platform/FileSystem"
import { Path } from "@effect/platform/Path"
import * as BunFileSystem from "@effect/platform-bun/BunFileSystem"
import * as BunPath from "@effect/platform-bun/BunPath"
import { TypeDocError } from "./errors.js"

/**
 * Configuration for TypeDoc extraction
 */
export interface ExtractorConfig {
  readonly entryPoints: ReadonlyArray<string>
  readonly tsconfig: string
  readonly outputPath: string
  readonly skipErrorChecking?: boolean
  readonly excludePrivate?: boolean
  readonly excludeProtected?: boolean
  readonly excludeExternals?: boolean
}

/**
 * Extract TypeDoc reflections from TypeScript source
 */
export const extract = (config: ExtractorConfig): Effect.Effect<ProjectReflection, TypeDocError, FileSystem | Path> =>
  Effect.gen(function* () {
    const fs = yield* FileSystem
    const path = yield* Path
    
    yield* ensureOutputDir(config.outputPath, fs, path)
    
    const typeDocModule = yield* Effect.tryPromise({
      try: () => import("typedoc"),
      catch: (error: unknown) => new TypeDocError({ 
        message: `Failed to import TypeDoc`,
        cause: error
      })
    })
    
    const { Application } = typeDocModule
    
    const app = yield* Effect.tryPromise({
      try: () => Application.bootstrap({
        entryPoints: [...config.entryPoints],
        tsconfig: config.tsconfig,
        skipErrorChecking: config.skipErrorChecking ?? true,
        excludePrivate: config.excludePrivate ?? true,
        excludeProtected: config.excludeProtected ?? false,
        excludeExternals: config.excludeExternals ?? true,
        json: config.outputPath,
        emit: "docs",
        theme: "json"
      }),
      catch: (error: unknown) => new TypeDocError({ 
        message: `Failed to bootstrap TypeDoc`,
        cause: error
      })
    })
    
    const project = yield* Effect.tryPromise({
      try: () => app.convert(),
      catch: (error: unknown) => new TypeDocError({ 
        message: `TypeDoc conversion failed`,
        cause: error
      })
    }).pipe(
      Effect.flatMap((project) =>
        project === undefined
          ? Effect.fail(new TypeDocError({ message: "TypeDoc produced no output" }))
          : Effect.succeed(project)
      )
    )
    
    yield* writeReflectionJson(app, project, config.outputPath, fs)
    
    return project
  })

/**
 * Read existing reflection.json file
 */
export const readReflection = (filePath: string): Effect.Effect<ProjectReflection, TypeDocError, FileSystem> =>
  Effect.gen(function* () {
    const fs = yield* FileSystem
    
    const content = yield* fs.readFileString(filePath).pipe(
      Effect.mapError((error) => new TypeDocError({ 
        message: `Failed to read reflection.json`,
        cause: error
      }))
    )
    
    const parsed = yield* Effect.try({
      try: () => JSON.parse(content) as ProjectReflection,
      catch: (error: unknown) => new TypeDocError({ 
        message: `Failed to parse reflection.json`,
        cause: error
      })
    })
    
    return parsed
  })

/**
 * Ensure output directory exists
 */
const ensureOutputDir = (
  outputPath: string, 
  fs: FileSystem, 
  path: Path
): Effect.Effect<void, TypeDocError> =>
  Effect.gen(function* () {
    const dir = path.dirname(outputPath)
    yield* fs.makeDirectory(dir, { recursive: true }).pipe(
      Effect.mapError((error) => new TypeDocError({ 
        message: `Failed to create output directory`,
        cause: error
      }))
    )
  })

/**
 * Write reflection JSON to file
 */
const writeReflectionJson = (
  app: { serializer: { projectToObject: (project: ProjectReflection, format: "json") => object } },
  project: ProjectReflection,
  outputPath: string,
  fs: FileSystem
): Effect.Effect<void, TypeDocError> =>
  Effect.gen(function* () {
    const serialized = app.serializer.projectToObject(project, "json")
    const json = JSON.stringify(serialized, null, 2)
    
    yield* fs.writeFileString(outputPath, json).pipe(
      Effect.mapError((error) => new TypeDocError({ 
        message: `Failed to write reflection.json`,
        cause: error
      }))
    )
  })

/**
 * Default configuration for trygg core package
 */
export const defaultConfig: ExtractorConfig = {
  entryPoints: ["packages/core/src/index.ts"],
  tsconfig: "packages/core/tsconfig.json",
  outputPath: "tmp/reflection.json",
  skipErrorChecking: true,
  excludePrivate: true,
  excludeProtected: false,
  excludeExternals: true
}

/**
 * Layer providing FileSystem and Path services for the Bun platform.
 * 
 * Suitable for programmatic use without CLI features. Does NOT include
 * Terminal service - use this when building custom tools that don't need
 * interactive CLI capabilities.
 * 
 * For CLI applications, construct your own layer including Terminal:
 * ```typescript
 * const cliLayer = Layer.mergeAll(
 *   BunFileSystem.layer,
 *   BunPath.layer,
 *   BunTerminal.layer
 * )
 * ```
 */
export const BunPlatformLive: Layer.Layer<FileSystem | Path> = Layer.merge(
  BunFileSystem.layer,
  BunPath.layer
)
