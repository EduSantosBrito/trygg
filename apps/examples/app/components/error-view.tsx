import { Effect } from "effect";
import { Component, type ComponentProps } from "effect-ui";

export const ErrorView = Component.gen(function* (
  Props: ComponentProps<{ error: Error; onRetry: Effect.Effect<void, never, unknown> }>,
) {
  const { error, onRetry } = yield* Props;
  return (
    <div className="p-3 rounded-md border border-red-200 bg-red-50 text-red-600">
      <strong>Error</strong>
      <p>{error.message}</p>
      <button
        className="px-4 py-2 text-base border border-gray-300 rounded bg-white cursor-pointer transition-colors hover:bg-gray-100"
        onClick={onRetry}
      >
        Try Again
      </button>
    </div>
  );
});
