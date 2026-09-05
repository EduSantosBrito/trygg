/**
 * @since 1.0.0
 * Idle Service
 *
 * Schedule low-priority work during browser idle periods.
 */
import { Cause, Effect, Layer, Schema, Scope } from "effect";
import * as Context from "effect/Context";

// =============================================================================
// Error type
// =============================================================================

export class IdleError extends Schema.TaggedError<IdleError>()("IdleError", {
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
  ) => Effect.Effect<void, IdleError, Scope.Scope>;
}

export interface TestIdleService {
  readonly flush: Effect.Effect<void>;
  readonly pendingCount: Effect.Effect<number>;
  readonly requestCount: Effect.Effect<number>;
  readonly cancellationCount: Effect.Effect<number>;
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
    ) => Effect.Effect<void, IdleError, Scope.Scope>;
  }
> {}

export const Idle = Context.Service<
  Idle,
  {
    readonly request: (
      handler: () => Effect.Effect<void>,
      options?: { readonly timeout?: number },
    ) => Effect.Effect<void, IdleError, Scope.Scope>;
  }
>("trygg/platform/Idle");

export interface TestIdle extends Context.Service<TestIdle, TestIdleService> {}

export const TestIdle = Context.Service<
  TestIdle,
  {
    readonly flush: Effect.Effect<void>;
    readonly pendingCount: Effect.Effect<number>;
    readonly requestCount: Effect.Effect<number>;
    readonly cancellationCount: Effect.Effect<number>;
  }
>("trygg/platform/TestIdle");

// =============================================================================
// Browser layer
// =============================================================================

const reportCallbackFailure = (cause: Cause.Cause<never>): Effect.Effect<void> =>
  Cause.hasInterruptsOnly(cause)
    ? Effect.void
    : Effect.logError("Idle handler failed", Cause.pretty(cause));

export const browser: Layer.Layer<Idle, IdleError> = Layer.effect(
  Idle,
  Effect.gen(function* () {
    const requestIdle = globalThis.requestIdleCallback;
    const cancelIdle = globalThis.cancelIdleCallback;
    if (typeof requestIdle !== "function" || typeof cancelIdle !== "function") {
      return yield* new IdleError({
        operation: "initialize",
        cause: "requestIdleCallback and cancelIdleCallback are required",
      });
    }

    return Idle.of({
      request: (handler, options) =>
        Effect.gen(function* () {
          const scope = yield* Effect.scope;
          const services = yield* Effect.context();
          const opts = options?.timeout !== undefined ? { timeout: options.timeout } : undefined;

          yield* Effect.acquireRelease(
            Effect.try({
              try: () =>
                requestIdle(() => {
                  // A queued host callback must not start after cancellation
                  // closed its owner. forkIn registers before user code runs.
                  Effect.runSyncWith(services)(
                    Effect.forkIn(
                      Effect.suspend(handler).pipe(
                        Effect.onError(reportCallbackFailure),
                        Effect.provide(services),
                      ),
                      scope,
                    ),
                  );
                }, opts),
              catch: (cause) => new IdleError({ operation: "requestIdleCallback", cause }),
            }),
            (id) =>
              Effect.try({
                try: () => cancelIdle(id),
                catch: (cause) => new IdleError({ operation: "cancelIdleCallback", cause }),
              }).pipe(
                Effect.catch((error) => Effect.logError("Idle callback cleanup failed", error)),
              ),
          );
        }),
    });
  }).pipe(Effect.annotateLogs({ service: "Idle" })),
);

// =============================================================================
// Test layer
// =============================================================================

export const test: Layer.Layer<Idle | TestIdle> = Layer.syncContext(() => {
  const pending = new Map<number, () => void>();
  let nextId = 1;
  let requests = 0;
  let cancellations = 0;

  const idleService = Idle.of({
    request: (handler, _options) =>
      Effect.gen(function* () {
        const scope = yield* Effect.scope;
        const services = yield* Effect.context();

        yield* Effect.acquireRelease(
          Effect.sync(() => {
            const id = nextId++;
            requests++;
            pending.set(id, () => {
              Effect.runSyncWith(services)(
                Effect.forkIn(
                  Effect.suspend(handler).pipe(
                    Effect.onError(reportCallbackFailure),
                    Effect.provide(services),
                  ),
                  scope,
                ),
              );
            });
            return id;
          }),
          (id) =>
            Effect.sync(() => {
              cancellations++;
              pending.delete(id);
            }),
        );
      }),
  });

  const testIdleService = TestIdle.of({
    flush: Effect.sync(() => {
      const callbacks = Array.from(pending.values());
      pending.clear();
      for (const callback of callbacks) callback();
    }),
    pendingCount: Effect.sync(() => pending.size),
    requestCount: Effect.sync(() => requests),
    cancellationCount: Effect.sync(() => cancellations),
  });

  return Context.make(Idle, idleService).pipe(Context.add(TestIdle, testIdleService));
});
