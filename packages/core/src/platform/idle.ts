/**
 * @since 1.0.0
 * Idle Service
 *
 * Schedule low-priority work during browser idle periods.
 */
import { Effect, Layer, Schema, Scope } from "effect";
import * as Context from "effect/Context";

// =============================================================================
// Error type
// =============================================================================

export class IdleError extends Schema.TaggedErrorClass<IdleError>()("IdleError", {
  operation: Schema.String,
  cause: Schema.Unknown,
}) {}

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

export interface Idle extends Context.Service<
  Idle,
  {
    readonly request: (
      handler: () => Effect.Effect<void>,
      options?: { readonly timeout?: number },
    ) => Effect.Effect<void, never, Scope.Scope>;
  }
> {}

export const Idle = Context.Service<
  Idle,
  {
    readonly request: (
      handler: () => Effect.Effect<void>,
      options?: { readonly timeout?: number },
    ) => Effect.Effect<void, never, Scope.Scope>;
  }
>("trygg/platform/Idle");

// =============================================================================
// Browser layer
// =============================================================================

export const browser: Layer.Layer<Idle> = Layer.succeed(
  Idle,
  Idle.of({
    request: (handler, options) =>
      Effect.gen(function* () {
        const scope = yield* Effect.scope;
        const services = yield* Effect.context();
        const opts = options?.timeout !== undefined ? { timeout: options.timeout } : undefined;
        const id = requestIdleCallback(() => {
          Effect.runForkWith(services)(Effect.forkIn(handler(), scope, { startImmediately: true }));
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
