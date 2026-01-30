import { Layer } from "effect";
import { Signal, ErrorBoundary, Component } from "trygg";
import { ErrorTheme } from "../services/error-boundary";
import {
  NetworkError,
  NetworkErrorDisplay,
} from "../components/error-boundary/network-error-display";
import {
  ValidationError,
  ValidationErrorDisplay,
} from "../components/error-boundary/validation-error-display";
import {
  UnknownError,
  UnknownErrorDisplay,
} from "../components/error-boundary/unknown-error-display";
import { RiskyComponent } from "../components/error-boundary/risky-component";
import { TriggerButton } from "../components/error-boundary/trigger-button";
import { Cause } from "effect";

const defaultErrorTheme = Layer.succeed(ErrorTheme, {
  errorBackground: "#ffebee",
  errorText: "#c62828",
  successBackground: "#e8f5e9",
  successText: "#2e7d32",
});

const ErrorBoundaryPage = Component.gen(function* () {
  const errorType = yield* Signal.make<"network" | "validation" | "unknown" | "none">("none");

  const triggerError = (type: "network" | "validation" | "unknown" | "none") =>
    Signal.set(errorType, type);

  // Create error-boundary-wrapped component with specific handlers + catchAll
  const SafeRiskyComponent = yield* ErrorBoundary.catch(RiskyComponent)
    .on("NetworkError", (cause) => {
      const error = Cause.squash(cause) as NetworkError;
      return <NetworkErrorDisplay error={error} />;
    })
    .on("ValidationError", (cause) => {
      const error = Cause.squash(cause) as ValidationError;
      return <ValidationErrorDisplay error={error} />;
    })
    .on("UnknownError", (cause) => {
      const error = Cause.squash(cause) as UnknownError;
      return <UnknownErrorDisplay error={error} />;
    })
    .catchAll((cause) => {
      // Fallback for any other errors
      const error = Cause.squash(cause);
      return (
        <div className="p-4 rounded bg-red-100 text-red-800">
          <h3 className="mt-0">Unexpected Error</h3>
          <pre>{String(error)}</pre>
        </div>
      );
    });

  return (
    <div className="bg-white p-6 rounded-lg border border-gray-200">
      <h2 className="m-0 mb-1 text-2xl">Error Boundary</h2>
      <p className="text-gray-500 m-0 mb-6 text-[0.95rem]">
        Typed error handling, Cause inspection, recovery UI
      </p>

      <div className="mb-4">
        <p>Click a button to trigger different error types:</p>
        <div className="flex gap-2 flex-wrap">
          <TriggerButton label="No Error" variant="default" onClick={() => triggerError("none")} />
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
        <SafeRiskyComponent shouldFail={errorType} />
      </div>
    </div>
  );
}).provide(defaultErrorTheme);

export default ErrorBoundaryPage;
