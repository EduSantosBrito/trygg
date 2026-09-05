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
import { Cause, Data, Deferred, Effect, Option, Ref, Schema, Scope, Semaphore } from "effect";
import * as Trace from "../trace/index.js";
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

export class RouteActivationError extends Schema.TaggedError<RouteActivationError>()(
  "RouteActivationError",
  {
    activationId: Schema.String,
    path: Schema.String,
    cause: Schema.Unknown,
  },
) {}

/** Activation IDs are single-use for the lifetime of an Outlet. */
export class DuplicateRouteActivationId extends Schema.TaggedError<DuplicateRouteActivationId>()(
  "DuplicateRouteActivationId",
  {
    activationId: Schema.String,
    path: Schema.String,
  },
) {}

const activationPayload = (request: Pick<RouteActivationRequest, "activationId" | "path">) => ({
  activationId: request.activationId,
  path: request.path,
});

type ContinueIntent = Data.TaggedEnum<{
  readonly Continue: {};
}>;

const ContinueIntent = Data.taggedEnum<ContinueIntent>();

type BoundaryOutcome = RouteActivationRenderIntent | ContinueIntent;

const boundaryOutcomePayload = (
  request: Pick<RouteActivationRequest, "activationId" | "path">,
  outcome: BoundaryOutcome,
  phase: string,
): Trace.TraceEventPayload<"outlet.boundary.resolve"> => ({
  ...activationPayload(request),
  phase,
  outcome: outcome._tag,
});

export interface RouteActivationShape<ClaimError = DuplicateRouteActivationId> {
  readonly claim: (request: RouteActivationRequest) => Effect.Effect<void, ClaimError>;
  readonly awaitSuperseded: (activationId: string) => Effect.Effect<void>;
  readonly runWhileCurrent: <A, E, R>(
    activationId: string,
    effect: Effect.Effect<A, E, R>,
  ) => Effect.Effect<A, E, R>;
  readonly activate: (
    request: RouteActivationRequest,
  ) => Effect.Effect<RouteActivationOutcome, RouteActivationError | ClaimError>;
  readonly commit: (
    request: Pick<RouteActivationRequest, "activationId" | "path">,
  ) => Effect.Effect<RouteActivationOutcome>;
  readonly currentActivationId: Effect.Effect<Option.Option<string>>;
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

type ClaimIdentity<E> = (request: RouteActivationRequest) => Effect.Effect<void, E>;

// Each admission function is allocated inside makeService and invoked under its lock.
const makeOpaqueClaims = (): ClaimIdentity<DuplicateRouteActivationId> => {
  const claimed = new Set<string>();
  return Effect.fnUntraced(function* (request: RouteActivationRequest) {
    if (claimed.has(request.activationId))
      return yield* new DuplicateRouteActivationId({
        activationId: request.activationId,
        path: request.path,
      });
    claimed.add(request.activationId);
  });
};

const makeNavigationClaims = (): ClaimIdentity<
  DuplicateRouteActivationId | RouteActivationError
> => {
  let latest = -1;
  return Effect.fnUntraced(function* (request: RouteActivationRequest) {
    const navigationId = Option.match(request.scrollIntent, {
      onNone: () => 0,
      onSome: (intent) => intent.navigationId,
    });
    if (
      !Number.isSafeInteger(navigationId) ||
      navigationId < 0 ||
      request.activationId !== `navigation-${navigationId}`
    ) {
      return yield* new RouteActivationError({
        activationId: request.activationId,
        path: request.path,
        cause: "Invalid navigation activation identity",
      });
    }
    if (navigationId < latest) return yield* Effect.interrupt;
    if (navigationId === latest)
      return yield* new DuplicateRouteActivationId({
        activationId: request.activationId,
        path: request.path,
      });
    latest = navigationId;
  });
};

const makeService = Effect.fn("RouteActivation.make")(function* <ClaimError>(
  matcher: RouteMatcherShape | undefined,
  makeClaims: () => ClaimIdentity<ClaimError>,
): Effect.fn.Return<RouteActivationShape<ClaimError>> {
  interface ActivationToken {
    readonly activationId: string;
    readonly superseded: Deferred.Deferred<void>;
    readonly quiescent: Deferred.Deferred<void>;
    readonly predecessor: Option.Option<Deferred.Deferred<void>>;
    activeCount: number;
    isSuperseded: boolean;
  }

  const current = yield* Ref.make<Option.Option<ActivationToken>>(Option.none());
  const ownershipLock = Semaphore.makeUnsafe(1);
  const claimIdentity = makeClaims();

  const claim = Effect.fn("RouteActivation.claim")(function* (request: RouteActivationRequest) {
    const superseded = yield* Deferred.make<void>();
    const quiescent = yield* Deferred.make<void>();
    const claimed = yield* ownershipLock.withPermits(1)(
      Effect.gen(function* () {
        yield* claimIdentity(request);
        const latest = yield* Ref.get(current);
        const hadActiveWork = Option.isSome(latest) && latest.value.activeCount > 0;
        const predecessor = Option.flatMap(latest, (token) =>
          hadActiveWork ? Option.some(token.quiescent) : token.predecessor,
        );
        const candidate: ActivationToken = {
          activationId: request.activationId,
          superseded,
          quiescent,
          predecessor,
          activeCount: 0,
          isSuperseded: false,
        };
        if (Option.isSome(latest)) latest.value.isSuperseded = true;
        yield* Ref.set(current, Option.some(candidate));
        return { previous: latest, hadActiveWork };
      }),
    );
    if (Option.isSome(claimed.previous)) {
      yield* Deferred.succeed(claimed.previous.value.superseded, undefined).pipe(Effect.asVoid);
      if (!claimed.hadActiveWork) {
        yield* Deferred.succeed(claimed.previous.value.quiescent, undefined).pipe(Effect.asVoid);
      }
    }
  });

  const awaitSuperseded = Effect.fn("RouteActivation.awaitSuperseded")(function* (
    activationId: string,
  ) {
    const latest = yield* Ref.get(current);
    if (Option.isNone(latest) || latest.value.activationId !== activationId) return;
    yield* Deferred.await(latest.value.superseded);
  });

  const runOwned: <A, E, R>(
    activationId: string,
    effect: Effect.Effect<A, E, R>,
    awaitPredecessor: boolean,
  ) => Effect.Effect<A, E, R> = Effect.fnUntraced(function* <A, E, R>(
    activationId: string,
    effect: Effect.Effect<A, E, R>,
    awaitPredecessor: boolean,
  ) {
    const token = yield* ownershipLock.withPermits(1)(
      Effect.gen(function* () {
        const latest = yield* Ref.get(current);
        if (
          Option.isNone(latest) ||
          latest.value.activationId !== activationId ||
          latest.value.isSuperseded
        ) {
          return Option.none<ActivationToken>();
        }
        latest.value.activeCount++;
        return latest;
      }),
    );
    if (Option.isNone(token)) return yield* Effect.interrupt;

    const owned = token.value;
    const interruptWhenSuperseded = Deferred.await(owned.superseded).pipe(
      Effect.flatMap(() => Effect.interrupt),
    );
    const release = Effect.gen(function* () {
      const complete = yield* ownershipLock.withPermits(1)(
        Effect.sync(() => {
          owned.activeCount--;
          return owned.isSuperseded && owned.activeCount === 0;
        }),
      );
      if (!complete) return;
      if (Option.isSome(owned.predecessor)) {
        yield* Deferred.await(owned.predecessor.value);
      }
      yield* Deferred.succeed(owned.quiescent, undefined).pipe(Effect.asVoid);
    });

    return yield* Effect.gen(function* () {
      if (awaitPredecessor && Option.isSome(owned.predecessor)) {
        yield* Effect.raceFirst(Deferred.await(owned.predecessor.value), interruptWhenSuperseded);
      }
      return yield* Effect.raceFirst(effect, interruptWhenSuperseded);
    }).pipe(Effect.ensuring(release));
  });

  const runWhileCurrent = <A, E, R>(
    activationId: string,
    effect: Effect.Effect<A, E, R>,
  ): Effect.Effect<A, E, R> => runOwned(activationId, effect, false);

  const currentOrStale = Effect.fn("RouteActivation.currentOrStale")(function* (
    activationId: string,
    path: string,
  ) {
    const latest = yield* Ref.get(current);
    if (Option.isSome(latest) && latest.value.activationId !== activationId) {
      const outcome = RouteActivationOutcome.DroppedStale({
        activationId,
        supersededBy: latest.value.activationId,
      });
      yield* Trace.emitPayload("outlet.process.dropStale", () => ({
        activationId,
        path,
        supersededBy: latest.value.activationId,
      }));
      return outcome;
    }
    return RouteActivationOutcome.Committed({
      activationId,
      path,
      match: Option.none<RouteMatch>(),
    });
  });

  return {
    claim,
    awaitSuperseded,
    runWhileCurrent,
    activate: Effect.fn("RouteActivation.activate")(function* (request) {
      yield* Trace.emitPayload("outlet.process.start", () => ({
        ...activationPayload(request),
        query_type: Trace.valueType(request.query),
        hasScrollIntent: Option.isSome(request.scrollIntent),
      }));
      yield* claim(request);
      return yield* runWhileCurrent(
        request.activationId,
        Effect.gen(function* () {
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
              yield* Trace.emitPayload("outlet.match.notFound", () => ({
                ...activationPayload(request),
              }));
              return RouteActivationOutcome.NotFound({
                activationId: request.activationId,
                path: request.path,
              });
            }
            yield* Trace.emitPayload("outlet.match.found", () => ({
              ...activationPayload(request),
              routePattern: match.value.route.path,
            }));
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
      );
    }),
    commit: Effect.fn("RouteActivation.commit")(function* (request) {
      const outcome = yield* currentOrStale(request.activationId, request.path);
      if (RouteActivationOutcome.$is("Committed")(outcome)) {
        yield* Trace.emitPayload("outlet.process.commit", () => ({
          ...activationPayload(request),
        }));
      }
      return outcome;
    }),
    currentActivationId: Ref.get(current).pipe(
      Effect.map(Option.map((token) => token.activationId)),
    ),
    showLoadingFallback: Effect.fn("RouteActivation.showLoadingFallback")(function* <E, R>(
      request: Pick<RouteActivationRequest, "activationId" | "path">,
      show: Effect.Effect<void, E, R>,
    ) {
      const outcome = yield* currentOrStale(request.activationId, request.path);
      if (RouteActivationOutcome.$is("DroppedStale")(outcome)) return outcome;
      return yield* runOwned(
        request.activationId,
        Effect.gen(function* () {
          yield* show;
          const afterShow = yield* currentOrStale(request.activationId, request.path);
          if (RouteActivationOutcome.$is("DroppedStale")(afterShow)) return afterShow;
          yield* Trace.emitPayload("outlet.process.commit", () => ({
            ...activationPayload(request),
            state: "Loading",
          }));
          return afterShow;
        }),
        true,
      );
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
      return yield* runOwned(
        request.activationId,
        Effect.gen(function* () {
          yield* swap;
          const afterDomSwap = yield* currentOrStale(request.activationId, request.path);
          if (RouteActivationOutcome.$is("DroppedStale")(afterDomSwap)) return afterDomSwap;
          const scrollResult = yield* afterSwap;
          const afterScroll = yield* currentOrStale(request.activationId, request.path);
          if (RouteActivationOutcome.$is("DroppedStale")(afterScroll)) return afterScroll;
          yield* Trace.emitPayload("scroll.apply", () => ({
            ...activationPayload(request),
            result_type: Trace.valueType(scrollResult),
          }));
          yield* Trace.emitPayload("outlet.process.commit", () => ({
            ...activationPayload(request),
          }));
          return afterScroll;
        }),
        true,
      );
    }),
  };
});

export const RouteActivation = {
  make: (matcher?: RouteMatcherShape): Effect.Effect<RouteActivationShape> =>
    makeService(matcher, makeOpaqueClaims),
};

/** @internal Navigation-owned activations use the Router's monotonic versions. */
export const makeNavigationActivation = (
  matcher?: RouteMatcherShape,
): Effect.Effect<RouteActivationShape<DuplicateRouteActivationId | RouteActivationError>> =>
  makeService(matcher, makeNavigationClaims);

export type RouteActivationRenderIntent = Data.TaggedEnum<{
  readonly Leaf: { readonly component: ComponentInput };
  readonly Loading: { readonly component: ComponentInput };
  readonly ErrorBoundary: {
    readonly component: ComponentInput;
    readonly cause: Cause.Cause<unknown>;
  };
  readonly NotFoundBoundary: { readonly component: ComponentInput };
  readonly ForbiddenBoundary: { readonly component: ComponentInput };
  readonly Redirect: { readonly location: string; readonly replace?: boolean };
  readonly NoBoundary: { readonly cause: unknown };
}>;

export const RouteActivationRenderIntent = Data.taggedEnum<RouteActivationRenderIntent>();

export class LazyRouteLoadError extends Schema.TaggedError<LazyRouteLoadError>()(
  "LazyRouteLoadError",
  {
    activationId: Schema.String,
    path: Schema.String,
    cause: Schema.Unknown,
  },
) {}

export class BoundaryResolutionError extends Schema.TaggedError<BoundaryResolutionError>()(
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
  readonly resolveError: (
    match: RouteMatch,
    cause: Cause.Cause<unknown>,
  ) => Option.Option<ComponentInput>;
  readonly resolveNotFound: (path: string) => Option.Option<ComponentInput>;
  readonly resolveForbidden: (match: RouteMatch) => Option.Option<ComponentInput>;
  readonly runMiddleware: (match: RouteMatch) => Effect.Effect<MiddlewareResult, unknown>;
  readonly isStale: (activationId: string) => Effect.Effect<boolean>;
  readonly runWhileCurrent: <A, E, R>(
    activationId: string,
    effect: Effect.Effect<A, E, R>,
  ) => Effect.Effect<A, E, R>;
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
    cause: Cause.Cause<unknown>,
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
  ) => Effect.Effect<BoundaryOutcome, unknown>;
}

const makeBoundaryService: (
  input: RouteActivationBoundaryConfig,
  dependencies: RouteActivationBoundaryDependencies,
) => Effect.Effect<RouteActivationBoundaryShape> = Effect.fn("RouteActivationBoundary.make")(
  function* (
    input: RouteActivationBoundaryConfig,
    dependencies: RouteActivationBoundaryDependencies,
  ) {
    const config = RouteActivationBoundaryConfigInput.make(input);

    const noBoundary = (cause: unknown) => RouteActivationRenderIntent.NoBoundary({ cause });

    const loadForActivation = Effect.fn("RouteActivationBoundary.loadComponent")(function* (
      request: RouteActivationRequest,
      component: ComponentInput,
    ) {
      yield* Trace.emitPayload("outlet.lazyLeaf.load.start", () => activationPayload(request));
      const load = dependencies.loadComponent(component).pipe(
        Effect.tapError((cause) =>
          Trace.emitPayload("outlet.lazyLeaf.load.error", () => ({
            ...activationPayload(request),
            cause_type: Trace.valueType(cause),
          })),
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
      const loaded = yield* config.interruptStaleLoads
        ? dependencies.runWhileCurrent(request.activationId, load)
        : load;
      const stale = yield* dependencies.isStale(request.activationId);
      if (config.interruptStaleLoads && stale) {
        yield* Trace.emitPayload("outlet.lazyLeaf.load.error", () => ({
          ...activationPayload(request),
          cause_type: Trace.valueType("stale activation"),
        }));
        return yield* Effect.interrupt;
      }
      yield* Trace.emitPayload("outlet.lazyLeaf.load.ready", () => activationPayload(request));
      return loaded;
    });

    return {
      resolve: Effect.fn("RouteActivationBoundary.resolve")(function* (request, match) {
        if (yield* dependencies.isStale(request.activationId)) {
          return yield* Effect.interrupt;
        }
        const loading = dependencies.resolveLoading(match);
        const component = match.route.definition.component;
        if (
          Option.isSome(loading) &&
          component !== undefined &&
          dependencies.isComponentLoader(component)
        ) {
          const outcome = RouteActivationRenderIntent.Loading({ component: loading.value });
          yield* Trace.emitPayload("outlet.boundary.resolve", () =>
            boundaryOutcomePayload(request, outcome, "render"),
          );
          return outcome;
        }
        if (component !== undefined) {
          const outcome = RouteActivationRenderIntent.Leaf({ component });
          yield* Trace.emitPayload("outlet.boundary.resolve", () =>
            boundaryOutcomePayload(request, outcome, "render"),
          );
          return outcome;
        }
        const outcome = RouteActivationRenderIntent.NoBoundary({ cause: "route has no component" });
        yield* Trace.emitPayload("outlet.boundary.resolve", () =>
          boundaryOutcomePayload(request, outcome, "render"),
        );
        return outcome;
      }),
      prefetch: Effect.fn("RouteActivationBoundary.prefetch")(function* (path) {
        const parsed = yield* parsePath(path);
        const matchOption = yield* dependencies.matcher.match(parsed.path).pipe(
          Effect.catch((cause) =>
            Trace.emitPayload("outlet.lazyLeaf.load.error", () => ({
              path,
              cause_type: Trace.valueType(cause),
            })).pipe(Effect.as(Option.none<RouteMatch>())),
          ),
        );
        if (Option.isNone(matchOption)) return;
        const match = matchOption.value;
        const targets = dependencies.collectPrefetchTargets(match);
        yield* Effect.forEach(
          targets.filter(dependencies.isComponentLoader),
          (component) =>
            dependencies.loadComponent(component).pipe(
              Effect.catch((cause: unknown) =>
                Trace.emitPayload("outlet.lazyLeaf.load.error", () => ({
                  path,
                  cause_type: Trace.valueType(cause),
                })),
              ),
            ),
          { concurrency: "unbounded" },
        );
        yield* dependencies.runRoutePrefetch(path, match, parsed.query);
      }),
      loadComponent: loadForActivation,
      resolveErrorBoundary: Effect.fn("RouteActivationBoundary.resolveErrorBoundary")(
        function* (request, match, cause) {
          if (yield* dependencies.isStale(request.activationId)) return yield* Effect.interrupt;
          const component = dependencies.resolveError(match, cause);
          const outcome = Option.isSome(component)
            ? RouteActivationRenderIntent.ErrorBoundary({ component: component.value, cause })
            : noBoundary(cause);
          yield* Trace.emitPayload("outlet.boundary.resolve", () =>
            boundaryOutcomePayload(request, outcome, "error"),
          );
          return outcome;
        },
      ),
      resolveNotFoundBoundary: Effect.fn("RouteActivationBoundary.resolveNotFoundBoundary")(
        function* (request) {
          if (yield* dependencies.isStale(request.activationId)) return yield* Effect.interrupt;
          const component = dependencies.resolveNotFound(request.path);
          const outcome = Option.isSome(component)
            ? RouteActivationRenderIntent.NotFoundBoundary({ component: component.value })
            : noBoundary("not found");
          yield* Trace.emitPayload("outlet.boundary.resolve", () =>
            boundaryOutcomePayload(request, outcome, "notFound"),
          );
          return outcome;
        },
      ),
      resolveForbiddenBoundary: Effect.fn("RouteActivationBoundary.resolveForbiddenBoundary")(
        function* (request, match) {
          if (yield* dependencies.isStale(request.activationId)) return yield* Effect.interrupt;
          const component = dependencies.resolveForbidden(match);
          const outcome = Option.isSome(component)
            ? RouteActivationRenderIntent.ForbiddenBoundary({ component: component.value })
            : noBoundary("forbidden");
          yield* Trace.emitPayload("outlet.boundary.resolve", () =>
            boundaryOutcomePayload(request, outcome, "forbidden"),
          );
          return outcome;
        },
      ),
      resolveMiddleware: Effect.fn("RouteActivationBoundary.resolveMiddleware")(
        function* (request, match) {
          if (yield* dependencies.isStale(request.activationId)) return yield* Effect.interrupt;
          const result = yield* dependencies.runWhileCurrent(
            request.activationId,
            dependencies.runMiddleware(match),
          );
          if (yield* dependencies.isStale(request.activationId)) {
            return yield* Effect.interrupt;
          }
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
          yield* Trace.emitPayload("outlet.boundary.resolve", () =>
            boundaryOutcomePayload(request, outcome, "middleware"),
          );
          return outcome;
        },
      ),
    };
  },
);

export const RouteActivationBoundary = { make: makeBoundaryService };

export type RouteActivationMatch = RouteMatch;
