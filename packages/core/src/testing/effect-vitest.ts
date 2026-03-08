import { it } from "@effect/vitest";
import { Effect, Scope } from "effect";
import type { TestContext, TestOptions } from "vitest";

export const scoped = <A, E>(
  name: string,
  self: (context: TestContext) => Effect.Effect<A, E, Scope.Scope>,
  timeout?: number | TestOptions,
): void => {
  it.effect(name, (context): Effect.Effect<A, E> => Effect.scoped(self(context)), timeout);
};
