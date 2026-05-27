/**
 * Prompts Service Port
 *
 * Effect-based wrapper for @clack/prompts
 * @since 1.0.0
 */
import { Effect, Schema } from "effect";
import * as Context from "effect/Context";

// === Error Types ===

export class PromptCancelledError extends Schema.TaggedErrorClass<PromptCancelledError>()(
  "PromptCancelledError",
  {
    message: Schema.String,
  },
) {
  static readonly default = new PromptCancelledError({ message: "Prompt cancelled" });
}

export class InvalidProjectNameError extends Schema.TaggedErrorClass<InvalidProjectNameError>()(
  "InvalidProjectNameError",
  {
    name: Schema.String,
  },
) {}

export class InvalidTemplateError extends Schema.TaggedErrorClass<InvalidTemplateError>()(
  "InvalidTemplateError",
  {
    template: Schema.String,
  },
) {}

export class TemplateNotFoundError extends Schema.TaggedErrorClass<TemplateNotFoundError>()(
  "TemplateNotFoundError",
  {
    template: Schema.String,
    path: Schema.String,
  },
) {}

export class DirectoryExistsError extends Schema.TaggedErrorClass<DirectoryExistsError>()(
  "DirectoryExistsError",
  {
    path: Schema.String,
  },
) {}

export class InstallFailedError extends Schema.TaggedErrorClass<InstallFailedError>()(
  "InstallFailedError",
  {},
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

export interface PromptsService {
  readonly text: (options: TextOptions) => Effect.Effect<string, PromptCancelledError>;
  readonly select: <T extends string>(
    options: SelectOptions<T>,
  ) => Effect.Effect<T, PromptCancelledError>;
  readonly confirm: (options: ConfirmOptions) => Effect.Effect<boolean, PromptCancelledError>;
}

export class Prompts extends Context.Service<
  Prompts,
  {
    readonly text: (options: TextOptions) => Effect.Effect<string, PromptCancelledError>;
    readonly select: <T extends string>(
      options: SelectOptions<T>,
    ) => Effect.Effect<T, PromptCancelledError>;
    readonly confirm: (options: ConfirmOptions) => Effect.Effect<boolean, PromptCancelledError>;
  }
>()("trygg/Prompts") {}
