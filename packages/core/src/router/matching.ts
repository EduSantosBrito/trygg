/**
 * Route matching helpers for `trygg/router`.
 *
 * @remarks
 * Owner module for route resolution and matching. This module owns the matcher
 * service, the helpers that flatten nested route trees, and the boundary,
 * middleware, and decode utilities built on top of resolved matches.
 *
 * @see ./matching.docs.md - Source-owned topic guide
 * @since 1.0.0
 * @module trygg/router/matching
 */
import { Effect, Layer, Option, Predicate, Ref, Schema } from "effect";
import type { Layer as LayerType } from "effect/Layer";
import * as Context from "effect/Context";
import { unsafeEraseR } from "../internal/unsafe.js";
import type { RouteDefinition } from "./route.js";
import {
  IndexMarker,
  runMiddlewareChain,
  type MiddlewareResult,
  ParamsDecodeError,
  QueryDecodeError,
} from "./route.js";
import type { RoutesManifest } from "./routes.js";
import type { RenderStrategy } from "./render-strategy.js";
import type { ScrollStrategy } from "./scroll-strategy.js";
import type { ComponentInput, RouteParams } from "./types.js";
import {
  compileRoutePathPattern,
  compareCompiledRoutePathPatterns,
  matchCompiledRoutePathPattern,
  type CompiledRoutePathPattern,
  type InvalidRoutePathPattern,
} from "./path-pattern.js";

const decodeUnknownEffect = Schema.decodeUnknownEffect;

const fromNullable = <A>(value: A | null | undefined): Option.Option<A> =>
  value === null || value === undefined ? Option.none() : Option.some(value);

const isSchemaTop = (value: unknown): value is Schema.Top =>
  typeof value === "object" && value !== null && Predicate.hasProperty(value, "ast");

const toUnknownRecord = (value: unknown): Record<string, unknown> => {
  if (typeof value !== "object" || value === null) {
    return {};
  }
  const out: Record<string, unknown> = {};
  for (const [key, entry] of Object.entries(value)) {
    out[key] = entry;
  }
  return out;
};

// Resolved Route
// =============================================================================

/**
 * A route definition with its path resolved to an absolute pattern.
 * Produced by resolving the route tree.
 *
 * @remarks
 * `ResolvedRoute` is the normalized shape the matcher and outlet operate on
 * after nested route paths have been made absolute.
 *
 * @internal
 * @since 1.0.0
 */
export interface ResolvedRoute {
  /** Absolute path pattern (e.g., "/settings/profile") */
  readonly path: string;
  /** Original route definition */
  readonly definition: RouteDefinition;
  /** Ancestor resolved routes (root first, parent last) */
  readonly ancestors: ReadonlyArray<ResolvedRoute>;
}

// =============================================================================
// Route Match
// =============================================================================

/**
 * Match result for routes.
 *
 * @remarks
 * `RouteMatch` pairs a resolved route with the raw string params extracted by
 * the matcher before schema decode happens.
 *
 * @internal
 * @since 1.0.0
 */
export interface RouteMatch {
  /** The matched resolved route */
  readonly route: ResolvedRoute;
  /** Extracted path params (raw strings, not schema-decoded) */
  readonly params: RouteParams;
}

// =============================================================================
// RouteMatcher Service
// =============================================================================

/**
 * RouteMatcher service interface.
 *
 * @remarks
 * `RouteMatcherShape` is the service contract implemented by the production
 * trie matcher and the simpler test matcher.
 *
 * @internal
 * @since 1.0.0
 */
export interface RouteMatcherShape {
  /** Find matching route for a path */
  readonly match: (path: string) => Effect.Effect<Option.Option<RouteMatch>>;
  /** All resolved routes */
  readonly routes: Effect.Effect<ReadonlyArray<ResolvedRoute>>;
}

/**
 * RouteMatcher — route matching logic as a testable service.
 *
 * - `RouteMatcher.make(manifest)`: resolves a manifest, then linear-scan matching (production)
 * - `RouteMatcher.test(routes)`: linear-scan matching over pre-resolved routes (testing)
 *
 * @remarks
 * Use `RouteMatcher` when you want matching as an injectable service instead of
 * constructing sync matchers directly.
 *
 * @example
 * ```ts
 * const matcher = yield* RouteMatcher
 * ```
 *
 * @category Route Matching
 * @public
 * @since 1.0.0
 */
export class RouteMatcher extends Context.Service<
  RouteMatcher,
  {
    readonly match: (path: string) => Effect.Effect<Option.Option<RouteMatch>>;
    readonly routes: Effect.Effect<ReadonlyArray<ResolvedRoute>>;
  }
>()("trygg/RouteMatcher") {
  /** Create a RouteMatcher Layer from a RoutesManifest using linear-scan matching. */
  static readonly make = (
    manifest: RoutesManifest,
  ): LayerType<RouteMatcher, InvalidRoutePathPattern> =>
    Layer.effect(
      RouteMatcher,
      Effect.gen(function* () {
        const resolved = yield* resolveRoutes(manifest);
        const matcher = yield* makeLinearMatcher(resolved);
        return {
          match: matcher.match,
          routes: Effect.succeed(resolved),
        };
      }).pipe(Effect.annotateLogs({ service: "RouteMatcher", constructor: "make" })),
    );

  /** Create a RouteMatcher Layer from resolved routes using linear scan (for testing). */
  static readonly test = (
    routes: ReadonlyArray<ResolvedRoute>,
  ): LayerType<RouteMatcher, InvalidRoutePathPattern> =>
    Layer.effect(
      RouteMatcher,
      Effect.gen(function* () {
        const matcher = yield* makeLinearMatcher(routes);
        return {
          match: matcher.match,
          routes: Effect.succeed(routes),
        };
      }).pipe(Effect.annotateLogs({ service: "RouteMatcher", constructor: "test" })),
    );
}

// =============================================================================
// Path Resolution
// =============================================================================

/**
 * Resolve the route tree into a flat list of resolved routes
 * with absolute paths. Uses Ref for collection and Effect.forEach for traversal.
 *
 * @remarks
 * `resolveRoutes` is the normalization step that turns nested route builders
 * into the absolute patterns consumed by the matcher and outlet.
 *
 * @example
 * ```ts
 * const resolved = yield* resolveRoutes(routes.manifest)
 * ```
 *
 * @category Route Matching
 * @public
 * @since 1.0.0
 */
export const resolveRoutes: (
  manifest: RoutesManifest,
) => Effect.Effect<ReadonlyArray<ResolvedRoute>> = Effect.fn("RouteMatching.resolveRoutes")(
  function* (manifest: RoutesManifest) {
    const resultRef = yield* Ref.make<ReadonlyArray<ResolvedRoute>>([]);
    yield* Effect.forEach(manifest.routes, (route) => resolveRoute(route, "", [], resultRef), {
      concurrency: "unbounded",
    });
    return yield* Ref.get(resultRef);
  },
);

/**
 * Recursively resolve a route and its children.
 * @internal
 */
const resolveRoute: (
  definition: RouteDefinition,
  parentPath: string,
  ancestors: ReadonlyArray<ResolvedRoute>,
  resultRef: Ref.Ref<ReadonlyArray<ResolvedRoute>>,
) => Effect.Effect<void> = Effect.fn("RouteMatching.resolveRoute")(function* (
  definition: RouteDefinition,
  parentPath: string,
  ancestors: ReadonlyArray<ResolvedRoute>,
  resultRef: Ref.Ref<ReadonlyArray<ResolvedRoute>>,
) {
  const resolvedPath = resolvePath(definition.path, parentPath);

  const resolved: ResolvedRoute = {
    path: resolvedPath,
    definition,
    ancestors,
  };

  // Only add to flat list if this route has a component (leaf) or is an index route
  if (definition.component !== undefined || definition.path === IndexMarker) {
    yield* Ref.update(resultRef, (arr) => [...arr, resolved]);
  }

  // Recursively resolve children
  yield* Effect.forEach(
    definition.children,
    (child) => resolveRoute(child, resolvedPath, [...ancestors, resolved], resultRef),
    { concurrency: "unbounded" },
  );
});

/**
 * Resolve a route path against its parent path.
 * @internal
 */
const resolvePath = (path: string | typeof IndexMarker, parentPath: string): string => {
  if (path === IndexMarker) {
    return parentPath || "/";
  }

  if (parentPath === "") {
    return path;
  }

  return parentPath + path;
};

// =============================================================================
// Path Pattern Matching
// =============================================================================

interface CompiledRouteMatcherEntry {
  readonly route: ResolvedRoute;
  readonly pattern: CompiledRoutePathPattern;
}

const compileRoutesForMatching = (
  routes: ReadonlyArray<ResolvedRoute>,
): Effect.Effect<ReadonlyArray<CompiledRouteMatcherEntry>, InvalidRoutePathPattern> =>
  Effect.forEach(routes, (route) =>
    Effect.map(compileRoutePathPattern(route.path), (pattern) => ({ route, pattern })),
  );

const sortCompiledRoutesForMatching = (
  routes: ReadonlyArray<CompiledRouteMatcherEntry>,
): ReadonlyArray<CompiledRouteMatcherEntry> =>
  [...routes].sort((left, right) => compareCompiledRoutePathPatterns(left.pattern, right.pattern));

const linearMatchCompiled = (
  routes: ReadonlyArray<CompiledRouteMatcherEntry>,
  path: string,
): Option.Option<RouteMatch> => {
  for (const route of routes) {
    const match = matchCompiledRoutePathPattern(route.pattern, path);
    if (Option.isSome(match)) {
      return Option.some({ route: route.route, params: match.value.params });
    }
  }

  return Option.none();
};

const makeLinearMatcher = (
  routes: ReadonlyArray<ResolvedRoute>,
): Effect.Effect<
  { readonly match: (path: string) => Effect.Effect<Option.Option<RouteMatch>> },
  InvalidRoutePathPattern
> =>
  Effect.map(compileRoutesForMatching(routes), (compiled) => {
    const sorted = sortCompiledRoutesForMatching(compiled);
    return {
      match: (path: string) => Effect.succeed(linearMatchCompiled(sorted, path)),
    };
  });

// =============================================================================
// Middleware Collection & Execution
// =============================================================================

/**
 * Collect the full middleware chain for a resolved route.
 * Order: parent middleware (root-to-leaf), then route's own middleware (left-to-right).
 *
 * @remarks
 * Advanced helper used by the outlet and tests to inspect the exact middleware
 * sequence for a resolved route.
 *
 * @internal
 * @since 1.0.0
 */
export const collectRouteMiddleware = (
  route: ResolvedRoute,
): ReadonlyArray<Effect.Effect<void, unknown, never>> => {
  const chain: Array<Effect.Effect<void, unknown, never>> = [];

  for (const ancestor of route.ancestors) {
    for (const m of ancestor.definition.middleware) {
      chain.push(m);
    }
  }

  for (const m of route.definition.middleware) {
    chain.push(m);
  }

  return chain;
};

/**
 * Run the full middleware chain for a resolved route.
 *
 * @remarks
 * Advanced helper that executes the collected middleware chain and returns the
 * router's normalized middleware result.
 *
 * @internal
 * @since 1.0.0
 */
export const runRouteMiddleware = (
  route: ResolvedRoute,
): Effect.Effect<MiddlewareResult, never, never> => {
  const chain = collectRouteMiddleware(route);
  return runMiddlewareChain(chain);
};

// =============================================================================
// Boundary Resolution (Nearest-Wins)
// =============================================================================

/**
 * Resolve the nearest error boundary component.
 * Walks from route → ancestors → root.
 *
 * @remarks
 * Advanced helper used by the outlet to honor nearest-wins error boundary
 * semantics.
 *
 * @internal
 * @since 1.0.0
 */
export const resolveErrorBoundary = (
  route: ResolvedRoute,
  rootError: ComponentInput | undefined,
): Option.Option<ComponentInput> => {
  if (route.definition.error !== undefined) {
    return Option.some(route.definition.error);
  }

  for (let i = route.ancestors.length - 1; i >= 0; i--) {
    const ancestor = route.ancestors[i];
    if (ancestor !== undefined && ancestor.definition.error !== undefined) {
      return Option.some(ancestor.definition.error);
    }
  }

  return fromNullable(rootError);
};

/**
 * Resolve the nearest notFound boundary component.
 * Walks from route → ancestors → root.
 *
 * @remarks
 * Advanced helper used by the outlet to honor nearest-wins not-found boundary
 * semantics.
 *
 * @internal
 * @since 1.0.0
 */
export const resolveNotFoundBoundary = (
  route: ResolvedRoute,
  rootNotFound: ComponentInput | undefined,
): Option.Option<ComponentInput> => {
  if (route.definition.notFound !== undefined) {
    return Option.some(route.definition.notFound);
  }

  for (let i = route.ancestors.length - 1; i >= 0; i--) {
    const ancestor = route.ancestors[i];
    if (ancestor !== undefined && ancestor.definition.notFound !== undefined) {
      return Option.some(ancestor.definition.notFound);
    }
  }

  return fromNullable(rootNotFound);
};

/**
 * Resolve the nearest forbidden boundary component.
 * Walks from route → ancestors → root.
 *
 * @remarks
 * Advanced helper used by the outlet to honor nearest-wins forbidden boundary
 * semantics.
 *
 * @internal
 * @since 1.0.0
 */
export const resolveForbiddenBoundary = (
  route: ResolvedRoute,
  rootForbidden: ComponentInput | undefined,
): Option.Option<ComponentInput> => {
  if (route.definition.forbidden !== undefined) {
    return Option.some(route.definition.forbidden);
  }

  for (let i = route.ancestors.length - 1; i >= 0; i--) {
    const ancestor = route.ancestors[i];
    if (ancestor !== undefined && ancestor.definition.forbidden !== undefined) {
      return Option.some(ancestor.definition.forbidden);
    }
  }

  return fromNullable(rootForbidden);
};

/**
 * Resolve the nearest loading component.
 * Walks from route → ancestors.
 *
 * @remarks
 * Advanced helper used by the outlet to choose the loading boundary for a
 * resolved route.
 *
 * @internal
 * @since 1.0.0
 */
export const resolveLoadingBoundary = (route: ResolvedRoute): Option.Option<ComponentInput> => {
  if (route.definition.loading !== undefined) {
    return Option.some(route.definition.loading);
  }

  for (let i = route.ancestors.length - 1; i >= 0; i--) {
    const ancestor = route.ancestors[i];
    if (ancestor !== undefined && ancestor.definition.loading !== undefined) {
      return Option.some(ancestor.definition.loading);
    }
  }

  return Option.none();
};

// =============================================================================
// Render Strategy Resolution (nearest-wins ancestor walk)
// =============================================================================

/**
 * Resolve render strategy for a route: nearest-wins (leaf → ancestors).
 * Returns undefined if no strategy is set in the chain (= default Lazy).
 *
 * Used by the outlet for future strategy-aware dispatch (Server, Island).
 * For Eager/Lazy, the outlet dispatches structurally — this is preparatory.
 *
 * @remarks
 * Advanced helper used by the outlet to locate the nearest render strategy
 * layer in a resolved route chain.
 *
 * @internal
 * @since 1.0.0
 */
export const resolveRenderStrategy = (
  route: ResolvedRoute,
): LayerType<RenderStrategy> | undefined => {
  if (route.definition.renderStrategy !== undefined) {
    return route.definition.renderStrategy;
  }
  for (let i = route.ancestors.length - 1; i >= 0; i--) {
    const ancestor = route.ancestors[i];
    if (ancestor !== undefined && ancestor.definition.renderStrategy !== undefined) {
      return ancestor.definition.renderStrategy;
    }
  }
  return undefined;
};

// =============================================================================
// Scroll Strategy Resolution (nearest-wins ancestor walk)
// =============================================================================

/**
 * Resolve scroll strategy for a route: nearest-wins (leaf → ancestors).
 * Returns undefined if no strategy is set in the chain (= default Auto).
 *
 * Mirrors `resolveRenderStrategy`. Both strategies are Layers provided
 * via `Route.provide()` and resolved via the same nearest-wins pattern.
 *
 * @remarks
 * Advanced helper used by the outlet to locate the nearest scroll strategy
 * layer in a resolved route chain.
 *
 * @internal
 * @since 1.0.0
 */
export const resolveScrollStrategy = (
  route: ResolvedRoute,
): LayerType<ScrollStrategy> | undefined => {
  if (route.definition.scrollStrategy !== undefined) {
    return route.definition.scrollStrategy;
  }
  for (let i = route.ancestors.length - 1; i >= 0; i--) {
    const ancestor = route.ancestors[i];
    if (ancestor !== undefined && ancestor.definition.scrollStrategy !== undefined) {
      return ancestor.definition.scrollStrategy;
    }
  }
  return undefined;
};

// =============================================================================
// Params & Query Decode at Match Time
// =============================================================================

/**
 * Decode path params using the route's params schema.
 * If no schema is defined, returns raw params unchanged.
 *
 * @remarks
 * Advanced helper used after matching, once the router knows which route owns
 * the raw path params.
 *
 * @internal
 * @since 1.0.0
 */
export const decodeRouteParams = (
  route: ResolvedRoute,
  rawParams: RouteParams,
): Effect.Effect<Record<string, unknown>, ParamsDecodeError> => {
  const schema = route.definition.paramsSchema;

  if (schema === undefined || !isSchemaTop(schema)) {
    const params: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(rawParams)) {
      params[key] = value;
    }
    return Effect.succeed(params);
  }

  return unsafeEraseR(
    decodeUnknownEffect(schema)(rawParams).pipe(
      Effect.map(toUnknownRecord),
      Effect.mapError((cause) => new ParamsDecodeError({ path: route.path, rawParams, cause })),
    ),
  );
};

/**
 * Decode query params using the route's query schema.
 * If no schema is defined, returns empty object.
 *
 * @remarks
 * Advanced helper used after matching, once the router knows which route owns
 * the active query schema.
 *
 * @internal
 * @since 1.0.0
 */
export const decodeRouteQuery = (
  route: ResolvedRoute,
  searchParams: URLSearchParams,
): Effect.Effect<Record<string, unknown>, QueryDecodeError> => {
  const schema = route.definition.querySchema;

  if (schema === undefined || !isSchemaTop(schema)) {
    return Effect.succeed({});
  }

  const raw: Record<string, string> = {};
  searchParams.forEach((value, key) => {
    raw[key] = value;
  });

  return unsafeEraseR(
    decodeUnknownEffect(schema)(raw).pipe(
      Effect.map(toUnknownRecord),
      Effect.mapError((cause) => new QueryDecodeError({ path: route.path, rawQuery: raw, cause })),
    ),
  );
};

// =============================================================================
// Sync Matcher (Test Utility)
// =============================================================================

/**
 * Synchronous matcher interface for tests.
 *
 * @remarks
 * `SyncMatcher` is the light-weight matcher shape returned by `createMatcher`
 * for unit tests that do not need the service-based `RouteMatcher`.
 *
 * @internal
 * @since 1.0.0
 */
export interface SyncMatcher {
  readonly match: (path: string) => Option.Option<RouteMatch>;
  readonly routes: ReadonlyArray<ResolvedRoute>;
}

/**
 * Create a matcher from a manifest.
 * Resolves the route tree and builds a sync match function.
 * Intended for unit tests that don't need the RouteMatcher service Layer.
 *
 * @remarks
 * `createMatcher` is the direct test helper for router matching when spinning up
 * the full service layer would be unnecessary.
 *
 * @example
 * ```ts
 * const matcher = yield* createMatcher(routes.manifest)
 * ```
 *
 * @category Route Matching
 * @public
 * @since 1.0.0
 */
export const createMatcher: (
  manifest: RoutesManifest,
) => Effect.Effect<SyncMatcher, InvalidRoutePathPattern> = Effect.fn("RouteMatching.createMatcher")(
  function* (manifest: RoutesManifest) {
    const resolved = yield* resolveRoutes(manifest);
    const compiled = sortCompiledRoutesForMatching(yield* compileRoutesForMatching(resolved));
    return {
      match: (path) => linearMatchCompiled(compiled, path),
      routes: resolved,
    };
  },
);
