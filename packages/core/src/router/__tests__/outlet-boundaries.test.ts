/**
 * Outlet Boundaries Unit Tests (Phase 12)
 *
 * Tests for:
 * - Nearest-wins resolution for error/notFound/forbidden boundaries
 * - Root boundaries as fallback
 * - Schema decode of params at match time
 * - Schema decode of query at match time
 * - Decode failures produce typed errors
 */
import { assert, describe, it } from "@effect/vitest";
import { Effect, Option, Schema } from "effect";
import * as Route from "../route.js";
import * as Routes from "../routes.js";
import {
  createMatcher,
  resolveErrorBoundary,
  resolveNotFoundBoundary,
  resolveForbiddenBoundary,
  resolveLoadingBoundary,
  decodeRouteParams,
  decodeRouteQuery,
} from "../matching.js";
import { empty } from "../../primitives/element.js";
import type { RouteComponent } from "../types.js";
import type { Component } from "../../primitives/component.js";
import type { Layer, Context } from "effect";

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

// Helper to create named dummy RouteComponent
const makeNamedComp = (name: string): RouteComponent => {
  const fn = () => empty;
  const comp = Object.assign(fn, {
    _tag: "EffectComponent" as const,
    _name: name,
    _layers: [] as ReadonlyArray<Layer.Layer.Any>,
    _requirements: [] as ReadonlyArray<Context.Tag<any, any>>,
    provide: () => comp as Component.Type<never, unknown, unknown>,
  });
  return comp as RouteComponent;
};

// Dummy components with identifiable names
const Comp = makeComp();
const Layout = makeComp();

// Named boundary components for asserting which one was resolved
const RootError = makeNamedComp("RootError");
const ParentError = makeNamedComp("ParentError");
const ChildError = makeNamedComp("ChildError");
const RootNotFound = makeNamedComp("RootNotFound");
const ParentNotFound = makeNamedComp("ParentNotFound");
const RootForbidden = makeNamedComp("RootForbidden");
const ParentForbidden = makeNamedComp("ParentForbidden");
const ChildForbidden = makeNamedComp("ChildForbidden");
const ParentLoading = makeNamedComp("ParentLoading");
const ChildLoading = makeNamedComp("ChildLoading");

// =============================================================================
// Error Boundary Resolution
// =============================================================================

describe("resolveErrorBoundary", () => {
  it.effect("should use child error boundary over parent", () =>
    Effect.gen(function* () {
      const manifest = Routes.make().add(
        Route.make("/admin")
          .layout(Layout)
          .error(ParentError)
          .children(Route.make("/users").error(ChildError).component(Comp)),
      ).manifest;

      const matcher = yield* createMatcher(manifest);
      const match = matcher.match("/admin/users");
      assert.isTrue(Option.isSome(match));

      if (Option.isSome(match)) {
        const boundary = resolveErrorBoundary(match.value.route, undefined);
        assert.isTrue(Option.isSome(boundary));
        if (Option.isSome(boundary)) {
          assert.strictEqual(boundary.value, ChildError);
        }
      }
    }),
  );

  it.effect("should fall back to parent error boundary", () =>
    Effect.gen(function* () {
      const manifest = Routes.make().add(
        Route.make("/admin")
          .layout(Layout)
          .error(ParentError)
          .children(Route.make("/users").component(Comp)),
      ).manifest;

      const matcher = yield* createMatcher(manifest);
      const match = matcher.match("/admin/users");
      assert.isTrue(Option.isSome(match));

      if (Option.isSome(match)) {
        const boundary = resolveErrorBoundary(match.value.route, undefined);
        assert.isTrue(Option.isSome(boundary));
        if (Option.isSome(boundary)) {
          assert.strictEqual(boundary.value, ParentError);
        }
      }
    }),
  );

  it.effect("should fall back to root error boundary", () =>
    Effect.gen(function* () {
      const manifest = Routes.make().add(Route.make("/users").component(Comp)).manifest;

      const matcher = yield* createMatcher(manifest);
      const match = matcher.match("/users");
      assert.isTrue(Option.isSome(match));

      if (Option.isSome(match)) {
        const boundary = resolveErrorBoundary(match.value.route, RootError);
        assert.isTrue(Option.isSome(boundary));
        if (Option.isSome(boundary)) {
          assert.strictEqual(boundary.value, RootError);
        }
      }
    }),
  );

  it.effect("should return None when no error boundary exists", () =>
    Effect.gen(function* () {
      const manifest = Routes.make().add(Route.make("/users").component(Comp)).manifest;

      const matcher = yield* createMatcher(manifest);
      const match = matcher.match("/users");
      assert.isTrue(Option.isSome(match));

      if (Option.isSome(match)) {
        const boundary = resolveErrorBoundary(match.value.route, undefined);
        assert.isTrue(Option.isNone(boundary));
      }
    }),
  );

  it.effect("should resolve through 3 levels (child wins)", () =>
    Effect.gen(function* () {
      const manifest = Routes.make().add(
        Route.make("/a")
          .layout(Layout)
          .error(RootError)
          .children(
            Route.make("/b")
              .layout(Layout)
              .error(ParentError)
              .children(Route.make("/c").error(ChildError).component(Comp)),
          ),
      ).manifest;

      const matcher = yield* createMatcher(manifest);
      const match = matcher.match("/a/b/c");
      assert.isTrue(Option.isSome(match));

      if (Option.isSome(match)) {
        const boundary = resolveErrorBoundary(match.value.route, undefined);
        assert.isTrue(Option.isSome(boundary));
        if (Option.isSome(boundary)) {
          assert.strictEqual(boundary.value, ChildError);
        }
      }
    }),
  );
});

// =============================================================================
// NotFound Boundary Resolution
// =============================================================================

describe("resolveNotFoundBoundary", () => {
  it.effect("should use route notFound over parent", () =>
    Effect.gen(function* () {
      const manifest = Routes.make().add(
        Route.make("/admin")
          .layout(Layout)
          .notFound(ParentNotFound)
          .children(Route.make("/users").notFound(RootNotFound).component(Comp)),
      ).manifest;

      const matcher = yield* createMatcher(manifest);
      const match = matcher.match("/admin/users");
      assert.isTrue(Option.isSome(match));

      if (Option.isSome(match)) {
        const boundary = resolveNotFoundBoundary(match.value.route, undefined);
        assert.isTrue(Option.isSome(boundary));
        if (Option.isSome(boundary)) {
          assert.strictEqual(boundary.value, RootNotFound);
        }
      }
    }),
  );

  it.effect("should fall back to parent notFound", () =>
    Effect.gen(function* () {
      const manifest = Routes.make().add(
        Route.make("/admin")
          .layout(Layout)
          .notFound(ParentNotFound)
          .children(Route.make("/users").component(Comp)),
      ).manifest;

      const matcher = yield* createMatcher(manifest);
      const match = matcher.match("/admin/users");
      assert.isTrue(Option.isSome(match));

      if (Option.isSome(match)) {
        const boundary = resolveNotFoundBoundary(match.value.route, undefined);
        assert.isTrue(Option.isSome(boundary));
        if (Option.isSome(boundary)) {
          assert.strictEqual(boundary.value, ParentNotFound);
        }
      }
    }),
  );

  it.effect("should fall back to root notFound", () =>
    Effect.gen(function* () {
      const manifest = Routes.make().add(Route.make("/users").component(Comp)).manifest;

      const matcher = yield* createMatcher(manifest);
      const match = matcher.match("/users");
      assert.isTrue(Option.isSome(match));

      if (Option.isSome(match)) {
        const boundary = resolveNotFoundBoundary(match.value.route, RootNotFound);
        assert.isTrue(Option.isSome(boundary));
        if (Option.isSome(boundary)) {
          assert.strictEqual(boundary.value, RootNotFound);
        }
      }
    }),
  );

  it.effect("should return None when no notFound exists", () =>
    Effect.gen(function* () {
      const manifest = Routes.make().add(Route.make("/users").component(Comp)).manifest;

      const matcher = yield* createMatcher(manifest);
      const match = matcher.match("/users");
      assert.isTrue(Option.isSome(match));

      if (Option.isSome(match)) {
        const boundary = resolveNotFoundBoundary(match.value.route, undefined);
        assert.isTrue(Option.isNone(boundary));
      }
    }),
  );
});

// =============================================================================
// Forbidden Boundary Resolution
// =============================================================================

describe("resolveForbiddenBoundary", () => {
  it.effect("should use child forbidden over parent", () =>
    Effect.gen(function* () {
      const manifest = Routes.make().add(
        Route.make("/admin")
          .layout(Layout)
          .forbidden(ParentForbidden)
          .children(Route.make("/billing").forbidden(ChildForbidden).component(Comp)),
      ).manifest;

      const matcher = yield* createMatcher(manifest);
      const match = matcher.match("/admin/billing");
      assert.isTrue(Option.isSome(match));

      if (Option.isSome(match)) {
        const boundary = resolveForbiddenBoundary(match.value.route, undefined);
        assert.isTrue(Option.isSome(boundary));
        if (Option.isSome(boundary)) {
          assert.strictEqual(boundary.value, ChildForbidden);
        }
      }
    }),
  );

  it.effect("should fall back to parent forbidden", () =>
    Effect.gen(function* () {
      const manifest = Routes.make().add(
        Route.make("/admin")
          .layout(Layout)
          .forbidden(ParentForbidden)
          .children(Route.make("/users").component(Comp)),
      ).manifest;

      const matcher = yield* createMatcher(manifest);
      const match = matcher.match("/admin/users");
      assert.isTrue(Option.isSome(match));

      if (Option.isSome(match)) {
        const boundary = resolveForbiddenBoundary(match.value.route, undefined);
        assert.isTrue(Option.isSome(boundary));
        if (Option.isSome(boundary)) {
          assert.strictEqual(boundary.value, ParentForbidden);
        }
      }
    }),
  );

  it.effect("should fall back to root forbidden", () =>
    Effect.gen(function* () {
      const manifest = Routes.make().add(Route.make("/admin").component(Comp)).manifest;

      const matcher = yield* createMatcher(manifest);
      const match = matcher.match("/admin");
      assert.isTrue(Option.isSome(match));

      if (Option.isSome(match)) {
        const boundary = resolveForbiddenBoundary(match.value.route, RootForbidden);
        assert.isTrue(Option.isSome(boundary));
        if (Option.isSome(boundary)) {
          assert.strictEqual(boundary.value, RootForbidden);
        }
      }
    }),
  );
});

// =============================================================================
// Loading Boundary Resolution
// =============================================================================

describe("resolveLoadingBoundary", () => {
  it.effect("should use child loading over parent", () =>
    Effect.gen(function* () {
      const manifest = Routes.make().add(
        Route.make("/admin")
          .layout(Layout)
          .loading(ParentLoading)
          .children(Route.make("/users").loading(ChildLoading).component(Comp)),
      ).manifest;

      const matcher = yield* createMatcher(manifest);
      const match = matcher.match("/admin/users");
      assert.isTrue(Option.isSome(match));

      if (Option.isSome(match)) {
        const loading = resolveLoadingBoundary(match.value.route);
        assert.isTrue(Option.isSome(loading));
        if (Option.isSome(loading)) {
          assert.strictEqual(loading.value, ChildLoading);
        }
      }
    }),
  );

  it.effect("should fall back to parent loading", () =>
    Effect.gen(function* () {
      const manifest = Routes.make().add(
        Route.make("/admin")
          .layout(Layout)
          .loading(ParentLoading)
          .children(Route.make("/users").component(Comp)),
      ).manifest;

      const matcher = yield* createMatcher(manifest);
      const match = matcher.match("/admin/users");
      assert.isTrue(Option.isSome(match));

      if (Option.isSome(match)) {
        const loading = resolveLoadingBoundary(match.value.route);
        assert.isTrue(Option.isSome(loading));
        if (Option.isSome(loading)) {
          assert.strictEqual(loading.value, ParentLoading);
        }
      }
    }),
  );

  it.effect("should return None when no loading exists", () =>
    Effect.gen(function* () {
      const manifest = Routes.make().add(Route.make("/users").component(Comp)).manifest;

      const matcher = yield* createMatcher(manifest);
      const match = matcher.match("/users");
      assert.isTrue(Option.isSome(match));

      if (Option.isSome(match)) {
        const loading = resolveLoadingBoundary(match.value.route);
        assert.isTrue(Option.isNone(loading));
      }
    }),
  );
});

// =============================================================================
// Params Decode at Match Time
// =============================================================================

describe("decodeRouteParams", () => {
  it.effect("should decode params via Schema", () =>
    Effect.gen(function* () {
      const manifest = Routes.make().add(
        Route.make("/users/:id")
          .params(Schema.Struct({ id: Schema.NumberFromString }))
          .component(Comp),
      ).manifest;

      const matcher = yield* createMatcher(manifest);
      const match = matcher.match("/users/123");
      assert.isTrue(Option.isSome(match));

      if (Option.isSome(match)) {
        const decoded = yield* decodeRouteParams(match.value.route, match.value.params);
        assert.strictEqual(decoded.id, 123);
      }
    }),
  );

  it.effect("should pass raw params when no schema", () =>
    Effect.gen(function* () {
      const manifest = Routes.make().add(Route.make("/users/:id").component(Comp)).manifest;

      const matcher = yield* createMatcher(manifest);
      const match = matcher.match("/users/abc");
      assert.isTrue(Option.isSome(match));

      if (Option.isSome(match)) {
        const decoded = yield* decodeRouteParams(match.value.route, match.value.params);
        assert.strictEqual(decoded.id, "abc");
      }
    }),
  );

  it.effect("should fail with ParamsDecodeError on invalid params", () =>
    Effect.gen(function* () {
      const manifest = Routes.make().add(
        Route.make("/users/:id")
          .params(Schema.Struct({ id: Schema.NumberFromString }))
          .component(Comp),
      ).manifest;

      const matcher = yield* createMatcher(manifest);
      const match = matcher.match("/users/abc");
      assert.isTrue(Option.isSome(match));

      if (Option.isSome(match)) {
        const result = yield* decodeRouteParams(match.value.route, match.value.params).pipe(
          Effect.either,
        );
        assert.isTrue(result._tag === "Left");
        if (result._tag === "Left") {
          assert.strictEqual(result.left._tag, "ParamsDecodeError");
          assert.strictEqual(result.left.path, "/users/:id");
          assert.strictEqual(result.left.rawParams.id, "abc");
        }
      }
    }),
  );

  it.effect("should decode multiple params", () =>
    Effect.gen(function* () {
      const manifest = Routes.make().add(
        Route.make("/blog/:year/:slug")
          .params(
            Schema.Struct({
              year: Schema.NumberFromString,
              slug: Schema.String,
            }),
          )
          .component(Comp),
      ).manifest;

      const matcher = yield* createMatcher(manifest);
      const match = matcher.match("/blog/2024/hello");
      assert.isTrue(Option.isSome(match));

      if (Option.isSome(match)) {
        const decoded = yield* decodeRouteParams(match.value.route, match.value.params);
        assert.strictEqual(decoded.year, 2024);
        assert.strictEqual(decoded.slug, "hello");
      }
    }),
  );

  it.effect("should handle zero value in NumberFromString", () =>
    Effect.gen(function* () {
      const manifest = Routes.make().add(
        Route.make("/items/:id")
          .params(Schema.Struct({ id: Schema.NumberFromString }))
          .component(Comp),
      ).manifest;

      const matcher = yield* createMatcher(manifest);
      const match = matcher.match("/items/0");
      assert.isTrue(Option.isSome(match));

      if (Option.isSome(match)) {
        const decoded = yield* decodeRouteParams(match.value.route, match.value.params);
        assert.strictEqual(decoded.id, 0);
      }
    }),
  );
});

// =============================================================================
// Query Decode at Match Time
// =============================================================================

describe("decodeRouteQuery", () => {
  it.effect("should decode query params via Schema", () =>
    Effect.gen(function* () {
      const manifest = Routes.make().add(
        Route.make("/search")
          .query(
            Schema.Struct({
              q: Schema.String,
              page: Schema.optional(Schema.NumberFromString),
            }),
          )
          .component(Comp),
      ).manifest;

      const matcher = yield* createMatcher(manifest);
      const match = matcher.match("/search");
      assert.isTrue(Option.isSome(match));

      if (Option.isSome(match)) {
        const searchParams = new URLSearchParams("q=hello&page=2");
        const decoded = yield* decodeRouteQuery(match.value.route, searchParams);
        assert.strictEqual(decoded.q, "hello");
        assert.strictEqual(decoded.page, 2);
      }
    }),
  );

  it.effect("should return empty object when no query schema", () =>
    Effect.gen(function* () {
      const manifest = Routes.make().add(Route.make("/about").component(Comp)).manifest;

      const matcher = yield* createMatcher(manifest);
      const match = matcher.match("/about");
      assert.isTrue(Option.isSome(match));

      if (Option.isSome(match)) {
        const searchParams = new URLSearchParams("foo=bar");
        const decoded = yield* decodeRouteQuery(match.value.route, searchParams);
        assert.deepStrictEqual(decoded, {});
      }
    }),
  );

  it.effect("should handle optional missing params as undefined", () =>
    Effect.gen(function* () {
      const manifest = Routes.make().add(
        Route.make("/search")
          .query(
            Schema.Struct({
              q: Schema.String,
              page: Schema.optional(Schema.NumberFromString),
            }),
          )
          .component(Comp),
      ).manifest;

      const matcher = yield* createMatcher(manifest);
      const match = matcher.match("/search");
      assert.isTrue(Option.isSome(match));

      if (Option.isSome(match)) {
        const searchParams = new URLSearchParams("q=hello");
        const decoded = yield* decodeRouteQuery(match.value.route, searchParams);
        assert.strictEqual(decoded.q, "hello");
        assert.isUndefined(decoded.page);
      }
    }),
  );

  it.effect("should fail with QueryDecodeError on missing required param", () =>
    Effect.gen(function* () {
      const manifest = Routes.make().add(
        Route.make("/search")
          .query(Schema.Struct({ q: Schema.String }))
          .component(Comp),
      ).manifest;

      const matcher = yield* createMatcher(manifest);
      const match = matcher.match("/search");
      assert.isTrue(Option.isSome(match));

      if (Option.isSome(match)) {
        const searchParams = new URLSearchParams("");
        const result = yield* decodeRouteQuery(match.value.route, searchParams).pipe(Effect.either);
        assert.isTrue(result._tag === "Left");
        if (result._tag === "Left") {
          assert.strictEqual(result.left._tag, "QueryDecodeError");
          assert.strictEqual(result.left.path, "/search");
        }
      }
    }),
  );

  it.effect("should fail on invalid number in query", () =>
    Effect.gen(function* () {
      const manifest = Routes.make().add(
        Route.make("/items")
          .query(Schema.Struct({ page: Schema.NumberFromString }))
          .component(Comp),
      ).manifest;

      const matcher = yield* createMatcher(manifest);
      const match = matcher.match("/items");
      assert.isTrue(Option.isSome(match));

      if (Option.isSome(match)) {
        const searchParams = new URLSearchParams("page=abc");
        const result = yield* decodeRouteQuery(match.value.route, searchParams).pipe(Effect.either);
        assert.isTrue(result._tag === "Left");
        if (result._tag === "Left") {
          assert.strictEqual(result.left._tag, "QueryDecodeError");
        }
      }
    }),
  );

  it.effect("should handle empty query string with all optional", () =>
    Effect.gen(function* () {
      const manifest = Routes.make().add(
        Route.make("/items")
          .query(
            Schema.Struct({
              page: Schema.optional(Schema.NumberFromString),
              sort: Schema.optional(Schema.String),
            }),
          )
          .component(Comp),
      ).manifest;

      const matcher = yield* createMatcher(manifest);
      const match = matcher.match("/items");
      assert.isTrue(Option.isSome(match));

      if (Option.isSome(match)) {
        const searchParams = new URLSearchParams("");
        const decoded = yield* decodeRouteQuery(match.value.route, searchParams);
        assert.isUndefined(decoded.page);
        assert.isUndefined(decoded.sort);
      }
    }),
  );
});
