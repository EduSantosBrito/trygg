import { Effect, Schema } from "effect";
import { assert, describe, it } from "@effect/vitest";
import * as PromptsClack from "../adapters/prompts-live.js";
import {
  InvalidPromptResponseError,
  PromptCancelledError,
  PromptFailedError,
} from "../ports/prompts.js";

class TerminalUnavailable extends Schema.TaggedError<TerminalUnavailable>()(
  "TerminalUnavailable",
  {},
) {}

const isCancel = (value: unknown): value is symbol => typeof value === "symbol";

const successfulAdapter: PromptsClack.ClackPromptAdapter = {
  isCancel,
  text: () => Promise.resolve("project"),
  select: () => Promise.resolve("blank"),
  confirm: () => Promise.resolve(true),
};

describe("PromptsClack", () => {
  it.effect("should classify a cancellation symbol as PromptCancelledError", () =>
    Effect.gen(function* () {
      // Scope: verifies deliberate user cancellation at the terminal adapter boundary.
      // Assertion: cancellation has its own stable tag and is not reported as an adapter failure.
      const prompts = PromptsClack.make({
        ...successfulAdapter,
        text: () => Promise.resolve(Symbol("cancel")),
      });

      const error = yield* Effect.flip(prompts.text({ message: "Project name" }));

      assert.instanceOf(error, PromptCancelledError);
    }),
  );

  it.effect("should classify a rejected prompt promise as PromptFailedError", () =>
    Effect.gen(function* () {
      // Scope: verifies terminal and adapter failures remain distinct from user cancellation.
      // Assertion: the operation and original rejection cause remain available to the owner.
      const cause = new TerminalUnavailable();
      const prompts = PromptsClack.make({
        ...successfulAdapter,
        confirm: () => {
          const result = Promise.withResolvers<boolean | symbol>();
          result.reject(cause);
          return result.promise;
        },
      });

      const error = yield* Effect.flip(prompts.confirm({ message: "Continue?" }));

      assert.instanceOf(error, PromptFailedError);
      if (error instanceof PromptFailedError) {
        assert.strictEqual(error.operation, "confirm");
        assert.strictEqual(error.cause, cause);
      }
    }),
  );

  it.effect("should classify an unknown select value as InvalidPromptResponseError", () =>
    Effect.gen(function* () {
      // Scope: verifies values outside the offered protocol are not treated as cancellation.
      // Assertion: the invalid value and select operation remain typed in the failure channel.
      const prompts = PromptsClack.make({
        ...successfulAdapter,
        select: () => Promise.resolve("not-offered"),
      });

      const error = yield* Effect.flip(
        prompts.select({
          message: "Template",
          options: [{ value: "blank", label: "Blank" }],
        }),
      );

      assert.instanceOf(error, InvalidPromptResponseError);
      if (error instanceof InvalidPromptResponseError) {
        assert.strictEqual(error.operation, "select");
        assert.strictEqual(error.value, "not-offered");
      }
    }),
  );
});
