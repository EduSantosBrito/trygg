import { Component, type ComponentProps } from "trygg";
import { DashboardTheme } from "../../services/dashboard";

export const SectionTitle = Component.gen(function* (Props: ComponentProps<{ title: string }>) {
  const { title } = yield* Props;
  const theme = yield* DashboardTheme;

  return (
    <h2 className="mb-4" style={{ color: theme.text }}>
      {title}
    </h2>
  );
});
