/**
 * Global Error Boundary
 * 
 * This component is displayed when any route throws an error.
 * Uses Router.useRouteError() to access error details.
 */
import { Effect } from "effect"
import * as Router from "effect-ui/router"

const ErrorPage = Effect.gen(function* () {
  const { error, path, reset } = yield* Router.useRouteError()
  
  const errorMessage = error instanceof Error 
    ? error.message 
    : String(error)
  
  return (
    <div className="error-container">
      <h1>Something went wrong</h1>
      <p className="error-path">Error on route: {path}</p>
      <pre className="error-message">{errorMessage}</pre>
      <button 
        className="error-retry-btn"
        onClick={() => reset}
      >
        Try Again
      </button>
      <Router.Link to="/" className="error-home-link">
        Go Home
      </Router.Link>
    </div>
  )
})

export default ErrorPage
