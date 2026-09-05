import { assert, describe, it } from "@effect/vitest";
import { Effect, Option, Result } from "effect";
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
      const params = yield* compile("/docs/:section/:page");
      const wildcard = yield* compile("/docs/:path*");
      const catchAll = yield* compile("/files/:filepath+");

      assert.deepStrictEqual(params.segments, [
        RoutePathSegment.Static({ value: "docs" }),
        RoutePathSegment.Param({ name: "section" }),
        RoutePathSegment.Param({ name: "page" }),
      ]);
      assert.deepStrictEqual(wildcard.segments, [
        RoutePathSegment.Static({ value: "docs" }),
        RoutePathSegment.Wildcard({ name: "path" }),
      ]);
      assert.deepStrictEqual(catchAll.segments, [
        RoutePathSegment.Static({ value: "files" }),
        RoutePathSegment.CatchAllRequired({ name: "filepath" }),
      ]);
      assert.deepStrictEqual(params.paramNames, ["section", "page"]);
    }),
  );

  it.effect("rejects non-terminal wildcard and required catch-all segments", () =>
    Effect.gen(function* () {
      const wildcard = yield* Effect.result(compile("/docs/:path*/edit"));
      const catchAll = yield* Effect.result(compile("/files/:path+/edit"));

      assert.isTrue(Result.isFailure(wildcard));
      assert.isTrue(Result.isFailure(catchAll));
    }),
  );

  it.effect("matches static and param paths", () =>
    Effect.gen(function* () {
      const pattern = yield* compile("/users/:id");
      const match = yield* matchCompiledRoutePathPattern(pattern, "/users/123");

      assert.isTrue(Option.isSome(match));
      if (Option.isSome(match)) {
        assert.deepStrictEqual(match.value.params, { id: "123" });
      }
    }),
  );

  it.effect("matches wildcard with zero or more segments", () =>
    Effect.gen(function* () {
      const pattern = yield* compile("/docs/:path*");
      const rootMatch = yield* matchCompiledRoutePathPattern(pattern, "/docs");
      const nestedMatch = yield* matchCompiledRoutePathPattern(pattern, "/docs/api/users");

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

      const empty = yield* matchCompiledRoutePathPattern(pattern, "/files");
      assert.isTrue(Option.isNone(empty));

      const match = yield* matchCompiledRoutePathPattern(pattern, "/files/a/b.txt");
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
      assert.isTrue(Option.isSome(yield* matchCompiledRoutePathPattern(root, "/")));
      assert.isTrue(Option.isNone(yield* matchCompiledRoutePathPattern(root, "/users")));
      assert.isTrue(Option.isSome(yield* matchCompiledRoutePathPattern(users, "/users/")));
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

  it.effect("round-trips reserved, percent, slash, and Unicode param values", () =>
    Effect.gen(function* () {
      const pattern = yield* compile("/users/:id");
      const values = ["/", "a/b", "x?role=admin", "x#panel", "100%", "olá 世界", "../admin"];

      for (const value of values) {
        const path = yield* interpolateCompiledRoutePathPattern(pattern, { id: value });
        const match = yield* matchCompiledRoutePathPattern(pattern, path);

        assert.isTrue(Option.isSome(match));
        if (Option.isSome(match)) assert.strictEqual(match.value.params.id, value);
      }
    }),
  );

  it.effect("preserves structural slashes while round-tripping catch-all segments", () =>
    Effect.gen(function* () {
      const pattern = yield* compile("/docs/:path+");
      const value = "api/a?b/東京/100%";
      const path = yield* interpolateCompiledRoutePathPattern(pattern, { path: value });
      const match = yield* matchCompiledRoutePathPattern(pattern, path);

      assert.strictEqual(path, "/docs/api/a%3Fb/%E6%9D%B1%E4%BA%AC/100%25");
      assert.isTrue(Option.isSome(match));
      if (Option.isSome(match)) assert.strictEqual(match.value.params.path, value);
    }),
  );

  it.effect("rejects dot segments and reports malformed pathname encoding", () =>
    Effect.gen(function* () {
      const pattern = yield* compile("/users/:id");
      const dot = yield* Effect.result(interpolateCompiledRoutePathPattern(pattern, { id: "." }));
      const dotDot = yield* Effect.result(
        interpolateCompiledRoutePathPattern(pattern, { id: ".." }),
      );
      const malformed = yield* Effect.result(
        matchCompiledRoutePathPattern(pattern, "/users/%E0%A4%A"),
      );

      assert.isTrue(Result.isFailure(dot));
      assert.isTrue(Result.isFailure(dotDot));
      assert.isTrue(Result.isFailure(malformed));
      if (Result.isFailure(malformed)) {
        assert.strictEqual(malformed.failure._tag, "InvalidRoutePathEncoding");
      }
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

  it.effect("creates configured interpolation operations", () =>
    Effect.gen(function* () {
      const patterns = RoutePathPattern.make({ normalizeTrailingSlash: true });
      const interpolation = RoutePathInterpolation.make({ rejectUnusedParams: false });
      const pattern = yield* patterns.compile("/users/:id");
      const names = yield* interpolation.paramNames(pattern);
      const id = yield* interpolation.paramOption({ id: 42 }, "id");
      const path = yield* interpolation.interpolate(pattern, { id: 42 });

      assert.deepStrictEqual(names, ["id"]);
      assert.isTrue(Option.isSome(id));
      assert.strictEqual(path, "/users/42");
    }),
  );

  it.effect("creates configured compile, compare, and match operations", () =>
    Effect.gen(function* () {
      const service = RoutePathPattern.make({ normalizeTrailingSlash: true });
      const staticPattern = yield* service.compile("/users/settings");
      const paramPattern = yield* service.compile("/users/:id");
      const order = yield* service.compare(staticPattern, paramPattern);
      const match = yield* service.match(paramPattern, "/users/42");

      assert.isBelow(order, 0);
      assert.isTrue(Option.isSome(match));
    }),
  );
});
