// Path Params Unit Tests (Phase 2)
//
// Tests for Schema-validated path params, catch-all matching,
// and Schema decode at match time.
import { assert, describe, it } from "@effect/vitest";
import { Effect, Option, Schema } from "effect";
import * as Route from "../route.js";
import { createMatcher } from "../matching.js";
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

// Dummy component
const comp = makeComp();

// =============================================================================
// .params() - Schema stored on route
// =============================================================================

describe(".params() schema storage", () => {
  it("should accept schema matching path params", () => {
    const route = Route.make("/users/:id").params(Schema.Struct({ id: Schema.NumberFromString }));

    assert.isDefined(route.definition.paramsSchema);
  });

  it("should store schema in route definition", () => {
    const schema = Schema.Struct({ id: Schema.NumberFromString });
    const route = Route.make("/users/:id").params(schema);

    assert.strictEqual(route.definition.paramsSchema, schema);
  });

  it("should accept schema with multiple params", () => {
    const route = Route.make("/blog/:year/:slug").params(
      Schema.Struct({
        year: Schema.NumberFromString,
        slug: Schema.String,
      }),
    );

    assert.isDefined(route.definition.paramsSchema);
  });

  it("should accept schema for catch-all *", () => {
    const route = Route.make("/docs/:path*").params(Schema.Struct({ path: Schema.String }));

    assert.isDefined(route.definition.paramsSchema);
  });

  it("should accept schema for catch-all +", () => {
    const route = Route.make("/files/:filepath+").params(
      Schema.Struct({ filepath: Schema.String }),
    );

    assert.isDefined(route.definition.paramsSchema);
  });

  it("should not expose .params() for static paths", () => {
    const route = Route.make("/about");

    // Type-level check: .params is never for static paths
    type ParamsType = typeof route.params;
    type IsNever = [ParamsType] extends [never] ? true : false;
    const check: IsNever = true;
    assert.isTrue(check);
  });

  // Type-level tests for schema key enforcement
  it("should reject schema with missing params (type-level)", () => {
    const missingSchema = Schema.Struct({});
    // @ts-expect-error - Schema missing 'id' from path
    Route.make("/users/:id").params(missingSchema);
  });

  it("should reject schema with extra params (type-level)", () => {
    const extraSchema = Schema.Struct({
      id: Schema.NumberFromString,
      name: Schema.String,
    });
    // @ts-expect-error - Schema has extra 'name' not in path
    Route.make("/users/:id").params(extraSchema);
  });
});

// =============================================================================
// :param* matching (zero-or-more)
// =============================================================================

describe(":param* (zero-or-more) matching", () => {
  const manifest = {
    routes: [Route.make("/docs/:path*").component(comp).definition],
    notFound: undefined,
    forbidden: undefined,
  };

  it.effect("should match :param* with zero segments", () =>
    Effect.gen(function* () {
      const matcher = yield* createMatcher(manifest);
      const result = matcher.match("/docs");

      assert.isTrue(Option.isSome(result));
      if (Option.isSome(result)) {
        assert.strictEqual(result.value.params["path"], "");
      }
    }),
  );

  it.effect("should match :param* with one segment", () =>
    Effect.gen(function* () {
      const matcher = yield* createMatcher(manifest);
      const result = matcher.match("/docs/intro");

      assert.isTrue(Option.isSome(result));
      if (Option.isSome(result)) {
        assert.strictEqual(result.value.params["path"], "intro");
      }
    }),
  );

  it.effect("should match :param* with multiple segments", () =>
    Effect.gen(function* () {
      const matcher = yield* createMatcher(manifest);
      const result = matcher.match("/docs/api/users");

      assert.isTrue(Option.isSome(result));
      if (Option.isSome(result)) {
        assert.strictEqual(result.value.params["path"], "api/users");
      }
    }),
  );

  it.effect("should match :param* with many segments", () =>
    Effect.gen(function* () {
      const matcher = yield* createMatcher(manifest);
      const result = matcher.match("/docs/a/b/c/d/e");

      assert.isTrue(Option.isSome(result));
      if (Option.isSome(result)) {
        assert.strictEqual(result.value.params["path"], "a/b/c/d/e");
      }
    }),
  );
});

// =============================================================================
// :param+ matching (one-or-more)
// =============================================================================

describe(":param+ (one-or-more) matching", () => {
  const manifest = {
    routes: [Route.make("/files/:filepath+").component(comp).definition],
    notFound: undefined,
    forbidden: undefined,
  };

  it.effect("should not match :param+ with zero segments", () =>
    Effect.gen(function* () {
      const matcher = yield* createMatcher(manifest);
      const result = matcher.match("/files");

      assert.isTrue(Option.isNone(result));
    }),
  );

  it.effect("should match :param+ with one segment", () =>
    Effect.gen(function* () {
      const matcher = yield* createMatcher(manifest);
      const result = matcher.match("/files/readme.txt");

      assert.isTrue(Option.isSome(result));
      if (Option.isSome(result)) {
        assert.strictEqual(result.value.params["filepath"], "readme.txt");
      }
    }),
  );

  it.effect("should match :param+ with multiple segments", () =>
    Effect.gen(function* () {
      const matcher = yield* createMatcher(manifest);
      const result = matcher.match("/files/a/b/c");

      assert.isTrue(Option.isSome(result));
      if (Option.isSome(result)) {
        assert.strictEqual(result.value.params["filepath"], "a/b/c");
      }
    }),
  );

  it.effect("should match :param+ with deep path", () =>
    Effect.gen(function* () {
      const matcher = yield* createMatcher(manifest);
      const result = matcher.match("/files/src/components/Button.tsx");

      assert.isTrue(Option.isSome(result));
      if (Option.isSome(result)) {
        assert.strictEqual(result.value.params["filepath"], "src/components/Button.tsx");
      }
    }),
  );
});

// =============================================================================
// Priority: static > param > wildcard
// =============================================================================

describe("Matching priority", () => {
  const staticDef = Route.make("/users/admin").component(comp).definition;
  const paramDef = Route.make("/users/:id").component(comp).definition;
  const wildcardDef = Route.make("/users/:path*").component(comp).definition;

  it.effect("should prefer static over param", () =>
    Effect.gen(function* () {
      const manifest = { routes: [paramDef, staticDef], notFound: undefined, forbidden: undefined };
      const matcher = yield* createMatcher(manifest);
      const result = matcher.match("/users/admin");

      assert.isTrue(Option.isSome(result));
      if (Option.isSome(result)) {
        assert.strictEqual(result.value.route.path, "/users/admin");
      }
    }),
  );

  it.effect("should prefer param over wildcard", () =>
    Effect.gen(function* () {
      const manifest = {
        routes: [wildcardDef, paramDef],
        notFound: undefined,
        forbidden: undefined,
      };
      const matcher = yield* createMatcher(manifest);
      const result = matcher.match("/users/123");

      assert.isTrue(Option.isSome(result));
      if (Option.isSome(result)) {
        assert.strictEqual(result.value.route.path, "/users/:id");
      }
    }),
  );

  it.effect("should prefer static over wildcard", () =>
    Effect.gen(function* () {
      const manifest = {
        routes: [wildcardDef, staticDef],
        notFound: undefined,
        forbidden: undefined,
      };
      const matcher = yield* createMatcher(manifest);
      const result = matcher.match("/users/admin");

      assert.isTrue(Option.isSome(result));
      if (Option.isSome(result)) {
        assert.strictEqual(result.value.route.path, "/users/admin");
      }
    }),
  );

  it.effect("should fall through to wildcard for multi-segment paths", () =>
    Effect.gen(function* () {
      const manifest = {
        routes: [staticDef, paramDef, wildcardDef],
        notFound: undefined,
        forbidden: undefined,
      };
      const matcher = yield* createMatcher(manifest);
      const result = matcher.match("/users/foo/bar");

      assert.isTrue(Option.isSome(result));
      if (Option.isSome(result)) {
        assert.strictEqual(result.value.route.path, "/users/:path*");
        assert.strictEqual(result.value.params["path"], "foo/bar");
      }
    }),
  );
});

// =============================================================================
// Schema decode at match time
// =============================================================================

describe("Schema decode at match time", () => {
  it.effect("should decode params via Schema at match time", () =>
    Effect.gen(function* () {
      const schema = Schema.Struct({ id: Schema.NumberFromString });
      const rawParams = { id: "123" };

      const result = yield* Route.decodeParams(schema, rawParams, "/users/:id");

      assert.deepStrictEqual(result, { id: 123 });
    }),
  );

  it.effect("should decode multiple params", () =>
    Effect.gen(function* () {
      const schema = Schema.Struct({
        year: Schema.NumberFromString,
        slug: Schema.String,
      });
      const rawParams = { year: "2024", slug: "hello-world" };

      const result = yield* Route.decodeParams(schema, rawParams, "/blog/:year/:slug");

      assert.deepStrictEqual(result, { year: 2024, slug: "hello-world" });
    }),
  );

  it.effect("should fail gracefully on decode error", () =>
    Effect.gen(function* () {
      const schema = Schema.Struct({ id: Schema.NumberFromString });
      const rawParams = { id: "abc" };

      const result = yield* Route.decodeParams(schema, rawParams, "/users/:id").pipe(Effect.either);

      assert.isTrue(result._tag === "Left");
      if (result._tag === "Left") {
        assert.strictEqual(result.left._tag, "ParamsDecodeError");
        assert.strictEqual(result.left.path, "/users/:id");
        assert.deepStrictEqual(result.left.rawParams, { id: "abc" });
      }
    }),
  );

  it.effect("should fail on empty string for NumberFromString", () =>
    Effect.gen(function* () {
      const schema = Schema.Struct({ id: Schema.NumberFromString });
      const rawParams = { id: "" };

      const result = yield* Route.decodeParams(schema, rawParams, "/users/:id").pipe(Effect.either);

      assert.isTrue(result._tag === "Left");
    }),
  );

  it.effect("should decode string params without transformation", () =>
    Effect.gen(function* () {
      const schema = Schema.Struct({ slug: Schema.String });
      const rawParams = { slug: "my-post" };

      const result = yield* Route.decodeParams(schema, rawParams, "/posts/:slug");

      assert.deepStrictEqual(result, { slug: "my-post" });
    }),
  );

  it.effect("should decode zero value for NumberFromString", () =>
    Effect.gen(function* () {
      const schema = Schema.Struct({ id: Schema.NumberFromString });
      const rawParams = { id: "0" };

      const result = yield* Route.decodeParams(schema, rawParams, "/users/:id");

      assert.deepStrictEqual(result, { id: 0 });
    }),
  );

  it.effect("should decode negative value for NumberFromString", () =>
    Effect.gen(function* () {
      const schema = Schema.Struct({ id: Schema.NumberFromString });
      const rawParams = { id: "-1" };

      const result = yield* Route.decodeParams(schema, rawParams, "/users/:id");

      assert.deepStrictEqual(result, { id: -1 });
    }),
  );

  it.effect("should preserve decode error cause", () =>
    Effect.gen(function* () {
      const schema = Schema.Struct({ id: Schema.NumberFromString });
      const rawParams = { id: "not-a-number" };

      const result = yield* Route.decodeParams(schema, rawParams, "/users/:id").pipe(Effect.either);

      assert.isTrue(result._tag === "Left");
      if (result._tag === "Left") {
        assert.isDefined(result.left.cause);
      }
    }),
  );
});
