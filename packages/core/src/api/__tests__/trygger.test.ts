/**
 * Trygger — typed API client factory tests.
 *
 * Test Categories:
 * - Tag identity: deterministic key from api identifier
 * - Layer construction: .Default and .layer() produce valid layers
 * - Client shape: type-level — correct groups/endpoints accessible
 * - Override options: .layer() accepts custom options
 */
import { HttpApi, HttpApiEndpoint, HttpApiGroup } from "@effect/platform";
import { describe, it } from "@effect/vitest";
import { Effect, Schema } from "effect";
import { Trygger, type ClientOf } from "../trygger.js";

// ---------------------------------------------------------------------------
// Fixture: minimal Api class
// ---------------------------------------------------------------------------

const User = Schema.Struct({
  id: Schema.String,
  name: Schema.String,
});

class UsersGroup extends HttpApiGroup.make("users")
  .add(HttpApiEndpoint.get("listUsers", "/users").addSuccess(Schema.Array(User)))
  .add(
    HttpApiEndpoint.post("createUser", "/users")
      .setPayload(Schema.Struct({ name: Schema.String }))
      .addSuccess(User),
  )
  .prefix("/api") {}

class TestApi extends HttpApi.make("test-api").add(UsersGroup) {}

// ---------------------------------------------------------------------------
// Tag identity
// ---------------------------------------------------------------------------

describe("Trygger", () => {
  it.effect("produces deterministic tag key from group identifiers", () =>
    Effect.gen(function* () {
      const tag = Trygger(TestApi);
      const key = tag.key;
      yield* Effect.sync(() => {
        if (key !== "@trygg/Trygger:users") {
          throw new globalThis.Error(`Expected key "@trygg/Trygger:users", got "${key}"`);
        }
      });
    }),
  );

  it.effect("two calls with same api produce tags with same key", () =>
    Effect.gen(function* () {
      const a = Trygger(TestApi);
      const b = Trygger(TestApi);
      const keyA = a.key;
      const keyB = b.key;
      yield* Effect.sync(() => {
        if (keyA !== keyB) {
          throw new globalThis.Error(`Keys differ: "${keyA}" vs "${keyB}"`);
        }
      });
    }),
  );

  // ---------------------------------------------------------------------------
  // Layer construction
  // ---------------------------------------------------------------------------

  it.effect(".layer() produces a valid layer object", () =>
    Effect.gen(function* () {
      const ApiClient = Trygger(TestApi, {
        baseUrl: "http://localhost:3000",
      });

      const clientLayer = ApiClient.layer();

      yield* Effect.sync(() => {
        if (typeof clientLayer !== "object" || clientLayer === null) {
          throw new globalThis.Error("Expected layer to be an object");
        }
      });
    }),
  );

  it.effect(".Default produces a valid layer object", () =>
    Effect.gen(function* () {
      const ApiClient = Trygger(TestApi, {
        baseUrl: "http://localhost:3000",
      });

      const defaultLayer = ApiClient.Default;

      yield* Effect.sync(() => {
        if (typeof defaultLayer !== "object" || defaultLayer === null) {
          throw new globalThis.Error("Expected Default to be a layer object");
        }
      });
    }),
  );

  // ---------------------------------------------------------------------------
  // Options pass-through
  // ---------------------------------------------------------------------------

  it.effect(".layer() accepts override options", () =>
    Effect.gen(function* () {
      const ApiClient = Trygger(TestApi, {
        baseUrl: "http://localhost:3000",
      });

      const overrideLayer = ApiClient.layer({
        baseUrl: "http://override:4000",
      });

      yield* Effect.sync(() => {
        if (typeof overrideLayer !== "object" || overrideLayer === null) {
          throw new globalThis.Error("Expected override layer to be an object");
        }
      });
    }),
  );

  // ---------------------------------------------------------------------------
  // Type-level: ClientOf extracts correct shape
  // ---------------------------------------------------------------------------

  it.effect("ClientOf resolves to correct client shape (compile-time check)", () =>
    Effect.gen(function* () {
      // This test is primarily a compile-time check.
      // If the types are wrong, this file won't compile.
      type Client = ClientOf<typeof TestApi>;

      // Verify the type has the expected group
      type _HasUsers = Client extends { readonly users: unknown } ? true : never;

      // Verify group has expected endpoint keys
      type UsersClient = Client["users"];
      type _HasListUsers = "listUsers" extends keyof UsersClient ? true : never;
      type _HasCreateUser = "createUser" extends keyof UsersClient ? true : never;

      // satisfies validates at compile time without creating unused bindings
      void (true satisfies _HasUsers);
      void (true satisfies _HasListUsers);
      void (true satisfies _HasCreateUser);

      yield* Effect.void;
    }),
  );
});
