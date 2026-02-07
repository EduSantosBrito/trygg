/**
 * @since 1.0.0
 * Route matching
 *
 * Resolves relative child paths to absolute paths and builds a trie-based
 * matcher for the route format. All public functions return Effects.
 * RouteMatcher is a Context.Tag with Layer factories for production and test.
 */
import { Context, Effect, Layer, Option, Ref, Schema } from "effect";
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

// Resolved Route
// =============================================================================

/**
 * A route definition with its path resolved to an absolute pattern.
 * Produced by resolving the route tree.
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
 * - `RouteMatcher.make(manifest)`: trie-based matching (production)
 * - `RouteMatcher.test(routes)`: linear scan (testing)
 *
 * @since 1.0.0
 */
export class RouteMatcher extends Context.Tag("trygg/RouteMatcher")<
  RouteMatcher,
  RouteMatcherShape
>() {
  /** Create a RouteMatcher Layer from a RoutesManifest using trie-based matching. */
  static readonly make = (manifest: RoutesManifest): Layer.Layer<RouteMatcher> =>
    Layer.effect(
      RouteMatcher,
      Effect.gen(function* () {
        const resolved = yield* resolveRoutes(manifest);
        const matcher = buildTrieMatcher(resolved);
        return {
          match: (path: string) => Effect.succeed(matcher(path)),
          routes: Effect.succeed(resolved),
        };
      }),
    );

  /** Create a RouteMatcher Layer from resolved routes using linear scan (for testing). */
  static readonly test = (routes: ReadonlyArray<ResolvedRoute>): Layer.Layer<RouteMatcher> =>
    Layer.succeed(RouteMatcher, {
      match: (path: string) => Effect.succeed(linearMatch(routes, path)),
      routes: Effect.succeed(routes),
    });
}

// =============================================================================
// Path Resolution
// =============================================================================

/**
 * Resolve the route tree into a flat list of resolved routes
 * with absolute paths. Uses Ref for collection and Effect.forEach for traversal.
 *
 * @since 1.0.0
 */
export const resolveRoutes = (
  manifest: RoutesManifest,
): Effect.Effect<ReadonlyArray<ResolvedRoute>> =>
  Effect.gen(function* () {
    const resultRef = yield* Ref.make<ReadonlyArray<ResolvedRoute>>([]);
    yield* Effect.forEach(manifest.routes, (route) => resolveRoute(route, "", [], resultRef), {
      concurrency: "unbounded",
    });
    return yield* Ref.get(resultRef);
  });

/**
 * Recursively resolve a route and its children.
 * @internal
 */
const resolveRoute = (
  definition: RouteDefinition,
  parentPath: string,
  ancestors: ReadonlyArray<ResolvedRoute>,
  resultRef: Ref.Ref<ReadonlyArray<ResolvedRoute>>,
): Effect.Effect<void> =>
  Effect.gen(function* () {
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
// Segment Parsing
// =============================================================================

/** @internal */
interface PathSegment {
  readonly type: "static" | "param" | "wildcard" | "catchAllRequired";
  readonly value: string;
}

/** @internal */
const parsePattern = (pattern: string): { segments: PathSegment[]; paramNames: string[] } => {
  const segments: PathSegment[] = [];
  const paramNames: string[] = [];

  const parts = pattern
    .replace(/^\/|\/$/g, "")
    .split("/")
    .filter(Boolean);

  for (const part of parts) {
    if (part.startsWith(":") && part.endsWith("*")) {
      const name = part.slice(1, -1);
      segments.push({ type: "wildcard", value: name });
      paramNames.push(name);
    } else if (part.startsWith(":") && part.endsWith("+")) {
      const name = part.slice(1, -1);
      segments.push({ type: "catchAllRequired", value: name });
      paramNames.push(name);
    } else if (part.startsWith(":")) {
      const name = part.slice(1);
      segments.push({ type: "param", value: name });
      paramNames.push(name);
    } else {
      segments.push({ type: "static", value: part });
    }
  }

  return { segments, paramNames };
};

// =============================================================================
// Trie-Based Matching
// =============================================================================

/** @internal */
interface CompiledRoute {
  readonly resolved: ResolvedRoute;
  readonly segments: ReadonlyArray<PathSegment>;
  readonly score: number;
}

/** @internal */
interface TrieNode {
  readonly staticChildren: Map<string, TrieNode>;
  paramChild: { node: TrieNode; name: string } | undefined;
  wildcardChild: { node: TrieNode; name: string } | undefined;
  routes: CompiledRoute[];
}

/** @internal */
const createTrieNode = (): TrieNode => ({
  staticChildren: new Map(),
  paramChild: undefined,
  wildcardChild: undefined,
  routes: [],
});

/** @internal */
const scoreRoute = (segments: ReadonlyArray<PathSegment>): number => {
  let score = 0;
  for (const segment of segments) {
    if (segment.type === "static") {
      score += 3;
    } else if (segment.type === "param") {
      score += 2;
    } else if (segment.type === "catchAllRequired") {
      score += 1.5;
    } else if (segment.type === "wildcard") {
      score += 1;
    }
  }
  score += segments.length * 0.1;
  return score;
};

/** @internal */
const insertIntoTrie = (root: TrieNode, route: CompiledRoute): void => {
  let current = root;

  for (const segment of route.segments) {
    if (segment.type === "static") {
      let child = current.staticChildren.get(segment.value);
      if (child === undefined) {
        child = createTrieNode();
        current.staticChildren.set(segment.value, child);
      }
      current = child;
    } else if (segment.type === "param") {
      if (current.paramChild === undefined) {
        current.paramChild = { node: createTrieNode(), name: segment.value };
      }
      current = current.paramChild.node;
    } else if (segment.type === "wildcard" || segment.type === "catchAllRequired") {
      if (current.wildcardChild === undefined) {
        current.wildcardChild = { node: createTrieNode(), name: segment.value };
      }
      current = current.wildcardChild.node;
      break; // Wildcard terminates
    }
  }

  current.routes.push(route);
};

/** @internal */
interface TrieMatchResult {
  readonly route: CompiledRoute;
  readonly params: RouteParams;
}

/** @internal */
const walkTrie = (
  node: TrieNode,
  pathParts: ReadonlyArray<string>,
  pathIndex: number,
  params: RouteParams,
): TrieMatchResult[] => {
  const results: TrieMatchResult[] = [];

  if (pathIndex >= pathParts.length) {
    for (const route of node.routes) {
      const lastSegment = route.segments[route.segments.length - 1];
      if (
        lastSegment?.type !== "wildcard" &&
        lastSegment?.type !== "catchAllRequired" &&
        route.segments.length === pathIndex
      ) {
        results.push({ route, params: { ...params } });
      }
    }
    // Check wildcard child for zero-segment matches
    if (node.wildcardChild !== undefined) {
      const newParams = { ...params, [node.wildcardChild.name]: "" };
      for (const route of node.wildcardChild.node.routes) {
        const lastSeg = route.segments[route.segments.length - 1];
        if (lastSeg?.type === "wildcard") {
          results.push({ route, params: { ...newParams } });
        }
      }
    }
    return results;
  }

  const currentPart = pathParts[pathIndex];
  if (currentPart === undefined) return results;

  // Priority 1: Static match
  const staticChild = node.staticChildren.get(currentPart);
  if (staticChild !== undefined) {
    results.push(...walkTrie(staticChild, pathParts, pathIndex + 1, params));
  }

  // Priority 2: Param match
  if (node.paramChild !== undefined) {
    const newParams = { ...params, [node.paramChild.name]: currentPart };
    results.push(...walkTrie(node.paramChild.node, pathParts, pathIndex + 1, newParams));
  }

  // Priority 3: Wildcard match
  if (node.wildcardChild !== undefined) {
    const rest = pathParts.slice(pathIndex).join("/");
    const newParams = { ...params, [node.wildcardChild.name]: rest };
    for (const route of node.wildcardChild.node.routes) {
      const lastSeg = route.segments[route.segments.length - 1];
      if (lastSeg?.type === "catchAllRequired" && rest === "") {
        continue;
      }
      results.push({ route, params: { ...newParams } });
    }
  }

  return results;
};

/**
 * Build a trie-based match function from resolved routes.
 * @internal
 */
export const buildTrieMatcher = (
  resolved: ReadonlyArray<ResolvedRoute>,
): ((path: string) => Option.Option<RouteMatch>) => {
  const compiled: CompiledRoute[] = [];
  for (const route of resolved) {
    const { segments } = parsePattern(route.path);
    compiled.push({
      resolved: route,
      segments,
      score: scoreRoute(segments),
    });
  }

  const sorted = [...compiled].sort((a, b) => {
    if (a.segments.length !== b.segments.length) {
      return b.segments.length - a.segments.length;
    }
    return b.score - a.score;
  });

  const root = createTrieNode();
  for (const route of sorted) {
    insertIntoTrie(root, route);
  }

  return (path: string): Option.Option<RouteMatch> => {
    const normalizedPath = path.split("?")[0] ?? path;
    const pathParts = normalizedPath
      .replace(/^\/|\/$/g, "")
      .split("/")
      .filter(Boolean);

    if (pathParts.length === 0) {
      const rootMatches = walkTrie(root, [], 0, {});
      if (rootMatches.length > 0) {
        const best = rootMatches[0];
        if (best !== undefined) {
          return Option.some({ route: best.route.resolved, params: best.params });
        }
      }
      return Option.none();
    }

    const matches = walkTrie(root, pathParts, 0, {});
    if (matches.length === 0) return Option.none();

    const sortedMatches = matches.sort((a, b) => {
      if (a.route.segments.length !== b.route.segments.length) {
        return b.route.segments.length - a.route.segments.length;
      }
      return b.route.score - a.route.score;
    });

    const best = sortedMatches[0];
    if (best === undefined) return Option.none();

    return Option.some({ route: best.route.resolved, params: best.params });
  };
};

/**
 * Linear scan match function for testing.
 * @internal
 */
const linearMatch = (
  routes: ReadonlyArray<ResolvedRoute>,
  path: string,
): Option.Option<RouteMatch> => {
  const normalizedPath = path.split("?")[0] ?? path;
  const pathParts = normalizedPath
    .replace(/^\/|\/$/g, "")
    .split("/")
    .filter(Boolean);

  for (const route of routes) {
    const { segments } = parsePattern(route.path);
    const params: RouteParams = {};
    let matched = true;

    if (segments.length === 0 && pathParts.length === 0) {
      return Option.some({ route, params });
    }

    let pathIdx = 0;
    for (let i = 0; i < segments.length; i++) {
      const seg = segments[i];
      if (seg === undefined) {
        matched = false;
        break;
      }

      if (seg.type === "static") {
        if (pathParts[pathIdx] !== seg.value) {
          matched = false;
          break;
        }
        pathIdx++;
      } else if (seg.type === "param") {
        const part = pathParts[pathIdx];
        if (part === undefined) {
          matched = false;
          break;
        }
        params[seg.value] = part;
        pathIdx++;
      } else if (seg.type === "wildcard") {
        params[seg.value] = pathParts.slice(pathIdx).join("/");
        pathIdx = pathParts.length;
      } else if (seg.type === "catchAllRequired") {
        const rest = pathParts.slice(pathIdx).join("/");
        if (rest === "") {
          matched = false;
          break;
        }
        params[seg.value] = rest;
        pathIdx = pathParts.length;
      }
    }

    if (matched && pathIdx === pathParts.length) {
      return Option.some({ route, params });
    }
  }

  return Option.none();
};

// =============================================================================
// Middleware Collection & Execution
// =============================================================================

/**
 * Collect the full middleware chain for a resolved route.
 * Order: parent middleware (root-to-leaf), then route's own middleware (left-to-right).
 *
 * @since 1.0.0
 */
export const collectRouteMiddleware = (
  route: ResolvedRoute,
): ReadonlyArray<Effect.Effect<void, unknown, unknown>> => {
  const chain: Array<Effect.Effect<void, unknown, unknown>> = [];

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

  return Option.fromNullable(rootError);
};

/**
 * Resolve the nearest notFound boundary component.
 * Walks from route → ancestors → root.
 *
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

  return Option.fromNullable(rootNotFound);
};

/**
 * Resolve the nearest forbidden boundary component.
 * Walks from route → ancestors → root.
 *
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

  return Option.fromNullable(rootForbidden);
};

/**
 * Resolve the nearest loading component.
 * Walks from route → ancestors.
 *
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
 * @since 1.0.0
 */
export const resolveRenderStrategy = (
  route: ResolvedRoute,
): Layer.Layer<RenderStrategy> | undefined => {
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
 * @since 1.0.0
 */
export const resolveScrollStrategy = (
  route: ResolvedRoute,
): Layer.Layer<ScrollStrategy> | undefined => {
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
 * @since 1.0.0
 */
export const decodeRouteParams = (
  route: ResolvedRoute,
  rawParams: RouteParams,
): Effect.Effect<Record<string, unknown>, ParamsDecodeError> => {
  const schema = route.definition.paramsSchema;

  if (schema === undefined) {
    return Effect.succeed(rawParams as Record<string, unknown>);
  }

  return Schema.decode(schema as Schema.Schema<Record<string, unknown>, unknown>)(
    rawParams as unknown,
  ).pipe(Effect.mapError((cause) => new ParamsDecodeError({ path: route.path, rawParams, cause })));
};

/**
 * Decode query params using the route's query schema.
 * If no schema is defined, returns empty object.
 *
 * @since 1.0.0
 */
export const decodeRouteQuery = (
  route: ResolvedRoute,
  searchParams: URLSearchParams,
): Effect.Effect<Record<string, unknown>, QueryDecodeError> => {
  const schema = route.definition.querySchema;

  if (schema === undefined) {
    return Effect.succeed({} as Record<string, unknown>);
  }

  const raw: Record<string, string> = {};
  searchParams.forEach((value, key) => {
    raw[key] = value;
  });

  return Schema.decode(schema as Schema.Schema<Record<string, unknown>, unknown>)(
    raw as unknown,
  ).pipe(
    Effect.mapError((cause) => new QueryDecodeError({ path: route.path, rawQuery: raw, cause })),
  );
};

// =============================================================================
// Sync Matcher (Test Utility)
// =============================================================================

/**
 * Synchronous matcher interface for tests.
 * @since 1.0.0
 */
export interface SyncMatcher {
  readonly match: (path: string) => Option.Option<RouteMatch>;
  readonly routes: ReadonlyArray<ResolvedRoute>;
}

/**
 * Create a trie-based matcher from a manifest.
 * Resolves the route tree and builds a sync match function.
 * Intended for unit tests that don't need the RouteMatcher service Layer.
 *
 * @since 1.0.0
 */
export const createMatcher = (
  manifest: RoutesManifest,
): Effect.Effect<SyncMatcher> =>
  Effect.map(resolveRoutes(manifest), (resolved) => ({
    match: buildTrieMatcher(resolved),
    routes: resolved,
  }));
