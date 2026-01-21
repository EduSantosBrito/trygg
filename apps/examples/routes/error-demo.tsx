/**
 * Error Demo Route
 *
 * This route intentionally throws an error to demonstrate
 * the _error.tsx error boundary functionality.
 */
import { Effect } from "effect";
import { Signal, Component } from "effect-ui";
import * as Router from "effect-ui/router";

const ErrorDemo = Component.gen(function* () {
  const shouldError = yield* Signal.make(false);

  // Read the signal value (subscribes to re-renders)
  const willError = yield* Signal.get(shouldError);

  // If willError is true, throw an error
  if (willError) {
    yield* Effect.fail(new Error("This is a demo error! The error boundary caught it."));
  }

  return (
    <div className="example-section">
      <h1>Error Boundary Demo</h1>
      <p>
        This page demonstrates the <code>_error.tsx</code> error boundary. Click the button below to
        trigger an error.
      </p>

      <div className="card" style={{ marginTop: "1rem" }}>
        <h3>Trigger an Error</h3>
        <p>
          When you click this button, the component will throw an error. The global{" "}
          <code>_error.tsx</code> will catch it and display an error page.
        </p>
        <button
          className="btn-primary"
          onClick={() => Signal.set(shouldError, true)}
          style={{ marginTop: "0.5rem" }}
        >
          Throw Error
        </button>
      </div>

      <div className="card" style={{ marginTop: "1rem" }}>
        <h3>How it works</h3>
        <ul style={{ marginTop: "0.5rem", paddingLeft: "1.5rem" }}>
          <li>
            <code>_error.tsx</code> in the routes directory catches route errors
          </li>
          <li>
            Use <code>Router.currentError</code> to access error details
          </li>
          <li>
            The <code>reset</code> effect can be used to retry the route
          </li>
          <li>Error boundaries are inherited - child routes use parent error boundaries</li>
        </ul>
      </div>

      <div style={{ marginTop: "1rem" }}>
        <Router.Link to="/" className="back-link">
          Back to Home
        </Router.Link>
      </div>
    </div>
  );
});

export default ErrorDemo;
