/**
 * @since 1.0.0
 * Route matching logic for effect-ui router
 */
import type { RouteDefinition, RouteMatch, RouteParams } from "./types.js"

/**
 * Parsed path segment
 * @internal
 */
interface PathSegment {
  readonly type: "static" | "param" | "wildcard"
  readonly value: string
}

/**
 * Compiled route pattern for efficient matching
 * @internal
 */
interface CompiledRoute {
  readonly definition: RouteDefinition
  readonly segments: ReadonlyArray<PathSegment>
  readonly paramNames: ReadonlyArray<string>
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
  const segments: PathSegment[] = []
  const paramNames: string[] = []
  
  // Remove leading/trailing slashes and split
  const parts = pattern.replace(/^\/|\/$/g, "").split("/").filter(Boolean)
  
  for (const part of parts) {
    if (part.startsWith(":")) {
      // Named parameter: :id
      const name = part.slice(1)
      segments.push({ type: "param", value: name })
      paramNames.push(name)
    } else if (part.startsWith("[...") && part.endsWith("]")) {
      // Catch-all: [...path]
      const name = part.slice(4, -1)
      segments.push({ type: "wildcard", value: name })
      paramNames.push(name)
    } else if (part.startsWith("[") && part.endsWith("]")) {
      // Dynamic segment: [id]
      const name = part.slice(1, -1)
      segments.push({ type: "param", value: name })
      paramNames.push(name)
    } else if (part === "*") {
      // Simple wildcard
      segments.push({ type: "wildcard", value: "*" })
      paramNames.push("*")
    } else {
      // Static segment
      segments.push({ type: "static", value: part })
    }
  }
  
  return { segments, paramNames }
}

/**
 * Compile a route definition for efficient matching
 * @internal
 */
const compileRoute = (definition: RouteDefinition): CompiledRoute => {
  const { segments, paramNames } = parsePattern(definition.path)
  return { definition, segments, paramNames }
}

/**
 * Try to match a path against a compiled route
 * Returns params if matched, null otherwise
 * @internal
 */
const matchRoute = (
  compiled: CompiledRoute,
  pathParts: ReadonlyArray<string>
): RouteParams | null => {
  const params: Record<string, string> = {}
  const { segments } = compiled
  
  let pathIndex = 0
  
  for (let segIndex = 0; segIndex < segments.length; segIndex++) {
    const segment = segments[segIndex]
    if (segment === undefined) continue
    
    if (segment.type === "wildcard") {
      // Wildcard consumes rest of path
      const rest = pathParts.slice(pathIndex).join("/")
      params[segment.value] = rest
      return params
    }
    
    if (pathIndex >= pathParts.length) {
      // Path is shorter than pattern
      return null
    }
    
    const pathPart = pathParts[pathIndex]
    if (pathPart === undefined) return null
    
    if (segment.type === "static") {
      // Must match exactly
      if (pathPart !== segment.value) {
        return null
      }
    } else if (segment.type === "param") {
      // Capture parameter
      params[segment.value] = pathPart
    }
    
    pathIndex++
  }
  
  // Check if entire path was consumed (unless last segment was wildcard)
  const lastSegment = segments[segments.length - 1]
  if (lastSegment?.type !== "wildcard" && pathIndex !== pathParts.length) {
    return null
  }
  
  return params
}

/**
 * Score a route match for priority sorting
 * Higher score = more specific = higher priority
 * @internal
 */
const scoreRoute = (compiled: CompiledRoute): number => {
  let score = 0
  
  for (const segment of compiled.segments) {
    if (segment.type === "static") {
      score += 3  // Static segments are most specific
    } else if (segment.type === "param") {
      score += 2  // Params are medium specificity
    } else if (segment.type === "wildcard") {
      score += 1  // Wildcards are least specific
    }
  }
  
  // Longer routes generally more specific
  score += compiled.segments.length * 0.1
  
  return score
}

/**
 * Route matcher - compiles routes and matches paths
 * @since 1.0.0
 */
export interface RouteMatcher {
  /** Find matching route for a path */
  readonly match: (path: string) => RouteMatch | null
}

/**
 * Create a route matcher from route definitions
 * @since 1.0.0
 */
export const createMatcher = (routes: ReadonlyArray<RouteDefinition>): RouteMatcher => {
  // Compile all routes
  const compiled = routes.map(compileRoute)
  
  // Sort by specificity (most specific first)
  compiled.sort((a, b) => scoreRoute(b) - scoreRoute(a))
  
  return {
    match: (path: string): RouteMatch | null => {
      // Normalize path
      const normalizedPath = path.split("?")[0] ?? path // Remove query string
      const pathParts = normalizedPath.replace(/^\/|\/$/g, "").split("/").filter(Boolean)
      
      // Try each route in priority order
      for (const route of compiled) {
        const params = matchRoute(route, pathParts)
        if (params !== null) {
          return {
            route: route.definition,
            params,
            parents: []  // TODO: Handle nested routes
          }
        }
      }
      
      return null
    }
  }
}

/**
 * Parse path and query from a full URL path
 * @since 1.0.0
 */
export const parsePath = (fullPath: string): { path: string; query: URLSearchParams } => {
  const [path, queryString] = fullPath.split("?")
  return {
    path: path ?? "/",
    query: new URLSearchParams(queryString ?? "")
  }
}

/**
 * Build a full path from path and query
 * @since 1.0.0
 */
export const buildPath = (path: string, query?: Record<string, string>): string => {
  if (!query || Object.keys(query).length === 0) {
    return path
  }
  const params = new URLSearchParams(query)
  return `${path}?${params.toString()}`
}
