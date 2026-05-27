import { Schema } from "effect";
import { Component, type ComponentProps } from "trygg";
import { ErrorTheme } from "../../services/error-boundary";

export class ValidationError extends Schema.TaggedErrorClass<ValidationError>()("ValidationError", {
  field: Schema.String,
  description: Schema.String,
}) {}

export const ValidationErrorDisplay = Component.gen(function* (
  Props: ComponentProps<{ error: ValidationError }>,
) {
  const { error } = yield* Props;
  const { field, description } = error;
  const theme = yield* ErrorTheme;

  return (
    <div
      className="p-4 rounded"
      style={{ background: theme.errorBackground, color: theme.errorText }}
    >
      <h3 className="mt-0">Validation Error</h3>
      <p>
        Field: <code>{field}</code>
      </p>
      <p>Message: {description}</p>
    </div>
  );
});
