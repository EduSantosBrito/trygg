/**
 * @since 1.0.0
 * Observer Service
 *
 * Observe DOM visibility and mutations with lifecycle.
 * Auto-disconnects on scope close.
 */
import { Context, Data, Effect, Layer, Runtime, Scope } from "effect";

// =============================================================================
// Error type
// =============================================================================

export class ObserverError extends Data.TaggedError("ObserverError")<{
  readonly operation: string;
  readonly cause: unknown;
}> {}

// =============================================================================
// Types
// =============================================================================

export interface IntersectionOptions {
  readonly threshold?: number;
  readonly rootMargin?: string;
  readonly onIntersect: (entry: IntersectionObserverEntry) => Effect.Effect<void>;
}

export interface IntersectionHandle {
  readonly observe: (el: Element) => Effect.Effect<void>;
  readonly unobserve: (el: Element) => Effect.Effect<void>;
}

// =============================================================================
// Service interface
// =============================================================================

export interface ObserverService {
  readonly intersection: (
    options: IntersectionOptions,
  ) => Effect.Effect<IntersectionHandle, never, Scope.Scope>;

  readonly mutation: (
    target: Node,
    options: MutationObserverInit,
    handler: (mutations: Array<MutationRecord>) => Effect.Effect<void>,
  ) => Effect.Effect<void, never, Scope.Scope>;
}

// =============================================================================
// Test-only interface
// =============================================================================

export interface TestObserverService extends ObserverService {
  readonly triggerIntersection: (
    el: Element,
    entry?: Partial<IntersectionObserverEntry>,
  ) => Effect.Effect<void>;
  readonly triggerMutation: (target: Node, mutations: Array<MutationRecord>) => Effect.Effect<void>;
}

// =============================================================================
// Tag
// =============================================================================

export class Observer extends Context.Tag("effect-ui/platform/Observer")<
  Observer,
  ObserverService
>() {}

// =============================================================================
// Browser layer
// =============================================================================

export const browser: Layer.Layer<Observer> = Layer.succeed(
  Observer,
  Observer.of({
    intersection: (options) =>
      Effect.gen(function* () {
        const runtime = yield* Effect.runtime<never>();
        const runFork = Runtime.runFork(runtime);

        const init: IntersectionObserverInit = {};
        if (options.threshold !== undefined) {
          init.threshold = options.threshold;
        }
        if (options.rootMargin !== undefined) {
          init.rootMargin = options.rootMargin;
        }

        const observer = new IntersectionObserver((entries) => {
          for (const entry of entries) {
            if (entry.isIntersecting) {
              runFork(options.onIntersect(entry));
            }
          }
        }, init);

        yield* Effect.addFinalizer(() =>
          Effect.sync(() => {
            observer.disconnect();
          }),
        );

        const handle: IntersectionHandle = {
          observe: (el) =>
            Effect.sync(() => {
              observer.observe(el);
            }),
          unobserve: (el) =>
            Effect.sync(() => {
              observer.unobserve(el);
            }),
        };

        return handle;
      }),

    mutation: (target, options, handler) =>
      Effect.gen(function* () {
        const runtime = yield* Effect.runtime<never>();
        const runFork = Runtime.runFork(runtime);

        const observer = new MutationObserver((mutations) => {
          runFork(handler(mutations));
        });

        observer.observe(target, options);

        yield* Effect.addFinalizer(() =>
          Effect.sync(() => {
            observer.disconnect();
          }),
        );
      }),
  }),
);

// =============================================================================
// Test layer
// =============================================================================

export const test: Layer.Layer<Observer> = Layer.effect(
  Observer,
  Effect.sync(() => {
    const intersectionHandlers = new Map<
      Element,
      (entry: IntersectionObserverEntry) => Effect.Effect<void>
    >();
    const mutationHandlers = new Map<
      Node,
      (mutations: Array<MutationRecord>) => Effect.Effect<void>
    >();

    const service: TestObserverService = {
      intersection: (options) =>
        Effect.gen(function* () {
          const handle: IntersectionHandle = {
            observe: (el) =>
              Effect.sync(() => {
                intersectionHandlers.set(el, options.onIntersect);
              }),
            unobserve: (el) =>
              Effect.sync(() => {
                intersectionHandlers.delete(el);
              }),
          };

          yield* Effect.addFinalizer(() =>
            Effect.sync(() => {
              // Clean up all registered elements on scope close
              for (const [el, h] of intersectionHandlers) {
                if (h === options.onIntersect) {
                  intersectionHandlers.delete(el);
                }
              }
            }),
          );

          return handle;
        }),

      mutation: (target, _options, handler) =>
        Effect.gen(function* () {
          mutationHandlers.set(target, handler);
          yield* Effect.addFinalizer(() =>
            Effect.sync(() => {
              mutationHandlers.delete(target);
            }),
          );
        }),

      triggerIntersection: (el, entry) =>
        Effect.gen(function* () {
          const handler = intersectionHandlers.get(el);
          if (handler !== undefined) {
            const mockEntry = {
              target: el,
              isIntersecting: true,
              intersectionRatio: 1,
              boundingClientRect: {} as DOMRectReadOnly,
              intersectionRect: {} as DOMRectReadOnly,
              rootBounds: null,
              time: 0,
              ...entry,
            } as IntersectionObserverEntry;
            yield* handler(mockEntry);
          }
        }),

      triggerMutation: (target, mutations) =>
        Effect.gen(function* () {
          const handler = mutationHandlers.get(target);
          if (handler !== undefined) {
            yield* handler(mutations);
          }
        }),
    };

    return Observer.of(service);
  }),
);
