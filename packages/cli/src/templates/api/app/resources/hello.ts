/**
 * Type-safe API resources using Resource.make + ApiClient
 *
 * Resources yield* ApiClient from the Effect context.
 * The ApiClient requirement propagates to the component,
 * satisfied by Component.provide(ApiClientLive) at the parent.
 */
import { Effect } from "effect";
import { Resource } from "trygg";
import { ApiClient } from "../api";

/**
 * Resource for fetching hello message.
 */
export const helloResource = Resource.make(
  () =>
    Effect.gen(function* () {
      const client = yield* ApiClient;
      return yield* client.hello.greet();
    }),
  { key: "hello.greet" },
);
