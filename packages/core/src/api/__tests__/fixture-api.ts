/**
 * Test fixture: simulates a user's app/api.ts loaded via ssrLoadModule.
 * This is a SEPARATE FILE from the test to reproduce module boundary effects.
 */
import { HttpApi, HttpApiBuilder, HttpApiEndpoint, HttpApiGroup } from "@effect/platform";
import { Effect, Layer, Schema } from "effect";

const User = Schema.Struct({
  id: Schema.String,
  name: Schema.String,
});

class UsersGroup extends HttpApiGroup.make("users")
  .add(HttpApiEndpoint.get("listUsers", "/users").addSuccess(Schema.Array(User)))
  .prefix("/api") {}

export class Api extends HttpApi.make("app").add(UsersGroup) {}

export const UsersLive = HttpApiBuilder.group(Api, "users", (handlers) =>
  handlers.handle("listUsers", () => Effect.succeed([{ id: "1", name: "Alice" }])),
);

export const ApiLive = HttpApiBuilder.api(Api).pipe(Layer.provide(UsersLive));
