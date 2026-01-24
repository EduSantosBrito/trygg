import { Component, type ComponentProps } from "trygg";
import { DashboardTheme, Logger } from "../../services/dashboard";

export const Header = Component.gen(function* (
  Props: ComponentProps<{
    userName: string;
  }>,
) {
  const { userName } = yield* Props;
  const theme = yield* DashboardTheme;
  const logger = yield* Logger;

  yield* logger.info(`Header rendered for ${userName}`);

  return (
    <header
      className="border-b"
      style={{
        background: theme.cardBackground,
        borderColor: `${theme.secondary}20`,
      }}
    >
      <div className="max-w-[1200px] mx-auto px-6 py-4 flex justify-between items-center">
        <h1 className="m-0 text-2xl" style={{ color: theme.primary }}>
          Dashboard
        </h1>
        <div style={{ color: theme.text }}>Welcome, {userName}!</div>
      </div>
    </header>
  );
});
