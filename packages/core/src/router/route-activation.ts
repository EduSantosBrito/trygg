/**
 * Current-route activation coordination for Outlet.
 *
 * @remarks
 * RouteActivation owns latest-activation identity and stale commit suppression.
 * Outlet remains responsible for rendering elements and DOM replacement, while
 * this seam decides whether a route activation is still current before visible
 * UI may commit.
 *
 * @since 1.0.0
 * @module trygg/router/route-activation
 */
import { Data, Deferred, Effect, Layer, Option, Schema, Scope, SynchronizedRef } from "effect";
import * as Context from "effect/Context";
import * as ContractTrace from "../contract/trace.js";
import type { ScrollIntent } from "./navigation-outlet-coordination.js";
import type { RouteMatch, RouteMatcherShape } from "./matching.js";
import type { MiddlewareResult } from "./route.js";
import type { ComponentInput, RouteComponent } from "./types.js";
import { parsePath } from "./utils.js";

export interface RouteActivationRequest {
  readonly activationId: string;
  readonly path: string;
  readonly query: URLSearchParams;
  readonly scrollIntent: Option.Option<ScrollIntent>;
}

export type RouteActivationOutcome = Data.TaggedEnum<{
  readonly Committed: {
    readonly activationId: string;
    readonly path: string;
    readonly match: Option.Option<RouteMatch>;
  };
  readonly DroppedStale: { readonly activationId: string; readonly supersededBy: string };
  readonly NotFound: { readonly activationId: string; readonly path: string };
}>;

export const RouteActivationOutcome = Data.taggedEnum<RouteActivationOutcome>();

export class RouteActivationError extends Schema.TaggedErrorClass<RouteActivationError>()(
  "RouteActivationError",
  {
    activationId: Schema.String,
    path: Schema.String,
    cause: Schema.Unknown,
  },
) {}

export const RouteActivationConfigInput = Schema.Struct({
  emitTraceEvents: Schema.Boolean,
});

type RouteActivationConfig = typeof RouteActivationConfigInput.Type;

const activationPayload = (request: Pick<RouteActivationRequest, "activationId" | "path">) => ({
  activationId: request.activationId,
  path: request.path,
});

const emitActivationTrace = (
  enabled: boolean,
  event: ContractTrace.ContractTraceEventName,
  payload: Record<string, unknown>,
): Effect.Effect<void> =>
  enabled ? ContractTrace.emit({ event, level: "semantic", payload }) : Effect.void;

const emitBoundaryTrace = (
  event: ContractTrace.ContractTraceEventName,
  payload: Record<string, unknown>,
): Effect.Effect<void> => ContractTrace.emit({ event, level: "semantic", payload });

type ContinueIntent = Data.TaggedEnum<{
  readonly Continue: {};
}>;

const ContinueIntent = Data.taggedEnum<ContinueIntent>();

type BoundaryOutcome = RouteActivationRenderIntent | ContinueIntent;

const boundaryOutcomePayload = (
  request: Pick<RouteActivationRequest, "activationId" | "path">,
  outcome: BoundaryOutcome,
  phase: string,
): Record<string, unknown> => ({
  ...activationPayload(request),
  phase,
  outcome: outcome._tag,
});

export interface RouteActivationShape {
  readonly activate: (
    request: RouteActivationRequest,
  ) => Effect.Effect<RouteActivationOutcome, RouteActivationError>;
  readonly commit: (
    request: Pick<RouteActivationRequest, "activationId" | "path">,
  ) => Effect.Effect<RouteActivationOutcome>;
  readonly currentActivationId: Effect.Effect<Option.Option<string>>;
  readonly waitForDomSwap: (activationId: string) => Effect.Effect<Deferred.Deferred<void>>;
  readonly showLoadingFallback: <E, R>(
    request: Pick<RouteActivationRequest, "activationId" | "path">,
    show: Effect.Effect<void, E, R>,
  ) => Effect.Effect<RouteActivationOutcome, E, R>;
  readonly commitAfterDomSwap: <ESwap, RSwap, EAfter, RAfter>(
    request: Pick<RouteActivationRequest, "activationId" | "path">,
    swap: Effect.Effect<void, ESwap, RSwap>,
    afterSwap: Effect.Effect<unknown, EAfter, RAfter>,
  ) => Effect.Effect<RouteActivationOutcome, ESwap | EAfter, RSwap | RAfter>;
}

export const makeRouteActivation: (
  input: RouteActivationConfig,
  matcher?: RouteMatcherShape,
) => Effect.Effect<RouteActivationShape> = Effect.fn("RouteActivation.make")(function* (
  input: RouteActivationConfig,
  matcher?: RouteMatcherShape,
) {
  const config = RouteActivationConfigInput.make(input);
  const current = yield* SynchronizedRef.make<Option.Option<string>>(Option.none());

  const currentOrStale = Effect.fn("RouteActivation.currentOrStale")(function* (
    activationId: string,
    path: string,
  ) {
    const latest = yield* SynchronizedRef.get(current);
    if (Option.isSome(latest) && latest.value !== activationId) {
      const outcome = RouteActivationOutcome.DroppedStale({
        activationId,
        supersededBy: latest.value,
      });
      yield* emitActivationTrace(config.emitTraceEvents, "outlet.process.dropStale", {
        activationId,
        path,
        supersededBy: latest.value,
      });
      return outcome;
    }
    return RouteActivationOutcome.Committed({
      activationId,
      path,
      match: Option.none<RouteMatch>(),
    });
  });

  return {
    activate: Effect.fn("RouteActivation.activate")(function* (request) {
      yield* emitActivationTrace(config.emitTraceEvents, "outlet.process.start", {
        ...activationPayload(request),
        query: request.query.toString(),
        hasScrollIntent: Option.isSome(request.scrollIntent),
      });
      yield* SynchronizedRef.set(current, Option.some(request.activationId));
      if (matcher !== undefined) {
        const match = yield* matcher.match(request.path).pipe(
          Effect.mapError(
            (cause) =>
              new RouteActivationError({
                activationId: request.activationId,
                path: request.path,
                cause,
              }),
          ),
        );
        if (Option.isNone(match)) {
          yield* emitActivationTrace(config.emitTraceEvents, "outlet.match.notFound", {
            ...activationPayload(request),
          });
          return RouteActivationOutcome.NotFound({
            activationId: request.activationId,
            path: request.path,
          });
        }
        yield* emitActivationTrace(config.emitTraceEvents, "outlet.match.found", {
          ...activationPayload(request),
          routePattern: match.value.route.path,
        });
        return RouteActivationOutcome.Committed({
          activationId: request.activationId,
          path: request.path,
          match,
        });
      }
      return RouteActivationOutcome.Committed({
        activationId: request.activationId,
        path: request.path,
        match: Option.none<RouteMatch>(),
      });
    }),
    commit: Effect.fn("RouteActivation.commit")(function* (request) {
      const outcome = yield* currentOrStale(request.activationId, request.path);
      if (RouteActivationOutcome.$is("Committed")(outcome)) {
        yield* emitActivationTrace(config.emitTraceEvents, "outlet.process.commit", {
          ...activationPayload(request),
        });
      }
      return outcome;
    }),
    currentActivationId: SynchronizedRef.get(current),
    waitForDomSwap: Effect.fn("RouteActivation.waitForDomSwap")(function* (_activationId) {
      return yield* Deferred.make<void>();
    }),
    showLoadingFallback: Effect.fn("RouteActivation.showLoadingFallback")(function* <E, R>(
      request: Pick<RouteActivationRequest, "activationId" | "path">,
      show: Effect.Effect<void, E, R>,
    ) {
      const outcome = yield* currentOrStale(request.activationId, request.path);
      if (RouteActivationOutcome.$is("DroppedStale")(outcome)) return outcome;
      yield* show;
      yield* emitActivationTrace(config.emitTraceEvents, "outlet.process.commit", {
        ...activationPayload(request),
        state: "Loading",
      });
      return outcome;
    }),
    commitAfterDomSwap: Effect.fn("RouteActivation.commitAfterDomSwap")(function* <
      ESwap,
      RSwap,
      EAfter,
      RAfter,
    >(
      request: Pick<RouteActivationRequest, "activationId" | "path">,
      swap: Effect.Effect<void, ESwap, RSwap>,
      afterSwap: Effect.Effect<unknown, EAfter, RAfter>,
    ) {
      const beforeSwap = yield* currentOrStale(request.activationId, request.path);
      if (RouteActivationOutcome.$is("DroppedStale")(beforeSwap)) return beforeSwap;
      yield* swap;
      const afterDomSwap = yield* currentOrStale(request.activationId, request.path);
      if (RouteActivationOutcome.$is("DroppedStale")(afterDomSwap)) return afterDomSwap;
      const scrollPayload = yield* afterSwap;
      yield* emitActivationTrace(config.emitTraceEvents, "scroll.apply", {
        ...activationPayload(request),
        ...(typeof scrollPayload === "object" && scrollPayload !== null ? scrollPayload : {}),
      });
      yield* emitActivationTrace(config.emitTraceEvents, "outlet.process.commit", {
        ...activationPayload(request),
      });
      return afterDomSwap;
    }),
  };
});

export class RouteActivation extends Context.Service<
  RouteActivation,
  {
    readonly activate: (
      request: RouteActivationRequest,
    ) => Effect.Effect<RouteActivationOutcome, RouteActivationError>;
    readonly commit: (
      request: Pick<RouteActivationRequest, "activationId" | "path">,
    ) => Effect.Effect<RouteActivationOutcome>;
    readonly currentActivationId: Effect.Effect<Option.Option<string>>;
    readonly waitForDomSwap: (activationId: string) => Effect.Effect<Deferred.Deferred<void>>;
    readonly showLoadingFallback: <E, R>(
      request: Pick<RouteActivationRequest, "activationId" | "path">,
      show: Effect.Effect<void, E, R>,
    ) => Effect.Effect<RouteActivationOutcome, E, R>;
    readonly commitAfterDomSwap: <ESwap, RSwap, EAfter, RAfter>(
      request: Pick<RouteActivationRequest, "activationId" | "path">,
      swap: Effect.Effect<void, ESwap, RSwap>,
      afterSwap: Effect.Effect<unknown, EAfter, RAfter>,
    ) => Effect.Effect<RouteActivationOutcome, ESwap | EAfter, RSwap | RAfter>;
  }
>()("trygg/RouteActivation") {
  static readonly layer = (
    input: RouteActivationConfig,
    matcher?: RouteMatcherShape,
  ): Layer.Layer<RouteActivation> =>
    Layer.effect(RouteActivation, makeRouteActivation(input, matcher));
}

export type RouteActivationRenderIntent = Data.TaggedEnum<{
  readonly Leaf: { readonly component: ComponentInput };
  readonly Loading: { readonly component: ComponentInput };
  readonly ErrorBoundary: { readonly component: ComponentInput; readonly cause: unknown };
  readonly NotFoundBoundary: { readonly component: ComponentInput };
  readonly ForbiddenBoundary: { readonly component: ComponentInput };
  readonly Redirect: { readonly location: string; readonly replace?: boolean };
  readonly NoBoundary: { readonly cause: unknown };
}>;

export const RouteActivationRenderIntent = Data.taggedEnum<RouteActivationRenderIntent>();

export class LazyRouteLoadError extends Schema.TaggedErrorClass<LazyRouteLoadError>()(
  "LazyRouteLoadError",
  {
    activationId: Schema.String,
    path: Schema.String,
    cause: Schema.Unknown,
  },
) {}

export class BoundaryResolutionError extends Schema.TaggedErrorClass<BoundaryResolutionError>()(
  "BoundaryResolutionError",
  {
    activationId: Schema.String,
    path: Schema.String,
    reason: Schema.String,
  },
) {}

export const RouteActivationBoundaryConfigInput = Schema.Struct({
  interruptStaleLoads: Schema.Boolean,
});

type RouteActivationBoundaryConfig = typeof RouteActivationBoundaryConfigInput.Type;

export interface RouteActivationBoundaryDependencies {
  readonly matcher: RouteMatcherShape;
  readonly collectPrefetchTargets: (match: RouteMatch) => ReadonlyArray<ComponentInput>;
  readonly isComponentLoader: (component: ComponentInput) => boolean;
  readonly loadComponent: (component: ComponentInput) => Effect.Effect<RouteComponent, unknown>;
  readonly runRoutePrefetch: (
    path: string,
    match: RouteMatch,
    query: URLSearchParams,
  ) => Effect.Effect<void>;
  readonly resolveLoading: (match: RouteMatch) => Option.Option<ComponentInput>;
  readonly resolveError: (match: RouteMatch, cause: unknown) => Option.Option<ComponentInput>;
  readonly resolveNotFound: (path: string) => Option.Option<ComponentInput>;
  readonly resolveForbidden: (match: RouteMatch) => Option.Option<ComponentInput>;
  readonly runMiddleware: (match: RouteMatch) => Effect.Effect<MiddlewareResult>;
  readonly isStale: (activationId: string) => Effect.Effect<boolean>;
}

export interface RouteActivationBoundaryShape {
  readonly resolve: (
    request: RouteActivationRequest,
    match: RouteMatch,
  ) => Effect.Effect<
    RouteActivationRenderIntent,
    LazyRouteLoadError | BoundaryResolutionError,
    Scope.Scope
  >;
  readonly prefetch: (path: string) => Effect.Effect<void>;
  readonly loadComponent: (
    request: RouteActivationRequest,
    component: ComponentInput,
  ) => Effect.Effect<RouteComponent, LazyRouteLoadError>;
  readonly resolveErrorBoundary: (
    request: RouteActivationRequest,
    match: RouteMatch,
    cause: unknown,
  ) => Effect.Effect<RouteActivationRenderIntent, BoundaryResolutionError>;
  readonly resolveNotFoundBoundary: (
    request: RouteActivationRequest,
  ) => Effect.Effect<RouteActivationRenderIntent, BoundaryResolutionError>;
  readonly resolveForbiddenBoundary: (
    request: RouteActivationRequest,
    match: RouteMatch,
  ) => Effect.Effect<RouteActivationRenderIntent, BoundaryResolutionError>;
  readonly resolveMiddleware: (
    request: RouteActivationRequest,
    match: RouteMatch,
  ) => Effect.Effect<BoundaryOutcome, BoundaryResolutionError>;
}

export const makeRouteActivationBoundary: (
  input: RouteActivationBoundaryConfig,
  dependencies: RouteActivationBoundaryDependencies,
) => Effect.Effect<RouteActivationBoundaryShape> = Effect.fn("RouteActivationBoundary.make")(
  function* (
    input: RouteActivationBoundaryConfig,
    dependencies: RouteActivationBoundaryDependencies,
  ) {
    const config = RouteActivationBoundaryConfigInput.make(input);

    const staleBoundaryError = (request: RouteActivationRequest) =>
      new BoundaryResolutionError({
        activationId: request.activationId,
        path: request.path,
        reason: "stale activation",
      });

    const noBoundary = (cause: unknown) => RouteActivationRenderIntent.NoBoundary({ cause });

    const loadForActivation = Effect.fn("RouteActivationBoundary.loadComponent")(function* (
      request: RouteActivationRequest,
      component: ComponentInput,
    ) {
      yield* emitBoundaryTrace("outlet.lazyLeaf.load.start", activationPayload(request));
      const loaded = yield* dependencies.loadComponent(component).pipe(
        Effect.tapError((cause) =>
          emitBoundaryTrace("outlet.lazyLeaf.load.error", {
            ...activationPayload(request),
            cause,
          }),
        ),
        Effect.mapError(
          (cause) =>
            new LazyRouteLoadError({
              activationId: request.activationId,
              path: request.path,
              cause,
            }),
        ),
      );
      const stale = yield* dependencies.isStale(request.activationId);
      if (config.interruptStaleLoads && stale) {
        yield* emitBoundaryTrace("outlet.lazyLeaf.load.error", {
          ...activationPayload(request),
          cause: "stale activation",
        });
        return yield* new LazyRouteLoadError({
          activationId: request.activationId,
          path: request.path,
          cause: "stale activation",
        });
      }
      yield* emitBoundaryTrace("outlet.lazyLeaf.load.ready", activationPayload(request));
      return loaded;
    });

    return {
      resolve: Effect.fn("RouteActivationBoundary.resolve")(function* (request, match) {
        if (yield* dependencies.isStale(request.activationId)) {
          return yield* staleBoundaryError(request);
        }
        const loading = dependencies.resolveLoading(match);
        const component = match.route.definition.component;
        if (
          Option.isSome(loading) &&
          component !== undefined &&
          dependencies.isComponentLoader(component)
        ) {
          const outcome = RouteActivationRenderIntent.Loading({ component: loading.value });
          yield* emitBoundaryTrace(
            "outlet.boundary.resolve",
            boundaryOutcomePayload(request, outcome, "render"),
          );
          return outcome;
        }
        if (component !== undefined) {
          const outcome = RouteActivationRenderIntent.Leaf({ component });
          yield* emitBoundaryTrace(
            "outlet.boundary.resolve",
            boundaryOutcomePayload(request, outcome, "render"),
          );
          return outcome;
        }
        const outcome = RouteActivationRenderIntent.NoBoundary({ cause: "route has no component" });
        yield* emitBoundaryTrace(
          "outlet.boundary.resolve",
          boundaryOutcomePayload(request, outcome, "render"),
        );
        return outcome;
      }),
      prefetch: Effect.fn("RouteActivationBoundary.prefetch")(function* (path) {
        const parsed = yield* parsePath(path);
        const matchOption = yield* dependencies.matcher.match(parsed.path);
        if (Option.isNone(matchOption)) return;
        const match = matchOption.value;
        const targets = dependencies.collectPrefetchTargets(match);
        yield* Effect.forEach(
          targets.filter(dependencies.isComponentLoader),
          (component) =>
            dependencies
              .loadComponent(component)
              .pipe(
                Effect.catch((cause: unknown) =>
                  emitBoundaryTrace("outlet.lazyLeaf.load.error", { path, cause }),
                ),
              ),
          { concurrency: "unbounded" },
        );
        yield* dependencies.runRoutePrefetch(path, match, parsed.query);
      }),
      loadComponent: loadForActivation,
      resolveErrorBoundary: Effect.fn("RouteActivationBoundary.resolveErrorBoundary")(
        function* (request, match, cause) {
          if (yield* dependencies.isStale(request.activationId))
            return yield* staleBoundaryError(request);
          const component = dependencies.resolveError(match, cause);
          const outcome = Option.isSome(component)
            ? RouteActivationRenderIntent.ErrorBoundary({ component: component.value, cause })
            : noBoundary(cause);
          yield* emitBoundaryTrace(
            "outlet.boundary.resolve",
            boundaryOutcomePayload(request, outcome, "error"),
          );
          return outcome;
        },
      ),
      resolveNotFoundBoundary: Effect.fn("RouteActivationBoundary.resolveNotFoundBoundary")(
        function* (request) {
          if (yield* dependencies.isStale(request.activationId))
            return yield* staleBoundaryError(request);
          const component = dependencies.resolveNotFound(request.path);
          const outcome = Option.isSome(component)
            ? RouteActivationRenderIntent.NotFoundBoundary({ component: component.value })
            : noBoundary("not found");
          yield* emitBoundaryTrace(
            "outlet.boundary.resolve",
            boundaryOutcomePayload(request, outcome, "notFound"),
          );
          return outcome;
        },
      ),
      resolveForbiddenBoundary: Effect.fn("RouteActivationBoundary.resolveForbiddenBoundary")(
        function* (request, match) {
          if (yield* dependencies.isStale(request.activationId))
            return yield* staleBoundaryError(request);
          const component = dependencies.resolveForbidden(match);
          const outcome = Option.isSome(component)
            ? RouteActivationRenderIntent.ForbiddenBoundary({ component: component.value })
            : noBoundary("forbidden");
          yield* emitBoundaryTrace(
            "outlet.boundary.resolve",
            boundaryOutcomePayload(request, outcome, "forbidden"),
          );
          return outcome;
        },
      ),
      resolveMiddleware: Effect.fn("RouteActivationBoundary.resolveMiddleware")(
        function* (request, match) {
          if (yield* dependencies.isStale(request.activationId))
            return yield* staleBoundaryError(request);
          const result = yield* dependencies.runMiddleware(match);
          let outcome: BoundaryOutcome;
          switch (result._tag) {
            case "Continue":
              outcome = ContinueIntent.Continue();
              break;
            case "Redirect":
              outcome = RouteActivationRenderIntent.Redirect({
                location: result.path,
                replace: result.replace,
              });
              break;
            case "Forbidden": {
              const component = dependencies.resolveForbidden(match);
              outcome = Option.isSome(component)
                ? RouteActivationRenderIntent.ForbiddenBoundary({ component: component.value })
                : noBoundary("forbidden");
              break;
            }
            case "Error": {
              const component = dependencies.resolveError(match, result.cause);
              outcome = Option.isSome(component)
                ? RouteActivationRenderIntent.ErrorBoundary({
                    component: component.value,
                    cause: result.cause,
                  })
                : noBoundary(result.cause);
              break;
            }
          }
          yield* emitBoundaryTrace(
            "outlet.boundary.resolve",
            boundaryOutcomePayload(request, outcome, "middleware"),
          );
          return outcome;
        },
      ),
    };
  },
);

export class RouteActivationBoundary extends Context.Service<
  RouteActivationBoundary,
  {
    readonly resolve: (
      request: RouteActivationRequest,
      match: RouteMatch,
    ) => Effect.Effect<
      RouteActivationRenderIntent,
      LazyRouteLoadError | BoundaryResolutionError,
      Scope.Scope
    >;
    readonly prefetch: (path: string) => Effect.Effect<void>;
    readonly loadComponent: (
      request: RouteActivationRequest,
      component: ComponentInput,
    ) => Effect.Effect<RouteComponent, LazyRouteLoadError>;
    readonly resolveErrorBoundary: (
      request: RouteActivationRequest,
      match: RouteMatch,
      cause: unknown,
    ) => Effect.Effect<RouteActivationRenderIntent, BoundaryResolutionError>;
    readonly resolveNotFoundBoundary: (
      request: RouteActivationRequest,
    ) => Effect.Effect<RouteActivationRenderIntent, BoundaryResolutionError>;
    readonly resolveForbiddenBoundary: (
      request: RouteActivationRequest,
      match: RouteMatch,
    ) => Effect.Effect<RouteActivationRenderIntent, BoundaryResolutionError>;
    readonly resolveMiddleware: (
      request: RouteActivationRequest,
      match: RouteMatch,
    ) => Effect.Effect<BoundaryOutcome, BoundaryResolutionError>;
  }
>()("trygg/RouteActivationBoundary") {
  static readonly layer = (
    input: RouteActivationBoundaryConfig,
    dependencies: RouteActivationBoundaryDependencies,
  ): Layer.Layer<RouteActivationBoundary> =>
    Layer.effect(RouteActivationBoundary, makeRouteActivationBoundary(input, dependencies));
}

export type RouteActivationMatch = RouteMatch;
