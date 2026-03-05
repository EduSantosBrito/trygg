import { HttpApi, HttpApiBuilder, HttpApiEndpoint, HttpApiGroup } from "effect/unstable/httpapi";
import { Effect, Layer, Schema } from "effect";

const Hello = Schema.Struct({ message: Schema.String });

const HelloGroup = HttpApiGroup.make("hello")
  .add(HttpApiEndpoint.get("greet", "/hello", { success: Hello }))
  .prefix("/api");

const Api = HttpApi.make("app").add(HelloGroup);

const HelloHandlers = HttpApiBuilder.group(Api, "hello", (handlers) =>
  handlers.handle("greet", () => Effect.succeed({ message: "Hello from trygg!" })),
);

export default HttpApiBuilder.layer(Api).pipe(Layer.provide(HelloHandlers));
