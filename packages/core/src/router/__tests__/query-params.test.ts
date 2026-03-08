// Query Params Unit Tests (Phase 3)
//
// Tests for .query(schema), query decode, CurrentRouteQuery FiberRef,
// and handling of optional/required/extra query params.
import { assert, describe, it } from "@effect/vitest";
import { scoped } from "../../testing/effect-vitest.js";
import { Effect, Result, Schema } from "effect";
import * as Route from "../route.js";
import { getFiberRef } from "../../internal/fiber-ref.js";

// =============================================================================
// .query() - Schema stored on route
// =============================================================================

describe(".query() schema storage", () => {
  it("should store query schema on route", () => {
    const schema = Schema.Struct({ q: Schema.String });
    const route = Route.make("/search").query(schema);

    assert.strictEqual(route.definition.querySchema, schema);
  });

  it("should store query schema with multiple fields", () => {
    const schema = Schema.Struct({
      q: Schema.String,
      page: Schema.optional(Schema.NumberFromString),
      sort: Schema.optional(Schema.Literals(["asc", "desc"])),
    });
    const route = Route.make("/search").query(schema);

    assert.isDefined(route.definition.querySchema);
  });

  it("should combine with params schema", () => {
    const paramsSchema = Schema.Struct({ id: Schema.NumberFromString });
    const querySchema = Schema.Struct({
      filter: Schema.optional(Schema.Literals(["published", "draft"])),
    });

    const route = Route.make("/users/:id/posts").params(paramsSchema).query(querySchema);

    assert.strictEqual(route.definition.paramsSchema, paramsSchema);
    assert.strictEqual(route.definition.querySchema, querySchema);
  });

  it("should be immutable - each .query() returns new builder", () => {
    const schema = Schema.Struct({ q: Schema.String });
    const original = Route.make("/search");
    const withQuery = original.query(schema);

    assert.strictEqual(original.definition.querySchema, undefined);
    assert.strictEqual(withQuery.definition.querySchema, schema);
  });
});

// =============================================================================
// decodeQuery - Decode URLSearchParams via Schema
// =============================================================================

describe("decodeQuery", () => {
  scoped("should decode query params at match time", () =>
    Effect.gen(function* () {
      const schema = Schema.Struct({
        q: Schema.String,
        page: Schema.NumberFromString,
      });
      const searchParams = new URLSearchParams("q=hello&page=2");

      const result = yield* Route.decodeQuery(schema, searchParams, "/search");

      assert.deepStrictEqual(result, { q: "hello", page: 2 });
    }),
  );

  scoped("should return undefined for optional missing params", () =>
    Effect.gen(function* () {
      const schema = Schema.Struct({
        q: Schema.String,
        page: Schema.optional(Schema.NumberFromString),
      });
      const searchParams = new URLSearchParams("q=hello");

      const result = yield* Route.decodeQuery(schema, searchParams, "/search");

      assert.strictEqual((result as Record<string, unknown>).q, "hello");
      assert.strictEqual((result as Record<string, unknown>).page, undefined);
    }),
  );

  scoped("should fail on missing required params", () =>
    Effect.gen(function* () {
      const schema = Schema.Struct({
        q: Schema.String,
        page: Schema.NumberFromString,
      });
      const searchParams = new URLSearchParams("page=2");

      const result = yield* Route.decodeQuery(schema, searchParams, "/search").pipe(Effect.result);

      assert.isTrue(Result.isFailure(result));
      if (Result.isFailure(result)) {
        assert.strictEqual(result.failure._tag, "QueryDecodeError");
        assert.strictEqual(result.failure.path, "/search");
      }
    }),
  );

  scoped("should handle empty query string with all optional fields", () =>
    Effect.gen(function* () {
      const schema = Schema.Struct({
        q: Schema.optional(Schema.String),
        page: Schema.optional(Schema.NumberFromString),
      });
      const searchParams = new URLSearchParams("");

      const result = yield* Route.decodeQuery(schema, searchParams, "/search");

      assert.strictEqual((result as Record<string, unknown>).q, undefined);
      assert.strictEqual((result as Record<string, unknown>).page, undefined);
    }),
  );

  scoped("should ignore extra query params not in schema", () =>
    Effect.gen(function* () {
      const schema = Schema.Struct({
        q: Schema.String,
      });
      const searchParams = new URLSearchParams("q=hello&extra=ignored&more=also");

      const result = yield* Route.decodeQuery(schema, searchParams, "/search");

      assert.strictEqual((result as Record<string, unknown>).q, "hello");
      assert.strictEqual((result as Record<string, unknown>)["extra"], undefined);
    }),
  );

  scoped("should decode literal types", () =>
    Effect.gen(function* () {
      const schema = Schema.Struct({
        sort: Schema.Literals(["asc", "desc"]),
      });
      const searchParams = new URLSearchParams("sort=asc");

      const result = yield* Route.decodeQuery(schema, searchParams, "/search");

      assert.deepStrictEqual(result, { sort: "asc" });
    }),
  );

  scoped("should fail on invalid literal value", () =>
    Effect.gen(function* () {
      const schema = Schema.Struct({
        sort: Schema.Literals(["asc", "desc"]),
      });
      const searchParams = new URLSearchParams("sort=invalid");

      const result = yield* Route.decodeQuery(schema, searchParams, "/search").pipe(Effect.result);

      assert.isTrue(Result.isFailure(result));
    }),
  );

  scoped("should preserve query decode error cause", () =>
    Effect.gen(function* () {
      const schema = Schema.Struct({
        page: Schema.FiniteFromString,
      });
      const searchParams = new URLSearchParams("page=abc");

      const result = yield* Route.decodeQuery(schema, searchParams, "/search").pipe(Effect.result);

      assert.isTrue(Result.isFailure(result));
      if (Result.isFailure(result)) {
        assert.isDefined(result.failure.cause);
        assert.deepStrictEqual(result.failure.rawQuery, { page: "abc" });
      }
    }),
  );
});

// =============================================================================
// CurrentRouteQuery FiberRef
// =============================================================================

describe("CurrentRouteQuery FiberRef", () => {
  scoped("should provide decoded query via FiberRef", () =>
    Effect.gen(function* () {
      const decoded = { q: "hello", page: 2 };

      const result = yield* getFiberRef(Route.CurrentRouteQuery).pipe(
        Effect.provideService(Route.CurrentRouteQuery, decoded),
      );

      assert.deepStrictEqual(result, decoded);
    }),
  );

  scoped("should default to empty object", () =>
    Effect.gen(function* () {
      const result = yield* getFiberRef(Route.CurrentRouteQuery);

      assert.deepStrictEqual(result, {});
    }),
  );

  scoped("should be isolated per fiber", () =>
    Effect.gen(function* () {
      const query1 = { q: "first" };
      const query2 = { q: "second" };

      const [r1, r2] = yield* Effect.all([
        getFiberRef(Route.CurrentRouteQuery).pipe(
          Effect.provideService(Route.CurrentRouteQuery, query1),
        ),
        getFiberRef(Route.CurrentRouteQuery).pipe(
          Effect.provideService(Route.CurrentRouteQuery, query2),
        ),
      ]);

      assert.deepStrictEqual(r1, query1);
      assert.deepStrictEqual(r2, query2);
    }),
  );
});
