# ErrorBoundary

Turn a tagged render failure into typed fallback UI instead of a blank screen, matched by the failure's `_tag`.

```tsx
import { Component, ErrorBoundary } from "trygg";
import type { ComponentProps } from "trygg";
import { Cause, Data, Effect } from "effect";

class NotFound extends Data.TaggedError("NotFound")<{ readonly id: string }> {}

const Profile = Component.gen(function* () {
  yield* new NotFound({ id: "u_42" });
  return <div>never reached</div>;
});

const NotFoundView = Component.gen(function* (Props: ComponentProps<{ error: NotFound }>) {
  const { error } = yield* Props;
  return <p>No profile for {error.id}</p>;
});

const GenericView = Component.gen(function* (
  _Props: ComponentProps<{ cause: Cause.Cause<unknown> }>,
) {
  return <p>Something went wrong</p>;
});

export const App = Effect.gen(function* () {
  const SafeProfile = yield* ErrorBoundary.catch(Profile).pipe(
    ErrorBoundary.on("NotFound", NotFoundView),
    ErrorBoundary.catchAll(GenericView),
  );
  return <SafeProfile />;
});
```

Only a `NotFound` failure routes to `NotFoundView`; the handler is selected by tag, not by a blanket catch. `ErrorBoundary.on` requires a tag that exists in the wrapped Component's error channel, so a typo or a stale tag is a compile error.

## When to use

Reach for `ErrorBoundary` when a Component can fail with tagged errors and you want the fallback to live in the Component tree, with the matching Component picked by tag. It contrasts with a route-level Boundary: a Boundary owns whole-page fallback for a Route, while `ErrorBoundary` wraps a Component anywhere in the tree.

Prefer recovering inside the Component itself (`Effect.catchTag`, returning a fallback Element) when the failure has a local recovery that does not need its own fallback Component.

## Behavior

`ErrorBoundary.catch` opens a matcher around a Component. The matcher carries the Component's error channel `E` in its type; each `ErrorBoundary.on(tag, View)` removes that tag from `E` and adds `View`'s service requirements to the result. You finalize with one of:

- `ErrorBoundary.catchAll(View)` accepts a matcher with any remaining errors and produces a Component whose error channel is `never`. The catch-all `View` receives `{ cause }` for the unmatched failures.
- `ErrorBoundary.exhaustive(matcher)` only type-checks when every tag in `E` has been handled by `ErrorBoundary.on`. It produces a Component whose error channel is `never`; if a tagged failure still reaches it at render time, the rendered Element fails with `UnhandledErrorsError`.

Both finalizers return an `Effect`, so build the safe Component with `yield*` inside `Component.gen` or `Effect.gen`. The handler matched by `ErrorBoundary.on` receives `{ error }` typed to that exact tag; the catch-all receives `{ cause }` (the full `Cause.Cause<unknown>`). Matching reads `_tag` from the squashed cause, so any tagged error works — `Data.TaggedError` and `Schema.TaggedError` both qualify.

Recovery applies to Causes containing only typed failures. Defects and interruption, including mixed Causes, remain terminal and do not construct fallback UI. Failed child scopes close with their failure Exit. If rollback also fails, both the render and cleanup reasons remain observable.

Sharp edges:

- The matcher is pipeable, but `on` must run before a finalizer: `catchAll`/`exhaustive` expect a matcher, not a bare Component.
- `Component.provide` on the finalized safe Component preserves the boundary — services flow into both the wrapped tree and the handlers.

## Related exports

- `ErrorBoundary.catch` — open a tag matcher around a Component
- `ErrorBoundary.on` — route one error tag to a fallback view
- `ErrorBoundary.catchAll` — handle any remaining errors with `{ cause }`
- `ErrorBoundary.exhaustive` — finalize only when every tag is handled
- `ErrorBoundary.UnhandledErrorsError` — render failure when an unhandled tag reaches exhaustive

## Troubleshooting

- Fallback never shows, original UI renders: the wrapped Component did not actually fail in its error channel. `ErrorBoundary` matches typed failures, not thrown values that escape the Effect.
- `ErrorBoundary.on("Tag", ...)` is a type error: `"Tag"` is not in the wrapped Component's error channel (already handled, misspelled, or not declared). Check the `_tag` on the error class.
- `ErrorBoundary.exhaustive` does not type-check: a tag in `E` is still unhandled. Add an `ErrorBoundary.on` for it, or finalize with `ErrorBoundary.catchAll` instead.
- Render fails with `UnhandledErrorsError`: a tagged failure reached an `exhaustive` boundary at render time without a handler; add the missing tag.
