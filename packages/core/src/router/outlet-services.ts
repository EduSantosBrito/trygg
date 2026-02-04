/**
 * @since 1.0.0
 * Outlet Internal Services
 *
 * Testable services used internally by the Outlet. Each has a Context.Tag
 * with Layer factories for production and testing.
 */
import {
  Cause,
  Context,
  Data,
  Effect,
  Exit,
  Fiber,
  FiberRef,
  Layer,
  Option,
  Ref,
  Scope,
} from "effect";
import { type Element, componentElement } from "../primitives/element.js";
import * as Signal from "../primitives/signal.js";
import * as Component from "../primitives/component.js";
import * as Metrics from "../debug/metrics.js";
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

/**
 * Extract only string-valued entries from a decoded params object.
 * Route params are always strings (URL path segments).
 * @internal
 */
const toRouteParams = (decoded: Record<string, unknown>): RouteParams => {
  const result: Record<string, string> = {};
  for (const [key, value] of Object.entries(decoded)) {
    if (typeof value === "string") {
      result[key] = value;
    }
  }
  return result;
};

/**
 * Type guard to check if a RouteComponent is an Effect<Element>.
 * Used to narrow the union type after checking !Component.isEffectComponent().
 * @internal
 */
const isEffectElement = (u: RouteComponent): u is Effect.Effect<Element, unknown, unknown> =>
  Effect.isEffect(u);

// =============================================================================
// OutletRenderer Service
// =============================================================================

/** @since 1.0.0 */
export interface OutletRendererShape {
  readonly renderComponent: (
    component: RouteComponent,
    params: Record<string, unknown>,
    query?: Record<string, unknown>,
  ) => Effect.Effect<Element, unknown, never>;
  readonly renderLayout: (
    layout: RouteComponent,
    child: Element,
    params: Record<string, unknown>,
    query?: Record<string, unknown>,
  ) => Effect.Effect<Element, unknown, never>;
  readonly renderError: (
    errorComp: RouteComponent,
    cause: Cause.Cause<unknown>,
    path: string,
  ) => Effect.Effect<Element, InvalidRouteComponent, never>;
}

/**
 * OutletRenderer — component rendering with params/query injection.
 * @since 1.0.0
 */
export class OutletRenderer extends Context.Tag("trygg/OutletRenderer")<
  OutletRenderer,
  OutletRendererShape
>() {
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
  readonly resolveLoading: (route: ResolvedRoute) => Option.Option<ComponentInput>;
  readonly resolveNotFound: (route: ResolvedRoute) => Option.Option<ComponentInput>;
  readonly resolveNotFoundRoot: () => Option.Option<ComponentInput>;
  readonly resolveForbidden: (route: ResolvedRoute) => Option.Option<ComponentInput>;
}

/**
 * BoundaryResolver — nearest-wins boundary resolution.
 * @since 1.0.0
 */
export class BoundaryResolver extends Context.Tag("trygg/BoundaryResolver")<
  BoundaryResolver,
  BoundaryResolverShape
>() {
  static readonly make = (manifest: RoutesManifest): BoundaryResolverShape => ({
    resolveError: (route) => resolveErrorBoundary(route, undefined),
    resolveLoading: (route) => resolveLoadingBoundary(route),
    resolveNotFound: (route) => resolveNotFoundBoundary(route, manifest.notFound),
    resolveNotFoundRoot: () => Option.fromNullable(manifest.notFound),
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
export class AsyncLoader extends Context.Tag("trygg/AsyncLoader")<AsyncLoader, AsyncLoaderShape>() {
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
      const currentFiberRef = yield* Ref.make<Option.Option<Fiber.RuntimeFiber<void, never>>>(
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

      return { view, track } satisfies AsyncLoaderShape;
    });

  /** Passthrough AsyncLoader for testing (no async tracking, immediate render). */
  static readonly test = (fallbackElement: Element): AsyncLoaderShape => {
    // In test mode, track just resolves the effect synchronously and stores the result
    let lastElement: Element = fallbackElement;
    const viewSignal = Signal.unsafeMake(fallbackElement);

    return {
      view: viewSignal,
      track: (_, loadEffect) =>
        Effect.gen(function* () {
          const exit = yield* Effect.exit(loadEffect);
          if (Exit.isSuccess(exit)) {
            lastElement = exit.value;
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
function renderComponent(
  component: RouteComponent,
  decodedParams: Record<string, unknown>,
  decodedQuery: Record<string, unknown> = {},
): Effect.Effect<Element, unknown, never> {
  const params = toRouteParams(decodedParams);

  // RouteComponent can be Component.Type or Effect<Element>
  if (Component.isEffectComponent(component)) {
    const element = component({});
    if (element._tag === "Component") {
      const originalRun = element.run;
      return Effect.succeed(
        componentElement(() =>
          originalRun().pipe(
            Effect.locally(CurrentRouteParams, params),
            Effect.locally(CurrentRouteQuery, decodedQuery),
          ),
        ),
      );
    }
    return Effect.succeed(element);
  }

  // Component is an Effect<Element> - wrap it
  if (isEffectElement(component)) {
    return Effect.succeed(
      componentElement(() =>
        component.pipe(
          Effect.locally(CurrentRouteParams, params),
          Effect.locally(CurrentRouteQuery, decodedQuery),
        ),
      ),
    );
  }

  // Should never reach here if RouteComponent type is correct
  return new InvalidRouteComponent({ actual: component });
}

/**
 * Render a layout component wrapping child content.
 * @internal
 */
function renderLayout(
  layout: RouteComponent,
  child: Element,
  decodedParams: Record<string, unknown>,
  decodedQuery: Record<string, unknown> = {},
): Effect.Effect<Element, unknown, never> {
  const params = toRouteParams(decodedParams);

  // RouteComponent can be Component.Type or Effect<Element>
  if (Component.isEffectComponent(layout)) {
    const element = layout({});
    if (element._tag === "Component") {
      const originalRun = element.run;
      return Effect.succeed(
        componentElement(() =>
          Effect.gen(function* () {
            yield* FiberRef.set(CurrentOutletChild, Option.some(child));
            return yield* originalRun().pipe(
              Effect.locally(CurrentRouteParams, params),
              Effect.locally(CurrentRouteQuery, decodedQuery),
            );
          }),
        ),
      );
    }
    return Effect.succeed(element);
  }

  // Layout is an Effect<Element> - wrap it
  if (isEffectElement(layout)) {
    return Effect.succeed(
      componentElement(() =>
        Effect.gen(function* () {
          yield* FiberRef.set(CurrentOutletChild, Option.some(child));
          return yield* layout.pipe(
            Effect.locally(CurrentRouteParams, params),
            Effect.locally(CurrentRouteQuery, decodedQuery),
          );
        }),
      ),
    );
  }

  // Should never reach here if RouteComponent type is correct
  return new InvalidRouteComponent({ actual: layout });
}

/**
 * Render an error boundary component with RouteErrorInfo.
 * @internal
 */
function renderError(
  errorComp: RouteComponent,
  cause: Cause.Cause<unknown>,
  path: string,
): Effect.Effect<Element, InvalidRouteComponent, never> {
  return Effect.gen(function* () {
    yield* Metrics.recordRouteError;

    const resetSignal = yield* Signal.make(0);

    const errorInfo: RouteErrorInfo = {
      cause,
      path,
      reset: Signal.update(resetSignal, (n) => n + 1),
    };

    // RouteComponent can be Component.Type or Effect<Element>
    if (Component.isEffectComponent(errorComp)) {
      const element = errorComp({});
      if (element._tag === "Component") {
        const originalRun = element.run;
        return componentElement(() =>
          originalRun().pipe(Effect.locally(CurrentRouteError, Option.some(errorInfo))),
        );
      }
      return element;
    }

    // Error component is an Effect<Element> - wrap it
    if (isEffectElement(errorComp)) {
      return componentElement(() =>
        errorComp.pipe(Effect.locally(CurrentRouteError, Option.some(errorInfo))),
      );
    }

    // Should never reach here if RouteComponent type is correct
    return yield* new InvalidRouteComponent({ actual: errorComp });
  });
}
