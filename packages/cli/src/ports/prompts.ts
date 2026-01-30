/**
 * Prompts Service Port
 *
 * Effect-based wrapper for @clack/prompts
 * @since 1.0.0
 */
import { Context, Effect, Data } from "effect";

// === Error Types ===

export class PromptCancelledError extends Data.TaggedError("PromptCancelledError")<{
  readonly message: string;
}> {
  static readonly default = new PromptCancelledError({ message: "Prompt cancelled" });
}

export class InvalidProjectNameError extends Data.TaggedError("InvalidProjectNameError")<{
  readonly name: string;
}> {}

export class DirectoryExistsError extends Data.TaggedError("DirectoryExistsError")<{
  readonly path: string;
}> {}

export class InstallFailedError extends Data.TaggedError("InstallFailedError")<{}> {}

// === Prompt Option Types ===

export interface TextOptions {
  readonly message: string;
  readonly placeholder?: string;
  readonly defaultValue?: string;
  readonly validate?: (value: string) => string | undefined;
}

export interface SelectOption<T> {
  readonly value: T;
  readonly label: string;
  readonly hint?: string;
}

export interface SelectOptions<T> {
  readonly message: string;
  readonly options: ReadonlyArray<SelectOption<T>>;
  readonly initialValue?: T;
}

export interface ConfirmOptions {
  readonly message: string;
  readonly initialValue?: boolean;
}

// === Service Interface ===

export interface Prompts {
  readonly text: (options: TextOptions) => Effect.Effect<string, PromptCancelledError>;
  readonly select: <T>(options: SelectOptions<T>) => Effect.Effect<T, PromptCancelledError>;
  readonly confirm: (options: ConfirmOptions) => Effect.Effect<boolean, PromptCancelledError>;
}

export const Prompts = Context.GenericTag<Prompts>("@trygg/Prompts");
