/**
 * Error Boundary Example
 *
 * Demonstrates:
 * - Component.gen for error display components
 * - ErrorBoundary component for catching errors
 * - Typed errors with Data.TaggedError
 * - Error inspection in fallback UI
 * - Recovery patterns
 */
import { Context, Data, Effect, Layer } from "effect"
import { Signal, ErrorBoundary, Component, type ComponentProps } from "effect-ui"

// =============================================================================
// Typed Errors
// =============================================================================

class NetworkError extends Data.TaggedError("NetworkError")<{
  readonly url: string
  readonly status: number
}> {}

class ValidationError extends Data.TaggedError("ValidationError")<{
  readonly field: string
  readonly message: string
}> {}

class UnknownError extends Data.TaggedError("UnknownError")<{
  readonly cause: unknown
}> {}

type AppError = NetworkError | ValidationError | UnknownError

// =============================================================================
// Error Display Theme Service
// =============================================================================

interface ErrorThemeConfig {
  readonly errorBackground: string
  readonly errorText: string
  readonly successBackground: string
  readonly successText: string
}

class ErrorTheme extends Context.Tag("ErrorTheme")<ErrorTheme, ErrorThemeConfig>() {}

const defaultErrorTheme = Layer.succeed(ErrorTheme, {
  errorBackground: "#ffebee",
  errorText: "#c62828",
  successBackground: "#e8f5e9",
  successText: "#2e7d32"
})

// =============================================================================
// Error Display Components using Component.gen
// =============================================================================

// NetworkErrorDisplay component
const NetworkErrorDisplay = Component.gen(function* (Props: ComponentProps<{
  error: NetworkError
}>) {
  const { error } = yield* Props
  const theme = yield* ErrorTheme

  return (
    <div className="error-display" style={{ background: theme.errorBackground, color: theme.errorText }}>
      <h3 style={{ marginTop: 0 }}>Network Error</h3>
      <p>Failed to fetch from <code>{error.url}</code></p>
      <p>Status: <strong>{error.status}</strong></p>
    </div>
  )
})

// ValidationErrorDisplay component
const ValidationErrorDisplay = Component.gen(function* (Props: ComponentProps<{
  error: ValidationError
}>) {
  const { error } = yield* Props
  const theme = yield* ErrorTheme

  return (
    <div className="error-display" style={{ background: theme.errorBackground, color: theme.errorText }}>
      <h3 style={{ marginTop: 0 }}>Validation Error</h3>
      <p>Field: <code>{error.field}</code></p>
      <p>Message: {error.message}</p>
    </div>
  )
})

// UnknownErrorDisplay component
const UnknownErrorDisplay = Component.gen(function* (Props: ComponentProps<{
  error: UnknownError
}>) {
  const { error } = yield* Props
  const theme = yield* ErrorTheme

  return (
    <div className="error-display" style={{ background: theme.errorBackground, color: theme.errorText }}>
      <h3 style={{ marginTop: 0 }}>Unknown Error</h3>
      <pre>{String(error.cause)}</pre>
    </div>
  )
})

// Success display component
const SuccessDisplay = Component.gen(function* () {
  const theme = yield* ErrorTheme

  return (
    <div style={{ padding: "1rem", background: theme.successBackground, borderRadius: "8px" }}>
      <h3 style={{ marginTop: 0, color: theme.successText }}>Success!</h3>
      <p style={{ color: theme.successText }}>The component rendered without errors.</p>
    </div>
  )
})

// =============================================================================
// Risky Component
// =============================================================================

const RiskyComponent = Effect.fn("RiskyComponent")(function* (
  shouldFail: "network" | "validation" | "unknown" | "none"
) {
  if (shouldFail === "network") {
    return yield* Effect.fail(
      new NetworkError({ url: "/api/data", status: 500 })
    )
  }

  if (shouldFail === "validation") {
    return yield* Effect.fail(
      new ValidationError({ field: "email", message: "Invalid format" })
    )
  }

  if (shouldFail === "unknown") {
    return yield* Effect.fail(
      new UnknownError({ cause: new Error("Something unexpected happened") })
    )
  }

  // Success - use the SuccessDisplay component
  return <SuccessDisplay />
})

// =============================================================================
// Error Renderer using Component.gen components
// =============================================================================

const renderError = (error: AppError) => {
  switch (error._tag) {
    case "NetworkError":
      return <NetworkErrorDisplay error={error} />
    case "ValidationError":
      return <ValidationErrorDisplay error={error} />
    case "UnknownError":
      return <UnknownErrorDisplay error={error} />
  }
}

// =============================================================================
// Trigger Button Component
// =============================================================================

const TriggerButton = Component.gen(function* (Props: ComponentProps<{
  label: string
  variant: "default" | "danger"
  onClick: () => Effect.Effect<void>
}>) {
  const { label, variant, onClick } = yield* Props
  const theme = yield* ErrorTheme

  return (
    <button
      className={variant === "danger" ? "danger" : ""}
      style={variant === "danger"
        ? { background: theme.errorText, color: "white" }
        : {}}
      onClick={onClick}
    >
      {label}
    </button>
  )
})

// =============================================================================
// Main App
// =============================================================================

const ErrorBoundaryApp = Component.gen(function* () {
  const errorType = yield* Signal.make<"network" | "validation" | "unknown" | "none">("none")

  const errorTypeValue = yield* Signal.get(errorType)

  const triggerError = (type: "network" | "validation" | "unknown" | "none") =>
    Signal.set(errorType, type)

  return Effect.gen(function* () {
    return (
      <div className="example">
        <h2>Error Boundary</h2>
        <p className="description">Typed error handling, Cause inspection, recovery UI</p>
        
        <div style={{ marginBottom: "1rem" }}>
          <p>Click a button to trigger different error types:</p>
          <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap" }}>
            <TriggerButton
              label="No Error"
              variant="default"
              onClick={() => triggerError("none")}
            />
            <TriggerButton
              label="Network Error"
              variant="danger"
              onClick={() => triggerError("network")}
            />
            <TriggerButton
              label="Validation Error"
              variant="danger"
              onClick={() => triggerError("validation")}
            />
            <TriggerButton
              label="Unknown Error"
              variant="danger"
              onClick={() => triggerError("unknown")}
            />
          </div>
        </div>

        <div style={{ marginTop: "1.5rem" }}>
          <h3>Result:</h3>
          {ErrorBoundary({
            children: RiskyComponent(errorTypeValue),
            fallback: renderError,
            onError: (error) =>
              Effect.log(`Caught error: ${error._tag}`)
          })}
        </div>

        <div className="code-example">
          <h3>ErrorBoundary with Typed Errors</h3>
          <pre>{`// Define typed errors
 class NetworkError extends Data.TaggedError("NetworkError")<{
   url: string
   status: number
 }> {}
 
 // Component that might fail
 const RiskyComponent = Effect.fn("RiskyComponent")(function* (shouldFail) {
   if (shouldFail) {
     return yield* Effect.fail(new NetworkError({ url: "/api", status: 500 }))
   }
   return <SuccessDisplay />
 })
 
 // ErrorBoundary with typed fallback
 ErrorBoundary({
   children: RiskyComponent(shouldFail),
   fallback: (error) => {
     switch (error._tag) {
       case "NetworkError":
         return <NetworkErrorDisplay error={error} />
       case "ValidationError":
         return <ValidationErrorDisplay error={error} />
     }
   },
   onError: (error) => Effect.log(\`Caught: \${error._tag}\`)
 })`}</pre>
        </div>
      </div>
    )
  }).pipe(Component.provide(defaultErrorTheme))
})

export default ErrorBoundaryApp
