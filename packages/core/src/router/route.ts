/**
 * Route builder primitives for `trygg/router`.
 *
 * @remarks
 * Owner module for route-definition mechanics. This module owns the immutable
 * route builders behind `Route.make`, route-scoped layer application, schema
 * decode helpers used at match time, and the typed redirect/forbidden failures
 * used by router middleware.
 *
 * @example
 * ```tsx
 * import { Route } from "trygg/router"
 *
 * Route.make("/users/:id")
 *   .component(UserProfile)
 *   .loading(UserSkeleton)
 * ```
 * @see ./route.docs.md - Source-owned topic guide
 * @since 1.0.0
 * @module trygg/router/route
 */
import { Cause, Data, Effect, Option, Pipeable, Predicate, Schema } from "effect";
import type * as LayerTypes from "effect/Layer";
import * as Context from "effect/Context";
import type { ComponentInput, RouteComponentInput } from "./types.js";
import { RenderStrategy } from "./render-strategy.js";
import { ScrollStrategy } from "./scroll-strategy.js";
import {
  unsafeAsOverload,
  unsafeEraseR,
  unsafeEraseMiddlewareR,
  unsafeExtractFields,
} from "../internal/unsafe.js";

const decodeUnknownEffect = Schema.decodeUnknownEffect;

// =============================================================================
// Type-Level Path Param Extraction
// =============================================================================

/**
 * Extract param names from a path pattern as a union type.
 *
 * @remarks
 * `ExtractParams` keeps route builder schemas aligned with the path pattern
 * supplied to `Route.make(...)`.
 *
 * Handles `:param`, `:param*` (zero-or-more), `:param+` (one-or-more).
 *
 * @example
 * ```ts
 * type P1 = ExtractParams<"/users/:id"> // "id"
 * type P2 = ExtractParams<"/blog/:year/:slug"> // "year" | "slug"
 * type P3 = ExtractParams<"/docs/:path*"> // "path"
 * type P4 = ExtractParams<"/about"> // never
 * ```
 *
 * @category Route Builders
 * @public
 * @since 1.0.0
 */
export type ExtractParams<Path extends string> =
  Path extends `${string}:${infer Param}/${infer Rest}`
    ? CleanParamName<Param> | ExtractParams<`/${Rest}`>
    : Path extends `${string}:${infer Param}`
      ? CleanParamName<Param>
      : never;

/**
 * Strip trailing `*` or `+` modifiers from param names.
 * @internal
 */
type CleanParamName<P extends string> = P extends `${infer Name}*`
  ? Name
  : P extends `${infer Name}+`
    ? Name
    : P;

// =============================================================================
// Route Definition (Internal Representation)
// =============================================================================

/** @internal */
export const IndexMarker = Symbol.for("trygg/router/IndexRoute");
export type IndexMarker = typeof IndexMarker;

/**
 * Internal route definition produced by the builder.
 *
 * @remarks
 * `RouteDefinition` is the normalized route data consumed by matching and
 * outlet rendering after fluent builder calls finish.
 *
 * @internal
 * @since 1.0.0
 */
export interface RouteDefinition {
  readonly _tag: "RouteDefinition";
  readonly path: string | IndexMarker;
  readonly component: ComponentInput | undefined;
  readonly layout: ComponentInput | undefined;
  readonly loading: ComponentInput | undefined;
  readonly error: ComponentInput | undefined;
  readonly notFound: ComponentInput | undefined;
  readonly forbidden: ComponentInput | undefined;
  readonly middleware: ReadonlyArray<Effect.Effect<void, unknown, never>>;
  readonly prefetch: ReadonlyArray<(ctx: unknown) => Effect.Effect<unknown, unknown, never>>;
  readonly children: ReadonlyArray<RouteDefinition>;
  readonly paramsSchema: unknown | undefined;
  readonly querySchema: unknown | undefined;
  readonly renderStrategy: LayerTypes.Layer<RenderStrategy> | undefined;
  readonly scrollStrategy: LayerTypes.Layer<ScrollStrategy> | undefined;
}

// =============================================================================
// Route Builder Types
// =============================================================================

/**
 * Phantom type flags for tracking builder state.
 * @internal
 */
export type True = { readonly _: unique symbol };
export type False = { readonly _: unique symbol };

/**
 * Route builder - accumulates configuration for a route.
 *
 * @remarks
 * `RouteBuilder` is the fluent type returned from `Route.make` and
 * `Route.index`. Its type parameters encode builder-state invariants such as
 * params coverage, middleware requirements, and component-versus-children.
 *
 * Type parameters:
 * - `Path` - the path pattern string
 * - `R` - accumulated service requirements from middleware
 * - `HasComponent` - whether `.component()` has been called
 * - `HasChildren` - whether `.children()` has been called
 * - `NeedsCoverage` - whether this route tree needs an error boundary
 *
 * @example
 * ```tsx
 * const route = Route.make("/users/:id")
 *   .params(Schema.Struct({ id: Schema.NumberFromString }))
 *   .component(UserProfile)
 * ```
 *
 * @category Route Builders
 * @public
 * @since 1.0.0
 */
export interface RouteBuilder<
  Path extends string,
  R,
  HasComponent extends boolean,
  HasChildren extends boolean,
  NeedsCoverage extends boolean = false,
  HasErrorBoundary extends boolean = false,
>
  extends Pipeable.Pipeable {
  readonly _tag: "RouteBuilder";
  readonly [RouteBuilderTypeId]: RouteBuilderTypeId;
  /** Phantom type for service requirements tracking */
  readonly _R?: R;
  /** Phantom type for coverage tracking */
  readonly _NeedsCoverage?: NeedsCoverage;
  /** Phantom type for boundary tracking */
  readonly _HasErrorBoundary?: HasErrorBoundary;
  readonly definition: RouteDefinition;

  /**
   * Set path param schema.
   * Schema keys must exactly match the path params.
   *
   * @example
   * ```tsx
   * Route.make("/users/:id")
   *   .params(Schema.Struct({ id: Schema.NumberFromString }))
   * ```
   */
  params: ExtractParams<Path> extends never
    ? never
    : <Fields extends Schema.Struct.Fields>(
        schema: [ExtractParams<Path>] extends [keyof Fields & string]
          ? [keyof Fields & string] extends [ExtractParams<Path>]
            ? Schema.Struct<Fields>
            : {
                readonly error: "Schema has keys not in path params";
                readonly extra: Exclude<keyof Fields & string, ExtractParams<Path>>;
              }
          : {
              readonly error: "Schema is missing path params";
              readonly missing: Exclude<ExtractParams<Path>, keyof Fields & string>;
            },
      ) => RouteBuilder<
        Path,
        R,
        HasComponent,
        HasChildren,
        HasErrorBoundary extends true ? false : true,
        HasErrorBoundary
      >;

  /**
   * Set query param schema.
   * Query params are decoded from the URL search string at match time.
   *
   * @example
   * ```tsx
   * Route.make("/search")
   *   .query(Schema.Struct({
   *     q: Schema.String,
   *     page: Schema.optional(Schema.NumberFromString),
   *   }))
   * ```
   */
  query: <Fields extends Schema.Struct.Fields>(
    schema: Schema.Struct<Fields>,
  ) => RouteBuilder<
    Path,
    R,
    HasComponent,
    HasChildren,
    HasErrorBoundary extends true ? false : true,
    HasErrorBoundary
  >;

  /**
   * Set the component for this route.
   * Accepts a Component, Effect, or lazy loader `() => import("./page")`.
   * Mutually exclusive with `.children()`.
   */
  component: HasChildren extends true
    ? never
    : <C extends ComponentInput>(
        c: RouteComponentInput<C>,
      ) => RouteBuilder<Path, R, true, HasChildren, NeedsCoverage, HasErrorBoundary>;

  /**
   * Set the layout component (renders Outlet for children).
   * Accepts a Component, Effect, or lazy loader `() => import("./page")`.
   */
  layout: <C extends ComponentInput>(
    c: RouteComponentInput<C>,
  ) => RouteBuilder<Path, R, HasComponent, HasChildren, NeedsCoverage, HasErrorBoundary>;

  /**
   * Set the loading fallback component.
   * Accepts a Component, Effect, or lazy loader `() => import("./page")`.
   */
  loading: <C extends ComponentInput>(
    c: RouteComponentInput<C>,
  ) => RouteBuilder<Path, R, HasComponent, HasChildren, NeedsCoverage, HasErrorBoundary>;

  /**
   * Set the error boundary component.
   * Covers this route and all descendants — satisfies error coverage requirements.
   * Accepts a Component, Effect, or lazy loader `() => import("./page")`.
   */
  error: <C extends ComponentInput>(
    c: RouteComponentInput<C>,
  ) => RouteBuilder<Path, R, HasComponent, HasChildren, false, true>;

  /**
   * Set the not-found boundary component.
   * Accepts a Component, Effect, or lazy loader `() => import("./page")`.
   */
  notFound: <C extends ComponentInput>(
    c: RouteComponentInput<C>,
  ) => RouteBuilder<Path, R, HasComponent, HasChildren, NeedsCoverage, HasErrorBoundary>;

  /**
   * Set the forbidden boundary component.
   * Accepts a Component, Effect, or lazy loader `() => import("./page")`.
   */
  forbidden: <C extends ComponentInput>(
    c: RouteComponentInput<C>,
  ) => RouteBuilder<Path, R, HasComponent, HasChildren, NeedsCoverage, HasErrorBoundary>;

  /**
   * Add middleware to this route.
   * Middleware runs before component rendering, left-to-right.
   */
  middleware: <R2>(
    m: Effect.Effect<void, unknown, R2>,
  ) => RouteBuilder<Path, R | R2, HasComponent, HasChildren, NeedsCoverage, HasErrorBoundary>;

  /**
   * Add prefetch effect.
   * Multiple prefetches run in parallel.
   */
  prefetch: (
    fn: (ctx: unknown) => Effect.Effect<unknown, unknown, never>,
  ) => RouteBuilder<Path, R, HasComponent, HasChildren, NeedsCoverage, HasErrorBoundary>;

  /**
   * Add child routes.
   * Mutually exclusive with `.component()`.
   * If any child needs error coverage, this route inherits that need.
   */
  children: HasComponent extends true
    ? never
    : <const Children extends ReadonlyArray<AnyRouteBuilder>>(
        ...routes: Children
      ) => RouteBuilder<
        Path,
        R,
        HasComponent,
        true,
        HasErrorBoundary extends true
          ? false
          : NeedsCoverage extends true
            ? true
            : ChildrenNeedCoverage<Children>,
        HasErrorBoundary
      >;
}

/**
 * Any RouteBuilder, used for children parameter to avoid variance issues.
 *
 * @remarks
 * `AnyRouteBuilder` is the widened builder shape used internally by tuple-based
 * child-route typing helpers.
 *
 * @internal
 * @since 1.0.0
 */
export interface AnyRouteBuilder {
  readonly _tag: "RouteBuilder";
  readonly [RouteBuilderTypeId]: RouteBuilderTypeId;
  readonly _NeedsCoverage?: boolean;
  readonly _HasErrorBoundary?: boolean;
  readonly definition: RouteDefinition;
}

/**
 * Extract whether a RouteBuilder still needs error coverage.
 * @internal
 */
type ExtractNeedsCoverage<T extends AnyRouteBuilder> =
  T extends RouteBuilder<string, unknown, boolean, boolean, infer NeedsCoverage, boolean>
    ? NeedsCoverage
    : false;

/**
 * Compute whether any child in a tuple needs error coverage.
 * @internal
 */
export type ChildrenNeedCoverage<T extends ReadonlyArray<AnyRouteBuilder>> = T extends readonly [
  infer Head extends AnyRouteBuilder,
  ...infer Tail extends ReadonlyArray<AnyRouteBuilder>,
]
  ? ExtractNeedsCoverage<Head> extends true
    ? true
    : ChildrenNeedCoverage<Tail>
  : false;

// =============================================================================
// Route Builder Implementation
// =============================================================================

/** @internal */
export const RouteBuilderTypeId: unique symbol = Symbol.for("trygg/router/RouteBuilder");
export type RouteBuilderTypeId = typeof RouteBuilderTypeId;

const RouteBuilderData = Data.TaggedClass("RouteBuilder");
const RouteDefinitionData = Data.TaggedClass("RouteDefinition");

/** @internal */
const makeBuilder = <
  Path extends string,
  R,
  HasComponent extends boolean,
  HasChildren extends boolean,
  NeedsCoverage extends boolean = false,
  HasErrorBoundary extends boolean = false,
>(
  def: RouteDefinition,
): RouteBuilder<Path, R, HasComponent, HasChildren, NeedsCoverage, HasErrorBoundary> => {
  const paramsImpl = (schema: unknown) =>
    makeBuilder<
      Path,
      R,
      HasComponent,
      HasChildren,
      HasErrorBoundary extends true ? false : true,
      HasErrorBoundary
    >({
      ...def,
      paramsSchema: schema,
    });

  const queryImpl = (schema: unknown) =>
    makeBuilder<
      Path,
      R,
      HasComponent,
      HasChildren,
      HasErrorBoundary extends true ? false : true,
      HasErrorBoundary
    >({
      ...def,
      querySchema: schema,
    });

  const componentImpl = (c: ComponentInput) =>
    makeBuilder<Path, R, true, HasChildren, NeedsCoverage, HasErrorBoundary>({
      ...def,
      component: c,
    });

  const childrenImpl = (...routes: ReadonlyArray<AnyRouteBuilder>) =>
    makeBuilder<Path, R, HasComponent, true, NeedsCoverage, HasErrorBoundary>({
      ...def,
      children: routes.map((r) => r.definition),
    });

  const self: RouteBuilder<Path, R, HasComponent, HasChildren, NeedsCoverage, HasErrorBoundary> =
    new RouteBuilderData({
      [RouteBuilderTypeId]: RouteBuilderTypeId,
      definition: def,

      params:
        unsafeAsOverload<
          RouteBuilder<
            Path,
            R,
            HasComponent,
            HasChildren,
            NeedsCoverage,
            HasErrorBoundary
          >["params"]
        >(paramsImpl),

      query:
        unsafeAsOverload<
          RouteBuilder<Path, R, HasComponent, HasChildren, NeedsCoverage, HasErrorBoundary>["query"]
        >(queryImpl),

      component:
        unsafeAsOverload<
          RouteBuilder<
            Path,
            R,
            HasComponent,
            HasChildren,
            NeedsCoverage,
            HasErrorBoundary
          >["component"]
        >(componentImpl),

      layout: (c: ComponentInput) =>
        makeBuilder<Path, R, HasComponent, HasChildren, NeedsCoverage, HasErrorBoundary>({
          ...def,
          layout: c,
        }),

      loading: (c: ComponentInput) =>
        makeBuilder<Path, R, HasComponent, HasChildren, NeedsCoverage, HasErrorBoundary>({
          ...def,
          loading: c,
        }),

      error: (c: ComponentInput) =>
        makeBuilder<Path, R, HasComponent, HasChildren, false, true>({
          ...def,
          error: c,
        }),

      notFound: (c: ComponentInput) =>
        makeBuilder<Path, R, HasComponent, HasChildren, NeedsCoverage, HasErrorBoundary>({
          ...def,
          notFound: c,
        }),

      forbidden: (c: ComponentInput) =>
        makeBuilder<Path, R, HasComponent, HasChildren, NeedsCoverage, HasErrorBoundary>({
          ...def,
          forbidden: c,
        }),

      middleware: <R2>(m: Effect.Effect<void, unknown, R2>) =>
        makeBuilder<Path, R | R2, HasComponent, HasChildren, NeedsCoverage, HasErrorBoundary>({
          ...def,
          middleware: [...def.middleware, unsafeEraseMiddlewareR(m)],
        }),

      prefetch: (fn: (ctx: unknown) => Effect.Effect<unknown, unknown, never>) =>
        makeBuilder<Path, R, HasComponent, HasChildren, NeedsCoverage, HasErrorBoundary>({
          ...def,
          prefetch: [...def.prefetch, fn],
        }),

      children:
        unsafeAsOverload<
          RouteBuilder<
            Path,
            R,
            HasComponent,
            HasChildren,
            NeedsCoverage,
            HasErrorBoundary
          >["children"]
        >(childrenImpl),

      pipe() {
        return Pipeable.pipeArguments(this, arguments);
      },
    });

  return self;
};

/** @internal */
const emptyDefinition = (path: string | IndexMarker): RouteDefinition =>
  new RouteDefinitionData({
    path,
    component: undefined,
    layout: undefined,
    loading: undefined,
    error: undefined,
    notFound: undefined,
    forbidden: undefined,
    middleware: [],
    prefetch: [],
    children: [],
    paramsSchema: undefined,
    querySchema: undefined,
    renderStrategy: undefined,
    scrollStrategy: undefined,
  });

// =============================================================================
// Public API
// =============================================================================

/**
 * Create a route with a path pattern.
 *
 * @remarks
 * Start with `make` when the route should match a concrete path pattern and
 * then add params, middleware, boundaries, strategies, or children.
 *
 * Path patterns support:
 * - Static segments: `/about`
 * - Dynamic params: `/users/:id`
 * - Optional catch-all: `/docs/:path*`
 * - Required catch-all: `/files/:filepath+`
 *
 * @example
 * ```tsx
 * Route.make("/users/:id")
 *   .component(UserProfile)
 * ```
 *
 * @category Route Builders
 * @public
 * @since 1.0.0
 */
export const make = <Path extends string>(path: Path): RouteBuilder<Path, never, false, false> =>
  makeBuilder<Path, never, false, false>(emptyDefinition(path));

/**
 * Create an index route (matches parent path exactly).
 *
 * @remarks
 * Use `index` inside `.children(...)` when a parent layout needs a default leaf
 * route at the parent's exact path.
 *
 * @example
 * ```tsx
 * Route.make("/settings")
 *   .layout(SettingsLayout)
 *   .children(
 *     Route.index(SettingsIndex),  // matches /settings exactly
 *     Route.make("/profile").component(SettingsProfile),
 *   )
 * ```
 *
 * @category Route Builders
 * @public
 * @since 1.0.0
 */
export const index = <C extends ComponentInput>(
  component: RouteComponentInput<C>,
): RouteBuilder<"__index__", never, true, false> =>
  makeBuilder<"__index__", never, true, false>({
    ...emptyDefinition(IndexMarker),
    component,
  });

/**
 * Check if a value is a RouteBuilder.
 *
 * @remarks
 * Advanced helper for tests or tooling that need to detect builder values
 * structurally before reading `.definition`.
 *
 * @internal
 * @since 1.0.0
 */
export const isRouteBuilder = (
  value: unknown,
): value is RouteBuilder<string, never, boolean, boolean, boolean, boolean> =>
  typeof value === "object" && value !== null && RouteBuilderTypeId in value;

// =============================================================================
// Route.provide — Strategy Application
// =============================================================================

/** @internal */
type RouteStrategyLayer =
  | LayerTypes.Layer<RenderStrategy, never, never>
  | LayerTypes.Layer<ScrollStrategy, never, never>;

/** Known RenderStrategy layer instances for detection. @internal */
const KNOWN_RENDER_STRATEGIES: ReadonlySet<RouteStrategyLayer> = new Set([
  RenderStrategy.Lazy,
  RenderStrategy.Eager,
]);

/** Known ScrollStrategy layer instances for detection. @internal */
const KNOWN_SCROLL_STRATEGIES: ReadonlySet<RouteStrategyLayer> = new Set([
  ScrollStrategy.Auto,
  ScrollStrategy.None,
]);

/** @internal */
const isRenderStrategyLayer = (
  layer: RouteStrategyLayer,
): layer is LayerTypes.Layer<RenderStrategy, never, never> => KNOWN_RENDER_STRATEGIES.has(layer);

/** @internal */
const isScrollStrategyLayer = (
  layer: RouteStrategyLayer,
): layer is LayerTypes.Layer<ScrollStrategy, never, never> => KNOWN_SCROLL_STRATEGIES.has(layer);

/**
 * Apply strategy layers to a route:
 * - `RenderStrategy` layer -> stored as render strategy
 * - `ScrollStrategy` layer -> stored as scroll strategy
 *
 * @example
 * ```tsx
 * Route.make("/")
 *   .component(HomePage)
 *   .pipe(Route.provide(RenderStrategy.Eager))
 *
 * Route.make("/settings")
 *   .component(SettingsPage)
 *   .pipe(Route.provide(RenderStrategy.Eager), Route.provide(ScrollStrategy.None))
 * ```
 *
 * @remarks
 * `provide` attaches route-local strategy layers without breaking the fluent
 * builder flow. Component data/services belong at component lifecycle
 * boundaries via `Component.provide(layer)`.
 *
 * @category Route Builders
 * @public
 * @since 1.0.0
 */
export function provide(
  layer: RouteStrategyLayer,
): <
  Path extends string,
  R,
  HC extends boolean,
  HCh extends boolean,
  NC extends boolean,
  HEB extends boolean,
>(
  builder: RouteBuilder<Path, R, HC, HCh, NC, HEB>,
) => RouteBuilder<Path, R, HC, HCh, NC, HEB> {
  return <
    Path extends string,
    R,
    HC extends boolean,
    HCh extends boolean,
    NC extends boolean,
    HEB extends boolean,
  >(
    builder: RouteBuilder<Path, R, HC, HCh, NC, HEB>,
  ): RouteBuilder<Path, R, HC, HCh, NC, HEB> => {
    const renderStrategy = isRenderStrategyLayer(layer) ? layer : builder.definition.renderStrategy;
    const scrollStrategy = isScrollStrategyLayer(layer) ? layer : builder.definition.scrollStrategy;

    return makeBuilder<Path, R, HC, HCh, NC, HEB>({
      ...builder.definition,
      renderStrategy,
      scrollStrategy,
    });
  };
}

// =============================================================================
// Schema Decode at Match Time
// =============================================================================

/**
 * Error produced when path params fail schema decode.
 * @since 1.0.0
 */
export class ParamsDecodeError extends Schema.TaggedErrorClass<ParamsDecodeError>()(
  "ParamsDecodeError",
  {
    path: Schema.String,
    rawParams: Schema.Record(Schema.String, Schema.String),
    cause: Schema.Unknown,
  },
) {}

/**
 * Decode raw string params using a Schema.
 * Returns an Effect that succeeds with decoded params or fails with ParamsDecodeError.
 *
 * @since 1.0.0
 */
export const decodeParams = <S extends Schema.Top>(
  schema: S,
  rawParams: Record<string, string>,
  path: string,
): Effect.Effect<S["Type"], ParamsDecodeError> =>
  unsafeEraseR(decodeUnknownEffect(schema)(rawParams)).pipe(
    Effect.mapError((cause) => new ParamsDecodeError({ path, rawParams, cause })),
  );

// =============================================================================
// Query Params
// =============================================================================

/**
 * Error produced when query params fail schema decode.
 * @since 1.0.0
 */
export class QueryDecodeError extends Schema.TaggedErrorClass<QueryDecodeError>()(
  "QueryDecodeError",
  {
    path: Schema.String,
    rawQuery: Schema.Record(Schema.String, Schema.String),
    cause: Schema.Unknown,
  },
) {}

/**
 * FiberRef holding the decoded query params for the current route.
 * Set by the Outlet at match time after decoding via the route's query schema.
 *
 * @remarks
 * Router internals write decoded query objects here so `Router.query(...)` can
 * read them without threading values through component props.
 *
 * @internal
 * @since 1.0.0
 */
export const CurrentRouteQuery = Context.Reference<Record<string, unknown>>(
  "trygg/Router/CurrentRouteQuery",
  {
    defaultValue: () => ({}),
  },
);

/**
 * Decode query params from URLSearchParams using a Schema.
 * Only decodes keys present in the schema, ignoring extra query params.
 *
 * @since 1.0.0
 */
export const decodeQuery = <S extends Schema.Top>(
  schema: S,
  searchParams: URLSearchParams,
  path: string,
): Effect.Effect<S["Type"], QueryDecodeError> => {
  // Convert URLSearchParams to Record<string, string>
  const raw: Record<string, string> = {};
  searchParams.forEach((value, key) => {
    raw[key] = value;
  });

  return unsafeEraseR(decodeUnknownEffect(schema)(raw)).pipe(
    Effect.mapError((cause) => new QueryDecodeError({ path, rawQuery: raw, cause })),
  );
};

// =============================================================================
// Middleware Typed Failures
// =============================================================================

/**
 * Typed failure for middleware redirect.
 * Produced by `Router.redirect(path)`.
 * @since 1.0.0
 */
export class RouterRedirectError extends Schema.TaggedErrorClass<RouterRedirectError>()(
  "RouterRedirect",
  {
    path: Schema.String,
    replace: Schema.Boolean,
  },
) {}

/**
 * Typed failure for middleware forbidden.
 * Produced by `Router.forbidden()`.
 * @since 1.0.0
 */
export class RouterForbiddenError extends Schema.TaggedErrorClass<RouterForbiddenError>()(
  "RouterForbidden",
  {},
) {}

/**
 * Redirect to another path. Used in middleware to abort and navigate.
 * Fails the middleware Effect with a typed `RouterRedirect` error.
 *
 * @remarks
 * Use this inside route middleware when a guard should stop rendering and hand
 * control back to the router for a redirect.
 *
 * @example
 * ```tsx
 * const requireAuth = Effect.gen(function* () {
 *   const session = yield* getSession()
 *   if (Option.isNone(session)) {
 *     return yield* routeRedirect("/login")
 *   }
 * })
 * ```
 *
 * @category Route Builders
 * @public
 * @since 1.0.0
 */
export const routeRedirect = (
  path: string,
  options?: { readonly replace?: boolean },
): Effect.Effect<never, RouterRedirectError> =>
  Effect.fail(new RouterRedirectError({ path, replace: options?.replace ?? false }));

/**
 * Forbid access. Used in middleware to render the forbidden boundary.
 * Fails the middleware Effect with a typed `RouterForbidden` error.
 *
 * @remarks
 * Use this inside route middleware when a guard should stop rendering and ask
 * the outlet to resolve the nearest forbidden boundary.
 *
 * @example
 * ```tsx
 * const requireAdmin = Effect.gen(function* () {
 *   const user = yield* getUser()
 *   if (!user.isAdmin) {
 *     return yield* routeForbidden
 *   }
 * })
 * ```
 *
 * @category Route Builders
 * @public
 * @since 1.0.0
 */
export const routeForbidden: Effect.Effect<never, RouterForbiddenError> = Effect.fail(
  new RouterForbiddenError(),
);

// =============================================================================
// Middleware Runner
// =============================================================================

/**
 * Result of running a middleware chain.
 *
 * @remarks
 * Internal router shape used to carry middleware outcomes into matching and
 * outlet rendering.
 *
 * @internal
 * @since 1.0.0
 */
export type MiddlewareResult = Data.TaggedEnum<{
  readonly Continue: {};
  readonly Redirect: { readonly path: string; readonly replace: boolean };
  readonly Forbidden: {};
  readonly Error: { readonly cause: unknown };
}>;

export const MiddlewareResult = Data.taggedEnum<MiddlewareResult>();

/**
 * Run a middleware chain in order (left-to-right).
 * Halts on first failure:
 * - RouterRedirect → returns Redirect result
 * - RouterForbidden → returns Forbidden result
 * - Other error → returns Error result
 * - All succeed → returns Continue
 *
 * @since 1.0.0
 */
export const runMiddlewareChain: (
  middleware: ReadonlyArray<Effect.Effect<void, unknown, never>>,
) => Effect.Effect<MiddlewareResult, never, never> = Effect.fn("Route.runMiddlewareChain")(
  function* (middleware: ReadonlyArray<Effect.Effect<void, unknown, never>>) {
    if (middleware.length === 0) {
      return MiddlewareResult.Continue();
    }

    const continueResult: MiddlewareResult = MiddlewareResult.Continue();
    for (const m of middleware) {
      const result = yield* unsafeEraseMiddlewareR(m).pipe(
        Effect.matchCauseEffect({
          onSuccess: () => Effect.succeed(continueResult),
          onFailure: (cause) => {
            const squashed = extractMiddlewareError(cause);
            return Effect.succeed(squashed);
          },
        }),
      );

      if (!MiddlewareResult.$is("Continue")(result)) {
        return result;
      }
    }
    return continueResult;
  },
);

/**
 * Extract the middleware result from a Cause.
 * @internal
 */
const extractMiddlewareError = (cause: unknown): MiddlewareResult => {
  // Try to find RouterRedirect or RouterForbidden in the cause
  const error = findFailure(cause);

  if (Predicate.isTagged(error, "RouterRedirect")) {
    const redirect = unsafeExtractFields<{ path: string; replace: boolean }>(error);
    return MiddlewareResult.Redirect({ path: redirect.path, replace: redirect.replace });
  }
  if (Predicate.isTagged(error, "RouterForbidden")) {
    return MiddlewareResult.Forbidden();
  }

  return MiddlewareResult.Error({ cause });
};

/**
 * Extract the failure value from a Cause-like structure.
 * @internal
 */
const findFailure = (cause: unknown): unknown => {
  if (cause === null || cause === undefined) return cause;
  if (typeof cause !== "object") return cause;

  if (Cause.isCause(cause)) {
    return Option.getOrNull(Cause.findErrorOption(cause));
  }

  if (Predicate.isTagged(cause, "RouterRedirect") || Predicate.isTagged(cause, "RouterForbidden")) {
    return cause;
  }

  return cause;
};
