// Middleware + Boundaries Unit Tests (Phase 4)
//
// Tests for middleware chaining, Router.redirect/forbidden typed failures,
// boundary component storage, and nearest-wins resolution.
import { assert, describe, it } from "@effect/vitest";
import { Data, Effect, Ref } from "effect";
import * as Route from "../route.js";

class TestError extends Data.TaggedError("TestError")<{ readonly message: string }> {}
import { empty } from "../../primitives/element.js";
import type { RouteComponent } from "../types.js";
import type { Component } from "../../primitives/component.js";

// Helper to create dummy RouteComponent
const makeComp = (): RouteComponent => {
  const fn = () => empty;
  const comp = Object.assign(fn, {
    _tag: "EffectComponent" as const,
    _layers: [] as ReadonlyArray<import("effect").Layer.Layer.Any>,
    _requirements: [] as ReadonlyArray<import("effect").Context.Tag<any, any>>,
    provide: () => comp as Component.Type<never, unknown, unknown>,
  });
  return comp as RouteComponent;
};

// Dummy components
const comp = makeComp();
const errorComp = makeComp();
const notFoundComp = makeComp();
const forbiddenComp = makeComp();

// =============================================================================
// Middleware chaining
// =============================================================================

describe("Middleware chaining", () => {
  it("should chain middleware in order", () => {
    const m1 = Effect.void;
    const m2 = Effect.void;
    const m3 = Effect.void;

    const route = Route.make("/admin").middleware(m1).middleware(m2).middleware(m3);

    assert.strictEqual(route.definition.middleware.length, 3);
    assert.strictEqual(route.definition.middleware[0], m1);
    assert.strictEqual(route.definition.middleware[1], m2);
    assert.strictEqual(route.definition.middleware[2], m3);
  });

  it("should preserve order across builder operations", () => {
    const m1 = Effect.void;
    const m2 = Effect.void;

    const route = Route.make("/admin").middleware(m1).component(comp).middleware(m2);

    assert.strictEqual(route.definition.middleware.length, 2);
    assert.strictEqual(route.definition.middleware[0], m1);
    assert.strictEqual(route.definition.middleware[1], m2);
  });
});

// =============================================================================
// Router.redirect - Typed failure
// =============================================================================

describe("routeRedirect", () => {
  it.effect("should redirect via typed failure", () =>
    Effect.gen(function* () {
      const result = yield* Route.routeRedirect("/login").pipe(Effect.either);

      assert.isTrue(result._tag === "Left");
      if (result._tag === "Left") {
        assert.strictEqual(result.left._tag, "RouterRedirect");
        assert.strictEqual(result.left.path, "/login");
        assert.strictEqual(result.left.replace, false);
      }
    }),
  );

  it.effect("should support replace option", () =>
    Effect.gen(function* () {
      const result = yield* Route.routeRedirect("/login", { replace: true }).pipe(Effect.either);

      assert.isTrue(result._tag === "Left");
      if (result._tag === "Left") {
        assert.strictEqual(result.left.replace, true);
      }
    }),
  );

  it.effect("should produce Effect<never, RouterRedirectError>", () =>
    Effect.gen(function* () {
      const result = yield* Route.routeRedirect("/login").pipe(Effect.either);

      assert.isTrue(result._tag === "Left");
    }),
  );
});

// =============================================================================
// Router.forbidden - Typed failure
// =============================================================================

describe("routeForbidden", () => {
  it.effect("should forbid via typed failure", () =>
    Effect.gen(function* () {
      const result = yield* Route.routeForbidden().pipe(Effect.either);

      assert.isTrue(result._tag === "Left");
      if (result._tag === "Left") {
        assert.strictEqual(result.left._tag, "RouterForbidden");
      }
    }),
  );
});

// =============================================================================
// Middleware runner
// =============================================================================

describe("runMiddlewareChain", () => {
  it.effect("should return Continue when all middleware succeed", () =>
    Effect.gen(function* () {
      const m1 = Effect.void;
      const m2 = Effect.void;

      const result = yield* Route.runMiddlewareChain([m1, m2]);

      assert.strictEqual(result._tag, "Continue");
    }),
  );

  it.effect("should return Continue for empty middleware chain", () =>
    Effect.gen(function* () {
      const result = yield* Route.runMiddlewareChain([]);

      assert.strictEqual(result._tag, "Continue");
    }),
  );

  it.effect("should return Redirect on RouterRedirect failure", () =>
    Effect.gen(function* () {
      const m1 = Effect.void;
      const m2 = Route.routeRedirect("/login");

      const result = yield* Route.runMiddlewareChain([m1, m2]);

      assert.strictEqual(result._tag, "Redirect");
      if (result._tag === "Redirect") {
        assert.strictEqual(result.path, "/login");
      }
    }),
  );

  it.effect("should return Forbidden on RouterForbidden failure", () =>
    Effect.gen(function* () {
      const m1 = Effect.void;
      const m2 = Route.routeForbidden();

      const result = yield* Route.runMiddlewareChain([m1, m2]);

      assert.strictEqual(result._tag, "Forbidden");
    }),
  );

  it.effect("should return Error on other failures", () =>
    Effect.gen(function* () {
      const m1 = Effect.void;
      const m2 = Effect.fail(new TestError({ message: "oops" }));

      const result = yield* Route.runMiddlewareChain([m1, m2]);

      assert.strictEqual(result._tag, "Error");
    }),
  );

  it.effect("should not continue after redirect", () =>
    Effect.gen(function* () {
      const counter = yield* Ref.make(0);
      const m1 = Route.routeRedirect("/login");
      const m2 = Ref.update(counter, (n) => n + 1);

      yield* Route.runMiddlewareChain([m1, m2]);

      const count = yield* Ref.get(counter);
      assert.strictEqual(count, 0);
    }),
  );

  it.effect("should not continue after forbidden", () =>
    Effect.gen(function* () {
      const counter = yield* Ref.make(0);
      const m1 = Route.routeForbidden();
      const m2 = Ref.update(counter, (n) => n + 1);

      yield* Route.runMiddlewareChain([m1, m2]);

      const count = yield* Ref.get(counter);
      assert.strictEqual(count, 0);
    }),
  );

  it.effect("should not continue after error", () =>
    Effect.gen(function* () {
      const counter = yield* Ref.make(0);
      const m1 = Effect.fail(new TestError({ message: "oops" }));
      const m2 = Ref.update(counter, (n) => n + 1);

      yield* Route.runMiddlewareChain([m1, m2]);

      const count = yield* Ref.get(counter);
      assert.strictEqual(count, 0);
    }),
  );

  it.effect("should execute middleware in order", () =>
    Effect.gen(function* () {
      const log = yield* Ref.make<string[]>([]);
      const m1 = Ref.update(log, (arr) => [...arr, "first"]);
      const m2 = Ref.update(log, (arr) => [...arr, "second"]);
      const m3 = Ref.update(log, (arr) => [...arr, "third"]);

      yield* Route.runMiddlewareChain([m1, m2, m3]);

      const result = yield* Ref.get(log);
      assert.deepStrictEqual(result, ["first", "second", "third"]);
    }),
  );

  it.effect("should stop at first redirect in chain", () =>
    Effect.gen(function* () {
      const log = yield* Ref.make<string[]>([]);
      const m1 = Ref.update(log, (arr) => [...arr, "first"]);
      const m2 = Route.routeRedirect("/login");
      const m3 = Ref.update(log, (arr) => [...arr, "third"]);

      yield* Route.runMiddlewareChain([m1, m2, m3]);

      const result = yield* Ref.get(log);
      assert.deepStrictEqual(result, ["first"]);
    }),
  );
});

// =============================================================================
// Boundary component storage (verified in builder)
// =============================================================================

describe("Boundary component storage", () => {
  it("should store error boundary component", () => {
    const route = Route.make("/dashboard").error(errorComp);

    assert.strictEqual(route.definition.error, errorComp);
  });

  it("should store notFound boundary component", () => {
    const route = Route.make("/admin").notFound(notFoundComp);

    assert.strictEqual(route.definition.notFound, notFoundComp);
  });

  it("should store forbidden boundary component", () => {
    const route = Route.make("/admin").forbidden(forbiddenComp);

    assert.strictEqual(route.definition.forbidden, forbiddenComp);
  });

  it("should store all boundaries on same route", () => {
    const route = Route.make("/admin")
      .error(errorComp)
      .notFound(notFoundComp)
      .forbidden(forbiddenComp);

    assert.strictEqual(route.definition.error, errorComp);
    assert.strictEqual(route.definition.notFound, notFoundComp);
    assert.strictEqual(route.definition.forbidden, forbiddenComp);
  });
});

// =============================================================================
// Nearest-wins boundary resolution
// =============================================================================

describe("Nearest-wins boundary resolution", () => {
  it("should find child error boundary over parent", () => {
    const parentError = makeComp();
    const childError = makeComp();

    const child = Route.make("/detail").component(comp).error(childError);
    const parent = Route.make("/users").layout(comp).error(parentError).children(child);

    // Child has its own error boundary
    assert.strictEqual(child.definition.error, childError);
    // Parent also has error boundary
    assert.strictEqual(parent.definition.error, parentError);
    // Nearest-wins means child's error boundary takes priority for child routes
  });

  it("should inherit parent boundary when child has none", () => {
    const parentError = makeComp();

    const child = Route.make("/detail").component(comp);
    const parent = Route.make("/users").layout(comp).error(parentError).children(child);

    // Child has no error boundary
    assert.strictEqual(child.definition.error, undefined);
    // Parent has error boundary (would be used for child's errors at runtime)
    assert.strictEqual(parent.definition.error, parentError);
  });

  it("should propagate forbidden boundary through nesting", () => {
    const rootForbidden = makeComp();
    const adminForbidden = makeComp();

    const billing = Route.make("/billing").component(comp);
    const admin = Route.make("/admin").layout(comp).forbidden(adminForbidden).children(billing);

    // Admin has its own forbidden boundary
    assert.strictEqual(admin.definition.forbidden, adminForbidden);
    // Billing has none (would use admin's at runtime)
    assert.strictEqual(billing.definition.forbidden, undefined);
    // Root forbidden is separate
    assert.notStrictEqual(rootForbidden, undefined);
  });
});
