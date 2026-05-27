import { assert, describe, it } from "@effect/vitest";
import { Effect, Layer, Option } from "effect";
import {
  compileRoutePathPattern,
  compareCompiledRoutePathPatterns,
  matchCompiledRoutePathPattern,
  RoutePathPattern,
  RoutePathInterpolation,
  RoutePathSegment,
  interpolateCompiledRoutePathPattern,
} from "../path-pattern.js";

const compile = (pattern: string) => compileRoutePathPattern(pattern);

describe("RoutePathPattern", () => {
  it.effect("classifies static, param, wildcard, and required catch-all segments", () =>
    Effect.gen(function* () {
      const pattern = yield* compile("/docs/:section/:path*/files/:filepath+");

      assert.deepStrictEqual(pattern.segments, [
        RoutePathSegment.Static({ value: "docs" }),
        RoutePathSegment.Param({ name: "section" }),
        RoutePathSegment.Wildcard({ name: "path" }),
        RoutePathSegment.Static({ value: "files" }),
        RoutePathSegment.CatchAllRequired({ name: "filepath" }),
      ]);
      assert.deepStrictEqual(pattern.paramNames, ["section", "path", "filepath"]);
    }),
  );

  it.effect("matches static and param paths", () =>
    Effect.gen(function* () {
      const pattern = yield* compile("/users/:id");
      const match = matchCompiledRoutePathPattern(pattern, "/users/123");

      assert.isTrue(Option.isSome(match));
      if (Option.isSome(match)) {
        assert.deepStrictEqual(match.value.params, { id: "123" });
      }
    }),
  );

  it.effect("matches wildcard with zero or more segments", () =>
    Effect.gen(function* () {
      const pattern = yield* compile("/docs/:path*");
      const rootMatch = matchCompiledRoutePathPattern(pattern, "/docs");
      const nestedMatch = matchCompiledRoutePathPattern(pattern, "/docs/api/users");

      assert.isTrue(Option.isSome(rootMatch));
      assert.isTrue(Option.isSome(nestedMatch));
      if (Option.isSome(rootMatch)) assert.strictEqual(rootMatch.value.params.path, "");
      if (Option.isSome(nestedMatch)) {
        assert.strictEqual(nestedMatch.value.params.path, "api/users");
      }
    }),
  );

  it.effect("requires at least one segment for required catch-all", () =>
    Effect.gen(function* () {
      const pattern = yield* compile("/files/:filepath+");

      assert.isTrue(Option.isNone(matchCompiledRoutePathPattern(pattern, "/files")));

      const match = matchCompiledRoutePathPattern(pattern, "/files/a/b.txt");
      assert.isTrue(Option.isSome(match));
      if (Option.isSome(match)) assert.strictEqual(match.value.params.filepath, "a/b.txt");
    }),
  );

  it.effect("normalizes root, index-compatible, and trailing slash paths", () =>
    Effect.gen(function* () {
      const root = yield* compile("/");
      const alsoRoot = yield* compile("///");
      const users = yield* compile("/users/");

      assert.deepStrictEqual(root.segments, []);
      assert.deepStrictEqual(alsoRoot.segments, []);
      assert.strictEqual(users.pattern, "/users");
      assert.isTrue(Option.isSome(matchCompiledRoutePathPattern(root, "/")));
      assert.isTrue(Option.isNone(matchCompiledRoutePathPattern(root, "/users")));
      assert.isTrue(Option.isSome(matchCompiledRoutePathPattern(users, "/users/")));
    }),
  );

  it.effect("sorts by route matching precedence", () =>
    Effect.gen(function* () {
      const patterns = yield* Effect.forEach(
        ["/docs/:path*", "/docs/:path+", "/docs/:id", "/docs/settings"],
        compile,
      );

      const sorted = [...patterns].sort(compareCompiledRoutePathPatterns);

      assert.deepStrictEqual(
        sorted.map((pattern) => pattern.pattern),
        ["/docs/settings", "/docs/:id", "/docs/:path+", "/docs/:path*"],
      );
    }),
  );

  it.effect("interpolates required, wildcard, numeric, and no-param paths", () =>
    Effect.gen(function* () {
      const blog = yield* compile("/blog/:year/:slug");
      const docs = yield* compile("/docs/:path*");
      const about = yield* compile("/about");

      assert.strictEqual(
        yield* interpolateCompiledRoutePathPattern(blog, { year: 2026, slug: "trygg" }),
        "/blog/2026/trygg",
      );
      assert.strictEqual(yield* interpolateCompiledRoutePathPattern(docs, {}), "/docs");
      assert.strictEqual(
        yield* interpolateCompiledRoutePathPattern(docs, { path: "api/router" }),
        "/docs/api/router",
      );
      assert.strictEqual(yield* interpolateCompiledRoutePathPattern(about, {}), "/about");
    }),
  );

  it.effect("fails interpolation on missing params and can reject unused params", () =>
    Effect.gen(function* () {
      const pattern = yield* compile("/users/:id");
      const missing = yield* Effect.exit(interpolateCompiledRoutePathPattern(pattern, {}));
      const unused = yield* Effect.exit(
        interpolateCompiledRoutePathPattern(
          pattern,
          { id: "1", extra: "x" },
          { rejectUnusedParams: true },
        ),
      );

      assert.strictEqual(missing._tag, "Failure");
      assert.strictEqual(unused._tag, "Failure");
    }),
  );

  it.effect("exposes interpolation through the service", () =>
    Effect.gen(function* () {
      const patterns = yield* RoutePathPattern;
      const interpolation = yield* RoutePathInterpolation;
      const pattern = yield* patterns.compile("/users/:id");
      const names = yield* interpolation.paramNames(pattern);
      const id = yield* interpolation.paramOption({ id: 42 }, "id");
      const path = yield* interpolation.interpolate(pattern, { id: 42 });

      assert.deepStrictEqual(names, ["id"]);
      assert.isTrue(Option.isSome(id));
      assert.strictEqual(path, "/users/42");
    }).pipe(
      Effect.provide(
        Layer.merge(
          RoutePathPattern.layer({ normalizeTrailingSlash: true }),
          RoutePathInterpolation.layer({ rejectUnusedParams: false }),
        ),
      ),
    ),
  );

  it.effect("exposes compile, compare, and match through the service", () =>
    Effect.gen(function* () {
      const service = yield* RoutePathPattern;
      const staticPattern = yield* service.compile("/users/settings");
      const paramPattern = yield* service.compile("/users/:id");
      const order = yield* service.compare(staticPattern, paramPattern);
      const match = yield* service.match(paramPattern, "/users/42");

      assert.isBelow(order, 0);
      assert.isTrue(Option.isSome(match));
    }).pipe(Effect.provide(RoutePathPattern.layer({ normalizeTrailingSlash: true }))),
  );
});
