/**
 * Type-safe incident resources using Resource.make + ApiClient
 *
 * - incidentsResource: static resource for the full incident list
 * - incidentResource: parameterized factory for a single incident by id
 *
 * Both yield* ApiClient from Effect context. Route requirements are closed by
 * ApiClientRoot.layer, which reuses the client acquired by the document root.
 */
import { Effect } from "effect";
import { Resource } from "trygg";
import { ApiClient } from "trygg/api";
import type { Incident } from "../api";
import type { IncidentId } from "../errors/incidents";

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
  (params: { id: IncidentId }) =>
    Effect.gen(function* () {
      const client = yield* ApiClient;
      return yield* client.incidents.get({ params });
    }),
  { key: ({ id }) => Resource.hash("incidents.get", id) },
);
