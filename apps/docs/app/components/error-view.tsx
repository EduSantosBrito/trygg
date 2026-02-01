import { Effect } from "effect";
import { Component, type ComponentProps } from "trygg";

export const ErrorView = Component.gen(function* (
  Props: ComponentProps<{
    error: unknown;
    onRetry?: Effect.Effect<void, never, unknown>;
  }>,
) {
  const { error, onRetry } = yield* Props;

  return (
    <div className="p-4 bg-red-50 border border-red-200 rounded-lg">
      <h3 className="m-0 mb-2 text-red-700">Error</h3>
      <p className="m-0 mb-3 text-sm text-red-600">
        {error instanceof Error ? error.message : "An error occurred"}
      </p>
      {onRetry && (
        <button
          className="px-4 py-2 text-sm bg-red-600 text-white rounded cursor-pointer transition-colors hover:bg-red-700"
          onClick={onRetry}
        >
          Retry
        </button>
      )}
    </div>
  );
});
