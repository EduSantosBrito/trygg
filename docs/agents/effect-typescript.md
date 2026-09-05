# Effect TypeScript

## Core Rules

- Follow the applicable requirements of [Effect-First Backend Engineering Quality Standard](../rfc/effect-first.md). For UI/browser code, apply its ownership, Cause, composition, boundary, and testing guarantees; do not invent persistence or durable workflow requirements for capabilities Trygg does not provide.
- Use APIs from the Effect version pinned in the workspace catalog and lockfile. Treat Effect v3 as legacy reference material only.
- If code can fail, return an `Effect`; do not throw from synchronous helpers.
- Errors must be yieldable. Use `Data.TaggedError` or `Schema.TaggedError`.
- Hold spawned fibers in a `Scope`. No floating `Effect.runFork`.
- Inspect installed Effect source and declarations when verifying API behavior. Use the `effect-glossary` skill when available; source for the pinned version remains authoritative.
- Before using `effect-solutions show <topic>`, run `effect-solutions list` and verify the topic exists.

## Preferred Patterns

- Services: use `Context.Service` with `Layer.effect`; acquire resources with `Effect.acquireRelease` inside Layer construction. Name spans with `Effect.fn("Name.method")` for meaningful operations, use `Effect.fnUntraced` for internal sequencing, and direct composition for delegations.
- Errors: model domain failures with `Data.TaggedError` or `Schema.TaggedError`; yield tagged errors directly and recover with `Effect.catchTag` or `Effect.catchTags`.
- Resources: use `Effect.acquireRelease` and scoped Layer construction. Run all required finalizers even when one fails; preserve their Causes and interruption instead of reporting successful cleanup.
- Schema: use `Schema.Class`, `Schema.brand`, and `Schema.decodeUnknownEffect` at encoded boundaries; use `makeEffect` for type-side construction.
- Concurrency: use `Effect.all` or `Effect.forEach` with `{ concurrency }`; prefer `Queue.bounded` for producer-consumer flows.
- Streams: use `Stream.paginate` for incremental pagination and `SubscriptionRef.changes` for reactive streams. Bounded synchronous collections need no stream or child fibers.
- HTTP: compose clients with `HttpClient.mapRequest`, `HttpClient.filterStatusOk`, and `HttpClient.retryTransient`; decode typed responses with `HttpClientResponse.schemaBodyJson`.

## Performance and Regression Evidence

- Preserve the public API, ordering, scoped ownership, typed failures, and interruption when optimizing execution paths.
- Keep synchronous accumulators local to each Effect execution. Avoid copying a growing collection on every insertion and decoding the same boundary once per candidate.
- Prefer direct owner-qualified operations to factories that only allocate equivalent stateless closures (RFC 8.5).
- Add behavioral regression tests before fixing a demonstrated bug. Use production implementations, Deferred/TestClock for concurrency, and deterministic work counts for performance contracts.
- Run `bun run build`, `bun run check`, `bun run test`, and `bun run --cwd packages/core docs:check`. Use `bun scripts/benchmark-runtime.ts` for local router and cleanup comparisons; timings are not a CI threshold or browser latency guarantee.

## Repo-Specific

- For trygg component and UI-specific Effect patterns, see [Trygg UI patterns](./trygg-ui.md).
- For trygg debug, tracing, and metrics patterns, see [Observability](./observability.md).
