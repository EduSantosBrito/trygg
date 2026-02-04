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
import { Context, Effect, Layer } from "effect";
import * as Debug from "../debug/debug.js";
import type { Element, ComponentElementWithRequirements } from "../primitives/element.js";
import type { Component } from "../primitives/component.js";
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
  layers: ReadonlyArray<Layer.Layer.Any>,
): Effect.Effect<Layer.Layer<unknown, never, never>> =>
  Effect.gen(function* () {
    yield* Debug.log({
      event: "unsafe.mergeLayers",
      layer_count: layers.length,
    });
    if (layers.length === 0) return Layer.empty;
    const first = layers[0];
    if (first === undefined) return Layer.empty;
    if (layers.length === 1) return first;
    const mergeAll = Layer.mergeAll as (...ls: ReadonlyArray<Layer.Layer.Any>) => Layer.Layer.Any;
    return mergeAll(first, ...layers.slice(1));
  }) as Effect.Effect<Layer.Layer<unknown, never, never>>;

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
  layers: ReadonlyArray<Layer.Layer.Any>,
): Effect.Effect<Context.Context<A>, never, never> =>
  Effect.gen(function* () {
    yield* Debug.log({
      event: "unsafe.buildContext",
      layer_count: layers.length,
    });
    if (layers.length === 0) {
      return Context.unsafeMake(new Map());
    }
    const merged = yield* unsafeMergeLayers(layers);
    return yield* Effect.provide(Effect.context<A>(), merged as Layer.Layer<A, never, never>);
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

// =============================================================================
// JSX Element Type Narrowing
// =============================================================================

/**
 * Narrow an Element to ElementFor<Type> (conditional return type).
 *
 * SAFETY: ElementFor<Type> resolves to either Element or
 * ComponentElementWithRequirements<R>, which are structurally identical
 * (the requirements symbol is optional/phantom). This cast is always
 * a structural identity — no runtime behavior change.
 *
 * TypeScript cannot resolve conditional types in generic function bodies
 * (TS#33912). This is the standard workaround.
 */
type ElementFor<Type> =
  Type extends Component.Type<any, any, infer R> ? ComponentElementWithRequirements<R> : Element;

export const unsafeAsElementFor = <Type>(element: Element): ElementFor<Type> =>
  element as ElementFor<Type>;

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
 * Narrow a Context to a subset of its services.
 *
 * SAFETY: Context<A | B> contains all services for both A and B.
 * Narrowing to Context<A> is sound because the services are still there.
 */
export const unsafeNarrowContext = <R, S>(ctx: Context.Context<S>): Context.Context<R> =>
  ctx as unknown as Context.Context<R>;

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
