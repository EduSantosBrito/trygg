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
  Effect,
  Exit,
  Fiber,
  Layer,
  Option,
  Ref,
  Scope,
  SubscriptionRef,
} from "effect";
import * as Context from "effect/Context";
import { Element, type Element as ElementType, provideElement } from "../primitives/element.js";
import * as Signal from "../primitives/signal.js";
import * as Component from "../primitives/component.js";
import * as Metrics from "../debug/metrics.js";
import * as ContractTrace from "../contract/trace.js";
import { getFiberRef, locallyFiberRef } from "../internal/fiber-ref.js";
import type { RoutesManifest } from "./routes.js";
import {
  InvalidRouteComponent,
  type ComponentInput,
  type RouteComponent,
  type RouteErrorInfo,
  type RouteParams,
} from "./types.js";
import type { ResolvedRoute } from "./matching.js";
import {
  resolveErrorBoundary,
  resolveForbiddenBoundary,
  resolveLoadingBoundary,
  resolveNotFoundBoundary,
} from "./matching.js";
import {
  CurrentRouteParams,
  CurrentRouteError,
  CurrentOutletChild,
  CurrentRouter,
  Router as RouterTag,
} from "./service.js";
import { CurrentRouteQuery } from "./route.js";
import { unsafeEraseR } from "../internal/unsafe.js";

export interface RouteRenderIdentity {
  readonly path: string;
}

class StaleRouteRender extends Data.TaggedError("StaleRouteRender")<{
  readonly expectedPath: string;
}> {}

const fromNullable = <A>(value: A | null | undefined): Option.Option<A> =>
  value === null || value === undefined ? Option.none() : Option.some(value);

/**
 * Extract only string-valued entries from a decoded params object.
 * Route params are always strings (URL path segments).
 * @internal
 */
export const toRouteParams = (decoded: Record<string, unknown>): RouteParams => {
  const result: Record<string, string> = {};
  for (const [key, value] of Object.entries(decoded)) {
    if (value !== null && value !== undefined) {
      result[key] = String(value);
    }
  }
  return result;
};

/**
 * Type guard to check if a RouteComponent is an Effect<Element>.
 * Used to narrow the union type after checking !Component.isEffectComponent().
 * @internal
 */
const isEffectElement = (u: RouteComponent): u is Effect.Effect<ElementType, unknown, unknown> =>
  Effect.isEffect(u);

const mapChildInputElements = (
  child: import("../primitives/element.js").ElementChildren,
  f: (element: ElementType) => ElementType,
): import("../primitives/element.js").ElementChildren => {
  if (Array.isArray(child)) {
    return child.map((value) => mapChildInputElements(value, f));
  }

  return Component.isEffectComponent(child) ||
    typeof child !== "object" ||
    child === null ||
    !("_tag" in child)
    ? child
    : Element.$is("Intrinsic")(child) ||
        Element.$is("Text")(child) ||
        Element.$is("SignalText")(child) ||
        Element.$is("SignalElement")(child) ||
        Element.$is("Provide")(child) ||
        Element.$is("Component")(child) ||
        Element.$is("Fragment")(child) ||
        Element.$is("Portal")(child) ||
        Element.$is("KeyedList")(child) ||
        Element.$is("ErrorBoundaryElement")(child)
      ? f(child)
      : child;
};

const isStaleRouteRender = (routeIdentity: RouteRenderIdentity | undefined) =>
  Effect.gen(function* () {
    if (routeIdentity === undefined) return false;

    const routerFromContext = yield* Effect.serviceOption(RouterTag);
    const router = Option.isSome(routerFromContext)
      ? routerFromContext
      : yield* getFiberRef(CurrentRouter);
    if (Option.isNone(router)) return false;

    const current = yield* SubscriptionRef.get(router.value.current._ref);
    return current.path !== routeIdentity.path;
  });

const wrapElementWithFiberRefs = (
  element: ElementType,
  wrapRun: <A, E, R>(effect: Effect.Effect<A, E, R>) => Effect.Effect<A, E, R>,
  wrapperInputs: unknown,
): ElementType => {
  switch (element._tag) {
    case "Component":
      return Element.fromEffect(
        Effect.suspend(() =>
          wrapRun(element.run()).pipe(
            Effect.map((child) => wrapElementWithFiberRefs(child, wrapRun, wrapperInputs)),
            unsafeEraseR,
          ),
        ),
        {
          key: element.key ?? undefined,
          identity: element.identity ?? element.run,
          inputs: { element: element.inputs, wrapper: wrapperInputs },
        },
      );
    case "Provide":
      return provideElement(
        element.context,
        wrapElementWithFiberRefs(element.child, wrapRun, wrapperInputs),
      );
    case "Intrinsic":
      return Element.Intrinsic({
        tag: element.tag,
        props: element.props,
        children: element.children.map((child) =>
          wrapElementWithFiberRefs(child, wrapRun, wrapperInputs),
        ),
        key: element.key,
      });
    case "Fragment":
      return Element.Fragment({
        children: element.children.map((child) =>
          wrapElementWithFiberRefs(child, wrapRun, wrapperInputs),
        ),
      });
    case "Portal":
      return Element.Portal({
        target: element.target,
        children: mapChildInputElements(element.children, (child) =>
          wrapElementWithFiberRefs(child, wrapRun, wrapperInputs),
        ),
      });
    case "KeyedList":
      return Element.KeyedList({
        source: element.source,
        keyFn: element.keyFn,
        renderFn: (item, index) =>
          element
            .renderFn(item, index)
            .pipe(Effect.map((child) => wrapElementWithFiberRefs(child, wrapRun, wrapperInputs))),
      });
    case "ErrorBoundaryElement":
      if (typeof element.fallback === "function") {
        const fallback = element.fallback;
        return Element.ErrorBoundaryElement({
          child: wrapElementWithFiberRefs(element.child, wrapRun, wrapperInputs),
          fallback: (cause) => wrapElementWithFiberRefs(fallback(cause), wrapRun, wrapperInputs),
          onError: element.onError,
        });
      }

      return Element.ErrorBoundaryElement({
        child: wrapElementWithFiberRefs(element.child, wrapRun, wrapperInputs),
        fallback: wrapElementWithFiberRefs(element.fallback, wrapRun, wrapperInputs),
        onError: element.onError,
      });
    default:
      return element;
  }
};

// =============================================================================
// OutletRenderer Service
// =============================================================================

/** @since 1.0.0 */
export interface OutletRendererShape {
  readonly renderComponent: (
    component: RouteComponent,
    params: Record<string, unknown>,
    query?: Record<string, unknown>,
    routeIdentity?: RouteRenderIdentity,
  ) => Effect.Effect<ElementType, unknown, never>;
  readonly renderLayout: (
    layout: RouteComponent,
    child: ElementType,
    params: Record<string, unknown>,
    query?: Record<string, unknown>,
    routeIdentity?: RouteRenderIdentity,
  ) => Effect.Effect<ElementType, unknown, never>;
  readonly renderError: (
    errorComp: RouteComponent,
    cause: Cause.Cause<unknown>,
    path: string,
  ) => Effect.Effect<ElementType, InvalidRouteComponent, never>;
}

/**
 * OutletRenderer — component rendering with params/query injection.
 * @since 1.0.0
 */
export class OutletRenderer extends Context.Service<OutletRenderer, OutletRendererShape>()(
  "trygg/OutletRenderer",
) {
  static readonly Live: Layer.Layer<OutletRenderer> = Layer.succeed(OutletRenderer, {
    renderComponent: renderComponent,
    renderLayout: renderLayout,
    renderError: renderError,
  });
}

// =============================================================================
// BoundaryResolver Service
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
export class BoundaryResolver extends Context.Service<BoundaryResolver, BoundaryResolverShape>()(
  "trygg/BoundaryResolver",
) {
  static readonly make = (manifest: RoutesManifest): BoundaryResolverShape => ({
    resolveError: (route) => resolveErrorBoundary(route, manifest.error),
    resolveErrorRoot: () => fromNullable(manifest.error),
    resolveLoading: (route) => resolveLoadingBoundary(route),
    resolveNotFound: (route) => resolveNotFoundBoundary(route, manifest.notFound),
    resolveNotFoundRoot: () => fromNullable(manifest.notFound),
    resolveForbidden: (route) => resolveForbiddenBoundary(route, manifest.forbidden),
  });

  static readonly layer = (manifest: RoutesManifest): Layer.Layer<BoundaryResolver> =>
    Layer.succeed(BoundaryResolver, BoundaryResolver.make(manifest));
}

// =============================================================================
// AsyncLoader Service
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
  /** Track a load effect with dedup by match key. Returns immediately; updates view signal. */
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
export class AsyncLoader extends Context.Service<AsyncLoader, AsyncLoaderShape>()(
  "trygg/AsyncLoader",
) {
  /** Create a live AsyncLoader. Must be called within a Scope. */
  static readonly make = (
    loadingElement: Element,
    scope: Scope.Scope,
  ): Effect.Effect<AsyncLoaderShape> =>
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
      const matchKeyRef = yield* Ref.make<Option.Option<string>>(Option.none());

      const track = (
        matchKey: string,
        loadEffect: Effect.Effect<Element, unknown, never>,
        trace?: { readonly epoch?: number },
      ): Effect.Effect<void> =>
        Effect.gen(function* () {
          // Dedup: skip if matchKey unchanged
          const currentKey = yield* Ref.get(matchKeyRef);
          if (Option.isSome(currentKey) && currentKey.value === matchKey) {
            yield* ContractTrace.emit({
              event: "asyncLoader.dedup",
              level: "semantic",
              payload: { matchKey, epoch: trace?.epoch },
            });
            return;
          }
          yield* ContractTrace.emit({
            event: "asyncLoader.track",
            level: "semantic",
            payload: {
              matchKey,
              previousMatchKey: Option.getOrUndefined(currentKey),
              epoch: trace?.epoch,
            },
          });
          yield* Ref.set(matchKeyRef, Option.some(matchKey));

          // Interrupt previous load fiber
          const prevFiber = yield* Ref.get(currentFiberRef);
          yield* Option.match(prevFiber, {
            onNone: () => Effect.void,
            onSome: (fiber) =>
              Effect.gen(function* () {
                yield* ContractTrace.emit({
                  event: "asyncLoader.interrupt",
                  level: "semantic",
                  payload: {
                    fromMatchKey: Option.getOrUndefined(currentKey),
                    toMatchKey: matchKey,
                    epoch: trace?.epoch,
                  },
                });
                yield* Fiber.interrupt(fiber);
                yield* ContractTrace.emit({
                  event: "effect.fiber.interrupt",
                  level: "semantic",
                  payload: { owner: "router.asyncLoader", reason: "new-match" },
                });
                yield* Ref.set(currentFiberRef, Option.none());
              }),
          });

          // Set loading/refreshing state
          const lastEl = yield* Ref.get(lastElementRef);
          yield* Option.match(lastEl, {
            onNone: () =>
              ContractTrace.emit({
                event: "asyncLoader.loading",
                level: "semantic",
                payload: { matchKey, epoch: trace?.epoch },
              }).pipe(Effect.flatMap(() => Signal.set(state, AsyncLoadState.Loading()))),
            onSome: (previous) =>
              ContractTrace.emit({
                event: "asyncLoader.refreshing",
                level: "semantic",
                payload: { matchKey, hasPrevious: true, epoch: trace?.epoch },
              }).pipe(
                Effect.flatMap(() => Signal.set(state, AsyncLoadState.Refreshing({ previous }))),
              ),
          });

          // Fork the load effect
          yield* ContractTrace.emit({
            event: "effect.fork.scoped",
            level: "semantic",
            payload: { owner: "router.asyncLoader", scopeKind: "outlet" },
          });
          const fiber = yield* Effect.forkIn(
            Effect.gen(function* () {
              const exit = yield* Effect.exit(loadEffect);
              if (Exit.isSuccess(exit)) {
                yield* Ref.set(lastElementRef, Option.some(exit.value));
                yield* ContractTrace.emit({
                  event: "asyncLoader.ready",
                  level: "semantic",
                  payload: { matchKey, epoch: trace?.epoch },
                });
                yield* Signal.set(state, AsyncLoadState.Ready({ element: exit.value }));
              } else {
                yield* ContractTrace.emit({
                  event: "asyncLoader.error",
                  level: "semantic",
                  payload: { matchKey, epoch: trace?.epoch, cause: Cause.pretty(exit.cause) },
                });
                yield* Signal.set(state, AsyncLoadState.Loading());
              }
            }),
            scope,
          );

          yield* Ref.set(currentFiberRef, Option.some(fiber));
        });

      return { state, view, track } satisfies AsyncLoaderShape;
    });

  /** Passthrough AsyncLoader for testing (no async tracking, immediate render). */
  static readonly test = (fallbackElement: Element): AsyncLoaderShape => {
    // In test mode, track just resolves the effect synchronously and stores the result
    let lastElement: Element = fallbackElement;
    const stateSignal = Signal.makeSync<AsyncLoadState>(AsyncLoadState.Loading());
    const viewSignal = Signal.makeSync(fallbackElement);

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
  };
}

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
): Effect.Effect<ElementType, InvalidRouteComponent, never> {
  const params = toRouteParams(decodedParams);
  const withRouteContext = <A, E, R>(effect: Effect.Effect<A, E, R>): Effect.Effect<A, E, R> =>
    locallyFiberRef(
      CurrentRouteParams,
      params,
      locallyFiberRef(CurrentRouteQuery, decodedQuery, effect),
    );

  const wrapRouteElement = (effect: Effect.Effect<ElementType, unknown, unknown>) =>
    Element.fromEffect(
      Effect.gen(function* () {
        if (yield* isStaleRouteRender(routeIdentity)) {
          yield* ContractTrace.emit({
            event: "route.render.skipStale",
            level: "semantic",
            payload: { expectedPath: routeIdentity?.path },
          });
          return yield* new StaleRouteRender({ expectedPath: routeIdentity?.path ?? "<unknown>" });
        }

        const capturedContext = yield* Effect.context<unknown>();
        const element = yield* effect;
        const wrapperInputs = {
          params,
          query: decodedQuery,
          routeIdentity,
          wrappedIdentity: component,
        };
        return provideElement(
          capturedContext,
          wrapElementWithFiberRefs(element, withRouteContext, wrapperInputs),
        );
      }).pipe(unsafeEraseR),
      {
        identity: component,
        inputs: { params, query: decodedQuery, routeIdentity, wrappedIdentity: component },
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
): Effect.Effect<ElementType, InvalidRouteComponent, never> {
  const params = toRouteParams(decodedParams);
  const withLayoutContext = <A, E, R>(effect: Effect.Effect<A, E, R>): Effect.Effect<A, E, R> =>
    locallyFiberRef(
      CurrentRouteParams,
      params,
      locallyFiberRef(
        CurrentRouteQuery,
        decodedQuery,
        locallyFiberRef(CurrentOutletChild, Option.some(child), effect),
      ),
    );

  const wrapLayoutElement = (effect: Effect.Effect<ElementType, unknown, unknown>) =>
    Element.fromEffect(
      Effect.gen(function* () {
        if (yield* isStaleRouteRender(routeIdentity)) {
          yield* ContractTrace.emit({
            event: "route.layout.skipStale",
            level: "semantic",
            payload: { expectedPath: routeIdentity?.path },
          });
          return yield* new StaleRouteRender({ expectedPath: routeIdentity?.path ?? "<unknown>" });
        }

        const capturedContext = yield* Effect.context<unknown>();
        const element = yield* effect;
        const wrapperInputs = {
          child,
          params,
          query: decodedQuery,
          routeIdentity,
          wrappedIdentity: layout,
        };
        return provideElement(
          capturedContext,
          wrapElementWithFiberRefs(element, withLayoutContext, wrapperInputs),
        );
      }).pipe(unsafeEraseR),
      {
        identity: layout,
        inputs: { child, params, query: decodedQuery, routeIdentity, wrappedIdentity: layout },
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
): Effect.Effect<ElementType, InvalidRouteComponent, never> {
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

      const wrapErrorElement = (effect: Effect.Effect<ElementType, unknown, unknown>) =>
        Element.fromEffect(
          Effect.gen(function* () {
            const capturedContext = yield* Effect.context<unknown>();
            const element = yield* effect;
            const wrapperInputs = { cause, path, wrappedIdentity: errorComp };
            return provideElement(
              capturedContext,
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
