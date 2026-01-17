/**
 * Error Boundary Example
 *
 * Demonstrates:
 * - ErrorBoundary component for catching errors
 * - Typed errors with Data.TaggedError
 * - Error inspection in fallback UI
 * - Recovery patterns
 * - DevMode for debug observability
 */
import { Data, Effect } from "effect"
import { mount, Signal, ErrorBoundary, DevMode } from "effect-ui"

// Define typed errors
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

// Simulate a component that might fail
const RiskyComponent = Effect.fn("RiskyComponent")(function* (
  shouldFail: "network" | "validation" | "unknown" | "none"
) {
  // Simulate different error conditions
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

  // Success case
  return (
    <div style={{ padding: "1rem", background: "#e8f5e9", borderRadius: "8px" }}>
      <h3 style={{ marginTop: 0, color: "#2e7d32" }}>Success!</h3>
      <p>The component rendered without errors.</p>
    </div>
  )
})

// Render error details based on error type
const renderError = (error: AppError) => {
  switch (error._tag) {
    case "NetworkError":
      return (
        <div className="error-display">
          <h3 style={{ marginTop: 0 }}>Network Error</h3>
          <p>Failed to fetch from <code>{error.url}</code></p>
          <p>Status: <strong>{error.status}</strong></p>
        </div>
      )

    case "ValidationError":
      return (
        <div className="error-display">
          <h3 style={{ marginTop: 0 }}>Validation Error</h3>
          <p>Field: <code>{error.field}</code></p>
          <p>Message: {error.message}</p>
        </div>
      )

    case "UnknownError":
      return (
        <div className="error-display">
          <h3 style={{ marginTop: 0 }}>Unknown Error</h3>
          <pre>{String(error.cause)}</pre>
        </div>
      )
  }
}

// Main app component
const ErrorBoundaryApp = Effect.gen(function* () {
  const errorType = yield* Signal.make<"network" | "validation" | "unknown" | "none">("none")
  const key = yield* Signal.make(0)

  // Get current values for rendering
  const errorTypeValue = yield* Signal.get(errorType)

  const triggerError = (type: "network" | "validation" | "unknown" | "none") =>
    Effect.gen(function* () {
      yield* Signal.set(errorType, type)
      yield* Signal.update(key, (k) => k + 1)
    })

  return (
    <div className="example">
      <div style={{ marginBottom: "1rem" }}>
        <p>Click a button to trigger different error types:</p>
        <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap" }}>
          <button onClick={() => triggerError("none")}>
            No Error
          </button>
          <button className="danger" onClick={() => triggerError("network")}>
            Network Error
          </button>
          <button className="danger" onClick={() => triggerError("validation")}>
            Validation Error
          </button>
          <button className="danger" onClick={() => triggerError("unknown")}>
            Unknown Error
          </button>
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

      <div style={{ marginTop: "1.5rem", padding: "1rem", background: "#f5f5f5", borderRadius: "8px" }}>
        <h3 style={{ marginTop: 0 }}>How it works</h3>
        <pre style={{ background: "#fff", padding: "0.5rem", borderRadius: "4px", overflow: "auto", fontSize: "0.85rem" }}>{`// Define typed errors
class NetworkError extends Data.TaggedError("NetworkError")<{
  readonly url: string
  readonly status: number
}> {}

// Component that may fail
const RiskyComponent = Effect.gen(function* () {
  if (shouldFail) {
    return yield* Effect.fail(
      new NetworkError({ url: "/api", status: 500 })
    )
  }
  return <div>Success!</div>
})

// Wrap with ErrorBoundary
ErrorBoundary({
  children: RiskyComponent,
  fallback: (error) => {
    // Pattern match on error type!
    switch (error._tag) {
      case "NetworkError":
        return <div>Network failed: {error.status}</div>
      case "ValidationError":
        return <div>Invalid: {error.message}</div>
    }
  },
  onError: (e) => Effect.log(\`Error: \${e._tag}\`)
})`}</pre>
      </div>
    </div>
  )
})

// Mount the app with DevMode for debug observability
const container = document.getElementById("root")
if (container) {
  mount(container, <>
    {ErrorBoundaryApp}
    <DevMode />
  </>)
}
