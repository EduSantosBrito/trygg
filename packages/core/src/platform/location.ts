/**
 * @since 1.0.0
 * Location Service
 *
 * Read current URL state.
 */
import { Context, Data, Effect, Layer } from "effect";

// =============================================================================
// Error type
// =============================================================================

export class LocationError extends Data.TaggedError("LocationError")<{
  readonly operation: string;
  readonly cause: unknown;
}> {}

// =============================================================================
// Service interface
// =============================================================================

export interface LocationService {
  readonly pathname: Effect.Effect<string, LocationError>;
  readonly search: Effect.Effect<string, LocationError>;
  readonly hash: Effect.Effect<string, LocationError>;
  readonly href: Effect.Effect<string, LocationError>;
  readonly fullPath: Effect.Effect<string, LocationError>;
}

// =============================================================================
// Tag
// =============================================================================

export class Location extends Context.Tag("trygg/platform/Location")<
  Location,
  LocationService
>() {}

// =============================================================================
// Browser layer
// =============================================================================

export const browser: Layer.Layer<Location> = Layer.succeed(
  Location,
  Location.of({
    pathname: Effect.try({
      try: () => window.location.pathname,
      catch: (cause) => new LocationError({ operation: "pathname", cause }),
    }),
    search: Effect.try({
      try: () => window.location.search,
      catch: (cause) => new LocationError({ operation: "search", cause }),
    }),
    hash: Effect.try({
      try: () => window.location.hash,
      catch: (cause) => new LocationError({ operation: "hash", cause }),
    }),
    href: Effect.try({
      try: () => window.location.href,
      catch: (cause) => new LocationError({ operation: "href", cause }),
    }),
    fullPath: Effect.try({
      try: () => window.location.pathname + window.location.search + window.location.hash,
      catch: (cause) => new LocationError({ operation: "fullPath", cause }),
    }),
  }),
);

// =============================================================================
// Test layer
// =============================================================================

export const test = (initialPath: string = "/"): Layer.Layer<Location> =>
  Layer.effect(
    Location,
    Effect.sync(() => {
      const url = { pathname: initialPath, search: "", hash: "" };

      // Parse initial path into components
      const hashIdx = initialPath.indexOf("#");
      const searchIdx = initialPath.indexOf("?");
      if (hashIdx >= 0) {
        url.hash = initialPath.slice(hashIdx);
        url.pathname = initialPath.slice(0, hashIdx);
      }
      if (searchIdx >= 0) {
        const hashStart = url.hash !== "" ? initialPath.indexOf("#") : initialPath.length;
        url.search = initialPath.slice(searchIdx, hashStart);
        url.pathname = initialPath.slice(0, searchIdx);
      }

      return Location.of({
        pathname: Effect.succeed(url.pathname),
        search: Effect.succeed(url.search),
        hash: Effect.succeed(url.hash),
        href: Effect.succeed(`http://localhost${url.pathname}${url.search}${url.hash}`),
        fullPath: Effect.succeed(`${url.pathname}${url.search}${url.hash}`),
      });
    }),
  );
