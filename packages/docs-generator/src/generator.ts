import { Effect, Array, Option, pipe } from "effect"
import { FileSystem } from "@effect/platform/FileSystem"
import { Path } from "@effect/platform/Path"
import type { Documentation, ModuleDoc, ExportDoc, SignatureDoc } from "./transformer.js"
import { GenerationError } from "./errors.js"

/**
 * Configuration for file generation
 */
export interface GeneratorConfig {
  readonly outputDir: string
  readonly format: "json" | "markdown"
}

/**
 * Generate documentation files from transformed documentation
 */
export const generate = (
  doc: Documentation, 
  config: GeneratorConfig
): Effect.Effect<void, GenerationError, FileSystem | Path> =>
  Effect.gen(function* () {
    const fs = yield* FileSystem
    const path = yield* Path
    
    yield* ensureOutputDir(config.outputDir, fs)
    
    switch (config.format) {
      case "json":
        yield* generateJson(doc, config.outputDir, fs)
        break
      case "markdown":
        yield* generateMarkdown(doc, config.outputDir, fs, path)
        break
    }
  })

/**
 * Generate JSON output
 */
const generateJson = (
  doc: Documentation, 
  outputDir: string,
  fs: FileSystem
): Effect.Effect<void, GenerationError> =>
  Effect.gen(function* () {
    const jsonPath = `${outputDir}/documentation.json`
    const json = JSON.stringify(doc, null, 2)
    
    yield* fs.writeFileString(jsonPath, json).pipe(
      Effect.mapError((error) => new GenerationError({ message: "Failed to write JSON", cause: error }))
    )
  })

/**
 * Generate markdown documentation
 */
const generateMarkdown = (
  doc: Documentation,
  outputDir: string, 
  fs: FileSystem,
  path: Path
): Effect.Effect<void, GenerationError> =>
  Effect.gen(function* () {
    yield* Effect.forEach(doc.modules, (module) =>
      generateModuleMarkdown(module, outputDir, fs, path)
    )
    
    yield* generateManifest(doc, outputDir, fs)
  })

/**
 * Generate markdown file for a module
 */
const generateModuleMarkdown = (
  module: ModuleDoc,
  outputDir: string,
  fs: FileSystem,
  path: Path
): Effect.Effect<void, GenerationError> =>
  Effect.gen(function* () {
    const fileName = `${toValidFileName(module.name)}.md`
    const filePath = path.join(outputDir, "api", fileName)
    
    yield* fs.makeDirectory(path.dirname(filePath), { recursive: true }).pipe(
      Effect.mapError((error) => new GenerationError({ message: "Failed to create directory", cause: error }))
    )
    
    const content = generateModuleMarkdownContent(module)
    
    yield* fs.writeFileString(filePath, content).pipe(
      Effect.mapError((error) => new GenerationError({ message: "Failed to write markdown", cause: error }))
    )
  })

/**
 * Generate markdown content for a module
 */
const generateModuleMarkdownContent = (module: ModuleDoc): string => {
  const descriptionLines = module.description.pipe(
    Option.map((desc) => [desc, ""]),
    Option.getOrElse(() => [] as Array<string>)
  )
  
  const exportLines = module.exports.length > 0
    ? [
        "## Exports",
        "",
        ...module.exports.flatMap((exp) => generateExportMarkdown(exp, 2).split("\n"))
      ]
    : []
  
  return [
    `# ${module.name}`,
    "",
    ...descriptionLines,
    ...exportLines
  ].join("\n")
}

/**
 * Generate markdown for an export
 */
const generateExportMarkdown = (exp: ExportDoc, level: number): string => {
  const indent = "  ".repeat(level)
  
  const descriptionLines = exp.description.pipe(
    Option.map((desc) => [`${indent}${desc}`, ""]),
    Option.getOrElse(() => [] as Array<string>)
  )
  
  const signatureLines = exp.signatures.flatMap((sig) => generateSignatureMarkdown(sig, indent))
  
  const deprecatedLines = exp.deprecated.pipe(
    Option.map((dep) => [
      `${indent}:::warning Deprecated`,
      `${indent}${dep}`,
      `${indent}:::`,
      ""
    ]),
    Option.getOrElse(() => [] as Array<string>)
  )
  
  return [
    `${indent}### ${exp.name}`,
    "",
    `${indent}**Kind:** ${exp.kind}`,
    "",
    ...descriptionLines,
    ...signatureLines,
    ...deprecatedLines
  ].join("\n")
}

/**
 * Generate markdown for a signature
 */
const generateSignatureMarkdown = (sig: SignatureDoc, indent: string): Array<string> => {
  const parameterLines = sig.parameters.length > 0
    ? [
        `${indent}**Parameters:**`,
        "",
        ...sig.parameters.map((param) => {
          const desc = param.description.pipe(
            Option.map((d) => ` - ${d}`),
            Option.getOrElse(() => "")
          )
          return `${indent}- \`${param.name}\`: ${param.type}${desc}`
        }),
        ""
      ]
    : []
  
  const exampleLines = sig.examples.length > 0
    ? [
        `${indent}**Examples:**`,
        "",
        ...sig.examples.flatMap((ex) => [
          `${indent}\`\`\`typescript`,
          `${indent}${ex}`,
          `${indent}\`\`\``,
          ""
        ])
      ]
    : []
  
  return [
    ...parameterLines,
    `${indent}**Returns:** ${sig.returnType}`,
    "",
    ...exampleLines
  ]
}

/**
 * Generate manifest/navigation file
 */
const generateManifest = (
  doc: Documentation,
  outputDir: string,
  fs: FileSystem
): Effect.Effect<void, GenerationError> =>
  Effect.gen(function* () {
    const manifestPath = `${outputDir}/manifest.json`
    
    const manifest = {
      name: doc.packages[0] ?? "documentation",
      modules: pipe(
        doc.modules,
        Array.map((m) => ({
          name: m.name,
          file: `api/${toValidFileName(m.name)}.md`,
          exportCount: m.exports.length
        }))
      )
    }
    
    yield* fs.writeFileString(manifestPath, JSON.stringify(manifest, null, 2)).pipe(
      Effect.mapError((error) => new GenerationError({ message: "Failed to write manifest", cause: error }))
    )
  })

/**
 * Ensure output directory exists
 */
const ensureOutputDir = (
  outputDir: string,
  fs: FileSystem
): Effect.Effect<void, GenerationError> =>
  Effect.gen(function* () {
    yield* fs.makeDirectory(outputDir, { recursive: true }).pipe(
      Effect.mapError((error) => new GenerationError({ message: "Failed to create output directory", cause: error }))
    )
  })

/**
 * Convert module name to valid file name
 */
const toValidFileName = (name: string): string =>
  name.replace(/[^a-zA-Z0-9_-]/g, "_")

/**
 * Default configuration
 */
export const defaultConfig: GeneratorConfig = {
  outputDir: "apps/docs/public/api",
  format: "json"
}
