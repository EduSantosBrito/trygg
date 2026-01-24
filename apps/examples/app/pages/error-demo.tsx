import { Effect } from "effect";
import { Signal, Component } from "trygg";
import * as Router from "trygg/router";

const ErrorDemoPage = Component.gen(function* () {
  const shouldError = yield* Signal.make(false);
  const willError = yield* Signal.get(shouldError);

  if (willError) {
    yield* Effect.fail(new Error("This is a demo error! The error boundary caught it."));
  }

  return (
    <div className="bg-white p-6 rounded-lg border border-gray-200">
      <h1 className="m-0 mb-1 text-2xl">Error Boundary Demo</h1>
      <p className="text-gray-500 m-0 mb-6 text-[0.95rem]">
        This page demonstrates the error boundary. Click the button below to trigger an error.
      </p>

      <div className="bg-gray-50 p-4 rounded-lg mt-4">
        <h3 className="mt-0 mb-2 text-lg">Trigger an Error</h3>
        <p>
          When you click this button, the component will throw an error. The global error boundary
          will catch it and display an error page.
        </p>
        <button
          className="px-4 py-2 text-base border border-blue-600 rounded bg-blue-600 text-white cursor-pointer transition-colors hover:bg-blue-700 mt-2"
          onClick={() => Signal.set(shouldError, true)}
        >
          Throw Error
        </button>
      </div>

      <div className="bg-gray-50 p-4 rounded-lg mt-4">
        <h3 className="mt-0 mb-2 text-lg">How it works</h3>
        <ul className="mt-2 pl-6">
          <li>Error boundaries catch route errors</li>
          <li>
            Use <code>Router.currentError</code> to access error details
          </li>
          <li>
            The <code>reset</code> effect can be used to retry the route
          </li>
          <li>Error boundaries are inherited - child routes use parent error boundaries</li>
        </ul>
      </div>

      <div className="mt-4">
        <Router.Link
          to="/"
          className="inline-block mb-4 text-gray-500 no-underline hover:text-blue-600"
        >
          Back to Home
        </Router.Link>
      </div>
    </div>
  );
});

export default ErrorDemoPage;
