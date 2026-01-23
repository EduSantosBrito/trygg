import { Component } from "effect-ui";
import { ErrorTheme } from "../../services/error-boundary";

export const SuccessDisplay = Component.gen(function* () {
  const theme = yield* ErrorTheme;

  return (
    <div className="p-4 rounded-lg" style={{ background: theme.successBackground }}>
      <h3 className="mt-0" style={{ color: theme.successText }}>
        Success!
      </h3>
      <p style={{ color: theme.successText }}>The component rendered without errors.</p>
    </div>
  );
});
