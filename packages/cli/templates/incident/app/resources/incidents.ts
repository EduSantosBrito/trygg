/**
 * Type-safe incident resources using Resource.make + ApiClient
 *
 * - incidentsResource: static resource for the full incident list
 * - incidentResource: parameterized factory for a single incident by id
 *
 * Both yield* ApiClient from Effect context — requirement propagates
 * to the component, satisfied by Component.provide(ApiClientLive).
 */
import { Effect } from "effect";
import { Resource } from "trygg";
import { ApiClient } from "../api";
import type { Incident } from "../api";

export { type Incident };

/**
 * Resource for fetching all incidents.
 */
export const incidentsResource = Resource.make(
  () =>
    Effect.gen(function* () {
      const client = yield* ApiClient;
      return yield* client.incidents.list();
    }),
  { key: "incidents.list" },
);

/**
 * Resource factory for fetching a single incident by ID.
 */
export const incidentResource = Resource.make(
  (params: { id: number }) =>
    Effect.gen(function* () {
      const client = yield* ApiClient;
      return yield* client.incidents.get({ path: params });
    }),
  { key: (params) => Resource.hash("incidents.get", params) },
);
