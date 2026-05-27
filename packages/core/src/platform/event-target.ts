/**
 * @since 1.0.0
 * EventTarget Service
 *
 * Subscribe to DOM events with automatic lifecycle management.
 * Internally acquires a runtime, creates a sync listener that forks the handler,
 * and registers a finalizer that removes the listener.
 */
import { Effect, Layer, Schema, Scope } from "effect";
import * as Context from "effect/Context";

// =============================================================================
// Error type
// =============================================================================

export class EventTargetError extends Schema.TaggedErrorClass<EventTargetError>()(
  "EventTargetError",
  {
    operation: Schema.String,
    cause: Schema.Unknown,
  },
) {}

// =============================================================================
// Service interface
// =============================================================================

export interface EventTargetService {
  readonly on: (
    target: EventTarget,
    event: string,
    handler: (event: Event) => Effect.Effect<void>,
  ) => Effect.Effect<void, never, Scope.Scope>;
  readonly dispatch: (target: EventTarget, event: string, data: Event) => Effect.Effect<void>;
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
    ) => Effect.Effect<void, never, Scope.Scope>;
    readonly dispatch: (target: EventTarget, event: string, data: Event) => Effect.Effect<void>;
  }
> {}

export const PlatformEventTarget = Context.Service<
  PlatformEventTarget,
  {
    readonly on: (
      target: EventTarget,
      event: string,
      handler: (event: Event) => Effect.Effect<void>,
    ) => Effect.Effect<void, never, Scope.Scope>;
    readonly dispatch: (target: EventTarget, event: string, data: Event) => Effect.Effect<void>;
  }
>("trygg/platform/EventTarget");

// =============================================================================
// Browser layer
// =============================================================================

export const browser: Layer.Layer<PlatformEventTarget> = Layer.succeed(
  PlatformEventTarget,
  PlatformEventTarget.of({
    on: (target, event, handler) =>
      Effect.gen(function* () {
        const scope = yield* Effect.scope;
        const services = yield* Effect.context();
        const listener = (e: Event) => {
          Effect.runForkWith(services)(
            Effect.forkIn(handler(e), scope, { startImmediately: true }),
          );
        };
        yield* Effect.sync(() => {
          target.addEventListener(event, listener);
        });
        yield* Effect.addFinalizer(() =>
          Effect.sync(() => {
            target.removeEventListener(event, listener);
          }),
        );
      }),
    dispatch: (target, _event, data) =>
      Effect.sync(() => {
        target.dispatchEvent(data);
      }),
  }),
);

// =============================================================================
// Test layer
// =============================================================================

export const test: Layer.Layer<PlatformEventTarget> = Layer.sync(PlatformEventTarget, () => {
  const handlers = new Map<string, Array<(e: Event) => Effect.Effect<void>>>();
  const targetIds = new WeakMap<EventTarget, string>();
  let nextTargetId = 0;

  const makeKey = (target: EventTarget, event: string): string => {
    const existing = targetIds.get(target);
    if (existing !== undefined) {
      return `${existing}:${event}`;
    }
    const id = `target-${nextTargetId}`;
    nextTargetId += 1;
    targetIds.set(target, id);
    return `${id}:${event}`;
  };

  const service: TestEventTargetService = {
    on: (target, event, handler) =>
      Effect.gen(function* () {
        const key = makeKey(target, event);
        const existing = handlers.get(key) ?? [];
        existing.push(handler);
        handlers.set(key, existing);
        yield* Effect.addFinalizer(() =>
          Effect.sync(() => {
            const list = handlers.get(key);
            if (list !== undefined) {
              const idx = list.indexOf(handler);
              if (idx >= 0) {
                list.splice(idx, 1);
              }
            }
          }),
        );
      }),

    dispatch: (target, event, data) =>
      Effect.gen(function* () {
        const key = makeKey(target, event);
        const list = handlers.get(key) ?? [];
        for (const h of list) {
          yield* h(data);
        }
      }),
  };

  return PlatformEventTarget.of(service);
});
