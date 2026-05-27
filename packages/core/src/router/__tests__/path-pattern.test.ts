import { assert, describe, it } from "@effect/vitest";
import { Effect, Option } from "effect";
import {
  compileRoutePathPattern,
  compareCompiledRoutePathPatterns,
  matchCompiledRoutePathPattern,
  RoutePathPattern,
} from "../path-pattern.js";

const compile = (pattern: string) => compileRoutePathPattern(pattern);

describe("RoutePathPattern", () => {
  it.effect("classifies static, param, wildcard, and required catch-all segments", () =>
    Effect.gen(function* () {
      const pattern = yield* compile("/docs/:section/:path*/files/:filepath+");

      assert.deepStrictEqual(pattern.segments, [
        { _tag: "Static", value: "docs" },
        { _tag: "Param", name: "section" },
        { _tag: "Wildcard", name: "path" },
        { _tag: "Static", value: "files" },
        { _tag: "CatchAllRequired", name: "filepath" },
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
