# Resource

Fetch keyed async data and render its Pending, Success, and Failure state reactively, with caching, deduplication, and background refresh, all inside the Effect model.

```tsx
import { Effect, Layer } from "effect";
import * as Context from "effect/Context";
import { Component, Resource } from "trygg";

class UsersApi extends Context.Service<
  UsersApi,
  { readonly list: () => Effect.Effect<ReadonlyArray<string>, Error> }
>()("example/UsersApi") {}

const usersResource = Resource.make(
  () =>
    Effect.gen(function* () {
      const api = yield* UsersApi;
      return yield* api.list();
    }),
  { key: "users.list" },
);

const UserList = Component.gen(function* () {
  const state = yield* Resource.fetch(usersResource);

  return yield* Resource.match(state).pipe(
    Resource.on("Pending", () => <p>Loading...</p>),
    Resource.on("Success", ({ value }: { value: ReadonlyArray<string>; stale: boolean }) => (
      <ul>
        {value.map((name) => (
          <li>{name}</li>
        ))}
      </ul>
    )),
    Resource.on("Failure", ({ error }) => <p>{String(error)}</p>),
    Resource.exhaustive,
  );
});

const App = UserList.pipe(
  Component.provide(Layer.succeed(UsersApi, { list: () => Effect.succeed(["Ada", "Linus"]) })),
);
```

The `Success` handler payload type is annotated (`{ value: ...; stale: boolean }`) because `Resource.on` infers the value type from the handler, not from the matcher. Without the annotation, `value` falls back to `unknown`.

## When to use

Reach for `Resource` when data is async, keyed, and cacheable: API reads, server data, anything you want deduplicated across callers and shared by a stable key. The keyed cache means two components fetching the same key share one in-flight request and one cached result.

Use a `Signal` instead for local reactive state that you own and mutate directly — there is no async fetch, key, or cache to manage. Reach for `Resource` only once the data crosses an effectful boundary.

## Behavior

`Resource.make` defines an inert descriptor: a factory effect plus a key. Passing a string `key` makes a no-params `Resource` directly; passing a `key` function makes a factory you call with params to get a `Resource`. Use `Resource.hash(prefix, ...parts)` to derive a `v3` key from positional identity values. Primitive parts and `Symbol.for` values use deterministic, type-tagged structural identity, so `undefined`, special numbers, types, positions, and delimiters remain distinct. Objects and functions use opaque process-local reference identity shared by duplicate module copies during HMR: hashing does not enumerate keys, read properties, invoke getters or Proxy traps, or change when a reference is mutated. The shared authority retains references only in a `WeakMap`. Pass immutable primitive fields, not a newly-created params object, when separate calls must share a key. Non-global Symbols, including well-known Symbols, throw `ResourceHashLocalSymbolError` instead of entering a strongly-held identity table.

`Resource.fetch` executes a descriptor and returns a `Signal` of the Resource state — `Pending`, `Success` (`{ value, stale }`), or `Failure` (`{ error, staleValue }`). `Resource.match(state)` builds a matcher; chain `Resource.on("Pending" | "Success" | "Failure", handler)` and finish with `Resource.exhaustive` to render the matched Element reactively. A handler is an Element, a function of the payload, or a Component. The match payloads differ from the raw state: `Pending` and `Failure` both expose `stale: Option.Option<A>` (the last successful value, if any), while `Success` exposes `stale: boolean`. Annotate the destructured payload when a handler reads `value` so its type is pinned instead of inferred as `unknown`.

`Resource.fetch` reuses the cached entry by key. The first call forks the fetch and the signal starts `Pending`; a later call for a key that already resolved returns the cached state without refetching. Concurrent calls for the same key are deduplicated by one atomic flight claim and share its settlement. If TTL retirement wins between admission and that claim, the consumer releases the stale lease and retries a fresh entry rather than returning a never-started `Pending` Signal. Only Causes composed entirely of typed failures become `Failure<E>` state; if several typed failures are present, the first Cause reason is published. A lone flight owner reports the complete terminal Exit for pure interruption or an unrecoverable defect/mixed Cause exactly once, and the shared Deferred preserves that Cause for any joiners. Fatal termination retires the cache identity immediately, so a later fetch creates a fresh Signal instead of reusing a terminal `Pending` entry. Existing leased holders keep the retired Signal only until their structural owner releases it.

Every fetch needs a structural owner for that lease. During Component execution the current render (or Component fallback) owns it; outside a Component, run the fetch in an explicit scoped Effect. If neither owner exists, `Resource.fetch` fails with `Signal.SignalScopeError` before cache lookup.

Fetch workers and reactive subscriptions attach to their structural owner before executing. If a fetch or subscription callback initiates disposal, closure waits for acquired work to release. Reactive fetches still expose an already-cached state before returning the output Signal.

A registry retained after its Layer closes cannot be reused. Lookup returns no entry and lease acquisition returns `false` once shutdown starts, including while an entry finalizer is still running. New admissions and fetches terminate with interruption. Shutdown drops registry references and wakes pending admission waiters; a suspended candidate cannot publish after closure.

Stale-while-revalidate and invalidation:

- `Resource.invalidate(resource)` marks a `Success` as `stale: true` and refetches in the background, so old data stays visible until fresh data arrives. It is a no-op if a fetch is already in flight.
- `Resource.refresh(resource)` transitions to `Pending` first, dropping the visible value, then refetches. Use it when stale data is worse than a loading state.
- `Resource.clear(resource)` force-closes every live generation for the key, including leased generations already retired by TTL, so the next `Resource.fetch` starts fresh.

Reactive params drive refetches without rebuilding the descriptor. Pass a factory plus `ReactiveParams` (each field a static value or a `Signal`): `Resource.fetch(factory, { id: userId })`. When a `Signal` param changes the key, the current output stops waiting on the previous key and starts following the new one, while the output signal stays the same instance — so child views stay mounted across param changes instead of tearing down. A shared fetch for the previous key continues for any other consumers. Read params inside event handlers with `Signal.peek` to take an imperative snapshot that does not subscribe the current render:

```tsx
import { Effect, Layer } from "effect";
import * as Context from "effect/Context";
import { Component, Resource, Signal, type ComponentProps } from "trygg";

interface User {
  readonly id: string;
  readonly name: string;
}

class UsersApi extends Context.Service<
  UsersApi,
  { readonly getUser: (id: string) => Effect.Effect<User, Error> }
>()("example/UsersApi") {}

const userResource = Resource.make(
  ({ id }: { readonly id: string }) =>
    Effect.gen(function* () {
      const api = yield* UsersApi;
      return yield* api.getUser(id);
    }),
  { key: ({ id }) => Resource.hash("users.get", id) },
);

const UserPanel = Component.gen(function* (
  Props: ComponentProps<{ readonly userId: Signal.Signal<string> }>,
) {
  const { userId } = yield* Props;
  const state = yield* Resource.fetch(userResource, { id: userId });

  return yield* Resource.match(state).pipe(
    Resource.on("Pending", () => <p>Loading user...</p>),
    Resource.on("Success", ({ value, stale }: { value: User; stale: boolean }) => (
      <section aria-busy={stale}>
        <h2>{value.name}</h2>
        <button
          onClick={() =>
            Signal.peek(userId).pipe(
              Effect.flatMap((id) => Resource.invalidate(userResource({ id }))),
            )
          }
        >
          Refresh
        </button>
      </section>
    )),
    Resource.on("Failure", ({ error }) => <p>{String(error)}</p>),
    Resource.exhaustive,
  );
});

const App = UserPanel.pipe(
  Component.provide(
    Layer.succeed(UsersApi, { getUser: (id) => Effect.succeed({ id, name: `User ${id}` }) }),
  ),
);
```

Retry, timeout, and other request lifecycle policy live in the fetch effect itself, not in `Resource`: compose `Effect.retry`, `Effect.timeout`, and friends inside the descriptor factory and the Resource state reflects the final typed outcome. The registry that backs caching is a Service — `Resource.fetch` requires `ResourceRegistryTag`. Provide `Resource.ResourceRegistry.layer()` before the Mount boundary (test layers can override it).

`ResourceRegistry.layer()` uses a hard LRU capacity of 256 entries and lazy 30-minute idle expiration. The bound counts admitted entries, pending candidates, in-flight fetches, entries being closed, and TTL- or failure-retired entries that still have leases. A static consumer leases its entry to its current render, Component, or Effect Scope; a reactive consumer leases the currently followed entry for the daemon lifetime. Capacity admission evicts only an unleased LRU entry and finishes its cleanup before allocating its replacement. If no slot is free or safely evictable, static `Resource.fetch`, initial reactive `Resource.fetch`, and `Resource.refresh` fail immediately with `ResourceRegistrySaturatedError`; a later reactive key change publishes that error as `Failure` with any stale value. TTL can remove a leased entry from lookup, but that retired entry continues consuming its slot until its final lease releases and closes the Scope. `Resource.clear` is deliberately forceful: it finds every live generation for the key, closes each entry even when a consumer still holds the old Signal, and releases their capacity before it returns. Later structural lease release remains idempotent. Pass `{ capacity, timeToLive }` to `ResourceRegistry.layer` to install an explicit policy. Capacity must be a positive safe integer and TTL must be non-negative.

Entry cleanup runs every release even when a finalizer fails. Finalizer defects and interruption remain observable as Effect Causes; they are not converted to successful cache operations or resource `Failure` values. A closed entry releases its capacity even when its finalizer fails.

## Related exports

- `Resource.make` — define an inert descriptor: factory effect plus key
- `Resource.hash` — derive a deterministic key from parameter values
- `Resource.fetch` — execute a descriptor, returning a Signal of state
- `Resource.match` — build a matcher over the resource state
- `Resource.on` — handle one `Pending`/`Success`/`Failure` case
- `Resource.exhaustive` — finalize the matcher, rendering reactively
- `Resource.invalidate` — mark Success stale and refetch in background
- `Resource.refresh` — drop to Pending first, then refetch
- `Resource.clear` — remove the cache entry entirely
- `Resource.ResourceRegistry.layer` — create the cache-backing registry Layer with default or explicit capacity and idle TTL
- `Resource.ResourceRegistryTag` — the registry Service `fetch` requires
- `Resource.ResourceRegistrySaturatedError` — no registry slot is free or safely evictable
- `Resource.ResourceHashLocalSymbolError` — `Resource.hash` received a non-global Symbol

## Troubleshooting

- **`Success` handler `value` is typed `unknown`.** `Resource.on` infers the payload type from the handler, not from the matched state. Annotate the destructured payload — `({ value, stale }: { value: User; stale: boolean })` — to pin the type.
- **`ResourceRegistryTag` missing at the Mount boundary.** `Resource.fetch` adds `ResourceRegistryTag` to the requirements. Provide `Resource.ResourceRegistry.layer()` in the app's Layer before mounting, or the top-level mount effect will not have `R = never`.
- **`invalidate` does nothing.** It is a no-op when a fetch is already in flight, and it only marks an existing `Success` as stale — there is nothing to refresh for a key that was never fetched. Use `Resource.refresh` for a hard reload or `Resource.fetch` to seed the entry first.
- **Reactive params do not refetch.** A refetch only happens when the key actually changes. Make sure the `key` function in `Resource.make` derives from the reactive params (for example via `Resource.hash`), and pass the live `Signal` to `Resource.fetch`, not a snapshot.
- **`ResourceRegistrySaturatedError` on a new key.** Every configured slot is live, reserved, closing, in flight, or retained by a lease. Release the owning Scope, wait for cleanup, increase the explicit registry capacity, or reduce key churn; Resource never exceeds the bound by evicting an active entry.
- **Two equivalent params objects produce different hashes.** Objects and functions intentionally use reference identity. Pass stable positional primitives such as `Resource.hash("users.get", params.id)` when independently-created params should share a cache entry.
