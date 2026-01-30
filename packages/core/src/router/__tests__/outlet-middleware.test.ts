/**
 * Outlet Middleware Unit Tests (Phase 11)
 *
 * Tests for:
 * - Middleware chain execution order (left-to-right)
 * - Parent middleware runs before child middleware
 * - RouterRedirect failure triggers redirect
 * - RouterForbidden failure triggers forbidden boundary
 * - Other failures trigger error boundary
 * - Chain halts on first failure
 * - Pass-through when all middleware succeed
 */
import { assert, describe, it } from "@effect/vitest";
import { Data, Effect, Option, Ref } from "effect";
import * as Route from "../route.js";
import { routeRedirect, routeForbidden } from "../route.js";
import * as Routes from "../routes.js";
import { createMatcher, collectRouteMiddleware, runRouteMiddleware } from "../matching.js";
import { empty } from "../../primitives/element.js";
import type { RouteComponent } from "../types.js";
import type { Component } from "../../primitives/component.js";
import type { Layer, Context } from "effect";

class TestMiddlewareError extends Data.TaggedError("TestMiddlewareError")<{
  readonly message: string;
}> {}

// Helper to create dummy RouteComponent
const makeComp = (): RouteComponent => {
  const fn = () => empty;
  const comp = Object.assign(fn, {
    _tag: "EffectComponent" as const,
    _layers: [] as ReadonlyArray<Layer.Layer.Any>,
    _requirements: [] as ReadonlyArray<Context.Tag<any, any>>,
    provide: () => comp as Component.Type<never, unknown, unknown>,
  });
  return comp as RouteComponent;
};

// Dummy components
const Comp = makeComp();
const Layout = makeComp();

// =============================================================================
// collectRouteMiddleware - Ordering
// =============================================================================

describe("collectRouteMiddleware", () => {
  it.effect("should collect middleware in left-to-right order", () =>
    Effect.gen(function* () {
      const m1 = Effect.void;
      const m2 = Effect.void;
      const m3 = Effect.void;

      const manifest = Routes.make().add(
        Route.make("/test").middleware(m1).middleware(m2).middleware(m3).component(Comp),
      ).manifest;

      const matcher = yield* createMatcher(manifest);
      const match = matcher.match("/test");
      assert.isTrue(Option.isSome(match));

      if (Option.isSome(match)) {
        const chain = collectRouteMiddleware(match.value.route);
        assert.strictEqual(chain.length, 3);
        assert.strictEqual(chain[0], m1);
        assert.strictEqual(chain[1], m2);
        assert.strictEqual(chain[2], m3);
      }
    }),
  );

  it.effect("should collect parent middleware before child", () =>
    Effect.gen(function* () {
      const parentMiddleware = Effect.void;
      const childMiddleware = Effect.void;

      const manifest = Routes.make().add(
        Route.make("/admin")
          .middleware(parentMiddleware)
          .layout(Layout)
          .children(Route.make("/users").middleware(childMiddleware).component(Comp)),
      ).manifest;

      const matcher = yield* createMatcher(manifest);
      const match = matcher.match("/admin/users");
      assert.isTrue(Option.isSome(match));

      if (Option.isSome(match)) {
        const chain = collectRouteMiddleware(match.value.route);
        assert.strictEqual(chain.length, 2);
        assert.strictEqual(chain[0], parentMiddleware);
        assert.strictEqual(chain[1], childMiddleware);
      }
    }),
  );

  it.effect("should collect middleware from multiple ancestors (root-to-leaf)", () =>
    Effect.gen(function* () {
      const m1 = Effect.void;
      const m2 = Effect.void;
      const m3 = Effect.void;

      const manifest = Routes.make().add(
        Route.make("/a")
          .middleware(m1)
          .layout(Layout)
          .children(
            Route.make("/b")
              .middleware(m2)
              .layout(Layout)
              .children(Route.make("/c").middleware(m3).component(Comp)),
          ),
      ).manifest;

      const matcher = yield* createMatcher(manifest);
      const match = matcher.match("/a/b/c");
      assert.isTrue(Option.isSome(match));

      if (Option.isSome(match)) {
        const chain = collectRouteMiddleware(match.value.route);
        assert.strictEqual(chain.length, 3);
        assert.strictEqual(chain[0], m1);
        assert.strictEqual(chain[1], m2);
        assert.strictEqual(chain[2], m3);
      }
    }),
  );

  it.effect("should return empty chain when no middleware defined", () =>
    Effect.gen(function* () {
      const manifest = Routes.make().add(Route.make("/simple").component(Comp)).manifest;

      const matcher = yield* createMatcher(manifest);
      const match = matcher.match("/simple");
      assert.isTrue(Option.isSome(match));

      if (Option.isSome(match)) {
        const chain = collectRouteMiddleware(match.value.route);
        assert.strictEqual(chain.length, 0);
      }
    }),
  );

  it.effect("should collect multiple parent middleware in order", () =>
    Effect.gen(function* () {
      const parentM1 = Effect.void;
      const parentM2 = Effect.void;
      const childM1 = Effect.void;

      const manifest = Routes.make().add(
        Route.make("/admin")
          .middleware(parentM1)
          .middleware(parentM2)
          .layout(Layout)
          .children(Route.make("/dashboard").middleware(childM1).component(Comp)),
      ).manifest;

      const matcher = yield* createMatcher(manifest);
      const match = matcher.match("/admin/dashboard");
      assert.isTrue(Option.isSome(match));

      if (Option.isSome(match)) {
        const chain = collectRouteMiddleware(match.value.route);
        assert.strictEqual(chain.length, 3);
        assert.strictEqual(chain[0], parentM1);
        assert.strictEqual(chain[1], parentM2);
        assert.strictEqual(chain[2], childM1);
      }
    }),
  );
});

// =============================================================================
// runRouteMiddleware - Execution
// =============================================================================

describe("runRouteMiddleware", () => {
  it.effect("should return Continue when all middleware pass", () =>
    Effect.gen(function* () {
      const manifest = Routes.make().add(
        Route.make("/test").middleware(Effect.void).middleware(Effect.void).component(Comp),
      ).manifest;

      const matcher = yield* createMatcher(manifest);
      const match = matcher.match("/test");
      assert.isTrue(Option.isSome(match));

      if (Option.isSome(match)) {
        const result = yield* runRouteMiddleware(match.value.route);
        assert.strictEqual(result._tag, "Continue");
      }
    }),
  );

  it.effect("should return Continue for route without middleware", () =>
    Effect.gen(function* () {
      const manifest = Routes.make().add(Route.make("/test").component(Comp)).manifest;

      const matcher = yield* createMatcher(manifest);
      const match = matcher.match("/test");
      assert.isTrue(Option.isSome(match));

      if (Option.isSome(match)) {
        const result = yield* runRouteMiddleware(match.value.route);
        assert.strictEqual(result._tag, "Continue");
      }
    }),
  );

  it.effect("should execute middleware left-to-right", () =>
    Effect.gen(function* () {
      const order = yield* Ref.make<ReadonlyArray<string>>([]);

      const m1 = Ref.update(order, (arr) => [...arr, "A"]);
      const m2 = Ref.update(order, (arr) => [...arr, "B"]);
      const m3 = Ref.update(order, (arr) => [...arr, "C"]);

      const manifest = Routes.make().add(
        Route.make("/test").middleware(m1).middleware(m2).middleware(m3).component(Comp),
      ).manifest;

      const matcher = yield* createMatcher(manifest);
      const match = matcher.match("/test");
      assert.isTrue(Option.isSome(match));

      if (Option.isSome(match)) {
        const result = yield* runRouteMiddleware(match.value.route);
        assert.strictEqual(result._tag, "Continue");

        const executed = yield* Ref.get(order);
        assert.deepStrictEqual(executed, ["A", "B", "C"]);
      }
    }),
  );

  it.effect("should run parent middleware before child middleware", () =>
    Effect.gen(function* () {
      const order = yield* Ref.make<ReadonlyArray<string>>([]);

      const parentMiddleware = Ref.update(order, (arr) => [...arr, "parent"]);
      const childMiddleware = Ref.update(order, (arr) => [...arr, "child"]);

      const manifest = Routes.make().add(
        Route.make("/admin")
          .middleware(parentMiddleware)
          .layout(Layout)
          .children(Route.make("/dashboard").middleware(childMiddleware).component(Comp)),
      ).manifest;

      const matcher = yield* createMatcher(manifest);
      const match = matcher.match("/admin/dashboard");
      assert.isTrue(Option.isSome(match));

      if (Option.isSome(match)) {
        const result = yield* runRouteMiddleware(match.value.route);
        assert.strictEqual(result._tag, "Continue");

        const executed = yield* Ref.get(order);
        assert.deepStrictEqual(executed, ["parent", "child"]);
      }
    }),
  );

  it.effect("should return Redirect on RouterRedirect failure", () =>
    Effect.gen(function* () {
      const redirectMiddleware = routeRedirect("/login");

      const manifest = Routes.make().add(
        Route.make("/protected").middleware(redirectMiddleware).component(Comp),
      ).manifest;

      const matcher = yield* createMatcher(manifest);
      const match = matcher.match("/protected");
      assert.isTrue(Option.isSome(match));

      if (Option.isSome(match)) {
        const result = yield* runRouteMiddleware(match.value.route);
        assert.strictEqual(result._tag, "Redirect");
        if (result._tag === "Redirect") {
          assert.strictEqual(result.path, "/login");
          assert.strictEqual(result.replace, false);
        }
      }
    }),
  );

  it.effect("should return Redirect with replace option", () =>
    Effect.gen(function* () {
      const redirectMiddleware = routeRedirect("/login", { replace: true });

      const manifest = Routes.make().add(
        Route.make("/protected").middleware(redirectMiddleware).component(Comp),
      ).manifest;

      const matcher = yield* createMatcher(manifest);
      const match = matcher.match("/protected");
      assert.isTrue(Option.isSome(match));

      if (Option.isSome(match)) {
        const result = yield* runRouteMiddleware(match.value.route);
        assert.strictEqual(result._tag, "Redirect");
        if (result._tag === "Redirect") {
          assert.strictEqual(result.replace, true);
        }
      }
    }),
  );

  it.effect("should return Forbidden on RouterForbidden failure", () =>
    Effect.gen(function* () {
      const forbiddenMiddleware = routeForbidden();

      const manifest = Routes.make().add(
        Route.make("/admin").middleware(forbiddenMiddleware).component(Comp),
      ).manifest;

      const matcher = yield* createMatcher(manifest);
      const match = matcher.match("/admin");
      assert.isTrue(Option.isSome(match));

      if (Option.isSome(match)) {
        const result = yield* runRouteMiddleware(match.value.route);
        assert.strictEqual(result._tag, "Forbidden");
      }
    }),
  );

  it.effect("should return Error on other failures", () =>
    Effect.gen(function* () {
      const failingMiddleware = Effect.fail(new TestMiddlewareError({ message: "oops" }));

      const manifest = Routes.make().add(
        Route.make("/broken").middleware(failingMiddleware).component(Comp),
      ).manifest;

      const matcher = yield* createMatcher(manifest);
      const match = matcher.match("/broken");
      assert.isTrue(Option.isSome(match));

      if (Option.isSome(match)) {
        const result = yield* runRouteMiddleware(match.value.route);
        assert.strictEqual(result._tag, "Error");
      }
    }),
  );

  it.effect("should halt chain on first failure (redirect)", () =>
    Effect.gen(function* () {
      const order = yield* Ref.make<ReadonlyArray<string>>([]);

      const redirectMiddleware = Effect.gen(function* () {
        yield* Ref.update(order, (arr) => [...arr, "redirect"]);
        return yield* routeRedirect("/login");
      });
      const secondMiddleware = Ref.update(order, (arr) => [...arr, "second"]);

      const manifest = Routes.make().add(
        Route.make("/protected")
          .middleware(redirectMiddleware)
          .middleware(secondMiddleware)
          .component(Comp),
      ).manifest;

      const matcher = yield* createMatcher(manifest);
      const match = matcher.match("/protected");
      assert.isTrue(Option.isSome(match));

      if (Option.isSome(match)) {
        const result = yield* runRouteMiddleware(match.value.route);
        assert.strictEqual(result._tag, "Redirect");

        const executed = yield* Ref.get(order);
        assert.deepStrictEqual(executed, ["redirect"]);
      }
    }),
  );

  it.effect("should halt chain on first failure (forbidden)", () =>
    Effect.gen(function* () {
      const order = yield* Ref.make<ReadonlyArray<string>>([]);

      const forbidMiddleware = Effect.gen(function* () {
        yield* Ref.update(order, (arr) => [...arr, "forbid"]);
        return yield* routeForbidden();
      });
      const logMiddleware = Ref.update(order, (arr) => [...arr, "log"]);

      const manifest = Routes.make().add(
        Route.make("/admin").middleware(forbidMiddleware).middleware(logMiddleware).component(Comp),
      ).manifest;

      const matcher = yield* createMatcher(manifest);
      const match = matcher.match("/admin");
      assert.isTrue(Option.isSome(match));

      if (Option.isSome(match)) {
        const result = yield* runRouteMiddleware(match.value.route);
        assert.strictEqual(result._tag, "Forbidden");

        const executed = yield* Ref.get(order);
        assert.deepStrictEqual(executed, ["forbid"]);
      }
    }),
  );

  it.effect("should halt parent chain before reaching child middleware", () =>
    Effect.gen(function* () {
      const order = yield* Ref.make<ReadonlyArray<string>>([]);

      const parentRedirect = Effect.gen(function* () {
        yield* Ref.update(order, (arr) => [...arr, "parent"]);
        return yield* routeRedirect("/login");
      });
      const childMiddleware = Ref.update(order, (arr) => [...arr, "child"]);

      const manifest = Routes.make().add(
        Route.make("/admin")
          .middleware(parentRedirect)
          .layout(Layout)
          .children(Route.make("/users").middleware(childMiddleware).component(Comp)),
      ).manifest;

      const matcher = yield* createMatcher(manifest);
      const match = matcher.match("/admin/users");
      assert.isTrue(Option.isSome(match));

      if (Option.isSome(match)) {
        const result = yield* runRouteMiddleware(match.value.route);
        assert.strictEqual(result._tag, "Redirect");

        const executed = yield* Ref.get(order);
        assert.deepStrictEqual(executed, ["parent"]);
      }
    }),
  );

  it.effect("should pass through 3 levels of middleware when all succeed", () =>
    Effect.gen(function* () {
      const order = yield* Ref.make<ReadonlyArray<string>>([]);

      const m1 = Ref.update(order, (arr) => [...arr, "L1"]);
      const m2 = Ref.update(order, (arr) => [...arr, "L2"]);
      const m3 = Ref.update(order, (arr) => [...arr, "L3"]);

      const manifest = Routes.make().add(
        Route.make("/a")
          .middleware(m1)
          .layout(Layout)
          .children(
            Route.make("/b")
              .middleware(m2)
              .layout(Layout)
              .children(Route.make("/c").middleware(m3).component(Comp)),
          ),
      ).manifest;

      const matcher = yield* createMatcher(manifest);
      const match = matcher.match("/a/b/c");
      assert.isTrue(Option.isSome(match));

      if (Option.isSome(match)) {
        const result = yield* runRouteMiddleware(match.value.route);
        assert.strictEqual(result._tag, "Continue");

        const executed = yield* Ref.get(order);
        assert.deepStrictEqual(executed, ["L1", "L2", "L3"]);
      }
    }),
  );
});
