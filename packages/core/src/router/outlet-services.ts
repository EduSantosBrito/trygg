/**
 * @since 1.0.0
 * Outlet Internal Services
 *
 * Testable services used internally by the Outlet. Each has a service key
 * with Layer factories for production and testing.
 */
import {
  Cause,
  Data,
  Deferred,
  Effect,
  Exit,
  Fiber,
  Option,
  Ref,
  Schema,
  Scope,
  Semaphore,
} from "effect";
import * as Context from "effect/Context";
import {
  Element,
  isElement,
  type Element as ElementType,
  provideElement,
} from "../primitives/element.js";
import * as Signal from "../primitives/signal.js";
import * as Component from "../primitives/component.js";
import * as Metrics from "../debug/metrics.js";
import * as Trace from "../trace/index.js";
import { locallyFiberRef } from "../internal/fiber-ref.js";
import type { RoutesManifest } from "./routes.js";
import {
  InvalidRouteComponent,
  type ComponentInput,
  type DecodedRouteParamsByPattern,
  type RouteComponent,
  type RouteErrorInfo,
} from "./types.js";
import type { ResolvedRoute } from "./matching.js";

const runSignalSetupSync = <A>(effect: Effect.Effect<A, Signal.SignalScopeError>): A =>
  Effect.runSync(effect);
import {
  resolveErrorBoundary,
  resolveForbiddenBoundary,
  resolveLoadingBoundary,
  resolveNotFoundBoundary,
} from "./matching.js";
import { CurrentRouteParams, CurrentRouteError, locallyCurrentOutletChild } from "./service.js";
import { CurrentRouteQuery } from "./route.js";
import { unsafeEraseR } from "../internal/unsafe.js";

export interface RouteRenderIdentity {
  readonly path: string;
  readonly key: string;
  readonly currentKey: Effect.Effect<string>;
  readonly patterns: ReadonlyArray<string>;
  readonly paramsByPattern: DecodedRouteParamsByPattern;
}

export const routeRenderKey = (path: string, query: URLSearchParams): string => {
  const queryString = query.toString();
  return queryString === "" ? path : `${path}?${queryString}`;
};

export const routeRenderIdentity = (
  path: string,
  query: URLSearchParams,
  currentKey: Effect.Effect<string>,
  patterns: ReadonlyArray<string> = [],
  paramsByPattern: DecodedRouteParamsByPattern = new Map(),
): RouteRenderIdentity => ({
  path,
  key: routeRenderKey(path, query),
  currentKey,
  patterns,
  paramsByPattern,
});

class StaleRouteRender extends Schema.TaggedError<StaleRouteRender>()("StaleRouteRender", {
  expectedPath: Schema.String,
}) {}

const fromNullable = <A>(value: A | null | undefined): Option.Option<A> =>
  value === null || value === undefined ? Option.none() : Option.some(value);

/**
 * Type guard to check if a RouteComponent is an Effect<Element>.
 * Used to narrow the union type after checking !Component.isEffectComponent().
 * @internal
 */
type RuntimeRequirements = unknown;

const isEffectElement = (
  u: RouteComponent,
): u is Effect.Effect<ElementType, unknown, RuntimeRequirements> => Effect.isEffect(u);

const mapChildInputElements = (
  child: import("../primitives/element.js").ElementChildren,
  f: (element: ElementType) => ElementType,
): import("../primitives/element.js").ElementChildren => {
  if (Array.isArray(child)) {
    return child.map((value) => mapChildInputElements(value, f));
  }

  return isElement(child) ? f(child) : child;
};

const isStaleRouteRender = Effect.fn("isStaleRouteRender")(function* (
  routeIdentity: RouteRenderIdentity | undefined,
) {
  if (routeIdentity === undefined) {
    return false;
  }

  return (yield* routeIdentity.currentKey) !== routeIdentity.key;
});

// The lexical context captured around a route/layout element is re-injected via
// provideElement when that element actually renders LATER, inside the outlet's
// own render phase. It must NOT carry the transient render-state fiber refs that
// happened to be ambient at capture time (the enclosing layout wrapper's render
// phase, component scope, and signal owner). If it does, provideElement re-injects
// the enclosing phase and renderComponent's own provideService(CurrentRenderPhase,
// childPhase) becomes a no-op — the wrapped child renders under the WRONG phase.
// Its local Signal.get reads then get attributed to the layout wrapper instead of
// the child, so child-local updates re-render the layout (and stop at the no-op
// SignalElement reconcile) instead of re-running the child. Strip them so each
// child renders under its own phase. Mirrors render-component.ts:133-137.
const stripCapturedRenderState = Context.omit(
  Signal.CurrentRenderPhase,
  Signal.CurrentComponentScope,
  Signal.CurrentSignalOwner,
);

// The outlet passes a single-entry context fragment carrying CurrentRouter (the
// live router service for this outlet's subtree). Merge it into the stripped
// capturable context so the route staleness gate (isStaleRouteRender) can read
// router.current on every route child's render AND re-render fiber. The
// route/layout element is ALREADY a Provide boundary, so this only adds to the
// provided context — it never changes the element's shape. CurrentRouter cannot
// be set on the outlet's own fiber (render fibers fork from this captured
// context, not the live outlet fiber), and ManagedRuntime's layer-time fiber-ref
// propagation does not reach render fibers under a plain Effect.provide runtime;
// threading it through the captured context is the one channel that always
// reaches the gate.
const mergeRouterContext = (
  stripped: Context.Context<unknown>,
  routerContext: Context.Context<never> | undefined,
): Context.Context<unknown> =>
  routerContext === undefined ? stripped : Context.merge(stripped, routerContext);

const wrapElementWithFiberRefs = (
  element: ElementType,
  // The route variant of wrapRun (withRouteContext) gates each wrapped
  // component's run on route staleness and may short-circuit with
  // StaleRouteRender; layout/error variants never add to the error channel and
  // remain assignable by covariance.
  wrapRun: <A, E, R>(effect: Effect.Effect<A, E, R>) => Effect.Effect<A, E | StaleRouteRender, R>,
  wrapperInputs: unknown,
  shouldDropSignalUpdate?: Effect.Effect<boolean>,
): ElementType => {
  switch (element._tag) {
    case "Component":
      return Element.fromEffect(
        Effect.suspend(() =>
          wrapRun(element.run()).pipe(
            Effect.map((child) =>
              wrapElementWithFiberRefs(child, wrapRun, wrapperInputs, shouldDropSignalUpdate),
            ),
            unsafeEraseR,
          ),
        ),
        {
          key: element.key ?? undefined,
          identity: element.identity ?? element.run,
          inputs: { element: element.inputs, wrapper: wrapperInputs },
          provider: element.provider ?? undefined,
        },
      );
    case "SignalElement":
      return Element.fromEffect(
        Effect.gen(function* () {
          const originalOnSwap = element.onSwap;
          const originalValues = new WeakMap<ElementType, unknown>();
          const wrapSignalValue = (value: unknown) => {
            const child = isElement(value)
              ? wrapElementWithFiberRefs(value, wrapRun, wrapperInputs, shouldDropSignalUpdate)
              : Element.Text({ content: String(value) });
            const wrapped = Element.fromEffect(wrapRun(Effect.succeed(child)).pipe(unsafeEraseR), {
              identity: element.signal,
              inputs: { value, wrapper: wrapperInputs },
            });
            originalValues.set(wrapped, value);
            return wrapped;
          };
          const initial = yield* Signal.peek(element.signal);
          const wrappedSignal = yield* Signal.make<ElementType>(wrapSignalValue(initial));
          const unsubscribe = yield* Signal.subscribe(element.signal, () =>
            Effect.gen(function* () {
              if (shouldDropSignalUpdate !== undefined && (yield* shouldDropSignalUpdate)) {
                yield* Trace.emit("route.render.skipStale", () => ({ reason: "signalElement" }));
                return;
              }
              const value = yield* Signal.peek(element.signal);
              yield* Signal.set(wrappedSignal, wrapSignalValue(value));
            }),
          );
          yield* Effect.addFinalizer(() => unsubscribe);
          const onSwap =
            originalOnSwap === undefined
              ? undefined
              : (committed: unknown) =>
                  isElement(committed) && originalValues.has(committed)
                    ? originalOnSwap(originalValues.get(committed))
                    : Effect.void;
          return Element.SignalElement({ signal: wrappedSignal, onSwap });
        }).pipe(unsafeEraseR),
        {
          identity: element.signal,
          inputs: { signal: element.signal, onSwap: element.onSwap, wrapper: wrapperInputs },
        },
      );
    case "Provide":
      return provideElement(
        element.context,
        wrapElementWithFiberRefs(element.child, wrapRun, wrapperInputs, shouldDropSignalUpdate),
      );
    case "Intrinsic":
      return Element.Intrinsic({
        tag: element.tag,
        props: element.props,
        children: element.children.map((child) =>
          wrapElementWithFiberRefs(child, wrapRun, wrapperInputs, shouldDropSignalUpdate),
        ),
        key: element.key,
      });
    case "Fragment":
      return Element.Fragment({
        children: element.children.map((child) =>
          wrapElementWithFiberRefs(child, wrapRun, wrapperInputs, shouldDropSignalUpdate),
        ),
      });
    case "Portal":
      return Element.Portal({
        target: element.target,
        children: mapChildInputElements(element.children, (child) =>
          wrapElementWithFiberRefs(child, wrapRun, wrapperInputs, shouldDropSignalUpdate),
        ),
      });
    case "KeyedList":
      return Element.KeyedList({
        source: element.source,
        keyFn: element.keyFn,
        renderFn: (item, index) =>
          element
            .renderFn(item, index)
            .pipe(
              Effect.map((child) =>
                wrapElementWithFiberRefs(child, wrapRun, wrapperInputs, shouldDropSignalUpdate),
              ),
            ),
      });
    case "ErrorBoundaryElement":
      if (typeof element.fallback === "function") {
        const fallback = element.fallback;
        return Element.ErrorBoundaryElement({
          child: wrapElementWithFiberRefs(
            element.child,
            wrapRun,
            wrapperInputs,
            shouldDropSignalUpdate,
          ),
          fallback: (cause) =>
            wrapElementWithFiberRefs(
              fallback(cause),
              wrapRun,
              wrapperInputs,
              shouldDropSignalUpdate,
            ),
          onError: element.onError,
        });
      }

      return Element.ErrorBoundaryElement({
        child: wrapElementWithFiberRefs(
          element.child,
          wrapRun,
          wrapperInputs,
          shouldDropSignalUpdate,
        ),
        fallback: wrapElementWithFiberRefs(
          element.fallback,
          wrapRun,
          wrapperInputs,
          shouldDropSignalUpdate,
        ),
        onError: element.onError,
      });
    default:
      return element;
  }
};

// =============================================================================
// Boundary resolution
// =============================================================================

/** @since 1.0.0 */
export interface BoundaryResolverShape {
  readonly resolveError: (route: ResolvedRoute) => Option.Option<ComponentInput>;
  readonly resolveErrorRoot: () => Option.Option<ComponentInput>;
  readonly resolveLoading: (route: ResolvedRoute) => Option.Option<ComponentInput>;
  readonly resolveNotFound: (route: ResolvedRoute) => Option.Option<ComponentInput>;
  readonly resolveNotFoundRoot: () => Option.Option<ComponentInput>;
  readonly resolveForbidden: (route: ResolvedRoute) => Option.Option<ComponentInput>;
}

/**
 * BoundaryResolver — nearest-wins boundary resolution.
 * @since 1.0.0
 */
export const BoundaryResolver = {
  make: (manifest: RoutesManifest): BoundaryResolverShape => ({
    resolveError: (route) => resolveErrorBoundary(route, manifest.error),
    resolveErrorRoot: () => fromNullable(manifest.error),
    resolveLoading: (route) => resolveLoadingBoundary(route),
    resolveNotFound: (route) => resolveNotFoundBoundary(route, manifest.notFound),
    resolveNotFoundRoot: () => fromNullable(manifest.notFound),
    resolveForbidden: (route) => resolveForbiddenBoundary(route, manifest.forbidden),
  }),
};

// =============================================================================
// Async loading
// =============================================================================

/**
 * Async load state as Data.TaggedEnum.
 * @since 1.0.0
 */
export type AsyncLoadState = Data.TaggedEnum<{
  readonly Loading: {};
  readonly Refreshing: { readonly previous: Element };
  readonly Ready: { readonly element: Element };
}>;
/** @since 1.0.0 */
export const AsyncLoadState = Data.taggedEnum<AsyncLoadState>();

/** @since 1.0.0 */
export interface AsyncLoaderShape {
  /** Signal reflecting loading/refreshing/ready state. */
  readonly state: Signal.Signal<AsyncLoadState>;
  /**
   * Track a load effect with dedup by match key. A replacement starts only
   * after the previous load has fully finalized; the load result remains async.
   */
  readonly track: (
    matchKey: string,
    loadEffect: Effect.Effect<Element, unknown, never>,
    trace?: { readonly epoch?: number },
  ) => Effect.Effect<void>;
  /** Signal reflecting the current rendered element (loading/refreshing/ready). */
  readonly view: Signal.Signal<Element>;
}

/**
 * AsyncLoader — async state management with Ref-based state.
 *
 * - `AsyncLoader.make(loadingElement, scope)`: Ref-based, scoped fiber management (production)
 * - `AsyncLoader.test`: passthrough, no async tracking (testing)
 *
 * @since 1.0.0
 */
export const AsyncLoader = {
  /** Create a live AsyncLoader. Must be called within a Scope. */
  make: (
    loadingElement: Element,
    scope: Scope.Scope,
  ): Effect.Effect<AsyncLoaderShape, Signal.SignalScopeError> =>
    Effect.gen(function* () {
      const state = yield* Signal.make<AsyncLoadState>(AsyncLoadState.Loading());
      const view = yield* Signal.derive(
        state,
        (s) =>
          AsyncLoadState.$match(s, {
            Loading: () => loadingElement,
            Refreshing: () => loadingElement,
            Ready: ({ element }) => element,
          }),
        { scope },
      );

      const lastElementRef = yield* Ref.make<Option.Option<Element>>(Option.none());
      const currentFiberRef = yield* Ref.make<Option.Option<Fiber.Fiber<void, never>>>(
        Option.none(),
      );
      interface LoaderControl {
        readonly matchKey: Option.Option<string>;
        readonly generation: number;
        readonly closed: boolean;
      }
      type TrackAdmission =
        | { readonly kind: "closed" }
        | { readonly kind: "dedup" }
        | {
            readonly kind: "admitted";
            readonly generation: number;
            readonly previousMatchKey: Option.Option<string>;
          };
      const controlRef = yield* Ref.make<LoaderControl>({
        matchKey: Option.none(),
        generation: 0,
        closed: false,
      });
      const transitionLock = Semaphore.makeUnsafe(1);

      yield* Scope.addFinalizer(
        scope,
        Effect.gen(function* () {
          yield* Ref.update(controlRef, (control) => ({
            ...control,
            generation: control.generation + 1,
            closed: true,
          }));
          const current = yield* Ref.getAndSet(
            currentFiberRef,
            Option.none<Fiber.Fiber<void, never>>(),
          );
          if (Option.isSome(current)) {
            yield* Fiber.interrupt(current.value);
          }
        }),
      );

      const track = Effect.fnUntraced(function* (
        matchKey: string,
        loadEffect: Effect.Effect<Element, unknown, never>,
        trace?: { readonly epoch?: number },
      ) {
        const admission = yield* Ref.modify(
          controlRef,
          (control): [TrackAdmission, LoaderControl] => {
            if (control.closed) return [{ kind: "closed" }, control];
            if (Option.isSome(control.matchKey) && control.matchKey.value === matchKey) {
              return [{ kind: "dedup" }, control];
            }
            const generation = control.generation + 1;
            return [
              {
                kind: "admitted",
                generation,
                previousMatchKey: control.matchKey,
              },
              { matchKey: Option.some(matchKey), generation, closed: false },
            ];
          },
        );

        if (admission.kind === "closed") return;
        if (admission.kind === "dedup") {
          yield* Trace.emit("asyncLoader.dedup", () => ({ matchKey, epoch: trace?.epoch }));
          return;
        }

        yield* Trace.emit("asyncLoader.track", () => ({
          matchKey,
          previousMatchKey: Option.getOrUndefined(admission.previousMatchKey),
          epoch: trace?.epoch,
        }));

        // Publish loading state at admission so Outlet never mistakes the old
        // Ready value for this request while its predecessor is finalizing.
        const latest = yield* Ref.get(controlRef);
        if (latest.closed || latest.generation !== admission.generation) return;
        const callerId = yield* Effect.fiberId;
        const currentBeforeTransition = yield* Ref.get(currentFiberRef);
        const reentrantCurrentFiber =
          Option.isSome(currentBeforeTransition) && currentBeforeTransition.value.id === callerId;
        const lastEl = yield* Ref.get(lastElementRef);
        yield* Option.match(lastEl, {
          onNone: () =>
            Trace.emit("asyncLoader.loading", () => ({ matchKey, epoch: trace?.epoch })).pipe(
              Effect.flatMap(() => Signal.set(state, AsyncLoadState.Loading())),
            ),
          onSome: (previous) =>
            Trace.emit("asyncLoader.refreshing", () => ({
              matchKey,
              hasPrevious: true,
              epoch: trace?.epoch,
            })).pipe(
              Effect.flatMap(() => Signal.set(state, AsyncLoadState.Refreshing({ previous }))),
            ),
        });

        const transition = transitionLock.withPermits(1)(
          Effect.gen(function* () {
            const beforeInterrupt = yield* Ref.get(controlRef);
            if (beforeInterrupt.closed || beforeInterrupt.generation !== admission.generation) {
              return;
            }

            const prevFiber = yield* Ref.get(currentFiberRef);
            if (Option.isSome(prevFiber)) {
              yield* Trace.emit("asyncLoader.interrupt", () => ({
                fromMatchKey: Option.getOrUndefined(admission.previousMatchKey),
                toMatchKey: matchKey,
                epoch: trace?.epoch,
              }));
              yield* Fiber.interrupt(prevFiber.value);
              yield* Trace.emit("effect.fiber.interrupt", () => ({
                owner: "router.asyncLoader",
                reason: "new-match",
              }));
              yield* Ref.set(currentFiberRef, Option.none());
            }

            const afterInterrupt = yield* Ref.get(controlRef);
            if (afterInterrupt.closed || afterInterrupt.generation !== admission.generation) {
              return;
            }

            yield* Trace.emit("effect.fork.scoped", () => ({
              owner: "router.asyncLoader",
              scopeKind: "outlet",
            }));
            const start = yield* Deferred.make<void>();
            const fiber = yield* Effect.forkIn(
              Effect.gen(function* () {
                yield* Deferred.await(start);
                const exit = yield* Effect.exit(loadEffect);
                const active = yield* Ref.get(controlRef);
                if (active.closed || active.generation !== admission.generation) {
                  yield* Trace.emit("asyncLoader.dropStale", () => ({
                    matchKey,
                    activeMatchKey: Option.getOrUndefined(active.matchKey),
                    epoch: trace?.epoch,
                  }));
                  return;
                }
                if (Exit.isSuccess(exit)) {
                  yield* Ref.set(lastElementRef, Option.some(exit.value));
                  yield* Trace.emit("asyncLoader.ready", () => ({
                    matchKey,
                    epoch: trace?.epoch,
                  }));
                  yield* Signal.set(state, AsyncLoadState.Ready({ element: exit.value }));
                } else {
                  yield* Trace.emit("asyncLoader.error", () => ({
                    matchKey,
                    epoch: trace?.epoch,
                    cause_type: Trace.causeValueType(exit.cause),
                  }));
                  yield* Signal.set(state, AsyncLoadState.Loading());
                }
              }),
              scope,
              { startImmediately: true },
            );

            yield* Ref.set(currentFiberRef, Option.some(fiber));
            // The start gate installs ownership before a synchronously
            // reentrant load can call track again.
            yield* Deferred.succeed(start, undefined).pipe(Effect.asVoid);
          }),
        );
        const transitionFiber = yield* Effect.forkIn(transition, scope);
        // A load finalizer may trigger another track call. Let that reentrant
        // call return so the current load can finish; its transition remains
        // scope-owned and will run after this one releases the serialization gate.
        if (!reentrantCurrentFiber) {
          yield* Fiber.join(transitionFiber);
        }
      });

      return { state, view, track } satisfies AsyncLoaderShape;
    }),

  /** Passthrough AsyncLoader for testing (no async tracking, immediate render). */
  test: (fallbackElement: Element): AsyncLoaderShape => {
    // In test mode, track just resolves the effect synchronously and stores the result.
    // The helper creates an explicit owner scope so tests do not depend on module-lifetime signals.
    let lastElement: Element = fallbackElement;
    const scope = Effect.runSync(Scope.make());
    const stateSignal = runSignalSetupSync(
      Signal.make<AsyncLoadState>(AsyncLoadState.Loading()).pipe(Scope.provide(scope)),
    );
    const viewSignal = runSignalSetupSync(Signal.make(fallbackElement).pipe(Scope.provide(scope)));

    return {
      state: stateSignal,
      view: viewSignal,
      track: (_, loadEffect) =>
        Effect.gen(function* () {
          const exit = yield* Effect.exit(loadEffect);
          if (Exit.isSuccess(exit)) {
            lastElement = exit.value;
            yield* Signal.set(stateSignal, AsyncLoadState.Ready({ element: lastElement }));
            yield* Signal.set(viewSignal, lastElement);
          }
        }),
    };
  },
};

// =============================================================================
// Rendering Implementations
// =============================================================================

/**
 * Render a RouteComponent to an Element.
 * RouteComponent must be Component.Type from Component.gen.
 * @internal
 */
export function renderComponent(
  component: RouteComponent,
  decodedParams: Record<string, unknown>,
  decodedQuery: Record<string, unknown> = {},
  routeIdentity?: RouteRenderIdentity,
  routerContext?: Context.Context<never>,
): Effect.Effect<ElementType, InvalidRouteComponent, never> {
  const activePatterns = routeIdentity?.patterns ?? [];
  const paramsByPattern =
    routeIdentity?.paramsByPattern ??
    new Map(activePatterns.map((pattern) => [pattern, decodedParams]));
  // Gate every wrapped route-subtree component run on staleness. This wraps each
  // component's `run` (initial AND re-render), so when a superseded route child
  // re-renders from its own local signal during a pending navigation, its body
  // never executes — no stale write to shared chrome, no wasted subtree work.
  // The raised StaleRouteRender is a transient render failure: render-component
  // preserves the current DOM and skips the commit instead of tearing down.
  // (The wrapper gen below also checks staleness, but only on its OWN render;
  // after correct render-phase attribution the inner component re-renders
  // directly and bypasses that wrapper-level check — this gate covers it.)
  const withRouteContext = <A, E, R>(
    effect: Effect.Effect<A, E, R>,
  ): Effect.Effect<A, E | StaleRouteRender, R> =>
    Effect.flatMap(
      isStaleRouteRender(routeIdentity),
      (stale): Effect.Effect<A, E | StaleRouteRender, R> =>
        stale
          ? Effect.flatMap(
              Trace.emit("route.render.skipStale", () => ({ expectedPath: routeIdentity?.path })),
              () =>
                Effect.fail(
                  new StaleRouteRender({ expectedPath: routeIdentity?.path ?? "<unknown>" }),
                ),
            )
          : locallyFiberRef(
              CurrentRouteParams,
              paramsByPattern,
              locallyFiberRef(CurrentRouteQuery, decodedQuery, effect),
            ),
    );

  const wrapRouteElement = (effect: Effect.Effect<ElementType, unknown, RuntimeRequirements>) =>
    Element.fromEffect(
      Effect.gen(function* () {
        if (yield* isStaleRouteRender(routeIdentity)) {
          yield* Trace.emit("route.render.skipStale", () => ({
            expectedPath: routeIdentity?.path,
          }));
          return yield* new StaleRouteRender({ expectedPath: routeIdentity?.path ?? "<unknown>" });
        }

        const capturedContext = yield* Effect.context<unknown>();
        const element = yield* effect;
        const wrapperInputs = {
          params: decodedParams,
          query: decodedQuery,
          routeIdentity,
          wrappedIdentity: component,
        };
        return provideElement(
          mergeRouterContext(stripCapturedRenderState(capturedContext), routerContext),
          wrapElementWithFiberRefs(
            element,
            withRouteContext,
            wrapperInputs,
            isStaleRouteRender(routeIdentity),
          ),
        );
      }).pipe(unsafeEraseR),
      {
        identity: component,
        inputs: {
          params: decodedParams,
          query: decodedQuery,
          routeIdentity,
          wrappedIdentity: component,
        },
      },
    );

  if (Component.isEffectComponent(component)) {
    return Effect.succeed(wrapRouteElement(Effect.succeed(component({}))));
  }

  if (isEffectElement(component)) {
    return Effect.succeed(wrapRouteElement(component));
  }

  return Effect.fail(new InvalidRouteComponent({ actual: component }));
}

/**
 * Render a layout component wrapping child content.
 * @internal
 */
export function renderLayout(
  layout: RouteComponent,
  child: ElementType,
  decodedParams: Record<string, unknown>,
  decodedQuery: Record<string, unknown> = {},
  routeIdentity?: RouteRenderIdentity,
  routerContext?: Context.Context<never>,
): Effect.Effect<ElementType, InvalidRouteComponent, never> {
  const activePatterns = routeIdentity?.patterns ?? [];
  const paramsByPattern =
    routeIdentity?.paramsByPattern ??
    new Map(activePatterns.map((pattern) => [pattern, decodedParams]));
  const withLayoutContext = <A, E, R>(effect: Effect.Effect<A, E, R>): Effect.Effect<A, E, R> =>
    locallyFiberRef(
      CurrentRouteParams,
      paramsByPattern,
      locallyFiberRef(CurrentRouteQuery, decodedQuery, locallyCurrentOutletChild(child, effect)),
    );

  const wrapLayoutElement = (effect: Effect.Effect<ElementType, unknown, RuntimeRequirements>) =>
    Element.fromEffect(
      Effect.gen(function* () {
        if (yield* isStaleRouteRender(routeIdentity)) {
          yield* Trace.emit("route.layout.skipStale", () => ({
            expectedPath: routeIdentity?.path,
          }));
          return yield* new StaleRouteRender({ expectedPath: routeIdentity?.path ?? "<unknown>" });
        }

        const capturedContext = yield* Effect.context<unknown>();
        const element = yield* effect;
        const wrapperInputs = {
          child,
          params: decodedParams,
          query: decodedQuery,
          routeIdentity,
          wrappedIdentity: layout,
        };
        return provideElement(
          mergeRouterContext(stripCapturedRenderState(capturedContext), routerContext),
          wrapElementWithFiberRefs(
            element,
            withLayoutContext,
            wrapperInputs,
            isStaleRouteRender(routeIdentity),
          ),
        );
      }).pipe(unsafeEraseR),
      {
        identity: layout,
        inputs: {
          child,
          params: decodedParams,
          query: decodedQuery,
          routeIdentity,
          wrappedIdentity: layout,
        },
      },
    );

  if (Component.isEffectComponent(layout)) {
    return Effect.succeed(wrapLayoutElement(Effect.succeed(layout({}))));
  }

  if (isEffectElement(layout)) {
    return Effect.succeed(wrapLayoutElement(layout));
  }

  return Effect.fail(new InvalidRouteComponent({ actual: layout }));
}

/**
 * Render a layout component wrapping a PERSISTENT child SignalElement.
 *
 * Unlike {@link renderLayout}, this never bakes child identity into the element
 * inputs: the child region swaps through `childSignalElement`, so normal sibling
 * navigation keeps layout chrome mounted. It does include the caller's
 * `routeContextKey` in the inputs so a preserved layout is rebuilt when the
 * decoded params/query context it reads through `Router.params` / `Router.query`
 * changes. routeIdentity is intentionally absent so no stale-render guard tears
 * down a still-current persistent frame.
 * @internal
 */
export function renderLayoutReactive(
  layout: RouteComponent,
  childSignalElement: ElementType,
  decodedParams: Record<string, unknown>,
  decodedQuery: Record<string, unknown> = {},
  routeContextKey?: string,
  activePatterns: ReadonlyArray<string> = [],
  paramsByPattern: DecodedRouteParamsByPattern = new Map(
    activePatterns.map((pattern) => [pattern, decodedParams]),
  ),
): Effect.Effect<ElementType, InvalidRouteComponent, never> {
  const withLayoutContext = <A, E, R>(effect: Effect.Effect<A, E, R>): Effect.Effect<A, E, R> =>
    locallyFiberRef(
      CurrentRouteParams,
      paramsByPattern,
      locallyFiberRef(
        CurrentRouteQuery,
        decodedQuery,
        locallyCurrentOutletChild(childSignalElement, effect),
      ),
    );

  const wrapLayoutElement = (effect: Effect.Effect<ElementType, unknown, RuntimeRequirements>) =>
    Element.fromEffect(
      Effect.gen(function* () {
        const capturedContext = yield* Effect.context<unknown>();
        const element = yield* effect;
        const wrapperInputs = { wrappedIdentity: layout, routeContextKey };
        return provideElement(
          stripCapturedRenderState(capturedContext),
          wrapElementWithFiberRefs(element, withLayoutContext, wrapperInputs),
        );
      }).pipe(unsafeEraseR),
      {
        identity: layout,
        inputs: { wrappedIdentity: layout, routeContextKey },
      },
    );

  if (Component.isEffectComponent(layout)) {
    return Effect.succeed(wrapLayoutElement(Effect.succeed(layout({}))));
  }

  if (isEffectElement(layout)) {
    return Effect.succeed(wrapLayoutElement(layout));
  }

  return Effect.fail(new InvalidRouteComponent({ actual: layout }));
}

/**
 * Render an error boundary component with RouteErrorInfo.
 * @internal
 */
export function renderError(
  errorComp: RouteComponent,
  cause: Cause.Cause<unknown>,
  path: string,
): Effect.Effect<ElementType, InvalidRouteComponent | Signal.SignalScopeError, never> {
  return unsafeEraseR(
    Effect.gen(function* () {
      yield* Metrics.recordRouteError;

      const resetSignal = yield* Signal.make(0);

      const errorInfo: RouteErrorInfo = {
        cause,
        path,
        reset: Signal.update(resetSignal, (n) => n + 1),
      };

      const withErrorContext = <A, E, R>(effect: Effect.Effect<A, E, R>): Effect.Effect<A, E, R> =>
        locallyFiberRef(CurrentRouteError, Option.some(errorInfo), effect);

      const wrapErrorElement = (effect: Effect.Effect<ElementType, unknown, RuntimeRequirements>) =>
        Element.fromEffect(
          Effect.gen(function* () {
            const capturedContext = yield* Effect.context<unknown>();
            const element = yield* effect;
            const wrapperInputs = { cause, path, wrappedIdentity: errorComp };
            return provideElement(
              stripCapturedRenderState(capturedContext),
              wrapElementWithFiberRefs(element, withErrorContext, wrapperInputs),
            );
          }).pipe(unsafeEraseR),
          {
            identity: errorComp,
            inputs: { cause, path, wrappedIdentity: errorComp },
          },
        );

      if (Component.isEffectComponent(errorComp)) {
        return wrapErrorElement(Effect.succeed(errorComp({})));
      }

      if (isEffectElement(errorComp)) {
        return wrapErrorElement(errorComp);
      }

      // Should never reach here if RouteComponent type is correct
      return yield* new InvalidRouteComponent({ actual: errorComp });
    }),
  );
}
