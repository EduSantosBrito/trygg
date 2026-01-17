/**
 * Form Validation Example
 *
 * Demonstrates:
 * - Typed validation errors with Data.TaggedError
 * - Effect-based validation logic
 * - Form state with multiple signals
 * - Conditional error display
 * - DevMode for debug observability
 */
import { Data, Effect, Either, Option } from "effect"
import { mount, Signal, DevMode } from "effect-ui"

// Define typed validation errors using Data.TaggedError
class EmailRequired extends Data.TaggedError("EmailRequired") {}
class EmailInvalid extends Data.TaggedError("EmailInvalid")<{
  readonly email: string
}> {}
class PasswordTooShort extends Data.TaggedError("PasswordTooShort")<{
  readonly minLength: number
  readonly actualLength: number
}> {}
class PasswordNoNumber extends Data.TaggedError("PasswordNoNumber") {}

type ValidationError =
  | EmailRequired
  | EmailInvalid
  | PasswordTooShort
  | PasswordNoNumber

// Validation functions that return Effects
const validateEmail = (email: string): Effect.Effect<string, EmailRequired | EmailInvalid> => {
  if (email.trim() === "") {
    return Effect.fail(new EmailRequired())
  }
  if (!email.includes("@") || !email.includes(".")) {
    return Effect.fail(new EmailInvalid({ email }))
  }
  return Effect.succeed(email)
}

const validatePassword = (password: string): Effect.Effect<string, PasswordTooShort | PasswordNoNumber> => {
  if (password.length < 8) {
    return Effect.fail(new PasswordTooShort({ minLength: 8, actualLength: password.length }))
  }
  if (!/\d/.test(password)) {
    return Effect.fail(new PasswordNoNumber())
  }
  return Effect.succeed(password)
}

// Helper to get error message from ValidationError
const getErrorMessage = (error: ValidationError): string => {
  switch (error._tag) {
    case "EmailRequired":
      return "Email is required"
    case "EmailInvalid":
      return `"${error.email}" is not a valid email address`
    case "PasswordTooShort":
      return `Password must be at least ${error.minLength} characters (currently ${error.actualLength})`
    case "PasswordNoNumber":
      return "Password must contain at least one number"
  }
}

// Main form component
const FormApp = Effect.gen(function* () {
  // Input signals - passed directly to inputs for fine-grained updates (no re-render on typing!)
  const email = yield* Signal.make("")
  const password = yield* Signal.make("")
  
  // UI state signals - read with Signal.get() because they control conditional rendering
  const emailError = yield* Signal.make<Option.Option<string>>(Option.none())
  const passwordError = yield* Signal.make<Option.Option<string>>(Option.none())
  const submitted = yield* Signal.make(false)

  // Only read signals that control conditional rendering
  // email/password are NOT read here - passed directly to inputs for fine-grained updates
  const emailErrorValue = yield* Signal.get(emailError)
  const passwordErrorValue = yield* Signal.get(passwordError)
  const submittedValue = yield* Signal.get(submitted)
  
  // For success message display, we need the email value
  const emailValueForDisplay = submittedValue ? yield* Signal.get(email) : ""

  // Handle input changes
  // Equality checks in Signal.set prevent unnecessary re-renders when setting Option.none()
  const onEmailChange = (e: Event) =>
    Effect.gen(function* () {
      const target = e.target
      if (target instanceof HTMLInputElement) {
        yield* Signal.set(email, target.value)
        yield* Signal.set(emailError, Option.none())
      }
    })

  const onPasswordChange = (e: Event) =>
    Effect.gen(function* () {
      const target = e.target
      if (target instanceof HTMLInputElement) {
        yield* Signal.set(password, target.value)
        yield* Signal.set(passwordError, Option.none())
      }
    })

  // Validate and submit
  const onSubmit = (e: Event) =>
    Effect.gen(function* () {
      e.preventDefault()
      
      // Reset state
      yield* Signal.set(submitted, false)
      yield* Signal.set(emailError, Option.none())
      yield* Signal.set(passwordError, Option.none())

      // Get current values
      const currentEmail = yield* Signal.get(email)
      const currentPassword = yield* Signal.get(password)

      // Validate email
      const emailResult = yield* validateEmail(currentEmail).pipe(Effect.either)
      if (Either.isLeft(emailResult)) {
        yield* Signal.set(emailError, Option.some(getErrorMessage(emailResult.left)))
        return
      }

      // Validate password
      const passwordResult = yield* validatePassword(currentPassword).pipe(Effect.either)
      if (Either.isLeft(passwordResult)) {
        yield* Signal.set(passwordError, Option.some(getErrorMessage(passwordResult.left)))
        return
      }

      // Success!
      yield* Signal.set(submitted, true)
      yield* Effect.log(`Form submitted: email=${emailResult.right}`)
    })

  const resetForm = () =>
    Effect.gen(function* () {
      yield* Signal.set(email, "")
      yield* Signal.set(password, "")
      yield* Signal.set(submitted, false)
    })

  return (
    <div className="example">
      {submittedValue ? (
        <div className="success">
          <h2>Success!</h2>
          <p>Form submitted successfully with email: {emailValueForDisplay}</p>
          <button onClick={resetForm}>
            Reset Form
          </button>
        </div>
      ) : (
        <form onSubmit={onSubmit}>
          <div className="form-group">
            <label>Email</label>
            <input
              type="email"
              value={email}
              onInput={onEmailChange}
              placeholder="Enter your email"
            />
            {Option.isSome(emailErrorValue) && (
              <div className="error">{emailErrorValue.value}</div>
            )}
          </div>

          <div className="form-group">
            <label>Password</label>
            <input
              type="password"
              value={password}
              onInput={onPasswordChange}
              placeholder="Enter your password"
            />
            {Option.isSome(passwordErrorValue) && (
              <div className="error">{passwordErrorValue.value}</div>
            )}
            <small style={{ color: "#666" }}>
              Must be at least 8 characters with at least one number
            </small>
          </div>

          <button type="submit" className="primary">
            Submit
          </button>
        </form>
      )}

      <div style={{ marginTop: "1.5rem", padding: "1rem", background: "#f5f5f5", borderRadius: "8px" }}>
        <h3 style={{ marginTop: 0 }}>Typed Errors</h3>
        <pre style={{ background: "#fff", padding: "0.5rem", borderRadius: "4px", overflow: "auto", fontSize: "0.85rem" }}>{`// Define typed errors
class EmailInvalid extends Data.TaggedError("EmailInvalid")<{
  readonly email: string
}> {}

// Validation returns Effect with typed error
const validateEmail = (email: string): 
  Effect<string, EmailRequired | EmailInvalid> => {
  if (!email.includes("@")) {
    return Effect.fail(new EmailInvalid({ email }))
  }
  return Effect.succeed(email)
}`}</pre>
      </div>
    </div>
  )
})

// Mount the app with DevMode for debug observability
const container = document.getElementById("root")
if (container) {
  mount(container, <>
    {FormApp}
    <DevMode />
  </>)
}
