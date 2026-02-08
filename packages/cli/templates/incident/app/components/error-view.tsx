import { Effect } from "effect";
import { Component, type ComponentProps } from "trygg";
import { IncidentNotFound, InvalidTransition } from "../errors/incidents";

/**
 * Extracts error info for display
 */
const getErrorInfo = (error: unknown): { title: string; message: string } => {
  if (error instanceof IncidentNotFound) {
    return { title: "Not Found", message: `Incident #${String(error.id)} does not exist.` };
  }
  if (error instanceof InvalidTransition) {
    return {
      title: "Invalid Transition",
      message: `Cannot transition from ${error.from} to ${error.to}.`,
    };
  }
  if (error instanceof Error) {
    return { title: "Error", message: error.message };
  }
  return { title: "Error", message: "An unexpected error occurred." };
};

export const ErrorView = Component.gen(function* (
  Props: ComponentProps<{
    error: unknown;
    onRetry?: Effect.Effect<void, never, unknown>;
  }>,
) {
  const { error, onRetry } = yield* Props;
  const { title, message } = getErrorInfo(error);

  return (
    <div className="error-view" role="alert">
      <h3 className="error-view__title">{title}</h3>
      <p className="error-view__message">{message}</p>
      {onRetry && (
        <div className="error-view__actions">
          <button type="button" className="btn btn--secondary btn--sm" onClick={onRetry}>
            Retry
          </button>
        </div>
      )}
    </div>
  );
});
