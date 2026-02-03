import {
  HttpApi,
  HttpApiEndpoint,
  HttpApiGroup,
  HttpApiBuilder,
  HttpApiClient,
  FetchHttpClient,
} from "@effect/platform";
import { Context, Effect, Layer, Schema } from "effect";

const Hello = Schema.Struct({ message: Schema.String });

class HelloGroup extends HttpApiGroup.make("hello")
  .add(HttpApiEndpoint.get("greet", "/hello").addSuccess(Hello))
  .prefix("/api") {}

class Api extends HttpApi.make("app").add(HelloGroup) {}

const HelloLive = HttpApiBuilder.group(Api, "hello", (handlers) =>
  handlers.handle("greet", () => Effect.succeed({ message: "Hello from trygg!" })),
);

// Default export: composed Layer<HttpApi.Api> — the framework reads this.
export default HttpApiBuilder.api(Api).pipe(Layer.provide(HelloLive));

// =============================================================================
// Typed API Client
// =============================================================================

const _client = HttpApiClient.make(Api, { baseUrl: "" });
type ApiClientService = Effect.Effect.Success<typeof _client>;

/** Tag for the typed API client. Yield in effects to get the client. */
export class ApiClient extends Context.Tag("ApiClient")<ApiClient, ApiClientService>() {}

/** Layer that creates the ApiClient using FetchHttpClient. */
export const ApiClientLive = Layer.effect(
  ApiClient,
  _client.pipe(Effect.provide(FetchHttpClient.layer)),
);
