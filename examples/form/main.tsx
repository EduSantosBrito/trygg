/**
 * Form Validation Example
 *
 * Demonstrates:
 * - Component.gen for reusable form components
 * - Typed validation errors with Data.TaggedError
 * - Effect-based validation logic with services
 * - Form state with multiple signals
 * - Conditional error display
 * - DevMode for debug observability
 */
import { Context, Data, Effect, Either, Layer, Option } from "effect"
import { mount, Signal, DevMode, Component } from "effect-ui"

// =============================================================================
// Typed Validation Errors
// =============================================================================

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

// =============================================================================
// Form Theme Service
// =============================================================================

interface FormThemeConfig {
  readonly errorColor: string
  readonly successColor: string
  readonly labelColor: string
  readonly inputBorder: string
}

class FormTheme extends Context.Tag("FormTheme")<FormTheme, FormThemeConfig>() {}

const defaultFormTheme = Layer.succeed(FormTheme, {
  errorColor: "#dc3545",
  successColor: "#28a745",
  labelColor: "#333",
  inputBorder: "#ccc"
})

// =============================================================================
// Form Components using Component.gen
// =============================================================================

// FormField component with typed props and theme requirement
// TypeScript infers: { label: string, type: string, value: Signal<string>, error: Option<string>, ... , formTheme: Layer<FormTheme> }
const FormField = Component.gen<{
  label: string
  type: "text" | "email" | "password"
  value: Signal.Signal<string>
  error: Option.Option<string>
  placeholder: string
  hint?: string
  onInput: (e: Event) => Effect.Effect<void>
}>()(Props => function* () {
  const { label, type, value, error, placeholder, hint, onInput } = yield* Props
  const theme = yield* FormTheme
  
  return (
    <div className="form-group">
      <label style={{ color: theme.labelColor }}>{label}</label>
      <input
        type={type}
        value={value}
        onInput={onInput}
        placeholder={placeholder}
        style={{
          borderColor: Option.isSome(error) ? theme.errorColor : theme.inputBorder
        }}
      />
      {Option.isSome(error) && (
        <div className="error" style={{ color: theme.errorColor }}>
          {error.value}
        </div>
      )}
      {hint && (
        <small style={{ color: "#666" }}>{hint}</small>
      )}
    </div>
  )
})

// SuccessMessage component
const SuccessMessage = Component.gen<{
  email: string
  onReset: () => Effect.Effect<void>
}>()(Props => function* () {
  const { email, onReset } = yield* Props
  const theme = yield* FormTheme
  
  return (
    <div className="success" style={{ color: theme.successColor }}>
      <h2>Success!</h2>
      <p>Form submitted successfully with email: {email}</p>
      <button onClick={onReset}>Reset Form</button>
    </div>
  )
})

// =============================================================================
// Validation Logic
// =============================================================================

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

// =============================================================================
// Main Form Component
// =============================================================================

const FormApp = Component.gen(function* () {
  // Input signals - passed directly to inputs for fine-grained updates
  const email = yield* Signal.make("")
  const password = yield* Signal.make("")
  
  // UI state signals - read with Signal.get() for conditional rendering
  const emailError = yield* Signal.make<Option.Option<string>>(Option.none())
  const passwordError = yield* Signal.make<Option.Option<string>>(Option.none())
  const submitted = yield* Signal.make(false)

  // Read signals that control conditional rendering
  const emailErrorValue = yield* Signal.get(emailError)
  const passwordErrorValue = yield* Signal.get(passwordError)
  const submittedValue = yield* Signal.get(submitted)
  
  // For success message display
  const emailValueForDisplay = submittedValue ? yield* Signal.get(email) : ""

  // Handle input changes
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
      
      yield* Signal.set(submitted, false)
      yield* Signal.set(emailError, Option.none())
      yield* Signal.set(passwordError, Option.none())

      const currentEmail = yield* Signal.get(email)
      const currentPassword = yield* Signal.get(password)

      const emailResult = yield* validateEmail(currentEmail).pipe(Effect.either)
      if (Either.isLeft(emailResult)) {
        yield* Signal.set(emailError, Option.some(getErrorMessage(emailResult.left)))
        return
      }

      const passwordResult = yield* validatePassword(currentPassword).pipe(Effect.either)
      if (Either.isLeft(passwordResult)) {
        yield* Signal.set(passwordError, Option.some(getErrorMessage(passwordResult.left)))
        return
      }

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
        <SuccessMessage 
          email={emailValueForDisplay} 
          onReset={resetForm}
          formTheme={defaultFormTheme}
        />
      ) : (
        <form onSubmit={onSubmit}>
          <FormField
            label="Email"
            type="email"
            value={email}
            error={emailErrorValue}
            placeholder="Enter your email"
            onInput={onEmailChange}
            formTheme={defaultFormTheme}
          />

          <FormField
            label="Password"
            type="password"
            value={password}
            error={passwordErrorValue}
            placeholder="Enter your password"
            hint="Must be at least 8 characters with at least one number"
            onInput={onPasswordChange}
            formTheme={defaultFormTheme}
          />

          <button type="submit" className="primary">
            Submit
          </button>
        </form>
      )}

      <div style={{ marginTop: "1.5rem", padding: "1rem", background: "#f5f5f5", borderRadius: "8px" }}>
        <h3 style={{ marginTop: 0 }}>Component.gen for Forms</h3>
        <pre style={{ background: "#fff", padding: "0.5rem", borderRadius: "4px", overflow: "auto", fontSize: "0.85rem" }}>{`// Reusable form field with theme service
const FormField = Component.gen<{
  label: string
  value: Signal<string>
  error: Option<string>
}>()(Props => function* () {
  const { label, value, error } = yield* Props
  const theme = yield* FormTheme  // Service requirement
  
  return (
    <div className="form-group">
      <label style={{ color: theme.labelColor }}>{label}</label>
      <input value={value} style={{
        borderColor: Option.isSome(error) 
          ? theme.errorColor 
          : theme.inputBorder
      }} />
    </div>
  )
})

// TypeScript infers: { label, value, error, formTheme: Layer<FormTheme> }
<FormField 
  label="Email" 
  value={email} 
  error={emailError}
  formTheme={formThemeLayer}
/>`}</pre>
      </div>
    </div>
  )
})

// Mount the app with DevMode
const container = document.getElementById("root")
if (container) {
  mount(container, <>
    <FormApp />
    <DevMode />
  </>)
}
