import { HttpApi, HttpApiEndpoint, HttpApiGroup, HttpApiBuilder } from "@effect/platform";
import { Effect, Schema } from "effect";

const Hello = Schema.Struct({ message: Schema.String });

class HelloGroup extends HttpApiGroup.make("hello")
  .add(HttpApiEndpoint.get("greet", "/hello").addSuccess(Hello))
  .prefix("/api") {}

export class Api extends HttpApi.make("app").add(HelloGroup) {}

export const HelloLive = HttpApiBuilder.group(Api, "hello", (handlers) =>
  handlers.handle("greet", () => Effect.succeed({ message: "Hello from trygg!" })),
);

// Framework auto-detects Api + handler Layers and composes them.
// No need to export a combined ApiLive layer.
