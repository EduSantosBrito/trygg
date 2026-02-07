/**
 * Outlet Matching Unit Tests (Phase 10)
 *
 * Tests for:
 * - Resolving relative child paths to absolute
 * - Building matcher from route tree
 * - Matching paths against resolved routes
 * - Priority: static > param > wildcard
 * - Index route matching
 * - Re-match on path change (via router signal)
 */
import { assert, describe, it } from "@effect/vitest";
import { Effect, Option } from "effect";
import * as Route from "../route.js";
import { IndexMarker } from "../route.js";
import * as Routes from "../routes.js";
import { resolveRoutes, createMatcher } from "../matching.js";
import * as Router from "../service.js";
import * as Signal from "../../primitives/signal.js";
import { empty } from "../../primitives/element.js";
import type { RouteComponent } from "../types.js";
import type { Component } from "../../primitives/component.js";
import type { Layer } from "effect";

// Helper to create dummy RouteComponent
const makeComp = (): RouteComponent => {
  const fn = () => empty;
  const comp = Object.assign(fn, {
    _tag: "EffectComponent" as const,
    _layers: [] as ReadonlyArray<Layer.Layer.Any>,

    provide: () => comp as Component.Type<never, unknown, unknown>,
  });
  return comp as RouteComponent;
};

// Dummy components
const Comp = makeComp();
const Layout = makeComp();
const CompA = makeComp();
const CompB = makeComp();
const CompC = makeComp();

// =============================================================================
// resolveRoutes - Path resolution
// =============================================================================

describe("resolveRoutes", () => {
  it.effect("should resolve top-level route path as-is", () =>
    Effect.gen(function* () {
      const manifest = Routes.make().add(Route.make("/users").component(Comp)).manifest;
      const resolved = yield* resolveRoutes(manifest);

      assert.strictEqual(resolved.length, 1);
      assert.strictEqual(resolved[0]?.path, "/users");
    }),
  );

  it.effect("should resolve child paths to absolute", () =>
    Effect.gen(function* () {
      const manifest = Routes.make().add(
        Route.make("/settings").layout(Layout).children(Route.make("/profile").component(Comp)),
      ).manifest;

      const resolved = yield* resolveRoutes(manifest);

      assert.strictEqual(resolved.length, 1);
      assert.strictEqual(resolved[0]?.path, "/settings/profile");
    }),
  );

  it.effect("should resolve deeply nested children (3 levels)", () =>
    Effect.gen(function* () {
      const manifest = Routes.make().add(
        Route.make("/a")
          .layout(Layout)
          .children(Route.make("/b").layout(Layout).children(Route.make("/c").component(Comp))),
      ).manifest;

      const resolved = yield* resolveRoutes(manifest);

      assert.strictEqual(resolved.length, 1);
      assert.strictEqual(resolved[0]?.path, "/a/b/c");
    }),
  );

  it.effect("should resolve Route.index to parent path", () =>
    Effect.gen(function* () {
      const manifest = Routes.make().add(
        Route.make("/settings")
          .layout(Layout)
          .children(Route.index(CompA), Route.make("/profile").component(CompB)),
      ).manifest;

      const resolved = yield* resolveRoutes(manifest);

      assert.strictEqual(resolved.length, 2);

      const indexRoute = resolved.find((r) => r.definition.path === IndexMarker);
      assert.isDefined(indexRoute);
      assert.strictEqual(indexRoute?.path, "/settings");

      const profileRoute = resolved.find((r) => r.path === "/settings/profile");
      assert.isDefined(profileRoute);
    }),
  );

  it.effect("should track ancestors correctly", () =>
    Effect.gen(function* () {
      const manifest = Routes.make().add(
        Route.make("/admin")
          .layout(Layout)
          .children(
            Route.make("/users").layout(Layout).children(Route.make("/:id").component(Comp)),
          ),
      ).manifest;

      const resolved = yield* resolveRoutes(manifest);

      assert.strictEqual(resolved.length, 1);
      const route = resolved[0];
      assert.isDefined(route);
      assert.strictEqual(route?.path, "/admin/users/:id");

      assert.strictEqual(route?.ancestors.length, 2);
      assert.strictEqual(route?.ancestors[0]?.path, "/admin");
      assert.strictEqual(route?.ancestors[1]?.path, "/admin/users");
    }),
  );

  it.effect("should handle multiple top-level routes", () =>
    Effect.gen(function* () {
      const manifest = Routes.make()
        .add(Route.make("/").component(CompA))
        .add(Route.make("/users").component(CompB))
        .add(Route.make("/settings").component(CompC)).manifest;

      const resolved = yield* resolveRoutes(manifest);

      assert.strictEqual(resolved.length, 3);
      assert.strictEqual(resolved[0]?.path, "/");
      assert.strictEqual(resolved[1]?.path, "/users");
      assert.strictEqual(resolved[2]?.path, "/settings");
    }),
  );

  it.effect("should include parent with component in flat list", () =>
    Effect.gen(function* () {
      const manifest = Routes.make().add(
        Route.make("/dashboard")
          .layout(Layout)
          .children(Route.index(CompA), Route.make("/stats").component(CompB)),
      ).manifest;

      const resolved = yield* resolveRoutes(manifest);

      assert.strictEqual(resolved.length, 2);
    }),
  );

  it.effect("should handle dynamic child segments", () =>
    Effect.gen(function* () {
      const manifest = Routes.make().add(
        Route.make("/users").layout(Layout).children(Route.make("/:id").component(Comp)),
      ).manifest;

      const resolved = yield* resolveRoutes(manifest);

      assert.strictEqual(resolved.length, 1);
      assert.strictEqual(resolved[0]?.path, "/users/:id");
    }),
  );

  it.effect("should handle catch-all child segments", () =>
    Effect.gen(function* () {
      const manifest = Routes.make().add(
        Route.make("/docs").layout(Layout).children(Route.make("/:path*").component(Comp)),
      ).manifest;

      const resolved = yield* resolveRoutes(manifest);

      assert.strictEqual(resolved.length, 1);
      assert.strictEqual(resolved[0]?.path, "/docs/:path*");
    }),
  );

});

// =============================================================================
// createMatcher - Trie-based matching
// =============================================================================

describe("createMatcher", () => {
  it.effect("should match static route", () =>
    Effect.gen(function* () {
      const manifest = Routes.make().add(Route.make("/about").component(Comp)).manifest;
      const matcher = yield* createMatcher(manifest);
      const result = matcher.match("/about");

      assert.isTrue(Option.isSome(result));
      if (Option.isSome(result)) {
        assert.strictEqual(result.value.route.path, "/about");
        assert.deepStrictEqual(result.value.params, {});
      }
    }),
  );

  it.effect("should match root path", () =>
    Effect.gen(function* () {
      const manifest = Routes.make().add(Route.make("/").component(Comp)).manifest;
      const matcher = yield* createMatcher(manifest);
      const result = matcher.match("/");

      assert.isTrue(Option.isSome(result));
      if (Option.isSome(result)) {
        assert.strictEqual(result.value.route.path, "/");
      }
    }),
  );

  it.effect("should match dynamic param route", () =>
    Effect.gen(function* () {
      const manifest = Routes.make().add(Route.make("/users/:id").component(Comp)).manifest;
      const matcher = yield* createMatcher(manifest);
      const result = matcher.match("/users/123");

      assert.isTrue(Option.isSome(result));
      if (Option.isSome(result)) {
        assert.strictEqual(result.value.route.path, "/users/:id");
        assert.strictEqual(result.value.params.id, "123");
      }
    }),
  );

  it.effect("should match nested child route", () =>
    Effect.gen(function* () {
      const manifest = Routes.make().add(
        Route.make("/settings").layout(Layout).children(Route.make("/profile").component(Comp)),
      ).manifest;

      const matcher = yield* createMatcher(manifest);
      const result = matcher.match("/settings/profile");

      assert.isTrue(Option.isSome(result));
      if (Option.isSome(result)) {
        assert.strictEqual(result.value.route.path, "/settings/profile");
      }
    }),
  );

  it.effect("should match index route at parent path", () =>
    Effect.gen(function* () {
      const manifest = Routes.make().add(
        Route.make("/settings")
          .layout(Layout)
          .children(Route.index(CompA), Route.make("/profile").component(CompB)),
      ).manifest;

      const matcher = yield* createMatcher(manifest);

      const indexResult = matcher.match("/settings");
      assert.isTrue(Option.isSome(indexResult));
      if (Option.isSome(indexResult)) {
        assert.strictEqual(indexResult.value.route.path, "/settings");
        assert.strictEqual(indexResult.value.route.definition.path, IndexMarker);
      }

      const profileResult = matcher.match("/settings/profile");
      assert.isTrue(Option.isSome(profileResult));
      if (Option.isSome(profileResult)) {
        assert.strictEqual(profileResult.value.route.path, "/settings/profile");
      }
    }),
  );

  it.effect("should match most specific route (static > param)", () =>
    Effect.gen(function* () {
      const manifest = Routes.make()
        .add(Route.make("/users/admin").component(CompA))
        .add(Route.make("/users/:id").component(CompB)).manifest;

      const matcher = yield* createMatcher(manifest);

      const result = matcher.match("/users/admin");
      assert.isTrue(Option.isSome(result));
      if (Option.isSome(result)) {
        assert.strictEqual(result.value.route.path, "/users/admin");
        assert.deepStrictEqual(result.value.params, {});
      }

      const dynamicResult = matcher.match("/users/123");
      assert.isTrue(Option.isSome(dynamicResult));
      if (Option.isSome(dynamicResult)) {
        assert.strictEqual(dynamicResult.value.route.path, "/users/:id");
        assert.strictEqual(dynamicResult.value.params.id, "123");
      }
    }),
  );

  it.effect("should match static > param > wildcard priority", () =>
    Effect.gen(function* () {
      const manifest = Routes.make()
        .add(Route.make("/docs/intro").component(CompA))
        .add(Route.make("/docs/:page").component(CompB))
        .add(Route.make("/docs/:path*").component(CompC)).manifest;

      const matcher = yield* createMatcher(manifest);

      const staticResult = matcher.match("/docs/intro");
      assert.isTrue(Option.isSome(staticResult));
      if (Option.isSome(staticResult)) {
        assert.strictEqual(staticResult.value.route.path, "/docs/intro");
      }

      const paramResult = matcher.match("/docs/tutorial");
      assert.isTrue(Option.isSome(paramResult));
      if (Option.isSome(paramResult)) {
        assert.strictEqual(paramResult.value.route.path, "/docs/:page");
        assert.strictEqual(paramResult.value.params.page, "tutorial");
      }

      const wildcardResult = matcher.match("/docs/api/users/list");
      assert.isTrue(Option.isSome(wildcardResult));
      if (Option.isSome(wildcardResult)) {
        assert.strictEqual(wildcardResult.value.route.path, "/docs/:path*");
        assert.strictEqual(wildcardResult.value.params.path, "api/users/list");
      }
    }),
  );

  it.effect("should return Option.none for unknown path", () =>
    Effect.gen(function* () {
      const manifest = Routes.make().add(Route.make("/users").component(Comp)).manifest;
      const matcher = yield* createMatcher(manifest);
      const result = matcher.match("/unknown");

      assert.isTrue(Option.isNone(result));
    }),
  );

  it.effect("should return Option.none for partial match", () =>
    Effect.gen(function* () {
      const manifest = Routes.make().add(Route.make("/users").component(Comp)).manifest;
      const matcher = yield* createMatcher(manifest);
      const result = matcher.match("/users/123/extra");

      assert.isTrue(Option.isNone(result));
    }),
  );

  it.effect("should match catch-all with zero segments", () =>
    Effect.gen(function* () {
      const manifest = Routes.make().add(Route.make("/docs/:path*").component(Comp)).manifest;
      const matcher = yield* createMatcher(manifest);
      const result = matcher.match("/docs");

      assert.isTrue(Option.isSome(result));
      if (Option.isSome(result)) {
        assert.strictEqual(result.value.params.path, "");
      }
    }),
  );

  it.effect("should not match required catch-all with zero segments", () =>
    Effect.gen(function* () {
      const manifest = Routes.make().add(Route.make("/files/:filepath+").component(Comp)).manifest;
      const matcher = yield* createMatcher(manifest);
      const result = matcher.match("/files");

      assert.isTrue(Option.isNone(result));
    }),
  );

  it.effect("should match required catch-all with one segment", () =>
    Effect.gen(function* () {
      const manifest = Routes.make().add(Route.make("/files/:filepath+").component(Comp)).manifest;
      const matcher = yield* createMatcher(manifest);
      const result = matcher.match("/files/readme.txt");

      assert.isTrue(Option.isSome(result));
      if (Option.isSome(result)) {
        assert.strictEqual(result.value.params.filepath, "readme.txt");
      }
    }),
  );

  it.effect("should strip query string before matching", () =>
    Effect.gen(function* () {
      const manifest = Routes.make().add(Route.make("/search").component(Comp)).manifest;
      const matcher = yield* createMatcher(manifest);
      const result = matcher.match("/search?q=hello&page=2");

      assert.isTrue(Option.isSome(result));
      if (Option.isSome(result)) {
        assert.strictEqual(result.value.route.path, "/search");
      }
    }),
  );

  it.effect("should expose resolved routes", () =>
    Effect.gen(function* () {
      const manifest = Routes.make()
        .add(Route.make("/").component(CompA))
        .add(
          Route.make("/settings")
            .layout(Layout)
            .children(Route.index(CompB), Route.make("/profile").component(CompC)),
        ).manifest;

      const matcher = yield* createMatcher(manifest);

      assert.strictEqual(matcher.routes.length, 3);
    }),
  );

  it.effect("should match deeply nested dynamic routes", () =>
    Effect.gen(function* () {
      const manifest = Routes.make().add(
        Route.make("/admin")
          .layout(Layout)
          .children(
            Route.make("/users").layout(Layout).children(Route.make("/:id").component(Comp)),
          ),
      ).manifest;

      const matcher = yield* createMatcher(manifest);
      const result = matcher.match("/admin/users/456");

      assert.isTrue(Option.isSome(result));
      if (Option.isSome(result)) {
        assert.strictEqual(result.value.route.path, "/admin/users/:id");
        assert.strictEqual(result.value.params.id, "456");
        assert.strictEqual(result.value.route.ancestors.length, 2);
      }
    }),
  );
});

// =============================================================================
// Re-match on path change
// =============================================================================

describe("re-match on path change", () => {
  it.scoped("should match different routes on navigation", () =>
    Effect.gen(function* () {
      const manifest = Routes.make()
        .add(Route.make("/").component(CompA))
        .add(Route.make("/users").component(CompB))
        .add(Route.make("/settings").component(CompC)).manifest;

      const matcher = yield* createMatcher(manifest);
      const router = yield* Router.get;

      // Initially at /
      const route1 = yield* Signal.get(router.current);
      const match1 = matcher.match(route1.path);
      assert.isTrue(Option.isSome(match1));
      if (Option.isSome(match1)) {
        assert.strictEqual(match1.value.route.path, "/");
      }

      // Navigate to /users
      yield* router.navigate("/users");
      const route2 = yield* Signal.get(router.current);
      const match2 = matcher.match(route2.path);
      assert.isTrue(Option.isSome(match2));
      if (Option.isSome(match2)) {
        assert.strictEqual(match2.value.route.path, "/users");
      }

      // Navigate to /settings
      yield* router.navigate("/settings");
      const route3 = yield* Signal.get(router.current);
      const match3 = matcher.match(route3.path);
      assert.isTrue(Option.isSome(match3));
      if (Option.isSome(match3)) {
        assert.strictEqual(match3.value.route.path, "/settings");
      }
    }).pipe(Effect.provide(Router.testLayer("/"))),
  );

  it.scoped("should return no match for unknown path after navigation", () =>
    Effect.gen(function* () {
      const manifest = Routes.make().add(Route.make("/users").component(Comp)).manifest;

      const matcher = yield* createMatcher(manifest);
      const router = yield* Router.get;

      yield* router.navigate("/nonexistent");
      const route = yield* Signal.get(router.current);
      const result = matcher.match(route.path);

      assert.isTrue(Option.isNone(result));
    }).pipe(Effect.provide(Router.testLayer("/"))),
  );
});
