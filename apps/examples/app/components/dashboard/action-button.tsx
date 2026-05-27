import { Effect } from "effect";
import { Component, Signal, type ComponentProps } from "trygg";
import { DashboardTheme, Analytics } from "../../services/dashboard";

interface ActionButtonProps<R = never, E = never> {
  readonly label: string;
  readonly variant: "primary" | "secondary";
  readonly onClick: () => Effect.Effect<void, E, R>;
}

export const ActionButton = Component.gen(function* (Props: ComponentProps<ActionButtonProps>) {
  const { label, variant, onClick } = yield* Props;
  const themeStore = yield* DashboardTheme;
  const analytics = yield* Analytics;
  const theme = yield* Signal.get(themeStore.tokens);

  const handleClick = Effect.fn("ActionButton.handleClick")(function* () {
    yield* analytics.track("button_clicked", { label, variant });
    yield* onClick();
  });

  return (
    <button
      onClick={handleClick}
      className="px-4 py-2 rounded cursor-pointer"
      style={{
        background: variant === "primary" ? theme.primary : "transparent",
        color: variant === "primary" ? "#fff" : theme.text,
        border: variant === "secondary" ? `1px solid ${theme.secondary}` : "none",
      }}
    >
      {label}
    </button>
  );
});
