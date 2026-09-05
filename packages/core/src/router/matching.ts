/**
 * Route matching helpers for `trygg/router`.
 *
 * @remarks
 * Owner module for route resolution and matching. This module owns the matcher
 * factory, the helpers that flatten nested route trees, and the boundary,
 * middleware, and decode utilities built on top of resolved matches.
 *
 * @see ./matching.docs.md - Source-owned topic guide
 * @since 1.0.0
 * @module trygg/router/matching
 */
import { Effect, Option, Predicate, Schema } from "effect";
import type { Layer as LayerType } from "effect/Layer";
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
import type { ComponentInput, DecodedRouteParamsByPattern, RouteParams } from "./types.js";
import {
  compileRoutePathPattern,
  compareCompiledRoutePathPatterns,
  type CompiledRoutePathPattern,
  type InvalidRoutePathEncoding,
  type InvalidRoutePathPattern,
} from "./path-pattern.js";
import * as RoutePathPattern from "./path-pattern.js";

const decodeUnknownEffect = Schema.decodeUnknownEffect;

const fromNullable = <A>(value: A | null | undefined): Option.Option<A> =>
  value === null || value === undefined ? Option.none() : Option.some(value);

const isSchemaTop = (value: unknown): value is Schema.Top => Predicate.hasProperty(value, "ast");

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
 * `RouteMatcherShape` is the canonical effectful matching contract shared by
 * direct callers, the Outlet, and the injectable service.
 *
 * @internal
 * @since 1.0.0
 */
export interface RouteMatcherShape {
  /** Find matching route for a path */
  readonly match: (
    path: string,
  ) => Effect.Effect<Option.Option<RouteMatch>, InvalidRoutePathEncoding>;
  /** All resolved routes */
  readonly routes: Effect.Effect<ReadonlyArray<ResolvedRoute>>;
}

/**
 * RouteMatcher — configured route matching operations.
 *
 * @remarks
 * Construct a matcher directly from a route manifest or a pre-resolved route
 * array. The owner keeps configuration and compiled matcher identity explicit
 * without introducing an unused Context service.
 *
 * - `RouteMatcher.make(manifest)`: resolves a manifest, then creates a linear-scan matcher
 * - `RouteMatcher.fromResolved(routes)`: linear-scan matching over pre-resolved routes
 *
 * @example
 * ```ts
 * const matcher = yield* RouteMatcher.make(manifest)
 * ```
 *
 * @category Route Matching
 * @public
 * @since 1.0.0
 */
export const RouteMatcher = {
  /** Resolve a manifest and create its canonical matcher. */
  make: (manifest: RoutesManifest): Effect.Effect<RouteMatcherShape, InvalidRoutePathPattern> =>
    Effect.gen(function* () {
      const resolved = yield* resolveRoutes(manifest);
      return yield* RouteMatcher.fromResolved(resolved);
    }),

  /** Create a matcher over already-resolved routes. */
  fromResolved: (
    routes: ReadonlyArray<ResolvedRoute>,
  ): Effect.Effect<RouteMatcherShape, InvalidRoutePathPattern> => makeService(routes),
};

// =============================================================================
// Path Resolution
// =============================================================================

/**
 * Resolve the route tree into a flat list of resolved routes
 * with absolute paths in depth-first declaration order.
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
  (manifest: RoutesManifest) =>
    Effect.sync(() => {
      const result: Array<ResolvedRoute> = [];
      const stack: Array<{
        readonly definitions: ReadonlyArray<RouteDefinition>;
        readonly parentPath: string;
        readonly ancestors: ReadonlyArray<ResolvedRoute>;
        index: number;
      }> = [{ definitions: manifest.routes, parentPath: "", ancestors: [], index: 0 }];

      // This traversal owns only synchronous, execution-local data. An explicit
      // stack preserves declaration order without child fibers or recursive calls.
      while (stack.length > 0) {
        const frame = stack[stack.length - 1];
        if (frame === undefined) break;
        const definition = frame.definitions[frame.index++];
        if (definition === undefined) {
          stack.pop();
          continue;
        }
        const resolved: ResolvedRoute = {
          path: resolvePath(definition.path, frame.parentPath),
          definition,
          ancestors: frame.ancestors,
        };
        if (definition.component !== undefined || definition.path === IndexMarker) {
          result.push(resolved);
        }
        if (definition.children.length > 0) {
          stack.push({
            definitions: definition.children,
            parentPath: resolved.path,
            ancestors: [...frame.ancestors, resolved],
            index: 0,
          });
        }
      }
      return result;
    }),
);

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

const matchCompiledRoutes: (
  routes: ReadonlyArray<CompiledRouteMatcherEntry>,
  path: string,
) => Effect.Effect<Option.Option<RouteMatch>, InvalidRoutePathEncoding> = Effect.fn(
  "RouteMatching.matchCompiledRoutes",
)(function* (routes: ReadonlyArray<CompiledRouteMatcherEntry>, path: string) {
  if (routes.length === 0) return Option.none();
  const parts = yield* RoutePathPattern.decodePathname(path);
  for (const route of routes) {
    const match = RoutePathPattern.matchDecoded(route.pattern, parts);
    if (Option.isSome(match)) {
      return Option.some({ route: route.route, params: match.value.params });
    }
  }

  return Option.none();
});

/** Build the canonical effectful matcher over an already-resolved route list. */
const makeService = (
  routes: ReadonlyArray<ResolvedRoute>,
): Effect.Effect<RouteMatcherShape, InvalidRoutePathPattern> =>
  Effect.map(compileRoutesForMatching(routes), (compiled) => {
    const sorted = sortCompiledRoutesForMatching(compiled);
    return {
      match: (path: string) => matchCompiledRoutes(sorted, path),
      routes: Effect.succeed(routes),
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
): Effect.Effect<MiddlewareResult, unknown, never> => {
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

/** Decode each route's own params and publish cumulative values by active pattern. */
export const decodeActiveRouteParams: (
  match: RouteMatch,
) => Effect.Effect<DecodedRouteParamsByPattern, ParamsDecodeError | InvalidRoutePathPattern> =
  Effect.fnUntraced(function* (match: RouteMatch) {
    const decoded = new Map<string, Record<string, unknown>>();
    const inherited: Record<string, unknown> = {};
    const activeRoutes = [...match.route.ancestors, match.route];

    for (const route of activeRoutes) {
      const ownParamNames =
        route.definition.path === IndexMarker
          ? []
          : (yield* compileRoutePathPattern(route.definition.path)).paramNames;
      const rawParams: RouteParams = {};
      for (const name of ownParamNames) {
        const value = match.params[name];
        if (value !== undefined) rawParams[name] = value;
      }
      Object.assign(inherited, yield* decodeRouteParams(route, rawParams));
      decoded.set(route.path, { ...inherited });
    }

    return decoded;
  });

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
