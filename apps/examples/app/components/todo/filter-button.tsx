import { Effect } from "effect";
import { Component, cx, type ComponentProps } from "trygg";
import { TodoTheme } from "../../services/todo";

export const FilterButton = Component.gen(function* (
  Props: ComponentProps<{
    label: string;
    count: number;
    isActive: boolean;
    onClick: () => Effect.Effect<void>;
  }>,
) {
  const { label, count, isActive, onClick } = yield* Props;
  const theme = yield* TodoTheme;

  return (
    <button
      className={cx(
        "px-4 py-2 text-base border rounded cursor-pointer transition-colors",
        isActive
          ? "border-blue-600 bg-blue-600 text-white hover:bg-blue-700"
          : "border-gray-300 bg-white hover:bg-gray-100",
      )}
      style={isActive ? { background: theme.primaryColor, color: "white" } : {}}
      onClick={onClick}
    >
      {label} ({count})
    </button>
  );
});
