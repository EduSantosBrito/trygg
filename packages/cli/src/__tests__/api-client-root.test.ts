import { Effect } from "effect";
import { assert, it } from "@effect/vitest";
import { ApiClient, ApiClientLive } from "trygg/api";
import { ApiClientRoot } from "../../templates/incident/app/services/app";

it.effect("should reuse the root ApiClient instance in incident routes", () =>
  Effect.gen(function* () {
    // Scope: exercises the route bridge against the client acquired by the composition root.
    // Assertion: ApiClientRoot.layer closes the route requirement without acquiring another client.
    const rootClient = yield* ApiClient;
    const routeClient = yield* ApiClient.pipe(Effect.provide(ApiClientRoot.layer));

    assert.strictEqual(routeClient, rootClient);
  }).pipe(Effect.provide(ApiClientLive)),
);
