/**
 * @since 1.0.0
 * Idle Service
 *
 * Schedule low-priority work during browser idle periods.
 */
import { Context, Data, Effect, Layer, Runtime, Scope } from "effect";

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

export class Idle extends Context.Tag("trygg/platform/Idle")<Idle, IdleService>() {}

// =============================================================================
// Browser layer
// =============================================================================

export const browser: Layer.Layer<Idle> = Layer.succeed(
  Idle,
  Idle.of({
    request: (handler, options) =>
      Effect.gen(function* () {
        const runtime = yield* Effect.runtime<never>();
        const runFork = Runtime.runFork(runtime);
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
