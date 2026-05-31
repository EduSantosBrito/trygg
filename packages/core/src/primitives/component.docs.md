# Component

Define a UI unit that yields its props and services as an Effect, then produces an Element the renderer mounts.

```tsx
import { Component, Signal } from "trygg";

const Counter = Component.gen(function* () {
  const count = yield* Signal.make(0);
  return <button onClick={() => Signal.update(count, (n) => n + 1)}>Count: {count}</button>;
});
```

## When to use

Reach for `Component` whenever UI needs typed props, local `Signal` state, or services read from Effect context. A `Component.gen` body runs once per instance: yield `Signal.make` for state, `yield*` a `ComponentProps<P>` handle to read props, and `yield*` any service the parent provides.

Pass props through `ComponentProps<P>` when a component takes inputs, and lift state into a `Signal` so the renderer updates the bound DOM node in place rather than re-running the body. If the data is async, keyed, and cacheable, prefer a `Resource`; for static markup with no requirements, a plain element function is enough.

## Behavior

`Component.gen` returns a callable you use in JSX. Calling it builds an Element backed by an Effect; the renderer runs that Effect once when the component mounts, threading its props in through the `ComponentProps<P>` service. The generator's failures and requirements surface on the component's type, so a typed error or an unsatisfied service is visible at the call site, not at runtime.

Props read from `ComponentProps<P>` are read once at mount. To make a value reactive, pass a `Signal` in as a prop and `yield* Signal.get` it inside the body, or keep state in a `Signal` the component owns:

```tsx
import { Component, type ComponentProps } from "trygg";
import { Schema } from "effect";

class EmailInvalid extends Schema.TaggedErrorClass<EmailInvalid>()("EmailInvalid", {
  email: Schema.String,
}) {}

// Component.Type<{ email: string }, EmailInvalid, never>
const EmailBadge = Component.gen(function* (Props: ComponentProps<{ email: string }>) {
  const { email } = yield* Props;
  if (!email.includes("@")) {
    return yield* new EmailInvalid({ email });
  }
  return <span>{email}</span>;
});
```

`EmailInvalid` appears in the component's error channel because the generator can `yield*` it; the renderer surfaces unrecovered render failures, or you can match them with `ErrorBoundary`. The third type parameter (`R`) collects every service the body still needs.

Services are satisfied with a Layer. A child `yield*`s a service; a parent provides it with `Component.provide(layer)`, which narrows the remaining `R`. By the time the tree reaches the Mount boundary, the root component must have `R = never` — any missing Layer is a type error pointing at the unsatisfied service:

```tsx
import { Component, Signal, type ComponentProps } from "trygg";
import { Context, Effect, Layer, Schedule } from "effect";

class HttpClient extends Context.Service<
  HttpClient,
  { readonly request: (path: string) => Effect.Effect<string> }
>()("app/HttpClient") {}

class UserRepository extends Context.Service<
  UserRepository,
  { readonly getUser: (id: string) => Effect.Effect<{ readonly id: string; readonly name: string }> }
>()("app/UserRepository") {}

const HttpClientLive = Layer.succeed(HttpClient, {
  request: (path) => Effect.succeed(`Response for ${path}`),
});

const UserRepositoryLive = Layer.effect(
  UserRepository,
  Effect.gen(function* () {
    const http = yield* HttpClient;
    return {
      getUser: (id) =>
        http.request(`/users/${id}`).pipe(
          Effect.map((name) => ({ id, name })),
          Effect.retry({ schedule: Schedule.exponential("1 second"), times: 3 }),
        ),
    };
  }),
).pipe(Layer.provide(HttpClientLive));

const UserProfile = Component.gen(function* (
  Props: ComponentProps<{ userId: Signal.Signal<string> }>,
) {
  const { userId } = yield* Props;
  const repo = yield* UserRepository;
  const id = yield* Signal.get(userId);
  const user = yield* repo.getUser(id);
  return <p>{user.name}</p>;
});

const App = Component.gen(function* () {
  const userId = yield* Signal.make("1");
  return <UserProfile userId={userId} />;
}).pipe(Component.provide(UserRepositoryLive));
```

`App` has `R = never`: `UserRepositoryLive` satisfies `UserRepository`, and its own `HttpClient` requirement is satisfied by `HttpClientLive` through `Layer.provide`.

`Component.provide` owns a mounted Layer boundary. The Layer is acquired once when the provided component mounts, its scope is reused while the component key and Layer identity stay stable, and it is finalized on unmount. Changing the component key or providing a different Layer instance is treated as replacement: the old scope finalizes and a fresh one is acquired. Keep interactive state in scoped services or signals behind a stable boundary rather than swapping Layers during render.

## Related exports

- `Component`
- `Component.gen` — define a component from a generator yielding props and services
- `Component.provide` — satisfy a child's services at a mounted Layer boundary
- `ComponentProps` — the service handle a body yields to read props
- `isEffectComponent`

## Troubleshooting

- A prop doesn't update when the parent changes it: props from `ComponentProps<P>` are read once at mount. Pass a `Signal` as the prop and `yield* Signal.get` it, or resolve the value upfront.
- A `Component.gen` call type-errors at the Mount boundary with a leftover service in `R`: a Layer is missing. Provide it with `Component.provide(layer)` (or at the Mount boundary) so the root reaches `R = never`.
- `Component.gen` returns a component that fails when rendered: it was not called with a generator function, or the curried `Component.gen<P>()` form was used without the trailing generator. Pass `function* () { ... }` directly.