# Effect TypeScript

## Core Rules

- Prefer Effect v4 APIs and patterns. Treat Effect v3 as legacy reference material only.
- If code can fail, return an `Effect`; do not throw from synchronous helpers.
- Errors must be yieldable. Use `Data.TaggedError` or `Schema.TaggedError`.
- Hold spawned fibers in a `Scope`. No floating `Effect.runFork`.
- Use the cloned repos in this workspace as the primary Effect references:
  - `./effect-smol` for Effect v4
  - `./effect` for Effect v3 and migration comparison only
- Before using `effect-solutions show <topic>`, run `effect-solutions list` and verify the topic exists.

## Preferred Patterns

- Services: use `ServiceMap.Service` with `Layer`; use `Layer.scoped` for resource-owning services and `Effect.fn("Name.method")` for traced methods.
- Errors: model domain failures with `Data.TaggedError` or `Schema.TaggedError`; yield tagged errors directly and recover with `Effect.catchTag` or `Effect.catchTags`.
- Resources: use `Effect.acquireRelease` or `Layer.scoped` for lifecycle management; cleanup must always run and should not introduce new failures.
- Schema: use `Schema.Class`, `Schema.brand`, and `Schema.decodeUnknown` at boundaries.
- Concurrency: use `Effect.all` or `Effect.forEach` with `{ concurrency }`; prefer `Queue.bounded` for producer-consumer flows.
- Streams: prefer `paginateChunkEffect` for paginated APIs and `SubscriptionRef.changes` for reactive streams.
- HTTP: compose clients with `HttpClient.mapRequest`, `HttpClient.filterStatusOk`, and `HttpClient.retryTransient`; decode typed responses with `HttpClientResponse.schemaBodyJson`.

## Repo-Specific

- For trygg component and UI-specific Effect patterns, see [Trygg UI patterns](./trygg-ui.md).
- For trygg debug, tracing, and metrics patterns, see [Observability](./observability.md).
