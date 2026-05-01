import { Component, Signal, type ComponentProps } from "trygg";
import { ThemeStore } from "../../services/theme";

type ThemeTitleProps = {
  title: string;
};

export const ThemedTitle = Component.gen(function* (Props: ComponentProps<ThemeTitleProps>) {
  const { title } = yield* Props;
  const theme = yield* ThemeStore;
  const tokens = yield* Signal.get(theme.tokens);

  return (
    <h3
      className="py-2 px-4 rounded inline-block"
      style={{
        color: tokens.primary,
        background: tokens.background,
      }}
    >
      {title}
    </h3>
  );
});
