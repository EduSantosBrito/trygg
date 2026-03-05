/**
 * Test fixture: simulates a user's app/api.ts loaded via ssrLoadModule.
 * This is a SEPARATE FILE from the test to reproduce module boundary effects.
 */
import { HttpApi, HttpApiBuilder, HttpApiEndpoint, HttpApiGroup } from "effect/unstable/httpapi";
import { Effect, Layer, Schema } from "effect";

const User = Schema.Struct({
  id: Schema.String,
  name: Schema.String,
});

const UsersGroup = HttpApiGroup.make("users")
  .add(HttpApiEndpoint.get("listUsers", "/users", { success: Schema.Array(User) }))
  .prefix("/api");

const Api = HttpApi.make("app").add(UsersGroup);

const UsersLive = HttpApiBuilder.group(Api, "users", (handlers) =>
  handlers.handle("listUsers", () => Effect.succeed([{ id: "1", name: "Alice" }])),
);

export default HttpApiBuilder.layer(Api).pipe(Layer.provide(UsersLive));
