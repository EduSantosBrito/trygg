/**
 * Canonical route path-pattern semantics for `trygg/router`.
 *
 * @remarks
 * This module owns route path parsing, segment classification, precedence scoring,
 * and pathname matching so Link, Router, RouteMatcher, and generated route metadata
 * can share one source of truth.
 *
 * @since 1.0.0
 * @module trygg/router/path-pattern
 */
import { Data, Effect, Match, Option, Schema } from "effect";

/** A compiled route path segment. */
export type RoutePathSegment = Data.TaggedEnum<{
  readonly Static: { readonly value: string };
  readonly Param: { readonly name: string };
  readonly Wildcard: { readonly name: string };
  readonly CatchAllRequired: { readonly name: string };
}>;

export const RoutePathSegment = Data.taggedEnum<RoutePathSegment>();

/** Canonical compiled representation of a route path pattern. */
export interface CompiledRoutePathPattern {
  readonly pattern: string;
  readonly segments: ReadonlyArray<RoutePathSegment>;
  readonly paramNames: ReadonlyArray<string>;
  readonly score: number;
}

/** Successful route path-pattern match. */
export interface RoutePathPatternMatch {
  readonly pattern: CompiledRoutePathPattern;
  readonly params: Readonly<Record<string, string>>;
}

/** Domain failure for invalid route path-pattern syntax. */
export class InvalidRoutePathPattern extends Schema.TaggedError<InvalidRoutePathPattern>()(
  "InvalidRoutePathPattern",
  {
    pattern: Schema.String,
    reason: Schema.String,
  },
) {}

/** Domain failure for malformed percent encoding in a route pathname. */
export class InvalidRoutePathEncoding extends Schema.TaggedError<InvalidRoutePathEncoding>()(
  "InvalidRoutePathEncoding",
  {
    pathname: Schema.String,
    segment: Schema.String,
    reason: Schema.String,
  },
) {}

/** Route path-pattern configuration. */
export const RoutePathPatternConfigInput = Schema.Struct({
  normalizeTrailingSlash: Schema.Boolean,
});

type RoutePathPatternConfig = typeof RoutePathPatternConfigInput.Type;

const normalizePattern = (pattern: string, config: RoutePathPatternConfig): string => {
  if (!config.normalizeTrailingSlash || pattern === "/") {
    return pattern;
  }
  return pattern.replace(/\/+$/u, "") || "/";
};

const splitPath = (path: string, config: RoutePathPatternConfig): ReadonlyArray<string> => {
  const normalized = normalizePattern(path.split(/[?#]/u)[0] ?? path, config);
  return normalized
    .replace(/^\/|\/$/gu, "")
    .split("/")
    .filter(Boolean);
};

const segmentScore = (segment: RoutePathSegment): number =>
  Match.value(segment).pipe(
    Match.tag("Static", () => 3),
    Match.tag("Param", () => 2),
    Match.tag("CatchAllRequired", () => 1.5),
    Match.tag("Wildcard", () => 1),
    Match.exhaustive,
  );

const scoreSegments = (segments: ReadonlyArray<RoutePathSegment>): number =>
  segments.reduce((score, segment) => score + segmentScore(segment), 0) + segments.length * 0.1;

const parseParamName = Effect.fn("RoutePathPattern.parseParamName")(function* (
  pattern: string,
  rawName: string,
) {
  if (rawName.length === 0) {
    return yield* new InvalidRoutePathPattern({ pattern, reason: "param name is empty" });
  }
  if (rawName.includes(":")) {
    return yield* new InvalidRoutePathPattern({
      pattern,
      reason: `invalid param name '${rawName}'`,
    });
  }
  return rawName;
});

/** Compile a route path pattern into its canonical segment model. */
export const compileRoutePathPattern: (
  pattern: string,
  config?: RoutePathPatternConfig,
) => Effect.Effect<CompiledRoutePathPattern, InvalidRoutePathPattern> = Effect.fn(
  "RoutePathPattern.compileRoutePathPattern",
)(function* (pattern: string, config: RoutePathPatternConfig = { normalizeTrailingSlash: true }) {
  const normalized = normalizePattern(pattern, config);
  const segments: Array<RoutePathSegment> = [];
  const paramNames: Array<string> = [];
  const parts = splitPath(normalized, config);

  for (let index = 0; index < parts.length; index++) {
    const part = parts[index];
    if (part === undefined) continue;
    if (part.startsWith(":")) {
      if (part.endsWith("*")) {
        const name = yield* parseParamName(normalized, part.slice(1, -1));
        if (index !== parts.length - 1) {
          return yield* new InvalidRoutePathPattern({
            pattern: normalized,
            reason: "wildcard params must be the final path segment",
          });
        }
        segments.push(RoutePathSegment.Wildcard({ name }));
        paramNames.push(name);
      } else if (part.endsWith("+")) {
        const name = yield* parseParamName(normalized, part.slice(1, -1));
        if (index !== parts.length - 1) {
          return yield* new InvalidRoutePathPattern({
            pattern: normalized,
            reason: "required catch-all params must be the final path segment",
          });
        }
        segments.push(RoutePathSegment.CatchAllRequired({ name }));
        paramNames.push(name);
      } else {
        const name = yield* parseParamName(normalized, part.slice(1));
        segments.push(RoutePathSegment.Param({ name }));
        paramNames.push(name);
      }
    } else {
      segments.push(RoutePathSegment.Static({ value: part }));
    }
  }

  return {
    pattern: normalized,
    segments,
    paramNames,
    score: scoreSegments(segments),
  };
});

/** Sort comparator: more specific patterns come first. */
export const compareCompiledRoutePathPatterns = (
  left: CompiledRoutePathPattern,
  right: CompiledRoutePathPattern,
): number => {
  if (left.segments.length !== right.segments.length) {
    return right.segments.length - left.segments.length;
  }
  return right.score - left.score;
};

/**
 * Decode a pathname once before testing compiled route candidates.
 * @remarks Retains malformed encoding and dot-segment failures at the URI boundary.
 * @internal
 */
export const decodePathname = (
  pathname: string,
  config: RoutePathPatternConfig = { normalizeTrailingSlash: true },
): Effect.Effect<ReadonlyArray<string>, InvalidRoutePathEncoding> =>
  Effect.forEach(splitPath(pathname, config), (segment) =>
    Effect.try({
      try: () => decodeURIComponent(segment),
      catch: () =>
        new InvalidRoutePathEncoding({
          pathname,
          segment,
          reason: "path segment contains malformed percent encoding",
        }),
    }).pipe(
      Effect.flatMap((decoded) =>
        decoded === "." || decoded === ".."
          ? Effect.fail(
              new InvalidRoutePathEncoding({
                pathname,
                segment,
                reason: "dot path segments are not allowed",
              }),
            )
          : Effect.succeed(decoded),
      ),
    ),
  );

/**
 * Match a compiled route against previously decoded pathname segments.
 * @remarks Callers must obtain segments from decodePathname, including its validation.
 * @internal
 */
export const matchDecoded = (
  pattern: CompiledRoutePathPattern,
  pathParts: ReadonlyArray<string>,
): Option.Option<RoutePathPatternMatch> => {
  const params: Record<string, string> = {};

  if (pattern.segments.length === 0 && pathParts.length === 0) {
    return Option.some({ pattern, params });
  }

  let pathIndex = 0;
  for (const segment of pattern.segments) {
    switch (segment._tag) {
      case "Static": {
        if (pathParts[pathIndex] !== segment.value) return Option.none();
        pathIndex++;
        break;
      }
      case "Param": {
        const part = pathParts[pathIndex];
        if (part === undefined) return Option.none();
        params[segment.name] = part;
        pathIndex++;
        break;
      }
      case "Wildcard": {
        params[segment.name] = pathParts.slice(pathIndex).join("/");
        pathIndex = pathParts.length;
        break;
      }
      case "CatchAllRequired": {
        const rest = pathParts.slice(pathIndex).join("/");
        if (rest === "") return Option.none();
        params[segment.name] = rest;
        pathIndex = pathParts.length;
        break;
      }
    }
  }

  return pathIndex === pathParts.length ? Option.some({ pattern, params }) : Option.none();
};

/** Match a compiled pattern while preserving malformed URI failures. */
export const matchCompiledRoutePathPattern: (
  pattern: CompiledRoutePathPattern,
  pathname: string,
  config?: RoutePathPatternConfig,
) => Effect.Effect<Option.Option<RoutePathPatternMatch>, InvalidRoutePathEncoding> = Effect.fn(
  "RoutePathPattern.matchCompiledRoutePathPattern",
)(function* (
  pattern: CompiledRoutePathPattern,
  pathname: string,
  config: RoutePathPatternConfig = { normalizeTrailingSlash: true },
) {
  return matchDecoded(pattern, yield* decodePathname(pathname, config));
});

export type PathParamValue = string | number;
export type PathParamInput = Readonly<Record<string, PathParamValue>>;

export class MissingRoutePathParam extends Schema.TaggedError<MissingRoutePathParam>()(
  "MissingRoutePathParam",
  {
    pattern: Schema.String,
    param: Schema.String,
  },
) {}

export class UnusedRoutePathParam extends Schema.TaggedError<UnusedRoutePathParam>()(
  "UnusedRoutePathParam",
  {
    pattern: Schema.String,
    param: Schema.String,
  },
) {}

export class InvalidRoutePathParamValue extends Schema.TaggedError<InvalidRoutePathParamValue>()(
  "InvalidRoutePathParamValue",
  {
    pattern: Schema.String,
    param: Schema.String,
    value: Schema.Unknown,
    reason: Schema.String,
  },
) {}

export const RoutePathInterpolationConfigInput = Schema.Struct({
  rejectUnusedParams: Schema.Boolean,
});

type RoutePathInterpolationConfig = typeof RoutePathInterpolationConfigInput.Type;

type RoutePathInterpolationError =
  | MissingRoutePathParam
  | UnusedRoutePathParam
  | InvalidRoutePathParamValue;

export const getPathParamOption = (
  params: PathParamInput,
  key: string,
): Option.Option<PathParamValue> => {
  if (!Object.prototype.hasOwnProperty.call(params, key)) {
    return Option.none();
  }
  const value = params[key];
  return value === undefined ? Option.none() : Option.some(value);
};

const validateParamValue = (
  pattern: CompiledRoutePathPattern,
  param: string,
  value: unknown,
): Effect.Effect<PathParamValue, InvalidRoutePathParamValue> => {
  if (typeof value === "string" || typeof value === "number") {
    return Effect.succeed(value);
  }
  return Effect.fail(
    new InvalidRoutePathParamValue({
      pattern: pattern.pattern,
      param,
      value,
      reason: "path params must be strings or numbers",
    }),
  );
};

const invalidParamValue = (
  pattern: CompiledRoutePathPattern,
  param: string,
  value: unknown,
  reason: string,
): InvalidRoutePathParamValue =>
  new InvalidRoutePathParamValue({
    pattern: pattern.pattern,
    param,
    value,
    reason,
  });

const encodeParamSegment = (
  pattern: CompiledRoutePathPattern,
  param: string,
  value: PathParamValue,
  segment: string,
): Effect.Effect<string, InvalidRoutePathParamValue> => {
  if (segment === "." || segment === "..") {
    return Effect.fail(
      invalidParamValue(pattern, param, value, "dot path segments are not allowed"),
    );
  }
  return Effect.try({
    try: () => encodeURIComponent(segment),
    catch: () => invalidParamValue(pattern, param, value, "path param cannot be URI encoded"),
  });
};

export const interpolateCompiledRoutePathPattern: (
  pattern: CompiledRoutePathPattern,
  params: PathParamInput,
  config?: RoutePathInterpolationConfig,
) => Effect.Effect<string, RoutePathInterpolationError> = Effect.fn(
  "RoutePathInterpolation.interpolateCompiledRoutePathPattern",
)(function* (
  pattern: CompiledRoutePathPattern,
  params: PathParamInput,
  config: RoutePathInterpolationConfig = { rejectUnusedParams: false },
) {
  if (config.rejectUnusedParams) {
    for (const key of Object.keys(params)) {
      if (!pattern.paramNames.includes(key)) {
        return yield* new UnusedRoutePathParam({ pattern: pattern.pattern, param: key });
      }
    }
  }

  const parts: Array<string> = [];
  for (const segment of pattern.segments) {
    if (RoutePathSegment.$is("Static")(segment)) {
      parts.push(segment.value);
      continue;
    }

    const option = getPathParamOption(params, segment.name);
    if (Option.isNone(option)) {
      if (RoutePathSegment.$is("Wildcard")(segment)) {
        continue;
      }
      return yield* new MissingRoutePathParam({ pattern: pattern.pattern, param: segment.name });
    }

    const value = yield* validateParamValue(pattern, segment.name, option.value);
    const text = String(value);
    if (!RoutePathSegment.$is("Wildcard")(segment) && text === "") {
      return yield* new MissingRoutePathParam({ pattern: pattern.pattern, param: segment.name });
    }
    if (text === "") continue;

    if (RoutePathSegment.$is("Param")(segment)) {
      parts.push(yield* encodeParamSegment(pattern, segment.name, value, text));
      continue;
    }

    const catchAllParts = text.split("/");
    if (catchAllParts.some((part) => part === "")) {
      return yield* invalidParamValue(
        pattern,
        segment.name,
        value,
        "catch-all params must contain non-empty path segments",
      );
    }
    parts.push(
      ...(yield* Effect.forEach(catchAllParts, (part) =>
        encodeParamSegment(pattern, segment.name, value, part),
      )),
    );
  }

  return `/${parts.join("/")}`;
});

const makeRoutePathPattern = (input: RoutePathPatternConfig) => {
  const config = RoutePathPatternConfigInput.make(input);
  return {
    ...config,
    compile: Effect.fn("RoutePathPattern.compile")((pattern: string) =>
      compileRoutePathPattern(pattern, config),
    ),
    compare: Effect.fn("RoutePathPattern.compare")(
      (left: CompiledRoutePathPattern, right: CompiledRoutePathPattern) =>
        Effect.succeed(compareCompiledRoutePathPatterns(left, right)),
    ),
    match: Effect.fn("RoutePathPattern.match")(
      (pattern: CompiledRoutePathPattern, pathname: string) =>
        matchCompiledRoutePathPattern(pattern, pathname, config),
    ),
  };
};

const makeRoutePathInterpolation = (input: RoutePathInterpolationConfig) => {
  const config = RoutePathInterpolationConfigInput.make(input);
  return {
    ...config,
    paramNames: Effect.fn("RoutePathInterpolation.paramNames")(
      (pattern: CompiledRoutePathPattern) => Effect.succeed(pattern.paramNames),
    ),
    interpolate: Effect.fn("RoutePathInterpolation.interpolate")(
      (pattern: CompiledRoutePathPattern, params: PathParamInput) =>
        interpolateCompiledRoutePathPattern(pattern, params, config),
    ),
    paramOption: Effect.fn("RoutePathInterpolation.paramOption")(
      (params: PathParamInput, key: string) => Effect.succeed(getPathParamOption(params, key)),
    ),
  };
};

/** Configured route path-pattern operations. */
export const RoutePathPattern = { make: makeRoutePathPattern };

/** Configured route path interpolation operations. */
export const RoutePathInterpolation = { make: makeRoutePathInterpolation };
