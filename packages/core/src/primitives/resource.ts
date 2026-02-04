/**
 * @since 1.0.0
 * Resource - Effect-native data fetching with caching and fine-grained reactivity
 *
 * Provides cached, deduplicated data fetching with stale-while-revalidate support.
 * Resources are fetched once and shared across components via ResourceRegistry.
 *
 * @example
 * ```tsx
 * import { Resource } from "trygg"
 * import { ApiClient } from "./api"
 * import { Effect } from "effect"
 *
 * // Define a no-params resource
 * const usersResource = Resource.make(
 *   () => Effect.gen(function* () {
 *     const c = yield* ApiClient
 *     return yield* c.users.listUsers()
 *   }),
 *   { key: "users.list" }
 * )
 *
 * // Define a parameterized resource
 * const userResource = Resource.make(
 *   (params: { id: string }) => Effect.gen(function* () {
 *     const c = yield* ApiClient
 *     return yield* c.users.getUser({ path: params })
 *   }),
 *   { key: (params) => Resource.hash("users.getUser", params) }
 * )
 *
 * // In a component - static fetch:
 * const state = yield* Resource.fetch(usersResource)
 *
 * // Reactive fetch (re-fetches when userId signal changes):
 * const state = yield* Resource.fetch(userResource, { id: userId })
 * ```
 */
import {
  Cause,
  Context,
  Deferred,
  Effect,
  Fiber,
  Hash,
  Layer,
  Option,
  pipe,
  Ref,
  Scope,
  SynchronizedRef,
} from "effect";
import * as Signal from "./signal.js";
import { Element, type Element as ElementType } from "./element.js";
import * as Debug from "../debug/debug.js";
import {
  unsafeEntrySignal,
  unsafeAsParams,
  unsafeAsError,
  unsafeCallNoArgs,
  unsafeNarrowContext,
  unsafeAsOverload,
} from "../internal/unsafe.js";

// =============================================================================
// ResourceState - Tagged enum for resource fetch states
// =============================================================================

/**
 * State of a resource fetch.
 *
 * - `Pending`: Fetch in progress, no data yet
 * - `Success`: Fetch completed successfully, value available
 * - `Failure`: Fetch failed, error available (may have stale value from previous success)
 *
 * @since 1.0.0
 */
export type ResourceState<A, E> =
  | { readonly _tag: "Pending" }
  | { readonly _tag: "Success"; readonly value: A; readonly stale: boolean }
  | {
      readonly _tag: "Failure";
      readonly error: E;
      readonly staleValue: Option.Option<A>;
    };

/**
 * Create a Pending state.
 * @since 1.0.0
 */
export const Pending = <A, E>(): ResourceState<A, E> => ({ _tag: "Pending" });

/**
 * Create a Success state.
 * @since 1.0.0
 */
export const Success = <A, E>(value: A, stale: boolean = false): ResourceState<A, E> => ({
  _tag: "Success",
  value,
  stale,
});

/**
 * Create a Failure state.
 * @since 1.0.0
 */
export const Failure = <A, E>(
  error: E,
  staleValue: Option.Option<A> = Option.none(),
): ResourceState<A, E> => ({
  _tag: "Failure",
  error,
  staleValue,
});

/**
 * Check if a ResourceState is Pending.
 * @since 1.0.0
 */
export const isPending = <A, E>(state: ResourceState<A, E>): state is { _tag: "Pending" } =>
  state._tag === "Pending";

/**
 * Check if a ResourceState is Success.
 * @since 1.0.0
 */
export const isSuccess = <A, E>(
  state: ResourceState<A, E>,
): state is { _tag: "Success"; value: A; stale: boolean } => state._tag === "Success";

/**
 * Check if a ResourceState is Failure.
 * @since 1.0.0
 */
export const isFailure = <A, E>(
  state: ResourceState<A, E>,
): state is { _tag: "Failure"; error: E; staleValue: Option.Option<A> } => state._tag === "Failure";

// =============================================================================
// Resource - Descriptor for a fetchable resource
// =============================================================================

/**
 * Resource descriptor - defines what to fetch and how to identify it.
 *
 * @since 1.0.0
 */
export interface Resource<A, E, R> {
  readonly _tag: "Resource";
  readonly key: string;
  readonly fetch: Effect.Effect<A, E, R>;
}

// =============================================================================
// Resource.make - Create resource descriptors with ergonomic factory pattern
// =============================================================================

/**
 * Allowed value for a single reactive param field.
 * Each field in the params can be either a static value or a Signal.
 * @since 1.0.0
 */
export type SignalOrValue<T> = T | Signal.Signal<T>;

/**
 * Params where each field can be a static value or a reactive Signal.
 * When any Signal field changes, the resource is re-fetched.
 * @since 1.0.0
 */
export type ReactiveParams<P extends object> = { readonly [K in keyof P]: SignalOrValue<P[K]> };

/**
 * Create a resource or resource factory.
 *
 * When `key` is a string, creates a no-params resource directly.
 * When `key` is a function, creates a parameterized factory.
 *
 * @example
 * ```tsx
 * // No params → Resource directly
 * const usersResource = Resource.make(
 *   () => Effect.gen(function* () {
 *     const c = yield* ApiClient
 *     return yield* c.users.listUsers()
 *   }),
 *   { key: "users.list" }
 * )
 *
 * // With params → factory function
 * const userResource = Resource.make(
 *   (params: { id: string }) => Effect.gen(function* () {
 *     const c = yield* ApiClient
 *     return yield* c.users.getUser({ path: params })
 *   }),
 *   { key: (params) => Resource.hash("users.getUser", params) }
 * )
 * ```
 *
 * @since 1.0.0
 */
export function make<A, E, R>(
  factory: () => Effect.Effect<A, E, R>,
  options: { readonly key: string },
): Resource<A, E, R>;
export function make<P extends object, A, E, R>(
  factory: (params: P) => Effect.Effect<A, E, R>,
  options: { readonly key: (params: P) => string },
): (params: P) => Resource<A, E, R>;
export function make<P extends object, A, E, R>(
  factory: ((params: P) => Effect.Effect<A, E, R>) | (() => Effect.Effect<A, E, R>),
  options: { readonly key: string | ((params: P) => string) },
): Resource<A, E, R> | ((params: P) => Resource<A, E, R>) {
  if (typeof options.key === "function") {
    const keyFn = options.key;
    // When key is a function, factory accepts params (overload correlation).
    // Cast the function type — TypeScript can't infer union correlation.
    const factoryFn: (params: P) => Effect.Effect<A, E, R> = factory;
    return (params: P): Resource<A, E, R> => ({
      _tag: "Resource",
      key: keyFn(params),
      fetch: factoryFn(params),
    });
  }
  // When key is a string, factory takes no params (overload correlation).
  // TypeScript can't narrow correlated unions.
  return {
    _tag: "Resource",
    key: options.key,
    fetch: unsafeCallNoArgs<Effect.Effect<A, E, R>>(factory),
  };
}

// =============================================================================
// Resource.hash - Deterministic cache key generation
// =============================================================================

/**
 * Generate a deterministic cache key from a prefix and params object.
 *
 * Uses Effect's structural hashing (Hash.structure) for deterministic,
 * collision-resistant keys. Works with flat objects containing primitive values.
 *
 * @example
 * ```tsx
 * Resource.hash("users.getUser", { id: "123" })
 * // => "users.getUser:1234567"
 * ```
 *
 * @since 1.0.0
 */
export const hash = (prefix: string, params: object): string => {
  const h = pipe(Hash.string(prefix), Hash.combine(Hash.structure(params)));
  return `${prefix}:${h}`;
};

// =============================================================================
// ResourceRegistry - Service for caching and deduplication
// =============================================================================

/**
 * Registry entry for internal state management.
 * @internal
 */
interface RegistryEntry {
  readonly state: Signal.Signal<ResourceState<unknown, unknown>>;
  readonly inFlight: Ref.Ref<Option.Option<Deferred.Deferred<void, never>>>;
  readonly currentFiber: Ref.Ref<Option.Option<Fiber.RuntimeFiber<void, never>>>;
  readonly timestamp: Ref.Ref<number>;
}

/**
 * ResourceRegistry service for caching and deduplication.
 *
 * Manages resource state across the application:
 * - Caches fetched resources by key
 * - Deduplicates concurrent requests
 * - Provides stale-while-revalidate support
 *
 * @since 1.0.0
 */
export interface ResourceRegistry {
  readonly _tag: "ResourceRegistry";
  readonly get: (key: string) => Effect.Effect<Option.Option<RegistryEntry>>;
  readonly getOrCreate: (key: string) => Effect.Effect<RegistryEntry>;
  readonly delete: (key: string) => Effect.Effect<void>;
}

/**
 * ResourceRegistry service tag.
 * @since 1.0.0
 */
export class ResourceRegistryTag extends Context.Tag("trygg/ResourceRegistry")<
  ResourceRegistryTag,
  ResourceRegistry
>() {}

/**
 * Create a ResourceRegistry layer with an in-memory cache.
 *
 * @since 1.0.0
 */
export const ResourceRegistryLive: Layer.Layer<ResourceRegistryTag> = Layer.effect(
  ResourceRegistryTag,
  Effect.gen(function* () {
    const cache = yield* SynchronizedRef.make(new Map<string, RegistryEntry>());

    const get = (key: string): Effect.Effect<Option.Option<RegistryEntry>> =>
      SynchronizedRef.get(cache).pipe(Effect.map((map) => Option.fromNullable(map.get(key))));

    const getOrCreate = (key: string): Effect.Effect<RegistryEntry> =>
      SynchronizedRef.modifyEffect(cache, (map) =>
        Effect.gen(function* () {
          const existing = map.get(key);
          if (existing !== undefined) {
            yield* Debug.log({
              event: "resource.registry.get_existing",
              key,
            });
            const result: readonly [RegistryEntry, Map<string, RegistryEntry>] = [existing, map];
            return result;
          }

          yield* Debug.log({
            event: "resource.registry.create_entry",
            key,
          });

          // Create new entry
          const state = yield* Signal.make<ResourceState<unknown, unknown>>(Pending());
          const inFlight = yield* Ref.make<Option.Option<Deferred.Deferred<void, never>>>(
            Option.none(),
          );
          const currentFiber = yield* Ref.make<Option.Option<Fiber.RuntimeFiber<void, never>>>(
            Option.none(),
          );
          const timestamp = yield* Ref.make(0);

          const entry: RegistryEntry = { state, inFlight, currentFiber, timestamp };
          const newMap = new Map(map);
          newMap.set(key, entry);

          const result: readonly [RegistryEntry, Map<string, RegistryEntry>] = [entry, newMap];
          return result;
        }),
      );

    const deleteEntry = (key: string): Effect.Effect<void> =>
      SynchronizedRef.update(cache, (map) => {
        const newMap = new Map(map);
        newMap.delete(key);
        return newMap;
      });

    return {
      _tag: "ResourceRegistry" satisfies ResourceRegistry["_tag"],
      get,
      getOrCreate,
      delete: deleteEntry,
    };
  }),
);

// =============================================================================
// Internal helpers
// =============================================================================

/**
 * Execute a fetch for a resource and update state.
 * Captures context from R and provides it to the daemon-forked fiber.
 * Returns the fiber reference for cancellation support.
 * @internal
 */
const fetchInternal = <A, E, R>(
  resource: Resource<A, E, R>,
  entry: RegistryEntry,
  ctx: Context.Context<R>,
): Effect.Effect<Fiber.RuntimeFiber<void, never>> =>
  Effect.gen(function* () {
    const state = unsafeEntrySignal<A, E>(entry.state);

    yield* Debug.log({
      event: "resource.fetch.start",
      key: resource.key,
    });

    // Create deferred for dedupe coordination
    const deferred = yield* Deferred.make<void, never>();
    yield* Ref.set(entry.inFlight, Option.some(deferred));

    const fiber = yield* Debug.log({
      event: "resource.fetch.fork_running",
      key: resource.key,
    }).pipe(
      Effect.flatMap(() => Effect.provide(resource.fetch, ctx)),
      Effect.tap((value) =>
        Debug.log({
          event: "resource.fetch.success",
          key: resource.key,
          value_type: typeof value,
          is_array: Array.isArray(value),
          length: Array.isArray(value) ? value.length : undefined,
        }),
      ),
      Effect.tapErrorCause((cause) =>
        Debug.log({
          event: "resource.fetch.error",
          key: resource.key,
          error: Cause.squash(cause),
          error_message: String(Cause.squash(cause)),
        }),
      ),
      Effect.tapDefect((defect) =>
        Debug.log({
          event: "resource.fetch.defect",
          key: resource.key,
          defect: String(defect),
        }),
      ),
      Effect.matchCauseEffect({
        onSuccess: (value) =>
          Effect.gen(function* () {
            yield* Debug.log({
              event: "resource.fetch.set_success",
              key: resource.key,
            });
            yield* Signal.set(state, Success<A, E>(value, false));
          }),
        onFailure: (cause) =>
          Effect.gen(function* () {
            const error = Cause.squash(cause);
            yield* Debug.log({
              event: "resource.fetch.set_failure",
              key: resource.key,
              error: String(error),
            });
            const prev = yield* Signal.get(state);
            const staleValue = prev._tag === "Success" ? Option.some(prev.value) : Option.none();
            yield* Signal.set(state, Failure<A, E>(unsafeAsError<E>(error), staleValue));
          }),
      }),
      Effect.catchAllCause((cause) =>
        Debug.log({
          event: "resource.fetch.unhandled",
          key: resource.key,
          error: Cause.squash(cause),
          error_message: String(Cause.squash(cause)),
        }),
      ),
      Effect.ensuring(
        Effect.gen(function* () {
          yield* Debug.log({
            event: "resource.fetch.complete",
            key: resource.key,
          });
          yield* Deferred.succeed(deferred, undefined);
          yield* Ref.set(entry.inFlight, Option.none());
          yield* Ref.set(entry.currentFiber, Option.none());
          yield* Ref.set(entry.timestamp, Date.now());
        }),
      ),
      Effect.forkDaemon,
    );

    yield* Ref.set(entry.currentFiber, Option.some(fiber));
    return fiber;
  });

// =============================================================================
// Public API - fetch
// =============================================================================

/**
 * Fetch a resource, returning a reactive state signal.
 *
 * Two modes:
 * 1. Static: Pass a resource directly. Returns cached or fetches new.
 * 2. Reactive: Pass a factory + reactive params. Re-fetches when Signal params change.
 *    Previous in-flight fetches are cancelled on param change.
 *
 * @example
 * ```tsx
 * // Static fetch (no-params resource):
 * const state = yield* Resource.fetch(usersResource)
 *
 * // Static fetch (pre-built resource):
 * const state = yield* Resource.fetch(userResource({ id: "123" }))
 *
 * // Reactive fetch (re-fetches when userId signal changes):
 * const userId = yield* Signal.make("123")
 * const state = yield* Resource.fetch(userResource, { id: userId })
 * ```
 *
 * @since 1.0.0
 */
export const fetch: {
  <A, E, R>(
    resource: Resource<A, E, R>,
  ): Effect.Effect<Signal.Signal<ResourceState<A, E>>, never, ResourceRegistryTag | R>;
  <P extends object, A, E, R>(
    factory: (params: P) => Resource<A, E, R>,
    params: ReactiveParams<P>,
  ): Effect.Effect<
    Signal.Signal<ResourceState<A, E>>,
    never,
    ResourceRegistryTag | R | Scope.Scope
  >;
} = unsafeAsOverload(
  (
    resourceOrFactory:
      | Resource<unknown, unknown, unknown>
      | ((params: Record<string, unknown>) => Resource<unknown, unknown, unknown>),
    params?: ReactiveParams<Record<string, unknown>>,
  ) => {
    if (typeof resourceOrFactory === "function") {
      if (params === undefined) {
        return Effect.die("Resource.fetch: params required when using a factory");
      }
      return fetchReactive(resourceOrFactory, params);
    }
    return fetchStatic(resourceOrFactory);
  },
);

/**
 * Static fetch implementation.
 * @internal
 */
const fetchStatic = <A, E, R>(
  resource: Resource<A, E, R>,
): Effect.Effect<Signal.Signal<ResourceState<A, E>>, never, ResourceRegistryTag | R> =>
  Effect.gen(function* () {
    yield* Debug.log({
      event: "resource.fetch.called",
      key: resource.key,
    });

    const ctx = yield* Effect.context<R>();
    const registry = yield* ResourceRegistryTag;
    const entry = yield* registry.getOrCreate(resource.key);
    const state = unsafeEntrySignal<A, E>(entry.state);

    const currentInFlight = yield* Ref.get(entry.inFlight);

    // Dedupe: if fetch in progress, wait for it
    if (Option.isSome(currentInFlight)) {
      yield* Debug.log({
        event: "resource.fetch.dedupe_wait",
        key: resource.key,
      });
      yield* Deferred.await(currentInFlight.value);
      return state;
    }

    // Check if we have cached data
    const currentState = yield* Signal.get(state);
    if (currentState._tag !== "Pending") {
      yield* Debug.log({
        event: "resource.fetch.cached",
        key: resource.key,
        state: currentState._tag,
      });
      return state;
    }

    yield* Debug.log({
      event: "resource.fetch.starting",
      key: resource.key,
    });

    // Start fetch with captured context
    yield* fetchInternal(resource, entry, ctx);

    return state;
  }).pipe(Effect.withSpan("Resource.fetch", { attributes: { key: resource.key } }));

/**
 * Reactive fetch implementation.
 * Subscribes to Signal params and re-fetches on change, cancelling in-flight fetches.
 * @internal
 */
const fetchReactive = <P extends object, A, E, R>(
  factory: (params: P) => Resource<A, E, R>,
  reactiveParams: ReactiveParams<P>,
): Effect.Effect<
  Signal.Signal<ResourceState<A, E>>,
  never,
  ResourceRegistryTag | R | Scope.Scope
> =>
  Effect.gen(function* () {
    const ctx = yield* Effect.context<ResourceRegistryTag | R>();
    const scope = yield* Effect.scope;

    // Unwrap current values from reactive params.
    // Wrapped in locally(CurrentRenderPhase, null) so Signal.get reads don't
    // register as component dependencies — reactivity is handled by subscriptions.
    const unwrapParams = (): Effect.Effect<P> =>
      Effect.locally(
        Effect.gen(function* () {
          const result: Record<string, unknown> = {};
          for (const [key, value] of Object.entries(reactiveParams)) {
            if (Signal.isSignal(value)) {
              result[key] = yield* Signal.get(value);
            } else {
              result[key] = value;
            }
          }
          return unsafeAsParams<P>(result);
        }),
        Signal.CurrentRenderPhase,
        null,
      );

    // Collect signal fields for subscription
    const signalFields: Array<Signal.Signal<unknown>> = [];
    for (const value of Object.values(reactiveParams)) {
      if (Signal.isSignal(value)) {
        signalFields.push(value);
      }
    }

    // Get initial params and create initial resource
    const initialParams = yield* unwrapParams();
    const initialResource = factory(initialParams);

    // Create the output signal that will be updated on param changes
    const outputState = yield* Signal.make<ResourceState<A, E>>(Pending());

    // Track current in-flight fiber for cancellation
    const activeFiber = yield* Ref.make<Option.Option<Fiber.RuntimeFiber<void, never>>>(
      Option.none(),
    );

    // Track current resource key for change detection
    const activeKey = yield* Ref.make(initialResource.key);

    // Helper: cancel previous daemon, fork new fetch, sync result to output.
    // The daemon stays alive after the initial fetch, mirroring entry.state → outputState
    // so that invalidate/refresh changes propagate to the component.
    const doFetch = (resource: Resource<A, E, R>): Effect.Effect<void> =>
      Effect.gen(function* () {
        // Cancel previous doFetch daemon before forking new one
        const prevFiber = yield* Ref.get(activeFiber);
        if (Option.isSome(prevFiber)) {
          yield* Fiber.interrupt(prevFiber.value);
        }

        yield* Ref.set(activeKey, resource.key);
        yield* Signal.set(outputState, Pending<A, E>());

        // Fork the fetch work as a daemon
        const daemon = yield* Effect.gen(function* () {
          const registry = yield* ResourceRegistryTag;
          const entry = yield* registry.getOrCreate(resource.key);
          const entryState = unsafeEntrySignal<A, E>(entry.state);

          // Check if already cached
          const cached = yield* Signal.get(entryState);
          if (cached._tag !== "Pending") {
            yield* Signal.set(outputState, cached);
          } else {
            // Dedupe: if fetch already in-flight for this key, wait for it
            const currentInFlight = yield* Ref.get(entry.inFlight);
            if (Option.isSome(currentInFlight)) {
              yield* Deferred.await(currentInFlight.value);
            } else {
              // Start fetch and wait for completion
              const fiber = yield* fetchInternal(
                resource,
                entry,
                unsafeNarrowContext<R, ResourceRegistryTag | R>(ctx),
              );
              yield* Fiber.join(fiber);
            }
            // Sync resolved state to output
            const finalState = yield* Signal.get(entryState);
            yield* Signal.set(outputState, finalState);
          }

          // Subscribe to entry state so invalidate/refresh propagates to outputState.
          // The daemon stays alive until interrupted by the next doFetch call.
          const unsubscribe = yield* Signal.subscribe(entryState, () =>
            Signal.get(entryState).pipe(Effect.flatMap((s) => Signal.set(outputState, s))),
          );
          return yield* Effect.never.pipe(Effect.ensuring(unsubscribe));
        }).pipe(
          Effect.provide(ctx),
          Effect.catchAllCause(() => Effect.void),
          Effect.forkDaemon,
        );

        yield* Ref.set(activeFiber, Option.some(daemon));
      });

    // Initial fetch
    yield* doFetch(initialResource).pipe(Effect.provide(ctx));

    // If there are reactive signals, subscribe to changes
    if (signalFields.length > 0) {
      const onParamChange = (): Effect.Effect<void> =>
        Effect.gen(function* () {
          const newParams = yield* unwrapParams();
          const newResource = factory(newParams);
          const currentKey = yield* Ref.get(activeKey);

          // Only re-fetch if key actually changed
          if (newResource.key !== currentKey) {
            yield* doFetch(newResource).pipe(Effect.provide(ctx));
          }
        });

      for (const signal of signalFields) {
        const unsub = yield* Signal.subscribe(signal, onParamChange);
        yield* Scope.addFinalizer(scope, unsub);
      }
    }

    // Cleanup: interrupt active fiber on scope close
    yield* Scope.addFinalizer(
      scope,
      Effect.gen(function* () {
        const fiber = yield* Ref.get(activeFiber);
        if (Option.isSome(fiber)) {
          yield* Fiber.interrupt(fiber.value);
        }
      }),
    );

    return outputState;
  }).pipe(Effect.withSpan("Resource.fetch.reactive"));

// =============================================================================
// Public API - match, invalidate, refresh, clear
// =============================================================================

/**
 * Pattern match on resource state for rendering.
 *
 * Uses Signal.derive for fine-grained updates - component renders once,
 * derived signal updates Element when state changes.
 *
 * @example
 * ```tsx
 * return yield* Resource.match(state, {
 *   Pending: () => <Spinner />,
 *   Success: (user, stale) => <UserCard user={user} opacity={stale ? 0.5 : 1} />,
 *   Failure: (error, staleValue) =>
 *     Option.match(staleValue, {
 *       onNone: () => <ErrorView error={error} />,
 *       onSome: (user) => <StaleUserCard user={user} error={error} />
 *     })
 * })
 * ```
 *
 * @since 1.0.0
 */
export const match = <A, E>(
  state: Signal.Signal<ResourceState<A, E>>,
  handlers: {
    readonly Pending: () => ElementType;
    readonly Success: (value: A, stale: boolean) => ElementType;
    readonly Failure: (error: E, staleValue: Option.Option<A>) => ElementType;
  },
): Effect.Effect<ElementType, never, Scope.Scope> =>
  Effect.gen(function* () {
    // Derive a Signal<Element> from the state signal
    const elementSignal = yield* Signal.derive(state, (s): ElementType => {
      switch (s._tag) {
        case "Pending":
          return handlers.Pending();
        case "Success":
          return handlers.Success(s.value, s.stale);
        case "Failure":
          return handlers.Failure(s.error, s.staleValue);
      }
    });

    // Return SignalElement for fine-grained updates
    return Element.SignalElement({ signal: elementSignal, onSwap: undefined });
  }).pipe(Effect.withSpan("Resource.match"));

/**
 * Mark resource as stale and trigger background refetch.
 *
 * Preserves current Success value with stale=true during refetch.
 * Dedupes: no-op if fetch already in progress.
 *
 * @example
 * ```tsx
 * <button onClick={() => Resource.invalidate(userResource({ id }))}>
 *   Refresh
 * </button>
 * ```
 *
 * @since 1.0.0
 */
export const invalidate = <A, E, R>(
  resource: Resource<A, E, R>,
): Effect.Effect<void, never, ResourceRegistryTag | R> =>
  Effect.gen(function* () {
    const ctx = yield* Effect.context<R>();
    const registry = yield* ResourceRegistryTag;
    const maybeEntry = yield* registry.get(resource.key);

    if (Option.isNone(maybeEntry)) return; // Nothing to invalidate

    const entry = maybeEntry.value;
    const state = unsafeEntrySignal<A, E>(entry.state);
    const currentInFlight = yield* Ref.get(entry.inFlight);

    // Dedupe: if already fetching, no-op
    if (Option.isSome(currentInFlight)) {
      return; // Fetch in progress, will get fresh data
    }

    // Mark current success as stale
    const currentState = yield* Signal.get(state);
    if (currentState._tag === "Success") {
      yield* Signal.set(state, Success<A, E>(currentState.value, true));
    }

    // Trigger background refetch
    yield* fetchInternal(resource, entry, ctx);
  }).pipe(Effect.withSpan("Resource.invalidate", { attributes: { key: resource.key } }));

/**
 * Force immediate refetch, transitioning to Pending first.
 *
 * Does not preserve stale value.
 * Dedupes: waits for in-progress fetch if any.
 *
 * @example
 * ```tsx
 * <button onClick={() => Resource.refresh(userResource({ id }))}>
 *   Reload
 * </button>
 * ```
 *
 * @since 1.0.0
 */
export const refresh = <A, E, R>(
  resource: Resource<A, E, R>,
): Effect.Effect<void, never, ResourceRegistryTag | R> =>
  Effect.gen(function* () {
    const ctx = yield* Effect.context<R>();
    const registry = yield* ResourceRegistryTag;
    const entry = yield* registry.getOrCreate(resource.key);
    const state = unsafeEntrySignal<A, E>(entry.state);

    const currentInFlight = yield* Ref.get(entry.inFlight);

    // Dedupe: if already fetching, wait for it
    if (Option.isSome(currentInFlight)) {
      yield* Deferred.await(currentInFlight.value);
      return;
    }

    // Go to Pending (unlike invalidate which keeps stale)
    yield* Signal.set(state, Pending<A, E>());

    // Trigger fetch
    yield* fetchInternal(resource, entry, ctx);
  }).pipe(Effect.withSpan("Resource.refresh", { attributes: { key: resource.key } }));

/**
 * Delete a resource from the cache.
 *
 * Use this to force a fresh fetch on the next `Resource.fetch` call.
 *
 * @since 1.0.0
 */
export const clear = <A, E, R>(
  resource: Resource<A, E, R>,
): Effect.Effect<void, never, ResourceRegistryTag> =>
  Effect.gen(function* () {
    const registry = yield* ResourceRegistryTag;
    yield* registry.delete(resource.key);
  }).pipe(Effect.withSpan("Resource.clear", { attributes: { key: resource.key } }));
