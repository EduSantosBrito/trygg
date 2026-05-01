import { Component, Signal } from "trygg";
import { ThemeStore } from "../../services/theme";

export const ThemedCard = Component.gen(function* () {
  const theme = yield* ThemeStore;
  const tokens = yield* Signal.get(theme.tokens);

  return (
    <div
      className="p-6 rounded-lg border-2 border-solid"
      style={{
        background: tokens.background,
        color: tokens.text,
        borderColor: tokens.border,
      }}
    >
      <h3 className="mt-0" style={{ color: tokens.primary }}>
        {theme.themeName}
      </h3>
      <p>This card observes theme state from the injected ThemeStore service.</p>
      <p>Current mode: {theme.mode}</p>
      <p>Click "Switch to Dark/Light Theme" above to send a toggle intent.</p>
    </div>
  );
});
