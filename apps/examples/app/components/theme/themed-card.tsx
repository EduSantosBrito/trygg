import { Component } from "trygg";
import { Theme } from "../../services/theme";

export const ThemedCard = Component.gen(function* () {
  const theme = yield* Theme;

  return (
    <div
      className="p-6 rounded-lg border-2 border-solid"
      style={{
        background: theme.background,
        color: theme.text,
        borderColor: theme.border,
      }}
    >
      <h3 className="mt-0" style={{ color: theme.primary }}>
        {theme.name} Theme
      </h3>
      <p>This card uses the injected theme service.</p>
      <p>Click "Switch to Dark/Light Theme" above to see the theme change.</p>
    </div>
  );
});
