import { Effect } from "effect";
import { Component, type ComponentProps } from "trygg";
import { CounterTheme } from "../../services/counter";

export const CounterButton = Component.gen(function* (
  Props: ComponentProps<{
    label: string;
    onClick: () => Effect.Effect<void>;
    variant: "icon" | "text";
  }>,
) {
  const { label, onClick, variant } = yield* Props;
  const theme = yield* CounterTheme;

  const baseClass =
    variant === "icon"
      ? "w-12 h-12 rounded-full border border-gray-200 bg-white text-xl font-medium cursor-pointer transition-all hover:border-blue-400 hover:bg-blue-50 hover:scale-105 active:scale-95"
      : "px-4 py-1.5 rounded-md border-none bg-transparent text-sm text-gray-500 cursor-pointer transition-colors hover:text-gray-800 hover:bg-gray-100";

  return (
    <button
      className={baseClass}
      onClick={onClick}
      style={{ color: variant === "icon" ? theme.text : undefined }}
    >
      {label}
    </button>
  );
});
