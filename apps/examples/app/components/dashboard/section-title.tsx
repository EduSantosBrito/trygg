import { Component, Signal, type ComponentProps } from "trygg";
import { DashboardTheme } from "../../services/dashboard";

export const SectionTitle = Component.gen(function* (Props: ComponentProps<{ title: string }>) {
  const { title } = yield* Props;
  const themeStore = yield* DashboardTheme;
  const theme = yield* Signal.get(themeStore.tokens);

  return (
    <h2 className="mb-4" style={{ color: theme.text }}>
      {title}
    </h2>
  );
});
