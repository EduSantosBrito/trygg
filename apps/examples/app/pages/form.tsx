import { Data, Effect, Either, Layer, Match, Option } from "effect";
import { Signal, Component } from "trygg";
import { FormTheme } from "../services/form";
import { FormField } from "../components/form-field";
import { SuccessMessage } from "../components/form/success-message";

// Typed Validation Errors
class EmailRequired extends Data.TaggedError("EmailRequired") {}
class EmailInvalid extends Data.TaggedError("EmailInvalid")<{
  readonly email: string;
}> {}
class PasswordTooShort extends Data.TaggedError("PasswordTooShort")<{
  readonly minLength: number;
  readonly actualLength: number;
}> {}
class PasswordNoNumber extends Data.TaggedError("PasswordNoNumber") {}

type ValidationError = EmailRequired | EmailInvalid | PasswordTooShort | PasswordNoNumber;

const defaultFormTheme = Layer.succeed(FormTheme, {
  errorColor: "#dc3545",
  successColor: "#28a745",
  labelColor: "#333",
  inputBorder: "#ccc",
});

const validateEmail = (email: string): Effect.Effect<string, EmailRequired | EmailInvalid> => {
  if (email.trim() === "") {
    return Effect.fail(new EmailRequired());
  }
  if (!email.includes("@") || !email.includes(".")) {
    return Effect.fail(new EmailInvalid({ email }));
  }
  return Effect.succeed(email);
};

const validatePassword = (
  password: string,
): Effect.Effect<string, PasswordTooShort | PasswordNoNumber> => {
  if (password.length < 8) {
    return Effect.fail(new PasswordTooShort({ minLength: 8, actualLength: password.length }));
  }
  if (!/\d/.test(password)) {
    return Effect.fail(new PasswordNoNumber());
  }
  return Effect.succeed(password);
};

const getErrorMessage = Match.type<ValidationError>().pipe(
  Match.tag("EmailRequired", () => "Email is required"),
  Match.tag("EmailInvalid", ({ email }) => `"${email}" is not a valid email address`),
  Match.tag(
    "PasswordTooShort",
    ({ minLength, actualLength }) =>
      `Password must be at least ${minLength} characters (currently ${actualLength})`,
  ),
  Match.tag("PasswordNoNumber", () => "Password must contain at least one number"),
  Match.exhaustive,
);

const FormPage = Component.gen(function* () {
  const email = yield* Signal.make("");
  const password = yield* Signal.make("");

  const emailError = yield* Signal.make<Option.Option<string>>(Option.none());
  const passwordError = yield* Signal.make<Option.Option<string>>(Option.none());
  const submitted = yield* Signal.make(false);

  const emailErrorValue = yield* Signal.get(emailError);
  const passwordErrorValue = yield* Signal.get(passwordError);
  const submittedValue = yield* Signal.get(submitted);

  const emailValueForDisplay = submittedValue ? yield* Signal.get(email) : "";

  const onEmailChange = (e: Event) =>
    Effect.gen(function* () {
      const target = e.target;
      if (target instanceof HTMLInputElement) {
        yield* Signal.set(email, target.value);
        yield* Signal.set(emailError, Option.none());
      }
    });

  const onPasswordChange = (e: Event) =>
    Effect.gen(function* () {
      const target = e.target;
      if (target instanceof HTMLInputElement) {
        yield* Signal.set(password, target.value);
        yield* Signal.set(passwordError, Option.none());
      }
    });

  const onSubmit = (e: Event) =>
    Effect.gen(function* () {
      e.preventDefault();

      yield* Signal.set(submitted, false);
      yield* Signal.set(emailError, Option.none());
      yield* Signal.set(passwordError, Option.none());

      const currentEmail = yield* Signal.get(email);
      const currentPassword = yield* Signal.get(password);

      const emailResult = yield* validateEmail(currentEmail).pipe(Effect.either);
      if (Either.isLeft(emailResult)) {
        yield* Signal.set(emailError, Option.some(getErrorMessage(emailResult.left)));
        return;
      }

      const passwordResult = yield* validatePassword(currentPassword).pipe(Effect.either);
      if (Either.isLeft(passwordResult)) {
        yield* Signal.set(passwordError, Option.some(getErrorMessage(passwordResult.left)));
        return;
      }

      yield* Signal.set(submitted, true);
      yield* Effect.log(`Form submitted: email=${emailResult.right}`);
    });

  const resetForm = () =>
    Effect.gen(function* () {
      yield* Signal.set(email, "");
      yield* Signal.set(password, "");
      yield* Signal.set(submitted, false);
    });

  return Effect.gen(function* () {
    return (
      <div className="bg-white p-6 rounded-lg border border-gray-200">
        <h2 className="m-0 mb-1 text-2xl">Form Validation</h2>
        <p className="text-gray-500 m-0 mb-6 text-[0.95rem]">
          Typed errors, validation Effects, form state
        </p>

        {submittedValue ? (
          <SuccessMessage email={emailValueForDisplay} onReset={resetForm} />
        ) : (
          <form onSubmit={onSubmit}>
            <FormField
              label="Email"
              type="email"
              value={email}
              error={emailErrorValue}
              placeholder="Enter your email"
              onInput={onEmailChange}
            />

            <FormField
              label="Password"
              type="password"
              value={password}
              error={passwordErrorValue}
              placeholder="Enter your password"
              hint="Must be at least 8 characters with at least one number"
              onInput={onPasswordChange}
            />

            <button
              type="submit"
              className="px-4 py-2 text-base border border-blue-600 rounded bg-blue-600 text-white cursor-pointer transition-colors hover:bg-blue-700"
            >
              Submit
            </button>
          </form>
        )}
      </div>
    );
  }).pipe(Component.provide(defaultFormTheme));
});

export default FormPage;
