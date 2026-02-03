/**
 * API Definition
 *
 * Single file defining all API endpoints and handlers.
 */
import {
  HttpApi,
  HttpApiEndpoint,
  HttpApiGroup,
  HttpApiBuilder,
  HttpApiClient,
  FetchHttpClient,
} from "@effect/platform";
import { Context, Effect, Layer, Schema } from "effect";

// =============================================================================
// Schemas
// =============================================================================

export const User = Schema.Struct({
  id: Schema.String,
  name: Schema.String,
  email: Schema.String,
  role: Schema.String,
});
export type User = typeof User.Type;

export const Post = Schema.Struct({
  id: Schema.Number,
  title: Schema.String,
  body: Schema.String,
  authorId: Schema.String,
});
export type Post = typeof Post.Type;

export class UserNotFound extends Schema.TaggedError<UserNotFound>()("UserNotFound", {
  id: Schema.String,
}) {}

// =============================================================================
// Mock Data
// =============================================================================

const mockUsers: Record<string, User> = {
  "1": { id: "1", name: "Alice Johnson", email: "alice@example.com", role: "Admin" },
  "2": { id: "2", name: "Bob Smith", email: "bob@example.com", role: "Developer" },
  "3": { id: "3", name: "Charlie Brown", email: "charlie@example.com", role: "Designer" },
};

const mockPosts: ReadonlyArray<Post> = [
  { id: 1, title: "Getting Started with Effect", body: "Effect is a powerful...", authorId: "1" },
  { id: 2, title: "Fine-grained Reactivity", body: "Signals enable...", authorId: "2" },
  { id: 3, title: "Type-safe Routing", body: "With trygg...", authorId: "1" },
  { id: 4, title: "Resource Caching", body: "The Resource API...", authorId: "3" },
];

// =============================================================================
// API Groups
// =============================================================================

class UsersGroup extends HttpApiGroup.make("users")
  .add(HttpApiEndpoint.get("listUsers", "/users").addSuccess(Schema.Array(User)))
  .add(
    HttpApiEndpoint.get("getUser", "/users/:id")
      .setPath(Schema.Struct({ id: Schema.String }))
      .addSuccess(User)
      .addError(UserNotFound),
  )
  .add(
    HttpApiEndpoint.get("getUserPosts", "/users/:id/posts")
      .setPath(Schema.Struct({ id: Schema.String }))
      .addSuccess(Schema.Array(Post)),
  )
  .prefix("/api") {}

// =============================================================================
// API Definition
// =============================================================================

class Api extends HttpApi.make("app").add(UsersGroup) {}

// =============================================================================
// Handlers
// =============================================================================

const UsersLive = HttpApiBuilder.group(Api, "users", (handlers) =>
  handlers
    .handle("listUsers", () =>
      Effect.gen(function* () {
        yield* Effect.sleep("200 millis");
        return Object.values(mockUsers);
      }),
    )
    .handle("getUser", ({ path }) =>
      Effect.gen(function* () {
        yield* Effect.sleep("300 millis");
        const user = mockUsers[path.id];
        if (!user) {
          return yield* new UserNotFound({ id: path.id });
        }
        return user;
      }),
    )
    .handle("getUserPosts", ({ path }) =>
      Effect.gen(function* () {
        yield* Effect.sleep("400 millis");
        return mockPosts.filter((p) => p.authorId === path.id);
      }),
    ),
);

// Default export: composed Layer<HttpApi.Api> — the framework reads this.
export default HttpApiBuilder.api(Api).pipe(Layer.provide(UsersLive));

// =============================================================================
// Typed API Client
// =============================================================================

const client = HttpApiClient.make(Api, { baseUrl: "" });
type ApiClientService = Effect.Effect.Success<typeof client>;

/** Tag for the typed API client. Yield in effects to get the client. */
export class ApiClient extends Context.Tag("ApiClient")<ApiClient, ApiClientService>() {}

/** Layer that creates the ApiClient using FetchHttpClient. */
export const ApiClientLive = Layer.effect(
  ApiClient,
  client.pipe(Effect.provide(FetchHttpClient.layer)),
);
