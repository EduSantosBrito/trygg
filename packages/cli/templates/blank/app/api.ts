import { HttpApi, HttpApiBuilder, HttpApiEndpoint, HttpApiGroup } from "@effect/platform";
import { Effect, Layer, Schema } from "effect";

const Hello = Schema.Struct({ message: Schema.String });

class HelloGroup extends HttpApiGroup.make("hello")
  .add(HttpApiEndpoint.get("greet", "/hello").addSuccess(Hello))
  .prefix("/api") {}

class Api extends HttpApi.make("app").add(HelloGroup) {}

const HelloHandlers = HttpApiBuilder.group(Api, "hello", (handlers) =>
  handlers.handle("greet", () => Effect.succeed({ message: "Hello from trygg!" })),
);

export default HttpApiBuilder.api(Api).pipe(Layer.provide(HelloHandlers));
