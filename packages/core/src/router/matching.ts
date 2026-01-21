/**
 * @since 1.0.0
 * Route matching logic for effect-ui router
 *
 * Uses a segment trie for O(path-depth) matching instead of O(routes) linear scan.
 * Precedence: static segments > params > wildcards
 */
import { Option } from "effect";
import type { RouteDefinition, RouteMatch, RouteParams } from "./types.js";

/**
 * Parsed path segment
 * @internal
 */
interface PathSegment {
  readonly type: "static" | "param" | "wildcard";
  readonly value: string;
}

/**
 * Compiled route pattern for efficient matching
 * @internal
 */
interface CompiledRoute {
  readonly definition: RouteDefinition;
  readonly segments: ReadonlyArray<PathSegment>;
  readonly paramNames: ReadonlyArray<string>;
}

/**
 * Trie node for segment-based route matching
 * @internal
 */
interface TrieNode {
  /** Static segment children keyed by segment value */
  readonly staticChildren: Map<string, TrieNode>;
  /** Single child for param segments (:id, [id]) */
  paramChild: { node: TrieNode; name: string } | undefined;
  /** Single child for wildcard segments (*, [...rest]) */
  wildcardChild: { node: TrieNode; name: string } | undefined;
  /** Routes that terminate at this node, ordered by precedence (most specific first) */
  routes: CompiledRouteWithAncestry[];
}

/**
 * Parse a path pattern into segments
 *
 * Examples:
 * - "/users" → [{ type: "static", value: "users" }]
 * - "/users/:id" → [{ type: "static", value: "users" }, { type: "param", value: "id" }]
 * - "/files/*" → [{ type: "static", value: "files" }, { type: "wildcard", value: "*" }]
 * - "/files/[...path]" → [{ type: "static", value: "files" }, { type: "wildcard", value: "path" }]
 *
 * @internal
 */
const parsePattern = (pattern: string): { segments: PathSegment[]; paramNames: string[] } => {
  const segments: PathSegment[] = [];
  const paramNames: string[] = [];

  // Remove leading/trailing slashes and split
  const parts = pattern
    .replace(/^\/|\/$/g, "")
    .split("/")
    .filter(Boolean);

  for (const part of parts) {
    if (part.startsWith(":")) {
      // Named parameter: :id
      const name = part.slice(1);
      segments.push({ type: "param", value: name });
      paramNames.push(name);
    } else if (part.startsWith("[...") && part.endsWith("]")) {
      // Catch-all: [...path]
      const name = part.slice(4, -1);
      segments.push({ type: "wildcard", value: name });
      paramNames.push(name);
    } else if (part.startsWith("[") && part.endsWith("]")) {
      // Dynamic segment: [id]
      const name = part.slice(1, -1);
      segments.push({ type: "param", value: name });
      paramNames.push(name);
    } else if (part === "*") {
      // Simple wildcard
      segments.push({ type: "wildcard", value: "*" });
      paramNames.push("*");
    } else {
      // Static segment
      segments.push({ type: "static", value: part });
    }
  }

  return { segments, paramNames };
};

/**
 * Compile a route definition for efficient matching
 * @internal
 */
const compileRoute = (definition: RouteDefinition): CompiledRoute => {
  const { segments, paramNames } = parsePattern(definition.path);
  return { definition, segments, paramNames };
};

/**
 * Try to match a path against a compiled route
 * Returns Option.some(params) if matched, Option.none() otherwise
 * @internal
 */
const matchRoute = (
  compiled: CompiledRoute,
  pathParts: ReadonlyArray<string>,
): Option.Option<RouteParams> => {
  const params: Record<string, string> = {};
  const { segments } = compiled;

  let pathIndex = 0;

  for (let segIndex = 0; segIndex < segments.length; segIndex++) {
    const segment = segments[segIndex];
    if (segment === undefined) continue;

    if (segment.type === "wildcard") {
      // Wildcard consumes rest of path
      const rest = pathParts.slice(pathIndex).join("/");
      params[segment.value] = rest;
      return Option.some(params);
    }

    if (pathIndex >= pathParts.length) {
      // Path is shorter than pattern
      return Option.none();
    }

    const pathPart = pathParts[pathIndex];
    if (pathPart === undefined) return Option.none();

    if (segment.type === "static") {
      // Must match exactly
      if (pathPart !== segment.value) {
        return Option.none();
      }
    } else if (segment.type === "param") {
      // Capture parameter
      params[segment.value] = pathPart;
    }

    pathIndex++;
  }

  // Check if entire path was consumed (unless last segment was wildcard)
  const lastSegment = segments[segments.length - 1];
  if (lastSegment?.type !== "wildcard" && pathIndex !== pathParts.length) {
    return Option.none();
  }

  return Option.some(params);
};

/**
 * Score a route match for priority sorting
 * Higher score = more specific = higher priority
 * @internal
 */
const scoreRoute = (compiled: CompiledRoute): number => {
  let score = 0;

  for (const segment of compiled.segments) {
    if (segment.type === "static") {
      score += 3; // Static segments are most specific
    } else if (segment.type === "param") {
      score += 2; // Params are medium specificity
    } else if (segment.type === "wildcard") {
      score += 1; // Wildcards are least specific
    }
  }

  // Longer routes generally more specific
  score += compiled.segments.length * 0.1;

  return score;
};

/**
 * Create an empty trie node
 * @internal
 */
const createTrieNode = (): TrieNode => ({
  staticChildren: new Map(),
  paramChild: undefined,
  wildcardChild: undefined,
  routes: [],
});

/**
 * Insert a compiled route into the trie
 * @internal
 */
const insertIntoTrie = (root: TrieNode, route: CompiledRouteWithAncestry): void => {
  let current = root;

  for (const segment of route.segments) {
    if (segment.type === "static") {
      // Static segment: get or create child node
      let child = current.staticChildren.get(segment.value);
      if (child === undefined) {
        child = createTrieNode();
        current.staticChildren.set(segment.value, child);
      }
      current = child;
    } else if (segment.type === "param") {
      // Param segment: single param child
      if (current.paramChild === undefined) {
        current.paramChild = { node: createTrieNode(), name: segment.value };
      }
      current = current.paramChild.node;
    } else if (segment.type === "wildcard") {
      // Wildcard segment: single wildcard child, terminates matching
      if (current.wildcardChild === undefined) {
        current.wildcardChild = { node: createTrieNode(), name: segment.value };
      }
      current = current.wildcardChild.node;
      // Wildcard consumes rest, so we terminate here
      break;
    }
  }

  // Add route to this node
  current.routes.push(route);
};

/**
 * Build a trie from compiled routes
 * @internal
 */
const buildTrie = (routes: ReadonlyArray<CompiledRouteWithAncestry>): TrieNode => {
  const root = createTrieNode();
  for (const route of routes) {
    insertIntoTrie(root, route);
  }
  return root;
};

/**
 * Match result from trie traversal (internal)
 * @internal
 */
interface TrieMatchResult {
  readonly route: CompiledRouteWithAncestry;
  readonly params: RouteParams;
}

/**
 * Walk the trie to find matching routes for a path
 * Prioritizes: static > param > wildcard
 * Returns all matching routes with their params (best matches first)
 * @internal
 */
const walkTrie = (
  node: TrieNode,
  pathParts: ReadonlyArray<string>,
  pathIndex: number,
  params: RouteParams,
): TrieMatchResult[] => {
  const results: TrieMatchResult[] = [];

  // If we've consumed all path parts, check for routes at this node
  if (pathIndex >= pathParts.length) {
    for (const route of node.routes) {
      // Verify the route pattern length matches (no wildcards)
      const lastSegment = route.segments[route.segments.length - 1];
      if (lastSegment?.type !== "wildcard" && route.segments.length === pathIndex) {
        results.push({ route, params: { ...params } });
      }
    }
    return results;
  }

  const currentPart = pathParts[pathIndex];
  if (currentPart === undefined) return results;

  // Priority 1: Try static match first (most specific)
  const staticChild = node.staticChildren.get(currentPart);
  if (staticChild !== undefined) {
    results.push(...walkTrie(staticChild, pathParts, pathIndex + 1, params));
  }

  // Priority 2: Try param match (medium specificity)
  if (node.paramChild !== undefined) {
    const newParams = { ...params, [node.paramChild.name]: currentPart };
    results.push(...walkTrie(node.paramChild.node, pathParts, pathIndex + 1, newParams));
  }

  // Priority 3: Try wildcard match (least specific, consumes rest)
  if (node.wildcardChild !== undefined) {
    const rest = pathParts.slice(pathIndex).join("/");
    const newParams = { ...params, [node.wildcardChild.name]: rest };
    // Wildcards terminate at this node
    for (const route of node.wildcardChild.node.routes) {
      results.push({ route, params: { ...newParams } });
    }
  }

  return results;
};

/**
 * Route matcher - compiles routes and matches paths
 * @since 1.0.0
 */
export interface RouteMatcher {
  /** Find matching route for a path, returns Option.some(match) or Option.none() */
  readonly match: (path: string) => Option.Option<RouteMatch>;
}

/**
 * Compile routes recursively, flattening nested routes with parent references.
 * For each child route, we store its ancestry for building the parent chain.
 * @internal
 */
interface CompiledRouteWithAncestry extends CompiledRoute {
  /** Ancestor route definitions (root first) */
  readonly ancestors: ReadonlyArray<RouteDefinition>;
  /** Precomputed total depth (own segments + all ancestor segments) */
  readonly totalDepth: number;
  /** Precomputed specificity score */
  readonly score: number;
}

/**
 * Recursively compile routes with ancestry tracking
 * Precomputes totalDepth and score to avoid repeated parsing during navigation
 * @internal
 */
const compileRoutesWithAncestry = (
  routes: ReadonlyArray<RouteDefinition>,
  ancestors: ReadonlyArray<RouteDefinition> = [],
  ancestorDepth: number = 0,
): CompiledRouteWithAncestry[] => {
  const result: CompiledRouteWithAncestry[] = [];

  for (const route of routes) {
    // Compile this route
    const compiled = compileRoute(route);

    // Precompute depth and score once (eliminates parsePattern calls during navigation)
    const totalDepth = ancestorDepth + compiled.segments.length;
    const score = scoreRoute(compiled);

    result.push({ ...compiled, ancestors, totalDepth, score });

    // Recursively compile children with this route added to ancestry
    if (route.children && route.children.length > 0) {
      const childAncestry = [...ancestors, route];
      const childAncestorDepth = ancestorDepth + compiled.segments.length;
      const compiledChildren = compileRoutesWithAncestry(
        route.children,
        childAncestry,
        childAncestorDepth,
      );
      result.push(...compiledChildren);
    }
  }

  return result;
};

/**
 * Create a route matcher from route definitions
 * Uses a segment trie for O(path-depth) matching
 * @since 1.0.0
 */
export const createMatcher = (routes: ReadonlyArray<RouteDefinition>): RouteMatcher => {
  // Compile all routes recursively with ancestry tracking
  const compiled = compileRoutesWithAncestry(routes);

  // Sort by specificity (most specific first) - uses precomputed depth and score
  const sorted = [...compiled].sort((a, b) => {
    // First, compare by total depth (precomputed: route segments + ancestor segments)
    if (a.totalDepth !== b.totalDepth) return b.totalDepth - a.totalDepth;

    // Then by route specificity (precomputed)
    return b.score - a.score;
  });

  // Build trie from sorted routes (preserves precedence within each node)
  const trie = buildTrie(sorted);

  return {
    match: (path: string): Option.Option<RouteMatch> => {
      // Normalize path
      const normalizedPath = path.split("?")[0] ?? path; // Remove query string
      const pathParts = normalizedPath
        .replace(/^\/|\/$/g, "")
        .split("/")
        .filter(Boolean);

      // Walk trie to find matches (already in priority order: static > param > wildcard)
      const matches = walkTrie(trie, pathParts, 0, {});

      if (matches.length === 0) {
        return Option.none();
      }

      // Sort results by precedence (uses precomputed depth + specificity)
      const sortedMatches = matches.sort((a, b) => {
        // Compare by precomputed total depth
        if (a.route.totalDepth !== b.route.totalDepth) {
          return b.route.totalDepth - a.route.totalDepth;
        }
        // Then by precomputed specificity score
        return b.route.score - a.route.score;
      });

      // Build full RouteMatch with parents for the best match
      const best = sortedMatches[0];
      if (best === undefined) return Option.none();

      return buildRouteMatch(best.route, pathParts, best.params);
    },
  };
};

/**
 * Build a full RouteMatch with parent chain
 * @internal
 */
const buildRouteMatch = (
  route: CompiledRouteWithAncestry,
  pathParts: ReadonlyArray<string>,
  params: RouteParams,
): Option.Option<RouteMatch> => {
  // Build the parent chain
  const parents: RouteMatch[] = [];

  for (const ancestor of route.ancestors) {
    const ancestorCompiled = compileRoute(ancestor);
    const prefixLength = ancestorCompiled.segments.length;
    const ancestorParamsOption = matchRoute(ancestorCompiled, pathParts.slice(0, prefixLength));

    if (Option.isSome(ancestorParamsOption)) {
      parents.push({
        route: ancestor,
        params: ancestorParamsOption.value,
        parents: [],
      });
    }
  }

  return Option.some({
    route: route.definition,
    params,
    parents,
  });
};

/**
 * Parse path and query from a full URL path
 * @since 1.0.0
 */
export const parsePath = (fullPath: string): { path: string; query: URLSearchParams } => {
  const [path, queryString] = fullPath.split("?");
  return {
    path: path ?? "/",
    query: new URLSearchParams(queryString ?? ""),
  };
};

/**
 * Build a full path from path and query
 * @since 1.0.0
 */
export const buildPath = (path: string, query?: Record<string, string>): string => {
  if (!query || Object.keys(query).length === 0) {
    return path;
  }
  const params = new URLSearchParams(query);
  return `${path}?${params.toString()}`;
};
