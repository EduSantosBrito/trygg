export { TypeDocError, ValidationError, GenerationError, TransformError } from "./errors.js"

export {
  extract,
  readReflection,
  defaultConfig as extractorDefaultConfig,
  BunPlatformLive
} from "./typedoc-extractor.js"

export type { ExtractorConfig } from "./typedoc-extractor.js"

export {
  transform,
  toJson
} from "./transformer.js"

export type {
  Documentation,
  ModuleDoc,
  ExportDoc,
  SignatureDoc,
  ParameterDoc,
  TypeParamDoc
} from "./transformer.js"

export {
  generate,
  defaultConfig as generatorDefaultConfig
} from "./generator.js"

export type { GeneratorConfig } from "./generator.js"

export {
  validate,
  formatResult,
  defaultConfig as validatorDefaultConfig,
  strictConfig as validatorStrictConfig
} from "./validator.js"

export type { ValidatorConfig, ValidationResult } from "./validator.js"
