import { Effect } from "effect";
import { Component, Resource, Signal, type ComponentProps } from "trygg";
import type { ApiClient } from "trygg/api";
import { IncidentNotFound, InvalidTransition } from "../errors/incidents";

/**
 * Extracts error info for display
 */
const getErrorInfo = (error: unknown): Effect.Effect<{ title: string; message: string }> =>
  Effect.sync(() => {
    if (error instanceof IncidentNotFound) {
      return { title: "Not Found", message: `Incident #${String(error.id)} does not exist.` };
    }
    if (error instanceof InvalidTransition) {
      return {
        title: "Invalid Transition",
        message: `Cannot transition from ${error.from} to ${error.to}.`,
      };
    }
    return { title: "Error", message: "An unexpected error occurred." };
  });

interface ErrorViewProps {
  readonly error: unknown;
  readonly onRetry?: () => Effect.Effect<
    void,
    Signal.SignalScopeError | Resource.ResourceRegistrySaturatedError,
    ApiClient | Resource.ResourceRegistryTag
  >;
}

export const ErrorView = Component.gen(function* (Props: ComponentProps<ErrorViewProps>) {
  const { error, onRetry } = yield* Props;
  const { title, message } = yield* getErrorInfo(error);
  const retry =
    onRetry === undefined
      ? undefined
      : () =>
          onRetry().pipe(
            Effect.catch((cause) =>
              Effect.logWarning("Retry failed").pipe(Effect.annotateLogs("error", cause)),
            ),
          );

  return (
    <div className="error-view" role="alert">
      <h3 className="error-view__title">{title}</h3>
      <p className="error-view__message">{message}</p>
      {retry && (
        <div className="error-view__actions">
          <button type="button" className="btn btn--secondary btn--sm" onClick={retry}>
            Retry
          </button>
        </div>
      )}
    </div>
  );
});
