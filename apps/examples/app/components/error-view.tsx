import { Effect, Option, Schema } from "effect";
import { Component, Resource, type ComponentProps } from "trygg";
import { ApiClient } from "trygg/api";

const ErrorMessage = Schema.Struct({ message: Schema.String });
const ErrorTag = Schema.Struct({ _tag: Schema.String });

const decodeErrorMessage = Schema.decodeUnknownOption(ErrorMessage);
const decodeErrorTag = Schema.decodeUnknownOption(ErrorTag);

const formatError = (error: unknown): string =>
  Option.match(decodeErrorMessage(error), {
    onNone: () =>
      Option.match(decodeErrorTag(error), {
        onNone: () => "Unknown error",
        onSome: (tagged) => tagged._tag,
      }),
    onSome: ({ message }) => message,
  });

type ErrorViewProps = {
  readonly error: unknown;
  readonly onRetry: () => Effect.Effect<void, unknown, Resource.ResourceRegistryTag | ApiClient>;
};

export const ErrorView = Component.gen<ErrorViewProps>()(
  (Props: ComponentProps<ErrorViewProps>) =>
    function* () {
      const { error, onRetry } = yield* Props;
      const message = formatError(error);
      return (
        <div className="p-3 rounded-md border border-red-200 bg-red-50 text-red-600">
          <strong>Error</strong>
          <p>{message}</p>
          <button
            className="px-4 py-2 text-base border border-gray-300 rounded bg-white cursor-pointer transition-colors hover:bg-gray-100"
            onClick={onRetry}
          >
            Try Again
          </button>
        </div>
      );
    },
);
