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
import { Data, Effect, Layer, Option, Schema } from "effect";
import * as Context from "effect/Context";

/** A compiled route path segment. */
export type RoutePathSegment =
  | { readonly _tag: "Static"; readonly value: string }
  | { readonly _tag: "Param"; readonly name: string }
  | { readonly _tag: "Wildcard"; readonly name: string }
  | { readonly _tag: "CatchAllRequired"; readonly name: string };

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
export class InvalidRoutePathPattern extends Data.TaggedError("InvalidRoutePathPattern")<{
  readonly pattern: string;
  readonly reason: string;
}> {}

/** Route path-pattern service config. */
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

const segmentScore = (segment: RoutePathSegment): number => {
  switch (segment._tag) {
    case "Static":
      return 3;
    case "Param":
      return 2;
    case "CatchAllRequired":
      return 1.5;
    case "Wildcard":
      return 1;
  }
};

const scoreSegments = (segments: ReadonlyArray<RoutePathSegment>): number =>
  segments.reduce((score, segment) => score + segmentScore(segment), 0) + segments.length * 0.1;

const parseParamName = (
  pattern: string,
  rawName: string,
): Effect.Effect<string, InvalidRoutePathPattern> => {
  if (rawName.length === 0) {
    return Effect.fail(new InvalidRoutePathPattern({ pattern, reason: "param name is empty" }));
  }
  if (rawName.includes(":")) {
    return Effect.fail(new InvalidRoutePathPattern({ pattern, reason: `invalid param name '${rawName}'` }));
  }
  return Effect.succeed(rawName);
};

/** Compile a route path pattern into its canonical segment model. */
export const compileRoutePathPattern = (
  pattern: string,
  config: RoutePathPatternConfig = { normalizeTrailingSlash: true },
): Effect.Effect<CompiledRoutePathPattern, InvalidRoutePathPattern> =>
  Effect.gen(function* () {
    const normalized = normalizePattern(pattern, config);
    const segments: Array<RoutePathSegment> = [];
    const paramNames: Array<string> = [];

    for (const part of splitPath(normalized, config)) {
      if (part.startsWith(":")) {
        if (part.endsWith("*")) {
          const name = yield* parseParamName(normalized, part.slice(1, -1));
          segments.push({ _tag: "Wildcard", name });
          paramNames.push(name);
        } else if (part.endsWith("+")) {
          const name = yield* parseParamName(normalized, part.slice(1, -1));
          segments.push({ _tag: "CatchAllRequired", name });
          paramNames.push(name);
        } else {
          const name = yield* parseParamName(normalized, part.slice(1));
          segments.push({ _tag: "Param", name });
          paramNames.push(name);
        }
      } else {
        segments.push({ _tag: "Static", value: part });
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

/** Match a compiled route path pattern against a pathname. */
export const matchCompiledRoutePathPattern = (
  pattern: CompiledRoutePathPattern,
  pathname: string,
  config: RoutePathPatternConfig = { normalizeTrailingSlash: true },
): Option.Option<RoutePathPatternMatch> => {
  const pathParts = splitPath(pathname, config);
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

export type PathParamValue = string | number;
export type PathParamInput = Readonly<Record<string, PathParamValue>>;

export class MissingRoutePathParam extends Data.TaggedError("MissingRoutePathParam")<{
  readonly pattern: string;
  readonly param: string;
}> {}

export class UnusedRoutePathParam extends Data.TaggedError("UnusedRoutePathParam")<{
  readonly pattern: string;
  readonly param: string;
}> {}

export class InvalidRoutePathParamValue extends Data.TaggedError("InvalidRoutePathParamValue")<{
  readonly pattern: string;
  readonly param: string;
  readonly value: unknown;
  readonly reason: string;
}> {}

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

export const interpolateCompiledRoutePathPattern = (
  pattern: CompiledRoutePathPattern,
  params: PathParamInput,
  config: RoutePathInterpolationConfig = { rejectUnusedParams: false },
): Effect.Effect<string, RoutePathInterpolationError> =>
  Effect.gen(function* () {
    if (config.rejectUnusedParams) {
      for (const key of Object.keys(params)) {
        if (!pattern.paramNames.includes(key)) {
          return yield* new UnusedRoutePathParam({ pattern: pattern.pattern, param: key });
        }
      }
    }

    const parts: Array<string> = [];
    for (const segment of pattern.segments) {
      if (segment._tag === "Static") {
        parts.push(segment.value);
        continue;
      }

      const option = getPathParamOption(params, segment.name);
      if (Option.isNone(option)) {
        if (segment._tag === "Wildcard") {
          continue;
        }
        return yield* new MissingRoutePathParam({ pattern: pattern.pattern, param: segment.name });
      }

      const value = yield* validateParamValue(pattern, segment.name, option.value);
      const text = String(value);
      if (segment._tag !== "Wildcard" && text === "") {
        return yield* new MissingRoutePathParam({ pattern: pattern.pattern, param: segment.name });
      }
      if (text !== "") {
        parts.push(...text.split("/").filter(Boolean));
      }
    }

    return `/${parts.join("/")}`;
  });

/** RoutePathPattern service. */
export class RoutePathPattern extends Context.Service<
  RoutePathPattern,
  {
    readonly compile: (
      pattern: string,
    ) => Effect.Effect<CompiledRoutePathPattern, InvalidRoutePathPattern>;
    readonly compare: (
      left: CompiledRoutePathPattern,
      right: CompiledRoutePathPattern,
    ) => Effect.Effect<number>;
    readonly match: (
      pattern: CompiledRoutePathPattern,
      pathname: string,
    ) => Effect.Effect<Option.Option<RoutePathPatternMatch>>;
  }
>()("trygg/RoutePathPattern") {
  static readonly layer = (input: RoutePathPatternConfig): Layer.Layer<RoutePathPattern> => {
    const config = RoutePathPatternConfigInput.make(input);
    return Layer.succeed(RoutePathPattern, {
      compile: Effect.fn("RoutePathPattern.compile")((pattern) =>
        compileRoutePathPattern(pattern, config),
      ),
      compare: Effect.fn("RoutePathPattern.compare")((left, right) =>
        Effect.succeed(compareCompiledRoutePathPatterns(left, right)),
      ),
      match: Effect.fn("RoutePathPattern.match")((pattern, pathname) =>
        Effect.succeed(matchCompiledRoutePathPattern(pattern, pathname, config)),
      ),
    });
  };
}

export class RoutePathInterpolation extends Context.Service<
  RoutePathInterpolation,
  {
    readonly paramNames: (
      pattern: CompiledRoutePathPattern,
    ) => Effect.Effect<ReadonlyArray<string>>;
    readonly interpolate: (
      pattern: CompiledRoutePathPattern,
      params: PathParamInput,
    ) => Effect.Effect<string, RoutePathInterpolationError>;
    readonly paramOption: (
      params: PathParamInput,
      key: string,
    ) => Effect.Effect<Option.Option<PathParamValue>>;
  }
>()("trygg/RoutePathInterpolation") {
  static readonly layer = (input: RoutePathInterpolationConfig): Layer.Layer<RoutePathInterpolation> => {
    const config = RoutePathInterpolationConfigInput.make(input);
    return Layer.succeed(RoutePathInterpolation, {
      paramNames: Effect.fn("RoutePathInterpolation.paramNames")((pattern) =>
        Effect.succeed(pattern.paramNames),
      ),
      interpolate: Effect.fn("RoutePathInterpolation.interpolate")((pattern, params) =>
        interpolateCompiledRoutePathPattern(pattern, params, config),
      ),
      paramOption: Effect.fn("RoutePathInterpolation.paramOption")((params, key) =>
        Effect.succeed(getPathParamOption(params, key)),
      ),
    });
  };
}
