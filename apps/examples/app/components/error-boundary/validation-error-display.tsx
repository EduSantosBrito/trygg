import { Data } from "effect";
import { Component, type ComponentProps } from "trygg";
import { ErrorTheme } from "../../services/error-boundary";

export class ValidationError extends Data.TaggedError("ValidationError")<{
  readonly field: string;
  readonly message: string;
}> {}

export const ValidationErrorDisplay = Component.gen(function* (
  Props: ComponentProps<{ error: ValidationError }>,
) {
  const { error } = yield* Props;
  const theme = yield* ErrorTheme;

  return (
    <div
      className="p-4 rounded"
      style={{ background: theme.errorBackground, color: theme.errorText }}
    >
      <h3 className="mt-0">Validation Error</h3>
      <p>
        Field: <code>{error.field}</code>
      </p>
      <p>Message: {error.message}</p>
    </div>
  );
});
