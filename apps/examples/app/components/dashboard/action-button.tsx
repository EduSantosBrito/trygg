import { Effect } from "effect";
import { Component, type ComponentProps } from "effect-ui";
import { DashboardTheme, Analytics } from "../../services/dashboard";

export const ActionButton = Component.gen(function* (
  Props: ComponentProps<{
    label: string;
    variant: "primary" | "secondary";
    onClick: () => Effect.Effect<void>;
  }>,
) {
  const { label, variant, onClick } = yield* Props;
  const theme = yield* DashboardTheme;
  const analytics = yield* Analytics;

  const handleClick = Effect.gen(function* () {
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
