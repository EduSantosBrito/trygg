import { Effect, Array, Option, pipe } from "effect"
import type { Documentation, ModuleDoc, ExportDoc, SignatureDoc } from "./transformer.js"
import { ValidationError } from "./errors.js"

/**
 * Configuration for validation
 */
export interface ValidatorConfig {
  readonly requireDescription: boolean
  readonly requireExamples: boolean
  readonly requireSince: boolean
  readonly allowInternal: boolean
  readonly allowPrivate: boolean
}

/**
 * Validation result
 */
export interface ValidationResult {
  readonly isValid: boolean
  readonly errors: ReadonlyArray<ValidationError>
  readonly warnings: ReadonlyArray<ValidationError>
  readonly stats: {
    readonly totalExports: number
    readonly documentedExports: number
    readonly undocumentedExports: number
  }
}

/**
 * Validate documentation coverage
 */
export const validate = (
  doc: Documentation,
  config: ValidatorConfig
): Effect.Effect<ValidationResult, never> =>
  Effect.gen(function* () {
    const allExports = pipe(
      doc.modules,
      Array.flatMap((m) => m.exports)
    )
    
    const results = pipe(
      allExports,
      Array.map((exp) => validateExport(exp, config))
    )
    
    const errors = pipe(
      results,
      Array.flatMap((r) => r.errors)
    )
    
    const warnings = pipe(
      results,
      Array.flatMap((r) => r.warnings)
    )
    
    const documentedCount = pipe(
      allExports,
      Array.filter((exp) => hasDocumentation(exp)),
      Array.length
    )
    
    return {
      isValid: errors.length === 0,
      errors,
      warnings,
      stats: {
        totalExports: allExports.length,
        documentedExports: documentedCount,
        undocumentedExports: allExports.length - documentedCount
      }
    }
  })

/**
 * Validate a single export
 */
const validateExport = (
  exp: ExportDoc,
  config: ValidatorConfig
): { errors: Array<ValidationError>; warnings: Array<ValidationError> } => {
  const errors: Array<ValidationError> = []
  const warnings: Array<ValidationError> = []
  
  if (config.requireDescription) {
    if (Option.isNone(exp.description)) {
      errors.push(new ValidationError({
        message: `Missing description for ${exp.name}`,
        file: exp.source.pipe(Option.map((s) => s.file), Option.getOrElse(() => undefined)),
        line: exp.source.pipe(Option.map((s) => s.line), Option.getOrElse(() => undefined))
      }))
    }
  }
  
  if (config.requireExamples && exp.examples.length === 0) {
    warnings.push(new ValidationError({
      message: `Missing examples for ${exp.name}`,
      file: exp.source.pipe(Option.map((s) => s.file), Option.getOrElse(() => undefined)),
      line: exp.source.pipe(Option.map((s) => s.line), Option.getOrElse(() => undefined))
    }))
  }
  
  if (config.requireSince && Option.isNone(exp.since)) {
    warnings.push(new ValidationError({
      message: `Missing @since tag for ${exp.name}`,
      file: exp.source.pipe(Option.map((s) => s.file), Option.getOrElse(() => undefined)),
      line: exp.source.pipe(Option.map((s) => s.line), Option.getOrElse(() => undefined))
    }))
  }
  
  pipe(
    exp.signatures,
    Array.forEach((sig) => {
      const sigResult = validateSignature(exp.name, sig, config)
      errors.push(...sigResult.errors)
      warnings.push(...sigResult.warnings)
    })
  )
  
  return { errors, warnings }
}

/**
 * Validate a signature
 */
const validateSignature = (
  exportName: string,
  sig: SignatureDoc,
  config: ValidatorConfig
): { errors: Array<ValidationError>; warnings: Array<ValidationError> } => {
  const errors: Array<ValidationError> = []
  const warnings: Array<ValidationError> = []
  
  if (config.requireDescription && Option.isNone(sig.description)) {
    errors.push(new ValidationError({
      message: `Missing description for ${exportName} signature`
    }))
  }
  
  if (sig.parameters.length > 0 && sig.examples.length === 0) {
    warnings.push(new ValidationError({
      message: `Function ${exportName} has parameters but no examples`
    }))
  }
  
  return { errors, warnings }
}

/**
 * Check if an export has documentation
 */
const hasDocumentation = (exp: ExportDoc): boolean =>
  Option.isSome(exp.description) || exp.examples.length > 0

/**
 * Default configuration for trygg
 */
export const defaultConfig: ValidatorConfig = {
  requireDescription: true,
  requireExamples: false,
  requireSince: false,
  allowInternal: false,
  allowPrivate: false
}

/**
 * Strict validation for CI/CD
 */
export const strictConfig: ValidatorConfig = {
  requireDescription: true,
  requireExamples: true,
  requireSince: true,
  allowInternal: false,
  allowPrivate: false
}

/**
 * Format validation result as string
 */
export const formatResult = (result: ValidationResult): string => {
  const lines: Array<string> = []
  
  lines.push(`Documentation Validation Results:`)
  lines.push(`  Total exports: ${result.stats.totalExports}`)
  lines.push(`  Documented: ${result.stats.documentedExports}`)
  lines.push(`  Undocumented: ${result.stats.undocumentedExports}`)
  lines.push(``)
  
  if (result.errors.length > 0) {
    lines.push(`Errors (${result.errors.length}):`)
    result.errors.forEach((err) => {
      const location = err.file ? ` [${err.file}:${err.line ?? "?"}]` : ""
      lines.push(`  ❌ ${err.message}${location}`)
    })
    lines.push(``)
  }
  
  if (result.warnings.length > 0) {
    lines.push(`Warnings (${result.warnings.length}):`)
    result.warnings.forEach((warn) => {
      const location = warn.file ? ` [${warn.file}:${warn.line ?? "?"}]` : ""
      lines.push(`  ⚠️  ${warn.message}${location}`)
    })
    lines.push(``)
  }
  
  lines.push(result.isValid ? `✅ Validation passed` : `❌ Validation failed`)
  
  return lines.join("\n")
}
