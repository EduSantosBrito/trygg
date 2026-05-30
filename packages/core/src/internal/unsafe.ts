/**
 * @internal
 * Quarantine for type-level coercions that TypeScript cannot verify
 * but are sound by construction.
 *
 * Rules:
 * - Every function MUST have a SAFETY comment explaining the invariant
 * - Runtime-effectful operations use Trace.emit for observability
 * - Callers enter through named helpers instead of inline assertions
 */
import { Context, Data, Effect, Layer, Predicate, Scope } from "effect";
import * as Match from "effect/Match";
import * as Trace from "../trace/index.js";
import type { Component } from "../primitives/component.js";
import type { Element, ElementWithRequirements } from "../primitives/element.js";
import type { ResourceState } from "../primitives/resource.js";
import type { Signal } from "../primitives/signal.js";

type KeyedListElement = Extract<Element, { readonly _tag: "KeyedList" }>;
type ComponentElement = Extract<Element, { readonly _tag: "Component" }>;
type ComponentCallProps<Props> = [Props] extends [never] ? {} : Props;

const KeyedListData = Data.TaggedClass("KeyedList")<{
  readonly source: unknown;
  readonly renderFn: unknown;
  readonly keyFn: unknown;
}>;

const isComponentElement = (element: Element): element is ComponentElement =>
  Predicate.isTagged(element, "Component");

// =============================================================================
// Layer Merging
// =============================================================================

/**
 * Merge heterogeneous layers stored in an array.
 *
 * SAFETY: Layer.merge at runtime merges Context maps regardless of output types.
 * Type-level tracking was erased when layers entered storage. Callers guarantee
 * correctness via Component.provide() type signatures which validate each layer
 * individually before accumulation.
 */
export const unsafeMergeLayers: (
  layers: ReadonlyArray<Layer.Layer<never, unknown, never>>,
) => Effect.Effect<Layer.Layer<never, unknown, never>, never, never> = Effect.fn(
  "unsafe.mergeLayers",
)(function* (layers: ReadonlyArray<Layer.Layer<never, unknown, never>>) {
  yield* Trace.emit("unsafe.mergeLayers", () => ({
    layer_count: layers.length,
  }));

  const [first, second, ...rest] = layers;
  if (first === undefined) return Layer.empty;
  if (second === undefined) return first;

  let merged = Layer.merge(first, second);
  for (const layer of rest) {
    merged = Layer.merge(merged, layer);
  }
  return merged;
});

// =============================================================================
// Context Extraction
// =============================================================================

const unsafeBuildContextImpl = Effect.fn("unsafe.buildContext")(function* (
  layers: ReadonlyArray<Layer.Layer<never, unknown, never>>,
) {
  yield* Trace.emit("unsafe.buildContext", () => ({
    layer_count: layers.length,
  }));

  if (layers.length === 0) {
    return Context.makeUnsafe<never>(new Map());
  }

  const merged = yield* unsafeMergeLayers(layers);
  return yield* Effect.scoped(
    Effect.gen(function* () {
      const scope = yield* Effect.scope;
      return yield* Layer.buildWithScope(merged, scope);
    }),
  );
});

/**
 * Build a context from heterogeneous layers.
 *
 * SAFETY: Layers were validated at .provide() call sites. This function is the
 * runtime resolution of those typed promises. The generic A is a phantom
 * representing the accumulated service types.
 */
export function unsafeBuildContext<A>(
  layers: ReadonlyArray<Layer.Layer<never, unknown, never>>,
): Effect.Effect<Context.Context<A>, never, never>;
export function unsafeBuildContext(
  layers: ReadonlyArray<Layer.Layer<never, unknown, never>>,
): Effect.Effect<Context.Context<never>, unknown, never> {
  return unsafeBuildContextImpl(layers);
}

const unsafeBuildProviderContextImpl = Effect.fn("unsafe.buildProviderContext")(function* <E, R>(
  layer: Layer.Layer<never, E, R>,
  scope: Scope.Scope,
  parentContext: Context.Context<R> | null,
) {
  const build = Effect.gen(function* () {
    const memoMap = yield* Layer.makeMemoMap;
    return yield* Layer.buildWithMemoMap(layer, memoMap, scope);
  });
  return yield* parentContext === null ? build : Effect.provide(build, parentContext);
});

/**
 * Build one provider layer into an explicit lifecycle scope.
 *
 * SAFETY: Provider layers are stored at the element boundary after public
 * Component.provide typing has validated the layer. The returned Context is
 * widened because renderer context propagation is intentionally untyped.
 */
export function unsafeBuildProviderContext<E, R>(
  layer: Layer.Layer<never, E, R>,
  scope: Scope.Scope,
  parentContext: Context.Context<R> | null,
): Effect.Effect<Context.Context<unknown>, E, R>;
export function unsafeBuildProviderContext<E, R>(
  layer: Layer.Layer<never, E, R>,
  scope: Scope.Scope,
  parentContext: Context.Context<R> | null,
): Effect.Effect<Context.Context<never>, E, R> {
  return unsafeBuildProviderContextImpl(layer, scope, parentContext);
}

// =============================================================================
// Component Tagging
// =============================================================================

/**
 * Tag a function with component metadata to produce Component.Type.
 *
 * SAFETY: Object.assign produces the correct structural shape at runtime.
 * TypeScript cannot verify callable interfaces + Object.assign because callable
 * interfaces require the function signature to be part of the object type.
 */
export function unsafeTagCallable<T>(fn: Function, metadata: object): T;
export function unsafeTagCallable(fn: Function, metadata: object): unknown {
  return Object.assign(fn, metadata);
}

/**
 * Construct a KeyedList element across Signal invariance boundaries.
 *
 * SAFETY: KeyedList stores opaque callbacks plus the source signal for the
 * renderer. The renderer feeds values produced by `source` back into `renderFn`
 * and `keyFn`, so the item type remains correlated with `T` at runtime.
 */
export function unsafeMakeKeyedListElement<T, E, R>(
  source: Signal<ReadonlyArray<T>>,
  renderFn: (item: T, index: number) => Effect.Effect<Element, E, R>,
  keyFn: (item: T, index: number) => string | number,
): KeyedListElement & ElementWithRequirements<R>;
export function unsafeMakeKeyedListElement(
  source: unknown,
  renderFn: unknown,
  keyFn: unknown,
): unknown {
  return new KeyedListData({ source, renderFn, keyFn });
}

/**
 * Narrow Record<string, unknown> to ElementProps.
 *
 * SAFETY: The record was built by iterating JSX props and filtering out
 * 'children' and 'key'. The remaining entries match ElementProps structurally,
 * but TS cannot verify this because ElementProps uses template literal index
 * signatures (data-*, aria-*) rather than a general string index.
 */
export function unsafeAsElementProps(
  record: Record<string, unknown>,
): import("../primitives/element.js").ElementProps;
export function unsafeAsElementProps(record: Record<string, unknown>): unknown {
  return record;
}

// =============================================================================
// Resource Registry
// =============================================================================

/**
 * Extract typed signal from registry entry.
 *
 * SAFETY: The registry guarantees that a key created from Resource<A, E, R>
 * always maps to a Signal<ResourceState<A, E>>. The unknown→typed narrowing is
 * sound because the registry key is the type-level proof.
 */
export function unsafeEntrySignal<A, E>(
  state: Signal<ResourceState<unknown, unknown>>,
): Signal<ResourceState<A, E>>;
export function unsafeEntrySignal(state: Signal<ResourceState<unknown, unknown>>): unknown {
  return state;
}

// =============================================================================
// Generic Narrowing
// =============================================================================

/**
 * Narrow Record<string, unknown> to a concrete params type P.
 *
 * SAFETY: The params object was constructed field-by-field from typed sources
 * (Signal.get or static values). The caller guarantees the shape matches P.
 */
export function unsafeAsParams<P>(record: Record<string, unknown>): P;
export function unsafeAsParams(record: Record<string, unknown>): unknown {
  return record;
}

/**
 * Narrow a squashed error value from unknown to E.
 *
 * SAFETY: The error was extracted via Cause.squash from a Cause produced by an
 * Effect<A, E, R>. For typed failures (Fail variants), the squashed value is of
 * type E. For defects/interruptions, the surrounding catchAllCause provides a
 * safety net for unrecoverable errors.
 */
export function unsafeAsError<E>(error: unknown): E;
export function unsafeAsError(error: unknown): unknown {
  return error;
}

// =============================================================================
// Function Union Narrowing
// =============================================================================

/**
 * Call a function union as a no-arg function.
 *
 * SAFETY: Used in Resource.make overload implementation where the key
 * discriminant correlates with factory arity. At runtime, JS ignores extra
 * arity.
 */
export function unsafeCallNoArgs<R>(fn: Function): R;
export function unsafeCallNoArgs(fn: Function): unknown {
  return fn();
}

// =============================================================================
// Effect Context Erasure
// =============================================================================

/**
 * Narrow a service map to a subset of its services.
 *
 * SAFETY: Context<A | B> contains all services for both A and B. Narrowing to
 * Context<A> is sound because the services are still there.
 */
export function unsafeNarrowContext<R, S>(ctx: Context.Context<S>): Context.Context<R>;
export function unsafeNarrowContext(ctx: unknown): unknown {
  return ctx;
}

/**
 * Widen a specific service map to unknown for untyped boundaries.
 *
 * SAFETY: Context<R> contains runtime services regardless of R phantom.
 * Widening to unknown only erases compile-time detail.
 */
export function unsafeWidenContext<R>(ctx: Context.Context<R>): Context.Context<unknown>;
export function unsafeWidenContext(ctx: unknown): unknown {
  return ctx;
}

// =============================================================================
// Overloaded Function Dispatch
// =============================================================================

/**
 * Cast a function implementation to a specific overloaded callable type.
 *
 * SAFETY: Used for overloaded function implementations where TypeScript cannot
 * verify that a single implementation matches multiple generic overload
 * signatures. The caller ensures runtime correctness through discriminant
 * checks in the implementation body.
 */
export function unsafeAsOverload<T>(fn: unknown): T;
export function unsafeAsOverload(fn: unknown): unknown {
  return fn;
}

/**
 * Build a typed exhaustive tag dispatcher from Effect Match.
 *
 * SAFETY: Callers provide one handler per tag through mapped types. Effect's
 * Match.tagsExhaustive performs the runtime dispatch; this helper only bridges
 * its highly generic return type back to the caller-selected result type.
 */
export function unsafeTagsExhaustive<State extends { readonly _tag: string }, Result>(handlers: {
  readonly [Tag in State["_tag"] & string]: (
    state: Extract<State, { readonly _tag: Tag }>,
  ) => Result;
}): (state: State) => Result;
export function unsafeTagsExhaustive(
  handlers: Record<string, (state: { readonly _tag: string }) => unknown>,
): unknown {
  return Match.type<{ readonly _tag: string }>().pipe(Match.tagsExhaustive(handlers));
}

// =============================================================================
// Effect Requirements Erasure
// =============================================================================

/**
 * Erase the R (requirements) type from an Effect.
 *
 * SAFETY: The caller guarantees all required services are available in the
 * current fiber context. Used at Element type boundaries where Component.run()
 * returns erased requirements but services were provided at mount/render time.
 */
export function unsafeEraseR<A, E, R>(effect: Effect.Effect<A, E, R>): Effect.Effect<A, E, never>;
export function unsafeEraseR<A, E, R>(effect: Effect.Effect<A, E, R>): Effect.Effect<A, E, R> {
  return effect;
}

/**
 * Run a component while restoring its erased error type.
 *
 * SAFETY: Component.Type<Props, E, R> guarantees the callable and optional
 * _runFn represent the same component body and error channel E. The runtime
 * stores _runFn as unknown on the structural interface, so callers that still
 * know E can safely recover it here.
 */
export function unsafeRunComponent<Props, E, R>(
  component: Component.Type<Props, E, R>,
  props: ComponentCallProps<Props>,
): Effect.Effect<Element, E, never>;
export function unsafeRunComponent<Props, E, R>(
  component: Component.Type<Props, E, R>,
  props: ComponentCallProps<Props>,
): Effect.Effect<Element, unknown, never> {
  const element = component(props);
  if (isComponentElement(element)) {
    return unsafeEraseR(element.run());
  }
  return Effect.succeed(element);
}

// =============================================================================
// Route Params Narrowing
// =============================================================================

/**
 * Narrow a generic `RouteParams` Effect to a route-specific params type.
 *
 * SAFETY: The Outlet sets `CurrentRouteParams` FiberRef to the matched route's
 * params before running the route component. The caller guarantees the path
 * parameter matches the current route.
 */
export function unsafeNarrowParams<P>(
  effect: Effect.Effect<Record<string, string>>,
): Effect.Effect<P>;
export function unsafeNarrowParams(
  effect: Effect.Effect<Record<string, string>>,
): Effect.Effect<Record<string, string>> {
  return effect;
}

// =============================================================================
// Middleware Requirements Erasure
// =============================================================================

/**
 * Erase requirements from middleware effects for sequential execution.
 *
 * SAFETY: Middleware effects have their requirements provided at the route
 * level via `Route.provide()`. By the time the middleware chain executes, all
 * services are available in the fiber context.
 */
export function unsafeEraseMiddlewareR<R>(
  effect: Effect.Effect<void, unknown, R>,
): Effect.Effect<void, unknown, never>;
export function unsafeEraseMiddlewareR<R>(
  effect: Effect.Effect<void, unknown, R>,
): Effect.Effect<void, unknown, R> {
  return effect;
}

// =============================================================================
// Tagged Error Field Extraction
// =============================================================================

/**
 * Extract known fields from a tagged error after tag discrimination.
 *
 * SAFETY: The caller has already checked the error tag matches the expected
 * constructor. The error object is structurally guaranteed to have the extracted
 * fields by the tagged error constructor.
 */
export function unsafeExtractFields<T>(error: object): T;
export function unsafeExtractFields(error: object): unknown {
  return error;
}
