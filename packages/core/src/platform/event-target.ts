/**
 * @since 1.0.0
 * EventTarget Service
 *
 * Subscribe to DOM events with automatic lifecycle management.
 * Internally acquires a runtime, creates a sync listener that forks the handler,
 * and registers a finalizer that removes the listener.
 */
import { Cause, Effect, Layer, Schema, Scope } from "effect";
import * as Context from "effect/Context";

// =============================================================================
// Error type
// =============================================================================

export class EventTargetError extends Schema.TaggedError<EventTargetError>()("EventTargetError", {
  operation: Schema.String,
  cause: Schema.Unknown,
}) {}

// =============================================================================
// Service interface
// =============================================================================

export interface EventTargetService {
  readonly on: (
    target: EventTarget,
    event: string,
    handler: (event: Event) => Effect.Effect<void>,
  ) => Effect.Effect<void, EventTargetError, Scope.Scope>;
  readonly dispatch: (
    target: EventTarget,
    event: string,
    data: Event,
  ) => Effect.Effect<void, EventTargetError>;
}

// =============================================================================
// Test-only alias retained for tests that name the test service surface.
// =============================================================================

export interface TestEventTargetService extends EventTargetService {}

// =============================================================================
// Tag
// =============================================================================

export interface PlatformEventTarget extends Context.Service<
  PlatformEventTarget,
  {
    readonly on: (
      target: EventTarget,
      event: string,
      handler: (event: Event) => Effect.Effect<void>,
    ) => Effect.Effect<void, EventTargetError, Scope.Scope>;
    readonly dispatch: (
      target: EventTarget,
      event: string,
      data: Event,
    ) => Effect.Effect<void, EventTargetError>;
  }
> {}

export const PlatformEventTarget = Context.Service<
  PlatformEventTarget,
  {
    readonly on: (
      target: EventTarget,
      event: string,
      handler: (event: Event) => Effect.Effect<void>,
    ) => Effect.Effect<void, EventTargetError, Scope.Scope>;
    readonly dispatch: (
      target: EventTarget,
      event: string,
      data: Event,
    ) => Effect.Effect<void, EventTargetError>;
  }
>("trygg/platform/EventTarget");

// =============================================================================
// Browser layer
// =============================================================================

const reportCallbackFailure = (cause: Cause.Cause<never>): Effect.Effect<void> =>
  Cause.hasInterruptsOnly(cause)
    ? Effect.void
    : Effect.logError("EventTarget handler failed", Cause.pretty(cause));

const removeListener = (
  target: EventTarget,
  event: string,
  listener: EventListener,
): Effect.Effect<void> =>
  Effect.try({
    try: () => target.removeEventListener(event, listener),
    catch: (cause) => new EventTargetError({ operation: "removeEventListener", cause }),
  }).pipe(Effect.catch((error) => Effect.logError("EventTarget listener cleanup failed", error)));

export const browser: Layer.Layer<PlatformEventTarget> = Layer.succeed(
  PlatformEventTarget,
  PlatformEventTarget.of({
    on: (target, event, handler) =>
      Effect.gen(function* () {
        const scope = yield* Effect.scope;
        const services = yield* Effect.context();
        const listener = (e: Event) => {
          // Register ownership before the first user instruction, including
          // callbacks already queued when the host removes the listener.
          Effect.runSyncWith(services)(
            Effect.forkIn(
              Effect.suspend(() => handler(e)).pipe(
                Effect.onError(reportCallbackFailure),
                Effect.provide(services),
              ),
              scope,
            ),
          );
        };
        yield* Effect.acquireRelease(
          Effect.try({
            try: () => {
              target.addEventListener(event, listener);
              return listener;
            },
            catch: (cause) => new EventTargetError({ operation: "addEventListener", cause }),
          }),
          (registered) => removeListener(target, event, registered),
        );
      }),
    dispatch: (target, _event, data) =>
      Effect.try({
        try: () => {
          target.dispatchEvent(data);
        },
        catch: (cause) => new EventTargetError({ operation: "dispatchEvent", cause }),
      }),
  }),
);

// =============================================================================
// Test layer
// =============================================================================

export const test: Layer.Layer<PlatformEventTarget> = browser;
