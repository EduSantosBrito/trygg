import { Context, Layer } from "effect";

export class ApiClient extends Context.Service<ApiClient, { readonly identity: object }>()(
  "create-trygg/test/ApiClient",
) {}

export const ApiClientLive = Layer.succeed(ApiClient, ApiClient.of({ identity: {} }));
