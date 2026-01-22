/**
 * Type-safe API resources using Effect HttpApiClient
 *
 * This module demonstrates the recommended way to create resources:
 * 1. Import the API definition from app/api.ts
 * 2. Use HttpApiClient.make for type-safe API calls
 * 3. Use Resource.endpoint for parameterized resources
 */
import { Effect } from "effect";
import { FetchHttpClient, HttpApiClient } from "@effect/platform";
import { Resource } from "effect-ui";
import { Api, type User, type Post } from "../../api";

// Re-export types for consumers
export { type User, type Post };

// Layer for browser HTTP client
const HttpClientLive = FetchHttpClient.layer;

// Create type-safe API client from API definition
const client = HttpApiClient.make(Api, { baseUrl: "" }).pipe(Effect.provide(HttpClientLive));

/**
 * Resource for fetching all users.
 * Uses endpointNoParams since there are no parameters.
 */
export const usersResource = Resource.endpointNoParams(
  "users.list",
  Effect.flatMap(client, (c) => c.users.listUsers()),
);

/**
 * Resource factory for fetching a single user by ID.
 * Uses endpoint for parameterized resource with auto-generated cache key.
 *
 * Cache key format: "users.getUser:{"id":"123"}"
 */
export const userResource = Resource.endpoint("users.getUser", (params: { id: string }) =>
  Effect.flatMap(client, (c) => c.users.getUser({ path: params })),
);

/**
 * Resource factory for fetching a user's posts.
 */
export const userPostsResource = Resource.endpoint("users.getUserPosts", (params: { id: string }) =>
  Effect.flatMap(client, (c) => c.users.getUserPosts({ path: params })),
);
