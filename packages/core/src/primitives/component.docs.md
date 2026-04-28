# Component

## When to use

Use `Component` when UI needs explicit Effect requirements, parent-provided services, typed props, or local `Signal` state. It is the right surface for forms, service-backed pages, and trees where parents satisfy child requirements with `.provide(layer)`.

## Behavior

`Component.gen` runs once per component instance, yields props and services through Effect, and hands fine-grained updates off to `Signal` and the renderer instead of re-running the whole component body for every DOM change. Use `Signal.make` for local state, pass signals directly to JSX for surgical DOM updates, and call `Signal.get` only when the component must re-run for structural branching.

Type-safe forms keep raw input in signals and validate at boundaries. The simplest pattern validates only on submit with `Schema.decodeUnknownEffect`:

```tsx
import { Effect, Layer, Schema } from "effect";
import * as Context from "effect/Context";
import { Component, Signal } from "trygg";

const Signup = Schema.Struct({
  email: Schema.String,
  password: Schema.String,
});

type Signup = Schema.Schema.Type<typeof Signup>;

class SignupApi extends Context.Service<
  SignupApi,
  { readonly save: (payload: Signup) => Effect.Effect<void, Error> }
>()("example/SignupApi") {}

const SignupForm = Component.gen(function* () {
  const api = yield* SignupApi;
  const email = yield* Signal.make("");
  const password = yield* Signal.make("");
  const error = yield* Signal.make<string | null>(null);

  const onEmailInput = (event: Event) =>
    event.target instanceof HTMLInputElement ? Signal.set(email, event.target.value) : Effect.void;

  const onPasswordInput = (event: Event) =>
    event.target instanceof HTMLInputElement
      ? Signal.set(password, event.target.value)
      : Effect.void;

  const onSubmit = (event: Event) =>
    Effect.gen(function* () {
      event.preventDefault();

      const payload = yield* Schema.decodeUnknownEffect(Signup)({
        email: yield* Signal.get(email),
        password: yield* Signal.get(password),
      });

      yield* api.save(payload);
      yield* Signal.set(error, null);
    }).pipe(Effect.catch((cause) => Signal.set(error, String(cause))));

  return (
    <form onSubmit={onSubmit}>
      <input type="email" value={email} onInput={onEmailInput} />
      <input type="password" value={password} onInput={onPasswordInput} />
      <p>{error}</p>
      <button type="submit">Create account</button>
    </form>
  );
});
```

For richer UX, validate per-field with typed tagged errors and keep field-level error state in `Option` signals. Validation stays in Effect so errors are composable and testable:

```tsx
import { Data, Effect, Match, Option, Result } from "effect";

class EmailRequired extends Data.TaggedError("EmailRequired") {}
class EmailInvalid extends Data.TaggedError("EmailInvalid")<{ readonly email: string }>() {}
class PasswordTooShort extends Data.TaggedError("PasswordTooShort")<{ readonly min: number }>() {}

type FieldError = EmailRequired | EmailInvalid | PasswordTooShort;

const validateEmail = (raw: string): Effect.Effect<string, EmailRequired | EmailInvalid> =>
  raw.trim() === ""
    ? Effect.fail(new EmailRequired())
    : !raw.includes("@")
      ? Effect.fail(new EmailInvalid({ email: raw }))
      : Effect.succeed(raw);

const validatePassword = (raw: string): Effect.Effect<string, PasswordTooShort> =>
  raw.length < 8 ? Effect.fail(new PasswordTooShort({ min: 8 })) : Effect.succeed(raw);

const getFieldErrorMessage = Match.type<FieldError>().pipe(
  Match.tag("EmailRequired", () => "Email is required"),
  Match.tag("EmailInvalid", ({ email }) => `"${email}" is invalid`),
  Match.tag("PasswordTooShort", ({ min }) => `Must be at least ${min} characters`),
  Match.exhaustive,
);

const ValidatedForm = Component.gen(function* () {
  const email = yield* Signal.make("");
  const password = yield* Signal.make("");
  const emailError = yield* Signal.make<Option.Option<string>>(Option.none());
  const passwordError = yield* Signal.make<Option.Option<string>>(Option.none());

  const validateField = <E extends FieldError>(
    raw: string,
    validate: (raw: string) => Effect.Effect<string, E>,
    errorSignal: Signal.Signal<Option.Option<string>>,
  ) =>
    Effect.gen(function* () {
      const result = yield* validate(raw).pipe(Effect.result);
      if (Result.isFailure(result)) {
        yield* Signal.set(errorSignal, Option.some(getFieldErrorMessage(result.failure)));
      } else {
        yield* Signal.set(errorSignal, Option.none());
      }
    });

  const onBlurEmail = () =>
    Effect.gen(function* () {
      const raw = yield* Signal.get(email);
      yield* validateField(raw, validateEmail, emailError);
    });

  const onSubmit = (event: Event) =>
    Effect.gen(function* () {
      event.preventDefault();
      const [e, p] = yield* Effect.all([Signal.get(email), Signal.get(password)]);
      yield* Effect.all(
        [
          validateField(e, validateEmail, emailError),
          validateField(p, validatePassword, passwordError),
        ],
        { concurrency: 2 },
      );
    });

  return (
    <form onSubmit={onSubmit}>
      <input type="email" value={email} onBlur={onBlurEmail} />
      {Option.getOrElse(yield* Signal.get(emailError), () => "")}
      <input type="password" value={password} />
      {Option.getOrElse(yield* Signal.get(passwordError), () => "")}
      <button type="submit">Submit</button>
    </form>
  );
});
```

For dependency injection, children `yield*` services and parents decide where to provide them. Each `.provide(layer)` narrows the remaining `R`; by the time an app reaches `mount`, the root effect must have `R = never`.

Complex trees often need multiple interdependent services. Define services with `Context.Tag`, build layers that depend on other layers with `Layer.provideMerge`, and let the type system enforce that every requirement is satisfied before `mount`:

```tsx
import { Context, Effect, Layer, Schedule } from "effect";
import { Component, Signal } from "trygg";

class HttpClient extends Context.Tag("HttpClient")<
  HttpClient,
  { readonly request: (path: string) => Effect.Effect<string> }
>() {}

class UserRepository extends Context.Tag("UserRepository")<
  UserRepository,
  {
    readonly getUser: (id: string) => Effect.Effect<{ readonly id: string; readonly name: string }>;
  }
>() {}

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

const HttpClientLive = Layer.succeed(HttpClient, {
  request: (path) => Effect.succeed(`Response for ${path}`),
});

const UserProfile = Component.gen(function* (
  Props: ComponentProps<{ readonly userId: Signal.Signal<string> }>,
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
}).provide(UserRepositoryLive);
```

`App` has `R = never` because `UserRepositoryLive` satisfies `UserRepository`, and `UserRepositoryLive` itself is satisfied by `HttpClientLive`. If a layer were missing, the type error would point to the exact unsatisfied tag at the `mount` call.

## Related exports

- `Component`
- `Component.gen`
- `ComponentProps`
- `isEffectComponent`
