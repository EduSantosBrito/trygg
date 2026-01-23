import { Cause } from "effect";
import { Component } from "effect-ui";
import * as Router from "effect-ui/router";

export const ErrorFallback = Component.gen(function* () {
  const { cause, path, reset } = yield* Router.currentError;

  const error = Cause.squash(cause);
  const errorMessage = error instanceof Error ? error.message : String(error);

  return (
    <div className="max-w-[600px] mx-auto mt-16 p-8 bg-white border border-gray-200 rounded-lg text-center">
      <h1 className="text-red-600 m-0 mb-4">Something went wrong</h1>
      <p className="text-gray-500 text-sm mb-4">Error on route: {path}</p>
      <pre className="bg-red-50 border border-red-200 p-4 rounded text-red-600 font-mono text-sm text-left overflow-x-auto mb-6">
        {errorMessage}
      </pre>
      <button
        className="bg-blue-600 border-blue-600 text-white py-3 px-6 text-base mr-4 rounded cursor-pointer hover:bg-blue-700"
        onClick={reset}
      >
        Try Again
      </button>
      <Router.Link to="/" className="text-gray-500 no-underline hover:text-blue-600">
        Go Home
      </Router.Link>
    </div>
  );
});
