# Resource

## When to use

Use `Resource` when async data should be cached by key, deduplicated across callers, cancelled on reactive param changes, and exposed as reactive state to components.

## Behavior

`Resource.make` defines a keyed fetch descriptor. `Resource.fetch` returns a signal of `Pending`, `Success`, or `Failure`, and reactive params can swap the backing resource key without replacing the output signal. `Resource.invalidate` keeps stale data visible during background refetch; `Resource.refresh` forces a hard pending transition.

For API-backed components, define the client as a service, build a keyed resource from that service, and then pattern-match the returned state:

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
  { key: ({ id }) => Resource.hash("users.get", { id }) },
);

const UserPanel = Component.gen(function* (
  Props: ComponentProps<{ readonly userId: Signal.Signal<string> }>,
) {
  const { userId } = yield* Props;
  const state = yield* Resource.fetch(userResource, { id: userId });

  return yield* Resource.match(state).pipe(
    Resource.on("Pending", () => <p>Loading user...</p>),
    Resource.on("Success", ({ value, stale }) => (
      <section aria-busy={stale}>
        <h2>{value.name}</h2>
        <button
          onClick={() =>
            Signal.peek(userId).pipe(
              Effect.flatMap((id) => Resource.invalidate(userResource({ id }))),
            )
          }
        >
          Refresh in background
        </button>
      </section>
    )),
    Resource.on("Failure", ({ error }) => <p>{String(error)}</p>),
    Resource.exhaustive,
  );
});

const App = UserPanel.provide(
  Layer.succeed(UsersApi, {
    getUser: (id) => Effect.succeed({ id, name: `User ${id}` }),
  }),
);
```

Reactive fetches keep the output signal stable while params change. That means child views can stay mounted while the backing key switches, and in-flight work for the previous key is cancelled instead of racing the next result.

For full async lifecycle control — loading, success, error, retry, and timeout — combine `Resource` with `Effect.retry` and `Effect.timeout` inside the fetch descriptor. Trigger fetches from event handlers by calling `Resource.fetch` with updated signal params, or use `Resource.invalidate` to force a background refetch while keeping stale data visible:

```tsx
import { Effect, Layer, Schedule } from "effect";
import * as Context from "effect/Context";
import { Component, Resource, Signal, type ComponentProps } from "trygg";

class UsersApi extends Context.Service<
  UsersApi,
  { readonly getUser: (id: string) => Effect.Effect<User, Error> }
>("example/UsersApi") {}

const userResource = Resource.make(
  ({ id }: { readonly id: string }) =>
    Effect.gen(function* () {
      const api = yield* UsersApi;
      return yield* api.getUser(id).pipe(
        Effect.retry({
          schedule: Schedule.exponential("100 millis"),
          times: 3,
        }),
        Effect.timeout("5 seconds"),
        Effect.tapError((e) => Effect.log(`fetch failed: ${e}`)),
      );
    }),
  { key: ({ id }) => Resource.hash("users.get", { id }) },
);

const AsyncUserPanel = Component.gen(function* (
  Props: ComponentProps<{ readonly userId: Signal.Signal<string> }>,
) {
  const { userId } = yield* Props;
  const state = yield* Resource.fetch(userResource, { id: userId });

  return yield* Resource.match(state).pipe(
    Resource.on("Pending", () => <p>Loading user...</p>),
    Resource.on("Success", ({ value, stale }) => (
      <section aria-busy={stale}>
        <h2>{value.name}</h2>
        <button
          onClick={() =>
            Signal.peek(userId).pipe(
              Effect.flatMap((id) => Resource.invalidate(userResource({ id }))),
            )
          }
        >
          Refresh in background
        </button>
      </section>
    )),
    Resource.on("Failure", ({ error }) => (
      <div>
        <p>{String(error)}</p>
        <button
          onClick={() =>
            Signal.peek(userId).pipe(Effect.flatMap((id) => Resource.refresh(userResource({ id }))))
          }
        >
          Retry
        </button>
      </div>
    )),
    Resource.exhaustive,
  );
});
```

When deciding between `Signal.get` and passing signals directly to JSX:

- **Pass signals directly to JSX** for fine-grained DOM updates. The renderer subscribes individual nodes to the signal; when it changes, only those nodes update. The component does not re-run. Use this for text content, attributes, and list items.
- **Call `Signal.get`** when the component must re-run to make a structural decision — conditional rendering or branching logic.
- **Call `Signal.peek`** for an imperative snapshot that should not subscribe the current render, such as event handlers, service methods, middleware, or framework internals that manage their own subscriptions.

In the example above, `userId` is passed directly to `Resource.fetch` so reactive param changes trigger new fetches automatically, while `Signal.peek(userId)` is used inside event handlers to read the current value for imperative operations like `invalidate` or `refresh`.

## Related exports

- `Resource.make`
- `Resource.fetch`
- `Resource.match`
- `Resource.on`
- `Resource.exhaustive`
- `Resource.invalidate`
- `Resource.refresh`
- `Resource.clear`
- `Signal.peek`
