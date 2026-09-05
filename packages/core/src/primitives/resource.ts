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
  Clock,
  Data,
  Deferred,
  Duration,
  Effect,
  Exit,
  Layer,
  Option,
  Predicate,
  Ref,
  Schema,
  Scope,
  SynchronizedRef,
} from "effect";
import * as Context from "effect/Context";
import * as Signal from "./signal.js";
import { Element, type Element as ElementType } from "./element.js";
import { isEffectComponent, type Component } from "./component.js";
import { cleanupAll, reportUnhandledRenderExit } from "./render-cleanup.js";
import * as ReactiveMatcher from "./reactive-matcher.js";
import * as Trace from "../trace/index.js";
import {
  unsafeEntrySignal,
  unsafeAsParams,
  unsafeAsUnrecoverableCause,
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
export type ResourceState<A, E> = Data.TaggedEnum<{
  readonly Pending: {};
  readonly Success: { readonly value: A; readonly stale: boolean };
  readonly Failure: {
    readonly error: E;
    readonly staleValue: Option.Option<A>;
  };
}>;

interface ResourceStateDefinition extends Data.TaggedEnum.WithGenerics<2> {
  readonly taggedEnum: ResourceState<this["A"], this["B"]>;
}

const ResourceState = Data.taggedEnum<ResourceStateDefinition>();

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
export const Pending = <A, E>(): ResourceState<A, E> => ResourceState.Pending<A, E>();

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
export const Success = <A, E>(value: A, stale: boolean = false): ResourceState<A, E> =>
  ResourceState.Success<A, E>({ value, stale });

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
): ResourceState<A, E> => ResourceState.Failure<A, E>({ error, staleValue });

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
export const isPending = <A, E>(
  state: ResourceState<A, E>,
): state is Extract<ResourceState<A, E>, { readonly _tag: "Pending" }> =>
  ResourceState.$is("Pending")(state);

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
): state is Extract<ResourceState<A, E>, { readonly _tag: "Success" }> =>
  ResourceState.$is("Success")(state);

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
): state is Extract<ResourceState<A, E>, { readonly _tag: "Failure" }> =>
  ResourceState.$is("Failure")(state);

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

class ResourceData<A, E, R> extends Data.TaggedClass("Resource")<{
  readonly key: string;
  readonly fetch: Effect.Effect<A, E, R>;
}> {}

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
 *   { key: ({ id }) => Resource.hash("users.getUser", id) }
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
    return (params: P): Resource<A, E, R> =>
      new ResourceData({
        key: keyFn(params),
        fetch: factoryFn(params),
      });
  }
  // When key is a string, factory takes no params (overload correlation).
  // TypeScript can't narrow correlated unions.
  return new ResourceData({
    key: options.key,
    fetch: unsafeCallNoArgs<Effect.Effect<A, E, R>>(factory),
  });
}

// =============================================================================
// Resource.hash - Deterministic cache key generation
// =============================================================================

const canonicalFrame = (tag: string, payload: string): string =>
  `${tag}${payload.length}:${payload}`;

interface ObjectIdentityRegistry {
  readonly ids: WeakMap<object, bigint>;
  nextId: bigint;
}

const objectIdentityRegistryKey = Symbol.for("trygg/Resource/objectIdentity/v3");
// oxlint-disable-next-line effect/no-type-casting -- This versioned Symbol.for slot is private framework state, and globalThis cannot express symbol-key augmentation directly.
const objectIdentityRegistryGlobal = globalThis as typeof globalThis & {
  [objectIdentityRegistryKey]: ObjectIdentityRegistry | undefined;
};
const objectIdentityRegistry = (objectIdentityRegistryGlobal[objectIdentityRegistryKey] ??= {
  ids: new WeakMap<object, bigint>(),
  nextId: 0n,
});

const objectIdentityId = (value: object): bigint => {
  const existing = objectIdentityRegistry.ids.get(value);
  if (existing !== undefined) return existing;
  const id = objectIdentityRegistry.nextId;
  objectIdentityRegistry.nextId += 1n;
  objectIdentityRegistry.ids.set(value, id);
  return id;
};

/**
 * Reports a non-global Symbol passed to {@link hash}.
 *
 * @remarks
 * Local and well-known Symbols have no deterministic, weakly-held identity.
 * Use `Symbol.for`, a primitive value, or an opaque reference instead.
 *
 * @example
 * ```ts
 * Resource.hash("users.byRole", Symbol.for("admin"))
 * ```
 *
 * @category Async State
 * @public
 * @since 1.0.0
 */
export class ResourceHashLocalSymbolError extends Schema.TaggedError<ResourceHashLocalSymbolError>()(
  "ResourceHashLocalSymbolError",
  {
    message: Schema.String,
  },
) {}

const encodeHashPart = (value: unknown): string => {
  if (value === null) return "n";

  switch (typeof value) {
    case "undefined":
      return "u";
    case "boolean":
      return value ? "b1" : "b0";
    case "string":
      return canonicalFrame("s", value);
    case "number":
      if (Number.isNaN(value)) return "dNaN";
      if (value === Number.POSITIVE_INFINITY) return "dInfinity";
      if (value === Number.NEGATIVE_INFINITY) return "d-Infinity";
      if (Object.is(value, -0)) return "d-0";
      return canonicalFrame("d", String(value));
    case "bigint":
      return canonicalFrame("i", String(value));
    case "symbol": {
      const globalKey = Symbol.keyFor(value);
      if (globalKey === undefined) {
        // oxlint-disable-next-line effect/no-raw-throw -- Resource.hash is a synchronous JavaScript identity boundary and rejects unsupported Symbols synchronously.
        throw new ResourceHashLocalSymbolError({
          message: "Resource.hash only accepts Symbols created by Symbol.for",
        });
      }
      return canonicalFrame("yg", globalKey);
    }
    case "function":
      return canonicalFrame("f", String(objectIdentityId(value)));
    case "object":
      return canonicalFrame("o", String(objectIdentityId(value)));
  }
  return "u";
};

/**
 * Generate a stable cache key from a prefix and positional identity parts.
 *
 * @remarks
 * Primitive parts and `Symbol.for` values have deterministic structural identity.
 * Objects and functions are opaque process-local references: hashing never reads
 * their keys, properties, prototypes, or contents. Duplicate module copies share
 * one versioned weak identity authority for HMR safety. Pass immutable primitive
 * parts when independently-created values must share identity. Non-global Symbols
 * are rejected with {@link ResourceHashLocalSymbolError}.
 *
 * @example
 * ```tsx
 * Resource.hash("users.getUser", "123")
 * // => "trygg-resource:v3:..."
 * ```
 *
 * @category Async State
 * @public
 * @since 1.0.0
 */
export const hash = (prefix: string, ...parts: ReadonlyArray<unknown>): string => {
  let encoded = canonicalFrame("p", prefix);
  for (const part of parts) {
    encoded += canonicalFrame("v", encodeHashPart(part));
  }
  return `trygg-resource:v3:${encoded}`;
};

// =============================================================================
// ResourceRegistry - Service for caching and deduplication
// =============================================================================

/**
 * Registry entry for internal state management.
 * @internal
 */
interface RegistryEntry {
  readonly key: string;
  readonly state: Signal.Signal<ResourceState<unknown, unknown>>;
  readonly inFlight: Ref.Ref<Option.Option<InFlight>>;
  readonly scope: Scope.Closeable;
}

interface EntryLifetime {
  readonly leases: ReadonlySet<object>;
  readonly retired: boolean;
  readonly closeStarted: boolean;
}

interface InFlight {
  readonly deferred: Deferred.Deferred<void, never>;
  readonly key: string;
}

interface RegistryRecord {
  readonly entry: RegistryEntry;
  readonly expiresAt: number;
}

interface PendingAdmission {
  readonly deferred: Deferred.Deferred<Option.Option<RegistryEntry>>;
}

interface RegistryState {
  readonly cache: Map<string, RegistryRecord>;
  readonly entries: Map<RegistryEntry, EntryLifetime>;
  readonly pending: Map<string, PendingAdmission>;
  nextExpiration: number;
}

/**
 * Framework-owned terminal reporter for Resource fetch workers.
 *
 * @remarks
 * The fetch owner invokes this with the complete terminal Exit for defects,
 * interruption, and mixed Causes. Causes containing only typed failures become
 * Resource Failure state and are not reported.
 *
 * @internal
 */
export type ResourceFetchExitReporter = (exit: Exit.Exit<unknown, unknown>) => void;

declare global {
  var __tryggResourceCurrentFetchExitReporter:
    | Context.Reference<ResourceFetchExitReporter>
    | undefined;
}

/**
 * Terminal reporter inherited by owned Resource fetch workers.
 *
 * @remarks
 * The reference is shared across duplicate module copies so HMR does not split
 * the owner policy. Tests and renderer integrations can replace it to observe
 * the exact terminal Exit.
 *
 * @internal
 */
export const CurrentResourceFetchExitReporter: Context.Reference<ResourceFetchExitReporter> =
  (globalThis.__tryggResourceCurrentFetchExitReporter ??=
    Context.Reference<ResourceFetchExitReporter>("trygg/Resource/CurrentFetchExitReporter", {
      defaultValue: () => reportUnhandledRenderExit,
    }));

class ResourceFactoryParamsRequiredError extends Schema.TaggedError<ResourceFactoryParamsRequiredError>()(
  "ResourceFactoryParamsRequiredError",
  {},
) {}

/**
 * Reports that a Resource registry has no free or safely evictable slot.
 *
 * @remarks
 * Capacity counts admitted entries, retired entries that still have leases,
 * in-flight fetches, entries being closed, and reserved candidates. Admission
 * fails immediately instead of waiting for an existing consumer to release.
 *
 * @example
 * ```ts
 * const recovered = Resource.fetch(users).pipe(
 *   Effect.catchTag("ResourceRegistrySaturatedError", () => Effect.succeed(null)),
 * )
 * ```
 *
 * @category Async State
 * @public
 * @since 1.0.0
 */
export class ResourceRegistrySaturatedError extends Schema.TaggedError<ResourceRegistrySaturatedError>()(
  "ResourceRegistrySaturatedError",
  {
    capacity: Schema.Int,
    key: Schema.String,
    message: Schema.String,
  },
) {}

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
  readonly getOrCreate: (
    key: string,
  ) => Effect.Effect<RegistryEntry, ResourceRegistrySaturatedError>;
  readonly acquire: (key: string, entry: RegistryEntry, lease: object) => Effect.Effect<boolean>;
  readonly release: (entry: RegistryEntry, lease: object) => Effect.Effect<void>;
  readonly retire: (key: string, entry: RegistryEntry) => Effect.Effect<void>;
  readonly delete: (key: string) => Effect.Effect<void>;
}

const resourceRegistryServiceTag: ResourceRegistry["_tag"] = "ResourceRegistry";

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
export class ResourceRegistryTag extends Context.Service<
  ResourceRegistryTag,
  {
    readonly _tag: "ResourceRegistry";
    readonly get: (key: string) => Effect.Effect<Option.Option<RegistryEntry>>;
    readonly getOrCreate: (
      key: string,
    ) => Effect.Effect<RegistryEntry, ResourceRegistrySaturatedError>;
    readonly acquire: (key: string, entry: RegistryEntry, lease: object) => Effect.Effect<boolean>;
    readonly release: (entry: RegistryEntry, lease: object) => Effect.Effect<void>;
    readonly retire: (key: string, entry: RegistryEntry) => Effect.Effect<void>;
    readonly delete: (key: string) => Effect.Effect<void>;
  }
>()("trygg/ResourceRegistryTag") {}

/**
 * Capacity and idle-expiration policy for an in-memory Resource registry.
 *
 * @remarks
 * `capacity` bounds the registry with least-recently-used eviction. `timeToLive`
 * is an idle timeout refreshed by registry access; expired entries are removed
 * lazily on later access. Capacity includes reserved, admitted, in-flight,
 * closing, and retired-but-leased entries. When no slot is free or safely
 * evictable, admission fails with {@link ResourceRegistrySaturatedError} instead
 * of waiting.
 *
 * @example
 * ```ts
 * const options: Resource.ResourceRegistryOptions = {
 *   capacity: 128,
 *   timeToLive: "10 minutes",
 * }
 * ```
 *
 * @category Async State
 * @public
 * @since 1.0.0
 */
export interface ResourceRegistryOptions {
  /** Maximum total live, reserved, retired, and closing entries. */
  readonly capacity: number;
  /** Idle time after the last registry access before an entry expires. */
  readonly timeToLive: Duration.Input;
}

/**
 * Reports an invalid explicit Resource registry policy.
 *
 * @remarks
 * `Resource.ResourceRegistry.layer` exposes this error in the returned Layer when capacity
 * is not a positive safe integer or the idle TTL is invalid or negative.
 *
 * @example
 * ```ts
 * const layer: Layer.Layer<
 *   Resource.ResourceRegistryTag,
 *   Resource.ResourceRegistryOptionsError
 * > = Resource.ResourceRegistry.layer({ capacity: 0, timeToLive: "1 minute" })
 * ```
 *
 * @category Async State
 * @public
 * @since 1.0.0
 */
export class ResourceRegistryOptionsError extends Schema.TaggedError<ResourceRegistryOptionsError>()(
  "ResourceRegistryOptionsError",
  {
    message: Schema.String,
  },
) {}

const expiresAt = (now: number, timeToLiveMillis: number): number =>
  timeToLiveMillis === Number.POSITIVE_INFINITY ? Number.POSITIVE_INFINITY : now + timeToLiveMillis;

const storeCacheEntry = (state: RegistryState, key: string, record: RegistryRecord): void => {
  state.cache.set(key, record);
  // A conservative lower bound remains safe across renewal, deletion, and clock
  // rollback. Recompute the exact minimum only when that bound is reached.
  state.nextExpiration = Math.min(state.nextExpiration, record.expiresAt);
};

const retireEntryInState = (
  state: RegistryState,
  entry: RegistryEntry,
  force: boolean,
): boolean => {
  const lifetime = state.entries.get(entry);
  if (lifetime === undefined || lifetime.closeStarted) return false;

  const closeStarted = force || lifetime.leases.size === 0;
  state.entries.set(entry, { ...lifetime, retired: true, closeStarted });
  return closeStarted;
};

const pruneExpired = (state: RegistryState, now: number): ReadonlyArray<RegistryEntry> => {
  if (now < state.nextExpiration) return [];
  const closing: Array<RegistryEntry> = [];
  state.nextExpiration = Number.POSITIVE_INFINITY;
  for (const [key, record] of state.cache) {
    if (record.expiresAt <= now) {
      state.cache.delete(key);
      if (retireEntryInState(state, record.entry, false)) closing.push(record.entry);
    } else {
      state.nextExpiration = Math.min(state.nextExpiration, record.expiresAt);
    }
  }
  return closing;
};

type AdmissionDecision = Data.TaggedEnum<{
  readonly Closed: {};
  readonly Existing: { readonly entry: RegistryEntry };
  readonly Join: { readonly pending: PendingAdmission };
  readonly Reserve: { readonly pending: PendingAdmission };
  readonly Cleanup: { readonly entries: ReadonlyArray<RegistryEntry> };
  readonly Saturated: {};
}>;

const AdmissionDecision = Data.taggedEnum<AdmissionDecision>();

const makeRegistryService = (
  capacity: number,
  timeToLiveMillis: number,
): Effect.Effect<ResourceRegistry, never, Scope.Scope> =>
  Effect.gen(function* () {
    // This state never escapes the registry and is accessed only in synchronous
    // Ref callbacks. Mutating its Maps there preserves atomic decisions without
    // copying every cached entry on a hit. Cleanup and user effects run afterward.
    const state = yield* Ref.make<RegistryState>({
      cache: new Map(),
      entries: new Map(),
      pending: new Map(),
      nextExpiration: Number.POSITIVE_INFINITY,
    });
    const registryScope = yield* Effect.scope;

    yield* Effect.addFinalizer(() =>
      Ref.modify(state, (current) => {
        const pending = Array.from(current.pending.values());
        current.cache.clear();
        current.entries.clear();
        current.pending.clear();
        current.nextExpiration = Number.POSITIVE_INFINITY;
        return [pending, current];
      }).pipe(
        Effect.flatMap((pending) =>
          Effect.forEach(
            pending,
            (admission) => Deferred.succeed(admission.deferred, Option.none()),
            {
              discard: true,
            },
          ),
        ),
      ),
    );

    const closeEntries = (entries: ReadonlyArray<RegistryEntry>): Effect.Effect<void> =>
      cleanupAll(
        entries.map((entry) =>
          Scope.close(entry.scope, Exit.void).pipe(
            // A failed finalizer still consumes the scope. Release its capacity
            // while preserving the Cause and continuing the remaining releases.
            Effect.ensuring(
              Ref.update(state, (current) => {
                if (!current.entries.has(entry)) return current;
                current.entries.delete(entry);
                return current;
              }),
            ),
          ),
        ),
      );

    const lookup = (
      key: string,
      now: number,
    ): Effect.Effect<{
      readonly entry: Option.Option<RegistryEntry>;
      readonly closing: ReadonlyArray<RegistryEntry>;
    }> =>
      Ref.modify(state, (current) => {
        if (Predicate.isTagged(registryScope.state, "Closed")) {
          return [{ entry: Option.none(), closing: [] }, current];
        }
        const closing = pruneExpired(current, now);
        const record = current.cache.get(key);
        if (record === undefined) {
          return [{ entry: Option.none(), closing }, current];
        }

        current.cache.delete(key);
        storeCacheEntry(current, key, {
          entry: record.entry,
          expiresAt: expiresAt(now, timeToLiveMillis),
        });
        return [{ entry: Option.some(record.entry), closing }, current];
      });

    const get: ResourceRegistry["get"] = Effect.fn("ResourceRegistry.get")(function* (key: string) {
      if (Predicate.isTagged(registryScope.state, "Closed")) return Option.none();
      const now = yield* Clock.currentTimeMillis;
      return yield* Effect.uninterruptible(
        Effect.gen(function* () {
          const result = yield* lookup(key, now);
          yield* closeEntries(result.closing);
          return Predicate.isTagged(registryScope.state, "Closed") ? Option.none() : result.entry;
        }),
      );
    });

    const makeEntry = (key: string): Effect.Effect<RegistryEntry> =>
      Effect.uninterruptibleMask((restore) =>
        Effect.gen(function* () {
          const scope = yield* Scope.fork(registryScope);
          if (Predicate.isTagged(scope.state, "Closed")) return yield* Effect.interrupt;
          const candidate = Effect.gen(function* () {
            const entryState = yield* Signal.makeInScope<ResourceState<unknown, unknown>>(
              Pending(),
              scope,
            );
            const inFlight = yield* Ref.make<Option.Option<InFlight>>(Option.none());
            return { key, state: entryState, inFlight, scope } satisfies RegistryEntry;
          });
          const exit = yield* restore(candidate).pipe(Effect.exit);
          if (Exit.isSuccess(exit)) return exit.value;

          return yield* Effect.failCause(exit.cause).pipe(
            Effect.ensuring(Scope.close(scope, exit)),
          );
        }),
      );

    const cancelPending = (key: string, pending: PendingAdmission): Effect.Effect<void> =>
      Effect.uninterruptible(
        Effect.gen(function* () {
          const removed = yield* Ref.modify(state, (current): readonly [boolean, RegistryState] => {
            if (current.pending.get(key) !== pending) return [false, current];
            current.pending.delete(key);
            return [true, current];
          });
          if (removed) yield* Deferred.succeed(pending.deferred, Option.none());
        }),
      );

    const decideAdmission = (
      key: string,
      now: number,
      candidate: PendingAdmission,
    ): Effect.Effect<AdmissionDecision> =>
      Ref.modify(state, (current): readonly [AdmissionDecision, RegistryState] => {
        if (Predicate.isTagged(registryScope.state, "Closed")) {
          return [AdmissionDecision.Closed(), current];
        }
        const expired = pruneExpired(current, now);
        if (expired.length > 0) {
          return [AdmissionDecision.Cleanup({ entries: expired }), current];
        }

        const existing = current.cache.get(key);
        if (existing !== undefined) {
          current.cache.delete(key);
          storeCacheEntry(current, key, {
            entry: existing.entry,
            expiresAt: expiresAt(now, timeToLiveMillis),
          });
          return [AdmissionDecision.Existing({ entry: existing.entry }), current];
        }

        const pending = current.pending.get(key);
        if (pending !== undefined) return [AdmissionDecision.Join({ pending }), current];

        if (current.entries.size + current.pending.size < capacity) {
          current.pending.set(key, candidate);
          return [AdmissionDecision.Reserve({ pending: candidate }), current];
        }

        for (const [oldestKey, oldest] of current.cache) {
          const lifetime = current.entries.get(oldest.entry);
          if (
            lifetime === undefined ||
            lifetime.retired ||
            lifetime.closeStarted ||
            lifetime.leases.size > 0
          ) {
            continue;
          }

          current.cache.delete(oldestKey);
          current.entries.set(oldest.entry, {
            ...lifetime,
            retired: true,
            closeStarted: true,
          });
          return [AdmissionDecision.Cleanup({ entries: [oldest.entry] }), current];
        }

        return [AdmissionDecision.Saturated(), current];
      });

    type RestoreInterruptibility = <A, E, R>(
      effect: Effect.Effect<A, E, R>,
    ) => Effect.Effect<A, E, R>;

    const createReserved: (
      key: string,
      pending: PendingAdmission,
      restore: RestoreInterruptibility,
    ) => Effect.Effect<Option.Option<RegistryEntry>> = Effect.fn("ResourceRegistry.createReserved")(
      function* (key: string, pending: PendingAdmission, restore: RestoreInterruptibility) {
        const candidateExit = yield* restore(makeEntry(key)).pipe(Effect.exit);
        if (Exit.isFailure(candidateExit)) {
          yield* cancelPending(key, pending);
          return yield* Effect.failCause(candidateExit.cause);
        }
        const candidate = candidateExit.value;

        const clockExit = yield* restore(Clock.currentTimeMillis).pipe(Effect.exit);
        if (Exit.isFailure(clockExit)) {
          return yield* Effect.failCause(clockExit.cause).pipe(
            Effect.ensuring(
              cleanupAll([Scope.close(candidate.scope, clockExit), cancelPending(key, pending)]),
            ),
          );
        }

        const committed = yield* Ref.modify(state, (current): readonly [boolean, RegistryState] => {
          if (Predicate.isTagged(registryScope.state, "Closed")) return [false, current];
          if (current.pending.get(key) !== pending) return [false, current];

          current.pending.delete(key);
          current.entries.set(candidate, {
            leases: new Set<object>(),
            retired: false,
            closeStarted: false,
          });
          storeCacheEntry(current, key, {
            entry: candidate,
            expiresAt: expiresAt(clockExit.value, timeToLiveMillis),
          });
          return [true, current];
        });

        if (!committed) {
          yield* Scope.close(candidate.scope, Exit.void);
          return Option.none();
        }

        yield* Deferred.succeed(pending.deferred, Option.some(candidate));
        yield* Trace.emit("resource.registry.create_entry", () => ({ key }));
        return Option.some(candidate);
      },
    );

    const getOrCreate: ResourceRegistry["getOrCreate"] = Effect.fn("ResourceRegistry.getOrCreate")(
      function* (key: string) {
        while (true) {
          if (Predicate.isTagged(registryScope.state, "Closed")) return yield* Effect.interrupt;
          const now = yield* Clock.currentTimeMillis;
          const candidate: PendingAdmission = {
            deferred: yield* Deferred.make<Option.Option<RegistryEntry>>(),
          };
          const entry = yield* Effect.uninterruptibleMask((restore) =>
            Effect.gen(function* () {
              const decision = yield* decideAdmission(key, now, candidate);

              switch (decision._tag) {
                case "Closed":
                  return yield* Effect.interrupt;
                case "Existing":
                  yield* Trace.emit("resource.registry.get_existing", () => ({ key }));
                  return Option.some(decision.entry);
                case "Join":
                  return yield* restore(Deferred.await(decision.pending.deferred));
                case "Reserve":
                  return yield* createReserved(key, decision.pending, restore);
                case "Cleanup":
                  yield* closeEntries(decision.entries);
                  return Option.none();
                case "Saturated":
                  return yield* new ResourceRegistrySaturatedError({
                    capacity,
                    key,
                    message: `Resource registry capacity ${capacity} has no free or safely evictable slot`,
                  });
              }
            }),
          );
          if (Predicate.isTagged(registryScope.state, "Closed")) return yield* Effect.interrupt;
          if (Option.isSome(entry)) return entry.value;
        }
      },
    );

    const acquire: ResourceRegistry["acquire"] = (key, entry, lease) =>
      Ref.modify(state, (current): readonly [boolean, RegistryState] => {
        if (Predicate.isTagged(registryScope.state, "Closed")) return [false, current];
        const record = current.cache.get(key);
        const lifetime = current.entries.get(entry);
        if (
          record?.entry !== entry ||
          lifetime === undefined ||
          lifetime.retired ||
          lifetime.closeStarted
        ) {
          return [false, current];
        }

        const leases = new Set(lifetime.leases);
        leases.add(lease);
        current.entries.set(entry, { ...lifetime, leases });
        return [true, current];
      });

    const release: ResourceRegistry["release"] = Effect.fn("ResourceRegistry.release")(function* (
      entry: RegistryEntry,
      lease: object,
    ) {
      yield* Effect.uninterruptible(
        Effect.gen(function* () {
          const closing = yield* Ref.modify(
            state,
            (current): readonly [ReadonlyArray<RegistryEntry>, RegistryState] => {
              const lifetime = current.entries.get(entry);
              if (lifetime === undefined || !lifetime.leases.has(lease)) return [[], current];

              const leases = new Set(lifetime.leases);
              leases.delete(lease);
              const closeStarted = lifetime.retired && leases.size === 0 && !lifetime.closeStarted;
              current.entries.set(entry, {
                ...lifetime,
                leases,
                closeStarted: lifetime.closeStarted || closeStarted,
              });
              return [closeStarted ? [entry] : [], current];
            },
          );
          yield* closeEntries(closing);
        }),
      );
    });

    const retireEntry: ResourceRegistry["retire"] = Effect.fn("ResourceRegistry.retire")(function* (
      key: string,
      entry: RegistryEntry,
    ) {
      yield* Effect.uninterruptible(
        Effect.gen(function* () {
          const closing = yield* Ref.modify(
            state,
            (current): readonly [ReadonlyArray<RegistryEntry>, RegistryState] => {
              if (current.cache.get(key)?.entry === entry) current.cache.delete(key);
              return [retireEntryInState(current, entry, false) ? [entry] : [], current];
            },
          );
          yield* closeEntries(closing);
        }),
      );
    });

    const deleteEntry: ResourceRegistry["delete"] = Effect.fn("ResourceRegistry.delete")(function* (
      key: string,
    ) {
      yield* Effect.uninterruptible(
        Effect.gen(function* () {
          const closing = yield* Ref.modify(
            state,
            (current): readonly [ReadonlyArray<RegistryEntry>, RegistryState] => {
              current.cache.delete(key);
              const closing: Array<RegistryEntry> = [];
              for (const entry of current.entries.keys()) {
                if (entry.key === key && retireEntryInState(current, entry, true)) {
                  closing.push(entry);
                }
              }
              return [closing, current];
            },
          );
          yield* closeEntries(closing);
        }),
      );
    });

    return {
      _tag: resourceRegistryServiceTag,
      get,
      getOrCreate,
      acquire,
      release,
      retire: retireEntry,
      delete: deleteEntry,
    };
  }).pipe(Effect.annotateLogs({ service: "ResourceRegistry" }));

const makeRegistryLayer = (
  capacity: number,
  timeToLiveMillis: number,
): Layer.Layer<ResourceRegistryTag> =>
  Layer.effect(ResourceRegistryTag, makeRegistryService(capacity, timeToLiveMillis));

/**
 * Construct an in-memory Resource registry Layer.
 *
 * @remarks
 * The resulting Layer validates its policy during acquisition. It retains entries
 * by least-recently-used order and expires them after the configured idle TTL.
 * Capacity eviction closes the least-recently-used unleased entry before allocating
 * its replacement. If no slot is free or safely evictable, admission fails
 * immediately.
 *
 * @example
 * ```ts
 * const registry = Resource.ResourceRegistry.layer({
 *   capacity: 128,
 *   timeToLive: "10 minutes",
 * })
 *
 * const program = Resource.fetch(users).pipe(Effect.provide(registry))
 * ```
 *
 * @param options - Maximum entry count and idle expiration duration.
 * @returns A Resource registry Layer whose error channel reports invalid policy.
 * @category Async State
 * @public
 * @since 1.0.0
 */
function resourceRegistryLayer(): Layer.Layer<ResourceRegistryTag>;
function resourceRegistryLayer(
  options: ResourceRegistryOptions,
): Layer.Layer<ResourceRegistryTag, ResourceRegistryOptionsError>;
function resourceRegistryLayer(
  options?: ResourceRegistryOptions,
): Layer.Layer<ResourceRegistryTag, ResourceRegistryOptionsError> {
  if (options === undefined) {
    return makeRegistryLayer(256, Duration.toMillis("30 minutes"));
  }

  return Layer.unwrap(
    Effect.gen(function* () {
      if (!Number.isSafeInteger(options.capacity) || options.capacity <= 0) {
        return yield* new ResourceRegistryOptionsError({
          message: "Resource registry capacity must be a positive safe integer",
        });
      }

      const duration = Duration.fromInput(options.timeToLive);
      if (Option.isNone(duration)) {
        return yield* new ResourceRegistryOptionsError({
          message: "Resource registry timeToLive must be a valid Duration input",
        });
      }
      const timeToLiveMillis = Duration.toMillis(duration.value);
      if (Number.isNaN(timeToLiveMillis) || timeToLiveMillis < 0) {
        return yield* new ResourceRegistryOptionsError({
          message: "Resource registry timeToLive must not be negative",
        });
      }

      return makeRegistryLayer(options.capacity, timeToLiveMillis);
    }),
  );
}

/**
 * In-memory Resource registry adapter.
 *
 * @remarks
 * `layer()` uses the default policy of 256 live slots and a lazy 30-minute idle
 * TTL. Pass an explicit policy to validate custom capacity and expiration at
 * Layer acquisition.
 *
 * @example
 * ```ts
 * const program = Resource.fetch(users).pipe(
 *   Effect.provide(Resource.ResourceRegistry.layer()),
 * )
 * ```
 *
 * @category Async State
 * @public
 * @since 1.0.0
 */
export const ResourceRegistry = { layer: resourceRegistryLayer };

// =============================================================================
// Internal helpers
// =============================================================================

/**
 * Atomic ownership decision for one shared fetch.
 * @internal
 */
type FetchMode = "pending" | "invalidate" | "refresh";

type FlightClaim = Data.TaggedEnum<{
  readonly Start: { readonly flight: InFlight };
  readonly Join: { readonly flight: InFlight };
  readonly Unavailable: {};
}>;

const FlightClaim = Data.taggedEnum<FlightClaim>();

const currentResourceConsumerScope: Effect.Effect<Scope.Scope, Signal.SignalScopeError> =
  Effect.gen(function* () {
    const renderScope = yield* Signal.CurrentRenderScope;
    if (renderScope !== null) return renderScope;

    const componentScope = yield* Signal.CurrentComponentScope;
    if (componentScope !== null) return componentScope;

    const scope = Context.getOption(yield* Effect.context<never>(), Scope.Scope);
    if (Option.isSome(scope)) return scope.value;

    return yield* new Signal.SignalScopeError({
      operation: "make",
      message:
        "Resource.fetch requires an owner scope. Fetch inside Component.gen or an explicitly scoped Effect.",
    });
  });

interface RegistryLease {
  readonly entry: RegistryEntry;
  readonly release: Effect.Effect<void>;
}

const getOrCreateLeasedEntryInScope = (
  registry: ResourceRegistry,
  key: string,
  scope: Scope.Scope,
): Effect.Effect<RegistryLease, ResourceRegistrySaturatedError> => {
  const acquire = Effect.uninterruptibleMask((restore) =>
    Effect.gen(function* () {
      while (true) {
        const entry = yield* restore(registry.getOrCreate(key));
        const lease = {};
        if (!(yield* registry.acquire(key, entry, lease))) continue;

        return {
          entry,
          release: registry.release(entry, lease),
        } satisfies RegistryLease;
      }
    }),
  );

  return Effect.acquireRelease(acquire, ({ release }) => release, {
    interruptible: true,
  }).pipe(Scope.provide(scope));
};

const completeFlight: (
  entry: RegistryEntry,
  flight: InFlight,
  exit: Exit.Exit<void, never>,
) => Effect.Effect<void> = Effect.fn("Resource.completeFlight")(function* (
  entry: RegistryEntry,
  flight: InFlight,
  exit: Exit.Exit<void, never>,
) {
  yield* Ref.modify(entry.inFlight, (current): readonly [void, Option.Option<InFlight>] => [
    undefined,
    Option.isSome(current) && current.value === flight ? Option.none() : current,
  ]);
  yield* Deferred.done(flight.deferred, exit);
  yield* Trace.emit("resource.fetch.complete", () => ({ key: flight.key }));
});

const runFetch: <A, E, R>(
  resource: Resource<A, E, R>,
  entry: RegistryEntry,
  ctx: Context.Context<R>,
  mode: FetchMode,
) => Effect.Effect<void> = Effect.fn("Resource.runFetch")(function* <A, E, R>(
  resource: Resource<A, E, R>,
  entry: RegistryEntry,
  ctx: Context.Context<R>,
  mode: FetchMode,
) {
  const state = unsafeEntrySignal<A, E>(entry.state);

  if (mode === "pending") {
    const current = yield* Signal.peek(state);
    if (!ResourceState.$is("Pending")(current)) return;
  } else if (mode === "refresh") {
    yield* Signal.set(state, Pending<A, E>());
  } else {
    const current = yield* Signal.peek(state);
    if (ResourceState.$is("Success")(current)) {
      yield* Signal.set(state, Success<A, E>(current.value, true));
    }
  }

  yield* Trace.emit("resource.fetch.start", () => ({
    key: resource.key,
  }));

  return yield* Trace.emit("resource.fetch.fork_running", () => ({
    key: resource.key,
  })).pipe(
    Effect.flatMap(() => Effect.provide(resource.fetch, ctx)),
    Effect.tap((value) =>
      Trace.emit("resource.fetch.success", () => ({
        key: resource.key,
        value_type: Trace.valueType(value),
      })),
    ),
    Effect.matchCauseEffect({
      onSuccess: (value) =>
        Effect.gen(function* () {
          yield* Trace.emit("resource.fetch.set_success", () => ({
            key: resource.key,
          }));
          yield* Signal.set(state, Success<A, E>(value, false));
        }),
      onFailure: (cause) =>
        Effect.gen(function* () {
          const firstReason = cause.reasons[0];
          const typedFailureOnly =
            firstReason !== undefined && cause.reasons.every(Cause.isFailReason);

          if (typedFailureOnly && Cause.isFailReason(firstReason)) {
            // ResourceState has one error slot; for an all-Fail Cause, preserve Cause order.
            const error = firstReason.error;
            yield* Trace.emit("resource.fetch.set_failure", () => ({
              key: resource.key,
              error_type: Trace.valueType(error),
            }));
            const previous = yield* Signal.peek(state);
            const staleValue = ResourceState.$is("Success")(previous)
              ? Option.some(previous.value)
              : Option.none();
            yield* Signal.set(state, Failure<A, E>(error, staleValue));
            return;
          }

          if (Cause.hasInterruptsOnly(cause)) {
            yield* Trace.emit("resource.fetch.interrupted", () => ({
              key: resource.key,
            }));
          } else {
            yield* Trace.emit("resource.fetch.unhandled", () => ({
              key: resource.key,
              error_type: Trace.causeValueType(cause),
            }));
          }

          return yield* Effect.failCause(unsafeAsUnrecoverableCause(cause));
        }),
    }),
  );
});

/**
 * Atomically join an existing flight or install and fork exactly one owner.
 * @internal
 */
const claimFlight: <A, E, R>(
  resource: Resource<A, E, R>,
  entry: RegistryEntry,
  registry: ResourceRegistry,
  ctx: Context.Context<R>,
  mode: FetchMode,
  startBeforeReturn?: boolean,
) => Effect.Effect<FlightClaim> = Effect.fn("Resource.claimFlight")(function* <A, E, R>(
  resource: Resource<A, E, R>,
  entry: RegistryEntry,
  registry: ResourceRegistry,
  ctx: Context.Context<R>,
  mode: FetchMode,
  startBeforeReturn: boolean = false,
) {
  const reportFetchExit = yield* CurrentResourceFetchExitReporter;
  return yield* Effect.uninterruptible(
    Effect.gen(function* () {
      const flightLease = {};
      if (!(yield* registry.acquire(resource.key, entry, flightLease))) {
        return FlightClaim.Unavailable();
      }

      const candidate: InFlight = {
        deferred: yield* Deferred.make<void, never>(),
        key: resource.key,
      };
      const claim = yield* Ref.modify(
        entry.inFlight,
        (current): readonly [FlightClaim, Option.Option<InFlight>] =>
          Option.isSome(current)
            ? [FlightClaim.Join({ flight: current.value }), current]
            : [FlightClaim.Start({ flight: candidate }), Option.some(candidate)],
      );

      if (FlightClaim.$is("Join")(claim)) {
        yield* registry.release(entry, flightLease);
        return claim;
      }
      if (FlightClaim.$is("Unavailable")(claim)) {
        yield* registry.release(entry, flightLease);
        return claim;
      }

      yield* Trace.emit("resource.fetch.starting", () => ({
        key: resource.key,
      }));
      const worker = yield* runFetch(resource, entry, ctx, mode).pipe(
        Effect.onExit((exit) =>
          Effect.gen(function* () {
            if (Exit.isFailure(exit)) {
              yield* registry.retire(resource.key, entry);
            }
            // Fatal identities are no longer admissible before a waiter can retry.
            yield* completeFlight(entry, claim.flight, exit);
          }),
        ),
        Effect.ensuring(registry.release(entry, flightLease)),
        // Attach before user fetch code can reenter clear/shutdown. Immediate
        // fork execution in rc.112 runs before the Scope finalizer is installed.
        Effect.forkIn(entry.scope, {
          uninterruptible: false,
        }),
      );
      yield* Effect.withFiber((caller) =>
        Effect.sync(() => {
          worker.addObserver((exit) => {
            if (Exit.isFailure(exit)) reportFetchExit(exit);
          });
          // Reactive fetch starts before installing parameter listeners. Flush
          // the parent's launch queue only after ownership and observation exist.
          if (startBeforeReturn) caller.currentDispatcher.flush();
        }),
      );
      return claim;
    }),
  );
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
 *    The output stops following the previous key while its shared fetch continues.
 *
 * @remarks
 * Static fetches reuse cached entries by key. Reactive fetches keep the output
 * signal stable while switching the backing cache entry as params change. Static
 * consumers lease an entry to their render, component, or Effect Scope; reactive
 * machinery leases only the entry followed by its current daemon. Fatal flights
 * report once and retire their cache identity so a later fetch starts fresh. A
 * full registry fails immediately with {@link ResourceRegistrySaturatedError}.
 * Reactive key changes publish that error as `Failure` state.
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
    Signal.SignalScopeError | ResourceRegistrySaturatedError,
    ResourceRegistryTag | R
  >;
  <P extends object, A, E, R>(
    factory: (params: P) => Resource<A, E, R>,
    params: ReactiveParams<P>,
  ): Effect.Effect<
    Signal.Signal<ResourceState<A, E | ResourceRegistrySaturatedError>>,
    Signal.SignalScopeError | ResourceRegistrySaturatedError,
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
        return Effect.fail(new ResourceFactoryParamsRequiredError());
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
  Signal.SignalScopeError | ResourceRegistrySaturatedError,
  ResourceRegistryTag | R
> =>
  Effect.gen(function* () {
    yield* Trace.emit("resource.fetch.called", () => ({
      key: resource.key,
    }));

    const ctx = yield* Effect.context<R>();
    const registry = yield* ResourceRegistryTag;
    const consumerScope = yield* currentResourceConsumerScope;
    while (true) {
      const leased = yield* getOrCreateLeasedEntryInScope(registry, resource.key, consumerScope);
      const state = unsafeEntrySignal<A, E>(leased.entry.state);

      // Check if we have cached data.
      // CRITICAL: Read untracked to prevent component re-render on Pending→Success.
      // If we tracked this read, the component would re-render when state changes,
      // causing keyed-list teardown/remount race that blanks rendered items.
      const currentState = yield* Signal.peek(state);
      if (!ResourceState.$is("Pending")(currentState)) {
        yield* Trace.emit("resource.fetch.cached", () => ({
          key: resource.key,
          state: currentState._tag,
        }));
        return state;
      }

      const claim = yield* claimFlight(resource, leased.entry, registry, ctx, "pending");
      if (FlightClaim.$is("Unavailable")(claim)) {
        yield* leased.release;
        continue;
      }
      if (FlightClaim.$is("Join")(claim)) {
        yield* Trace.emit("resource.fetch.dedupe_wait", () => ({
          key: resource.key,
        }));
        yield* Deferred.await(claim.flight.deferred);
      }

      return state;
    }
  }).pipe(Effect.withSpan("Resource.fetch", { attributes: { key: resource.key } }));

/**
 * Reactive fetch implementation.
 * Subscribes to Signal params and follows the cache entry for each current key.
 * @internal
 */
const fetchReactive = <P extends object, A, E, R>(
  factory: (params: P) => Resource<A, E, R>,
  reactiveParams: ReactiveParams<P>,
): Effect.Effect<
  Signal.Signal<ResourceState<A, E | ResourceRegistrySaturatedError>>,
  Signal.SignalScopeError | ResourceRegistrySaturatedError,
  ResourceRegistryTag | R | Scope.Scope
> =>
  Effect.gen(function* () {
    const ctx = yield* Effect.context<ResourceRegistryTag | R>();
    const registry = yield* ResourceRegistryTag;
    const ambientScope = yield* Effect.scope;
    const renderScope = yield* Signal.CurrentRenderScope;
    const scope = renderScope ?? ambientScope;

    // Unwrap current values from reactive params without registering component
    // dependencies — reactivity is handled by explicit subscriptions below.
    const unwrapParams: Effect.Effect<P> = Effect.gen(function* () {
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
    const initialParams = yield* unwrapParams;
    const initialResource = factory(initialParams);

    // Create the output signal that will be updated on param changes
    const outputState = yield* Signal.make<ResourceState<A, E | ResourceRegistrySaturatedError>>(
      Pending(),
    );

    // Each daemon has an independent Scope so a key switch atomically releases its lease.
    const activeDaemon = yield* SynchronizedRef.make<Option.Option<Scope.Closeable>>(Option.none());

    // Track current resource key for change detection
    const activeKey = yield* Ref.make(initialResource.key);

    // Helper: cancel previous daemon, fork new fetch, sync result to output.
    // The daemon stays alive after the initial fetch, mirroring entry.state → outputState
    // so that invalidate/refresh changes propagate to the component.
    // Uses SynchronizedRef.modifyEffect to atomically close+fork+store, preventing
    // race conditions where concurrent doFetch calls could leak daemons.
    const doFetch: (
      resource: Resource<A, E, R>,
    ) => Effect.Effect<void, ResourceRegistrySaturatedError> = Effect.fn(
      "Resource.fetch.reactive.doFetch",
    )(function* (resource: Resource<A, E, R>) {
      yield* Ref.set(activeKey, resource.key);
      yield* Signal.set(outputState, Pending<A, E | ResourceRegistrySaturatedError>());

      const setOutputIfActive: (
        next: ResourceState<A, E | ResourceRegistrySaturatedError>,
      ) => Effect.Effect<void> = Effect.fn("Resource.fetch.reactive.setOutputIfActive")(function* (
        next: ResourceState<A, E | ResourceRegistrySaturatedError>,
      ) {
        const currentKey = yield* Ref.get(activeKey);
        if (currentKey === resource.key) {
          yield* Signal.set(outputState, next);
        }
      });

      const installed = yield* SynchronizedRef.modifyEffect(activeDaemon, (previousScope) =>
        Effect.uninterruptibleMask((restore) =>
          Effect.gen(function* () {
            if (Option.isSome(previousScope)) {
              yield* Scope.close(previousScope.value, Exit.void);
            }

            const daemonScope = yield* Scope.fork(scope);
            const selectionExit = yield* restore(
              Effect.gen(function* () {
                while (true) {
                  const leased = yield* getOrCreateLeasedEntryInScope(
                    registry,
                    resource.key,
                    daemonScope,
                  );
                  const entryState = unsafeEntrySignal<A, E>(leased.entry.state);
                  const cached = yield* Signal.peek(entryState);
                  if (!ResourceState.$is("Pending")(cached)) {
                    return {
                      entryState,
                      cached,
                      flight: Option.none<InFlight>(),
                    };
                  }

                  const claim = yield* claimFlight(
                    resource,
                    leased.entry,
                    registry,
                    unsafeNarrowContext<R, ResourceRegistryTag | R>(ctx),
                    "pending",
                    true,
                  );
                  if (FlightClaim.$is("Unavailable")(claim)) {
                    yield* leased.release;
                    continue;
                  }

                  return {
                    entryState,
                    cached,
                    flight: Option.some(claim.flight),
                  };
                }
              }),
            ).pipe(Effect.exit);
            if (Exit.isFailure(selectionExit)) {
              yield* Scope.close(daemonScope, selectionExit);
              const result: readonly [
                Exit.Exit<unknown, ResourceRegistrySaturatedError>,
                Option.Option<Scope.Closeable>,
              ] = [selectionExit, Option.none()];
              return result;
            }
            const selection = selectionExit.value;

            yield* Effect.gen(function* () {
              if (Option.isNone(selection.flight)) {
                yield* setOutputIfActive(selection.cached);
              } else {
                const settlement = yield* Effect.exit(
                  Deferred.await(selection.flight.value.deferred),
                );
                if (Exit.isFailure(settlement)) return;

                // Sync resolved state to output
                const finalState = yield* Signal.peek(selection.entryState);
                yield* setOutputIfActive(finalState);
              }

              // Subscribe to entry state so invalidate/refresh propagates to outputState.
              // The daemon stays alive until interrupted by the next doFetch call.
              return yield* Effect.acquireUseRelease(
                Signal.subscribe(selection.entryState, () =>
                  Signal.peek(selection.entryState).pipe(
                    Effect.flatMap((next) => setOutputIfActive(next)),
                  ),
                ),
                () => Effect.never,
                (unsubscribe) => unsubscribe,
              );
            }).pipe(
              Effect.provide(ctx),
              Effect.tapCause((cause) =>
                Cause.hasInterruptsOnly(cause)
                  ? Effect.void
                  : Trace.emit("resource.fetch.unhandled", () => ({
                      key: resource.key,
                      error_type: Trace.causeValueType(cause),
                    })),
              ),
              Effect.forkIn(daemonScope, { uninterruptible: false }),
            );
            // Publish cached state before returning, with subscription work
            // already owned if its callbacks reenter render shutdown.
            yield* Effect.withFiber((caller) =>
              Effect.sync(() => caller.currentDispatcher.flush()),
            );

            const result: readonly [
              Exit.Exit<unknown, ResourceRegistrySaturatedError>,
              Option.Option<Scope.Closeable>,
            ] = [Exit.void, Option.some(daemonScope)];
            return result;
          }),
        ),
      );
      if (Exit.isFailure(installed)) return yield* Effect.failCause(installed.cause);
    });

    // Initial fetch
    yield* doFetch(initialResource).pipe(Effect.provide(ctx));

    // If there are reactive signals, subscribe to changes
    if (signalFields.length > 0) {
      const onParamChange: Effect.Effect<void> = Effect.gen(function* () {
        const newParams = yield* unwrapParams;
        const newResource = factory(newParams);
        const currentKey = yield* Ref.get(activeKey);

        // Only re-fetch if key actually changed
        if (newResource.key !== currentKey) {
          const previous = yield* Signal.peek(outputState);
          const staleValue = ResourceState.$is("Success")(previous)
            ? Option.some(previous.value)
            : ResourceState.$is("Failure")(previous)
              ? previous.staleValue
              : Option.none();
          yield* doFetch(newResource).pipe(
            Effect.provide(ctx),
            Effect.catchTag("ResourceRegistrySaturatedError", (error) =>
              Signal.set(
                outputState,
                Failure<A, E | ResourceRegistrySaturatedError>(error, staleValue),
              ),
            ),
          );
        }
      });

      for (const signal of signalFields) {
        yield* Effect.acquireRelease(
          Signal.subscribe(signal, () => onParamChange),
          (unsubscribe) => unsubscribe,
        ).pipe(Scope.provide(scope), Effect.asVoid);
      }
    }

    // Cleanup: closing the active daemon Scope interrupts work and releases its lease.
    yield* Scope.addFinalizer(
      scope,
      Effect.gen(function* () {
        const daemonScope = yield* SynchronizedRef.get(activeDaemon);
        if (Option.isSome(daemonScope)) {
          yield* Scope.close(daemonScope.value, Exit.void);
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

type PendingComponentHandler<A, R> = Component.Type<PendingPayload<A>, unknown, R>;
type SuccessComponentHandler<A, R> = Component.Type<SuccessPayload<A>, unknown, R>;
type FailureComponentHandler<A, E, R> = Component.Type<FailurePayload<A, E>, unknown, R>;

type PendingFunctionHandler<A> = (payload: PendingPayload<A>) => ElementType;
type SuccessFunctionHandler<A> = (payload: SuccessPayload<A>) => ElementType;
type FailureFunctionHandler<A, E> = (payload: FailurePayload<A, E>) => ElementType;

type PendingHandler<A, R> = PendingComponentHandler<A, R> | PendingFunctionHandler<A> | ElementType;
type SuccessHandler<A, R> = SuccessComponentHandler<A, R> | SuccessFunctionHandler<A>;
type FailureHandler<A, E, R> = FailureComponentHandler<A, E, R> | FailureFunctionHandler<A, E>;
type ResourceHandler = unknown;

const isEffectComponentLike = <Props, R>(
  value: unknown,
): value is Component.Type<Props, unknown, R> => isEffectComponent(value);

const isPendingComponent = <A, R>(
  handler: PendingHandler<A, R>,
): handler is PendingComponentHandler<A, R> => isEffectComponentLike<PendingPayload<A>, R>(handler);

const isSuccessComponent = <A, R>(
  handler: SuccessHandler<A, R>,
): handler is SuccessComponentHandler<A, R> => isEffectComponentLike<SuccessPayload<A>, R>(handler);

const isFailureComponent = <A, E, R>(
  handler: FailureHandler<A, E, R>,
): handler is FailureComponentHandler<A, E, R> =>
  isEffectComponentLike<FailurePayload<A, E>, R>(handler);

const isPendingStateHandler = (
  state: MatchState,
  _handler: unknown,
): _handler is PendingHandler<unknown, unknown> => state === "Pending";

const isSuccessStateHandler = (
  state: MatchState,
  _handler: unknown,
): _handler is SuccessHandler<unknown, unknown> => state === "Success";

const isFailureStateHandler = (
  state: MatchState,
  _handler: unknown,
): _handler is FailureHandler<unknown, unknown, unknown> => state === "Failure";

const renderPending = <A>(
  handler: PendingHandler<A, unknown>,
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
  handler: SuccessHandler<A, unknown>,
  payload: SuccessPayload<A>,
): ElementType => {
  if (isSuccessComponent(handler)) {
    return handler(payload);
  }
  return handler(payload);
};

const renderFailure = <A, E>(
  handler: FailureHandler<A, E, unknown>,
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
  readonly pending?: PendingHandler<A, R>;
  readonly success?: SuccessHandler<A, R>;
  readonly failure?: FailureHandler<A, E, R>;
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
  pending?: PendingHandler<A, R>,
  success?: SuccessHandler<A, R>,
  failure?: FailureHandler<A, E, R>,
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
export function on<AHandler, RHandler>(
  state: "Pending",
  handler: PendingComponentHandler<AHandler, RHandler>,
): <A, E, R, HasPending extends boolean, HasSuccess extends boolean, HasFailure extends boolean>(
  self: ResourceMatcher<A, E, R, HasPending, HasSuccess, HasFailure>,
) => ResourceMatcher<A, E, R | RHandler, true, HasSuccess, HasFailure>;

export function on<AHandler>(
  state: "Pending",
  handler: PendingFunctionHandler<AHandler> | ElementType,
): <A, E, R, HasPending extends boolean, HasSuccess extends boolean, HasFailure extends boolean>(
  self: ResourceMatcher<A, E, R, HasPending, HasSuccess, HasFailure>,
) => ResourceMatcher<A, E, R, true, HasSuccess, HasFailure>;

export function on<AHandler, RHandler>(
  state: "Success",
  handler: SuccessComponentHandler<AHandler, RHandler>,
): <A, E, R, HasPending extends boolean, HasSuccess extends boolean, HasFailure extends boolean>(
  self: ResourceMatcher<A, E, R, HasPending, HasSuccess, HasFailure>,
) => ResourceMatcher<A, E, R | RHandler, HasPending, true, HasFailure>;

export function on<AHandler>(
  state: "Success",
  handler: SuccessFunctionHandler<AHandler>,
): <A, E, R, HasPending extends boolean, HasSuccess extends boolean, HasFailure extends boolean>(
  self: ResourceMatcher<A, E, R, HasPending, HasSuccess, HasFailure>,
) => ResourceMatcher<A, E, R, HasPending, true, HasFailure>;

export function on<AHandler, EHandler, RHandler>(
  state: "Failure",
  handler: FailureComponentHandler<AHandler, EHandler, RHandler>,
): <A, E, R, HasPending extends boolean, HasSuccess extends boolean, HasFailure extends boolean>(
  self: ResourceMatcher<A, E, R, HasPending, HasSuccess, HasFailure>,
) => ResourceMatcher<A, E, R | RHandler, HasPending, HasSuccess, true>;

export function on<AHandler, EHandler>(
  state: "Failure",
  handler: FailureFunctionHandler<AHandler, EHandler>,
): <A, E, R, HasPending extends boolean, HasSuccess extends boolean, HasFailure extends boolean>(
  self: ResourceMatcher<A, E, R, HasPending, HasSuccess, HasFailure>,
) => ResourceMatcher<A, E, R, HasPending, HasSuccess, true>;

export function on(state: MatchState, handler: unknown) {
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
    yield* claimFlight(resource, entry, registry, ctx, "invalidate");
  }).pipe(Effect.withSpan("Resource.invalidate", { attributes: { key: resource.key } }));

/**
 * Force immediate refetch, transitioning to Pending first.
 *
 * Does not preserve stale value.
 * Dedupes: waits for in-progress fetch if any.
 *
 * @remarks
 * Use this when a hard reload is better than showing stale data. Creating a
 * previously unseen key can fail with {@link ResourceRegistrySaturatedError}.
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
): Effect.Effect<void, ResourceRegistrySaturatedError, ResourceRegistryTag | R> =>
  Effect.gen(function* () {
    const ctx = yield* Effect.context<R>();
    const registry = yield* ResourceRegistryTag;
    while (true) {
      const entry = yield* registry.getOrCreate(resource.key);
      const claim = yield* claimFlight(resource, entry, registry, ctx, "refresh");
      if (FlightClaim.$is("Unavailable")(claim)) continue;
      if (FlightClaim.$is("Join")(claim)) {
        yield* Deferred.await(claim.flight.deferred);
      }
      return;
    }
  }).pipe(Effect.withSpan("Resource.refresh", { attributes: { key: resource.key } }));

/**
 * Delete a resource from the cache.
 *
 * Use this to force a fresh fetch on the next `Resource.fetch` call.
 *
 * @remarks
 * Clearing removes every live generation for the key instead of marking one stale.
 * Unlike policy eviction, explicit clear also force-closes TTL-retired generations
 * while old consumers still retain their Signals.
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
