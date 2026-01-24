import { Component, type ComponentProps } from "trygg";
import { Theme } from "../../services/theme";

type ThemeTitleProps = {
  title: string;
};

export const ThemedTitle = Component.gen(function* (Props: ComponentProps<ThemeTitleProps>) {
  const { title } = yield* Props;
  const theme = yield* Theme;
  return (
    <h3
      className="py-2 px-4 rounded inline-block"
      style={{
        color: theme.primary,
        background: theme.background,
      }}
    >
      {title}
    </h3>
  );
});
