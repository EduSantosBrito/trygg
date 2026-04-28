import { Effect } from "effect";
import * as Context from "effect/Context";

export const getFiberRef = <A>(reference: Context.Reference<A>): Effect.Effect<A, never, never> =>
  Effect.withFiber((fiber) => Effect.sync(() => fiber.getRef(reference)));

export const setFiberRef = <A>(
  reference: Context.Reference<A>,
  value: A,
): Effect.Effect<void, never, never> =>
  Effect.withFiber((fiber) =>
    Effect.sync(() => {
      fiber.setContext(Context.add(fiber.context, reference, value));
    }),
  );

export const locallyFiberRef = <A, B, E, R>(
  reference: Context.Reference<A>,
  value: A,
  effect: Effect.Effect<B, E, R>,
): Effect.Effect<B, E, R> =>
  Effect.withFiber((fiber) => {
    const context = fiber.context;
    fiber.setContext(Context.add(context, reference, value));
    return Effect.ensuring(
      effect,
      Effect.sync(() => {
        fiber.setContext(context);
      }),
    );
  });
