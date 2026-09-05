/**
 * Prompts Service Port
 *
 * Effect-based wrapper for @clack/prompts
 * @since 1.0.0
 */
import { Effect, Schema } from "effect";
import * as Context from "effect/Context";

// === Error Types ===

export class PromptCancelledError extends Schema.TaggedError<PromptCancelledError>()(
  "PromptCancelledError",
  {
    message: Schema.String,
  },
) {
  static readonly default = new PromptCancelledError({ message: "Prompt cancelled" });
}

const PromptOperation = Schema.Union([
  Schema.Literal("text"),
  Schema.Literal("select"),
  Schema.Literal("confirm"),
]);

export class PromptFailedError extends Schema.TaggedError<PromptFailedError>()(
  "PromptFailedError",
  {
    operation: PromptOperation,
    cause: Schema.Defect(),
  },
) {}

export class InvalidPromptResponseError extends Schema.TaggedError<InvalidPromptResponseError>()(
  "InvalidPromptResponseError",
  {
    operation: PromptOperation,
    value: Schema.Unknown,
  },
) {}

export type PromptError = PromptCancelledError | PromptFailedError | InvalidPromptResponseError;

export class InvalidProjectNameError extends Schema.TaggedError<InvalidProjectNameError>()(
  "InvalidProjectNameError",
  {
    name: Schema.String,
  },
) {}

export class InvalidTemplateError extends Schema.TaggedError<InvalidTemplateError>()(
  "InvalidTemplateError",
  {
    template: Schema.String,
  },
) {}

export class TemplateNotFoundError extends Schema.TaggedError<TemplateNotFoundError>()(
  "TemplateNotFoundError",
  {
    template: Schema.String,
    path: Schema.String,
  },
) {}

export class DirectoryExistsError extends Schema.TaggedError<DirectoryExistsError>()(
  "DirectoryExistsError",
  {
    path: Schema.String,
  },
) {}

// === Prompt Option Types ===

export interface TextOptions {
  readonly message: string;
  readonly placeholder?: string;
  readonly defaultValue?: string;
  readonly validate?: (value: string) => string | undefined;
}

export interface SelectOption<T extends string> {
  readonly value: T;
  readonly label: string;
  readonly hint?: string;
}

export interface SelectOptions<T extends string> {
  readonly message: string;
  readonly options: ReadonlyArray<SelectOption<T>>;
  readonly initialValue?: T;
}

export interface ConfirmOptions {
  readonly message: string;
  readonly initialValue?: boolean;
}

// === Service Interface ===

export class Prompts extends Context.Service<
  Prompts,
  {
    readonly text: (options: TextOptions) => Effect.Effect<string, PromptError>;
    readonly select: <T extends string>(options: SelectOptions<T>) => Effect.Effect<T, PromptError>;
    readonly confirm: (options: ConfirmOptions) => Effect.Effect<boolean, PromptError>;
  }
>()("trygg/Prompts") {}

export type PromptsService = Prompts["Service"];
