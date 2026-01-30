import { Layer } from "effect";
import { Signal, Component } from "trygg";
import { Theme } from "../services/theme";
import { ThemedCard } from "../components/theme/themed-card";
import { ThemedTitle } from "../components/theme/themed-title";

const LightTheme = Layer.succeed(Theme, {
  name: "Light",
  background: "#ffffff",
  text: "#333333",
  primary: "#0066cc",
  border: "#e0e0e0",
});

const DarkTheme = Layer.succeed(Theme, {
  name: "Dark",
  background: "#1a1a2e",
  text: "#eaeaea",
  primary: "#4da6ff",
  border: "#333355",
});

const ThemePage = Component.gen(function* () {
  const isDark = yield* Signal.make(false);
  const isDarkValue = yield* Signal.get(isDark);

  const currentTheme = isDarkValue ? DarkTheme : LightTheme;

  const toggleTheme = () => Signal.update(isDark, (v) => !v);

  // Partial provision: provide theme based on current signal state
  // The themed components still need Theme, we provide it at usage time
  const ProvidedCard = ThemedCard.provide(currentTheme);
  const ProvidedTitle = ThemedTitle.provide(currentTheme);

  return (
    <div className="bg-white p-6 rounded-lg border border-gray-200">
      <h2 className="m-0 mb-1 text-2xl">Theme (Dependency Injection)</h2>
      <p className="text-gray-500 m-0 mb-6 text-[0.95rem]">
        Dependency injection with Component.provide, swappable layers
      </p>

      <div className="mb-4">
        <button
          className="px-4 py-2 text-base border border-gray-300 rounded bg-white cursor-pointer transition-colors hover:bg-gray-100"
          onClick={toggleTheme}
        >
          Switch to {isDarkValue ? "Light" : "Dark"} Theme
        </button>
      </div>

      <ProvidedCard />
      <div className="mt-4">
        <ProvidedTitle title="Using Component API" />
      </div>
    </div>
  );
});

export default ThemePage;
