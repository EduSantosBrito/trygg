/**
 * @internal
 * Quarantine for type-level coercions that TypeScript cannot verify
 * but are sound by construction.
 *
 * Rules:
 * - Every function MUST have a SAFETY comment explaining the invariant
 * - Runtime-effectful operations use Debug.log for observability
 * - This is the ONLY file where `as` casts are permitted
 */
import { Effect, Layer, Context } from "effect";
import * as Debug from "../debug/debug.js";
import type { Component } from "../primitives/component.js";
import type { Element } from "../primitives/element.js";
import type { Signal } from "../primitives/signal.js";
import type { ResourceState } from "../primitives/resource.js";

// =============================================================================
// Layer Merging
// =============================================================================

/**
 * Merge heterogeneous layers stored as Layer.Any[].
 *
 * SAFETY: Layer.mergeAll at runtime merges Context maps regardless of types.
 * Type-level tracking was erased when layers entered Array<Layer.Any>.
 * Callers guarantee correctness via Component.provide() type signatures
 * which validate each layer individually before accumulation.
 */
export const unsafeMergeLayers = (
  layers: ReadonlyArray<Layer.Any>,
): Effect.Effect<Layer.Any, never, never> =>
  Effect.gen(function* () {
    yield* Debug.log({
      event: "unsafe.mergeLayers",
      layer_count: layers.length,
    });
    if (layers.length === 0) return Layer.empty;
    const [first, second, ...rest] = layers;
    if (first === undefined) return Layer.empty;
    if (second === undefined) return first;
    const mergeAll = Layer.mergeAll as (...ls: ReadonlyArray<Layer.Any>) => Layer.Any;
    return mergeAll(first, second, ...rest);
  });

// =============================================================================
// Context Extraction
// =============================================================================

/**
 * Build a context from heterogeneous layers.
 *
 * SAFETY: Layers were validated at .provide() call sites.
 * This function is the runtime resolution of those typed promises.
 * The generic A is a phantom representing the accumulated service types.
 */
export const unsafeBuildContext = <A>(
  layers: ReadonlyArray<Layer.Any>,
): Effect.Effect<Context.Context<A>, never, never> =>
  Effect.gen(function* () {
    yield* Debug.log({
      event: "unsafe.buildContext",
      layer_count: layers.length,
    });
    if (layers.length === 0) {
      return Context.empty() as Context.Context<A>;
    }
    const merged = yield* unsafeMergeLayers(layers);
    return yield* Effect.scoped(Layer.build(merged as Parameters<typeof Layer.build>[0]));
  }) as Effect.Effect<Context.Context<A>, never, never>;

// =============================================================================
// Component Tagging
// =============================================================================

/**
 * Tag a function with component metadata to produce Component.Type.
 *
 * SAFETY: Object.assign produces the correct structural shape at runtime.
 * TypeScript can't verify callable interfaces + Object.assign = interface match
 * because callable interfaces require the function signature to be part of the
 * object type, which Object.assign's return type doesn't encode.
 */
export const unsafeTagCallable = <T>(fn: Function, metadata: Record<string, unknown>): T =>
  Object.assign(fn, metadata) as T;

/**
 * Construct a KeyedList element across Signal invariance boundaries.
 *
 * SAFETY: KeyedList stores opaque callbacks plus the source signal for the
 * renderer. The renderer feeds values produced by `source` back into `renderFn`
 * and `keyFn`, so the item type remains correlated with `T` at runtime.
 */
export const unsafeMakeKeyedListElement = <T, E>(
  source: Signal<ReadonlyArray<T>>,
  renderFn: (item: T, index: number) => Effect.Effect<Element, E, unknown>,
  keyFn: (item: T, index: number) => string | number,
): Element =>
  ({
    _tag: "KeyedList",
    source,
    renderFn,
    keyFn,
  }) as Element;

/**
 * Narrow Record<string, unknown> to ElementProps.
 *
 * SAFETY: The record was built by iterating JSX props and filtering out
 * 'children' and 'key'. The remaining entries match ElementProps structurally,
 * but TS can't verify this because ElementProps uses template literal index
 * signatures (data-*, aria-*) rather than a general string index.
 */
export const unsafeAsElementProps = (
  record: Record<string, unknown>,
): import("../primitives/element.js").ElementProps =>
  record as import("../primitives/element.js").ElementProps;

// =============================================================================
// Resource Registry
// =============================================================================

/**
 * Extract typed signal from registry entry.
 *
 * SAFETY: The registry guarantees that a key created from Resource<A, E, R>
 * always maps to a Signal<ResourceState<A, E>>. The unknown→typed narrowing
 * is sound because the registry key is the type-level proof. Signal is
 * invariant (backed by SubscriptionRef), so this cast cannot be expressed
 * via variance alone.
 */
export const unsafeEntrySignal = <A, E>(
  state: Signal<ResourceState<unknown, unknown>>,
): Signal<ResourceState<A, E>> => state as Signal<ResourceState<A, E>>;

// =============================================================================
// Generic Narrowing
// =============================================================================

/**
 * Narrow Record<string, unknown> to a concrete params type P.
 *
 * SAFETY: The params object was constructed field-by-field from typed sources
 * (Signal.get or static values). The caller guarantees the shape matches P.
 * TypeScript can't verify this because the object was built dynamically.
 */
export const unsafeAsParams = <P>(record: Record<string, unknown>): P => record as unknown as P;

/**
 * Narrow a squashed error value from unknown to E.
 *
 * SAFETY: The error was extracted via Cause.squash from a Cause produced by
 * an Effect<A, E, R>. For typed failures (Fail variants), the squashed value
 * IS of type E. For defects/interruptions, Cause.squash may return a non-E
 * value — but the surrounding catchAllCause provides a safety net for
 * unrecoverable errors. The unknown originates from type erasure at the
 * RegistryEntry boundary, not from runtime uncertainty.
 */
export const unsafeAsError = <E>(error: unknown): E => error as E;

// =============================================================================
// Function Union Narrowing
// =============================================================================

/**
 * Call a function union as a no-arg function.
 *
 * SAFETY: Used in Resource.make overload implementation where the
 * key discriminant (string vs function) correlates with the factory
 * arity (no-args vs with-params). TypeScript can't narrow correlated
 * unions. At runtime, JS ignores extra arity.
 */
export const unsafeCallNoArgs = <R>(fn: Function): R => (fn as () => R)();

// =============================================================================
// Effect Context Erasure
// =============================================================================

/**
 * Narrow a service map to a subset of its services.
 *
 * SAFETY: Context<A | B> contains all services for both A and B.
 * Narrowing to Context<A> is sound because the services are still there.
 */
export const unsafeNarrowContext = <R, S>(ctx: Context.Context<S>): Context.Context<R> =>
  ctx as unknown as Context.Context<R>;

/**
 * Widen a specific service map to unknown for untyped boundaries.
 *
 * SAFETY: Context<R> contains runtime services regardless of R phantom.
 * Widening to unknown only erases compile-time detail.
 */
export const unsafeWidenContext = <R>(ctx: Context.Context<R>): Context.Context<unknown> =>
  ctx as unknown as Context.Context<unknown>;

// =============================================================================
// Overloaded Function Dispatch
// =============================================================================

/**
 * Cast a function implementation to a specific overloaded callable type.
 *
 * SAFETY: Used for overloaded function implementations where TypeScript
 * cannot verify that a single implementation matches multiple generic
 * overload signatures. The caller ensures runtime correctness through
 * discriminant checks (typeof, _tag, etc.) in the implementation body.
 * Only the overload signatures are visible to callers — the implementation
 * type is erased.
 */
export const unsafeAsOverload = <T>(fn: Function): T => fn as T;

// =============================================================================
// Effect Requirements Erasure
// =============================================================================

/**
 * Erase the R (requirements) type from an Effect.
 *
 * SAFETY: The caller guarantees all required services are available
 * in the current fiber context. Used at Element type boundaries where
 * Component.run() returns R = unknown (Element union type erasure)
 * but services were provided at mount/render time.
 */
export const unsafeEraseR = <A, E>(
  effect: Effect.Effect<A, E, unknown>,
): Effect.Effect<A, E, never> => effect as Effect.Effect<A, E, never>;

/**
 * Run a component while restoring its erased error type.
 *
 * SAFETY: Component.Type<Props, E, R> guarantees the callable and optional
 * _runFn represent the same component body and error channel E. The runtime
 * stores _runFn as unknown on the structural interface, so callers that still
 * know E can safely recover it here.
 */
export const unsafeRunComponent = <Props, E>(
  component: Component.Type<Props, E, unknown>,
  props: [Props] extends [never] ? {} : Props,
): Effect.Effect<Element, E, never> => {
  const runFn = component._runFn;
  if (runFn !== undefined) {
    return unsafeEraseR(runFn(props)) as Effect.Effect<Element, E, never>;
  }
  const element = component(props);
  if (element._tag === "Component") {
    return unsafeEraseR(element.run()) as Effect.Effect<Element, E, never>;
  }
  return Effect.succeed(element);
};

// =============================================================================
// Route Params Narrowing
// =============================================================================

/**
 * Narrow a generic `RouteParams` Effect to a route-specific params type.
 *
 * SAFETY: The Outlet sets `CurrentRouteParams` FiberRef to the matched route's
 * params before running the route component. The generic `Record<string, string>`
 * return type of `FiberRef.get` is narrowed to the route-specific params type
 * derived from the path pattern (e.g. `{ id: string }` for `/users/:id`).
 * The caller guarantees the path parameter matches the current route.
 */
export const unsafeNarrowParams = <P>(
  effect: Effect.Effect<Record<string, string>>,
): Effect.Effect<P> => effect as unknown as Effect.Effect<P>;

// =============================================================================
// Middleware Requirements Erasure
// =============================================================================

/**
 * Erase requirements from middleware effects for sequential execution.
 *
 * SAFETY: Middleware effects have their requirements provided at the route
 * level via `Route.provide()`. By the time `runMiddlewareChain` executes,
 * all services are available in the fiber context. The `R` type parameter
 * is erased so the chain can be iterated uniformly.
 */
export const unsafeEraseMiddlewareR = (
  effect: Effect.Effect<void, unknown, unknown>,
): Effect.Effect<void, unknown, never> => effect as Effect.Effect<void, unknown, never>;

// =============================================================================
// Tagged Error Field Extraction
// =============================================================================

/**
 * Extract known fields from a tagged error after `_tag` discrimination.
 *
 * SAFETY: The caller has already checked `error._tag` matches the expected
 * tag (e.g. `"RouterRedirect"`). The error object is structurally guaranteed
 * to have the extracted fields by the `Data.TaggedError` / `Schema.TaggedError`
 * constructor. TypeScript cannot prove this after `Cause.squash` since the
 * error type is widened to `unknown`.
 */
export const unsafeExtractFields = <T>(error: object): T => error as unknown as T;
