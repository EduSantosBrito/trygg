/**
 * Live Implementation of Prompts Service using @clack/prompts
 * @since 1.0.0
 */
import { Effect, Layer } from "effect";
import * as clack from "@clack/prompts";
import {
  Prompts,
  PromptCancelledError,
  PromptFailedError,
  InvalidPromptResponseError,
  type PromptsService,
  type TextOptions,
  type SelectOptions,
  type ConfirmOptions,
} from "../ports/prompts";

export interface ClackPromptAdapter {
  readonly isCancel: (value: unknown) => value is symbol;
  readonly text: (options: clack.TextOptions) => Promise<string | symbol>;
  readonly select: (options: clack.SelectOptions<string>) => Promise<string | symbol>;
  readonly confirm: (options: clack.ConfirmOptions) => Promise<boolean | symbol>;
}

/**
 * Helper to run a clack prompt and handle cancellation
 */
const runPrompt = <T>(
  adapter: ClackPromptAdapter,
  operation: "text" | "select" | "confirm",
  prompt: () => Promise<T | symbol>,
) =>
  Effect.tryPromise({
    try: prompt,
    catch: (cause) => new PromptFailedError({ operation, cause }),
  }).pipe(
    Effect.flatMap((result) =>
      adapter.isCancel(result) ? Effect.fail(PromptCancelledError.default) : Effect.succeed(result),
    ),
  );

/**
 * Build clack text options
 */
const buildTextOptions = (options: TextOptions): clack.TextOptions => {
  const result: clack.TextOptions = { message: options.message };
  if (options.placeholder !== undefined) result.placeholder = options.placeholder;
  if (options.defaultValue !== undefined) result.defaultValue = options.defaultValue;
  if (options.validate !== undefined) result.validate = options.validate;
  return result;
};

/**
 * Build clack confirm options
 */
const buildConfirmOptions = (options: ConfirmOptions): clack.ConfirmOptions => {
  const result: clack.ConfirmOptions = { message: options.message };
  if (options.initialValue !== undefined) result.initialValue = options.initialValue;
  return result;
};

export const make = (adapter: ClackPromptAdapter): PromptsService => ({
  text: (options: TextOptions) =>
    runPrompt(adapter, "text", () => adapter.text(buildTextOptions(options))),

  select: <T extends string>(options: SelectOptions<T>) =>
    runPrompt(adapter, "select", () => {
      const clackOpts = options.options.map((opt) => {
        if (opt.hint !== undefined) {
          return { value: opt.value, label: opt.label, hint: opt.hint };
        }
        return { value: opt.value, label: opt.label };
      });

      const selectOpts: clack.SelectOptions<string> = {
        message: options.message,
        options: clackOpts,
      };
      if (options.initialValue !== undefined) {
        selectOpts.initialValue = options.initialValue;
      }

      return adapter.select(selectOpts);
    }).pipe(
      Effect.flatMap((selected) => {
        const matched = options.options.find((option) => option.value === selected);
        return matched === undefined
          ? Effect.fail(new InvalidPromptResponseError({ operation: "select", value: selected }))
          : Effect.succeed(matched.value);
      }),
    ),

  confirm: (options: ConfirmOptions) =>
    runPrompt(adapter, "confirm", () => adapter.confirm(buildConfirmOptions(options))),
});

export const layer = Layer.succeed(Prompts, make(clack));
