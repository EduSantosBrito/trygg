import { Data } from "effect";
import { Component, type ComponentProps } from "effect-ui";
import { ErrorTheme } from "../../services/error-boundary";

export class NetworkError extends Data.TaggedError("NetworkError")<{
  readonly url: string;
  readonly status: number;
}> {}

export const NetworkErrorDisplay = Component.gen(function* (
  Props: ComponentProps<{ error: NetworkError }>,
) {
  const { error } = yield* Props;
  const theme = yield* ErrorTheme;

  return (
    <div
      className="p-4 rounded"
      style={{ background: theme.errorBackground, color: theme.errorText }}
    >
      <h3 className="mt-0">Network Error</h3>
      <p>
        Failed to fetch from <code>{error.url}</code>
      </p>
      <p>
        Status: <strong>{error.status}</strong>
      </p>
    </div>
  );
});
