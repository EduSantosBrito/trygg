/**
 * @since 1.0.0
 * Observer Service
 *
 * Observe DOM visibility and mutations with lifecycle.
 * Auto-disconnects on scope close.
 */
import { Effect, Layer, Schema, Scope } from "effect";
import * as Context from "effect/Context";

// =============================================================================
// Error type
// =============================================================================

export class ObserverError extends Schema.TaggedErrorClass<ObserverError>()("ObserverError", {
  operation: Schema.String,
  cause: Schema.Unknown,
}) {}

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
    handler: (mutations: ReadonlyArray<MutationRecord>) => Effect.Effect<void>,
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
  readonly triggerMutation: (
    target: Node,
    mutations: ReadonlyArray<MutationRecord>,
  ) => Effect.Effect<void>;
}

export interface TestObserver extends Context.Service<
  TestObserver,
  {
    readonly triggerIntersection: (
      el: Element,
      entry?: Partial<IntersectionObserverEntry>,
    ) => Effect.Effect<void>;
    readonly triggerMutation: (
      target: Node,
      mutations: ReadonlyArray<MutationRecord>,
    ) => Effect.Effect<void>;
  }
> {}

export const TestObserver = Context.Service<
  TestObserver,
  {
    readonly triggerIntersection: (
      el: Element,
      entry?: Partial<IntersectionObserverEntry>,
    ) => Effect.Effect<void>;
    readonly triggerMutation: (
      target: Node,
      mutations: ReadonlyArray<MutationRecord>,
    ) => Effect.Effect<void>;
  }
>("trygg/platform/TestObserver");

// =============================================================================
// Tag
// =============================================================================

export interface Observer extends Context.Service<
  Observer,
  {
    readonly intersection: (
      options: IntersectionOptions,
    ) => Effect.Effect<IntersectionHandle, never, Scope.Scope>;
    readonly mutation: (
      target: Node,
      options: MutationObserverInit,
      handler: (mutations: ReadonlyArray<MutationRecord>) => Effect.Effect<void>,
    ) => Effect.Effect<void, never, Scope.Scope>;
  }
> {}

export const Observer = Context.Service<
  Observer,
  {
    readonly intersection: (
      options: IntersectionOptions,
    ) => Effect.Effect<IntersectionHandle, never, Scope.Scope>;
    readonly mutation: (
      target: Node,
      options: MutationObserverInit,
      handler: (mutations: ReadonlyArray<MutationRecord>) => Effect.Effect<void>,
    ) => Effect.Effect<void, never, Scope.Scope>;
  }
>("trygg/platform/Observer");

// =============================================================================
// Browser layer
// =============================================================================

export const browser: Layer.Layer<Observer> = Layer.succeed(
  Observer,
  Observer.of({
    intersection: (options) =>
      Effect.gen(function* () {
        const scope = yield* Effect.scope;
        const services = yield* Effect.context();

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
              Effect.runForkWith(services)(
                Effect.forkIn(options.onIntersect(entry), scope, { startImmediately: true }),
              );
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
        const scope = yield* Effect.scope;
        const services = yield* Effect.context();

        const observer = new MutationObserver((mutations) => {
          Effect.runForkWith(services)(
            Effect.forkIn(handler(mutations), scope, { startImmediately: true }),
          );
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

export const test: Layer.Layer<Observer | TestObserver> = Layer.syncContext(() => {
  const intersectionHandlers = new Map<
    Element,
    (entry: IntersectionObserverEntry) => Effect.Effect<void>
  >();
  const mutationHandlers = new Map<
    Node,
    (mutations: ReadonlyArray<MutationRecord>) => Effect.Effect<void>
  >();

  const observerService: ObserverService = {
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
  };

  const testObserverService = TestObserver.of({
    triggerIntersection: (el, entry) =>
      Effect.gen(function* () {
        const handler = intersectionHandlers.get(el);
        if (handler !== undefined) {
          const rect = el.getBoundingClientRect();
          const mockEntry: IntersectionObserverEntry = {
            target: el,
            isIntersecting: true,
            intersectionRatio: 1,
            boundingClientRect: rect,
            intersectionRect: rect,
            rootBounds: null,
            time: 0,
            ...entry,
          };
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
  });

  return Context.make(Observer, Observer.of(observerService)).pipe(
    Context.add(TestObserver, testObserverService),
  );
});
