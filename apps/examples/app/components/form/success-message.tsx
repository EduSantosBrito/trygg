import { Effect } from "effect";
import { Component, type ComponentProps } from "effect-ui";
import { FormTheme } from "../../services/form";

export const SuccessMessage = Component.gen(function* (
  Props: ComponentProps<{
    email: string;
    onReset: () => Effect.Effect<void>;
  }>,
) {
  const { email, onReset } = yield* Props;
  const theme = yield* FormTheme;

  return (
    <div className="text-green-600 p-4 bg-green-50 rounded" style={{ color: theme.successColor }}>
      <h3>Success!</h3>
      <p>Form submitted successfully with email: {email}</p>
      <button
        className="px-4 py-2 text-base border border-gray-300 rounded bg-white cursor-pointer transition-colors hover:bg-gray-100"
        onClick={onReset}
      >
        Reset Form
      </button>
    </div>
  );
});
