/**
 * @since 1.0.0
 * Utility functions for router
 *
 * All functions return Effects for consistency with the Effect-first approach.
 */
import { Effect } from "effect";

// =============================================================================
// Path Utilities
// =============================================================================

/**
 * Parse path and query from a full URL path.
 * @since 1.0.0
 */
export const parsePath = (
  fullPath: string,
): Effect.Effect<{ path: string; query: URLSearchParams }> =>
  Effect.sync(() => {
    const [pathWithQuery] = fullPath.split("#");
    const [path, queryString] = (pathWithQuery ?? fullPath).split("?");
    return {
      path: path ?? "/",
      query: new URLSearchParams(queryString ?? ""),
    };
  });

/**
 * Build a full path from path and optional query record.
 * @since 1.0.0
 */
export const buildPath = (path: string, query?: Record<string, string>): Effect.Effect<string> =>
  Effect.sync(() => {
    if (!query || Object.keys(query).length === 0) {
      return path;
    }
    const params = new URLSearchParams(query);
    return `${path}?${params.toString()}`;
  });
