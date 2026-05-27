/**
 * Async state primitives for trygg.
 *
 * @remarks
 * Owner module for the `Resource` topic. Use this module for cached async state,
 * stale-while-revalidate refresh flows, and reactive fetches keyed from signals.
 * The root `trygg` entrypoint publishes this topic as `Resource.*`.
 *
 * `Resource` separates three concerns:
 * - descriptors define how to fetch and key data
 * - `Resource.fetch` produces reactive `ResourceState`
 * - matcher helpers turn that state into view logic
 *
 * @see ./resource.docs.md - Source-owned topic guide
 * @since 1.0.0
 * @module trygg/primitives/resource
 */
import {
  Cause,
  Data,
  Deferred,
  Effect,
  Exit,
  Fiber,
  Hash,
  Layer,
  Option,
  pipe,
  Ref,
  Scope,
  SynchronizedRef,
} from "effect";
import * as Context from "effect/Context";
import * as Signal from "./signal.js";
import { Element, type Element as ElementType } from "./element.js";
import { type Component } from "./component.js";
import * as ReactiveMatcher from "./reactive-matcher.js";
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
 * @remarks
 * `ResourceState` is the reactive output shape returned by `Resource.fetch`.
 *
 * @example
 * ```ts
 * const state: Resource.ResourceState<User, ApiError> = Resource.Pending()
 * ```
 *
 * @category Async State
 * @public
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
 *
 * @remarks
 * Used before the first successful fetch, or during a hard refresh.
 *
 * @example
 * ```ts
 * const state = Resource.Pending<User, ApiError>()
 * ```
 *
 * @category Async State
 * @public
 * @since 1.0.0
 */
export const Pending = <A, E>(): ResourceState<A, E> => ({ _tag: "Pending" });

/**
 * Create a Success state.
 *
 * @remarks
 * `stale` marks that cached data is still shown while a background refetch runs.
 *
 * @example
 * ```ts
 * const state = Resource.Success({ id: "1" }, true)
 * ```
 *
 * @category Async State
 * @public
 * @since 1.0.0
 */
export const Success = <A, E>(value: A, stale: boolean = false): ResourceState<A, E> => ({
  _tag: "Success",
  value,
  stale,
});

/**
 * Create a Failure state.
 *
 * @remarks
 * Failures can preserve the last successful value through `staleValue`.
 *
 * @example
 * ```ts
 * const state = Resource.Failure<ApiUser, ApiError>(error, Option.none())
 * ```
 *
 * @category Async State
 * @public
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
 *
 * @remarks
 * Use as a type guard when branching outside `Resource.match`.
 *
 * @example
 * ```ts
 * if (Resource.isPending(state)) {
 *   return "loading"
 * }
 * ```
 *
 * @category Async State
 * @public
 * @since 1.0.0
 */
export const isPending = <A, E>(state: ResourceState<A, E>): state is { _tag: "Pending" } =>
  state._tag === "Pending";

/**
 * Check if a ResourceState is Success.
 *
 * @remarks
 * Narrows to the success shape so `value` and `stale` become available.
 *
 * @example
 * ```ts
 * if (Resource.isSuccess(state)) {
 *   return state.value
 * }
 * ```
 *
 * @category Async State
 * @public
 * @since 1.0.0
 */
export const isSuccess = <A, E>(
  state: ResourceState<A, E>,
): state is { _tag: "Success"; value: A; stale: boolean } => state._tag === "Success";

/**
 * Check if a ResourceState is Failure.
 *
 * @remarks
 * Narrows to the failure shape so `error` and `staleValue` become available.
 *
 * @example
 * ```ts
 * if (Resource.isFailure(state)) {
 *   return state.error
 * }
 * ```
 *
 * @category Async State
 * @public
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
 * @remarks
 * Resource descriptors are inert values. Call `Resource.fetch` to execute them.
 *
 * @example
 * ```ts
 * const users = Resource.make(() => Effect.succeed([]), { key: "users.list" })
 * ```
 *
 * @category Async State
 * @public
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
 *
 * @remarks
 * `Signal` inputs make the fetch key reactive without changing the resource factory.
 *
 * @example
 * ```ts
 * type UserId = Resource.SignalOrValue<string>
 * ```
 *
 * @category Async State
 * @public
 * @since 1.0.0
 */
export type SignalOrValue<T> = T | Signal.Signal<T>;

/**
 * Params where each field can be a static value or a reactive Signal.
 * When any Signal field changes, the resource is re-fetched.
 *
 * @remarks
 * This is the accepted shape for reactive `Resource.fetch(factory, params)` calls.
 *
 * @example
 * ```ts
 * type UserParams = Resource.ReactiveParams<{ id: string }>
 * ```
 *
 * @category Async State
 * @public
 * @since 1.0.0
 */
export type ReactiveParams<P extends object> = { readonly [K in keyof P]: SignalOrValue<P[K]> };

/**
 * Create a resource or resource factory.
 *
 * When `key` is a string, creates a no-params resource directly.
 * When `key` is a function, creates a parameterized factory.
 *
 * @remarks
 * Keep keys stable and deterministic. The registry uses them for caching, dedupe,
 * invalidation, and refresh semantics.
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
 * @category Async State
 * @public
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
 * @remarks
 * Use this when a resource key depends on parameter values.
 *
 * @example
 * ```tsx
 * Resource.hash("users.getUser", { id: "123" })
 * // => "users.getUser:1234567"
 * ```
 *
 * @category Async State
 * @public
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
  readonly currentFiber: Ref.Ref<Option.Option<Fiber.Fiber<void, never>>>;
  readonly timestamp: Ref.Ref<number>;
  readonly scope: Scope.Scope;
}

class ResourceFactoryParamsRequiredError extends Data.TaggedError(
  "ResourceFactoryParamsRequiredError",
)<{}> {}

const fromNullable = <A>(value: A | null | undefined): Option.Option<A> =>
  value === null || value === undefined ? Option.none() : Option.some(value);

/**
 * ResourceRegistry service for caching and deduplication.
 *
 * Manages resource state across the application:
 * - Caches fetched resources by key
 * - Deduplicates concurrent requests
 * - Provides stale-while-revalidate support
 *
 * @remarks
 * Override this service when tests or custom runtime layers need different cache behavior.
 *
 * @example
 * ```ts
 * const registry = yield* Resource.ResourceRegistryTag
 * ```
 *
 * @category Async State
 * @public
 * @since 1.0.0
 */
export interface ResourceRegistry {
  readonly _tag: "ResourceRegistry";
  readonly get: (key: string) => Effect.Effect<Option.Option<RegistryEntry>>;
  readonly getOrCreate: (key: string) => Effect.Effect<RegistryEntry, Signal.SignalScopeError>;
  readonly delete: (key: string) => Effect.Effect<void>;
}

/**
 * ResourceRegistry service tag.
 *
 * @remarks
 * Yield this service to inspect or replace the active resource registry.
 *
 * @example
 * ```ts
 * const registry = yield* Resource.ResourceRegistryTag
 * ```
 *
 * @category Async State
 * @public
 * @since 1.0.0
 */
export class ResourceRegistryTag extends Context.Service<ResourceRegistryTag, ResourceRegistry>()(
  "trygg/ResourceRegistry",
) {}

/**
 * Create a ResourceRegistry layer with an in-memory cache.
 *
 * @remarks
 * This is the default registry implementation used by app and test code.
 *
 * @example
 * ```ts
 * const program = Resource.fetch(users).pipe(Effect.provide(Resource.ResourceRegistryLive))
 * ```
 *
 * @category Async State
 * @public
 * @since 1.0.0
 */
export const ResourceRegistryLive: Layer.Layer<ResourceRegistryTag, Signal.SignalScopeError> =
  Layer.effect(
    ResourceRegistryTag,
    Effect.gen(function* () {
      const cache = yield* SynchronizedRef.make(new Map<string, RegistryEntry>());
      const registryScope = yield* Effect.scope;

      const get = (key: string): Effect.Effect<Option.Option<RegistryEntry>> =>
        SynchronizedRef.get(cache).pipe(Effect.map((map) => fromNullable(map.get(key))));

      const getOrCreate = (key: string): Effect.Effect<RegistryEntry, Signal.SignalScopeError> =>
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
            const currentFiber = yield* Ref.make<Option.Option<Fiber.Fiber<void, never>>>(
              Option.none(),
            );
            const timestamp = yield* Ref.make(0);
            const scope = yield* Scope.fork(registryScope);

            const entry: RegistryEntry = { state, inFlight, currentFiber, timestamp, scope };
            const newMap = new Map(map);
            newMap.set(key, entry);

            const result: readonly [RegistryEntry, Map<string, RegistryEntry>] = [entry, newMap];
            return result;
          }),
        );

      const deleteEntry = (key: string): Effect.Effect<void> =>
        SynchronizedRef.modifyEffect(cache, (map) =>
          Effect.gen(function* () {
            const newMap = new Map(map);
            const entry = newMap.get(key);
            newMap.delete(key);

            if (entry !== undefined) {
              yield* Scope.close(entry.scope, Exit.void);
            }

            const result: readonly [void, Map<string, RegistryEntry>] = [undefined, newMap];
            return result;
          }),
        );

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
  startImmediately: boolean = false,
): Effect.Effect<Fiber.Fiber<void, never>> =>
  Effect.gen(function* () {
    const state = unsafeEntrySignal<A, E>(entry.state);

    yield* Debug.log({
      event: "resource.fetch.start",
      key: resource.key,
    });

    // Create deferred for dedupe coordination
    const deferred = yield* Deferred.make<void, never>();
    yield* Ref.set(entry.inFlight, Option.some(deferred));

    const fiber: Fiber.Fiber<void, never> = yield* Debug.log({
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
      Effect.tapCause((cause) =>
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
          Cause.hasInterruptsOnly(cause)
            ? Debug.log({
                event: "resource.fetch.interrupted",
                key: resource.key,
              })
            : Effect.gen(function* () {
                const error = Cause.squash(cause);
                yield* Debug.log({
                  event: "resource.fetch.set_failure",
                  key: resource.key,
                  error: String(error),
                });
                const prev = yield* Signal.get(state);
                const staleValue =
                  prev._tag === "Success" ? Option.some(prev.value) : Option.none();
                yield* Signal.set(state, Failure<A, E>(unsafeAsError<E>(error), staleValue));
              }),
      }),
      Effect.catchCause((cause) =>
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
      Effect.forkIn(entry.scope, { startImmediately }),
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
 * @remarks
 * Static fetches reuse cached entries by key. Reactive fetches keep the output
 * signal stable while switching the backing cache entry as params change.
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
 * @category Async State
 * @public
 * @since 1.0.0
 */
export const fetch: {
  <A, E, R>(
    resource: Resource<A, E, R>,
  ): Effect.Effect<
    Signal.Signal<ResourceState<A, E>>,
    Signal.SignalScopeError,
    ResourceRegistryTag | R
  >;
  <P extends object, A, E, R>(
    factory: (params: P) => Resource<A, E, R>,
    params: ReactiveParams<P>,
  ): Effect.Effect<
    Signal.Signal<ResourceState<A, E>>,
    Signal.SignalScopeError,
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
        return Effect.die(new ResourceFactoryParamsRequiredError());
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
): Effect.Effect<
  Signal.Signal<ResourceState<A, E>>,
  Signal.SignalScopeError,
  ResourceRegistryTag | R
> =>
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

    // Check if we have cached data.
    // CRITICAL: Read untracked to prevent component re-render on Pending→Success.
    // If we tracked this read, the component would re-render when state changes,
    // causing keyed-list teardown/remount race that blanks rendered items.
    const currentState = yield* Signal.peek(state);
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
  Signal.SignalScopeError,
  ResourceRegistryTag | R | Scope.Scope
> =>
  Effect.gen(function* () {
    const ctx = yield* Effect.context<ResourceRegistryTag | R>();
    const scope = yield* Effect.scope;

    // Unwrap current values from reactive params without registering component
    // dependencies — reactivity is handled by explicit subscriptions below.
    const unwrapParams = (): Effect.Effect<P> =>
      Effect.gen(function* () {
        const result: Record<string, unknown> = {};
        for (const [key, value] of Object.entries(reactiveParams)) {
          if (Signal.isSignal(value)) {
            result[key] = yield* Signal.peek(value);
          } else {
            result[key] = value;
          }
        }
        return unsafeAsParams<P>(result);
      });

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

    // Track current in-flight fiber for cancellation (SynchronizedRef for atomic updates)
    const activeFiber = yield* SynchronizedRef.make<Option.Option<Fiber.Fiber<void, never>>>(
      Option.none(),
    );

    // Track current resource key for change detection
    const activeKey = yield* Ref.make(initialResource.key);

    // Helper: cancel previous daemon, fork new fetch, sync result to output.
    // The daemon stays alive after the initial fetch, mirroring entry.state → outputState
    // so that invalidate/refresh changes propagate to the component.
    // Uses SynchronizedRef.updateEffect to atomically interrupt+fork+store, preventing
    // race conditions where concurrent doFetch calls could leak daemons.
    const doFetch = (resource: Resource<A, E, R>): Effect.Effect<void, Signal.SignalScopeError> =>
      Effect.gen(function* () {
        yield* Ref.set(activeKey, resource.key);
        yield* Signal.set(outputState, Pending<A, E>());

        const setOutputIfActive = (next: ResourceState<A, E>): Effect.Effect<void> =>
          Effect.gen(function* () {
            const currentKey = yield* Ref.get(activeKey);
            if (currentKey === resource.key) {
              yield* Signal.set(outputState, next);
            }
          });

        // Atomically: interrupt previous daemon → fork new daemon → store reference
        yield* SynchronizedRef.updateEffect(activeFiber, (prevFiber) =>
          Effect.gen(function* () {
            // Cancel previous doFetch daemon before forking new one
            if (Option.isSome(prevFiber)) {
              yield* Fiber.interrupt(prevFiber.value);
            }

            // Fork the fetch work as a daemon
            const daemon = yield* Effect.gen(function* () {
              const registry = yield* ResourceRegistryTag;
              const entry = yield* registry.getOrCreate(resource.key);
              const entryState = unsafeEntrySignal<A, E>(entry.state);

              // Check if already cached
              const cached = yield* Signal.peek(entryState);
              if (cached._tag !== "Pending") {
                yield* setOutputIfActive(cached);
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
                    true,
                  );
                  yield* Fiber.join(fiber);
                }
                // Sync resolved state to output
                const finalState = yield* Signal.peek(entryState);
                yield* setOutputIfActive(finalState);
              }

              // Subscribe to entry state so invalidate/refresh propagates to outputState.
              // The daemon stays alive until interrupted by the next doFetch call.
              const unsubscribe = yield* Signal.subscribe(entryState, () =>
                Signal.peek(entryState).pipe(Effect.flatMap((s) => setOutputIfActive(s))),
              );
              return yield* Effect.never.pipe(Effect.ensuring(unsubscribe));
            }).pipe(
              Effect.provide(ctx),
              Effect.catchCause((cause) =>
                Cause.hasInterruptsOnly(cause)
                  ? Effect.void
                  : Debug.log({
                      event: "resource.fetch.unhandled",
                      key: resource.key,
                      error: Cause.squash(cause),
                      error_message: String(Cause.squash(cause)),
                    }),
              ),
              Effect.forkIn(scope, { startImmediately: true }),
            );

            return Option.some(daemon);
          }),
        );
      });

    // Initial fetch
    yield* doFetch(initialResource).pipe(Effect.provide(ctx));

    // If there are reactive signals, subscribe to changes
    if (signalFields.length > 0) {
      const onParamChange = (): Effect.Effect<void, Signal.SignalScopeError> =>
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
        const fiber = yield* SynchronizedRef.get(activeFiber);
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

type MatchState = "Pending" | "Success" | "Failure";

type PendingPayload<A> = { readonly stale: Option.Option<A> };
type SuccessPayload<A> = { readonly value: A; readonly stale: boolean };
type FailurePayload<A, E> = { readonly error: E; readonly stale: Option.Option<A> };

type PendingComponentHandler<R> = Component.Type<any, unknown, R>;
type SuccessComponentHandler<R> = Component.Type<any, unknown, R>;
type FailureComponentHandler<R> = Component.Type<any, unknown, R>;

type PendingFunctionHandler = (payload: PendingPayload<any>) => ElementType;
type SuccessFunctionHandler = (payload: SuccessPayload<any>) => ElementType;
type FailureFunctionHandler = (payload: FailurePayload<any, any>) => ElementType;

type PendingHandler<R> = PendingComponentHandler<R> | PendingFunctionHandler | ElementType;
type SuccessHandler<R> = SuccessComponentHandler<R> | SuccessFunctionHandler;
type FailureHandler<R> = FailureComponentHandler<R> | FailureFunctionHandler;
type ResourceHandler = PendingHandler<unknown> | SuccessHandler<unknown> | FailureHandler<unknown>;

const isEffectComponentLike = (value: unknown): value is Component.Type<any, unknown, unknown> =>
  typeof value === "function" && value !== null && Reflect.get(value, "_tag") === "EffectComponent";

const isPendingComponent = <R>(handler: PendingHandler<R>): handler is PendingComponentHandler<R> =>
  isEffectComponentLike(handler);

const isSuccessComponent = <R>(handler: SuccessHandler<R>): handler is SuccessComponentHandler<R> =>
  isEffectComponentLike(handler);

const isFailureComponent = <R>(handler: FailureHandler<R>): handler is FailureComponentHandler<R> =>
  isEffectComponentLike(handler);

const isPendingStateHandler = (
  state: MatchState,
  _handler: PendingHandler<unknown> | SuccessHandler<unknown> | FailureHandler<unknown>,
): _handler is PendingHandler<unknown> => state === "Pending";

const isSuccessStateHandler = (
  state: MatchState,
  _handler: PendingHandler<unknown> | SuccessHandler<unknown> | FailureHandler<unknown>,
): _handler is SuccessHandler<unknown> => state === "Success";

const isFailureStateHandler = (
  state: MatchState,
  _handler: PendingHandler<unknown> | SuccessHandler<unknown> | FailureHandler<unknown>,
): _handler is FailureHandler<unknown> => state === "Failure";

const renderPending = <A>(
  handler: PendingHandler<unknown>,
  payload: PendingPayload<A>,
): ElementType => {
  if (isPendingComponent(handler)) {
    return handler(payload);
  }
  if (typeof handler === "function") {
    return handler(payload);
  }
  return handler;
};

const renderSuccess = <A>(
  handler: SuccessHandler<unknown>,
  payload: SuccessPayload<A>,
): ElementType => {
  if (isSuccessComponent(handler)) {
    return handler(payload);
  }
  return handler(payload);
};

const renderFailure = <A, E>(
  handler: FailureHandler<unknown>,
  payload: FailurePayload<A, E>,
): ElementType => {
  if (isFailureComponent(handler)) {
    return handler(payload);
  }
  return handler(payload);
};

/**
 * Pipeable matcher for Resource state rendering.
 *
 * @remarks
 * Build these with `Resource.match(state)` and finish with `Resource.exhaustive`.
 *
 * @example
 * ```tsx
 * const matcher = Resource.match(state)
 * ```
 *
 * @category Async State
 * @public
 * @since 1.0.0
 */
export interface ResourceMatcher<
  A,
  E,
  R,
  HasPending extends boolean,
  HasSuccess extends boolean,
  HasFailure extends boolean,
> extends ReactiveMatcher.ReactiveMatcher<
  "ResourceMatcher",
  Signal.Signal<ResourceState<A, E>>,
  ReadonlyMap<MatchState, ResourceHandler>
> {
  readonly _tag: "ResourceMatcher";
  readonly source: Signal.Signal<ResourceState<A, E>>;
  readonly state: Signal.Signal<ResourceState<A, E>>;
  readonly handlers: ReadonlyMap<MatchState, ResourceHandler>;
  readonly pending?: PendingHandler<unknown>;
  readonly success?: SuccessHandler<unknown>;
  readonly failure?: FailureHandler<unknown>;
  readonly _R?: R;
  readonly _hasPending?: HasPending;
  readonly _hasSuccess?: HasSuccess;
  readonly _hasFailure?: HasFailure;
}

const makeMatcher = <
  A,
  E,
  R,
  HasPending extends boolean,
  HasSuccess extends boolean,
  HasFailure extends boolean,
>(
  state: Signal.Signal<ResourceState<A, E>>,
  pending?: PendingHandler<unknown>,
  success?: SuccessHandler<unknown>,
  failure?: FailureHandler<unknown>,
): ResourceMatcher<A, E, R, HasPending, HasSuccess, HasFailure> => {
  const handlers = new Map<MatchState, ResourceHandler>();
  if (pending !== undefined) handlers.set("Pending", pending);
  if (success !== undefined) handlers.set("Success", success);
  if (failure !== undefined) handlers.set("Failure", failure);

  return {
    ...ReactiveMatcher.make("ResourceMatcher", state, handlers),
    source: state,
    state,
    ...(pending === undefined ? {} : { pending }),
    ...(success === undefined ? {} : { success }),
    ...(failure === undefined ? {} : { failure }),
  };
};

/**
 * Start Resource state matching.
 *
 * @remarks
 * Use the matcher helpers when UI should react to `Pending`, `Success`, and `Failure`
 * without manual switches in component code.
 *
 * @example
 * ```tsx
 * const view = yield* Resource.match(state).pipe(
 *   Resource.on("Pending", () => <Spinner />),
 *   Resource.on("Success", ({ value, stale }) => <UserCard user={value} stale={stale} />),
 *   Resource.on("Failure", ({ error, stale }) => <ErrorView error={error} stale={stale} />),
 *   Resource.exhaustive,
 * )
 * ```
 *
 * @category Async State
 * @public
 * @since 1.0.0
 */
export const match = <A, E>(
  state: Signal.Signal<ResourceState<A, E>>,
): ResourceMatcher<A, E, never, false, false, false> => makeMatcher(state);

/**
 * Register a state handler on a Resource matcher.
 *
 * - `Pending` payload: `{ stale: Option.Option<A> }`
 * - `Success` payload: `{ value: A, stale: boolean }`
 * - `Failure` payload: `{ error: E, stale: Option.Option<A> }`
 *
 * @remarks
 * `Resource.on` keeps state rendering pipeable and type-safe until `Resource.exhaustive`.
 *
 * @example
 * ```tsx
 * const matcher = Resource.match(state).pipe(Resource.on("Pending", () => <Spinner />))
 * ```
 *
 * @category Async State
 * @public
 * @since 1.0.0
 */
export function on<RHandler>(
  state: "Pending",
  handler: PendingComponentHandler<RHandler>,
): <A, E, R, HasPending extends boolean, HasSuccess extends boolean, HasFailure extends boolean>(
  self: ResourceMatcher<A, E, R, HasPending, HasSuccess, HasFailure>,
) => ResourceMatcher<A, E, R | RHandler, true, HasSuccess, HasFailure>;

export function on(
  state: "Pending",
  handler: PendingFunctionHandler | ElementType,
): <A, E, R, HasPending extends boolean, HasSuccess extends boolean, HasFailure extends boolean>(
  self: ResourceMatcher<A, E, R, HasPending, HasSuccess, HasFailure>,
) => ResourceMatcher<A, E, R, true, HasSuccess, HasFailure>;

export function on<RHandler>(
  state: "Success",
  handler: SuccessComponentHandler<RHandler>,
): <A, E, R, HasPending extends boolean, HasSuccess extends boolean, HasFailure extends boolean>(
  self: ResourceMatcher<A, E, R, HasPending, HasSuccess, HasFailure>,
) => ResourceMatcher<A, E, R | RHandler, HasPending, true, HasFailure>;

export function on(
  state: "Success",
  handler: SuccessFunctionHandler,
): <A, E, R, HasPending extends boolean, HasSuccess extends boolean, HasFailure extends boolean>(
  self: ResourceMatcher<A, E, R, HasPending, HasSuccess, HasFailure>,
) => ResourceMatcher<A, E, R, HasPending, true, HasFailure>;

export function on<RHandler>(
  state: "Failure",
  handler: FailureComponentHandler<RHandler>,
): <A, E, R, HasPending extends boolean, HasSuccess extends boolean, HasFailure extends boolean>(
  self: ResourceMatcher<A, E, R, HasPending, HasSuccess, HasFailure>,
) => ResourceMatcher<A, E, R | RHandler, HasPending, HasSuccess, true>;

export function on(
  state: "Failure",
  handler: FailureFunctionHandler,
): <A, E, R, HasPending extends boolean, HasSuccess extends boolean, HasFailure extends boolean>(
  self: ResourceMatcher<A, E, R, HasPending, HasSuccess, HasFailure>,
) => ResourceMatcher<A, E, R, HasPending, HasSuccess, true>;

export function on(
  state: MatchState,
  handler: PendingHandler<unknown> | SuccessHandler<unknown> | FailureHandler<unknown>,
) {
  return (
    self: ResourceMatcher<unknown, unknown, unknown, boolean, boolean, boolean>,
  ): ResourceMatcher<unknown, unknown, unknown, boolean, boolean, boolean> => {
    if (isPendingStateHandler(state, handler)) {
      return makeMatcher(self.state, handler, self.success, self.failure);
    }
    if (isSuccessStateHandler(state, handler)) {
      return makeMatcher(self.state, self.pending, handler, self.failure);
    }
    if (isFailureStateHandler(state, handler)) {
      return makeMatcher(self.state, self.pending, self.success, handler);
    }
    return makeMatcher(self.state, self.pending, self.success, self.failure);
  };
}

/**
 * Finalize a Resource matcher into an Element.
 *
 * Requires handlers for all states.
 *
 * @remarks
 * This turns a matcher back into renderable output while preserving reactive updates.
 *
 * @example
 * ```tsx
 * const view = yield* Resource.match(state).pipe(
 *   Resource.on("Pending", () => <Spinner />),
 *   Resource.on("Success", ({ value }) => <UserCard user={value} />),
 *   Resource.on("Failure", ({ error }) => <ErrorView error={error} />),
 *   Resource.exhaustive,
 * )
 * ```
 *
 * @category Async State
 * @public
 * @since 1.0.0
 */
export const exhaustive = <A, E, R>(
  self: ResourceMatcher<A, E, R, true, true, true>,
): Effect.Effect<ElementType, never, Scope.Scope | R> =>
  Effect.gen(function* () {
    const pending = self.pending;
    const success = self.success;
    const failure = self.failure;

    if (pending === undefined || success === undefined || failure === undefined) {
      return Element.Text({ content: "Resource.match unavailable" });
    }

    let staleForPending: Option.Option<A> = Option.none();

    const render = ReactiveMatcher.tagsExhaustive<ResourceState<A, E>, ElementType>({
      Pending: () => renderPending(pending, { stale: staleForPending }),
      Success: (s) => {
        staleForPending = Option.some(s.value);
        return renderSuccess(success, { value: s.value, stale: s.stale });
      },
      Failure: (s) => {
        staleForPending = s.staleValue;
        return renderFailure(failure, { error: s.error, stale: s.staleValue });
      },
    });

    return yield* ReactiveMatcher.toReactiveElement<
      Signal.Signal<ResourceState<A, E>>,
      ResourceState<A, E>,
      Signal.Signal<ElementType>,
      ElementType,
      never,
      Scope.Scope | R
    >(
      self.state,
      (source, render) => Signal.derive(source, render),
      (signal) => Element.SignalElement({ signal, onSwap: undefined }),
      render,
    );
  }).pipe(Effect.withSpan("Resource.match"));

/**
 * Mark resource as stale and trigger background refetch.
 *
 * Preserves current Success value with stale=true during refetch.
 * Dedupes: no-op if fetch already in progress.
 *
 * @remarks
 * Use this for stale-while-revalidate flows where old data can stay visible.
 *
 * @example
 * ```tsx
 * <button onClick={() => Resource.invalidate(userResource({ id }))}>
 *   Refresh
 * </button>
 * ```
 *
 * @category Async State
 * @public
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
 * @remarks
 * Use this when a hard reload is better than showing stale data.
 *
 * @example
 * ```tsx
 * <button onClick={() => Resource.refresh(userResource({ id }))}>
 *   Reload
 * </button>
 * ```
 *
 * @category Async State
 * @public
 * @since 1.0.0
 */
export const refresh = <A, E, R>(
  resource: Resource<A, E, R>,
): Effect.Effect<void, Signal.SignalScopeError, ResourceRegistryTag | R> =>
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
 * @remarks
 * Clearing removes the cached entry entirely instead of marking it stale.
 *
 * @example
 * ```ts
 * yield* Resource.clear(userResource({ id: "1" }))
 * ```
 *
 * @category Async State
 * @public
 * @since 1.0.0
 */
export const clear = <A, E, R>(
  resource: Resource<A, E, R>,
): Effect.Effect<void, never, ResourceRegistryTag> =>
  Effect.gen(function* () {
    const registry = yield* ResourceRegistryTag;
    yield* registry.delete(resource.key);
  }).pipe(Effect.withSpan("Resource.clear", { attributes: { key: resource.key } }));
