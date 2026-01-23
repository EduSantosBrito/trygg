import { Data } from "effect";
import { Component, type ComponentProps } from "effect-ui";
import { ErrorTheme } from "../../services/error-boundary";

export class UnknownError extends Data.TaggedError("UnknownError")<{
  readonly cause: unknown;
}> {}

export const UnknownErrorDisplay = Component.gen(function* (
  Props: ComponentProps<{ error: UnknownError }>,
) {
  const { error } = yield* Props;
  const theme = yield* ErrorTheme;

  return (
    <div
      className="p-4 rounded"
      style={{ background: theme.errorBackground, color: theme.errorText }}
    >
      <h3 className="mt-0">Unknown Error</h3>
      <pre className="bg-red-100 p-2 rounded overflow-x-auto text-sm">{String(error.cause)}</pre>
    </div>
  );
});
