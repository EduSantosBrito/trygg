/**
 * @since 1.0.0
 * Route Builder
 *
 * Pipeable data structure for defining routes with type-safe path params,
 * middleware composition, and boundary components.
 *
 * @example
 * ```tsx
 * import { Route } from "trygg/router"
 *
 * Route.make("/users/:id")
 *   .component(UserProfile)
 *   .loading(UserSkeleton)
 * ```
 */
import { Data, Effect, FiberRef, Layer, Pipeable, Schema } from "effect";
import type { ComponentInput } from "./types.js";
import { RenderStrategy } from "./render-strategy.js";
import { ScrollStrategy } from "./scroll-strategy.js";
import { unsafeEraseMiddlewareR, unsafeExtractFields } from "../internal/unsafe.js";

// =============================================================================
// Type-Level Path Param Extraction
// =============================================================================

/**
 * Extract param names from a path pattern as a union type.
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
  readonly middleware: ReadonlyArray<Effect.Effect<void, unknown, unknown>>;
  readonly prefetch: ReadonlyArray<(ctx: unknown) => Effect.Effect<unknown, unknown, never>>;
  readonly children: ReadonlyArray<RouteDefinition>;
  readonly paramsSchema: unknown | undefined;
  readonly querySchema: unknown | undefined;
  readonly renderStrategy: Layer.Layer<RenderStrategy> | undefined;
  readonly scrollStrategy: Layer.Layer<ScrollStrategy> | undefined;
  readonly layers: ReadonlyArray<Layer.Layer.Any>;
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
 * Type parameters:
 * - `Path` - the path pattern string
 * - `R` - accumulated service requirements from middleware
 * - `HasComponent` - whether `.component()` has been called
 * - `HasChildren` - whether `.children()` has been called
 *
 * @since 1.0.0
 */
export interface RouteBuilder<
  Path extends string,
  R,
  HasComponent extends boolean,
  HasChildren extends boolean,
>
  extends Pipeable.Pipeable {
  readonly _tag: "RouteBuilder";
  readonly [RouteBuilderTypeId]: RouteBuilderTypeId;
  /** Phantom type for service requirements tracking */
  readonly _R: R;
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
      ) => RouteBuilder<Path, R, HasComponent, HasChildren>;

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
  ) => RouteBuilder<Path, R, HasComponent, HasChildren>;

  /**
   * Set the component for this route.
   * Accepts a Component, Effect, or lazy loader `() => import("./page")`.
   * Mutually exclusive with `.children()`.
   */
  component: HasChildren extends true
    ? never
    : (c: ComponentInput) => RouteBuilder<Path, R, true, HasChildren>;

  /**
   * Set the layout component (renders Outlet for children).
   * Accepts a Component, Effect, or lazy loader `() => import("./page")`.
   */
  layout: (c: ComponentInput) => RouteBuilder<Path, R, HasComponent, HasChildren>;

  /**
   * Set the loading fallback component.
   * Accepts a Component, Effect, or lazy loader `() => import("./page")`.
   */
  loading: (c: ComponentInput) => RouteBuilder<Path, R, HasComponent, HasChildren>;

  /**
   * Set the error boundary component.
   * Accepts a Component, Effect, or lazy loader `() => import("./page")`.
   */
  error: (c: ComponentInput) => RouteBuilder<Path, R, HasComponent, HasChildren>;

  /**
   * Set the not-found boundary component.
   * Accepts a Component, Effect, or lazy loader `() => import("./page")`.
   */
  notFound: (c: ComponentInput) => RouteBuilder<Path, R, HasComponent, HasChildren>;

  /**
   * Set the forbidden boundary component.
   * Accepts a Component, Effect, or lazy loader `() => import("./page")`.
   */
  forbidden: (c: ComponentInput) => RouteBuilder<Path, R, HasComponent, HasChildren>;

  /**
   * Add middleware to this route.
   * Middleware runs before component rendering, left-to-right.
   */
  middleware: <R2>(
    m: Effect.Effect<void, unknown, R2>,
  ) => RouteBuilder<Path, R | R2, HasComponent, HasChildren>;

  /**
   * Add prefetch effect.
   * Multiple prefetches run in parallel.
   */
  prefetch: (
    fn: (ctx: unknown) => Effect.Effect<unknown, unknown, never>,
  ) => RouteBuilder<Path, R, HasComponent, HasChildren>;

  /**
   * Add child routes.
   * Mutually exclusive with `.component()`.
   */
  children: HasComponent extends true
    ? never
    : (...routes: ReadonlyArray<AnyRouteBuilder>) => RouteBuilder<Path, R, HasComponent, true>;
}

/**
 * Any RouteBuilder, used for children parameter to avoid variance issues.
 * @since 1.0.0
 */
export interface AnyRouteBuilder {
  readonly _tag: "RouteBuilder";
  readonly [RouteBuilderTypeId]: RouteBuilderTypeId;
  readonly definition: RouteDefinition;
}

// =============================================================================
// Route Builder Implementation
// =============================================================================

/** @internal */
export const RouteBuilderTypeId: unique symbol = Symbol.for("trygg/router/RouteBuilder");
export type RouteBuilderTypeId = typeof RouteBuilderTypeId;

/** @internal */
const makeBuilder = <
  Path extends string,
  R,
  HasComponent extends boolean,
  HasChildren extends boolean,
>(
  def: RouteDefinition,
): RouteBuilder<Path, R, HasComponent, HasChildren> => {
  const self: RouteBuilder<Path, R, HasComponent, HasChildren> = {
    _tag: "RouteBuilder",
    [RouteBuilderTypeId]: RouteBuilderTypeId,
    _R: undefined as unknown as R,
    definition: def,

    params: ((schema: unknown) =>
      makeBuilder<Path, R, HasComponent, HasChildren>({
        ...def,
        paramsSchema: schema,
      })) as unknown as RouteBuilder<Path, R, HasComponent, HasChildren>["params"],

    query: ((schema: unknown) =>
      makeBuilder<Path, R, HasComponent, HasChildren>({
        ...def,
        querySchema: schema,
      })) as unknown as RouteBuilder<Path, R, HasComponent, HasChildren>["query"],

    component: ((c: ComponentInput) =>
      makeBuilder<Path, R, true, HasChildren>({
        ...def,
        component: c,
      })) as RouteBuilder<Path, R, HasComponent, HasChildren>["component"],

    layout: (c: ComponentInput) =>
      makeBuilder<Path, R, HasComponent, HasChildren>({
        ...def,
        layout: c,
      }),

    loading: (c: ComponentInput) =>
      makeBuilder<Path, R, HasComponent, HasChildren>({
        ...def,
        loading: c,
      }),

    error: (c: ComponentInput) =>
      makeBuilder<Path, R, HasComponent, HasChildren>({
        ...def,
        error: c,
      }),

    notFound: (c: ComponentInput) =>
      makeBuilder<Path, R, HasComponent, HasChildren>({
        ...def,
        notFound: c,
      }),

    forbidden: (c: ComponentInput) =>
      makeBuilder<Path, R, HasComponent, HasChildren>({
        ...def,
        forbidden: c,
      }),

    middleware: <R2>(m: Effect.Effect<void, unknown, R2>) =>
      makeBuilder<Path, R | R2, HasComponent, HasChildren>({
        ...def,
        middleware: [...def.middleware, m as Effect.Effect<void, unknown, unknown>],
      }),

    prefetch: (fn: (ctx: unknown) => Effect.Effect<unknown, unknown, never>) =>
      makeBuilder<Path, R, HasComponent, HasChildren>({
        ...def,
        prefetch: [...def.prefetch, fn],
      }),

    children: ((...routes: ReadonlyArray<RouteBuilder<string, never, boolean, boolean>>) =>
      makeBuilder<Path, R, HasComponent, true>({
        ...def,
        children: routes.map((r) => r.definition),
      })) as RouteBuilder<Path, R, HasComponent, HasChildren>["children"],

    pipe() {
      return Pipeable.pipeArguments(this, arguments);
    },
  };

  return self;
};

/** @internal */
const emptyDefinition = (path: string | IndexMarker): RouteDefinition => ({
  _tag: "RouteDefinition",
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
  layers: [],
});

// =============================================================================
// Public API
// =============================================================================

/**
 * Create a route with a path pattern.
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
 * @since 1.0.0
 */
export const make = <Path extends string>(path: Path): RouteBuilder<Path, never, false, false> =>
  makeBuilder<Path, never, false, false>(emptyDefinition(path));

/**
 * Create an index route (matches parent path exactly).
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
 * @since 1.0.0
 */
export const index = (component: ComponentInput): RouteBuilder<"__index__", never, true, false> =>
  makeBuilder<"__index__", never, true, false>({
    ...emptyDefinition(IndexMarker),
    component,
  });

/**
 * Check if a value is a RouteBuilder.
 * @since 1.0.0
 */
export const isRouteBuilder = (
  value: unknown,
): value is RouteBuilder<string, never, boolean, boolean> =>
  typeof value === "object" && value !== null && RouteBuilderTypeId in value;

// =============================================================================
// Route.provide — Layer Application
// =============================================================================

/** Known RenderStrategy layer instances for detection. @internal */
const KNOWN_RENDER_STRATEGIES = new Set<Layer.Layer.Any>([
  RenderStrategy.Lazy,
  RenderStrategy.Eager,
]);

/** Known ScrollStrategy layer instances for detection. @internal */
const KNOWN_SCROLL_STRATEGIES = new Set<Layer.Layer.Any>([
  ScrollStrategy.Auto,
  ScrollStrategy.None,
]);

/** @internal */
const isRenderStrategyLayer = (layer: Layer.Layer.Any): layer is Layer.Layer<RenderStrategy> =>
  KNOWN_RENDER_STRATEGIES.has(layer);

/** @internal */
const isScrollStrategyLayer = (layer: Layer.Layer.Any): layer is Layer.Layer<ScrollStrategy> =>
  KNOWN_SCROLL_STRATEGIES.has(layer);

/**
 * Apply Layers to a route. Detects layer type and stores appropriately:
 * - `RenderStrategy` layer -> stored as render strategy
 * - `ScrollStrategy` layer -> stored as scroll strategy
 * - Other layers -> stored for middleware R requirements
 *
 * Used with `.pipe()`:
 * ```tsx
 * Route.make("/")
 *   .component(HomePage)
 *   .pipe(Route.provide(RenderStrategy.Eager))
 *
 * Route.make("/settings")
 *   .middleware(requireAuth)
 *   .children(...)
 *   .pipe(Route.provide(AuthLive, ScrollStrategy.None))
 * ```
 *
 * @since 1.0.0
 */
export const provide = (
  ...layers: ReadonlyArray<Layer.Layer.Any>
): (<Path extends string, R, HC extends boolean, HCh extends boolean>(
  builder: RouteBuilder<Path, R, HC, HCh>,
) => RouteBuilder<Path, R, HC, HCh>) => {
  return <Path extends string, R, HC extends boolean, HCh extends boolean>(
    builder: RouteBuilder<Path, R, HC, HCh>,
  ): RouteBuilder<Path, R, HC, HCh> => {
    let renderStrategy: Layer.Layer<RenderStrategy> | undefined = builder.definition.renderStrategy;
    let scrollStrategy: Layer.Layer<ScrollStrategy> | undefined = builder.definition.scrollStrategy;
    const otherLayers: Array<Layer.Layer.Any> = [...builder.definition.layers];

    for (const layer of layers) {
      if (isRenderStrategyLayer(layer)) {
        renderStrategy = layer;
      } else if (isScrollStrategyLayer(layer)) {
        scrollStrategy = layer;
      } else {
        otherLayers.push(layer);
      }
    }

    return makeBuilder<Path, R, HC, HCh>({
      ...builder.definition,
      renderStrategy,
      scrollStrategy,
      layers: otherLayers,
    });
  };
};

// =============================================================================
// Schema Decode at Match Time
// =============================================================================

/**
 * Error produced when path params fail schema decode.
 * @since 1.0.0
 */
export class ParamsDecodeError extends Data.TaggedError("ParamsDecodeError")<{
  readonly path: string;
  readonly rawParams: Record<string, string>;
  readonly cause: unknown;
}> {}

/**
 * Decode raw string params using a Schema.
 * Returns an Effect that succeeds with decoded params or fails with ParamsDecodeError.
 *
 * @since 1.0.0
 */
export const decodeParams = <A, I>(
  schema: Schema.Schema<A, I>,
  rawParams: Record<string, string>,
  path: string,
): Effect.Effect<A, ParamsDecodeError> =>
  Schema.decode(schema)(rawParams as unknown as I).pipe(
    Effect.mapError((cause) => new ParamsDecodeError({ path, rawParams, cause })),
  );

// =============================================================================
// Query Params
// =============================================================================

/**
 * Error produced when query params fail schema decode.
 * @since 1.0.0
 */
export class QueryDecodeError extends Data.TaggedError("QueryDecodeError")<{
  readonly path: string;
  readonly rawQuery: Record<string, string>;
  readonly cause: unknown;
}> {}

/**
 * FiberRef holding the decoded query params for the current route.
 * Set by the Outlet at match time after decoding via the route's query schema.
 * @since 1.0.0
 */
export const CurrentRouteQuery: FiberRef.FiberRef<Record<string, unknown>> = FiberRef.unsafeMake(
  {} as Record<string, unknown>,
);

/**
 * Decode query params from URLSearchParams using a Schema.
 * Only decodes keys present in the schema, ignoring extra query params.
 *
 * @since 1.0.0
 */
export const decodeQuery = <A, I>(
  schema: Schema.Schema<A, I>,
  searchParams: URLSearchParams,
  path: string,
): Effect.Effect<A, QueryDecodeError> => {
  // Convert URLSearchParams to Record<string, string>
  const raw: Record<string, string> = {};
  searchParams.forEach((value, key) => {
    raw[key] = value;
  });

  return Schema.decode(schema)(raw as unknown as I).pipe(
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
export class RouterRedirectError extends Data.TaggedError("RouterRedirect")<{
  readonly path: string;
  readonly replace: boolean;
}> {}

/**
 * Typed failure for middleware forbidden.
 * Produced by `Router.forbidden()`.
 * @since 1.0.0
 */
export class RouterForbiddenError extends Data.TaggedError("RouterForbidden")<{}> {}

/**
 * Redirect to another path. Used in middleware to abort and navigate.
 * Fails the middleware Effect with a typed `RouterRedirect` error.
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
 * @example
 * ```tsx
 * const requireAdmin = Effect.gen(function* () {
 *   const user = yield* getUser()
 *   if (!user.isAdmin) {
 *     return yield* routeForbidden()
 *   }
 * })
 * ```
 *
 * @since 1.0.0
 */
export const routeForbidden = (): Effect.Effect<never, RouterForbiddenError> =>
  Effect.fail(new RouterForbiddenError());

// =============================================================================
// Middleware Runner
// =============================================================================

/**
 * Result of running a middleware chain.
 * @since 1.0.0
 */
export type MiddlewareResult =
  | { readonly _tag: "Continue" }
  | { readonly _tag: "Redirect"; readonly path: string; readonly replace: boolean }
  | { readonly _tag: "Forbidden" }
  | { readonly _tag: "Error"; readonly cause: unknown };

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
export const runMiddlewareChain = (
  middleware: ReadonlyArray<Effect.Effect<void, unknown, unknown>>,
): Effect.Effect<MiddlewareResult, never, never> => {
  if (middleware.length === 0) {
    return Effect.succeed({ _tag: "Continue" } as MiddlewareResult);
  }

  const continueResult: MiddlewareResult = { _tag: "Continue" };

  return Effect.gen(function* () {
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

      if (result._tag !== "Continue") {
        return result;
      }
    }
    return continueResult;
  });
};

/**
 * Extract the middleware result from a Cause.
 * @internal
 */
const extractMiddlewareError = (cause: unknown): MiddlewareResult => {
  // Try to find RouterRedirect or RouterForbidden in the cause
  const error = findFailure(cause);

  if (error !== null && typeof error === "object" && "_tag" in error) {
    if (error._tag === "RouterRedirect") {
      const redirect = unsafeExtractFields<{ path: string; replace: boolean }>(error);
      return { _tag: "Redirect", path: redirect.path, replace: redirect.replace };
    }
    if (error._tag === "RouterForbidden") {
      return { _tag: "Forbidden" };
    }
  }

  return { _tag: "Error", cause };
};

/**
 * Extract the failure value from a Cause-like structure.
 * @internal
 */
const findFailure = (cause: unknown): unknown => {
  if (cause === null || cause === undefined) return cause;
  if (typeof cause !== "object") return cause;

  // Direct tagged error
  if ("_tag" in cause) {
    const tagged = cause as { _tag: string };
    if (tagged._tag === "RouterRedirect" || tagged._tag === "RouterForbidden") {
      return cause;
    }
    // Cause.Fail wraps the error
    if (tagged._tag === "Fail" && "error" in cause) {
      return (cause as { error: unknown }).error;
    }
  }

  return cause;
};
