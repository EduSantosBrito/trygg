/**
 * @since 1.0.0
 * Outlet Internal Services
 *
 * Testable services used internally by the Outlet. Each has a service key
 * with Layer factories for production and testing.
 */
import { Cause, Data, Effect, Exit, Fiber, Layer, Option, Ref, Scope } from "effect";
import * as ServiceMap from "effect/ServiceMap";
import { Element, type Element as ElementType, provideElement } from "../primitives/element.js";
import * as Signal from "../primitives/signal.js";
import * as Component from "../primitives/component.js";
import * as Metrics from "../debug/metrics.js";
import { locallyFiberRef } from "../internal/fiber-ref.js";
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
import { CurrentRouteParams, CurrentRouteError, CurrentOutletChild } from "./service.js";
import { CurrentRouteQuery } from "./route.js";
import { unsafeEraseR } from "../internal/unsafe.js";

const routeComponentWrapperIdentity = Symbol("trygg/router/OutletRenderer.component");
const routeLayoutWrapperIdentity = Symbol("trygg/router/OutletRenderer.layout");
const routeErrorWrapperIdentity = Symbol("trygg/router/OutletRenderer.error");

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

const wrapElementWithFiberRefs = (
  element: ElementType,
  wrapRun: <A, E, R>(effect: Effect.Effect<A, E, R>) => Effect.Effect<A, E, R>,
): ElementType => {
  switch (element._tag) {
    case "Component":
      return Element.fromEffect(
        Effect.suspend(() =>
          wrapRun(element.run()).pipe(
            Effect.map((child) => wrapElementWithFiberRefs(child, wrapRun)),
            unsafeEraseR,
          ),
        ),
        {
          key: element.key ?? undefined,
          identity: element.identity ?? element.run,
          inputs: element.inputs,
        },
      );
    case "Provide":
      return provideElement(element.context, wrapElementWithFiberRefs(element.child, wrapRun));
    case "Intrinsic":
      return Element.Intrinsic({
        tag: element.tag,
        props: element.props,
        children: element.children.map((child) => wrapElementWithFiberRefs(child, wrapRun)),
        key: element.key,
      });
    case "Fragment":
      return Element.Fragment({
        children: element.children.map((child) => wrapElementWithFiberRefs(child, wrapRun)),
      });
    case "Portal":
      return Element.Portal({
        target: element.target,
        children: mapChildInputElements(element.children, (child) =>
          wrapElementWithFiberRefs(child, wrapRun),
        ),
      });
    case "KeyedList":
      return Element.KeyedList({
        source: element.source,
        keyFn: element.keyFn,
        renderFn: (item, index) =>
          element
            .renderFn(item, index)
            .pipe(Effect.map((child) => wrapElementWithFiberRefs(child, wrapRun))),
      });
    case "ErrorBoundaryElement":
      if (typeof element.fallback === "function") {
        const fallback = element.fallback;
        return Element.ErrorBoundaryElement({
          child: wrapElementWithFiberRefs(element.child, wrapRun),
          fallback: (cause) => wrapElementWithFiberRefs(fallback(cause), wrapRun),
          onError: element.onError,
        });
      }

      return Element.ErrorBoundaryElement({
        child: wrapElementWithFiberRefs(element.child, wrapRun),
        fallback: wrapElementWithFiberRefs(element.fallback, wrapRun),
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
  ) => Effect.Effect<ElementType, unknown, never>;
  readonly renderLayout: (
    layout: RouteComponent,
    child: ElementType,
    params: Record<string, unknown>,
    query?: Record<string, unknown>,
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
export class OutletRenderer extends ServiceMap.Service<OutletRenderer, OutletRendererShape>()(
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
export class BoundaryResolver extends ServiceMap.Service<BoundaryResolver, BoundaryResolverShape>()(
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
export class AsyncLoader extends ServiceMap.Service<AsyncLoader, AsyncLoaderShape>()(
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
            Refreshing: ({ previous }) => previous,
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
      ): Effect.Effect<void> =>
        Effect.gen(function* () {
          // Dedup: skip if matchKey unchanged
          const currentKey = yield* Ref.get(matchKeyRef);
          if (Option.isSome(currentKey) && currentKey.value === matchKey) return;
          yield* Ref.set(matchKeyRef, Option.some(matchKey));

          // Interrupt previous load fiber
          const prevFiber = yield* Ref.get(currentFiberRef);
          yield* Option.match(prevFiber, {
            onNone: () => Effect.void,
            onSome: (fiber) =>
              Effect.gen(function* () {
                yield* Fiber.interrupt(fiber);
                yield* Ref.set(currentFiberRef, Option.none());
              }),
          });

          // Set loading/refreshing state
          const lastEl = yield* Ref.get(lastElementRef);
          yield* Option.match(lastEl, {
            onNone: () => Signal.set(state, AsyncLoadState.Loading()),
            onSome: (previous) => Signal.set(state, AsyncLoadState.Refreshing({ previous })),
          });

          // Fork the load effect
          const fiber = yield* Effect.forkIn(
            Effect.gen(function* () {
              const exit = yield* Effect.exit(loadEffect);
              if (Exit.isSuccess(exit)) {
                yield* Ref.set(lastElementRef, Option.some(exit.value));
                yield* Signal.set(state, AsyncLoadState.Ready({ element: exit.value }));
              } else {
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
        const capturedContext = yield* Effect.services<unknown>();
        const element = yield* effect;
        return provideElement(capturedContext, wrapElementWithFiberRefs(element, withRouteContext));
      }).pipe(unsafeEraseR),
      {
        identity: routeComponentWrapperIdentity,
        inputs: { params, query: decodedQuery, wrappedIdentity: component },
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
        const capturedContext = yield* Effect.services<unknown>();
        const element = yield* effect;
        return provideElement(
          capturedContext,
          wrapElementWithFiberRefs(element, withLayoutContext),
        );
      }).pipe(unsafeEraseR),
      {
        identity: routeLayoutWrapperIdentity,
        inputs: { child, params, query: decodedQuery, wrappedIdentity: layout },
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
            const capturedContext = yield* Effect.services<unknown>();
            const element = yield* effect;
            return provideElement(
              capturedContext,
              wrapElementWithFiberRefs(element, withErrorContext),
            );
          }).pipe(unsafeEraseR),
          {
            identity: routeErrorWrapperIdentity,
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
