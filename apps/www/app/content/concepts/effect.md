# You already know Effect

If you write Effect, you already know how to build UI here. A trygg component is an Effect: it yields its props and services, fails through the error channel, and carries its requirements in the type. The payoff is one mental model end to end — the way you compose effects is the way you compose UI, with no second set of rules at the component layer.

## A component is an Effect

`Component.gen` is `Effect.gen` that returns an Element. The body runs once per instance as setup when the component mounts — not on every render. There is no virtual DOM and no re-running on state change; reactivity is fine-grained, so a `Signal` updates the bound DOM node in place.

```tsx
import { Component, type ComponentProps } from "trygg";
import { Greeter } from "./services";

const Hello = Component.gen(function* (Props: ComponentProps<{ name: string }>) {
  const { name } = yield* Props;
  const greeter = yield* Greeter;
  const message = yield* greeter.greet(name);
  return <h1>{message}</h1>;
});
```

You `yield*` a service exactly like you would anywhere else. `Greeter` lands in the component's requirements channel; the greeting can fail, and that failure lands in the error channel. Both are visible at the call site.

## Errors are in the error channel

When the body can `yield*` a tagged error, that error stays typed on the component. Recover where it makes sense with `Effect.catchTag`, or route it to fallback UI at an `ErrorBoundary`, which selects the handler by the failure's `_tag`:

```tsx
import { Component, ErrorBoundary } from "trygg";

const Page = Component.gen(function* () {
  const SafeProfile = yield* ErrorBoundary.catch(Profile).pipe(
    ErrorBoundary.on("NotFound", NotFoundView),
    ErrorBoundary.catchAll(GenericView),
  );
  return <SafeProfile />;
});
```

`ErrorBoundary.on` only accepts a tag that exists in the wrapped component's error channel — a stale tag is a compile error, not a runtime surprise. A handler registered with `on` receives the matched `{ error }`; `catchAll` receives the `{ cause }`.

## Requirements flow, and you provide a Layer

Services flow up the requirements channel just like in plain Effect. A child `yield*`s a service; a parent satisfies it with `Component.provide(layer)` — the trygg analogue of providing a Layer to a subtree. Each `Component.provide` owns a mounted Layer boundary: acquired when the subtree mounts, finalized on unmount.

```tsx
const App = Component.gen(function* () {
  return <Hello name="Ada" />;
}).pipe(Component.provide(GreeterLive));
```

`Component.provide` narrows the remaining `R`. By the Mount boundary the root must reach `R = never`; a missing Layer is a type error pointing at the unsatisfied service.

## Async data is Effect-driven

`Resource` is the same idea for async state: an Effect-backed fetch that produces a reactive `ResourceState` — `Pending`, `Success` with a `stale` flag, or `Failure` with an optional stale value — which you match into view logic. The fetch composes with services and errors like any other effect.

```tsx
import { Effect } from "effect";
import { Component, Resource } from "trygg";
import { UserApi } from "./services";

const users = Resource.make(
  () =>
    Effect.gen(function* () {
      const api = yield* UserApi;
      return yield* api.list();
    }),
  { key: "users.list" },
);

const UserList = Component.gen(function* () {
  const state = yield* Resource.fetch(users);

  return yield* Resource.match(state).pipe(
    Resource.on("Pending", () => <p>Loading…</p>),
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
```

`Resource.fetch` reads a keyed cache, so concurrent callers share one in-flight request, and the matched state updates in place as it resolves — the same fine-grained reactivity a `Signal` gives you.

One thing to keep straight: trygg does **not** re-export Effect. Import `Component`, `Signal`, `Resource`, `ErrorBoundary`, and `mount` from `"trygg"`; import `Effect`, `Layer`, `Context`, and `Schema` from `"effect"`.
