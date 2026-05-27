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
import type { ScrollIntent } from "./navigation-outlet-coordination.js";
import type { RouteMatch, RouteMatcherShape } from "./matching.js";
import type { ComponentInput, RouteComponent } from "./types.js";
import { parsePath } from "./utils.js";

export interface RouteActivationRequest {
  readonly activationId: string;
  readonly path: string;
  readonly query: URLSearchParams;
  readonly scrollIntent: Option.Option<ScrollIntent>;
}

export type RouteActivationOutcome =
  | { readonly _tag: "Committed"; readonly activationId: string; readonly path: string }
  | { readonly _tag: "DroppedStale"; readonly activationId: string; readonly supersededBy: string }
  | { readonly _tag: "NotFound"; readonly activationId: string; readonly path: string };

export class RouteActivationError extends Data.TaggedError("RouteActivationError")<{
  readonly activationId: string;
  readonly path: string;
  readonly cause: unknown;
}> {}

export const RouteActivationConfigInput = Schema.Struct({
  emitTraceEvents: Schema.Boolean,
});

type RouteActivationConfig = typeof RouteActivationConfigInput.Type;

export interface RouteActivationShape {
  readonly activate: (
    request: RouteActivationRequest,
  ) => Effect.Effect<RouteActivationOutcome, RouteActivationError>;
  readonly commit: (
    request: Pick<RouteActivationRequest, "activationId" | "path">,
  ) => Effect.Effect<RouteActivationOutcome>;
  readonly currentActivationId: Effect.Effect<Option.Option<string>>;
  readonly waitForDomSwap: (activationId: string) => Effect.Effect<Deferred.Deferred<void>>;
  readonly showLoadingFallback: (
    request: Pick<RouteActivationRequest, "activationId" | "path">,
    show: Effect.Effect<void>,
  ) => Effect.Effect<RouteActivationOutcome>;
  readonly commitAfterDomSwap: (
    request: Pick<RouteActivationRequest, "activationId" | "path">,
    swap: Effect.Effect<void>,
    afterSwap: Effect.Effect<void>,
  ) => Effect.Effect<RouteActivationOutcome>;
}

export const makeRouteActivation = (
  input: RouteActivationConfig,
  matcher?: RouteMatcherShape,
): Effect.Effect<RouteActivationShape> =>
  Effect.gen(function* () {
    const config = RouteActivationConfigInput.make(input);
    const current = yield* SynchronizedRef.make<Option.Option<string>>(Option.none());

    const currentOrStale = (activationId: string, path: string): Effect.Effect<RouteActivationOutcome> =>
      Effect.gen(function* () {
        const latest = yield* SynchronizedRef.get(current);
        if (Option.isSome(latest) && latest.value !== activationId) {
          return { _tag: "DroppedStale", activationId, supersededBy: latest.value } as const;
        }
        return { _tag: "Committed", activationId, path } as const;
      });

    return {
      activate: Effect.fn("RouteActivation.activate")(function* (request) {
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
            return { _tag: "NotFound", activationId: request.activationId, path: request.path };
          }
        }
        void config;
        return { _tag: "Committed", activationId: request.activationId, path: request.path };
      }),
      commit: Effect.fn("RouteActivation.commit")(function* (request) {
        return yield* currentOrStale(request.activationId, request.path);
      }),
      currentActivationId: SynchronizedRef.get(current),
      waitForDomSwap: Effect.fn("RouteActivation.waitForDomSwap")(function* (_activationId) {
        return yield* Deferred.make<void>();
      }),
      showLoadingFallback: Effect.fn("RouteActivation.showLoadingFallback")(function* (
        request,
        show,
      ) {
        const outcome = yield* currentOrStale(request.activationId, request.path);
        if (outcome._tag === "DroppedStale") return outcome;
        yield* show;
        return outcome;
      }),
      commitAfterDomSwap: Effect.fn("RouteActivation.commitAfterDomSwap")(function* (
        request,
        swap,
        afterSwap,
      ) {
        const beforeSwap = yield* currentOrStale(request.activationId, request.path);
        if (beforeSwap._tag === "DroppedStale") return beforeSwap;
        yield* swap;
        const afterDomSwap = yield* currentOrStale(request.activationId, request.path);
        if (afterDomSwap._tag === "DroppedStale") return afterDomSwap;
        yield* afterSwap;
        return afterDomSwap;
      }),
    };
  });

export class RouteActivation extends Context.Service<RouteActivation, RouteActivationShape>()(
  "trygg/RouteActivation",
) {
  static readonly layer = (
    input: RouteActivationConfig,
    matcher?: RouteMatcherShape,
  ): Layer.Layer<RouteActivation> => Layer.effect(RouteActivation, makeRouteActivation(input, matcher));
}

export type RouteActivationRenderIntent =
  | { readonly _tag: "Leaf"; readonly component: ComponentInput }
  | { readonly _tag: "Loading"; readonly component: ComponentInput }
  | { readonly _tag: "ErrorBoundary"; readonly component: ComponentInput; readonly cause: unknown }
  | { readonly _tag: "NotFoundBoundary"; readonly component: ComponentInput }
  | { readonly _tag: "ForbiddenBoundary"; readonly component: ComponentInput }
  | { readonly _tag: "Redirect"; readonly location: string }
  | { readonly _tag: "NoBoundary"; readonly cause: unknown };

export class LazyRouteLoadError extends Data.TaggedError("LazyRouteLoadError")<{
  readonly activationId: string;
  readonly path: string;
  readonly cause: unknown;
}> {}

export class BoundaryResolutionError extends Data.TaggedError("BoundaryResolutionError")<{
  readonly activationId: string;
  readonly path: string;
  readonly reason: string;
}> {}

export const RouteActivationBoundaryConfigInput = Schema.Struct({
  interruptStaleLoads: Schema.Boolean,
});

type RouteActivationBoundaryConfig = typeof RouteActivationBoundaryConfigInput.Type;

export interface RouteActivationBoundaryDependencies {
  readonly matcher: RouteMatcherShape;
  readonly collectPrefetchTargets: (match: RouteMatch) => ReadonlyArray<ComponentInput>;
  readonly isComponentLoader: (component: ComponentInput) => boolean;
  readonly loadComponent: (component: ComponentInput) => Effect.Effect<RouteComponent, unknown>;
  readonly runRoutePrefetch: (path: string, match: RouteMatch, query: URLSearchParams) => Effect.Effect<void>;
  readonly resolveLoading: (match: RouteMatch) => Option.Option<ComponentInput>;
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
}

export const makeRouteActivationBoundary = (
  input: RouteActivationBoundaryConfig,
  dependencies: RouteActivationBoundaryDependencies,
): Effect.Effect<RouteActivationBoundaryShape> =>
  Effect.gen(function* () {
    const config = RouteActivationBoundaryConfigInput.make(input);

    const loadForActivation = Effect.fn("RouteActivationBoundary.loadComponent")(function* (
      request: RouteActivationRequest,
      component: ComponentInput,
    ) {
      const loaded = yield* dependencies.loadComponent(component).pipe(
        Effect.mapError(
          (cause) =>
            new LazyRouteLoadError({ activationId: request.activationId, path: request.path, cause }),
        ),
      );
      const stale = yield* dependencies.isStale(request.activationId);
      if (config.interruptStaleLoads && stale) {
        return yield* new LazyRouteLoadError({
          activationId: request.activationId,
          path: request.path,
          cause: "stale activation",
        });
      }
      return loaded;
    });

    return {
      resolve: Effect.fn("RouteActivationBoundary.resolve")(function* (request, match) {
        if (yield* dependencies.isStale(request.activationId)) {
          return yield* new BoundaryResolutionError({
            activationId: request.activationId,
            path: request.path,
            reason: "stale activation",
          });
        }
        const loading = dependencies.resolveLoading(match);
        const component = match.route.definition.component;
        if (
          Option.isSome(loading) &&
          component !== undefined &&
          dependencies.isComponentLoader(component)
        ) {
          return { _tag: "Loading", component: loading.value };
        }
        if (component !== undefined) {
          return { _tag: "Leaf", component };
        }
        return { _tag: "NoBoundary", cause: "route has no component" };
      }),
      prefetch: Effect.fn("RouteActivationBoundary.prefetch")(function* (path) {
        const parsed = yield* parsePath(path).pipe(Effect.orDie);
        const matchOption = yield* dependencies.matcher.match(parsed.path).pipe(Effect.orDie);
        if (Option.isNone(matchOption)) return;
        const match = matchOption.value;
        const targets = dependencies.collectPrefetchTargets(match);
        yield* Effect.forEach(
          targets.filter(dependencies.isComponentLoader),
          (component) => dependencies.loadComponent(component).pipe(Effect.ignore),
          { concurrency: "unbounded" },
        );
        yield* dependencies.runRoutePrefetch(path, match, parsed.query).pipe(Effect.ignore);
      }),
      loadComponent: loadForActivation,
    };
  });

export class RouteActivationBoundary extends Context.Service<
  RouteActivationBoundary,
  RouteActivationBoundaryShape
>()("trygg/RouteActivationBoundary") {
  static readonly layer = (
    input: RouteActivationBoundaryConfig,
    dependencies: RouteActivationBoundaryDependencies,
  ): Layer.Layer<RouteActivationBoundary> =>
    Layer.effect(RouteActivationBoundary, makeRouteActivationBoundary(input, dependencies));
}

export type RouteActivationMatch = RouteMatch;
