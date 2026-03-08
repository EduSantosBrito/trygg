import { Effect } from "effect";
import * as ServiceMap from "effect/ServiceMap";

export const getFiberRef = <A>(
  reference: ServiceMap.Reference<A>,
): Effect.Effect<A, never, never> =>
  Effect.withFiber((fiber) => Effect.sync(() => fiber.getRef(reference)));

export const setFiberRef = <A>(
  reference: ServiceMap.Reference<A>,
  value: A,
): Effect.Effect<void, never, never> =>
  Effect.withFiber((fiber) =>
    Effect.sync(() => {
      fiber.setServices(ServiceMap.add(fiber.services, reference, value));
    }),
  );

export const locallyFiberRef = <A, B, E, R>(
  reference: ServiceMap.Reference<A>,
  value: A,
  effect: Effect.Effect<B, E, R>,
): Effect.Effect<B, E, R> =>
  Effect.withFiber((fiber) => {
    const services = fiber.services;
    fiber.setServices(ServiceMap.add(services, reference, value));
    return Effect.ensuring(
      effect,
      Effect.sync(() => {
        fiber.setServices(services);
      }),
    );
  });
