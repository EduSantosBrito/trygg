/**
 * API Definition
 *
 * Single file defining all API endpoints and handlers.
 */
import { Data, Effect, Layer, Schema } from "effect";
import * as ServiceMap from "effect/ServiceMap";
import { FetchHttpClient } from "effect/unstable/http";
import { HttpApi, HttpApiBuilder, HttpApiClient, HttpApiEndpoint, HttpApiGroup } from "effect/unstable/httpapi";

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

const UserNotFoundSchema = Schema.TaggedStruct("UserNotFound", {
  id: Schema.String,
});

export class UserNotFound extends Data.TaggedError("UserNotFound")<{
  readonly id: string;
}> {}

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

const UsersGroup = HttpApiGroup.make("users")
  .add(HttpApiEndpoint.get("listUsers", "/users", { success: Schema.Array(User) }))
  .add(
    HttpApiEndpoint.get("getUser", "/users/:id", {
      params: Schema.Struct({ id: Schema.String }),
      success: User,
      error: UserNotFoundSchema,
    }),
  )
  .add(
    HttpApiEndpoint.get("getUserPosts", "/users/:id/posts", {
      params: Schema.Struct({ id: Schema.String }),
      success: Schema.Array(Post),
    }),
  )
  .prefix("/api");

// =============================================================================
// API Definition
// =============================================================================

const Api = HttpApi.make("app").add(UsersGroup);

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
    .handle("getUser", ({ params }) =>
      Effect.gen(function* () {
        yield* Effect.sleep("300 millis");
        const user = mockUsers[params.id];
        if (!user) {
          return yield* Effect.fail(new UserNotFound({ id: params.id }));
        }
        return user;
      }),
    )
    .handle("getUserPosts", ({ params }) =>
      Effect.gen(function* () {
        yield* Effect.sleep("400 millis");
        return mockPosts.filter((p) => p.authorId === params.id);
      }),
    ),
);

// Default export: composed API layer — the framework reads this.
export default HttpApiBuilder.layer(Api).pipe(Layer.provide(UsersLive));

// =============================================================================
// Typed API Client
// =============================================================================

const client = HttpApiClient.make(Api, { baseUrl: "" });
type ApiClientService = HttpApiClient.ForApi<typeof Api>;

/** Tag for the typed API client. Yield in effects to get the client. */
export class ApiClient extends ServiceMap.Service<ApiClient, ApiClientService>()("ApiClient") {}

/** Layer that creates the ApiClient using FetchHttpClient. */
export const ApiClientLive = Layer.effect(
  ApiClient,
  client.pipe(Effect.provide(FetchHttpClient.layer)),
);
