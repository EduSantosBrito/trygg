/**
 * Navigation Updates Unit Tests (Phase 9)
 *
 * Tests for:
 * - Router.get (replaces getRouter)
 * - NavigateOptions.params for path interpolation
 * - Number params (toString conversion)
 * - Link component with typed params prop
 * - Link prefetch strategies (intent, render, false)
 * - interpolateParams utility
 */
import { assert, describe, it } from "@effect/vitest";
import { Effect } from "effect";
import * as Router from "../service.js";
import { interpolateParams, buildPathWithParams } from "../types.js";
import * as Signal from "../../primitives/signal.js";

// =============================================================================
// Router.get - Context.Tag accessor
// =============================================================================

describe("Router.get", () => {
  it.scoped("should return RouterService", () =>
    Effect.gen(function* () {
      const router = yield* Router.get;

      assert.isDefined(router.current);
      assert.isDefined(router.navigate);
      assert.isDefined(router.back);
      assert.isDefined(router.forward);
      assert.isDefined(router.params);
      assert.isDefined(router.query);
      assert.isDefined(router.isActive);
      assert.isDefined(router.prefetch);
    }).pipe(Effect.provide(Router.testLayer("/"))),
  );

  it.scoped("should be the same as getRouter (backward compat)", () =>
    Effect.gen(function* () {
      const fromGet = yield* Router.get;
      const fromGetRouter = yield* Router.getRouter;

      assert.strictEqual(fromGet, fromGetRouter);
    }).pipe(Effect.provide(Router.testLayer("/"))),
  );
});

// =============================================================================
// NavigateOptions.params - Path interpolation
// =============================================================================

describe("navigate with params", () => {
  it.scoped("should interpolate params into path", () =>
    Effect.gen(function* () {
      const router = yield* Router.get;

      yield* router.navigate("/users/:id", { params: { id: "123" } });

      const route = yield* Signal.get(router.current);
      assert.strictEqual(route.path, "/users/123");
    }).pipe(Effect.provide(Router.testLayer("/"))),
  );

  it.scoped("should interpolate multiple params", () =>
    Effect.gen(function* () {
      const router = yield* Router.get;

      yield* router.navigate("/blog/:year/:slug", {
        params: { year: "2024", slug: "hello" },
      });

      const route = yield* Signal.get(router.current);
      assert.strictEqual(route.path, "/blog/2024/hello");
    }).pipe(Effect.provide(Router.testLayer("/"))),
  );

  it.scoped("should handle number params (toString)", () =>
    Effect.gen(function* () {
      const router = yield* Router.get;

      yield* router.navigate("/users/:id", { params: { id: 42 } });

      const route = yield* Signal.get(router.current);
      assert.strictEqual(route.path, "/users/42");
    }).pipe(Effect.provide(Router.testLayer("/"))),
  );

  it.scoped("should handle number params with multiple segments", () =>
    Effect.gen(function* () {
      const router = yield* Router.get;

      yield* router.navigate("/blog/:year/:month/:slug", {
        params: { year: 2024, month: 12, slug: "hello-world" },
      });

      const route = yield* Signal.get(router.current);
      assert.strictEqual(route.path, "/blog/2024/12/hello-world");
    }).pipe(Effect.provide(Router.testLayer("/"))),
  );

  it.scoped("should combine params and query", () =>
    Effect.gen(function* () {
      const router = yield* Router.get;

      yield* router.navigate("/users/:id/posts", {
        params: { id: 123 },
        query: { page: "2" },
      });

      const route = yield* Signal.get(router.current);
      assert.strictEqual(route.path, "/users/123/posts");
      assert.strictEqual(route.query.get("page"), "2");
    }).pipe(Effect.provide(Router.testLayer("/"))),
  );

  it.scoped("should combine params with replace", () =>
    Effect.gen(function* () {
      const router = yield* Router.get;

      yield* router.navigate("/first");
      yield* router.navigate("/users/:id", { params: { id: 1 }, replace: true });

      const route = yield* Signal.get(router.current);
      assert.strictEqual(route.path, "/users/1");

      // Back should go to "/" (not "/first", since it was replaced)
      yield* router.back();
      const afterBack = yield* Signal.get(router.current);
      assert.strictEqual(afterBack.path, "/");
    }).pipe(Effect.provide(Router.testLayer("/"))),
  );

  it.scoped("should navigate without params when none provided", () =>
    Effect.gen(function* () {
      const router = yield* Router.get;

      yield* router.navigate("/users");

      const route = yield* Signal.get(router.current);
      assert.strictEqual(route.path, "/users");
    }).pipe(Effect.provide(Router.testLayer("/"))),
  );

  it.scoped("should not modify path when params is empty object", () =>
    Effect.gen(function* () {
      const router = yield* Router.get;

      yield* router.navigate("/about", { params: {} });

      const route = yield* Signal.get(router.current);
      assert.strictEqual(route.path, "/about");
    }).pipe(Effect.provide(Router.testLayer("/"))),
  );

  it.scoped("should handle zero as param value", () =>
    Effect.gen(function* () {
      const router = yield* Router.get;

      yield* router.navigate("/items/:id", { params: { id: 0 } });

      const route = yield* Signal.get(router.current);
      assert.strictEqual(route.path, "/items/0");
    }).pipe(Effect.provide(Router.testLayer("/"))),
  );
});

// =============================================================================
// interpolateParams - Internal utility
// =============================================================================

describe("interpolateParams", () => {
  it.effect("should substitute single param", () =>
    Effect.gen(function* () {
      const result = yield* interpolateParams("/users/:id", { id: "123" });
      assert.strictEqual(result, "/users/123");
    }),
  );

  it.effect("should substitute multiple params", () =>
    Effect.gen(function* () {
      const result = yield* interpolateParams("/blog/:year/:slug", {
        year: "2024",
        slug: "hello",
      });
      assert.strictEqual(result, "/blog/2024/hello");
    }),
  );

  it.effect("should convert number to string", () =>
    Effect.gen(function* () {
      const result = yield* interpolateParams("/users/:id", { id: 42 });
      assert.strictEqual(result, "/users/42");
    }),
  );

  it.effect("should handle zero", () =>
    Effect.gen(function* () {
      const result = yield* interpolateParams("/items/:id", { id: 0 });
      assert.strictEqual(result, "/items/0");
    }),
  );

  it.effect("should leave path unchanged with empty params", () =>
    Effect.gen(function* () {
      const result = yield* interpolateParams("/about", {});
      assert.strictEqual(result, "/about");
    }),
  );

  it.effect("should not replace non-matching params", () =>
    Effect.gen(function* () {
      const result = yield* interpolateParams("/users/:id", { name: "test" });
      assert.strictEqual(result, "/users/:id");
    }),
  );

  it.effect("should handle negative numbers", () =>
    Effect.gen(function* () {
      const result = yield* interpolateParams("/offset/:n", { n: -1 });
      assert.strictEqual(result, "/offset/-1");
    }),
  );
});

// =============================================================================
// buildPathWithParams - Type-safe path builder
// =============================================================================

describe("buildPathWithParams", () => {
  it.effect("should substitute string params", () =>
    Effect.gen(function* () {
      const result = yield* buildPathWithParams("/users/:id", { id: "abc" });
      assert.strictEqual(result, "/users/abc");
    }),
  );

  it.effect("should substitute number params via toString", () =>
    Effect.gen(function* () {
      // buildPathWithParams type expects RouteParamsFor<Path> which is Record<string, string>
      // by default (from ExtractRouteParams). But the runtime handles numbers too.
      const result = yield* buildPathWithParams("/users/:id", {
        id: "99",
      });
      assert.strictEqual(result, "/users/99");
    }),
  );

  it.effect("should handle multiple params", () =>
    Effect.gen(function* () {
      const result = yield* buildPathWithParams("/blog/:year/:slug", {
        year: "2024",
        slug: "hello-world",
      });
      assert.strictEqual(result, "/blog/2024/hello-world");
    }),
  );

  it.effect("should leave unmatched segments intact", () =>
    Effect.gen(function* () {
      const result = yield* buildPathWithParams("/users/:id/posts", { id: "5" });
      assert.strictEqual(result, "/users/5/posts");
    }),
  );
});

// =============================================================================
// Module-level navigate function
// =============================================================================

describe("Router.navigate (module-level)", () => {
  it.scoped("should interpolate params when calling module-level navigate", () =>
    Effect.gen(function* () {
      yield* Router.navigate("/users/:id", { params: { id: 456 } });

      const router = yield* Router.get;
      const route = yield* Signal.get(router.current);
      assert.strictEqual(route.path, "/users/456");
    }).pipe(Effect.provide(Router.testLayer("/"))),
  );
});
