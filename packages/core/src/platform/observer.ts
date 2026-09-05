/**
 * @since 1.0.0
 * Observer Service
 *
 * Observe DOM visibility and mutations with lifecycle.
 * Auto-disconnects on scope close. Retained intersection handles reject operations
 * with ObserverError once their owner begins shutdown; callbacks retain the
 * registering caller's Effect context and Scheduler.
 */
import { Cause, Effect, Fiber, Layer, Predicate, Schema, Scope } from "effect";
import * as Context from "effect/Context";

// =============================================================================
// Error type
// =============================================================================

export class ObserverError extends Schema.TaggedError<ObserverError>()("ObserverError", {
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
  readonly observe: (el: Element) => Effect.Effect<void, ObserverError>;
  readonly unobserve: (el: Element) => Effect.Effect<void, ObserverError>;
}

// =============================================================================
// Service interface
// =============================================================================

export interface ObserverService {
  readonly intersection: (
    options: IntersectionOptions,
  ) => Effect.Effect<IntersectionHandle, ObserverError, Scope.Scope>;

  readonly mutation: (
    target: Node,
    options: MutationObserverInit,
    handler: (mutations: ReadonlyArray<MutationRecord>) => Effect.Effect<void>,
  ) => Effect.Effect<void, ObserverError, Scope.Scope>;
}

// =============================================================================
// Test-only interface
// =============================================================================

export interface TestObserverService {
  readonly triggerIntersection: (
    el: Element,
    entry?: Partial<IntersectionObserverEntry>,
  ) => Effect.Effect<void>;
  readonly triggerMutation: (
    target: Node,
    mutations: ReadonlyArray<MutationRecord>,
  ) => Effect.Effect<void>;
  readonly drain: Effect.Effect<void>;
}

export interface TestObserver extends Context.Service<TestObserver, TestObserverService> {}

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
    readonly drain: Effect.Effect<void>;
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
    ) => Effect.Effect<IntersectionHandle, ObserverError, Scope.Scope>;
    readonly mutation: (
      target: Node,
      options: MutationObserverInit,
      handler: (mutations: ReadonlyArray<MutationRecord>) => Effect.Effect<void>,
    ) => Effect.Effect<void, ObserverError, Scope.Scope>;
  }
> {}

export const Observer = Context.Service<
  Observer,
  {
    readonly intersection: (
      options: IntersectionOptions,
    ) => Effect.Effect<IntersectionHandle, ObserverError, Scope.Scope>;
    readonly mutation: (
      target: Node,
      options: MutationObserverInit,
      handler: (mutations: ReadonlyArray<MutationRecord>) => Effect.Effect<void>,
    ) => Effect.Effect<void, ObserverError, Scope.Scope>;
  }
>("trygg/platform/Observer");

// =============================================================================
// Browser layer
// =============================================================================

const reportCallbackFailure =
  (operation: string) =>
  (cause: Cause.Cause<unknown>): Effect.Effect<void> =>
    Cause.hasInterruptsOnly(cause)
      ? Effect.void
      : Effect.logError(`Observer ${operation} handler failed`, Cause.pretty(cause));

interface CallbackRegistration {
  readonly owner: Scope.Scope;
  readonly scope: Scope.Closeable;
  readonly services: Context.Context<Scope.Scope>;
  readonly activeHandlers: Set<Fiber.Fiber<void, unknown>>;
  closed: boolean;
}

const makeCallbackRegistration: (
  activeHandlers?: Set<Fiber.Fiber<void, unknown>>,
) => Effect.Effect<CallbackRegistration, never, Scope.Scope> = Effect.fnUntraced(function* (
  activeHandlers: Set<Fiber.Fiber<void, unknown>> = new Set(),
) {
  const ownerScope = yield* Effect.scope;
  const scope = yield* Scope.fork(ownerScope);
  const services = Context.add(yield* Effect.context(), Scope.Scope, scope);
  return { owner: ownerScope, scope, services, activeHandlers, closed: false };
});

const isRegistrationClosed = (registration: CallbackRegistration): boolean =>
  registration.closed ||
  Predicate.isTagged(registration.owner.state, "Closed") ||
  Predicate.isTagged(registration.scope.state, "Closed");

const useRegistration = (
  registration: CallbackRegistration,
  operation: string,
  action: () => void,
): Effect.Effect<void, ObserverError> =>
  Effect.try({
    try: () => {
      // Admission and the native operation are one synchronous step, including
      // when the owner is draining a different finalizer before disconnect.
      if (isRegistrationClosed(registration)) return false;
      action();
      return true;
    },
    catch: (cause) => new ObserverError({ operation, cause }),
  }).pipe(
    Effect.flatMap((active) =>
      active
        ? Effect.void
        : new ObserverError({ operation, cause: "Observer registration is closed" }),
    ),
  );

const launchCallback = (
  registration: CallbackRegistration,
  operation: string,
  handler: () => Effect.Effect<void, unknown>,
): void => {
  if (isRegistrationClosed(registration)) return;

  // forkIn schedules the handler before returning but attaches it to the
  // registration scope before the first handler instruction can run. Install
  // captured services inside the child so the launcher's synchronous Scheduler
  // does not replace the handler's configured execution policy.
  const fiber = Effect.runSyncWith(registration.services)(
    Effect.forkIn(
      Effect.suspend(handler).pipe(
        Effect.onError(reportCallbackFailure(operation)),
        Effect.provide(registration.services),
      ),
      registration.scope,
    ),
  );
  registration.activeHandlers.add(fiber);
  fiber.addObserver(() => registration.activeHandlers.delete(fiber));
};

const drainActiveHandlers = (
  activeHandlers: Set<Fiber.Fiber<void, unknown>>,
): Effect.Effect<void> =>
  Effect.suspend(() => {
    if (activeHandlers.size === 0) return Effect.void;
    return Fiber.awaitAll(Array.from(activeHandlers)).pipe(
      Effect.asVoid,
      Effect.andThen(drainActiveHandlers(activeHandlers)),
    );
  });

interface NativeObserver {
  readonly disconnect: () => void;
  readonly takeRecords?: () => unknown;
}

interface NativeObserverRegistration<Observer extends NativeObserver = NativeObserver> {
  readonly callback: CallbackRegistration;
  readonly observer: Observer;
}

const closeNativeObserver: (
  registration: NativeObserverRegistration,
  operation: string,
) => Effect.Effect<void> = Effect.fnUntraced(function* (
  registration: NativeObserverRegistration,
  operation: string,
) {
  const errors = yield* Effect.sync(() => {
    const failures: Array<ObserverError> = [];
    registration.callback.closed = true;

    /* oxlint-disable effect/no-try-catch -- Both native calls must stay in one synchronous release section while preserving each failure. */
    try {
      registration.observer.takeRecords?.();
    } catch (cause) {
      failures.push(new ObserverError({ operation: `${operation}.takeRecords`, cause }));
    }

    try {
      registration.observer.disconnect();
    } catch (cause) {
      failures.push(new ObserverError({ operation: `${operation}.disconnect`, cause }));
    }
    /* oxlint-enable effect/no-try-catch */

    return failures;
  });

  yield* Effect.forEach(errors, (error) => Effect.logError("Observer cleanup failed", error), {
    discard: true,
  });
});

export const browser: Layer.Layer<Observer, ObserverError> = Layer.effect(
  Observer,
  Effect.gen(function* () {
    const IntersectionObserverConstructor = globalThis.IntersectionObserver;
    const MutationObserverConstructor = globalThis.MutationObserver;
    if (
      typeof IntersectionObserverConstructor !== "function" ||
      typeof MutationObserverConstructor !== "function"
    ) {
      return yield* new ObserverError({
        operation: "initialize",
        cause: "IntersectionObserver and MutationObserver are required",
      });
    }

    return Observer.of({
      intersection: (options) =>
        Effect.gen(function* () {
          const callbackRegistration = yield* makeCallbackRegistration();

          const init: IntersectionObserverInit = {};
          if (options.threshold !== undefined) {
            init.threshold = options.threshold;
          }
          if (options.rootMargin !== undefined) {
            init.rootMargin = options.rootMargin;
          }

          const registration = yield* Effect.acquireRelease(
            Effect.try({
              try: () =>
                ({
                  callback: callbackRegistration,
                  observer: new IntersectionObserverConstructor((entries) => {
                    if (isRegistrationClosed(callbackRegistration)) return;
                    for (const entry of entries) {
                      if (entry.isIntersecting) {
                        launchCallback(callbackRegistration, "intersection", () =>
                          options.onIntersect(entry),
                        );
                      }
                    }
                  }, init),
                }) satisfies NativeObserverRegistration<IntersectionObserver>,
              catch: (cause) => new ObserverError({ operation: "intersection.create", cause }),
            }),
            (current) => closeNativeObserver(current, "intersection"),
          );

          return {
            observe: (el) =>
              useRegistration(callbackRegistration, "intersection.observe", () =>
                registration.observer.observe(el),
              ),
            unobserve: (el) =>
              useRegistration(callbackRegistration, "intersection.unobserve", () =>
                registration.observer.unobserve(el),
              ),
          } satisfies IntersectionHandle;
        }),

      mutation: (target, options, handler) =>
        Effect.gen(function* () {
          const callbackRegistration = yield* makeCallbackRegistration();

          const registration = yield* Effect.acquireRelease(
            Effect.try({
              try: () =>
                ({
                  callback: callbackRegistration,
                  observer: new MutationObserverConstructor((mutations) => {
                    if (isRegistrationClosed(callbackRegistration)) return;
                    launchCallback(callbackRegistration, "mutation", () => handler(mutations));
                  }),
                }) satisfies NativeObserverRegistration<MutationObserver>,
              catch: (cause) => new ObserverError({ operation: "mutation.create", cause }),
            }),
            (current) => closeNativeObserver(current, "mutation"),
          );

          yield* useRegistration(callbackRegistration, "mutation.observe", () =>
            registration.observer.observe(target, options),
          );
        }),
    });
  }).pipe(Effect.annotateLogs({ service: "Observer" })),
);

// =============================================================================
// Test layer
// =============================================================================

export const test: Layer.Layer<Observer | TestObserver> = Layer.syncContext(() => {
  interface IntersectionRegistration extends CallbackRegistration {
    readonly targets: Set<Element>;
    readonly handler: (entry: IntersectionObserverEntry) => Effect.Effect<void, unknown>;
  }

  interface MutationRegistration extends CallbackRegistration {
    readonly target: Node;
    readonly handler: (mutations: ReadonlyArray<MutationRecord>) => Effect.Effect<void, unknown>;
  }

  const intersectionRegistrations = new Set<IntersectionRegistration>();
  const mutationRegistrations = new Set<MutationRegistration>();
  const activeHandlers = new Set<Fiber.Fiber<void, unknown>>();

  const observerService: ObserverService = {
    intersection: (options) =>
      Effect.gen(function* () {
        const callbackRegistration = yield* makeCallbackRegistration(activeHandlers);
        const registration = yield* Effect.acquireRelease(
          Effect.sync(() => {
            const current: IntersectionRegistration = {
              ...callbackRegistration,
              targets: new Set(),
              handler: options.onIntersect,
            };
            intersectionRegistrations.add(current);
            return current;
          }),
          (current) =>
            Effect.sync(() => {
              current.closed = true;
              intersectionRegistrations.delete(current);
              current.targets.clear();
            }),
        );

        const handle: IntersectionHandle = {
          observe: (el) =>
            useRegistration(registration, "intersection.observe", () => {
              registration.targets.add(el);
            }),
          unobserve: (el) =>
            useRegistration(registration, "intersection.unobserve", () => {
              registration.targets.delete(el);
            }),
        };

        return handle;
      }),

    mutation: (target, _options, handler) =>
      Effect.gen(function* () {
        const callbackRegistration = yield* makeCallbackRegistration(activeHandlers);
        yield* Effect.acquireRelease(
          Effect.sync(() => {
            const registration: MutationRegistration = {
              ...callbackRegistration,
              target,
              handler,
            };
            mutationRegistrations.add(registration);
            return registration;
          }),
          (registration) =>
            Effect.sync(() => {
              registration.closed = true;
              mutationRegistrations.delete(registration);
            }),
        );
      }),
  };

  const testObserverService = TestObserver.of({
    triggerIntersection: (el, entry) =>
      Effect.gen(function* () {
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
        const registrations = Array.from(intersectionRegistrations).filter((registration) =>
          registration.targets.has(el),
        );
        for (const registration of registrations) {
          launchCallback(registration, "intersection", () => registration.handler(mockEntry));
        }
      }),

    triggerMutation: (target, mutations) =>
      Effect.gen(function* () {
        const registrations = Array.from(mutationRegistrations).filter(
          (registration) => registration.target === target,
        );
        for (const registration of registrations) {
          launchCallback(registration, "mutation", () => registration.handler(mutations));
        }
      }),
    drain: drainActiveHandlers(activeHandlers),
  });

  return Context.make(Observer, Observer.of(observerService)).pipe(
    Context.add(TestObserver, testObserverService),
  );
});
