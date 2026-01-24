/**
 * @since 1.0.0
 * EventTarget Service
 *
 * Subscribe to DOM events with automatic lifecycle management.
 * Internally acquires a runtime, creates a sync listener that forks the handler,
 * and registers a finalizer that removes the listener.
 */
import { Context, Data, Effect, Layer, Runtime, Scope } from "effect";

// =============================================================================
// Error type
// =============================================================================

export class EventTargetError extends Data.TaggedError("EventTargetError")<{
  readonly operation: string;
  readonly cause: unknown;
}> {}

// =============================================================================
// Service interface
// =============================================================================

export interface EventTargetService {
  readonly on: <E extends Event>(
    target: EventTarget,
    event: string,
    handler: (e: E) => Effect.Effect<void>,
  ) => Effect.Effect<void, never, Scope.Scope>;
}

// =============================================================================
// Test-only interface (extends base with dispatch)
// =============================================================================

export interface TestEventTargetService extends EventTargetService {
  readonly dispatch: (target: EventTarget, event: string, data: Event) => Effect.Effect<void>;
}

// =============================================================================
// Tag
// =============================================================================

export class PlatformEventTarget extends Context.Tag("trygg/platform/EventTarget")<
  PlatformEventTarget,
  EventTargetService
>() {}

// =============================================================================
// Browser layer
// =============================================================================

export const browser: Layer.Layer<PlatformEventTarget> = Layer.succeed(
  PlatformEventTarget,
  PlatformEventTarget.of({
    on: (target, event, handler) =>
      Effect.gen(function* () {
        const runtime = yield* Effect.runtime<never>();
        const runFork = Runtime.runFork(runtime);
        const listener = (e: Event) => {
          runFork(handler(e as never));
        };
        target.addEventListener(event, listener);
        yield* Effect.addFinalizer(() =>
          Effect.sync(() => {
            target.removeEventListener(event, listener);
          }),
        );
      }),
  }),
);

// =============================================================================
// Test layer
// =============================================================================

export const test: Layer.Layer<PlatformEventTarget> = Layer.effect(
  PlatformEventTarget,
  Effect.sync(() => {
    const handlers = new Map<string, Array<(e: Event) => Effect.Effect<void>>>();

    const makeKey = (target: EventTarget, event: string): string => {
      // Use a simple identity scheme for test targets
      const id = Reflect.get(target, "__testId") ?? "default";
      return `${String(id)}:${event}`;
    };

    const service: TestEventTargetService = {
      on: (target, event, handler) =>
        Effect.gen(function* () {
          const key = makeKey(target, event);
          const existing = handlers.get(key) ?? [];
          existing.push(handler as (e: Event) => Effect.Effect<void>);
          handlers.set(key, existing);
          yield* Effect.addFinalizer(() =>
            Effect.sync(() => {
              const list = handlers.get(key);
              if (list !== undefined) {
                const idx = list.indexOf(handler as (e: Event) => Effect.Effect<void>);
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
  }),
);
