# Forms and inputs

trygg has no form library and no controlled/uncontrolled distinction to manage. An input's value is a Signal, an event handler is a function that returns an Effect, and validation is the same typed-error code you already write with Effect. This page shows the three pieces — binding a value, reading it, and validating on submit — using the patterns from the example app.

## A controlled input is a Signal

Pass a `Signal<string>` straight into the `value` prop and update it from `onInput`. The binding is fine-grained: typing patches that one input node, and nothing re-runs the component.

```tsx
import { Effect } from "effect";
import { Component, Signal } from "trygg";

const NameField = Component.gen(function* () {
  const name = yield* Signal.make("");

  return (
    <input
      type="text"
      value={name}
      placeholder="Your name"
      onInput={(e) => {
        const target = e.target;
        if (target instanceof HTMLInputElement) {
          return Signal.set(name, target.value);
        }
        return Effect.void;
      }}
    />
  );
});
```

An event handler receives the DOM `Event` and returns an `Effect`. The DOM types `event.target` as `EventTarget | null`, so narrow it with `instanceof HTMLInputElement` before reading `.value`; every branch must return an Effect, which is why the fallback is `Effect.void`. The same shape works for `onChange`, `onKeyDown`, and the rest — they all take `(event: Event) => Effect.Effect<…>`.

## Read with peek inside handlers, get for display

Two ways to read a Signal, for two different jobs:

- `Signal.peek(signal)` reads the current value **without subscribing**. Use it inside a handler, where you want the latest value but do not want the read to wire up a dependency.
- `Signal.get(signal)` reads **reactively** — it subscribes the surrounding component so a derived display updates when the value changes.

```tsx
const error = yield * Signal.make<Option.Option<string>>(Option.none());

// Reactive read for rendering the message:
{
  Option.match(yield * Signal.get(error), {
    onNone: () => null,
    onSome: (message) => <p className="field-error">{message}</p>,
  });
}
```

## Validate on submit with typed errors

Validation is ordinary Effect code. Model each failure as a tagged error, write validators that return `Effect.Effect<Value, Error>`, and turn failures into a `Result` with `Effect.result` so the handler can branch without throwing. `Match` renders each error exhaustively, so adding a new failure case is a compile error until you handle it.

```tsx
import { Effect, Match, Option, Result, Schema } from "effect";
import { Component, Signal } from "trygg";

class EmailRequired extends Schema.TaggedError<EmailRequired>()("EmailRequired", {}) {}
class EmailInvalid extends Schema.TaggedError<EmailInvalid>()("EmailInvalid", {
  email: Schema.String,
}) {}

type FieldError = EmailRequired | EmailInvalid;

const validateEmail = (email: string): Effect.Effect<string, FieldError> => {
  if (email.trim() === "") {
    return Effect.fail(new EmailRequired());
  }
  if (!email.includes("@") || !email.includes(".")) {
    return Effect.fail(new EmailInvalid({ email }));
  }
  return Effect.succeed(email);
};

const messageFor = Match.type<FieldError>().pipe(
  Match.tag("EmailRequired", () => "Email is required"),
  Match.tag("EmailInvalid", ({ email }) => `"${email}" is not a valid email address`),
  Match.exhaustive,
);

const SignupForm = Component.gen(function* () {
  const email = yield* Signal.make("");
  const emailError = yield* Signal.make<Option.Option<string>>(Option.none());

  const onSubmit = Effect.fnUntraced(function* (e: Event) {
    e.preventDefault();
    yield* Signal.set(emailError, Option.none());

    const current = yield* Signal.peek(email);
    const result = yield* validateEmail(current).pipe(Effect.result);
    if (Result.isFailure(result)) {
      yield* Signal.set(emailError, Option.some(messageFor(result.failure)));
      return;
    }

    yield* Effect.log(`Submitting ${result.success}`);
  });

  return (
    <form onSubmit={onSubmit}>
      <input
        type="email"
        value={email}
        onInput={(e) => {
          const target = e.target;
          if (target instanceof HTMLInputElement) {
            return Signal.set(email, target.value);
          }
          return Effect.void;
        }}
      />
      {Option.match(yield* Signal.get(emailError), {
        onNone: () => null,
        onSome: (message) => <p className="field-error">{message}</p>,
      })}
      <button type="submit">Sign up</button>
    </form>
  );
});
```

`Effect.fnUntraced` wraps a multi-step generator as a single handler. `e.preventDefault()` stops the browser's native submit so navigation does not reload the page. Inside, `Signal.peek` reads the latest value, `Effect.result` converts a failed validator into a `Result` you can branch on, and a failure writes the message back into its own Signal.

## Sharp edges

- **Always narrow `event.target`.** It is typed `EventTarget | null`; read `.value`, `.checked`, or `.files` only after an `instanceof` check, and return `Effect.void` from the branch that does not match.
- **Inputs are controlled.** Bind `value` to a Signal and update it in the handler. `defaultValue` seeds the initial value only; it does not track later changes.
- **`preventDefault` lives in the handler.** Call it on the submit `Event` before doing async work — the handler runs as an Effect, so the default is suppressed synchronously when the handler starts.
- **`checked` takes a Signal too.** Checkbox and radio binding mirrors `value`: pass `Signal<boolean>` to `checked` and set it from `onChange`.

See the [Signals](/docs/signals) page for derived state and keyed lists, [Components](/docs/components) for props and service requirements, and [Global storage](/docs/patterns/global-storage) for sharing form-derived state across the tree.
