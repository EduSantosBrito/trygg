/**
 * Type-safe API resources using Resource.make + ApiClient
 *
 * Resources yield* ApiClient from the Effect context.
 * The ApiClient requirement propagates to the component,
 * satisfied by Component.provide(ApiClientLive) at the parent.
 */
import { Effect } from "effect";
import { Resource } from "trygg";
import { ApiClient } from "trygg/api";
import type { User, Post } from "../api";

export { type User, type Post };

/**
 * Resource for fetching all users.
 */
export const usersResource = Resource.make(
  () =>
    Effect.gen(function* () {
      const client = yield* ApiClient;
      return yield* client.users.listUsers();
    }),
  { key: "users.list" },
);

/**
 * Resource factory for fetching a single user by ID.
 */
export const userResource = Resource.make(
  (params: { id: string }) =>
    Effect.gen(function* () {
      const client = yield* ApiClient;
      return yield* client.users.getUser({ path: params });
    }),
  { key: (params) => Resource.hash("users.getUser", params) },
);

/**
 * Resource factory for fetching a user's posts.
 */
export const userPostsResource = Resource.make(
  (params: { id: string }) =>
    Effect.gen(function* () {
      const client = yield* ApiClient;
      return yield* client.users.getUserPosts({ path: params });
    }),
  { key: (params) => Resource.hash("users.getUserPosts", params) },
);
