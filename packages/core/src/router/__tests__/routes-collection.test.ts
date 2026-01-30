// Routes Collection Unit Tests (Phase 5)
//
// Tests for Routes.make(), .add() with R=never enforcement,
// .notFound(), .forbidden(), and manifest generation.
import { assert, describe, it } from "@effect/vitest";
import { Context, Effect } from "effect";
import * as Route from "../route.js";
import * as Routes from "../routes.js";
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
    _requirements: [] as ReadonlyArray<Context.Tag<any, any>>,
    provide: () => comp as Component.Type<never, unknown, unknown>,
  });
  return comp as RouteComponent;
};

// Dummy components
const comp = makeComp();
const notFoundComp = makeComp();
const forbiddenComp = makeComp();

// Test service for R != never
class AuthService extends Context.Tag("AuthService")<AuthService, { check: () => boolean }>() {}

// =============================================================================
// Routes.make() - Create empty collection
// =============================================================================

describe("Routes.make()", () => {
  it("should create empty routes collection", () => {
    const routes = Routes.make();

    assert.strictEqual(routes._tag, "RoutesCollection");
    assert.deepStrictEqual(routes.manifest.routes, []);
    assert.strictEqual(routes.manifest.notFound, undefined);
    assert.strictEqual(routes.manifest.forbidden, undefined);
  });
});

// =============================================================================
// .add() - Add routes to collection
// =============================================================================

describe(".add()", () => {
  it("should add routes to collection", () => {
    const route1 = Route.make("/").component(comp);
    const route2 = Route.make("/users").component(comp);

    const routes = Routes.make().add(route1).add(route2);

    assert.strictEqual(routes.manifest.routes.length, 2);
    assert.strictEqual(routes.manifest.routes[0]?.path, "/");
    assert.strictEqual(routes.manifest.routes[1]?.path, "/users");
  });

  it("should accept route with R = never", () => {
    const route = Route.make("/about").component(comp);
    const routes = Routes.make().add(route);

    assert.strictEqual(routes.manifest.routes.length, 1);
  });

  it("should reject route with unsatisfied R (type-level)", () => {
    const requireAuth = AuthService.pipe(Effect.flatMap(() => Effect.void));
    const routeWithR = Route.make("/admin").middleware(requireAuth).component(comp);

    // @ts-expect-error - Route has R = AuthService, not never
    Routes.make().add(routeWithR);
  });

  it("should preserve route order", () => {
    const r1 = Route.make("/a").component(comp);
    const r2 = Route.make("/b").component(comp);
    const r3 = Route.make("/c").component(comp);

    const routes = Routes.make().add(r1).add(r2).add(r3);

    assert.strictEqual(routes.manifest.routes[0]?.path, "/a");
    assert.strictEqual(routes.manifest.routes[1]?.path, "/b");
    assert.strictEqual(routes.manifest.routes[2]?.path, "/c");
  });

  it("should store route definitions with all metadata", () => {
    const route = Route.make("/users").component(comp).loading(comp).error(comp);

    const routes = Routes.make().add(route);
    const def = routes.manifest.routes[0];

    assert.isDefined(def);
    assert.strictEqual(def?.component, comp);
    assert.strictEqual(def?.loading, comp);
    assert.strictEqual(def?.error, comp);
  });
});

// =============================================================================
// .notFound() - Root 404 handler
// =============================================================================

describe(".notFound()", () => {
  it("should store root notFound handler", () => {
    const routes = Routes.make().notFound(notFoundComp);

    assert.strictEqual(routes.manifest.notFound, notFoundComp);
  });

  it("should override previous notFound", () => {
    const other = makeComp();
    const routes = Routes.make().notFound(notFoundComp).notFound(other);

    assert.strictEqual(routes.manifest.notFound, other);
  });
});

// =============================================================================
// .forbidden() - Root 403 handler
// =============================================================================

describe(".forbidden()", () => {
  it("should store root forbidden handler", () => {
    const routes = Routes.make().forbidden(forbiddenComp);

    assert.strictEqual(routes.manifest.forbidden, forbiddenComp);
  });

  it("should override previous forbidden", () => {
    const other = makeComp();
    const routes = Routes.make().forbidden(forbiddenComp).forbidden(other);

    assert.strictEqual(routes.manifest.forbidden, other);
  });
});

// =============================================================================
// Manifest generation
// =============================================================================

describe("Manifest generation", () => {
  it("should convert to internal manifest", () => {
    const route1 = Route.make("/").component(comp);
    const route2 = Route.make("/users").component(comp);

    const routes = Routes.make()
      .add(route1)
      .add(route2)
      .notFound(notFoundComp)
      .forbidden(forbiddenComp);

    const manifest = routes.manifest;

    assert.strictEqual(manifest.routes.length, 2);
    assert.strictEqual(manifest.notFound, notFoundComp);
    assert.strictEqual(manifest.forbidden, forbiddenComp);
  });

  it("should include children in route definitions", () => {
    const child = Route.make("/profile").component(comp);
    const parent = Route.make("/settings").layout(comp).children(child);

    const routes = Routes.make().add(parent);
    const def = routes.manifest.routes[0];

    assert.strictEqual(def?.children.length, 1);
    assert.strictEqual(def?.children[0]?.path, "/profile");
  });

  it("should be immutable - each operation returns new collection", () => {
    const route = Route.make("/").component(comp);
    const empty = Routes.make();
    const withRoute = empty.add(route);

    assert.strictEqual(empty.manifest.routes.length, 0);
    assert.strictEqual(withRoute.manifest.routes.length, 1);
  });
});
