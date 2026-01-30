/**
 * Live Implementation of Prompts Service using @clack/prompts
 * @since 1.0.0
 */
import { Effect, Layer } from "effect";
import * as clack from "@clack/prompts";
import {
  Prompts,
  PromptCancelledError,
  type TextOptions,
  type SelectOptions,
  type ConfirmOptions,
} from "../ports/prompts";

/**
 * Helper to run a clack prompt and handle cancellation
 */
const runPrompt = <T>(prompt: () => Promise<T | symbol>): Effect.Effect<T, PromptCancelledError> =>
  Effect.tryPromise({
    try: prompt,
    catch: () => PromptCancelledError.default,
  }).pipe(
    Effect.flatMap((result) =>
      clack.isCancel(result)
        ? Effect.fail(PromptCancelledError.default)
        : Effect.succeed(result as T),
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

const promptsImpl: Prompts = {
  text: (options: TextOptions) => runPrompt(() => clack.text(buildTextOptions(options))),

  select: <T>(options: SelectOptions<T>) =>
    runPrompt<T>(() => {
      const clackOpts = options.options.map((opt) => {
        if (opt.hint !== undefined) {
          return { value: opt.value, label: opt.label, hint: opt.hint };
        }
        return { value: opt.value, label: opt.label };
      });

      const selectOpts: clack.SelectOptions<T> = {
        message: options.message,
        options: clackOpts as unknown as clack.SelectOptions<T>["options"],
      };
      if (options.initialValue !== undefined) {
        selectOpts.initialValue = options.initialValue;
      }

      return clack.select(selectOpts);
    }),

  confirm: (options: ConfirmOptions) =>
    runPrompt(() => clack.confirm(buildConfirmOptions(options))),
};

export const PromptsLive = Layer.succeed(Prompts, promptsImpl);
