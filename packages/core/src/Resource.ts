/**
 * @since 1.0.0
 * Resource - Effect-native data fetching with caching and fine-grained reactivity
 *
 * Provides cached, deduplicated data fetching with stale-while-revalidate support.
 * Resources are fetched once and shared across components via ResourceRegistry.
 *
 * @example
 * ```tsx
 * import { Resource } from "effect-ui"
 * import { Effect } from "effect"
 *
 * // Define a resource
 * const userResource = Resource.make({
 *   key: "user:123",
 *   fetch: fetchUser("123")
 * })
 *
 * // In a component
 * const UserProfile = Effect.gen(function* () {
 *   const state = yield* Resource.fetch(userResource)
 *
 *   return yield* Resource.match(state, {
 *     Pending: () => <Spinner />,
 *     Success: (user, stale) => <UserCard user={user} stale={stale} />,
 *     Failure: (error, staleValue) => <ErrorView error={error} stale={staleValue} />
 *   })
 * })
 * ```
 */
import { Context, Deferred, Effect, Layer, Option, Ref, Scope, SynchronizedRef } from "effect";
import * as Signal from "./signal.js";
import { Element, type Element as ElementType } from "./element.js";
import * as Debug from "./debug/debug.js";

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

/**
 * Create a resource descriptor.
 *
 * @example
 * ```tsx
 * const userResource = Resource.make({
 *   key: "user:123",
 *   fetch: Effect.gen(function* () {
 *     const client = yield* ApiClient
 *     return yield* client.getUser("123")
 *   }).pipe(Effect.provide(ApiClientLive))
 * })
 * ```
 *
 * @since 1.0.0
 */
export const make = <A, E, R>(config: {
  readonly key: string;
  readonly fetch: Effect.Effect<A, E, R>;
}): Resource<A, E, R> => ({
  _tag: "Resource",
  key: config.key,
  fetch: config.fetch,
});

/**
 * Create a resource factory from an API endpoint.
 *
 * Simplifies creating resources for API endpoints by:
 * - Auto-generating cache keys from the key prefix and params
 * - Providing a consistent pattern for parameterized resources
 *
 * @example
 * ```tsx
 * import { Resource } from "effect-ui"
 * import { HttpApiClient } from "@effect/platform"
 * import { Api } from "./api"
 *
 * const client = HttpApiClient.make(Api, { baseUrl: "" }).pipe(
 *   Effect.provide(FetchHttpClient.layer)
 * )
 *
 * // Create a resource factory
 * const userResource = Resource.endpoint(
 *   "users.getUser",
 *   (params: { id: string }) =>
 *     Effect.flatMap(client, c => c.users.getUser({ path: params }))
 * )
 *
 * // Use it
 * const state = yield* Resource.fetch(userResource({ id: "123" }))
 * ```
 *
 * @since 1.0.0
 */
export const endpoint = <P, A, E, R>(
  keyPrefix: string,
  call: (params: P) => Effect.Effect<A, E, R>,
): ((params: P) => Resource<A, E, R>) => {
  return (params: P): Resource<A, E, R> =>
    make({
      key: `${keyPrefix}:${JSON.stringify(params)}`,
      fetch: call(params),
    });
};

/**
 * Create a resource from an API endpoint with no parameters.
 *
 * @example
 * ```tsx
 * const usersResource = Resource.endpointNoParams(
 *   "users.list",
 *   Effect.flatMap(client, c => c.users.listUsers())
 * )
 *
 * const state = yield* Resource.fetch(usersResource)
 * ```
 *
 * @since 1.0.0
 */
export const endpointNoParams = <A, E, R>(
  key: string,
  fetch: Effect.Effect<A, E, R>,
): Resource<A, E, R> => make({ key, fetch });

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
export class ResourceRegistryTag extends Context.Tag("effect-ui/ResourceRegistry")<
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
            return [existing, map] as const;
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
          const timestamp = yield* Ref.make(0);

          const entry: RegistryEntry = { state, inFlight, timestamp };
          const newMap = new Map(map);
          newMap.set(key, entry);

          return [entry, newMap] as const;
        }),
      );

    const deleteEntry = (key: string): Effect.Effect<void> =>
      SynchronizedRef.update(cache, (map) => {
        const newMap = new Map(map);
        newMap.delete(key);
        return newMap;
      });

    return {
      _tag: "ResourceRegistry" as const,
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
 * @internal
 */
const fetchInternal = <A, E>(
  resource: Resource<A, E, never>,
  entry: RegistryEntry,
): Effect.Effect<void> =>
  Effect.gen(function* () {
    const state = entry.state as Signal.Signal<ResourceState<A, E>>;

    yield* Debug.log({
      event: "resource.fetch.start",
      key: resource.key,
    });

    // Create deferred for dedupe coordination
    const deferred = yield* Deferred.make<void, never>();
    yield* Ref.set(entry.inFlight, Option.some(deferred));

    yield* Debug.log({
      event: "resource.fetch.fork_running",
      key: resource.key,
    }).pipe(
      Effect.flatMap(() => resource.fetch),
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
          cause: String(cause),
        }),
      ),
      Effect.tapDefect((defect) =>
        Debug.log({
          event: "resource.fetch.defect",
          key: resource.key,
          defect: String(defect),
        }),
      ),
      Effect.matchEffect({
        onSuccess: (value) =>
          Effect.gen(function* () {
            yield* Debug.log({
              event: "resource.fetch.set_success",
              key: resource.key,
            });
            yield* Signal.set(state, Success<A, E>(value, false));
          }),
        onFailure: (error) =>
          Effect.gen(function* () {
            yield* Debug.log({
              event: "resource.fetch.set_failure",
              key: resource.key,
              error: String(error),
            });
            const prev = yield* Signal.get(state);
            const staleValue = prev._tag === "Success" ? Option.some(prev.value) : Option.none();
            yield* Signal.set(state, Failure<A, E>(error, staleValue));
          }),
      }),
      Effect.catchAllCause((cause) =>
        Debug.log({
          event: "resource.fetch.unhandled",
          key: resource.key,
          cause: String(cause),
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
          yield* Ref.set(entry.timestamp, Date.now());
        }),
      ),
      Effect.forkDaemon,
    );
  });

// =============================================================================
// Public API
// =============================================================================

/**
 * Fetch a resource, returning a reactive state signal.
 *
 * - Starts fetch if no cached state or if invalidated
 * - Dedupes concurrent fetches via Deferred
 * - R must be provided before calling (R = never in component)
 *
 * @example
 * ```tsx
 * const state = yield* Resource.fetch(userResource)
 * // state is Signal<ResourceState<User, UserNotFound>>
 * ```
 *
 * @since 1.0.0
 */
export const fetch = <A, E>(
  resource: Resource<A, E, never>,
): Effect.Effect<Signal.Signal<ResourceState<A, E>>, never, ResourceRegistryTag> =>
  Effect.gen(function* () {
    yield* Debug.log({
      event: "resource.fetch.called",
      key: resource.key,
    });

    const registry = yield* ResourceRegistryTag;
    const entry = yield* registry.getOrCreate(resource.key);
    const state = entry.state as Signal.Signal<ResourceState<A, E>>;

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
      // Already have data (Success or Failure), return cached
      return state;
    }

    yield* Debug.log({
      event: "resource.fetch.starting",
      key: resource.key,
    });

    // Start fetch
    yield* fetchInternal(resource, entry);

    return state;
  }).pipe(Effect.withSpan("Resource.fetch", { attributes: { key: resource.key } }));

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
    return Element.SignalElement({ signal: elementSignal });
  }).pipe(Effect.withSpan("Resource.match"));

/**
 * Mark resource as stale and trigger background refetch.
 *
 * Preserves current Success value with stale=true during refetch.
 * Dedupes: no-op if fetch already in progress.
 *
 * @example
 * ```tsx
 * <button onClick={() => Resource.invalidate(userResource)}>
 *   Refresh
 * </button>
 * ```
 *
 * @since 1.0.0
 */
export const invalidate = <A, E>(
  resource: Resource<A, E, never>,
): Effect.Effect<void, never, ResourceRegistryTag> =>
  Effect.gen(function* () {
    const registry = yield* ResourceRegistryTag;
    const maybeEntry = yield* registry.get(resource.key);

    if (Option.isNone(maybeEntry)) return; // Nothing to invalidate

    const entry = maybeEntry.value;
    const state = entry.state as Signal.Signal<ResourceState<A, E>>;
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
    yield* fetchInternal(resource, entry);
  }).pipe(Effect.withSpan("Resource.invalidate", { attributes: { key: resource.key } }));

/**
 * Force immediate refetch, transitioning to Pending first.
 *
 * Does not preserve stale value.
 * Dedupes: waits for in-progress fetch if any.
 *
 * @example
 * ```tsx
 * <button onClick={() => Resource.refresh(userResource)}>
 *   Reload
 * </button>
 * ```
 *
 * @since 1.0.0
 */
export const refresh = <A, E>(
  resource: Resource<A, E, never>,
): Effect.Effect<void, never, ResourceRegistryTag> =>
  Effect.gen(function* () {
    const registry = yield* ResourceRegistryTag;
    const entry = yield* registry.getOrCreate(resource.key);
    const state = entry.state as Signal.Signal<ResourceState<A, E>>;

    const currentInFlight = yield* Ref.get(entry.inFlight);

    // Dedupe: if already fetching, wait for it
    if (Option.isSome(currentInFlight)) {
      yield* Deferred.await(currentInFlight.value);
      return;
    }

    // Go to Pending (unlike invalidate which keeps stale)
    yield* Signal.set(state, Pending<A, E>());

    // Trigger fetch
    yield* fetchInternal(resource, entry);
  }).pipe(Effect.withSpan("Resource.refresh", { attributes: { key: resource.key } }));

/**
 * Delete a resource from the cache.
 *
 * Use this to force a fresh fetch on the next `Resource.fetch` call.
 *
 * @since 1.0.0
 */
export const clear = <A, E>(
  resource: Resource<A, E, never>,
): Effect.Effect<void, never, ResourceRegistryTag> =>
  Effect.gen(function* () {
    const registry = yield* ResourceRegistryTag;
    yield* registry.delete(resource.key);
  }).pipe(Effect.withSpan("Resource.clear", { attributes: { key: resource.key } }));
