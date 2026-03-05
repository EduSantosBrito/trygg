/**
 * @since 1.0.0
 * Idle Service
 *
 * Schedule low-priority work during browser idle periods.
 */
import { Data, Effect, Layer, Scope } from "effect";
import * as ServiceMap from "effect/ServiceMap";

// =============================================================================
// Error type
// =============================================================================

export class IdleError extends Data.TaggedError("IdleError")<{
  readonly operation: string;
  readonly cause: unknown;
}> {}

// =============================================================================
// Service interface
// =============================================================================

export interface IdleService {
  readonly request: (
    handler: () => Effect.Effect<void>,
    options?: { readonly timeout?: number },
  ) => Effect.Effect<void, never, Scope.Scope>;
}

// =============================================================================
// Tag
// =============================================================================

export interface Idle extends ServiceMap.Service<Idle, IdleService> {}

export const Idle = ServiceMap.Service<Idle, IdleService>("trygg/platform/Idle");

// =============================================================================
// Browser layer
// =============================================================================

export const browser: Layer.Layer<Idle> = Layer.succeed(
  Idle,
  Idle.of({
    request: (handler, options) =>
      Effect.gen(function* () {
        const services = yield* Effect.services();
        const runFork = Effect.runForkWith(services);
        const opts = options?.timeout !== undefined ? { timeout: options.timeout } : undefined;
        const id = requestIdleCallback(() => {
          runFork(handler());
        }, opts);
        yield* Effect.addFinalizer(() =>
          Effect.sync(() => {
            cancelIdleCallback(id);
          }),
        );
      }),
  }),
);

// =============================================================================
// Test layer
// =============================================================================

export const test: Layer.Layer<Idle> = Layer.succeed(
  Idle,
  Idle.of({
    request: (handler, _options) =>
      // Test layer executes handler immediately (no idle scheduling)
      handler(),
  }),
);
