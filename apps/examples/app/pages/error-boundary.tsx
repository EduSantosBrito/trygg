import { Effect, Layer, Match } from "effect";
import { Signal, ErrorBoundary, Component } from "trygg";
import { ErrorTheme } from "../services/error-boundary";
import { NetworkErrorDisplay } from "../components/error-boundary/network-error-display";
import { ValidationErrorDisplay } from "../components/error-boundary/validation-error-display";
import { UnknownErrorDisplay } from "../components/error-boundary/unknown-error-display";
import { RiskyComponent, type AppError } from "../components/error-boundary/risky-component";
import { TriggerButton } from "../components/error-boundary/trigger-button";

const defaultErrorTheme = Layer.succeed(ErrorTheme, {
  errorBackground: "#ffebee",
  errorText: "#c62828",
  successBackground: "#e8f5e9",
  successText: "#2e7d32",
});

const renderError = Match.type<AppError>().pipe(
  Match.tag("NetworkError", (error) => <NetworkErrorDisplay error={error} />),
  Match.tag("ValidationError", (error) => <ValidationErrorDisplay error={error} />),
  Match.tag("UnknownError", (error) => <UnknownErrorDisplay error={error} />),
  Match.exhaustive,
);

const ErrorBoundaryPage = Component.gen(function* () {
  const errorType = yield* Signal.make<"network" | "validation" | "unknown" | "none">("none");

  const errorTypeValue = yield* Signal.get(errorType);

  const triggerError = (type: "network" | "validation" | "unknown" | "none") =>
    Signal.set(errorType, type);

  return Effect.gen(function* () {
    return (
      <div className="bg-white p-6 rounded-lg border border-gray-200">
        <h2 className="m-0 mb-1 text-2xl">Error Boundary</h2>
        <p className="text-gray-500 m-0 mb-6 text-[0.95rem]">
          Typed error handling, Cause inspection, recovery UI
        </p>

        <div className="mb-4">
          <p>Click a button to trigger different error types:</p>
          <div className="flex gap-2 flex-wrap">
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

        <div className="mt-6">
          <h3>Result:</h3>
          {ErrorBoundary({
            children: <RiskyComponent shouldFail={errorTypeValue} />,
            fallback: renderError,
            onError: (error) => Effect.log(`Caught error: ${error._tag}`),
          })}
        </div>
      </div>
    );
  }).pipe(Component.provide(defaultErrorTheme));
});

export default ErrorBoundaryPage;
