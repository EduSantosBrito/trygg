/**
 * Route Builder Unit Tests (Phase 1)
 *
 * Tests for the route builder - Route.make, Route.index,
 * ExtractParams type extraction, Pipeable protocol, and mutual exclusion
 * of .component() and .children().
 */
import { assert, describe, it } from "@effect/vitest";
import { Effect, Layer } from "effect";
import * as Route from "../route.js";
import { RenderStrategy } from "../render-strategy.js";
import { ScrollStrategy } from "../scroll-strategy.js";
import { empty } from "../../primitives/element.js";
import type { RouteComponent } from "../types.js";
import type { Component } from "../../primitives/component.js";

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

// Dummy components for testing - return empty Element
const component = makeComp();
const layout = makeComp();
const loading = makeComp();

// =============================================================================
// Route.make - Create route with path
// =============================================================================

describe("Route.make", () => {
  it("should create route with static path", () => {
    const route = Route.make("/about");

    assert.strictEqual(route._tag, "RouteBuilder");
    assert.strictEqual(route.definition.path, "/about");
    assert.strictEqual(route.definition.component, undefined);
  });

  it("should create route with dynamic path", () => {
    const route = Route.make("/users/:id");

    assert.strictEqual(route.definition.path, "/users/:id");
  });

  it("should create route with multiple params", () => {
    const route = Route.make("/blog/:year/:month/:slug");

    assert.strictEqual(route.definition.path, "/blog/:year/:month/:slug");
  });

  it("should create route with catch-all path", () => {
    const route = Route.make("/docs/:path*");

    assert.strictEqual(route.definition.path, "/docs/:path*");
  });

  it("should create route with required catch-all path", () => {
    const route = Route.make("/files/:filepath+");

    assert.strictEqual(route.definition.path, "/files/:filepath+");
  });

  it("should store component reference", () => {
    const route = Route.make("/about").component(component);

    assert.strictEqual(route.definition.component, component);
  });

  it("should store layout reference", () => {
    const route = Route.make("/settings").layout(layout);

    assert.strictEqual(route.definition.layout, layout);
  });

  it("should store loading fallback", () => {
    const route = Route.make("/users/:id").loading(loading);

    assert.strictEqual(route.definition.loading, loading);
  });

  it("should store error boundary component", () => {
    const route = Route.make("/dashboard").error(component);

    assert.strictEqual(route.definition.error, component);
  });

  it("should store notFound boundary component", () => {
    const route = Route.make("/admin").notFound(component);

    assert.strictEqual(route.definition.notFound, component);
  });

  it("should store forbidden boundary component", () => {
    const route = Route.make("/admin").forbidden(component);

    assert.strictEqual(route.definition.forbidden, component);
  });

  it("should initialize with empty middleware array", () => {
    const route = Route.make("/about");

    assert.deepStrictEqual(route.definition.middleware, []);
  });

  it("should initialize with empty prefetch array", () => {
    const route = Route.make("/about");

    assert.deepStrictEqual(route.definition.prefetch, []);
  });

  it("should initialize with empty children array", () => {
    const route = Route.make("/about");

    assert.deepStrictEqual(route.definition.children, []);
  });

  it("should be immutable - each method returns a new builder", () => {
    const original = Route.make("/about");
    const withComponent = original.component(component);

    assert.strictEqual(original.definition.component, undefined);
    assert.strictEqual(withComponent.definition.component, component);
  });
});

// =============================================================================
// Route.index - Create index route
// =============================================================================

describe("Route.index", () => {
  it("should create index route with component", () => {
    const route = Route.index(component);

    assert.strictEqual(route._tag, "RouteBuilder");
    assert.strictEqual(route.definition.path, Route.IndexMarker);
    assert.strictEqual(route.definition.component, component);
  });

  it("should be distinct from Route.make", () => {
    const indexRoute = Route.index(component);
    const makeRoute = Route.make("/");

    // Index uses symbol marker, make uses string path
    assert.notStrictEqual(indexRoute.definition.path, makeRoute.definition.path);
  });
});

// =============================================================================
// ExtractParams - Type-level param extraction
// =============================================================================

describe("ExtractParams", () => {
  it("should extract param names from path type", () => {
    // Type-level test: if this compiles, extraction works correctly
    const _id: Route.ExtractParams<"/users/:id"> = "id";
    assert.strictEqual(_id, "id");
  });

  it("should extract multiple params from path", () => {
    const _year: Route.ExtractParams<"/blog/:year/:slug"> = "year";
    const _slug: Route.ExtractParams<"/blog/:year/:slug"> = "slug";
    assert.strictEqual(_year, "year");
    assert.strictEqual(_slug, "slug");
  });

  it("should extract no params from static path", () => {
    // ExtractParams<"/about"> = never
    // We can verify by assigning to a function that accepts never
    type Result = Route.ExtractParams<"/about">;
    type IsNever = [Result] extends [never] ? true : false;
    const check: IsNever = true;
    assert.isTrue(check);
  });

  it("should extract param name from catch-all *", () => {
    const _path: Route.ExtractParams<"/docs/:path*"> = "path";
    assert.strictEqual(_path, "path");
  });

  it("should extract param name from catch-all +", () => {
    const _filepath: Route.ExtractParams<"/files/:filepath+"> = "filepath";
    assert.strictEqual(_filepath, "filepath");
  });

  it("should extract params from complex paths", () => {
    const _postId: Route.ExtractParams<"/users/:id/posts/:postId"> = "postId";
    const _id: Route.ExtractParams<"/users/:id/posts/:postId"> = "id";
    assert.strictEqual(_postId, "postId");
    assert.strictEqual(_id, "id");
  });
});

// =============================================================================
// Mutual Exclusion: .component() XOR .children()
// =============================================================================

describe("component/children mutual exclusion", () => {
  it("should not allow both component and children", () => {
    // After .component(), .children should be `never`
    const route = Route.make("/users").component(component);

    // Type-level check: route.children is never
    // At runtime, the field exists but calling it after .component()
    // is a type error (verified by @ts-expect-error in type tests)
    type ChildrenType = typeof route.children;
    type IsNever = [ChildrenType] extends [never] ? true : false;
    const check: IsNever = true;
    assert.isTrue(check);
  });

  it("should not allow component after children", () => {
    const childRoute = Route.make("/profile").component(component);
    const route = Route.make("/settings").layout(layout).children(childRoute);

    // Type-level check: route.component is never
    type ComponentType = typeof route.component;
    type IsNever = [ComponentType] extends [never] ? true : false;
    const check: IsNever = true;
    assert.isTrue(check);
  });

  it("should allow children on route with layout", () => {
    const childRoute = Route.make("/profile").component(component);
    const route = Route.make("/settings").layout(layout).children(childRoute);

    assert.strictEqual(route.definition.layout, layout);
    assert.strictEqual(route.definition.children.length, 1);
  });

  it("should store children definitions", () => {
    const child1 = Route.make("/profile").component(component);
    const child2 = Route.make("/security").component(component);
    const route = Route.make("/settings").layout(layout).children(child1, child2);

    assert.strictEqual(route.definition.children.length, 2);
    assert.strictEqual(route.definition.children[0]?.path, "/profile");
    assert.strictEqual(route.definition.children[1]?.path, "/security");
  });
});

// =============================================================================
// Pipeable Protocol
// =============================================================================

describe("Pipeable protocol", () => {
  it("should implement Pipeable protocol", () => {
    const route = Route.make("/about");

    assert.isFunction(route.pipe);
  });

  it("should pipe with identity", () => {
    const route = Route.make("/about");
    const result = route.pipe((r) => r);

    assert.strictEqual(result._tag, "RouteBuilder");
    assert.strictEqual(result.definition.path, "/about");
  });

  it("should pipe with transformation", () => {
    const route = Route.make("/about");
    const result = route.pipe((r) => r.definition.path);

    assert.strictEqual(result, "/about");
  });

  it("should chain multiple pipes", () => {
    const route = Route.make("/about");
    const result = route.pipe(
      (r) => r.definition.path,
      (path) => (typeof path === "string" ? path.length : 0),
    );

    assert.strictEqual(result, 6); // "/about".length
  });
});

// =============================================================================
// Not an Effect
// =============================================================================

describe("Route is not an Effect", () => {
  it("should be a data structure not an Effect", () => {
    const route = Route.make("/about");

    assert.isFalse(Effect.isEffect(route));
  });

  it("should be identifiable as RouteBuilder", () => {
    const route = Route.make("/about");

    assert.isTrue(Route.isRouteBuilder(route));
  });

  it("should not identify non-routes as RouteBuilder", () => {
    assert.isFalse(Route.isRouteBuilder({}));
    assert.isFalse(Route.isRouteBuilder(null));
    assert.isFalse(Route.isRouteBuilder(42));
    assert.isFalse(Route.isRouteBuilder("hello"));
  });
});

// =============================================================================
// Middleware accumulation (basic - full tests in Phase 4)
// =============================================================================

describe("Route middleware", () => {
  it("should accumulate middleware in order", () => {
    const m1 = Effect.void;
    const m2 = Effect.void;
    const m3 = Effect.void;

    const route = Route.make("/admin").middleware(m1).middleware(m2).middleware(m3);

    assert.strictEqual(route.definition.middleware.length, 3);
    assert.strictEqual(route.definition.middleware[0], m1);
    assert.strictEqual(route.definition.middleware[1], m2);
    assert.strictEqual(route.definition.middleware[2], m3);
  });
});

// =============================================================================
// Prefetch accumulation (basic - full tests in Phase 6)
// =============================================================================

describe("Route prefetch", () => {
  it("should accumulate prefetch functions", () => {
    const fn1 = () => Effect.succeed("resource1");
    const fn2 = () => Effect.succeed("resource2");

    const route = Route.make("/users/:id").prefetch(fn1).prefetch(fn2);

    assert.strictEqual(route.definition.prefetch.length, 2);
    assert.strictEqual(route.definition.prefetch[0], fn1);
    assert.strictEqual(route.definition.prefetch[1], fn2);
  });
});

// =============================================================================
// Route.provide
// =============================================================================

describe("Route.provide", () => {
  it("should store RenderStrategy.Eager via pipe", () => {
    const route = Route.make("/").component(component).pipe(Route.provide(RenderStrategy.Eager));

    assert.strictEqual(route.definition.renderStrategy, RenderStrategy.Eager);
  });

  it("should store RenderStrategy.Lazy via pipe", () => {
    const route = Route.make("/").component(component).pipe(Route.provide(RenderStrategy.Lazy));

    assert.strictEqual(route.definition.renderStrategy, RenderStrategy.Lazy);
  });

  it("should store ScrollStrategy.None via pipe", () => {
    const route = Route.make("/settings")
      .layout(layout)
      .children(Route.index(component))
      .pipe(Route.provide(ScrollStrategy.None));

    assert.strictEqual(route.definition.scrollStrategy, ScrollStrategy.None);
  });

  it("should store ScrollStrategy.Auto via pipe", () => {
    const route = Route.make("/").component(component).pipe(Route.provide(ScrollStrategy.Auto));

    assert.strictEqual(route.definition.scrollStrategy, ScrollStrategy.Auto);
  });

  it("should handle multiple layers (RenderStrategy + ScrollStrategy)", () => {
    const route = Route.make("/")
      .component(component)
      .pipe(Route.provide(RenderStrategy.Eager, ScrollStrategy.None));

    assert.strictEqual(route.definition.renderStrategy, RenderStrategy.Eager);
    assert.strictEqual(route.definition.scrollStrategy, ScrollStrategy.None);
  });

  it("should store unknown layers in layers array", () => {
    // Use a fresh layer not in the known sets (Layer.effect creates a new instance)
    const FreshLayer = Layer.effect(RenderStrategy, Effect.succeed({ _tag: "Lazy" as const }));

    const route = Route.make("/").component(component).pipe(Route.provide(FreshLayer));

    assert.strictEqual(route.definition.layers.length, 1);
    assert.strictEqual(route.definition.layers[0], FreshLayer);
  });

  it("should combine strategy layers and other layers", () => {
    const FreshLayer = Layer.effect(RenderStrategy, Effect.succeed({ _tag: "Lazy" as const }));

    const route = Route.make("/")
      .component(component)
      .pipe(Route.provide(RenderStrategy.Eager, FreshLayer, ScrollStrategy.None));

    assert.strictEqual(route.definition.renderStrategy, RenderStrategy.Eager);
    assert.strictEqual(route.definition.scrollStrategy, ScrollStrategy.None);
    assert.strictEqual(route.definition.layers.length, 1);
    assert.strictEqual(route.definition.layers[0], FreshLayer);
  });

  it("should return a RouteBuilder (not an Effect)", () => {
    const route = Route.make("/").component(component).pipe(Route.provide(RenderStrategy.Eager));

    assert.strictEqual(route._tag, "RouteBuilder");
    assert.isFalse(Effect.isEffect(route));
  });

  it("should preserve existing definition fields", () => {
    const route = Route.make("/users/:id")
      .component(component)
      .loading(layout)
      .pipe(Route.provide(RenderStrategy.Eager));

    assert.strictEqual(route.definition.path, "/users/:id");
    assert.strictEqual(route.definition.component, component);
    assert.strictEqual(route.definition.loading, layout);
    assert.strictEqual(route.definition.renderStrategy, RenderStrategy.Eager);
  });
});
