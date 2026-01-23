import { Effect } from "effect";
import { Component, cx, type ComponentProps } from "effect-ui";
import { ErrorTheme } from "../../services/error-boundary";

export const TriggerButton = Component.gen(function* (
  Props: ComponentProps<{
    label: string;
    variant: "default" | "danger";
    onClick: () => Effect.Effect<void>;
  }>,
) {
  const { label, variant, onClick } = yield* Props;
  const theme = yield* ErrorTheme;

  return (
    <button
      className={cx(
        "px-4 py-2 text-base border border-gray-300 rounded cursor-pointer transition-colors",
        variant === "danger" ? "text-white" : "bg-white hover:bg-gray-100",
      )}
      style={
        variant === "danger" ? { background: theme.errorText, borderColor: theme.errorText } : {}
      }
      onClick={onClick}
    >
      {label}
    </button>
  );
});
