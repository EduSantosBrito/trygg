import type { 
  ProjectReflection, 
  DeclarationReflection,
  SignatureReflection,
  TypeParameterReflection,
  ParameterReflection
} from "typedoc"
import { Effect, Array, Option, pipe } from "effect"
import { TransformError } from "./errors.js"

/**
 * Documentation entry for a type parameter (generic)
 */
export interface TypeParamDoc {
  readonly name: string
  readonly description: Option.Option<string>
  readonly constraint: Option.Option<string>
  readonly default: Option.Option<string>
}

/**
 * Documentation entry for a parameter
 */
export interface ParameterDoc {
  readonly name: string
  readonly description: Option.Option<string>
  readonly type: string
  readonly optional: boolean
  readonly defaultValue: Option.Option<string>
}

/**
 * Documentation entry for a signature (function/method)
 */
export interface SignatureDoc {
  readonly parameters: ReadonlyArray<ParameterDoc>
  readonly typeParameters: ReadonlyArray<TypeParamDoc>
  readonly returnType: string
  readonly description: Option.Option<string>
  readonly examples: ReadonlyArray<string>
  readonly deprecated: Option.Option<string>
}

/**
 * Documentation entry for a single export
 */
export interface ExportDoc {
  readonly name: string
  readonly kind: string
  readonly description: Option.Option<string>
  readonly signatures: ReadonlyArray<SignatureDoc>
  readonly type: Option.Option<string>
  readonly examples: ReadonlyArray<string>
  readonly deprecated: Option.Option<string>
  readonly since: Option.Option<string>
  readonly see: ReadonlyArray<string>
  readonly source: Option.Option<{
    readonly file: string
    readonly line: number
  }>
}

/**
 * Module documentation containing all exports
 */
export interface ModuleDoc {
  readonly name: string
  readonly description: Option.Option<string>
  readonly exports: ReadonlyArray<ExportDoc>
}

/**
 * Full documentation output
 */
export interface Documentation {
  readonly modules: ReadonlyArray<ModuleDoc>
  readonly packages: ReadonlyArray<string>
}

/**
 * Transform TypeDoc reflection to documentation structure
 */
export const transform = (project: ProjectReflection): Effect.Effect<Documentation, TransformError> =>
  Effect.gen(function* () {
    const modules = project.children ?? []
    
    const moduleDocs = pipe(
      modules,
      Array.map(transformModule),
      Array.getSomes
    )
    
    return {
      modules: moduleDocs,
      packages: [project.name]
    }
  })

/**
 * Transform a single module
 */
const transformModule = (module: DeclarationReflection): Option.Option<ModuleDoc> =>
  pipe(
    Option.some({
      name: module.name,
      description: getDescription(module),
      exports: getExports(module)
    })
  )

/**
 * Get all exports from a module
 */
const getExports = (module: DeclarationReflection): ReadonlyArray<ExportDoc> =>
  pipe(
    module.children ?? [],
    Array.filter(isPublicExport),
    Array.map(transformExport)
  )

/**
 * Check if a reflection is a public export
 */
const isPublicExport = (reflection: DeclarationReflection): boolean => {
  if (reflection.flags.isPrivate) return false
  if (reflection.comment?.hasModifier("@internal")) return false
  if (reflection.comment?.hasModifier("@hidden")) return false
  return true
}

/**
 * Transform a single export
 */
const transformExport = (reflection: DeclarationReflection): ExportDoc => {
  const signatures = getSignatures(reflection)
  
  return {
    name: reflection.name,
    kind: getKindName(reflection.kind),
    description: getDescription(reflection),
    signatures,
    type: getTypeString(reflection),
    examples: getExamples(reflection),
    deprecated: getDeprecated(reflection),
    since: getSince(reflection),
    see: getSee(reflection),
    source: getSource(reflection)
  }
}

/**
 * Get signatures for a reflection (functions, methods, etc.)
 */
const getSignatures = (reflection: DeclarationReflection): ReadonlyArray<SignatureDoc> =>
  pipe(
    reflection.signatures ?? [],
    Array.map(transformSignature)
  )

/**
 * Transform a signature
 */
const transformSignature = (sig: SignatureReflection): SignatureDoc => ({
  parameters: getParameters(sig),
  typeParameters: getTypeParameters(sig),
  returnType: sig.type?.toString() ?? "void",
  description: getDescription(sig),
  examples: getExamples(sig),
  deprecated: getDeprecated(sig)
})

/**
 * Get parameters from a signature
 */
const getParameters = (sig: SignatureReflection): ReadonlyArray<ParameterDoc> =>
  pipe(
    sig.parameters ?? [],
    Array.map((param: ParameterReflection): ParameterDoc => ({
      name: param.name,
      description: getDescription(param),
      type: param.type?.toString() ?? "unknown",
      optional: param.flags.isOptional ?? false,
      defaultValue: Option.fromNullable(param.defaultValue)
    }))
  )

/**
 * Get type parameters (generics) from a signature
 */
const getTypeParameters = (sig: SignatureReflection): ReadonlyArray<TypeParamDoc> =>
  pipe(
    sig.typeParameters ?? [],
    Array.map((tp: TypeParameterReflection): TypeParamDoc => ({
      name: tp.name,
      description: getDescription(tp),
      constraint: Option.fromNullable(tp.type?.toString()),
      default: Option.fromNullable(tp.default?.toString())
    }))
  )

/**
 * Get description from a reflection
 */
const getDescription = (reflection: { comment?: { summary?: Array<{ text: string }> } }): Option.Option<string> =>
  pipe(
    Option.fromNullable(reflection.comment?.summary),
    Option.map((summary) => summary.map((s) => s.text).join(""))
  )

/**
 * Get examples from a reflection
 */
const getExamples = (reflection: { comment?: { blockTags?: Array<{ tag: string; content: Array<{ text: string }> }> } }): ReadonlyArray<string> =>
  pipe(
    reflection.comment?.blockTags ?? [],
    Array.filter((tag) => tag.tag === "@example"),
    Array.map((tag) => tag.content.map((c) => c.text).join(""))
  )

/**
 * Get deprecated notice
 */
const getDeprecated = (reflection: { comment?: { blockTags?: Array<{ tag: string; content: Array<{ text: string }> }> } }): Option.Option<string> =>
  pipe(
    reflection.comment?.blockTags ?? [],
    Array.findFirst((tag) => tag.tag === "@deprecated"),
    Option.map((tag) => tag.content.map((c) => c.text).join(""))
  )

/**
 * Get since version
 */
const getSince = (reflection: { comment?: { blockTags?: Array<{ tag: string; content: Array<{ text: string }> }> } }): Option.Option<string> =>
  pipe(
    reflection.comment?.blockTags ?? [],
    Array.findFirst((tag) => tag.tag === "@since"),
    Option.map((tag) => tag.content.map((c) => c.text).join(""))
  )

/**
 * Get @see references
 */
const getSee = (reflection: { comment?: { blockTags?: Array<{ tag: string; content: Array<{ text: string }> }> } }): ReadonlyArray<string> =>
  pipe(
    reflection.comment?.blockTags ?? [],
    Array.filter((tag) => tag.tag === "@see"),
    Array.map((tag) => tag.content.map((c) => c.text).join(""))
  )

/**
 * Get source location
 */
const getSource = (reflection: DeclarationReflection): Option.Option<{ file: string; line: number }> =>
  pipe(
    Option.fromNullable(reflection.sources?.[0]),
    Option.map((source) => ({
      file: source.fileName,
      line: source.line ?? 1
    }))
  )

/**
 * Get type string for a reflection
 */
const getTypeString = (reflection: DeclarationReflection): Option.Option<string> =>
  pipe(
    Option.fromNullable(reflection.type),
    Option.map((t) => t.toString())
  )

/**
 * Get human-readable kind name
 */
const getKindName = (kind: number): string => {
  const kindMap: Record<number, string> = {
    1: "project",
    2: "module",
    4: "namespace",
    8: "enum",
    16: "enumMember",
    32: "variable",
    64: "function",
    128: "class",
    256: "interface",
    512: "constructor",
    1024: "property",
    2048: "method",
    4096: "callSignature",
    8192: "indexSignature",
    16384: "constructorSignature",
    32768: "parameter",
    65536: "typeLiteral",
    131072: "typeParameter",
    262144: "accessor",
    524288: "getSignature",
    1048576: "setSignature",
    2097152: "typeAlias",
    4194304: "reference"
  }
  return kindMap[kind] ?? "unknown"
}

/**
 * Serialize documentation to JSON
 */
export const toJson = (doc: Documentation): string =>
  JSON.stringify(doc, null, 2)
