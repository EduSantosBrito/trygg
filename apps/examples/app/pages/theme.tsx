import { Component } from "trygg";
import { ThemedCard } from "../components/theme/themed-card";
import { ThemedTitle } from "../components/theme/themed-title";
import { ThemeStore, ThemeStoreLive } from "../services/theme";

const ThemeButton = Component.gen(function* () {
  const theme = yield* ThemeStore;

  return (
    <button
      className="px-4 py-2 text-base border border-gray-300 rounded bg-white cursor-pointer transition-colors hover:bg-gray-100"
      onClick={theme.toggle}
    >
      {theme.switchLabel}
    </button>
  );
});

const ThemeExample = Component.gen(function* () {
  return (
    <div className="bg-white p-6 rounded-lg border border-gray-200">
      <h2 className="m-0 mb-1 text-2xl">Theme (Scoped Service Store)</h2>
      <p className="text-gray-500 m-0 mb-6 text-[0.95rem]">
        A provided service owns the theme signals and exposes Effectful operations.
      </p>

      <div className="mb-4">
        <ThemeButton />
      </div>

      <ThemedCard />
      <div className="mt-4">
        <ThemedTitle title="Using Component API" />
      </div>
    </div>
  );
});

const ThemePage = ThemeExample.provide(ThemeStoreLive);

export default ThemePage;
