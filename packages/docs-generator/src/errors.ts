import { Data } from "effect"

export class TypeDocError extends Data.TaggedError("TypeDocError")<{
  readonly message: string
  readonly cause?: unknown
}> {}

export class ValidationError extends Data.TaggedError("ValidationError")<{
  readonly message: string
  readonly file?: string
  readonly line?: number
  readonly cause?: unknown
}> {}

export class GenerationError extends Data.TaggedError("GenerationError")<{
  readonly message: string
  readonly cause?: unknown
}> {}

export class TransformError extends Data.TaggedError("TransformError")<{
  readonly message: string
  readonly cause?: unknown
}> {}
